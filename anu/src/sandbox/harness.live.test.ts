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
import { botProfileVersion } from "./drivers/bot-profile.js";
import type { BotProfile } from "./drivers/types.js";
import { DraftRunner } from "./drafts.js";
import { RunManager, type Reporter, type SessionReporter } from "./runs.js";
import { draftTimeoutMs } from "./server.js";
import { SessionManager } from "./sessions.js";

const live = process.env.ANU_LIVE_HARNESS === "1";
const root = mkdtempSync(path.join(os.tmpdir(), "anu-harness-live-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const settings = {
  kiloBaseUrl: process.env.KILO_BASE_URL || DEFAULT_KILO_BASE_URL,
  kiloApiKey: process.env.KILO_API_KEY || "anonymous",
  kiloModel: process.env.KILO_MODEL || DEFAULT_KILO_MODEL,
  assistantDir: process.env.ANU_ASSISTANT_DIR || path.resolve(ANU_DIR, "..", "assistant"),
  scriptedStepDelayMs: 0,
  allowInsecureHarness: true,
};

function bot(name: string, instructions: string): BotProfile {
  const fields = {
    id: "6f1c2a8e-3b4d-4c5e-9f60-7a8b9c0d1e2f",
    name,
    role: "Answers short questions",
    personality: "Brief",
    instructions,
    avatar: { bodyShape: "cloud", eyeStyle: "goofy", color: "orange" },
    modelProfile: null,
    skills: [],
  };
  return { ...fields, version: botProfileVersion(fields) };
}

function harnessRuns(reporter: Reporter) {
  return new RunManager({
    root,
    driver: "harness",
    settings,
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

  test(
    "a bot edit reboots the runtime on the same workspace and reaches the next turn",
    async () => {
      const done = new Map<string, { status: string; reply: string }>();
      const reporter: SessionReporter = {
        sessionItem: async () => {},
        sessionApproval: async () => ({ approvalId: randomUUID() }),
        sessionTurnDone: async (_id, turnId, status, reply) => void done.set(turnId, { status, reply }),
      };
      const sessions = new SessionManager({ root, driver: "harness", settings, turnTimeoutMs: 240_000, idleMs: 300_000, reporter, log: silentLogger });
      const sessionId = randomUUID();
      const workspace = path.join(root, sessionId, "harness", ".vellum", "workspace");
      // Free models sometimes end a turn with no text, so a turn gets a few tries.
      const ask = async (text: string, profile: BotProfile, expected: string) => {
        let last = { status: "", reply: "" };
        for (let attempt = 0; attempt < 3 && !last.reply.includes(expected); attempt++) {
          const turnId = randomUUID();
          await sessions.turn(sessionId, turnId, text, [], profile);
          while (!done.has(turnId)) await Bun.sleep(250);
          last = done.get(turnId)!;
          console.log(JSON.stringify(last).slice(0, 300));
          expect(last.status).toBe("succeeded");
        }
        return last;
      };
      const before = bot("Fare Finder", "Always end a reply with the word MANGO.");
      expect((await ask("What is your name? Reply with one short sentence.", before, "Fare Finder")).reply).toContain("Fare Finder");
      expect(readFileSync(path.join(workspace, "IDENTITY.md"), "utf8")).toContain("- **Name:** Fare Finder");

      const after = bot("Price Scout", "Always end a reply with the word PAPAYA.");
      expect((await ask("What is your name now? Reply with one short sentence.", after, "Price Scout")).reply).toContain("Price Scout");
      expect(readFileSync(path.join(workspace, "SOUL.md"), "utf8")).toContain("PAPAYA");
      await sessions.shutdown();
    },
    { timeout: 520_000 },
  );

  test(
    "drafts a bot in a throwaway runtime",
    async () => {
      const drafts = new DraftRunner({ root, driver: "harness", settings, timeoutMs: draftTimeoutMs("harness"), log: silentLogger });
      const started = Date.now();
      const result = await drafts.run("watches flight prices to Dubai and tells me when they drop", "en");
      console.log(JSON.stringify({ ms: Date.now() - started, ...result }).slice(0, 1500));
      expect(result.status).toBe("succeeded");
      expect(result.json).toContain("{");
    },
    { timeout: 130_000 },
  );
});
