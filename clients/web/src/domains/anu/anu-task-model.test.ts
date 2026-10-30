import { describe, expect, test } from "bun:test";

import { AnuApiError, type AnuStep, type AnuTask } from "./anu-api";
import { anuLoginError } from "./anu-login-errors";
import {
  activeStep,
  deriveSources,
  elapsedMs,
  formatPhone,
  groupTasks,
  mergeSteps,
  normalizePhone,
  pendingApproval,
  planItems,
  statusShape,
  statusTone,
  stepDetailLine,
  stepTone,
  taskResult,
} from "./anu-task-model";

function step(seq: number, overrides: Partial<AnuStep> = {}): AnuStep {
  return {
    id: `s-${seq}`,
    taskId: "t-1",
    seq,
    kind: "tool",
    title: `Step ${seq}`,
    detail: {},
    status: "done",
    createdAt: "2026-10-29T10:00:00.000Z",
    ...overrides,
  };
}

function task(id: string, status: AnuTask["status"]): AnuTask {
  return {
    id,
    goal: id,
    status,
    createdAt: "2026-10-29T10:00:00.000Z",
    updatedAt: "2026-10-29T10:00:00.000Z",
  };
}

describe("status", () => {
  test("each status has one tone and one glyph", () => {
    expect(statusTone("running")).toBe("live");
    expect(statusTone("awaiting_approval")).toBe("attention");
    expect(statusTone("succeeded")).toBe("positive");
    expect(statusTone("failed")).toBe("negative");
    expect(statusTone("queued")).toBe("neutral");
    expect(statusShape("awaiting_approval")).toBe("diamond");
    expect(statusShape("stopped")).toBe("square");
  });

  test("groups put the tasks waiting on the person first", () => {
    const groups = groupTasks([
      task("a", "succeeded"),
      task("b", "awaiting_approval"),
      task("c", "running"),
      task("d", "queued"),
      task("e", "stopped"),
    ]);
    expect(groups.needsYou.map((item) => item.id)).toEqual(["b"]);
    expect(groups.working.map((item) => item.id)).toEqual(["c", "d"]);
    expect(groups.finished.map((item) => item.id)).toEqual(["a", "e"]);
  });

  test("a step only takes colour when it is live, waiting or failed", () => {
    expect(stepTone(step(1), "running")).toBe("neutral");
    expect(stepTone(step(1, { status: "running" }), "running")).toBe("live");
    expect(stepTone(step(1, { status: "running" }), "stopped")).toBe("neutral");
    expect(stepTone(step(1, { status: "failed" }), "failed")).toBe("negative");
    expect(
      stepTone(step(1, { kind: "approval_request", status: "pending" }), "awaiting_approval"),
    ).toBe("attention");
    expect(stepTone(step(1, { kind: "result" }), "succeeded")).toBe("positive");
  });
});

