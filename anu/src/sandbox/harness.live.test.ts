/**
 * Boots the real assistant runtime from ../assistant (credential executor,
 * daemon, gateway) through a worker and runs turns against Kilo. Skipped unless
 * ANU_LIVE_HARNESS=1. Uses KILO_BASE_URL, KILO_API_KEY (the literal "anonymous"
 * works for free models), and KILO_MODEL when set.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ANU_DIR, DEFAULT_KILO_BASE_URL, DEFAULT_KILO_MODEL } from "../config.js";
import { silentLogger } from "../lib/log.js";
import { RunManager, type Reporter } from "./runs.js";

const live = process.env.ANU_LIVE_HARNESS === "1";
const root = mkdtempSync(path.join(os.tmpdir(), "anu-harness-live-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function harnessRuns(reporter: Reporter) {
  return new RunManager({
    root,
    driver: "harness",
    settings: {
      kiloBaseUrl: process.env.KILO_BASE_URL || DEFAULT_KILO_BASE_URL,
      kiloApiKey: process.env.KILO_API_KEY || "anonymous",
      kiloModel: process.env.KILO_MODEL || DEFAULT_KILO_MODEL,
      assistantDir: process.env.ANU_ASSISTANT_DIR || path.resolve(ANU_DIR, "..", "assistant"),
      scriptedStepDelayMs: 0,
      allowInsecureHarness: true,
    },
    timeoutMs: 300_000,
    reporter,
    log: silentLogger,
  });
}

/** Records steps and approves every approval the run asks for. */
function recorder() {
  const steps: { kind: string; title: string; detail?: unknown; status?: string }[] = [];
  const approvals: string[] = [];
  let finished: { status: string; result: string; confidence: number | null } | null = null;
  let runs: RunManager | null = null;
  const reporter: Reporter = {
    step: async (_id, step) => void steps.push(step),
    requestApproval: async (taskId, prompt) => {
      approvals.push(prompt);
      const approvalId = randomUUID();
      setTimeout(() => runs?.decide(taskId, approvalId, "approved"), 100);
      return { approvalId };
    },
    approvalStatus: async () => "pending",
    finish: async (_id, status, result, confidence) => void (finished = { status, result, confidence }),
  };
  return {
    steps,
    approvals,
    reporter,
    attach: (manager: RunManager) => void (runs = manager),
    get finished() {
      return finished;
    },
  };
}

describe.skipIf(!live)("harness driver (live)", () => {
  test(
    "plans and answers a simple goal",
    async () => {
      const rec = recorder();
      const runs = harnessRuns(rec.reporter);
      rec.attach(runs);
      const taskId = randomUUID();
      await runs.start(taskId, "List three tips for staying focused while studying.");
      await runs.waitFor(taskId);
      console.log(JSON.stringify({ steps: rec.steps, finished: rec.finished }, null, 2).slice(0, 4000));
      expect(rec.finished).not.toBeNull();
      expect(rec.finished!.status).toBe("succeeded");
      expect(rec.finished!.result.length).toBeGreaterThan(20);
      expect(rec.steps.some((s) => s.title.startsWith("Assistant runtime is ready"))).toBe(true);
    },
    { timeout: 320_000 },
  );

  test(
    "runs assistant tools as the guardian and reports each call",
    async () => {
      const rec = recorder();
      const runs = harnessRuns(rec.reporter);
      rec.attach(runs);
      const taskId = randomUUID();
      await runs.start(
        taskId,
        "Create a file named hello.txt in your workspace containing exactly the text: anu harness ok. Then tell me you are done.",
      );
      await runs.waitFor(taskId);
      console.log(JSON.stringify({ steps: rec.steps, approvals: rec.approvals, finished: rec.finished }, null, 2).slice(0, 6000));
      expect(rec.finished?.status).toBe("succeeded");
      const tools = rec.steps.filter((s) => s.kind === "tool" && /^(file_write|bash)/.test(s.title));
      expect(tools.length).toBeGreaterThan(0);
      expect(rec.steps.some((s) => s.kind === "observation" && s.status === "failed" && /Permission denied/.test(s.title))).toBe(false);
      const file = path.join(root, taskId, "harness", ".vellum", "workspace", "hello.txt");
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toContain("anu harness ok");
    },
    { timeout: 320_000 },
  );
});
