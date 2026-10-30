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
  task_id: string;
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
    stepId: row.step_id,
    prompt: row.prompt,
    detail: row.detail,
    status: row.status,
    createdAt: iso(row.created_at),
    decidedAt: iso(row.decided_at),
  };
}
export type ApprovalView = ReturnType<typeof approvalView>;