describe("steps", () => {
  test("mergeSteps replaces by seq and keeps order", () => {
    const merged = mergeSteps(
      [step(1), step(3)],
      [step(2), step(3, { title: "newer" })],
    );
    expect(merged.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(merged[2]?.title).toBe("newer");
  });

  test("planItems reads the first plan step", () => {
    expect(
      planItems([step(1, { kind: "plan", detail: { steps: ["Find", 3, "Report"] } })]),
    ).toEqual(["Find", "Report"]);
    expect(planItems([step(1)])).toEqual([]);
  });

  test("stepDetailLine picks the most telling field", () => {
    expect(stepDetailLine(step(1, { detail: { command: "env" } }))).toEqual({
      kind: "command",
      value: "env",
    });
    expect(
      stepDetailLine(step(1, { detail: { query: "budget student laptop" } })),
    ).toEqual({ kind: "query", value: "budget student laptop" });
    expect(stepDetailLine(step(1, { detail: { envNames: ["A", "B"] } }))).toEqual({
      kind: "count",
      value: "2",
    });
    expect(stepDetailLine(step(1, { detail: null }))).toBeUndefined();
  });

  test("deriveSources lists each tool input once with its step", () => {
    const sources = deriveSources([
      step(1, { kind: "plan", detail: { steps: ["x"] } }),
      step(2, { detail: { command: "env" } }),
      step(3, { kind: "observation", detail: { sources: ["https://example.com/a"] } }),
      step(4, { detail: { file: "summary.md" } }),
      step(5, { detail: { command: "env" } }),
    ]);
    expect(sources).toEqual([
      { kind: "command", value: "env", seq: 2 },
      { kind: "link", value: "https://example.com/a", seq: 3 },
      { kind: "file", value: "summary.md", seq: 4 },
    ]);
  });

  test("activeStep finds the newest unfinished step", () => {
    expect(activeStep([step(1), step(2, { status: "running" }), step(3)])?.seq).toBe(2);
    expect(activeStep([step(1)])).toBeUndefined();
  });

  test("taskResult prefers the task's fields and falls back to the result step", () => {
    expect(
      taskResult({ result: "Done.", confidence: 0.9 }, []),
    ).toEqual({ text: "Done.", confidence: 0.9 });
    expect(
      taskResult(
        { result: null, confidence: null },
        [step(1, { kind: "result", detail: { result: "From step", confidence: 0.5 } })],
      ),
    ).toEqual({ text: "From step", confidence: 0.5 });
    expect(taskResult({ result: null, confidence: null }, [])).toBeUndefined();
  });

  test("pendingApproval finds the open question", () => {
    expect(
      pendingApproval({
        approvals: [
          {
            id: "a",
            taskId: "t",
            prompt: "Old",
            status: "expired",
            createdAt: "2026-10-29T10:00:00.000Z",
          },
          {
            id: "b",
            taskId: "t",
            prompt: "Write summary.md?",
            status: "pending",
            createdAt: "2026-10-29T10:00:00.000Z",
          },
        ],
      })?.id,
    ).toBe("b");
  });

  test("elapsedMs measures between two timestamps", () => {
    expect(elapsedMs("2026-10-29T10:00:00.000Z", "2026-10-29T10:00:04.300Z")).toBe(4300);
    expect(elapsedMs(null, "2026-10-29T10:00:04.300Z")).toBeNull();
  });
});

describe("phone numbers", () => {
  test("normalizePhone keeps the digits behind a plus", () => {
    expect(normalizePhone("+1 (202) 555-0100")).toBe("+12025550100");
    expect(normalizePhone("1.202.555.0100")).toBe("+12025550100");
    expect(normalizePhone("  ")).toBe("");
  });

  test("formatPhone groups a North American number", () => {
    expect(formatPhone("+12025550100")).toBe("+1 202 555 0100");
    expect(formatPhone("+442071838750")).toBe("+442071838750");
  });
});

describe("anuLoginError", () => {
  const error = (code: string, extra: Partial<{ status: number; attemptsRemaining: number; retryAfterSeconds: number }> = {}) =>
    new AnuApiError({ status: extra.status ?? 400, code, message: code, ...extra });

  test("maps each server code to a sentence", () => {
    expect(anuLoginError(error("invalid_phone")).key).toBe("anuLoginPage.errorInvalidPhone");
    expect(anuLoginError(error("code_expired")).key).toBe("anuLoginPage.errorCodeExpired");
    expect(anuLoginError(error("invalid_code_format")).key).toBe("anuLoginPage.errorCodeFormat");
    expect(anuLoginError(error("invalid_code", { attemptsRemaining: 2 }))).toEqual({
      key: "anuLoginPage.errorInvalidCode",
      count: 2,
    });
    expect(anuLoginError(error("invalid_code", { attemptsRemaining: 0 })).key).toBe(
      "anuLoginPage.errorCodeLocked",
    );
    expect(
      anuLoginError(error("rate_limited", { status: 429, retryAfterSeconds: 30 })),
    ).toEqual({ key: "anuLoginPage.errorRateLimited", seconds: 30 });
    expect(anuLoginError(error("network", { status: 0 })).key).toBe("anuLoginPage.errorNetwork");
    expect(anuLoginError(new Error("boom")).key).toBe("anuLoginPage.errorGeneric");
  });
});
