import { describe, expect, test } from "bun:test";

import { AnuApiError } from "./anu-api";
import {
  createSseParser,
  parseAnuTaskEvent,
  streamAnuTaskEvents,
  type AnuTaskEvent,
} from "./anu-sse";

const STEP = {
  id: "s-1",
  taskId: "t-1",
  seq: 1,
  kind: "plan",
  title: "Plan",
  detail: { steps: ["Inspect the workspace"] },
  status: "done",
  createdAt: "2026-10-29T10:00:00.000Z",
};

const TASK = {
  id: "t-1",
  goal: "Summarize the notes",
  status: "running",
  createdAt: "2026-10-29T10:00:00.000Z",
  updatedAt: "2026-10-29T10:00:00.000Z",
  approvals: [],
};

describe("createSseParser", () => {
  test("parses complete frames with event, id and data", () => {
    const parser = createSseParser();
    const frames = parser.push(
      `event: step\nid: 1\ndata: ${JSON.stringify(STEP)}\n\n`,
    );
    expect(frames).toEqual([
      { event: "step", id: "1", data: JSON.stringify(STEP) },
    ]);
  });

  test("holds a frame split across chunks until its blank line", () => {
    const parser = createSseParser();
    expect(parser.push("event: end\nda")).toEqual([]);
    expect(parser.push('ta: {"status":"succeeded"}\n')).toEqual([]);
    expect(parser.push("\n")).toEqual([
      { event: "end", id: undefined, data: '{"status":"succeeded"}' },
    ]);
  });

  test("handles CRLF line endings, including a CRLF split between chunks", () => {
    const parser = createSseParser();
    expect(parser.push("event: task\r\ndata: {}\r")).toEqual([]);
    expect(parser.push("\n\r\n")).toEqual([
      { event: "task", id: undefined, data: "{}" },
    ]);
  });

  test("joins multi-line data and skips comments and retry fields", () => {
    const comments: string[] = [];
    const parser = createSseParser((text) => comments.push(text));
    const frames = parser.push(
      "retry: 2000\n\n: ping\n\ndata: line one\ndata: line two\n\n",
    );
    expect(comments).toEqual(["ping"]);
    expect(frames).toEqual([
      { event: "message", id: undefined, data: "line one\nline two" },
    ]);
  });
});

describe("parseAnuTaskEvent", () => {
  test("types task, step, end and error events", () => {
    expect(
      parseAnuTaskEvent({ event: "step", data: JSON.stringify(STEP), id: "1" }),
    ).toMatchObject({ type: "step", step: { seq: 1, kind: "plan" } });
    expect(
      parseAnuTaskEvent({ event: "task", data: JSON.stringify(TASK), id: undefined }),
    ).toMatchObject({ type: "task", task: { id: "t-1", status: "running" } });
    expect(
      parseAnuTaskEvent({
        event: "end",
        data: '{"status":"succeeded"}',
        id: undefined,
      }),
    ).toEqual({ type: "end", status: "succeeded", deleted: false });
    expect(
      parseAnuTaskEvent({ event: "end", data: '{"reason":"deleted"}', id: undefined }),
    ).toEqual({ type: "end", status: null, deleted: true });
    expect(
      parseAnuTaskEvent({
        event: "error",
        data: '{"message":"stream failed"}',
        id: undefined,
      }),
    ).toEqual({ type: "error", message: "stream failed" });
  });

  test("drops malformed and unknown events", () => {
    expect(parseAnuTaskEvent({ event: "step", data: "{", id: undefined })).toBeNull();
    expect(
      parseAnuTaskEvent({ event: "step", data: '{"seq":"x"}', id: undefined }),
    ).toBeNull();
    expect(parseAnuTaskEvent({ event: "other", data: "{}", id: undefined })).toBeNull();
  });
});

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status, headers: { "content-type": "text/event-stream" } },
  );
}

describe("streamAnuTaskEvents", () => {
  test("delivers events in order and stops at end", async () => {
    const urls: string[] = [];
    const headers: Array<Record<string, string>> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      headers.push(init?.headers as Record<string, string>);
      return streamResponse([
        `event: task\ndata: ${JSON.stringify(TASK)}\n\n`,
        `event: step\nid: 1\ndata: ${JSON.stringify(STEP)}\n\n: ping\n\n`,
        'event: end\ndata: {"status":"succeeded"}\n\n',
      ]);
    }) as typeof fetch;
    const events: AnuTaskEvent[] = [];
    await streamAnuTaskEvents({
      taskId: "t-1",
      token: "anu_s_abc",
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event),
      fetchImpl,
      baseUrl: "http://anu.test",
    });
    expect(events.map((event) => event.type)).toEqual(["task", "step", "end"]);
    expect(urls).toEqual(["http://anu.test/v1/tasks/t-1/events?after=0"]);
    expect(headers[0]?.authorization).toBe("Bearer anu_s_abc");
  });

  test("resumes after the last step when the connection drops", async () => {
    const urls: string[] = [];
    let call = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      call += 1;
      if (call === 1) {
        return streamResponse([
          `event: step\nid: 1\ndata: ${JSON.stringify(STEP)}\n\n`,
        ]);
      }
      return streamResponse(['event: end\ndata: {"status":"succeeded"}\n\n']);
    }) as typeof fetch;
    const connection: boolean[] = [];
    await streamAnuTaskEvents({
      taskId: "t-1",
      token: "t",
      signal: new AbortController().signal,
      onEvent: () => undefined,
      onConnectionChange: (connected) => connection.push(connected),
      fetchImpl,
      baseUrl: "http://anu.test",
      reconnectDelayMs: 1,
    });
    expect(urls[1]).toBe("http://anu.test/v1/tasks/t-1/events?after=1");
    expect(connection).toEqual([true, false, true]);
  });

  test("rejects on 401 instead of reconnecting", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(null, { status: 401 });
    }) as unknown as typeof fetch;
    const error = await streamAnuTaskEvents({
      taskId: "t-1",
      token: "t",
      signal: new AbortController().signal,
      onEvent: () => undefined,
      fetchImpl,
      baseUrl: "http://anu.test",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnuApiError);
    expect((error as AnuApiError).status).toBe(401);
    expect(calls).toBe(1);
  });

  test("returns quietly when the caller aborts", async () => {
    const controller = new AbortController();
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as typeof fetch;
    const done = streamAnuTaskEvents({
      taskId: "t-1",
      token: "t",
      signal: controller.signal,
      onEvent: () => undefined,
      fetchImpl,
      baseUrl: "http://anu.test",
    });
    controller.abort();
    await expect(done).resolves.toBeUndefined();
  });
});
