import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Sql } from "../db/client.js";
import { adminSql, makeTestApi, resetPhones, type TestApi } from "../test/helpers.js";
import { BODY_SHAPES, EYE_STYLES, AVATAR_COLORS, agentIdentityFor } from "./agents.js";

const OWNER = "+17075550100";
const OTHER = "+17075550101";

let sql: Sql;
let t: TestApi;
let token: string;
let otherToken: string;

beforeAll(async () => {
  sql = await adminSql();
  await resetPhones(sql, [OWNER, OTHER]);
  t = makeTestApi();
  token = await t.login(OWNER);
  otherToken = await t.login(OTHER);
});

afterAll(async () => {
  await t.close();
  await sql.end();
});

const internal = (method: string, p: string, body?: unknown) => t.call(method, p, { token: t.config.ANU_INTERNAL_TOKEN, body });
const getJson = async (p: string, as = token) => (await t.call("GET", p, { token: as })).json() as Promise<any>;

async function createSession(title?: string) {
  const res = await t.call("POST", "/v1/sessions", { token, body: title === undefined ? {} : { title } });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; title: string; status: string; agent: { name: string; avatar: Record<string, string> } };
}

async function send(id: string, text: string) {
  const res = await t.call("POST", `/v1/sessions/${id}/messages`, { token, body: { text } });
  return { status: res.status, body: (await res.json()) as any };
}

describe("agents", () => {
  test("identity is deterministic and uses catalog ids, including stellar and dendrite", () => {
    expect(BODY_SHAPES).toContain("stellar");
    expect(BODY_SHAPES).toContain("dendrite");
    const a = agentIdentityFor("00000000-0000-4000-8000-000000000001");
    expect(agentIdentityFor("00000000-0000-4000-8000-000000000001")).toEqual(a);
    expect(BODY_SHAPES).toContain(a.avatar.bodyShape);
    expect(EYE_STYLES).toContain(a.avatar.eyeStyle);
    expect(AVATAR_COLORS).toContain(a.avatar.color);
    const shapes = new Set(Array.from({ length: 200 }, (_, i) => agentIdentityFor(`seed-${i}`).avatar.bodyShape));
    expect(shapes.size).toBe(BODY_SHAPES.length);
  });
});

