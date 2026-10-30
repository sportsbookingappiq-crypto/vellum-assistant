/**
 * One task, answering "what is it doing, and does it need me?" in a single
 * flow: the goal as the title, one line on where the run stands, the question
 * it is holding for, then the run itself, with the result closing the rail.
 * Files and the browser open full screen: from the folder icon in the header,
 * or from the chip on the step that touched them. While the task is live, its event stream
 * feeds the cache this reads.
 */

import { Button, Skeleton } from "@anu/design-library";
import { FolderOpen } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { MidlineDot } from "@/components/midline-dot";
import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";
import { routes } from "@/utils/routes";

import { AnuApiError, isAnuTaskFinal } from "../anu-api";
import {
  elapsedMs,
  pendingApproval,
  statusShape,
  statusTone,
} from "../anu-task-model";
import { useAnuFormat } from "../use-anu-format";
import { useAnuSteps, useAnuTask, useStopAnuTask } from "../use-anu-queries";
import { useAnuTaskStream } from "../use-anu-task-stream";
import { AnuApprovalCard } from "./anu-approval-card";
import { AnuResultCard } from "./anu-result-card";
import { AnuStatusMark } from "./anu-status-mark";
import { AnuStepTimeline } from "./anu-step-timeline";
import { ANU_STATUS_LABEL_KEY } from "../anu-status-labels";

/** The current time, ticking once a second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

interface AnuTaskDetailProps {
  taskId: string;
  /** Rendered in the header row, before the status (the phone's back link). */
  leading?: ReactNode;
  /** `h2` where the screen already has its `h1` (the list in two panes). */
  titleAs?: "h1" | "h2";
  className?: string;
}

export function AnuTaskDetail({
  taskId,
  leading,
  titleAs: Title = "h1",
  className,
}: AnuTaskDetailProps) {
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const taskQuery = useAnuTask(taskId);
  const stepsQuery = useAnuSteps(taskId);
  const stream = useAnuTaskStream(taskId);
  const stop = useStopAnuTask();
  const task = taskQuery.data;
  const live = task ? !isAnuTaskFinal(task.status) : false;
  const now = useNow(live);

  if (taskQuery.isError) {
    const notFound =
      taskQuery.error instanceof AnuApiError && taskQuery.error.status === 404;
    return (
      <div className={cn("flex flex-col gap-4", className)}>
        {leading ? <div className="flex h-10 items-center">{leading}</div> : null}
        <p className="text-body-large-lighter text-[var(--content-default)]">
          {notFound ? t("anuTaskDetail.notFound") : t("anuTaskDetail.loadError")}
        </p>
        {notFound ? null : (
          <div>
            <Button variant="outlined" onClick={() => void taskQuery.refetch()}>
              {t("anuTaskDetail.retry")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!task) {
    return (
      <div className={cn("flex flex-col gap-4", className)} aria-busy>
        {leading ? <div className="flex h-10 items-center">{leading}</div> : null}
        <Skeleton className="h-6 w-3/4 rounded" />
        <Skeleton className="h-4 w-1/3 rounded" />
        <Skeleton className="mt-6 h-32 w-full rounded-lg" />
      </div>
    );
  }

  const steps = stepsQuery.data ?? [];
  const approval = pendingApproval(task);
  const nowIso = new Date(now).toISOString();
  const finding = (() => {
    switch (task.status) {
      case "queued":
        return t("anuTaskDetail.findingQueued", {
          time: format.relative(task.createdAt),
        });
      case "running":
        return t("anuTaskDetail.findingRunning", {
          duration: format.duration(
            elapsedMs(task.startedAt ?? task.createdAt, nowIso) ?? 0,
          ),
        });
      case "awaiting_approval":
        return t("anuTaskDetail.findingWaiting", {
          time: format.relative(approval?.createdAt ?? task.updatedAt),
        });
      case "succeeded":
      case "failed":
      case "stopped": {
        const took = elapsedMs(task.startedAt, task.finishedAt);
        if (took === null) {
          return task.finishedAt
            ? t("anuTaskDetail.findingFinishedAt", {
                time: format.relative(task.finishedAt),
              })
            : null;
        }
        const key =
          task.status === "succeeded"
            ? "anuTaskDetail.findingDone"
            : task.status === "failed"
              ? "anuTaskDetail.findingFailed"
              : "anuTaskDetail.findingStopped";
        return t(key, { duration: format.duration(took) });
      }
    }
  })();

  const final = isAnuTaskFinal(task.status);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex min-h-11 items-center gap-3">
        {leading}
        <span className="flex-1" />
        <Button
          asChild
          variant="ghost"
          shape="pill"
          iconOnly={<FolderOpen size={20} strokeWidth={1.75} />}
          aria-label={t("anuFiles.title")}
        >
          <Link to={routes.anu.files("tasks", task.id)} />
        </Button>
        {live ? (
          <Button
            variant="outlined"
            shape="pill"
            loading={stop.isPending}
            onClick={() => stop.mutate(task.id)}
          >
            {t("anuTaskDetail.stop")}
          </Button>
        ) : null}
      </div>

      <Title dir="auto" className="mt-3 line-clamp-4 text-[22px] leading-7 anu-strong text-[var(--anu-ink)]">
        {task.goal}
      </Title>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] tabular-nums text-[var(--content-secondary)]">
        <span className="flex items-center gap-1.5 font-medium text-[var(--content-emphasised)]">
          <AnuStatusMark tone={statusTone(task.status)} shape={statusShape(task.status)} />
          {t(ANU_STATUS_LABEL_KEY[task.status])}
        </span>
        {finding ? (
          <>
            <MidlineDot />
            <span>{finding}</span>
          </>
        ) : null}
      </p>
      {stream === "reconnecting" || stream === "lost" ? (
        <p role="status" className="mt-2 flex items-center gap-2 text-[14px] text-[var(--content-secondary)]">
          {stream === "lost" ? t("anuTaskDetail.liveLost") : t("anuTaskDetail.liveReconnecting")}
          {stream === "lost" ? (
            <Button variant="link" onClick={() => window.location.reload()}>
              {t("anuTaskDetail.reload")}
            </Button>
          ) : null}
        </p>
      ) : null}
      {stop.isError ? (
        <p role="alert" className="mt-2 text-[14px] text-[var(--system-negative-strong)]">
          {t("anuTaskDetail.stopError")}
        </p>
      ) : null}

      {approval ? <AnuApprovalCard approval={approval} className="mt-7" /> : null}

      <div className="mt-9">
        {stepsQuery.isPending ? (
          <div className="flex flex-col gap-4" aria-busy>
            <Skeleton className="h-5 w-2/3 rounded" />
            <Skeleton className="h-5 w-1/2 rounded" />
          </div>
        ) : (
          <AnuStepTimeline task={task} steps={steps}>
            {final ? <AnuResultCard task={task} steps={steps} /> : null}
          </AnuStepTimeline>
        )}
      </div>
    </div>
  );
}
