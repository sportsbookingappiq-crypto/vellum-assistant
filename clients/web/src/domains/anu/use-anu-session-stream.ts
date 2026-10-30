/**
 * Follows a chat session's live stream while it is open and folds each event
 * into the query cache: whole messages replace by id, deltas grow the reply
 * being written, and session events refresh its header. The cache stays the
 * one owner of the conversation.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { isAnuUnauthorized, type AnuMessage } from "./anu-api";
import { applyDelta, upsertMessage } from "./anu-chat-model";
import { anuQueryKeys } from "./anu-query-client";
import { useAnuSessionStore } from "./anu-session-store";
import { streamAnuSessionEvents } from "./anu-sse";
import type { AnuStreamState } from "./use-anu-task-stream";

export function useAnuSessionStream(sessionId: string): AnuStreamState {
  const queryClient = useQueryClient();
  const token = useAnuSessionStore.use.token();
  const [state, setState] = useState<AnuStreamState>("idle");

  useEffect(() => {
    if (!token || !sessionId) {
      return;
    }
    const controller = new AbortController();
    const key = anuQueryKeys.messages(sessionId);
    const after =
      queryClient
        .getQueryData<AnuMessage[]>(key)
        ?.reduce((max, message) => Math.max(max, message.seq ?? 0), 0) ?? 0;
    setState("live");
    void streamAnuSessionEvents({
      sessionId,
      token,
      after,
      signal: controller.signal,
      onConnectionChange: (connected) => setState(connected ? "live" : "reconnecting"),
      onEvent: (event) => {
        if (event.type === "message") {
          queryClient.setQueryData<AnuMessage[]>(key, (current) =>
            upsertMessage(current, event.message),
          );
          if (event.message.kind === "browser") {
            void queryClient.invalidateQueries({
              queryKey: anuQueryKeys.browser({ kind: "sessions", id: sessionId }),
            });
          }
        } else if (event.type === "delta") {
          queryClient.setQueryData<AnuMessage[]>(key, (current) =>
            applyDelta(current, event.messageId, event.text),
          );
        } else if (event.type === "session") {
          queryClient.setQueryData(anuQueryKeys.session(sessionId), event.session);
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
  }, [queryClient, sessionId, token]);

  return state;
}
