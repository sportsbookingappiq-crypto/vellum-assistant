/**
 * Follows a task's live event stream while it is open on screen and folds
 * every event into the ANU query cache: a `step` merges into the task's
 * steps, a `task` replaces the task and its approvals, and `end` refreshes
 * the list. The cache stays the one owner of the data; this hook only feeds
 * it, so a refetch and the stream can never disagree for long.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { isAnuTaskFinal, isAnuUnauthorized, type AnuStep } from "./anu-api";
import { anuQueryKeys } from "./anu-query-client";
import { useAnuSessionStore } from "./anu-session-store";
import { streamAnuTaskEvents } from "./anu-sse";
import { mergeSteps } from "./anu-task-model";
import { useAnuTask, writeTaskToCache } from "./use-anu-queries";

export type AnuStreamState = "idle" | "live" | "reconnecting" | "lost";

export function useAnuTaskStream(taskId: string | undefined): AnuStreamState {
  const queryClient = useQueryClient();
  const token = useAnuSessionStore.use.token();
  const task = useAnuTask(taskId);
  const status = task.data?.status;
  const final = status === undefined ? true : isAnuTaskFinal(status);
  const [state, setState] = useState<AnuStreamState>("idle");

  useEffect(() => {
    if (!taskId || !token || final) {
      setState("idle");
      return;
    }
    const controller = new AbortController();
    const steps = queryClient.getQueryData<AnuStep[]>(anuQueryKeys.steps(taskId));
    const after = steps?.at(-1)?.seq ?? 0;
    setState("live");
    void streamAnuTaskEvents({
      taskId,
      token,
      after,
      signal: controller.signal,
      onConnectionChange: (connected) =>
        setState(connected ? "live" : "reconnecting"),
      onEvent: (event) => {
        if (event.type === "step") {
          queryClient.setQueryData<AnuStep[]>(
            anuQueryKeys.steps(taskId),
            (current) => mergeSteps(current, [event.step]),
          );
          if (event.step.kind === "browser") {
            void queryClient.invalidateQueries({
              queryKey: anuQueryKeys.browser({ kind: "tasks", id: taskId }),
            });
          }
        } else if (event.type === "task") {
          writeTaskToCache(queryClient, event.task);
        } else if (event.type === "end") {
          void queryClient.invalidateQueries({ queryKey: anuQueryKeys.tasks() });
          if (event.deleted) {
            queryClient.removeQueries({ queryKey: anuQueryKeys.task(taskId) });
          }
        }
      },
    })
      .then(() => {
        if (!controller.signal.aborted) {
          setState("idle");
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (isAnuUnauthorized(error)) {
          void useAnuSessionStore.getState().expire();
          return;
        }
        setState("lost");
      });
    return () => controller.abort();
  }, [queryClient, taskId, token, final]);

  return state;
}
