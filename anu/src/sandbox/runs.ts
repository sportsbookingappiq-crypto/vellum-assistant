import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { StepKind, StepStatus } from "../api/model.js";
import type { DriverName } from "../config.js";
import type { Logger } from "../lib/log.js";
import { sanitizeEnv } from "./env.js";
import { LINE_PREFIX, type DriverSettings, type ParentMessage, type WorkerMessage } from "./protocol.js";

/** Where a run reports its steps. The HTTP implementation calls the API's internal endpoints. */
export interface Reporter {
  step(taskId: string, step: { kind: StepKind; title: string; detail?: unknown; status?: StepStatus }): Promise<void>;
  requestApproval(taskId: string, prompt: string, detail: unknown): Promise<{ approvalId: string }>;
  approvalStatus(taskId: string, approvalId: string): Promise<string>;
  finish(taskId: string, status: "succeeded" | "failed", result: string, confidence: number | null): Promise<void>;
}

/** Thrown by a reporter when the API says the task is no longer active (HTTP 409 or 404). */
export class TaskGoneError extends Error {}

export class HttpReporter implements Reporter {
  constructor(
    private readonly apiUrl: string,
    private readonly internalToken: string,
  ) {}

  private async call(method: string, route: string, body?: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(new URL(route, this.apiUrl), {
      method,
      headers: { authorization: `Bearer ${this.internalToken}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 409 || res.status === 404) throw new TaskGoneError(`task is no longer active (HTTP ${res.status})`);
    if (!res.ok) throw new Error(`API ${method} ${route} returned HTTP ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  }

  async step(taskId: string, step: Parameters<Reporter["step"]>[1]) {
    await this.call("POST", `/internal/v1/tasks/${taskId}/steps`, step);
  }
  async requestApproval(taskId: string, prompt: string, detail: unknown) {
    const body = await this.call("POST", `/internal/v1/tasks/${taskId}/approvals`, { prompt, detail });
    return { approvalId: String(body.id) };
  }
  async approvalStatus(taskId: string, approvalId: string) {
    const body = await this.call("GET", `/internal/v1/tasks/${taskId}/approvals/${approvalId}`);
    return String(body.status);
  }
  async finish(taskId: string, status: "succeeded" | "failed", result: string, confidence: number | null) {
    await this.call("POST", `/internal/v1/tasks/${taskId}/finish`, { status, result, confidence });
  }
}

export interface RunManagerOptions {
  root: string;
  driver: DriverName;
  settings: DriverSettings;
  timeoutMs: number;
  reporter: Reporter;
  log: Logger;
  /** The environment the sandbox server itself runs with. Only allowlisted names pass on. */
  parentEnv?: Record<string, string | undefined>;
  approvalPollMs?: number;
}

interface Run {
  taskId: string;
  proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  workspaceDir: string;
  state: "running" | "stopping" | "done";
  /** approvalId -> worker ref */
  approvals: Map<string, string>;
  timer: ReturnType<typeof setTimeout>;
  queue: Promise<void>;
  done: Promise<void>;
}

const WORKER = path.join(import.meta.dir, "worker.ts");

export class RunManager {
  private runs = new Map<string, Run>();

  constructor(private readonly options: RunManagerOptions) {}

  get active(): number {
    return [...this.runs.values()].filter((run) => run.state === "running").length;
  }

  workspaceFor(taskId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) throw new Error("invalid task id");
    return path.join(this.options.root, taskId);
  }

  async start(taskId: string, goal: string): Promise<{ driver: DriverName }> {
    if (this.runs.get(taskId)?.state === "running") return { driver: this.options.driver };
    const workspaceDir = this.workspaceFor(taskId);
    await mkdir(path.join(workspaceDir, "tmp"), { recursive: true, mode: 0o700 });

    const env = sanitizeEnv(this.options.parentEnv ?? process.env, workspaceDir, { ANU_TASK_ID: taskId });
    // setsid puts the worker in its own process group so stop can kill every descendant.
    const proc = Bun.spawn(["setsid", process.execPath, WORKER], {
      cwd: workspaceDir,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const run: Run = {
      taskId,
      proc,
      workspaceDir,
      state: "running",
      approvals: new Map(),
      timer: setTimeout(() => void this.timeout(taskId), this.options.timeoutMs),
      queue: Promise.resolve(),
      done: Promise.resolve(),
    };
    this.runs.set(taskId, run);

    const start: ParentMessage = {
      t: "start",
      taskId,
      goal,
      driver: this.options.driver,
      workspaceDir,
      settings: this.options.settings,
    };
    proc.stdin.write(JSON.stringify(start) + "\n");
    proc.stdin.flush();

    void this.pipeStderr(run);
    run.done = this.readWorker(run);
    this.options.log.info("run.started", { taskId, driver: this.options.driver, pid: proc.pid });
    return { driver: this.options.driver };
  }

  private async pipeStderr(run: Run) {
    for await (const line of lines(run.proc.stderr)) {
      if (line.trim()) this.options.log.info("run.stderr", { taskId: run.taskId, line: line.slice(0, 500) });
    }
  }

  /** Serializes reports to the API so steps arrive in order. */
  private enqueue(run: Run, work: () => Promise<void>) {
    run.queue = run.queue.then(work).catch((error) => {
      if (error instanceof TaskGoneError) {
        this.options.log.info("run.task_gone", { taskId: run.taskId });
        void this.kill(run);
      } else {
        this.options.log.error("run.report_failed", { taskId: run.taskId, error });
      }
    });
  }

  private async readWorker(run: Run): Promise<void> {
    let finished = false;
    for await (const line of lines(run.proc.stdout)) {
      if (!line.startsWith(LINE_PREFIX)) continue;
      let message: WorkerMessage;
      try {
        message = JSON.parse(line.slice(LINE_PREFIX.length));
      } catch {
        continue;
      }
      if (run.state !== "running") continue;
      const { reporter } = this.options;
      if (message.t === "step") {
        const { t: _t, ...step } = message;
        this.enqueue(run, () => reporter.step(run.taskId, step));
      } else if (message.t === "approval") {
        const ref = message.ref;
        this.enqueue(run, async () => {
          const { approvalId } = await reporter.requestApproval(run.taskId, message.prompt, message.detail ?? {});
          run.approvals.set(approvalId, ref);
          void this.pollApproval(run, approvalId);
        });
      } else if (message.t === "done") {
        finished = true;
        const result = message.result.slice(0, 100_000);
        this.enqueue(run, () => reporter.finish(run.taskId, message.status, result, message.confidence ?? null));
      }
    }
    await run.proc.exited;
    clearTimeout(run.timer);
    // Reap anything the driver left behind in the worker's process group.
    try {
      process.kill(-run.proc.pid, "SIGKILL");
    } catch {}
    if (!finished && run.state === "running") {
      this.enqueue(run, () =>
        this.options.reporter.finish(run.taskId, "failed", `The run ended unexpectedly (exit code ${run.proc.exitCode}).`, null),
      );
    }
    await run.queue;
    run.state = "done";
    this.options.log.info("run.finished", { taskId: run.taskId, exitCode: run.proc.exitCode });
  }

  /** Fallback in case the API's push of a decision does not arrive. */
  private async pollApproval(run: Run, approvalId: string) {
    const interval = this.options.approvalPollMs ?? 2000;
    while (run.state === "running" && run.approvals.has(approvalId)) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      if (!run.approvals.has(approvalId)) return;
      try {
        const status = await this.options.reporter.approvalStatus(run.taskId, approvalId);
        if (status === "approved" || status === "rejected") this.decide(run.taskId, approvalId, status);
        else if (status === "expired") return;
      } catch (error) {
        if (error instanceof TaskGoneError) return void this.kill(run);
      }
    }
  }

  /** Delivers a user's decision to the worker. Returns false if the run or approval is unknown. */
  decide(taskId: string, approvalId: string, decision: "approved" | "rejected"): boolean {
    const run = this.runs.get(taskId);
    const ref = run?.approvals.get(approvalId);
    if (!run || !ref || run.state !== "running") return false;
    run.approvals.delete(approvalId);
    const message: ParentMessage = { t: "decision", ref, decision };
    run.proc.stdin.write(JSON.stringify(message) + "\n");
    run.proc.stdin.flush();
    return true;
  }

  private async kill(run: Run) {
    if (run.state === "done") return;
    run.state = "stopping";
    clearTimeout(run.timer);
    const pid = run.proc.pid;
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
    const exited = await Promise.race([run.proc.exited.then(() => true), Bun.sleep(2000).then(() => false)]);
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
    if (!exited) await run.proc.exited;
  }

  /** Stops a run because the user asked. The API has already marked the task stopped. */
  async stop(taskId: string): Promise<boolean> {
    const run = this.runs.get(taskId);
    if (!run || run.state === "done") return false;
    await this.kill(run);
    this.options.log.info("run.stopped", { taskId });
    return true;
  }

  private async timeout(taskId: string) {
    const run = this.runs.get(taskId);
    if (!run || run.state !== "running") return;
    this.options.log.warn("run.timeout", { taskId });
    const seconds = Math.round(this.options.timeoutMs / 1000);
    await this.kill(run);
    this.enqueue(run, () => this.options.reporter.finish(taskId, "failed", `The run timed out after ${seconds} seconds.`, null));
  }

  /** Stops the run if any and removes its workspace. */
  async remove(taskId: string): Promise<void> {
    await this.stop(taskId);
    this.runs.delete(taskId);
    await rm(this.workspaceFor(taskId), { recursive: true, force: true });
  }

  async waitFor(taskId: string): Promise<void> {
    await this.runs.get(taskId)?.done;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.runs.values()].map((run) => this.kill(run)));
  }
}

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      yield buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
    }
  }
  if (buffer) yield buffer;
}