describe("chat sessions", () => {
  test("create, list, and get carry the agent", async () => {
    const created = await createSession();
    expect(created).toMatchObject({ title: "New chat", status: "idle" });
    expect(created.agent.name).toBeTruthy();
    // Without botId the session uses the default bot (ANU), and the agent takes its face.
    expect(created.agent).toMatchObject({ name: "ANU", avatar: { bodyShape: "stellar", eyeStyle: "gentle", color: "teal" } });
    expect((created as any).bot).toMatchObject({ name: "ANU", avatar: created.agent.avatar });
    const list = await getJson("/v1/sessions");
    expect(list.sessions.map((s: any) => s.id)).toContain(created.id);
    expect((await getJson(`/v1/sessions/${created.id}`)).agent).toEqual(created.agent);
    expect((await t.call("POST", "/v1/sessions", { token, body: { title: 5 } })).status).toBe(400);
  });

  test("messages start turns, carry history, and turn results come back in order", async () => {
    const s = await createSession();
    const first = await send(s.id, "Plan a picnic\nwith details");
    expect(first.status).toBe(202);
    expect(first.body.item).toMatchObject({ kind: "user_message", title: "Plan a picnic", text: "Plan a picnic\nwith details" });
    const turnId = first.body.turnId;
    expect(t.sandbox.turns.at(-1)).toMatchObject({ sessionId: s.id, turnId, text: "Plan a picnic\nwith details", history: [] });
    expect((await getJson(`/v1/sessions/${s.id}`)).title).toBe("Plan a picnic");

    // Busy: a second message is refused until the turn ends.
    expect((await send(s.id, "again")).status).toBe(409);

    expect((await internal("POST", `/internal/v1/sessions/${s.id}/items`, { turnId, kind: "tool", title: "Look things up" })).status).toBe(201);
    expect(
      (await internal("POST", `/internal/v1/sessions/${s.id}/items`, { turnId, kind: "browser", title: "Browse", detail: { url: "https://x", action: "navigate", frameId: null } })).status,
    ).toBe(201);
    expect((await internal("POST", `/internal/v1/sessions/${s.id}/items`, { turnId, kind: "user_message", title: "x" })).status).toBe(400);
    expect((await internal("POST", `/internal/v1/sessions/${s.id}/turns/${turnId}/done`, { status: "succeeded", reply: "Bring sandwiches." })).status).toBe(200);
    // The turn is closed now.
    expect((await internal("POST", `/internal/v1/sessions/${s.id}/items`, { turnId, kind: "tool", title: "late" })).status).toBe(409);

    const items = (await getJson(`/v1/sessions/${s.id}/messages`)).items;
    expect(items.map((i: any) => i.kind)).toEqual(["user_message", "tool", "browser", "assistant_message", "turn_complete"]);
    expect(items.map((i: any) => i.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(items.every((i: any) => i.turnId === turnId)).toBe(true);
    expect(items[3].text).toBe("Bring sandwiches.");
    expect((await getJson(`/v1/sessions/${s.id}/messages?after=3`)).items.length).toBe(2);
    expect((await getJson(`/v1/sessions/${s.id}`)).status).toBe("idle");

    const second = await send(s.id, "And drinks?");
    expect(second.status).toBe(202);
    expect(t.sandbox.turns.at(-1)!.history).toEqual([
      { role: "user", text: "Plan a picnic\nwith details" },
      { role: "assistant", text: "Bring sandwiches." },
    ]);
    await internal("POST", `/internal/v1/sessions/${s.id}/turns/${second.body.turnId}/done`, { status: "failed", reply: "model down" });
    expect((await getJson(`/v1/sessions/${s.id}`)).status).toBe("failed");
    expect((await send(s.id, "retry")).status).toBe(202);
  });

  test("approvals reuse the approval mechanism", async () => {
    const s = await createSession("Approvals");
    const { body } = await send(s.id, "Write a file");
    const res = await internal("POST", `/internal/v1/sessions/${s.id}/approvals`, { turnId: body.turnId, prompt: "Write notes.md?" });
    expect(res.status).toBe(201);
    const approval = (await res.json()) as { id: string; sessionId: string; taskId: string | null };
    expect(approval.sessionId).toBe(s.id);
    expect(approval.taskId).toBeNull();
    const detail = await getJson(`/v1/sessions/${s.id}`);
    expect(detail.status).toBe("waiting_for_you");
    expect(detail.approvals[0]).toMatchObject({ id: approval.id, status: "pending" });
    expect((await t.call("POST", `/v1/sessions/${s.id}/approvals/${approval.id}`, { token: otherToken, body: { decision: "approve" } })).status).toBe(404);
    const decided = await t.call("POST", `/v1/sessions/${s.id}/approvals/${approval.id}`, { token, body: { decision: "approve" } });
    expect(decided.status).toBe(200);
    expect(t.sandbox.calls).toContainEqual({ op: "decision", taskId: s.id, extra: { approvalId: approval.id, decision: "approved" } });
    expect((await getJson(`/v1/sessions/${s.id}`)).status).toBe("working");
    expect((await t.call("POST", `/v1/sessions/${s.id}/approvals/${approval.id}`, { token, body: { decision: "approve" } })).status).toBe(409);
  });

  test("stop ends the turn and tells the sandbox", async () => {
    const s = await createSession("Stop me");
    const { body } = await send(s.id, "long job");
    const stopped = await t.call("POST", `/v1/sessions/${s.id}/stop`, { token });
    expect(stopped.status).toBe(200);
    expect(((await stopped.json()) as any).status).toBe("idle");
    expect(t.sandbox.calls).toContainEqual({ op: "stopSession", taskId: s.id });
    const items = (await getJson(`/v1/sessions/${s.id}/messages`)).items;
    expect(items.at(-1)).toMatchObject({ kind: "turn_complete", detail: { status: "stopped" }, turnId: body.turnId });
    // Late reports from the stopped turn are refused.
    expect((await internal("POST", `/internal/v1/sessions/${s.id}/turns/${body.turnId}/done`, { status: "succeeded", reply: "late" })).status).toBe(409);
  });

  test("SSE streams items and session state", async () => {
    const s = await createSession("Stream");
    const { body } = await send(s.id, "hi");
    await internal("POST", `/internal/v1/sessions/${s.id}/turns/${body.turnId}/done`, { status: "succeeded", reply: "hello" });
    const res = await t.call("GET", `/v1/sessions/${s.id}/events`, { token, headers: {} });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    const decoder = new TextDecoder();
    while (!text.includes("turn_complete") || !text.includes("event: session")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
    await reader.cancel();
    expect(text).toContain("event: item\nid: 1\n");
    expect(text).toContain('"kind":"assistant_message"');
  });

  test("files and browser endpoints work for sessions", async () => {
    const s = await createSession("Files");
    const ws = path.join(t.sandbox.workspaceRoot, s.id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(path.join(ws, "a.txt"), "hi");
    expect((await getJson(`/v1/sessions/${s.id}/files`)).entries.map((e: any) => e.name)).toEqual(["a.txt"]);
    expect(await (await t.call("GET", `/v1/sessions/${s.id}/files/content?path=a.txt`, { token })).text()).toBe("hi");
    expect((await getJson(`/v1/sessions/${s.id}/browser`)).latest).toBeNull();
  });

  test("other users get 404 everywhere, and the sandbox is not asked", async () => {
    const s = await createSession("Private");
    const turnsBefore = t.sandbox.turns.length;
    const reads = t.sandbox.calls.filter((c) => c.op === "read").length;
    for (const [method, p, body] of [
      ["GET", `/v1/sessions/${s.id}`],
      ["GET", `/v1/sessions/${s.id}/messages`],
      ["POST", `/v1/sessions/${s.id}/messages`, { text: "hi" }],
      ["GET", `/v1/sessions/${s.id}/events`],
      ["POST", `/v1/sessions/${s.id}/stop`],
      ["DELETE", `/v1/sessions/${s.id}`],
      ["GET", `/v1/sessions/${s.id}/files`],
      ["GET", `/v1/sessions/${s.id}/browser`],
      ["GET", `/v1/sessions/${s.id}/browser/frame?frameId=f1`],
    ] as [string, string, unknown?][]) {
      expect([method, p, (await t.call(method, p, { token: otherToken, body })).status]).toEqual([method, p, 404]);
    }
    expect(t.sandbox.turns.length).toBe(turnsBefore);
    expect(t.sandbox.calls.filter((c) => c.op === "read").length).toBe(reads);
    expect((await getJson("/v1/sessions", otherToken)).sessions.map((x: any) => x.id)).not.toContain(s.id);
    expect((await getJson("/v1/agents", otherToken)).agents.map((a: any) => a.sessionId)).not.toContain(s.id);
    expect((await t.call("GET", "/v1/agents")).status).toBe(401);
  });

  test("the agents list shows tasks and sessions with status and what they are doing", async () => {
    const task = (await (await t.call("POST", "/v1/tasks", { token, body: { goal: "Agent task" } })).json()) as { id: string };
    await internal("POST", `/internal/v1/tasks/${task.id}/steps`, { kind: "tool", title: "Searching the web" });
    const s = await createSession("Agent chat");
    await send(s.id, "Do a thing");
    const { agents } = await getJson("/v1/agents");
    const forTask = agents.find((a: any) => a.taskId === task.id);
    expect(forTask).toMatchObject({ kind: "task", status: "working", doing: "Searching the web", title: "Agent task", sessionId: null });
    expect(forTask).toMatchObject({ name: "ANU", avatar: { bodyShape: "stellar", eyeStyle: "gentle", color: "teal" } });
    expect(forTask.botId).toBeTruthy();
    const forSession = agents.find((a: any) => a.sessionId === s.id);
    expect(forSession).toMatchObject({ kind: "session", status: "working", doing: "Do a thing" });
    await internal("POST", `/internal/v1/tasks/${task.id}/finish`, { status: "succeeded", result: "ok" });
    const finished = await getJson("/v1/agents?status=finished");
    expect(finished.agents.map((a: any) => a.taskId)).toContain(task.id);
    expect(finished.agents.every((a: any) => a.status === "finished")).toBe(true);
    expect((await t.call("GET", "/v1/agents?status=nope", { token })).status).toBe(400);
  });

  test("delete removes the session, its agent, and its workspace", async () => {
    const s = await createSession("Delete me");
    expect((await t.call("DELETE", `/v1/sessions/${s.id}`, { token })).status).toBe(204);
    expect((await t.call("GET", `/v1/sessions/${s.id}`, { token })).status).toBe(404);
    expect(t.sandbox.calls).toContainEqual({ op: "deleteSession", taskId: s.id });
    expect((await getJson("/v1/agents")).agents.map((a: any) => a.sessionId)).not.toContain(s.id);
  });
});

describe("sessions with bots", () => {
  const botBody = {
    name: "Flight watcher",
    role: "Watches flight prices",
    instructions: "Check flight prices to Dubai each day.",
    avatar: { bodyShape: "dendrite", eyeStyle: "curious", color: "purple" },
  };

  test("botId picks the bot; the agent and the sandbox get its identity", async () => {
    const bot = (await (await t.call("POST", "/v1/bots", { token, body: botBody })).json()) as any;
    const res = await t.call("POST", "/v1/sessions", { token, body: { botId: bot.id } });
    expect(res.status).toBe(201);
    const s = (await res.json()) as any;
    expect(s.botId).toBe(bot.id);
    expect(s.bot).toEqual({ id: bot.id, name: "Flight watcher", avatar: botBody.avatar });
    expect(s.agent).toMatchObject({ name: "Flight watcher", avatar: botBody.avatar });

    await send(s.id, "Any deals today?");
    const turn = t.sandbox.turns.at(-1)!;
    expect(turn.bot).toMatchObject({ id: bot.id, name: "Flight watcher", role: "Watches flight prices", modelProfile: null, skills: [] });
    expect(turn.bot!.version).toMatch(/^[0-9a-f]{64}$/);
    const [row] = await sql<{ bot_version: string }[]>`select bot_version from chat_sessions where id = ${s.id}`;
    expect(row!.bot_version).toBe(turn.bot!.version);

    const filtered = await getJson(`/v1/sessions?botId=${bot.id}`);
    expect(filtered.sessions.map((x: any) => x.id)).toEqual([s.id]);
    expect((await getJson("/v1/agents")).agents.find((a: any) => a.sessionId === s.id).botId).toBe(bot.id);

    // An edit changes the profile version sent with the next turn.
    await internal("POST", `/internal/v1/sessions/${s.id}/turns/${turn.turnId}/done`, { status: "succeeded", reply: "None yet." });
    expect((await t.call("PATCH", `/v1/bots/${bot.id}`, { token, body: { instructions: "Check twice a day." } })).status).toBe(200);
    await send(s.id, "And now?");
    const next = t.sandbox.turns.at(-1)!;
    expect(next.bot!.instructions).toBe("Check twice a day.");
    expect(next.bot!.version).not.toBe(turn.bot!.version);
  });

  test("another user's bot is 404 for sessions and tasks, and an unknown botId filter is 404", async () => {
    const bot = (await (await t.call("POST", "/v1/bots", { token, body: { name: "Private" } })).json()) as any;
    expect((await t.call("POST", "/v1/sessions", { token: otherToken, body: { botId: bot.id } })).status).toBe(404);
    expect((await t.call("POST", "/v1/tasks", { token: otherToken, body: { goal: "x", botId: bot.id } })).status).toBe(404);
    expect((await t.call("GET", `/v1/sessions?botId=${bot.id}`, { token: otherToken })).status).toBe(404);
    expect((await t.call("POST", "/v1/sessions", { token, body: { botId: 7 } })).status).toBe(400);
  });

  test("a task with a bot passes the profile to the sandbox", async () => {
    const bot = (await (await t.call("POST", "/v1/bots", { token, body: { name: "Task bot", personality: "Brisk" } })).json()) as any;
    const task = (await (await t.call("POST", "/v1/tasks", { token, body: { goal: "Do it", botId: bot.id } })).json()) as any;
    expect(task.botId).toBe(bot.id);
    const start = t.sandbox.calls.find((c) => c.op === "start" && c.taskId === task.id)!;
    expect((start.extra as any).bot).toMatchObject({ id: bot.id, name: "Task bot", personality: "Brisk" });
  });

  test("deleting a bot keeps its chats, with bot null and the agent's stored face", async () => {
    const bot = (await (await t.call("POST", "/v1/bots", { token, body: { name: "Short lived" } })).json()) as any;
    const s = (await (await t.call("POST", "/v1/sessions", { token, body: { botId: bot.id } })).json()) as any;
    expect((await t.call("DELETE", `/v1/bots/${bot.id}`, { token })).status).toBe(204);
    const after = await getJson(`/v1/sessions/${s.id}`);
    expect(after).toMatchObject({ botId: null, bot: null });
    expect(after.agent).toEqual(s.agent);
  });
});
