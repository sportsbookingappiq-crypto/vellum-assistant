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
  createAnuBot,
  createAnuSession,
  deleteAnuBot,
  deleteAnuSession,
  draftAnuBot,
  duplicateAnuBot,
  fetchAnuBot,
  fetchAnuBotOptions,
  fetchAnuBots,
  setAnuDefaultBot,
  updateAnuBot,
  type AnuBot,
  type AnuBotInput,
  type AnuBotList,
  decideAnuSessionApproval,
  fetchAnuAgents,
  fetchAnuMessages,
  fetchAnuSession,
  fetchAnuSessions,
  sendAnuMessage,
  stopAnuSession,
  type AnuMessage,
  type AnuScope,
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
  deleteAnuAccount,
  fetchAnuExport,
} from "./anu-api";
import { anuQueryKeys } from "./anu-query-client";
import { useAnuSessionStore } from "./anu-session-store";
import { mergeSteps } from "./anu-task-model";
import { upsertMessage } from "./anu-chat-model";

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

export function useAnuFiles(scope: AnuScope, path: string) {
  const token = useToken();
  return useQuery({
    queryKey: [...anuQueryKeys.files(scope), path],
    queryFn: ({ signal }) => fetchAnuFiles(scope, path, { token, signal }),
    enabled: token !== null,
  });
}

export function useAnuFileContent(scope: AnuScope, path: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: [...anuQueryKeys.files(scope), "content", path],
    queryFn: ({ signal }) =>
      fetchAnuFileContent(scope, path ?? "", { token, signal }),
    enabled: token !== null && path !== null,
    staleTime: 30_000,
  });
}

/** The browser's latest frame metadata, refreshed while the work is live. */
export function useAnuBrowser(scope: AnuScope, live: boolean) {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.browser(scope),
    queryFn: ({ signal }) => fetchAnuBrowser(scope, { token, signal }),
    enabled: token !== null,
    refetchInterval: live ? 2_000 : false,
  });
}

export function useAnuBrowserFrame(scope: AnuScope, frameId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: [...anuQueryKeys.browser(scope), "frame", frameId],
    queryFn: ({ signal }) => fetchAnuBrowserFrame(scope, frameId, { token, signal }),
    enabled: token !== null && frameId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    placeholderData: (previous) => previous,
  });
}

/** Every agent and what it is doing, refreshed while any of them works. */
export function useAnuAgents() {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.agents(),
    queryFn: ({ signal }) => fetchAnuAgents({ token, signal }),
    enabled: token !== null,
    // Spec A.3.9: every 5 seconds while the screen is visible.
    refetchInterval: 5_000,
  });
}

/** The person's chats, newest first; only one bot's when `botId` is set. */
export function useAnuSessions(botId?: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: botId ? anuQueryKeys.sessionsOfBot(botId) : anuQueryKeys.sessions(),
    queryFn: ({ signal }) =>
      fetchAnuSessions({ token, signal, botId: botId ?? undefined }),
    enabled: token !== null,
    // Kept fresh in the background too, so a question asked while the app
    // is away can still raise a banner (anu-notify.ts).
    refetchInterval: (query) =>
      query.state.data?.some((session) => session.status === "working" || session.status === "waiting")
        ? 5_000
        : 20_000,
    refetchIntervalInBackground: true,
  });
}

export function useAnuSession(id: string) {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.session(id),
    queryFn: ({ signal }) => fetchAnuSession(id, { token, signal }),
    enabled: token !== null && id !== "",
  });
}

export function useAnuMessages(id: string) {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.messages(id),
    queryFn: ({ signal }) => fetchAnuMessages(id, { token, signal }),
    enabled: token !== null && id !== "",
  });
}

export function useCreateAnuSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { title?: string; botId?: string }) =>
      createAnuSession(input, { token: requireToken() }),
    onSuccess: (session) => {
      queryClient.setQueryData(anuQueryKeys.session(session.id), session);
      queryClient.setQueryData<AnuMessage[]>(anuQueryKeys.messages(session.id), []);
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.sessions() });
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.bots() });
    },
  });
}

/**
 * The first message of a new chat: the session is made with its bot, then
 * the text is sent into it. Nothing exists on the server until this runs, so
 * an opened and abandoned new chat leaves no empty row behind.
 */
export function useStartAnuChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ botId, text }: { botId?: string; text: string }) => {
      const token = requireToken();
      const session = await createAnuSession({ botId }, { token });
      queryClient.setQueryData(anuQueryKeys.session(session.id), session);
      const message = await sendAnuMessage(session.id, text, { token });
      queryClient.setQueryData<AnuMessage[]>(anuQueryKeys.messages(session.id), [message]);
      return session;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.sessions() });
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.bots() });
    },
  });
}

export function useDeleteAnuSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => deleteAnuSession(sessionId, { token: requireToken() }),
    onSuccess: (_data, sessionId) => {
      queryClient.removeQueries({ queryKey: anuQueryKeys.session(sessionId) });
      queryClient.removeQueries({ queryKey: anuQueryKeys.messages(sessionId) });
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.sessions() });
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.agents() });
    },
  });
}

