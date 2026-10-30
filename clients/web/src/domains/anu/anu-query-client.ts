/**
 * The ANU screens' own React Query cache. The ANU API is a separate service
 * with its own sign-in, so its data never shares a cache with the platform's
 * auth- or org-scoped clients, and signing out of ANU clears exactly this.
 */

import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { AnuApiError, isAnuUnauthorized } from "./anu-api";
import { useAnuSessionStore } from "./anu-session-store";

export const anuQueryKeys = {
  all: ["anu"] as const,
  me: () => ["anu", "me"] as const,
  tasks: () => ["anu", "tasks"] as const,
  task: (taskId: string) => ["anu", "task", taskId] as const,
  steps: (taskId: string) => ["anu", "steps", taskId] as const,
  files: (taskId: string) => ["anu", "files", taskId] as const,
  browser: (taskId: string) => ["anu", "browser", taskId] as const,
};

/** A `401` anywhere means the token is gone: drop it and return to sign-in. */
function handleError(error: unknown): void {
  if (isAnuUnauthorized(error)) {
    void useAnuSessionStore.getState().signOut();
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
