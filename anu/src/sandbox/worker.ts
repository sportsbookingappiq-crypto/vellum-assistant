/**
 * Per-task (or per-chat-session) worker process. The sandbox server starts one
 * per run with a sanitized environment, in its own process group, with the
 * workspace as the working directory. It reads a start message on stdin, runs
 * the driver, and writes protocol lines on stdout. It never sees platform
 * secrets. In session mode it stays up and handles `turn` messages until the
 * sandbox stops it.
 */
import { createInterface } from "node:readline";

import { DRIVERS } from "./drivers/index.js";
import { draftPrompt } from "./drivers/bot-profile.js";
import { DriverUnavailableError, type BotProfile, type DriverContext, type SessionTurn } from "./drivers/types.js";
import { LINE_PREFIX, type ParentMessage, type WorkerMessage } from "./protocol.js";

function emit(message: WorkerMessage): void {
  process.stdout.write(LINE_PREFIX + JSON.stringify(message) + "\n");
}

const pending = new Map<string, (decision: "approved" | "rejected") => void>();
let started = false;
let counter = 0;
const abort = new AbortController();
process.on("SIGTERM", () => abort.abort());

// Turns queue for session mode.
const turnQueue: SessionTurn[] = [];
let turnWaiter: (() => void) | null = null;
let currentTurn: string | null = null;
async function* turns(): AsyncGenerator<SessionTurn> {
  while (!abort.signal.aborted) {
    const next = turnQueue.shift();
    if (next) {
      currentTurn = next.turnId;
      yield next;
      continue;
    }
    await new Promise<void>((resolve) => (turnWaiter = resolve));
    turnWaiter = null;
  }
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  let message: ParentMessage;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.t === "decision") {
    pending.get(message.ref)?.(message.decision);
    pending.delete(message.ref);
  } else if (message.t === "turn") {
    turnQueue.push({ turnId: message.turnId, text: message.text });
    turnWaiter?.();
  } else if ((message.t === "start" || message.t === "session" || message.t === "draft") && !started) {
    started = true;
    void run(message);
  }
});

function baseContext(id: string, goal: string, workspaceDir: string, settings: DriverContext["settings"], bot?: BotProfile): DriverContext {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  return {
    taskId: id,
    goal,
    workspaceDir,
    env,
    settings,
    ...(bot ? { bot } : {}),
    signal: abort.signal,
    step: (step) => emit({ t: "step", ...step }),
    requestApproval: (prompt, detail) =>
      new Promise((resolve) => {
        const ref = `a${++counter}`;
        pending.set(ref, resolve);
        emit({ t: "approval", ref, prompt, detail });
      }),
    log: (message) => process.stderr.write(`[worker] ${message}\n`),
  };
}

const errorText = (error: unknown) =>
  (error instanceof DriverUnavailableError ? "Driver unavailable: " : "") + (error instanceof Error ? error.message : String(error));

async function run(start: Extract<ParentMessage, { t: "start" | "session" | "draft" }>) {
  const driver = DRIVERS[start.driver];
  if (start.t === "draft") {
    const ctx = {
      ...baseContext(start.jobId, draftPrompt(start.description, start.locale), start.workspaceDir, start.settings),
      // Nobody can answer an approval for a draft.
      requestApproval: async () => "rejected" as const,
      step: () => {},
      description: start.description,
      locale: start.locale,
    };
    try {
      if (!driver) throw new DriverUnavailableError(`unknown driver ${start.driver}`);
      emit({ t: "draft_done", jobId: start.jobId, status: "succeeded", json: await driver.draft(ctx) });
    } catch (error) {
      const unavailable = error instanceof DriverUnavailableError;
      emit({ t: "draft_done", jobId: start.jobId, status: unavailable ? "unavailable" : "failed", error: errorText(error) });
    }
  } else if (start.t === "start") {
    const ctx = baseContext(start.taskId, start.goal, start.workspaceDir, start.settings, start.bot);
    try {
      if (!driver) throw new DriverUnavailableError(`unknown driver ${start.driver}`);
      const outcome = await driver.run(ctx);
      emit({ t: "done", status: outcome.status, result: outcome.result, confidence: outcome.confidence ?? null });
    } catch (error) {
      emit({ t: "done", status: "failed", result: errorText(error) });
    }
  } else {
    const ctx = {
      ...baseContext(start.sessionId, "", start.workspaceDir, start.settings, start.bot),
      history: start.history,
      turns: turns(),
      endTurn(turnId: string, status: "succeeded" | "failed", reply: string) {
        if (currentTurn === turnId) currentTurn = null;
        emit({ t: "turn_done", turnId, status, reply });
      },
    };
    try {
      if (!driver) throw new DriverUnavailableError(`unknown driver ${start.driver}`);
      await driver.session(ctx);
    } catch (error) {
      // The session cannot continue: fail the open turn and any queued ones.
      for (const turnId of [currentTurn, ...turnQueue.map((t) => t.turnId)]) {
        if (turnId) emit({ t: "turn_done", turnId, status: "failed", reply: errorText(error) });
      }
    }
  }
  // Let stdout drain before exiting so the final line is not lost.
  process.stdout.write("", () => process.exit(0));
}
