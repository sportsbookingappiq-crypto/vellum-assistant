/**
 * The ANU screens' own React Query cache. The ANU API is a separate service
 * with its own sign-in, so its data never shares a cache with the platform's
 * auth- or org-scoped clients, and signing out of ANU clears exactly this.
 */

import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { AnuApiError, isAnuUnauthorized, type AnuScope } from "./anu-api";
import { useAnuSessionStore } from "./anu-session-store";

export const anuQueryKeys = {
  all: ["anu"] as const,
  me: () => ["anu", "me"] as const,
  tasks: () => ["anu", "tasks"] as const,
  task: (taskId: string) => ["anu", "task", taskId] as const,
  steps: (taskId: string) => ["anu", "steps", taskId] as const,
  files: (scope: AnuScope) => ["anu", "files", scope.kind, scope.id] as const,
  browser: (scope: AnuScope) => ["anu", "browser", scope.kind, scope.id] as const,
  agents: () => ["anu", "agents"] as const,
  sessions: () => ["anu", "sessions"] as const,
  sessionsOfBot: (botId: string) => ["anu", "sessions", "bot", botId] as const,
  bots: () => ["anu", "bots"] as const,
  bot: (botId: string) => ["anu", "bot", botId] as const,
  botOptions: () => ["anu", "bot-options"] as const,
  session: (id: string) => ["anu", "session", id] as const,
  messages: (id: string) => ["anu", "messages", id] as const,
};

/** A `401` anywhere means the token is gone: drop it and return to sign-in. */
function handleError(error: unknown): void {
  if (isAnuUnauthorized(error)) {
    void useAnuSessionStore.getState().expire();
  }
}

export const anuQueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleError }),
  mutationCache: new MutationCache({ onError: handleError }),
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      // A 4xx is an answer, not a blip: retrying it only delays the screen
      // that explains it.
      retry: (failureCount, error) =>
        !(
          error instanceof AnuApiError &&
          error.status >= 400 &&
          error.status < 500
        ) && failureCount < 2,
    },
  },
});
