/**
 * The list of goals, answering "does anything need me, and what is ANU doing
 * right now?". The questions ANU is holding come first, each answerable right
 * on the list; then the runs in progress; then what finished. It is one
 * continuous page under a large title, with groups set apart by space and a
 * small heading, never by boxes.
 */

import { Button, Skeleton } from "@anu/design-library";
import { Plus } from "lucide-react";
import { type ReactNode } from "react";
import { Link } from "react-router";

import { MidlineDot } from "@/components/midline-dot";
import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";
import { routes } from "@/utils/routes";

import type { AnuTask } from "../anu-api";
import { groupTasks, pendingApproval } from "../anu-task-model";
import { useAnuTaskDetails, useAnuTasks } from "../use-anu-queries";
import { AnuApprovalCard } from "./anu-approval-card";
import { AnuTaskRow } from "./anu-task-row";

interface AnuTaskListProps {
  selectedTaskId: string | undefined;
  className?: string;
}

function Group({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="flex items-baseline gap-2 text-[14px] font-semibold text-[var(--content-secondary)]">
        {label}
        <span className="font-normal tabular-nums text-[var(--content-tertiary)]">{count}</span>
      </h2>
      <ul className="mt-1">{children}</ul>
    </section>
  );
}

function WaitingTask({ task, selected }: { task: AnuTask; selected: boolean }) {
  const [detail] = useAnuTaskDetails([task.id]);
  const approval = pendingApproval(detail?.data);
  return (
    <AnuTaskRow
      task={task}
      selected={selected}
      footer={approval ? <AnuApprovalCard approval={approval} density="answers" /> : null}
    />
  );
}

export function AnuTaskList({ selectedTaskId, className }: AnuTaskListProps) {
  const { t } = useTranslation("anu");
  const tasks = useAnuTasks();
  const groups = groupTasks(tasks.data ?? []);
  const needsYou = groups.needsYou.length;
  const working = groups.working.length;

  return (
    <div className={cn("flex flex-col", className)}>
      <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.025em] text-[var(--content-emphasised)]">
        {t("anuTaskList.title")}
      </h1>
      <p className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5 text-[16px] tabular-nums text-[var(--content-secondary)]">
        {tasks.isPending ? null : needsYou === 0 && working === 0 ? (
          t("anuTaskList.summaryQuiet")
        ) : (
          <>
            {needsYou > 0 ? (
              <span className="font-medium text-[var(--content-emphasised)]">
                {t("anuTaskList.summaryNeedsYou", { count: needsYou })}
              </span>
            ) : null}
            {needsYou > 0 && working > 0 ? <MidlineDot /> : null}
            {working > 0 ? <span>{t("anuTaskList.summaryWorking", { count: working })}</span> : null}
          </>
        )}
      </p>

      {tasks.isError ? (
        <div className="mt-8 flex flex-col items-start gap-3">
          <p className="text-[16px] text-[var(--content-default)]">{t("anuTaskList.loadError")}</p>
          <Button variant="outlined" shape="pill" onClick={() => void tasks.refetch()}>
            {t("anuTaskList.retry")}
          </Button>
        </div>
      ) : tasks.isPending ? (
        <div className="mt-8 flex flex-col gap-5" aria-busy>
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-4/5 rounded" />
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          ))}
        </div>
      ) : (tasks.data ?? []).length === 0 ? (
        <div className="mt-10 flex flex-col items-start gap-4">
          <h2 className="text-[20px] font-semibold text-[var(--content-emphasised)]">
            {t("anuTaskList.emptyTitle")}
          </h2>
          <p className="max-w-[34ch] text-[16px] leading-6 text-[var(--content-secondary)]">
            {t("anuTaskList.emptyBody")}
          </p>
          <Button asChild variant="primary" shape="pill" size="large" leftIcon={<Plus size={18} />}>
            <Link to={routes.anu.new}>{t("anuShell.newGoal")}</Link>
          </Button>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-9">
          {needsYou > 0 ? (
            <Group id="anu-group-needs-you" label={t("anuTaskList.groupNeedsYou")} count={needsYou}>
              {groups.needsYou.map((task) => (
                <WaitingTask key={task.id} task={task} selected={task.id === selectedTaskId} />
              ))}
            </Group>
          ) : null}
          {working > 0 ? (
            <Group id="anu-group-working" label={t("anuTaskList.groupWorking")} count={working}>
              {groups.working.map((task) => (
                <AnuTaskRow key={task.id} task={task} selected={task.id === selectedTaskId} />
              ))}
            </Group>
          ) : null}
          {groups.finished.length > 0 ? (
            <Group id="anu-group-finished" label={t("anuTaskList.groupFinished")} count={groups.finished.length}>
              {groups.finished.map((task) => (
                <AnuTaskRow key={task.id} task={task} selected={task.id === selectedTaskId} />
              ))}
            </Group>
          ) : null}
        </div>
      )}
    </div>
  );
}