/** The person's bots, most urgent first, refreshed while any of them works. */
export function useAnuBots() {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.bots(),
    queryFn: ({ signal }) => fetchAnuBots({ token, signal }),
    enabled: token !== null,
    refetchInterval: (query) =>
      query.state.data?.bots.some(
        (bot) => bot.status === "working" || bot.status === "waiting_for_you",
      )
        ? 5_000
        : 30_000,
  });
}

export function useAnuBot(botId: string | null | undefined) {
  const token = useToken();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: anuQueryKeys.bot(botId ?? ""),
    queryFn: ({ signal }) => fetchAnuBot(botId ?? "", { token, signal }),
    enabled: token !== null && Boolean(botId),
    initialData: () =>
      queryClient
        .getQueryData<AnuBotList>(anuQueryKeys.bots())
        ?.bots.find((bot) => bot.id === botId),
  });
}

export function useAnuBotOptions() {
  const token = useToken();
  return useQuery({
    queryKey: anuQueryKeys.botOptions(),
    queryFn: ({ signal }) => fetchAnuBotOptions({ token, signal }),
    enabled: token !== null,
    staleTime: 10 * 60_000,
  });
}

export function useDraftAnuBot() {
  return useMutation({
    mutationFn: ({ description, locale }: { description: string; locale: "ar" | "en" }) =>
      draftAnuBot({ description, locale }, { token: requireToken() }),
  });
}

function writeBotToCache(queryClient: ReturnType<typeof useQueryClient>, bot: AnuBot): void {
  queryClient.setQueryData(anuQueryKeys.bot(bot.id), bot);
  queryClient.setQueryData<AnuBotList>(anuQueryKeys.bots(), (list) => {
    if (!list) {
      return list;
    }
    const exists = list.bots.some((existing) => existing.id === bot.id);
    return {
      ...list,
      bots: exists
        ? list.bots.map((existing) => (existing.id === bot.id ? bot : existing))
        : [...list.bots, bot],
    };
  });
}

export function useCreateAnuBot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AnuBotInput) => createAnuBot(input, { token: requireToken() }),
    onSuccess: (bot) => writeBotToCache(queryClient, bot),
  });
}

export function useUpdateAnuBot(botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AnuBotInput>) =>
      updateAnuBot(botId, patch, { token: requireToken() }),
    onSuccess: (bot) => {
      writeBotToCache(queryClient, bot);
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.sessions() });
    },
  });
}

export function useDuplicateAnuBot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (botId: string) => duplicateAnuBot(botId, { token: requireToken() }),
    onSuccess: (bot) => writeBotToCache(queryClient, bot),
  });
}

export function useDeleteAnuBot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (botId: string) => deleteAnuBot(botId, { token: requireToken() }),
    onSuccess: (_data, botId) => {
      queryClient.removeQueries({ queryKey: anuQueryKeys.bot(botId) });
      queryClient.setQueryData<AnuBotList>(anuQueryKeys.bots(), (list) =>
        list ? { ...list, bots: list.bots.filter((bot) => bot.id !== botId) } : list,
      );
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.sessions() });
    },
  });
}

export function useSetAnuDefaultBot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (botId: string) => setAnuDefaultBot(botId, { token: requireToken() }),
    onSuccess: (_data, botId) => {
      queryClient.setQueryData<AnuBotList>(anuQueryKeys.bots(), (list) =>
        list ? { ...list, defaultBotId: botId } : list,
      );
    },
  });
}

/** Sends a turn; the user's message shows at once and the stream fills the reply. */
export function useSendAnuMessage(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      sendAnuMessage(sessionId, content, { token: requireToken() }),
    onSuccess: (message) => {
      queryClient.setQueryData<AnuMessage[]>(
        anuQueryKeys.messages(sessionId),
        (current) => upsertMessage(current, message),
      );
    },
  });
}

export function useStopAnuSession(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => stopAnuSession(sessionId, { token: requireToken() }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.session(sessionId) });
    },
  });
}

export function useDecideAnuSessionApproval(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: AnuDecision }) =>
      decideAnuSessionApproval(sessionId, approvalId, decision, { token: requireToken() }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.messages(sessionId) });
      void queryClient.invalidateQueries({ queryKey: anuQueryKeys.session(sessionId) });
    },
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

/** Downloads the person's data as a JSON file. */
export function useExportAnuData() {
  return useMutation({
    mutationFn: async () => {
      const data = await fetchAnuExport({ token: requireToken() });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "anu-data.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    },
  });
}

/** Deletes the account on the server, then signs out here. */
export function useDeleteAnuAccount() {
  const queryClient = useQueryClient();
  const signOut = useAnuSessionStore.use.signOut();
  return useMutation({
    mutationFn: () => deleteAnuAccount({ token: requireToken() }),
    onSuccess: async () => {
      await signOut();
      queryClient.clear();
    },
  });
}
