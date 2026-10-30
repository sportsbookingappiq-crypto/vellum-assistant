/**
 * React Query hooks for the ANU API. Every hook reads the token from the
 * session store and is disabled until there is one; the data itself only
 * ever lives in `anuQueryClient`.
 */

import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  anuTaskSchema,
  createAnuTask,
  decideAnuApproval,
  fetchAnuBrowser,
  fetchAnuBrowserFrame,
  fetchAnuFileContent,
  fetchAnuFiles,
  fetchAnuMe,
  fetchAnuSteps,
  fetchAnuTask,
  fetchAnuTasks,
  logoutAnu,
  requestAnuCode,
  stopAnuTask,
  verifyAnuCode,
  type AnuDecision,
  type AnuTask,
  type AnuTaskDetail,
} from "./anu-api";
import { anuQueryKeys } from "./anu-query-client";
import { useAnuSessionStore } from "./anu-session-store";
import { mergeSteps } from "./anu-task-model";

function useToken(): string | null {
  return useAnuSessionStore.use.token();
}

function requireToken(): string {
  const token = useAnuSessionStore.getState().token;
  if (!token) {
    throw new Error("Not signed in to ANU");
  }
  return token;
}

/** Puts a task's newest fields into the list and its detail entry. */
export function writeTaskToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  task: AnuTask | AnuTaskDetail,
): void {
  // The list holds plain tasks; parsing drops a detail's `approvals`.
  const fields = anuTaskSchema.parse(task);
  queryClient.setQueryData<AnuTask[]>(anuQueryKeys.tasks(), (tasks) => {
    if (!tasks) {
      return tasks;
    }
    const index = tasks.findIndex((existing) => existing.id === task.id);
    if (index === -1) {
      return [fields, ...tasks];
    }
    const next = tasks.slice();
    next[index] = fields;
    return next;
  });
  queryClient.setQueryData<AnuTaskDetail>(
    anuQueryKeys.task(task.id),
    (current) => ({
      approvals: current?.approvals ?? [],
      ...current,
      ...task,
    }),
  );
}

export function useAnuMe() {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.me(),
    queryFn: ({ signal }) => fetchAnuMe({ token, signal }),
    enabled: token !== null,
    staleTime: 5 * 60_000,
  });
}

export function useAnuTasks() {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.tasks(),
    queryFn: ({ signal }) => fetchAnuTasks({ token, signal }),
    enabled: token !== null,
  });
}

export function useAnuTask(taskId: string | undefined) {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.task(taskId ?? ""),
    queryFn: ({ signal }) => fetchAnuTask(taskId ?? "", { token, signal }),
    enabled: token !== null && Boolean(taskId),
  });
}

export function useAnuSteps(taskId: string | undefined) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: anuQueryKeys.steps(taskId ?? ""),
    queryFn: async ({ signal }) => {
      const fetched = await fetchAnuSteps(taskId ?? "", { token, signal });
      // Merge rather than replace, so a refetch never drops a step the live
      // stream delivered after the request left.
      return mergeSteps(
        queryClient.getQueryData(anuQueryKeys.steps(taskId ?? "")),
        fetched,
      );
    },
    enabled: token !== null && Boolean(taskId),
  });
}

/**
 * The details (and so the pending approvals) of the given tasks. The list
 * endpoint carries no approvals, so the tasks waiting on the person are
 * fetched one by one; there are rarely more than a couple.
 */
export function useAnuTaskDetails(taskIds: readonly string[]) {
  const token = useToken();
  return useQueries({
    queries: taskIds.map((taskId) => ({
      queryKey: anuQueryKeys.task(taskId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchAnuTask(taskId, { token, signal }),
      enabled: token !== null,
    })),
  });
}

export function useAnuFiles(taskId: string, path: string) {
  const token = useToken();
  return useQuery({
    queryKey: [...anuQueryKeys.files(taskId), path],
    queryFn: ({ signal }) => fetchAnuFiles(taskId, path, { token, signal }),
    enabled: token !== null,
  });
}

export function useAnuFileContent(taskId: string, path: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: [...anuQueryKeys.files(taskId), "content", path],
    queryFn: ({ signal }) =>
      fetchAnuFileContent(taskId, path ?? "", { token, signal }),
    enabled: token !== null && path !== null,
    staleTime: 30_000,
  });
}

/** The live browser's latest frame metadata, refreshed while the run is live. */
export function useAnuBrowser(taskId: string, live: boolean) {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.browser(taskId),
    queryFn: ({ signal }) => fetchAnuBrowser(taskId, { token, signal }),
    enabled: token !== null,
    refetchInterval: live ? 2_000 : false,
  });
}

export function useAnuBrowserFrame(taskId: string, frameId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: [...anuQueryKeys.browser(taskId), "frame", frameId],
    queryFn: ({ signal }) =>
      fetchAnuBrowserFrame(taskId, frameId, { token, signal }),
    enabled: token !== null && frameId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: (previous) => previous,
  });
}

export function useRequestAnuCode() {
  return useMutation({
    mutationFn: (phone: string) => requestAnuCode(phone),
  });
}

export function useVerifyAnuCode() {
  const signIn = useAnuSessionStore.use.signIn();
  return useMutation({
    mutationFn: ({ phone, code }: { phone: string; code: string }) =>
      verifyAnuCode(phone, code),
    onSuccess: (session) =>
      signIn({ token: session.token, expiresAt: session.expiresAt }),
  });
}

export function useCreateAnuTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goal: string) => createAnuTask(goal, { token: requireToken() }),
    onSuccess: (task) => {
      writeTaskToCache(queryClient, task);
      queryClient.setQueryData(anuQueryKeys.steps(task.id), []);
    },
  });
}

export function useStopAnuTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => stopAnuTask(taskId, { token: requireToken() }),
    onSuccess: (task) => {
      writeTaskToCache(queryClient, task);
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.task(task.id) });
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.steps(task.id) });
    },
  });
}

export function useDecideAnuApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      approvalId,
      decision,
    }: {
      taskId: string;
      approvalId: string;
      decision: AnuDecision;
    }) =>
      decideAnuApproval(taskId, approvalId, decision, {
        token: requireToken(),
      }),
    onSuccess: (approval) => {
      queryClient.setQueryData<AnuTaskDetail>(
        anuQueryKeys.task(approval.taskId),
        (task) =>
          task
            ? {
                ...task,
                approvals: task.approvals.map((existing) =>
                  existing.id === approval.id ? approval : existing,
                ),
              }
            : task,
      );
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: anuQueryKeys.task(variables.taskId),
      });
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.tasks() });
    },
  });
}

export function useAnuSignOut() {
  const queryClient = useQueryClient();
  const signOut = useAnuSessionStore.use.signOut();
  return useMutation({
    mutationFn: async () => {
      const token = useAnuSessionStore.getState().token;
      if (token) {
        // The token is dropped locally whatever the server says: a sign-out
        // that fails offline must still sign out.
        await logoutAnu({ token }).catch(() => undefined);
      }
    },
    onSettled: async () => {
      await signOut();
      queryClient.clear();
    },
  });
}
