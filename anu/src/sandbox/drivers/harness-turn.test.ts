import { describe, expect, test } from "bun:test";

import type { DriverSettings } from "../protocol.js";
import {
  LOW_CONFIDENCE,
  confirmationPrompt,
  readSse,
  relativize,
  runTurn,
  summarizeToolInput,
  taskMessage,
  type RuntimeClient,
} from "./harness-turn.js";
import type { DriverContext, StepInput } from "./types.js";

type Event = Record<string, unknown>;

/**
 * A fake runtime: each POST /v1/messages plays the next scripted batch of
 * events on the stream. Records every call.
 */
function fakeRuntime(batches: Event[][], onCall?: (route: string, body: unknown) => Event[] | void) {
  const calls: { method: string; route: string; body: unknown }[] = [];
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const push = (events: Event[]) => {
    for (const message of events) controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ message })}\n\n`));
  };
  const client: RuntimeClient = {
    async call(method, route, body) {
      calls.push({ method, route, body });
      if (route === "/v1/messages") {
        const batch = batches.shift();
        if (batch) queueMicrotask(() => push(batch));
        return { accepted: true };
      }
      const more = onCall?.(route, body);
      if (more) queueMicrotask(() => push(more));
      return { accepted: true };
    },
    async events() {
      return new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    },
  };
  return { client, calls };
}

function context(decision: "approved" | "rejected" = "approved") {
  const steps: StepInput[] = [];
  const approvals: { prompt: string; detail: unknown }[] = [];
  const ctx: DriverContext = {
    taskId: "00000000-0000-4000-8000-000000000001",
    goal: "write notes.md",
    workspaceDir: "/tmp/task",
    env: {},
    settings: {} as DriverSettings,
    signal: new AbortController().signal,
    step: (step) => void steps.push(step),
    requestApproval: async (prompt, detail) => {
      approvals.push({ prompt, detail });
      return decision;
    },
    log() {},
  };
  return { ctx, steps, approvals };
}

const options = { inferenceProfile: "p", timeoutMs: 10_000, workspace: "/ws" };

describe("harness turn mapping", () => {
  test("maps narration, tool calls, results, and the final reply to steps", async () => {
    const { client } = fakeRuntime([
      [
        { type: "assistant_text_delta", text: "I'll write the file." },
        { type: "tool_use_start", toolName: "file_write", toolUseId: "t1", startedAt: 1000, input: { path: "/ws/notes.md", content: "x".repeat(5000) } },
        { type: "tool_result", toolName: "file_write", toolUseId: "t1", completedAt: 1250, result: "Successfully wrote to /ws/notes.md", isError: false },
        { type: "tool_use_start", toolName: "bash", toolUseId: "t2", input: { command: "cat missing.txt" } },
        { type: "tool_result", toolName: "bash", toolUseId: "t2", result: "cat: missing.txt: No such file\nexit 1", isError: true },
        { type: "assistant_text_delta", text: "Done: notes.md" },
        { type: "message_complete", source: "aux" },
        { type: "message_complete" },
      ],
    ]);
    const { ctx, steps } = context();
    const outcome = await runTurn(ctx, client, options);
    expect(outcome).toEqual({ status: "succeeded", result: "Done: notes.md", confidence: null });
    const titles = steps.map((s) => `${s.kind}:${s.title}`);
    expect(titles).toEqual([
      "message:Sent the goal to the assistant",
      "message:I'll write the file.",
      "tool:file_write: notes.md",
      "observation:file_write finished in 0.3s",
      "tool:bash: cat missing.txt",
      expect.stringMatching(/^observation:bash failed in .*: cat: missing.txt: No such file$/),
      "observation:The assistant finished: 2 tool calls, 1 failed, 0 approvals",
    ]);
    const toolDetail = steps[2]!.detail as { input: { content: string } };
    expect(toolDetail.input.content.length).toBeLessThan(2100);
    expect(steps[3]!.detail).toMatchObject({ durationMs: 250, summary: "Successfully wrote to /ws/notes.md" });
    expect(steps[5]!.status).toBe("failed");
  });

  test("reports low confidence when every tool call failed", async () => {
    const { client } = fakeRuntime([
      [
        { type: "tool_use_start", toolName: "bash", toolUseId: "t1", input: { command: "ls" } },
        { type: "tool_result", toolName: "bash", toolUseId: "t1", result: "Permission denied", isError: true },
        { type: "assistant_text_delta", text: "I could not run the command because permission was denied." },
        { type: "message_complete" },
      ],
    ]);
    const { ctx, steps } = context();
    const outcome = await runTurn(ctx, client, options);
    expect(outcome.confidence).toBe(LOW_CONFIDENCE);
    expect(steps.at(-1)!.status).toBe("failed");
  });

  test("routes the runtime's consent prompt to an ANU approval and answers it", async () => {
    for (const [decision, wire] of [
      ["approved", "allow"],
      ["rejected", "deny"],
    ] as const) {
      const { client, calls } = fakeRuntime(
        [
          [
            { type: "tool_use_start", toolName: "bash", toolUseId: "t1", input: { command: "rm -rf /ws/scratch" } },
            {
              type: "confirmation_request",
              requestId: "r1",
              toolName: "bash",
              input: { command: "rm -rf /ws/scratch" },
              riskLevel: "high",
              riskReason: "deletes files",
              allowlistOptions: [],
              scopeOptions: [],
            },
          ],
        ],
        (route) =>
          route === "/v1/confirm"
            ? [
                { type: "tool_result", toolName: "bash", toolUseId: "t1", result: "ok" },
                { type: "assistant_text_delta", text: "Removed the scratch directory as asked." },
                { type: "message_complete" },
              ]
            : undefined,
      );
      const { ctx, approvals } = context(decision);
      const outcome = await runTurn(ctx, client, options);
      expect(outcome.status).toBe("succeeded");
      expect(approvals).toHaveLength(1);
      expect(approvals[0]!.prompt).toBe("Allow the assistant to run bash: rm -rf scratch?");
      expect(approvals[0]!.detail).toMatchObject({ source: "assistant_confirmation", riskLevel: "high", riskReason: "deletes files" });
      expect(calls.find((c) => c.route === "/v1/confirm")?.body).toEqual({ requestId: "r1", decision: wire });
    }
  });

  test("sends the goal framed as a task to carry through in this turn", async () => {
    const { client, calls } = fakeRuntime([
      [{ type: "assistant_text_delta", text: "Here are three tips: plan, rest, and focus on one task." }, { type: "message_complete" }],
    ]);
    const { ctx } = context();
    await runTurn(ctx, client, options);
    const sent = calls.filter((c) => c.route === "/v1/messages").map((c) => (c.body as { content: string }).content);
    expect(sent).toEqual([taskMessage("write notes.md")]);
    expect(sent[0]!.startsWith("write notes.md\n\n")).toBe(true);
    expect(sent[0]).toContain("finish this turn with the result");
  });

  test("returns a short reply as is, without sending anything more", async () => {
    const { client, calls } = fakeRuntime([[{ type: "assistant_text_delta", text: "on it." }, { type: "message_complete" }]]);
    const { ctx } = context();
    const outcome = await runTurn(ctx, client, options);
    expect(outcome.result).toBe("on it.");
    expect(calls.filter((c) => c.route === "/v1/messages")).toHaveLength(1);
  });

  test("declines secret requests and surfaces errors", async () => {
    const { client, calls } = fakeRuntime([
      [
        { type: "secret_request", requestId: "s1", service: "github", field: "token", label: "a GitHub token" },
        { type: "conversation_error", conversationId: "c", code: "PROVIDER_RATE_LIMIT", userMessage: "Rate limited", retryable: true },
      ],
    ]);
    const { ctx, steps } = context();
    await expect(runTurn(ctx, client, options)).rejects.toThrow("assistant error: Rate limited");
    expect(calls.find((c) => c.route === "/v1/secret")?.body).toEqual({ requestId: "s1" });
    expect(steps.some((s) => s.title.includes("a GitHub token") && s.status === "failed")).toBe(true);
  });

  test("closes question cards it cannot show and records the question", async () => {
    const { client, calls } = fakeRuntime(
      [
        [
          {
            type: "question_request",
            requestId: "q1",
            question: "Which format?",
            questions: [{ id: "a", question: "Which format?", options: [] }],
            options: [],
          },
        ],
      ],
      (route) =>
        route === "/v1/question-response"
          ? [{ type: "assistant_text_delta", text: "No answer, so I used Markdown as the default format." }, { type: "message_complete" }]
          : undefined,
    );
    const { ctx, steps } = context();
    const outcome = await runTurn(ctx, client, options);
    expect(outcome.result).toContain("Markdown");
    expect(calls.find((c) => c.route === "/v1/question-response")?.body).toEqual({ requestId: "q1", kind: "close" });
    expect(steps.some((s) => s.title.startsWith("The assistant asked: Which format?"))).toBe(true);
  });

  test("falls back to the anu source channel when vellum is rejected", async () => {
    const { client, calls } = fakeRuntime([[{ type: "assistant_text_delta", text: "A complete answer that is clearly long enough to count." }, { type: "message_complete" }]]);
    const call = client.call;
    let first = true;
    client.call = async (method, route, body) => {
      if (route === "/v1/messages" && first) {
        first = false;
        calls.push({ method, route, body });
        throw new Error("assistant POST /v1/messages returned HTTP 400: bad channel");
      }
      return call(method, route, body);
    };
    const { ctx } = context();
    await runTurn(ctx, client, options);
    const channels = calls.filter((c) => c.route === "/v1/messages").map((c) => (c.body as { sourceChannel: string }).sourceChannel);
    expect(channels).toEqual(["vellum", "anu"]);
  });
});

describe("harness turn helpers", () => {
  test("summarizes tool inputs by their most telling field", () => {
    expect(summarizeToolInput({ activity: "Writing", path: "notes.md" })).toBe("notes.md");
    expect(summarizeToolInput({ command: "ls -la\n  | wc -l" })).toBe("ls -la | wc -l");
    expect(summarizeToolInput({ other: 1, note: "free text" })).toBe("free text");
    expect(summarizeToolInput({})).toBe("");
    expect(summarizeToolInput({ command: "x".repeat(300) }, 20)).toHaveLength(20);
    expect(confirmationPrompt("web_fetch", {})).toBe("Allow the assistant to run web_fetch?");
    expect(relativize({ path: "/ws/a/b.md", n: 1 }, "/ws")).toEqual({ path: "a/b.md", n: 1 });
    expect(relativize({ command: "cd /ws && ls /ws/demo" }, "/ws/")).toEqual({ command: "cd . && ls demo" });
  });

  test("parses SSE frames split across chunks and CRLF line endings", async () => {
    const encoder = new TextEncoder();
    const chunks = ["event: message\r\ndata: {\"a\"", ":1}\r\n\r\ndata: x\n", "\n"];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const chunk of chunks) c.enqueue(encoder.encode(chunk));
        c.close();
      },
    });
    const frames = [];
    for await (const frame of readSse(body)) frames.push(frame);
    expect(frames).toEqual([
      { event: "message", data: '{"a":1}' },
      { event: "message", data: "x" },
    ]);
  });
});

describe("harness browser capture", () => {
  test("browser tool results become browser steps, and screenshots become frames", async () => {
    const { mkdtempSync } = await import("node:fs");
    const os = await import("node:os");
    const nodePath = await import("node:path");
    const { encodePng, listFrames } = await import("../browser-frames.js");
    const dir = mkdtempSync(nodePath.join(os.tmpdir(), "anu-harness-browser-"));
    const png = encodePng(4, 4, () => [255, 0, 0]).toString("base64");
    const { client } = fakeRuntime([
      [
        { type: "tool_use_start", toolName: "browser_navigate", toolUseId: "b1", input: { url: "https://example.com" } },
        { type: "tool_result", toolName: "browser_navigate", toolUseId: "b1", result: "Requested URL: https://example.com\nFinal URL: https://example.com/home\nTitle: x" },
        { type: "tool_use_start", toolName: "browser_screenshot", toolUseId: "b2", input: {} },
        { type: "tool_result", toolName: "browser_screenshot", toolUseId: "b2", result: "Screenshot captured (10 bytes, viewport)", imageDataList: [png] },
        { type: "assistant_text_delta", text: "Done" },
        { type: "message_complete" },
      ],
    ]);
    const { ctx, steps } = context();
    ctx.workspaceDir = dir;
    await runTurn(ctx, client, options);
    const browser = steps.filter((s) => s.kind === "browser");
    expect(browser.map((s) => s.detail)).toEqual([
      { url: "https://example.com/home", action: "navigate", frameId: null },
      { url: "https://example.com/home", action: "screenshot", frameId: "f1" },
    ]);
    const frames = await listFrames(dir);
    expect(frames).toMatchObject([{ frameId: "f1", contentType: "image/png", url: "https://example.com/home" }]);
  });
});
