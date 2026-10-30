export const TASK_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "stopped",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TERMINAL_STATUSES: readonly TaskStatus[] = ["succeeded", "failed", "stopped"];
export const isTerminal = (status: string) => (TERMINAL_STATUSES as readonly string[]).includes(status);

export const STEP_KINDS = ["plan", "tool", "observation", "message", "approval_request", "result", "browser"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_STATUSES = ["pending", "running", "done", "failed"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface TaskRow {
  id: string;
  user_id: string;
  goal: string;
  status: TaskStatus;
  driver: string | null;
  result: string | null;
  confidence: number | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface StepRow {
  id: string;
  task_id: string;
  seq: number;
  kind: StepKind;
  title: string;
  detail: unknown;
  status: StepStatus;
  created_at: Date;
}

export interface ApprovalRow {
  id: string;
  task_id: string | null;
  session_id: string | null;
  step_id: string | null;
  prompt: string;
  detail: unknown;
  status: "pending" | "approved" | "rejected" | "expired";
  created_at: Date;
  decided_at: Date | null;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function taskView(row: TaskRow) {
  return {
    id: row.id,
    goal: row.goal,
    status: row.status,
    result: row.result,
    confidence: row.confidence,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
}
export type TaskView = ReturnType<typeof taskView>;

export function stepView(row: StepRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    seq: row.seq,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    status: row.status,
    createdAt: iso(row.created_at),
  };
}
export type StepView = ReturnType<typeof stepView>;

export function approvalView(row: ApprovalRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id ?? null,
    stepId: row.step_id,
    prompt: row.prompt,
    detail: row.detail,
    status: row.status,
    createdAt: iso(row.created_at),
    decidedAt: iso(row.decided_at),
  };
}
export type ApprovalView = ReturnType<typeof approvalView>;

export const SESSION_STATUSES = ["idle", "working", "waiting_for_you", "failed"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
export const ITEM_KINDS = [
  "user_message",
  "assistant_message",
  "plan",
  "tool",
  "observation",
  "message",
  "browser",
  "approval_request",
  "turn_complete",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export interface ChatSessionRow {
  id: string;
  user_id: string;
  title: string;
  status: SessionStatus;
  driver: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface SessionItemRow {
  id: string;
  session_id: string;
  user_id: string;
  seq: number;
  kind: ItemKind;
  title: string;
  text: string | null;
  detail: unknown;
  status: StepStatus;
  turn_id: string | null;
  created_at: Date;
}

export interface AgentRow {
  id: string;
  name: string;
  body_shape: string;
  eye_style: string;
  color: string;
}

export function agentView(row: AgentRow | undefined) {
  if (!row) return null;
  return { id: row.id, name: row.name, avatar: { bodyShape: row.body_shape, eyeStyle: row.eye_style, color: row.color } };
}

export function sessionView(row: ChatSessionRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function itemView(row: SessionItemRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    kind: row.kind,
    title: row.title,
    text: row.text,
    detail: row.detail,
    status: row.status,
    turnId: row.turn_id,
    createdAt: iso(row.created_at),
  };
}
