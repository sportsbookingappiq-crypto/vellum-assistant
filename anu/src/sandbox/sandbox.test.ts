import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { loadSandboxConfig } from "../config.js";
import { silentLogger } from "../lib/log.js";
import { secret } from "../test/helpers.js";
import { harnessDriver } from "./drivers/harness.js";
import { extractJson } from "./drivers/kilo.js";
import { isForbiddenEnvName, sanitizeEnv } from "./env.js";
import type { DriverSettings } from "./protocol.js";
import { RunManager, TaskGoneError, type Reporter, type SessionReporter } from "./runs.js";
import { SessionManager } from "./sessions.js";
import { buildSandbox } from "./server.js";

const root = mkdtempSync(path.join(os.tmpdir(), "anu-sandbox-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const SECRET_ENV = {
  ANU_INTERNAL_TOKEN: "internal-token-value-should-not-leak",
  ANU_OTP_SECRET: "otp-secret-value-should-not-leak",
  DATABASE_URL: "postgres://user:password@db/anu",
  PGPASSWORD: "pg-password",
  KILO_API_KEY: "kilo-key-value",
  AWS_SECRET_ACCESS_KEY: "aws",
  GITHUB_TOKEN: "gh",
};

const settings: DriverSettings = {
  kiloBaseUrl: "http://127.0.0.1:9",
  kiloApiKey: "anonymous",
  kiloModel: "test",
  assistantDir: "/nonexistent",
  scriptedStepDelayMs: 0,
  allowInsecureHarness: false,
};

class RecordingReporter implements Reporter {
  steps: { taskId: string; kind: string; title: string; detail?: unknown }[] = [];
  approvals: { taskId: string; approvalId: string; prompt: string }[] = [];
  finished = new Map<string, { status: string; result: string; confidence: number | null }>();
  gone = new Set<string>();
  private counter = 0;

  async step(taskId: string, step: { kind: string; title: string; detail?: unknown }) {
    if (this.gone.has(taskId)) throw new TaskGoneError("gone");
    this.steps.push({ taskId, ...step });
  }
  async requestApproval(taskId: string, prompt: string) {
    const approvalId = `00000000-0000-4000-b000-${String(++this.counter).padStart(12, "0")}`;
    this.approvals.push({ taskId, approvalId, prompt });
    return { approvalId };
  }
  async approvalStatus() {
    return "pending";
  }
  async finish(taskId: string, status: string, result: string, confidence: number | null) {
    this.finished.set(taskId, { status, result, confidence });
  }
}

function manager(reporter: Reporter, overrides: Partial<ConstructorParameters<typeof RunManager>[0]> = {}) {
  return new RunManager({
    root,
    driver: "scripted",
    settings,
    timeoutMs: 30_000,
    reporter,
    log: silentLogger,
    parentEnv: { ...process.env, ...SECRET_ENV },
    approvalPollMs: 50,
    ...overrides,
  });
}

async function until(check: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await Bun.sleep(20);
  }
}

describe("environment sanitization", () => {
  test("only allowlisted variables pass, with HOME and TMPDIR inside the workspace", () => {
    const env = sanitizeEnv({ PATH: "/usr/bin", LANG: "C.UTF-8", ...SECRET_ENV, RANDOM_THING: "x" }, "/ws/task");
    expect(env).toEqual({ PATH: "/usr/bin", LANG: "C.UTF-8", HOME: "/ws/task", TMPDIR: "/ws/task/tmp" });
  });

  test("secret-looking extras are refused", () => {
    for (const name of Object.keys(SECRET_ENV)) {
      expect(isForbiddenEnvName(name)).toBe(true);
      expect(() => sanitizeEnv({}, "/ws", { [name]: "x" })).toThrow("refusing");
    }
    expect(sanitizeEnv({}, "/ws", { ANU_TASK_ID: "t" }).ANU_TASK_ID).toBe("t");
  });

  test("a real worker and its children never see platform secrets", async () => {
    const reporter = new RecordingReporter();
    const runs = manager(reporter);
    const taskId = randomUUID();
    await runs.start(taskId, "Inspect env");
    await runs.waitFor(taskId);

    expect(reporter.finished.get(taskId)?.status).toBe("succeeded");
    const observation = reporter.steps.find((s) => s.taskId === taskId && s.kind === "observation")!;
    const detail = observation.detail as { cwd: string; envNames: string[] };
    for (const name of Object.keys(SECRET_ENV)) expect(detail.envNames).not.toContain(name);
    expect(detail.envNames.every((name) => !isForbiddenEnvName(name))).toBe(true);
    expect(detail.cwd).toBe(path.join(root, taskId));
    expect(readFileSync(path.join(root, taskId, "summary.md"), "utf8")).toContain("Inspect env");
  });
});

