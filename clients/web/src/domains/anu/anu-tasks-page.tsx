/**
 * `/anu` and `/anu/tasks/:taskId`. On a wide window the list and the open
 * task sit side by side on the same ground, one page in two columns; with no task in the URL the sheet shows the one that most needs
 * attention, so the far half is never empty. Below 1024px one region shows
 * at a time: the list, or the task with a link back to it.
 */

import { ChevronLeft } from "lucide-react";
import { Link, useParams } from "react-router";

import { useMediaQuery } from "@/hooks/use-media-query";
import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import { groupTasks } from "./anu-task-model";
import { AnuShell } from "./components/anu-shell";
import { AnuTaskDetail } from "./components/anu-task-detail";
import { AnuTaskList } from "./components/anu-task-list";
import { useAnuTasks } from "./use-anu-queries";

export const ANU_TWO_PANE_QUERY = "(min-width: 1024px)";

function usePreviewTaskId(): string | undefined {
  const tasks = useAnuTasks();
  const groups = groupTasks(tasks.data ?? []);
  return (groups.needsYou[0] ?? groups.working[0] ?? groups.finished[0])?.id;
}

export function AnuTasksPage() {
  const { t } = useTranslation("anu");
  const { taskId } = useParams();
  const twoPane = useMediaQuery(ANU_TWO_PANE_QUERY);
  const previewTaskId = usePreviewTaskId();
  const shownTaskId = taskId ?? (twoPane ? previewTaskId : undefined);

  if (!twoPane) {
    return (
      <AnuShell>
        <main className="w-full px-5 pb-10 pt-4">
          {taskId ? (
            <AnuTaskDetail
              taskId={taskId}
              leading={
                <Link
                  to={routes.anu.root}
                  className="-ms-2 flex h-11 items-center gap-0.5 rounded-full pe-3 text-[16px] font-medium text-[var(--content-default)] outline-none keyboard-focus:ring-2 keyboard-focus:ring-[var(--ring)]"
                >
                  <ChevronLeft aria-hidden className="size-6 rtl:-scale-x-100" strokeWidth={1.75} />
                  {t("anuShell.back")}
                </Link>
              }
            />
          ) : (
            <AnuTaskList selectedTaskId={undefined} />
          )}
        </main>
      </AnuShell>
    );
  }

  return (
    <AnuShell>
      <div className="w-[420px] shrink-0 overflow-y-auto px-7 pb-10 pt-10">
        <AnuTaskList selectedTaskId={shownTaskId} />
      </div>
      <main className="min-w-0 flex-1 overflow-y-auto px-12 pb-12 pt-6">
        <div className="mx-auto max-w-[720px]">
        {shownTaskId ? (
          <AnuTaskDetail key={shownTaskId} taskId={shownTaskId} titleAs="h2" />
        ) : (
          <p className="pt-16 text-body-large-lighter text-[var(--content-secondary)]">
            {t("anuTaskDetail.chooseTask")}
          </p>
        )}
        </div>
      </main>
    </AnuShell>
  );
}
