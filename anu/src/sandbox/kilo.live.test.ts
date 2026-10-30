/**
 * Live call to the Kilo Gateway through a real worker process. Skipped unless
 * ANU_LIVE_KILO=1. Uses KILO_BASE_URL, KILO_API_KEY (the literal "anonymous"
 * works for free models), and KILO_MODEL when set.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DEFAULT_KILO_BASE_URL, DEFAULT_KILO_MODEL } from "../config.js";
import { silentLogger } from "../lib/log.js";
import { RunManager, type Reporter } from "./runs.js";

const live = process.env.ANU_LIVE_KILO === "1";
const root = mkdtempSync(path.join(os.tmpdir(), "anu-kilo-live-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(!live)("kilo driver (live)", () => {
  test(
    "plans and answers a simple goal",
    async () => {
      const steps: { kind: string; title: string; detail?: unknown }[] = [];
      let finished: { status: string; result: string; confidence: number | null } | null = null;
      const reporter: Reporter = {
        step: async (_id, step) => void steps.push(step),
        requestApproval: async () => ({ approvalId: randomUUID() }),
        approvalStatus: async () => "pending",
        finish: async (_id, status, result, confidence) => void (finished = { status, result, confidence }),
      };
      const runs = new RunManager({
        root,
        driver: "kilo",
        settings: {
          kiloBaseUrl: process.env.KILO_BASE_URL || DEFAULT_KILO_BASE_URL,
          kiloApiKey: process.env.KILO_API_KEY || "anonymous",
          kiloModel: process.env.KILO_MODEL || DEFAULT_KILO_MODEL,
          assistantDir: "",
          scriptedStepDelayMs: 0,
          allowInsecureHarness: false,
        },
        timeoutMs: 300_000,
        reporter,
        log: silentLogger,
      });
      const taskId = randomUUID();
      await runs.start(taskId, "List three tips for staying focused while studying.");
      await runs.waitFor(taskId);
      console.log(JSON.stringify({ steps, finished }, null, 2).slice(0, 4000));
      expect(finished).not.toBeNull();
      expect(finished!.status).toBe("succeeded");
      expect(finished!.result.length).toBeGreaterThan(20);
      expect(steps[0]?.kind).toBe("plan");
    },
    { timeout: 320_000 },
  );
});