describe("run lifecycle", () => {
  test("steps arrive in order and the result is reported", async () => {
    const reporter = new RecordingReporter();
    const runs = manager(reporter);
    const taskId = randomUUID();
    await runs.start(taskId, "Order check");
    await runs.waitFor(taskId);
    expect(reporter.steps.filter((s) => s.taskId === taskId).map((s) => s.kind)).toEqual([
      "plan",
      "tool",
      "observation",
      "browser",
      "browser",
      "tool",
    ]);
    expect(reporter.finished.get(taskId)).toMatchObject({ status: "succeeded", confidence: 0.9 });
  });

  test("approvals wait for a decision delivered by the API", async () => {
    const reporter = new RecordingReporter();
    const runs = manager(reporter);
    const taskId = randomUUID();
    await runs.start(taskId, "Ask first #approval");
    await until(() => reporter.approvals.some((a) => a.taskId === taskId));
    await Bun.sleep(100);
    expect(reporter.finished.has(taskId)).toBe(false);
    const { approvalId } = reporter.approvals.find((a) => a.taskId === taskId)!;
    expect(runs.decide(taskId, approvalId, "rejected")).toBe(true);
    expect(runs.decide(taskId, approvalId, "rejected")).toBe(false);
    await runs.waitFor(taskId);
    expect(reporter.finished.get(taskId)).toMatchObject({ status: "succeeded", confidence: 0.6 });
    expect(existsSync(path.join(root, taskId, "summary.md"))).toBe(false);
  });

  test("stop kills the worker process group", async () => {
    const reporter = new RecordingReporter();
    const runs = manager(reporter);
    const taskId = randomUUID();
    await runs.start(taskId, "Take forever #slow");
    await until(() => reporter.steps.some((s) => s.taskId === taskId && s.kind === "message"));
    const started = Date.now();
    expect(await runs.stop(taskId)).toBe(true);
    await runs.waitFor(taskId);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(reporter.finished.has(taskId)).toBe(false); // the API owns the stopped state
  });

  test("a run that exceeds the timeout is killed and reported as failed", async () => {
    const reporter = new RecordingReporter();
    const runs = manager(reporter, { timeoutMs: 800 });
    const taskId = randomUUID();
    await runs.start(taskId, "Too slow #slow");
    await until(() => reporter.finished.has(taskId), 10_000);
    expect(reporter.finished.get(taskId)?.status).toBe("failed");
    expect(reporter.finished.get(taskId)?.result).toContain("timed out");
  });

  test("the run is killed when the API says the task is gone", async () => {
    const reporter = new RecordingReporter();
    const runs = manager(reporter);
    const taskId = randomUUID();
    reporter.gone.add(taskId);
    await runs.start(taskId, "Orphan #slow");
    await runs.waitFor(taskId);
    expect(runs.active).toBe(0);
  });

  test("the harness driver is refused unless the environment allows it", async () => {
    const ctx = {
      taskId: randomUUID(),
      goal: "x",
      workspaceDir: root,
      env: {},
      settings,
      signal: new AbortController().signal,
      step() {},
      requestApproval: async () => "rejected" as const,
      log() {},
    };
    await expect(harnessDriver.run(ctx)).rejects.toThrow("allowed only when ANU_ENV is dev or test");
    await expect(harnessDriver.run({ ...ctx, settings: { ...settings, allowInsecureHarness: true } })).rejects.toThrow(
      "entry not found",
    );
  });
});

describe("sandbox HTTP server", () => {
  const config = loadSandboxConfig({
    ANU_ENV: "test",
    OTP_SENDER: "dev",
    ANU_INTERNAL_TOKEN: secret(),
    ANU_SANDBOX_ROOT: root,
  });
  const sandbox = buildSandbox(config, { reporter: new RecordingReporter(), log: silentLogger });
  const call = (method: string, route: string, token?: string, body?: unknown) =>
    sandbox.handler(
      new Request(`http://sandbox.test${route}`, {
        method,
        headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );

  test("requires the internal token for every run operation", async () => {
    const taskId = randomUUID();
    expect((await call("POST", "/v1/runs", undefined, { taskId, goal: "x" })).status).toBe(401);
    expect((await call("POST", "/v1/runs", "anu_s_user_session", { taskId, goal: "x" })).status).toBe(401);
    expect((await call("POST", `/v1/runs/${taskId}/stop`, "wrong")).status).toBe(401);
    expect((await call("GET", "/healthz")).status).toBe(200);
  });

  test("validates run requests and starts runs", async () => {
    const token = config.ANU_INTERNAL_TOKEN;
    expect((await call("POST", "/v1/runs", token, { taskId: "../../etc", goal: "x" })).status).toBe(400);
    const taskId = randomUUID();
    const res = await call("POST", "/v1/runs", token, { taskId, goal: "hello" });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ driver: "scripted" });
    await sandbox.runs.waitFor(taskId);
    expect((await call("DELETE", `/v1/runs/${taskId}`, token)).status).toBe(204);
    expect(existsSync(path.join(root, taskId))).toBe(false);
  });
});

