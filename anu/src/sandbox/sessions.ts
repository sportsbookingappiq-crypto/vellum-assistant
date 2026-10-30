import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { DriverName } from "../config.js";
import type { Logger } from "../lib/log.js";
import type { BotProfile } from "./drivers/types.js";
import { sanitizeEnv } from "./env.js";
import { LINE_PREFIX, type ChatTurn, type DriverSettings, type ParentMessage, type WorkerMessage } from "./protocol.js";
import { lines, TaskGoneError, type SessionReporter } from "./runs.js";

export interface SessionManagerOptions {
  root: string;
  driver: DriverName;
  settings: DriverSettings;
  /** Longest a single turn may run. */
  turnTimeoutMs: number;
  /** A worker with no turn for this long is shut down. The next message starts a new one. */
  idleMs: number;
  reporter: SessionReporter;
  log: Logger;
  parentEnv?: Record<string, string | undefined>;
}

interface SessionWorker {
  sessionId: string;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  state: "running" | "stopping" | "done";
  /** The turn in progress, if any. */
  turnId: string | null;
  turnTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  approvals: Map<string, string>;
  /** The bot profile version the worker started with, or null for none. */
  botVersion: string | null;
  queue: Promise<void>;
  done: Promise<void>;
}

const WORKER = path.join(import.meta.dir, "worker.ts");

/**
 * Long-lived workers for chat sessions, one per session. A worker keeps the
 * driver (and, for the harness, the assistant runtime) alive across turns.
 * Workers stop after an idle timeout, on stop, or on delete; the next turn
 * starts a new worker with the history the API sends.
 */
export class SessionManager {
  private workers = new Map<string, SessionWorker>();

  constructor(private readonly options: SessionManagerOptions) {}

  get active(): number {
    return [...this.workers.values()].filter((w) => w.state === "running").length;
  }

