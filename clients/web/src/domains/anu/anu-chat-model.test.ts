import { describe, expect, test } from "bun:test";

import {
  createAnuSession,
  fetchAnuAgents,
  fetchAnuMessages,
  sendAnuMessage,
  type AnuMessage,
} from "./anu-api";
import { applyDelta, groupChat, messageArtifact, upsertMessage } from "./anu-chat-model";
import { parseAnuSessionEvent, streamAnuSessionEvents, type AnuSessionEvent } from "./anu-sse";

const KIND = { user: "user_message", assistant: "assistant_message", tool: "tool", approval: "approval_request", system: "turn_complete" } as const;
const message = (id: string, role: AnuMessage["role"], seq: number, extra: Partial<AnuMessage> = {}): AnuMessage => ({
  id,
  role,
  seq,
  kind: KIND[role],
  content: id,
  detail: undefined,
  status: null,
  createdAt: "2026-10-30T10:00:00.000Z",
  ...extra,
});
const wire = (id: string, kind: string, seq: number, text: string | null = id) => ({
  id,
  seq,
  kind,
  title: kind,
  text,
  detail: {},
  status: "done",
  turnId: "t",
  createdAt: "2026-10-30T10:00:00.000Z",
});

describe("chat model", () => {
  test("upsertMessage replaces by id and keeps order", () => {
    const list = upsertMessage([message("a", "user", 1), message("c", "assistant", 3)], message("b", "tool", 2));
    expect(list.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(upsertMessage(list, { ...message("b", "tool", 2), content: "new" }).find((item) => item.id === "b")?.content).toBe("new");
  });

  test("applyDelta grows a reply, or starts one", () => {
    const started = applyDelta([], "r", "Hel");
    expect(started[0]?.status).toBe("streaming");
    expect(applyDelta(started, "r", "lo")[0]?.content).toBe("Hello");
  });

  test("groupChat folds consecutive tool messages", () => {
    const items = groupChat([
      message("u", "user", 1),
      message("t1", "tool", 2),
      message("t2", "tool", 3),
      message("r", "assistant", 4),
    ]);
    expect(items.map((item) => item.type)).toEqual(["user", "steps", "assistant"]);
    expect(items[1]?.type === "steps" ? items[1].messages.length : 0).toBe(2);
  });

  test("messageArtifact finds browser pages and files", () => {
    expect(messageArtifact(message("b", "tool", 1, { kind: "browser", detail: { url: "https://example.com" } }))).toEqual({ kind: "browser", url: "https://example.com" });
    expect(messageArtifact(message("f", "tool", 1, { detail: { file: "summary.md" } }))).toEqual({ kind: "file", path: "summary.md" });
    expect(messageArtifact(message("x", "tool", 1))).toBeNull();
  });
});

function json(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("agents and sessions client", () => {
  const options = { token: "t", baseUrl: "http://anu.test" };

  test("agents parse with an unknown status read as idle", async () => {
    const { fetchImpl } = json(200, {
      agents: [
        { id: "a", name: "Hexa", status: "waiting_for_you", doing: "Searching flights", avatar: { bodyShape: "hexa", eyeStyle: "gentle", color: "azure" }, sessionId: "s1" },
        { id: "b", name: "Wisp", status: "dreaming" },
      ],
    });
    const agents = await fetchAnuAgents({ ...options, fetchImpl });
    expect(agents[0]?.avatar?.color).toBe("azure");
    expect(agents[0]?.status).toBe("waiting");
    expect(agents[0]?.activity).toBe("Searching flights");
    expect(agents[1]?.status).toBe("idle");
  });

  test("sessions: create, read messages, send", async () => {
    const created = json(201, { id: "s1", title: null, createdAt: "2026-10-30T10:00:00.000Z" });
    await createAnuSession({ title: "Hi" }, { ...options, fetchImpl: created.fetchImpl });
    expect(JSON.parse(String(created.calls[0]?.init?.body))).toEqual({ title: "Hi" });

    const listed = json(200, { items: [wire("m1", "user_message", 1), wire("m2", "tool", 2, null)] });
    const items = await fetchAnuMessages("s1", { ...options, fetchImpl: listed.fetchImpl });
    expect(items.map((item) => item.role)).toEqual(["user", "tool"]);
    expect(items[1]?.content).toBe("tool");

    const sent = json(202, { turnId: "t", item: wire("m3", "user_message", 3) });
    const item = await sendAnuMessage("s1", "Next", { ...options, fetchImpl: sent.fetchImpl });
    expect(item.role).toBe("user");
    expect(JSON.parse(String(sent.calls[0]?.init?.body))).toEqual({ text: "Next" });
    expect(sent.calls[0]?.url).toBe("http://anu.test/v1/sessions/s1/messages");
  });
});

describe("session events", () => {
  test("parse message, delta, session and end", () => {
    expect(parseAnuSessionEvent({ event: "delta", data: '{"messageId":"r","text":"Hi"}', id: undefined })).toEqual({ type: "delta", messageId: "r", text: "Hi" });
    expect(parseAnuSessionEvent({ event: "item", data: JSON.stringify(wire("m", "assistant_message", 3)), id: "3" })?.type).toBe("message");
    expect(parseAnuSessionEvent({ event: "end", data: "{}", id: undefined })).toEqual({ type: "end" });
    expect(parseAnuSessionEvent({ event: "message", data: "{", id: undefined })).toBeNull();
  });

  test("the stream resumes after the last message seq", async () => {
    const urls: string[] = [];
    let call = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      call += 1;
      const body = call === 1
        ? `event: item\nid: 4\ndata: ${JSON.stringify(wire("m", "assistant_message", 4))}\n\n`
        : "event: end\ndata: {}\n\n";
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const events: AnuSessionEvent[] = [];
    await streamAnuSessionEvents({
      sessionId: "s1",
      token: "t",
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
      fetchImpl,
      baseUrl: "http://anu.test",
      reconnectDelayMs: 1,
    });
    expect(urls[1]).toBe("http://anu.test/v1/sessions/s1/events?after=4");
    expect(events.map((event) => event.type)).toEqual(["message", "end"]);
  });
});