describe("kilo driver helpers", () => {
  test("extractJson tolerates fences and prose", () => {
    expect(extractJson('```json\n{"steps":["a"]}\n```')).toEqual({ steps: ["a"] });
    expect(extractJson('Sure! {"result":"x","confidence":0.5} hope that helps')).toEqual({ result: "x", confidence: 0.5 });
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("chat session workers", () => {
  class SessionRecorder implements SessionReporter {
    items: { sessionId: string; turnId: string; kind: string; title: string; detail?: unknown }[] = [];
    approvals: { sessionId: string; approvalId: string }[] = [];
    done = new Map<string, { status: string; reply: string }>();
    private counter = 0;
    async sessionItem(sessionId: string, turnId: string, item: { kind: string; title: string; detail?: unknown }) {
      this.items.push({ sessionId, turnId, ...item });
    }
    async sessionApproval(sessionId: string) {
      const approvalId = `00000000-0000-4000-c000-${String(++this.counter).padStart(12, "0")}`;
      this.approvals.push({ sessionId, approvalId });
      return { approvalId };
    }
    async sessionTurnDone(_sessionId: string, turnId: string, status: string, reply: string) {
      this.done.set(turnId, { status, reply });
    }
  }
  const sessionManager = (reporter: SessionReporter, idleMs = 30_000) =>
    new SessionManager({
      root,
      driver: "scripted",
      settings,
      turnTimeoutMs: 30_000,
      idleMs,
      reporter,
      log: silentLogger,
      parentEnv: { ...process.env, ...SECRET_ENV },
    });

  test("one worker keeps context across turns; idle shutdown resumes from history", async () => {
    const reporter = new SessionRecorder();
    const sessions = sessionManager(reporter, 300);
    const id = randomUUID();
    const [t1, t2, t3] = [randomUUID(), randomUUID(), randomUUID()];
    await sessions.turn(id, t1, "hello", []);
    await until(() => reporter.done.has(t1));
    expect(reporter.done.get(t1)).toEqual({ status: "succeeded", reply: 'Reply 1 to "hello" (I remember 0 earlier messages)' });
    await sessions.turn(id, t2, "and again #browser", []);
    await until(() => reporter.done.has(t2));
    expect(reporter.done.get(t2)!.reply).toBe('Reply 2 to "and again #browser" (I remember 2 earlier messages)');
    const browser = reporter.items.find((i) => i.turnId === t2 && i.kind === "browser")!;
    expect(browser.detail).toMatchObject({ action: "navigate", frameId: expect.stringMatching(/^f\d+$/) });

    // Idle timeout stops the worker; the next turn starts a new one with history.
    await until(() => !sessions.isRunning(id), 5000);
    const resumed = await sessions.turn(id, t3, "still there?", [
      { role: "user", text: "hello" },
      { role: "assistant", text: "Reply 1" },
    ]);
    expect(resumed.resumed).toBe(true);
    await until(() => reporter.done.has(t3));
    expect(reporter.done.get(t3)!.reply).toBe('Reply 2 to "still there?" (I remember 2 earlier messages)');
    await sessions.shutdown();
  });

  test("approvals and stop", async () => {
    const reporter = new SessionRecorder();
    const sessions = sessionManager(reporter);
    const id = randomUUID();
    const t1 = randomUUID();
    await sessions.turn(id, t1, "write it #approval", []);
    await until(() => reporter.approvals.length === 1);
    expect(sessions.decide(id, reporter.approvals[0]!.approvalId, "approved")).toBe(true);
    await until(() => reporter.done.has(t1));
    expect(existsSync(path.join(root, id, "notes.md"))).toBe(true);

    const t2 = randomUUID();
    await sessions.turn(id, t2, "wait #slow", []);
    await until(() => reporter.items.some((i) => i.turnId === t2 && i.kind === "message"));
    expect(await sessions.stop(id)).toBe(true);
    expect(sessions.isRunning(id)).toBe(false);
    await Bun.sleep(100);
    expect(reporter.done.has(t2)).toBe(false); // the API records stops itself
    await sessions.remove(id);
    expect(existsSync(path.join(root, id))).toBe(false);
  });
});
