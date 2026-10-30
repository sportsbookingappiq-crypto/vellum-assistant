import type { StepKind, StepStatus } from "../../api/model.js";
import type { ChatTurn, DriverSettings } from "../protocol.js";

export interface StepInput {
  kind: StepKind;
  title: string;
  detail?: unknown;
  status?: StepStatus;
}

export interface DriverContext {
  taskId: string;
  goal: string;
  /** The task's private directory. The driver must keep its files inside it. */
  workspaceDir: string;
  /** Sanitized environment for any child process the driver starts. */
  env: Record<string, string>;
  settings: DriverSettings;
  /** Aborted when the run is stopped or times out. */
  signal: AbortSignal;
  step(step: StepInput): void;
  /** Asks the user. Resolves when they decide in the app. */
  requestApproval(prompt: string, detail?: unknown): Promise<"approved" | "rejected">;
  log(message: string): void;
}

export interface DriverOutcome {
  status: "succeeded" | "failed";
  result: string;
  confidence?: number | null;
}

/**
 * A driver turns a goal into steps and a result. Drivers run inside the
 * per-task worker process, which has no access to platform secrets.
 */
export interface Driver {
  readonly name: string;
  run(ctx: DriverContext): Promise<DriverOutcome>;
  /**
   * Chat mode: one long-lived call per session worker. Reads turns from
   * `ctx.turns` and answers each with `ctx.endTurn`. The context's `taskId` is
   * the session id and `goal` is empty.
   */
  session(ctx: SessionContext): Promise<void>;
}

export interface SessionTurn {
  turnId: string;
  text: string;
}

export interface SessionContext extends DriverContext {
  /** Earlier messages, oldest first (from the API when the worker starts). */
  history: ChatTurn[];
  turns: AsyncIterable<SessionTurn>;
  endTurn(turnId: string, status: "succeeded" | "failed", reply: string): void;
}

/** Thrown when a driver cannot run in this environment. The message says why. */
export class DriverUnavailableError extends Error {}

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
