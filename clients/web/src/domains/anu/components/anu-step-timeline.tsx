/**
 * The run, step by step, as it happened, on one rail. The agent speaks its
 * own steps: a plan, a finding, a note and the result carry ANU's Frostling,
 * and the newest of them acts out where the run stands (thinking while it
 * works, swaying while it waits on the person, a hop when it succeeds). Tool
 * calls, browser moves and questions keep a plain outline glyph. Each row
 * shows its own detail and its offset from the start at the end edge.
 */

import {
  Eye,
  Flag,
  Globe,
  Hand,
  ListChecks,
  MessageSquareText,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { type ReactNode } from "react";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";

import type {
  AnuApproval,
  AnuStep,
  AnuStepKind,
  AnuTaskDetail,
} from "../anu-api";
import {
  elapsedMs,
  planItems,
  stepDetailLine,
  stepTone,
  type AnuStatusTone,
} from "../anu-task-model";
import { useAnuFormat } from "../use-anu-format";
import { AnuAvatar } from "./anu-avatar";

const KIND_ICON: Record<AnuStepKind, LucideIcon> = {
  plan: ListChecks,
  tool: Wrench,
  observation: Eye,
  message: MessageSquareText,
  approval_request: Hand,
  result: Flag,
  browser: Globe,
};

/** Steps the agent says in its own voice, which carry its avatar. */
const SPOKEN_KINDS = new Set<AnuStepKind>(["plan", "observation", "message", "result"]);

const KIND_LABEL_KEY = {
  plan: "anuStepRow.kindPlan",
  tool: "anuStepRow.kindTool",
  observation: "anuStepRow.kindObservation",
  message: "anuStepRow.kindMessage",
  approval_request: "anuStepRow.kindApproval",
  result: "anuStepRow.kindResult",
  browser: "anuStepRow.kindBrowser",
} as const;

const APPROVAL_OUTCOME_KEY = {
  pending: "anuStepRow.awaitingAnswer",
  approved: "anuApprovalCard.approved",
  rejected: "anuApprovalCard.rejected",
  expired: "anuApprovalCard.expired",
} as const;

const TONE_INK: Record<AnuStatusTone, string> = {
  live: "text-[var(--system-info-strong)]",
  attention: "text-[var(--system-mid-strong)]",
  positive: "text-[var(--system-positive-strong)]",
  negative: "text-[var(--system-negative-strong)]",
  neutral: "text-[var(--content-tertiary)]",
};

interface AnuStepTimelineProps {
  task: AnuTaskDetail;
  steps: readonly AnuStep[];
  /** The close of the run (its result), drawn as the rail's last row. */
  children?: ReactNode;
}

function StepDetail({ step }: { step: AnuStep }) {
  const { t } = useTranslation("anu");
  if (step.kind === "plan") {
    const items = planItems([step]);
    if (items.length === 0) {
      return null;
    }
    return (
      <ol className="mt-2 list-decimal space-y-1 ps-5 text-body-medium-lighter text-[var(--content-default)] [--text-body-medium-lighter-line-height:20px] marker:text-[var(--content-tertiary)] marker:tabular-nums">
        {items.map((item, index) => (
          <li key={`${index}-${item}`} dir="auto">{item}</li>
        ))}
      </ol>
    );
  }
  const line = stepDetailLine(step);
  if (!line) {
    return null;
  }
  if (line.kind === "command" || line.kind === "file" || line.kind === "link") {
    return (
      <p dir="ltr"
        className="mt-1 min-w-0 truncate text-start font-mono text-[13px] leading-5 text-[var(--content-secondary)]">
        {line.value}
      </p>
    );
  }
  if (line.kind === "query") {
    return (
      <p className="mt-1 text-[13px] leading-5 text-[var(--content-secondary)]">
        {t("anuStepRow.query", { query: line.value })}
      </p>
    );
  }
  if (line.kind === "count") {
    return (
      <p className="mt-1 text-[13px] leading-5 tabular-nums text-[var(--content-secondary)]">
        {t("anuStepRow.envCount", { count: Number(line.value) })}
      </p>
    );
  }
  return (
    <p className="mt-1 line-clamp-3 text-[13px] leading-5 text-[var(--content-secondary)]">
      {line.value}
    </p>
  );
}

function RailRow({
  icon: Icon,
  avatar,
  tone,
  last,
  children,
  aside,
}: {
  icon: LucideIcon | null;
  avatar?: ReactNode;
  tone: AnuStatusTone;
  last: boolean;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <li className="relative grid grid-cols-[28px_minmax(0,1fr)_auto] gap-x-3 pb-6 last:pb-0">
      {last ? null : (
        <span
          aria-hidden
          className="absolute bottom-1 start-[13.5px] top-8 w-px bg-[var(--border-base)]"
        />
      )}
      <span className={cn("flex h-7 items-center justify-center", TONE_INK[tone])}>
        {avatar ? (
          avatar
        ) : Icon ? (
          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
        ) : (
          <span className="size-2 rounded-full bg-current" aria-hidden />
        )}
      </span>
      <div className="min-w-0">{children}</div>
      {aside ? (
        <div className="pt-1.5 text-[13px] leading-4 tabular-nums text-[var(--content-tertiary)]">
          {aside}
        </div>
      ) : (
        <span />
      )}
    </li>
  );
}

export function AnuStepTimeline({
  task,
  steps: allSteps,
  children,
}: AnuStepTimelineProps) {
  // The closing result row stands in for the run's own `result` step.
  const steps = children
    ? allSteps.filter((step) => step.kind !== "result")
    : allSteps;
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const runStart = task.startedAt ?? steps[0]?.createdAt ?? task.createdAt;
  const approvalsByStep = new Map<string, AnuApproval>();
  for (const approval of task.approvals) {
    if (approval.stepId) {
      approvalsByStep.set(approval.stepId, approval);
    }
  }
  const working =
    (task.status === "running" || task.status === "queued") &&
    !steps.some((step) => step.status === "running");

  // Only the newest speaker acts the run's state; a closing result row or
  // the live "working" row is newer than any step.
  const lastSpokenSeq =
    children || working
      ? undefined
      : [...steps].reverse().find((step) => SPOKEN_KINDS.has(step.kind))?.seq;

  if (steps.length === 0 && !working) {
    return (
      <p className="text-body-medium-lighter text-[var(--content-secondary)]">
        {t("anuTaskDetail.noSteps")}
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const tone = stepTone(step, task.status);
        const approval = approvalsByStep.get(step.id);
        const offset = elapsedMs(runStart, step.createdAt);
        const isLast = index === steps.length - 1 && !working && !children;
        return (
          <RailRow
            key={step.id}
            icon={KIND_ICON[step.kind]}
            avatar={
              SPOKEN_KINDS.has(step.kind) ? (
                <AnuAvatar
                  status={step.seq === lastSpokenSeq ? task.status : "stopped"}
                  size={26}
                />
              ) : undefined
            }
            tone={tone}
            last={isLast}
            aside={offset === null ? null : format.offset(offset)}
          >
            <p className="flex min-w-0 items-baseline gap-2">
              <span className="sr-only">{t(KIND_LABEL_KEY[step.kind])}</span>
              <span dir="auto" className="min-w-0 pt-0.5 text-[16px] font-medium leading-6 text-[var(--content-emphasised)]">
                {step.title}
              </span>
              {step.status === "running" && tone === "live" ? (
                <span className="shrink-0 text-[12px] leading-4 text-[var(--system-info-strong)]">
                  {t("anuStepRow.running")}
                </span>
              ) : null}
              {step.status === "failed" ? (
                <span className="shrink-0 text-[12px] leading-4 text-[var(--system-negative-strong)]">
                  {t("anuStepRow.failed")}
                </span>
              ) : null}
            </p>
            <StepDetail step={step} />
            {approval ? (
              <p
                className={cn(
                  "mt-1 text-[13px] leading-5",
                  approval.status === "pending"
                    ? "text-[var(--content-emphasised)]"
                    : "text-[var(--content-secondary)]",
                )}
              >
                {t(APPROVAL_OUTCOME_KEY[approval.status])}
              </p>
            ) : null}
          </RailRow>
        );
      })}
      {children ? (
        <RailRow
          icon={null}
          avatar={<AnuAvatar status={task.status} size={26} />}
          tone="neutral"
          last
        >
          {children}
        </RailRow>
      ) : null}
      {working ? (
        <RailRow icon={null} avatar={<AnuAvatar status={task.status} size={26} />} tone="live" last>
          <p className="text-body-medium-lighter text-[var(--system-info-strong)] [--text-body-medium-lighter-line-height:20px]">
            {task.status === "queued"
              ? t("anuTaskDetail.waitingToStart")
              : t("anuTaskDetail.working")}
          </p>
        </RailRow>
      ) : null}
    </ol>
  );
}
