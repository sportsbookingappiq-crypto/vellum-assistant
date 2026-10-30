import type { StepKind, StepStatus } from "../api/model.js";
import type { DriverName } from "../config.js";

/** Settings a driver may receive. Sent over stdin, never through the environment. */
export interface DriverSettings {
  kiloBaseUrl: string;
  kiloApiKey: string;
  kiloModel: string;
  assistantDir: string;
  scriptedStepDelayMs: number;
  allowInsecureHarness: boolean;
}

export type ParentMessage =
  | {
      t: "start";
      taskId: string;
      goal: string;
      driver: DriverName;
      workspaceDir: string;
      settings: DriverSettings;
    }
  | {
      t: "session";
      sessionId: string;
      driver: DriverName;
      workspaceDir: string;
      settings: DriverSettings;
      /** Earlier messages, oldest first, so a restarted worker keeps the conversation. */
      history: ChatTurn[];
    }
  | { t: "turn"; turnId: string; text: string }
  | { t: "decision"; ref: string; decision: "approved" | "rejected" };

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export type WorkerMessage =
  | { t: "step"; kind: StepKind; title: string; detail?: unknown; status?: StepStatus }
  | { t: "approval"; ref: string; prompt: string; detail?: unknown }
  | { t: "done"; status: "succeeded" | "failed"; result: string; confidence?: number | null }
  | { t: "turn_done"; turnId: string; status: "succeeded" | "failed"; reply: string };

/** Worker output lines carry this prefix. Other stdout lines are treated as logs. */
export const LINE_PREFIX = "@@anu ";
