import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { DriverName } from "../config.js";
import type { Logger } from "../lib/log.js";
import { sanitizeEnv } from "./env.js";
import { LINE_PREFIX, type DriverSettings, type ParentMessage, type WorkerMessage } from "./protocol.js";
import { lines } from "./runs.js";

export interface DraftResult {
  status: "succeeded" | "unavailable" | "failed" | "timeout";
  json?: string;
  error?: string;
}

export interface DraftRunnerOptions {
  root: string;
  driver: DriverName;
  settings: DriverSettings;
  timeoutMs: number;
  log: Logger;
  parentEnv?: Record<string, string | undefined>;
}

const WORKER = path.join(import.meta.dir, "worker.ts");

/**
 * Bot drafts: one worker per request, in a temporary directory under the
 * sandbox root that is deleted afterwards. The worker asks the configured
 * driver for one reply (for the harness, one turn in a throwaway runtime).
 */
export class DraftRunner {
  constructor(private readonly options: DraftRunnerOptions) {}

  async run(description: string, locale: "ar" | "en"): Promise<DraftResult> {
    const jobId = randomUUID();
    const workspaceDir = path.join(this.options.root, "drafts", jobId);
    await mkdir(path.join(workspaceDir, "tmp"), { recursive: true, mode: 0o700 });
    const env = sanitizeEnv(this.options.parentEnv ?? process.env, workspaceDir, { ANU_TASK_ID: jobId });
    const proc = Bun.spawn(["setsid", process.execPath, WORKER], {
      cwd: workspaceDir,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const message: ParentMessage = {
      t: "draft",
      jobId,
      description,
      locale,
      driver: this.options.driver,
      workspaceDir,
      settings: this.options.settings,
    };
    proc.stdin.write(JSON.stringify(message) + "\n");
    proc.stdin.flush();
    void (async () => {
      for await (const line of lines(proc.stderr)) {
        if (line.trim()) this.options.log.info("draft.stderr", { jobId, line: line.slice(0, 500) });
      }
    })();

    const read = (async (): Promise<DraftResult> => {
      for await (const line of lines(proc.stdout)) {
        if (!line.startsWith(LINE_PREFIX)) continue;
        try {
          const out = JSON.parse(line.slice(LINE_PREFIX.length)) as WorkerMessage;
          if (out.t === "draft_done" && out.jobId === jobId) return { status: out.status, json: out.json, error: out.error };
        } catch {}
      }
      return { status: "failed", error: `the draft worker exited with code ${proc.exitCode ?? "unknown"}` };
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<DraftResult>((resolve) => {
      timer = setTimeout(() => resolve({ status: "timeout", error: "the draft took too long" }), this.options.timeoutMs);
    });
    try {
      const result = await Promise.race([read, timeout]);
      this.options.log.info("draft.finished", { jobId, status: result.status });
      return result;
    } finally {
      clearTimeout(timer);
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {}
      await Promise.race([proc.exited, Bun.sleep(5000)]);
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {}
      await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