  workspaceFor(sessionId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("invalid session id");
    return path.join(this.options.root, sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.workers.get(sessionId)?.state === "running";
  }

  /**
   * Sends a turn, starting a worker first if none is running. An idle worker
   * started with another bot version (the bot was edited) is replaced, so the
   * edit applies from this turn; the new worker gets the history.
   */
  async turn(
    sessionId: string,
    turnId: string,
    text: string,
    history: ChatTurn[],
    bot?: BotProfile,
  ): Promise<{ driver: DriverName; resumed: boolean }> {
    let worker = this.workers.get(sessionId);
    let resumed = false;
    if (worker && worker.state === "running" && worker.turnId === null && worker.botVersion !== (bot?.version ?? null)) {
      this.options.log.info("session.bot_changed", { sessionId, from: worker.botVersion, to: bot?.version ?? null });
      await this.kill(worker);
    }
    if (!worker || worker.state !== "running") {
      worker = await this.spawn(sessionId, history, bot);
      resumed = history.length > 0;
    }
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    worker.idleTimer = null;
    worker.turnId = turnId;
    worker.turnTimer = setTimeout(() => void this.timeoutTurn(sessionId, turnId), this.options.turnTimeoutMs);
    this.write(worker, { t: "turn", turnId, text });
    return { driver: this.options.driver, resumed };
  }

  private write(worker: SessionWorker, message: ParentMessage) {
    worker.proc.stdin.write(JSON.stringify(message) + "\n");
    worker.proc.stdin.flush();
  }

  private async spawn(sessionId: string, history: ChatTurn[], bot?: BotProfile): Promise<SessionWorker> {
    const workspaceDir = this.workspaceFor(sessionId);
    await mkdir(path.join(workspaceDir, "tmp"), { recursive: true, mode: 0o700 });
    const env = sanitizeEnv(this.options.parentEnv ?? process.env, workspaceDir, { ANU_TASK_ID: sessionId });
    const proc = Bun.spawn(["setsid", process.execPath, WORKER], {
      cwd: workspaceDir,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const worker: SessionWorker = {
      sessionId,
      proc,
      state: "running",
      turnId: null,
      turnTimer: null,
      idleTimer: null,
      approvals: new Map(),
      botVersion: bot?.version ?? null,
      queue: Promise.resolve(),
      done: Promise.resolve(),
    };
    this.workers.set(sessionId, worker);
    this.write(worker, {
      t: "session",
      sessionId,
      driver: this.options.driver,
      workspaceDir,
      settings: this.options.settings,
      history,
      ...(bot ? { bot } : {}),
    });
    void (async () => {
      for await (const line of lines(proc.stderr)) {
        if (line.trim()) this.options.log.info("session.stderr", { sessionId, line: line.slice(0, 500) });
      }
    })();
    worker.done = this.read(worker);
    this.options.log.info("session.worker_started", { sessionId, driver: this.options.driver, pid: proc.pid, history: history.length, botId: bot?.id ?? null });
    return worker;
  }

  private enqueue(worker: SessionWorker, work: () => Promise<void>) {
    worker.queue = worker.queue.then(work).catch((error) => {
      if (error instanceof TaskGoneError) this.options.log.info("session.report_dropped", { sessionId: worker.sessionId });
      else this.options.log.error("session.report_failed", { sessionId: worker.sessionId, error });
    });
  }

  private async read(worker: SessionWorker) {
    const { reporter } = this.options;
    for await (const line of lines(worker.proc.stdout)) {
      if (!line.startsWith(LINE_PREFIX)) continue;
      let message: WorkerMessage;
      try {
        message = JSON.parse(line.slice(LINE_PREFIX.length));
      } catch {
        continue;
      }
      if (worker.state !== "running") continue;
      const turnId = worker.turnId;
      if (message.t === "step" && turnId) {
        const { t: _t, ...item } = message;
        this.enqueue(worker, () => reporter.sessionItem(worker.sessionId, turnId, item));
      } else if (message.t === "approval" && turnId) {
        const ref = message.ref;
        this.enqueue(worker, async () => {
          const { approvalId } = await reporter.sessionApproval(worker.sessionId, turnId, message.prompt, message.detail ?? {});
          worker.approvals.set(approvalId, ref);
        });
      } else if (message.t === "turn_done") {
        this.endTurn(worker, message.turnId);
        const { turnId: id, status, reply } = message;
        this.enqueue(worker, () => reporter.sessionTurnDone(worker.sessionId, id, status, reply.slice(0, 100_000)));
      }
    }
    await worker.proc.exited;
    try {
      process.kill(-worker.proc.pid, "SIGKILL");
    } catch {}
    const open = worker.turnId;
    if (open && worker.state === "running") {
      this.endTurn(worker, open);
      this.enqueue(worker, () =>
        reporter.sessionTurnDone(worker.sessionId, open, "failed", `The session worker ended unexpectedly (exit code ${worker.proc.exitCode}).`),
      );
    }
    await worker.queue;
    worker.state = "done";
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    if (this.workers.get(worker.sessionId) === worker) this.workers.delete(worker.sessionId);
    this.options.log.info("session.worker_exited", { sessionId: worker.sessionId, exitCode: worker.proc.exitCode });
  }

  private endTurn(worker: SessionWorker, turnId: string) {
    if (worker.turnId !== turnId) return;
    worker.turnId = null;
    worker.approvals.clear();
    if (worker.turnTimer) clearTimeout(worker.turnTimer);
    worker.turnTimer = null;
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    worker.idleTimer = setTimeout(() => {
      this.options.log.info("session.idle_shutdown", { sessionId: worker.sessionId });
      void this.kill(worker);
    }, this.options.idleMs);
  }

  private async timeoutTurn(sessionId: string, turnId: string) {
    const worker = this.workers.get(sessionId);
    if (!worker || worker.turnId !== turnId || worker.state !== "running") return;
    this.options.log.warn("session.turn_timeout", { sessionId, turnId });
    const seconds = Math.round(this.options.turnTimeoutMs / 1000);
    worker.turnId = null;
    await this.kill(worker);
    await this.options.reporter
      .sessionTurnDone(sessionId, turnId, "failed", `The turn timed out after ${seconds} seconds.`)
      .catch((error) => this.options.log.warn("session.report_failed", { sessionId, error }));
  }

  decide(sessionId: string, approvalId: string, decision: "approved" | "rejected"): boolean {
    const worker = this.workers.get(sessionId);
    const ref = worker?.approvals.get(approvalId);
    if (!worker || !ref || worker.state !== "running") return false;
    worker.approvals.delete(approvalId);
    this.write(worker, { t: "decision", ref, decision });
    return true;
  }

  private async kill(worker: SessionWorker) {
    if (worker.state === "done") return;
    worker.state = "stopping";
    for (const timer of [worker.turnTimer, worker.idleTimer]) if (timer) clearTimeout(timer);
    const pid = worker.proc.pid;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
    const exited = await Promise.race([worker.proc.exited.then(() => true), Bun.sleep(2000).then(() => false)]);
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
    if (!exited) await worker.proc.exited;
    await worker.done;
  }

  /**
   * Stops the current turn. The API has already recorded the stop, so nothing
   * is reported. The worker is killed; the next message starts a fresh one.
   */
  async stop(sessionId: string): Promise<boolean> {
    const worker = this.workers.get(sessionId);
    if (!worker || worker.state === "done") return false;
    worker.turnId = null;
    await this.kill(worker);
    return true;
  }

  async remove(sessionId: string): Promise<void> {
    await this.stop(sessionId);
    await rm(this.workspaceFor(sessionId), { recursive: true, force: true });
  }

  async waitIdle(sessionId: string): Promise<void> {
    await this.workers.get(sessionId)?.queue;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => this.kill(w)));
  }
}
