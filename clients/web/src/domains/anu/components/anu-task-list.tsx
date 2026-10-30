/**
 * The Tasks list (spec A.3.10): filter chips (All, Running, Waiting, Done)
 * over two-line rows, the task's title, then its agent's face, one status
 * pill and how long it ran. Tasks stay separate from chats; this list is
 * the only way into them.
 */

import { useState } from "react";
import { Link } from "react-router";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";
import { routes } from "@/utils/routes";

import { isAnuTaskFinal, type AnuTask } from "../anu-api";
import { ANU_STATUS_LABEL_KEY } from "../anu-status-labels";
import { taskGroup } from "../anu-task-model";
import { useAnuFormat } from "../use-anu-format";
import { useAnuAgents, useAnuTasks } from "../use-anu-queries";
import { AnuAvatar } from "./anu-avatar";
import { AnuEmptyBlock, AnuErrorBlock, AnuPill, AnuSkeletonRows, type AnuPillTone } from "./anu-ui";

type Filter = "all" | "running" | "waiting" | "done";

function matches(task: AnuTask, filter: Filter): boolean {
  const group = taskGroup(task.status);
  switch (filter) {
    case "running":
      return group === "working";
    case "waiting":
      return group === "needsYou";
    case "done":
      return group === "finished";
    default:
      return true;
  }
}

function tone(task: AnuTask): AnuPillTone {
  if (task.status === "awaiting_approval") {
    return "waiting";
  }
  if (task.status === "running" || task.status === "queued") {
    return "working";
  }
  if (task.status === "failed") {
    return "failed";
  }
  return "neutral";
}

interface AnuTaskListProps {
  selectedTaskId: string | undefined;
  className?: string;
}

export function AnuTaskList({ selectedTaskId, className }: AnuTaskListProps) {
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const tasks = useAnuTasks();
  const agents = useAnuAgents();
  const [filter, setFilter] = useState<Filter>("all");
  const filters: Array<{ key: Filter; label: string }> = [
    { key: "all", label: t("anuTasks.all") },
    { key: "running", label: t("anuTasks.running") },
    { key: "waiting", label: t("anuTasks.waiting") },
    { key: "done", label: t("anuTasks.done") },
  ];
  const shown = (tasks.data ?? []).filter((task) => matches(task, filter));
  const agentOf = (taskId: string) => agents.data?.find((agent) => agent.taskId === taskId);

  return (
    <div className={cn("flex flex-col", className)}>
      <div role="group" aria-label={t("anuTasks.filter")} className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
        {filters.map((entry) => (
          <button
            key={entry.key}
            type="button"
            aria-pressed={filter === entry.key}
            onClick={() => setFilter(entry.key)}
            className={cn(
              "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[15px]",
              filter === entry.key ? "bg-[var(--anu-primary)] text-[var(--anu-primary-ink)]" : "bg-[var(--anu-surface)]",
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>
      {tasks.isPending ? (
        <AnuSkeletonRows count={5} avatar={0} height={64} label={t("anuCommon.loading")} />
      ) : tasks.isError ? (
        <AnuErrorBlock message={t("anuTasks.loadError")} onRetry={() => void tasks.refetch()} />
      ) : shown.length === 0 ? (
        <AnuEmptyBlock message={t("anuTasks.empty")} />
      ) : (
        <ul>
          {shown.map((task) => {
            const agent = agentOf(task.id);
            const end = task.finishedAt ?? (isAnuTaskFinal(task.status) ? task.updatedAt : new Date().toISOString());
            const startedAt = task.startedAt ?? task.createdAt;
            return (
              <li key={task.id}>
                <Link
                  to={routes.anu.task(task.id)}
                  aria-current={task.id === selectedTaskId ? "page" : undefined}
                  className="flex min-h-16 flex-col justify-center gap-1 py-2.5"
                >
                  <span dir="auto" className="line-clamp-2 text-[15px] leading-6">
                    {task.goal}
                  </span>
                  <span className="flex items-center gap-2">
                    <AnuAvatar
                      face={
                        task.status === "running"
                          ? "thinking"
                          : task.status === "awaiting_approval"
                            ? "waiting"
                            : task.status === "failed"
                              ? "failed"
                              : "rest"
                      }
                      traits={agent?.avatar}
                      size={24}
                    />
                    <AnuPill tone={tone(task)}>{t(ANU_STATUS_LABEL_KEY[task.status])}</AnuPill>
                    <span className="text-[13px] tabular-nums text-[var(--anu-muted)]">
                      {format.duration(Math.max(0, Date.parse(end) - Date.parse(startedAt)))}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
