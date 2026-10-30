/**
 * Pure derivations over ANU tasks and steps: what the screens show, computed
 * from the server's objects so every figure on screen has one source.
 */

import type {
  AnuApproval,
  AnuStep,
  AnuTask,
  AnuTaskDetail,
  AnuTaskStatus,
} from "./anu-api";

/** The four meanings a status colour may carry on the ANU screens. */
export type AnuStatusTone = "live" | "attention" | "positive" | "negative" | "neutral";

export function statusTone(status: AnuTaskStatus): AnuStatusTone {
  switch (status) {
    case "running":
      return "live";
    case "awaiting_approval":
      return "attention";
    case "succeeded":
      return "positive";
    case "failed":
      return "negative";
    case "queued":
    case "stopped":
      return "neutral";
  }
}

/** The glyph that pairs with a task status, so state reads without colour. */
export function statusShape(
  status: AnuTaskStatus,
): "ring" | "dot" | "diamond" | "check" | "cross" | "square" {
  switch (status) {
    case "queued":
      return "ring";
    case "running":
      return "dot";
    case "awaiting_approval":
      return "diamond";
    case "succeeded":
      return "check";
    case "failed":
      return "cross";
    case "stopped":
      return "square";
  }
}

/**
 * A step's tone. Finished steps stay neutral: colour is kept for the step
 * that is live, the question that waits, and the step that failed.
 */
export function stepTone(step: AnuStep, taskStatus: AnuTaskStatus): AnuStatusTone {
  if (step.status === "failed") {
    return "negative";
  }
  if (step.kind === "approval_request" && step.status !== "done") {
    return taskStatus === "awaiting_approval" ? "attention" : "neutral";
  }
  if (step.status === "running" || step.status === "pending") {
    return isFinalStatus(taskStatus) ? "neutral" : "live";
  }
  if (step.kind === "result") {
    return taskStatus === "succeeded" ? "positive" : "neutral";
  }
  return "neutral";
}

function isFinalStatus(status: AnuTaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "stopped";
}

/** The list's groups, in the order a person needs them. */
export type AnuTaskGroup = "needsYou" | "working" | "finished";

export function taskGroup(status: AnuTaskStatus): AnuTaskGroup {
  if (status === "awaiting_approval") {
    return "needsYou";
  }
  if (status === "queued" || status === "running") {
    return "working";
  }
  return "finished";
}

export function groupTasks(
  tasks: readonly AnuTask[],
): Record<AnuTaskGroup, AnuTask[]> {
  const groups: Record<AnuTaskGroup, AnuTask[]> = {
    needsYou: [],
    working: [],
    finished: [],
  };
  for (const task of tasks) {
    groups[taskGroup(task.status)].push(task);
  }
  return groups;
}

export function pendingApproval(
  task: Pick<AnuTaskDetail, "approvals"> | undefined,
): AnuApproval | undefined {
  return task?.approvals.find((approval) => approval.status === "pending");
}

/** Inserts or replaces steps by `seq`, keeping them in order. */
export function mergeSteps(
  current: readonly AnuStep[] | undefined,
  incoming: readonly AnuStep[],
): AnuStep[] {
  const bySeq = new Map<number, AnuStep>();
  for (const step of current ?? []) {
    bySeq.set(step.seq, step);
  }
  for (const step of incoming) {
    bySeq.set(step.seq, step);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function record(detail: unknown): Record<string, unknown> {
  return typeof detail === "object" && detail !== null && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The plan's items, from the first `plan` step. */
export function planItems(steps: readonly AnuStep[]): string[] {
  const plan = steps.find((step) => step.kind === "plan");
  const items = record(plan?.detail).steps;
  return Array.isArray(items)
    ? items.filter((item): item is string => typeof item === "string")
    : [];
}

/** The one line of detail a timeline row shows under its title. */
export interface StepDetailLine {
  kind: "command" | "query" | "file" | "link" | "finding" | "count";
  value: string;
}

export function stepDetailLine(step: AnuStep): StepDetailLine | undefined {
  const detail = record(step.detail);
  const command = text(detail.command);
  if (command) {
    return { kind: "command", value: command };
  }
  const query = text(detail.query);
  if (query) {
    return { kind: "query", value: query };
  }
  const url = text(detail.url);
  if (url) {
    return { kind: "link", value: url };
  }
  const action = text(detail.action);
  if (action) {
    return { kind: "finding", value: action };
  }
  const file = text(detail.file);
  if (file) {
    return { kind: "file", value: file };
  }
  const finding = text(detail.finding);
  if (finding) {
    return { kind: "finding", value: finding };
  }
  if (Array.isArray(detail.envNames)) {
    return { kind: "count", value: String(detail.envNames.length) };
  }
  return undefined;
}

/** Something the run read, ran or wrote, which the result rests on. */
export interface AnuSource {
  kind: "command" | "query" | "file" | "link";
  value: string;
  /** The step it came from. */
  seq: number;
}

export function deriveSources(steps: readonly AnuStep[]): AnuSource[] {
  const seen = new Set<string>();
  const sources: AnuSource[] = [];
  const add = (source: AnuSource) => {
    const key = `${source.kind}:${source.value}`;
    if (!seen.has(key)) {
      seen.add(key);
      sources.push(source);
    }
  };
  for (const step of steps) {
    const detail = record(step.detail);
    if (Array.isArray(detail.sources)) {
      for (const entry of detail.sources) {
        const value = text(entry) ?? text(record(entry).url);
        if (value) {
          add({ kind: "link", value, seq: step.seq });
        }
      }
    }
    if (step.kind !== "tool" && step.kind !== "browser") {
      continue;
    }
    const line = stepDetailLine(step);
    if (
      line &&
      (line.kind === "command" ||
        line.kind === "query" ||
        line.kind === "file" ||
        line.kind === "link")
    ) {
      add({ kind: line.kind, value: line.value, seq: step.seq });
    }
  }
  return sources;
}

/** The final answer: the `result` step's detail, or the task's own fields. */
export function taskResult(
  task: Pick<AnuTask, "result" | "confidence">,
  steps: readonly AnuStep[],
): { text: string; confidence: number | null } | undefined {
  const resultStep = [...steps].reverse().find((step) => step.kind === "result");
  const detail = record(resultStep?.detail);
  const resultText = text(task.result) ?? text(detail.result);
  if (!resultText) {
    return undefined;
  }
  const stepConfidence =
    typeof detail.confidence === "number" ? detail.confidence : null;
  return {
    text: resultText,
    confidence: task.confidence ?? stepConfidence,
  };
}

/** Milliseconds between two ISO timestamps, or `null` if either is missing. */
export function elapsedMs(
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  if (!from || !to) {
    return null;
  }
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }
  return Math.max(0, end - start);
}

/** The step a running task is on: the newest one that is not done. */
export function activeStep(steps: readonly AnuStep[]): AnuStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step && (step.status === "running" || step.status === "pending")) {
      return step;
    }
  }
  return undefined;
}

/**
 * Normalises what a person typed into the E.164 form the API expects: the
 * digits with a leading `+`. Spaces, dashes, dots and brackets are dropped.
 */
/** Arabic-Indic and Eastern Arabic-Indic digits read as 0 to 9. */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export function normalizePhone(input: string): string {
  const digits = toLatinDigits(input).replace(/[^\d]/g, "");
  return digits ? `+${digits}` : "";
}

/** A display form of an E.164 number for the regions the dev seed uses. */
export function formatPhone(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (match) {
    return `+1 ${match[1]} ${match[2]} ${match[3]}`;
  }
  return e164;
}
