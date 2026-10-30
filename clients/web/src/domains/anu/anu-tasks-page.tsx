/**
 * `/anu/tasks` and `/anu/tasks/:taskId` (spec A.3.10). Tasks are kept apart
 * from chats: the list, and each task's own step timeline, the one place a
 * timeline is the main content. Browser and Files open from a task as
 * full-screen windows over it (child routes), so closing them returns here.
 */

import { Outlet, useParams } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import { AnuTaskDetail } from "./components/anu-task-detail";
import { AnuTaskList } from "./components/anu-task-list";
import { AnuScreen } from "./components/anu-ui";

export function AnuTasksPage() {
  const { t } = useTranslation("anu");
  const { taskId } = useParams();

  if (taskId) {
    return (
      <AnuScreen title={t("anuTasks.taskTitle")} fallback={routes.anu.tasks} hideTitle>
        <AnuTaskDetail taskId={taskId} />
        <Outlet />
      </AnuScreen>
    );
  }
  return (
    <AnuScreen title={t("anuTasks.title")} fallback={routes.anu.root}>
      <AnuTaskList selectedTaskId={undefined} />
    </AnuScreen>
  );
}
