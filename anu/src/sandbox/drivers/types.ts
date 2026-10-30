import type { StepKind, StepStatus } from "../../api/model.js";
import type { ChatTurn, DriverSettings } from "../protocol.js";

export interface StepInput {
  kind: StepKind;
  title: string;
  detail?: unknown;
  status?: StepStatus;
}

/**
 * A user's custom bot, as the sandbox applies it to a runtime. The API builds
 * it from the bots table; `version` is a sha256 of the canonical JSON of the
 * other fields (see bot-profile.ts), so a worker can tell when it is stale.
 */
export interface BotProfile {
  id: string;
  name: string;
  role: string;
  personality: string;
  instructions: string;
  avatar: { bodyShape: string; eyeStyle: string; color: string };
  /** An entry of BOT_MODEL_PROFILES, or null for the account default. */
  modelProfile: string | null;
  skills: string[];
  version: string;
}

export interface DriverContext {
  taskId: string;
  goal: string;
  /** The task's private directory. The driver must keep its files inside it. */
  workspaceDir: string;
  /** Sanitized environment for any child process the driver starts. */
  env: Record<string, string>;
  settings: DriverSettings;
  /** The bot this task or session runs as. Absent for rows made before bots existed. */
  bot?: BotProfile;
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
  /**
   * Drafts a bot from a one-sentence description. Returns the model's raw
   * reply (the API parses it). Throws DriverUnavailableError when the driver
   * has no model to ask, so the API falls back to a template.
   */
  draft(ctx: DraftContext): Promise<string>;
}

/** Draft mode: `taskId` is the draft job id, `goal` is the full draft prompt. */
export interface DraftContext extends DriverContext {
  description: string;
  locale: "ar" | "en";
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
