/**
 * Pure folds over a chat session's messages: the cache keeps one ordered
 * list, a streamed delta grows the message it names, and a full message
 * replaces whatever partial copy the deltas built.
 */

import type { AnuMessage } from "./anu-api";

function order(a: AnuMessage, b: AnuMessage): number {
  if (a.seq !== undefined && b.seq !== undefined) {
    return a.seq - b.seq;
  }
  return Date.parse(a.createdAt) - Date.parse(b.createdAt);
}

export function upsertMessage(
  current: readonly AnuMessage[] | undefined,
  message: AnuMessage,
): AnuMessage[] {
  const next = (current ?? []).filter((existing) => existing.id !== message.id);
  next.push(message);
  return next.sort(order);
}

export function applyDelta(
  current: readonly AnuMessage[] | undefined,
  messageId: string,
  text: string,
): AnuMessage[] {
  const list = [...(current ?? [])];
  const index = list.findIndex((message) => message.id === messageId);
  if (index === -1) {
    list.push({
      id: messageId,
      seq: undefined,
      kind: "assistant_message",
      role: "assistant",
      content: text,
      detail: undefined,
      status: "streaming",
      createdAt: new Date().toISOString(),
    });
    return list;
  }
  const existing = list[index];
  if (existing) {
    list[index] = { ...existing, content: `${existing.content ?? ""}${text}` };
  }
  return list;
}

/** A turn as the chat draws it: the person's, the agent's, or a step between. */
export type AnuChatItem =
  | { type: "user"; message: AnuMessage }
  | { type: "assistant"; message: AnuMessage }
  | { type: "steps"; messages: AnuMessage[] }
  | { type: "approval"; message: AnuMessage };

/** Folds consecutive tool messages into one collapsed group of steps. */
export function groupChat(messages: readonly AnuMessage[]): AnuChatItem[] {
  const items: AnuChatItem[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      const last = items.at(-1);
      if (last?.type === "steps") {
        last.messages.push(message);
      } else {
        items.push({ type: "steps", messages: [message] });
      }
    } else if (message.role === "approval") {
      items.push({ type: "approval", message });
    } else if (message.role === "user") {
      items.push({ type: "user", message });
    } else if (message.role === "assistant") {
      items.push({ type: "assistant", message });
    }
  }
  return items;
}

/** What a tool message links to: a page the browser opened, or a file. */
export function messageArtifact(
  message: AnuMessage,
): { kind: "browser"; url: string | null } | { kind: "file"; path: string } | null {
  const detail =
    typeof message.detail === "object" && message.detail !== null
      ? (message.detail as Record<string, unknown>)
      : {};
  if (message.kind === "browser" || typeof detail.frameId === "string") {
    return { kind: "browser", url: typeof detail.url === "string" ? detail.url : null };
  }
  if (typeof detail.file === "string" && detail.file) {
    return { kind: "file", path: detail.file };
  }
  return null;
}

/** One block of the chat as the screen draws it (spec A.3.3). */
export type AnuChatBlock =
  | { type: "user"; message: AnuMessage }
  | { type: "assistant"; message: AnuMessage; firstOfRun: boolean }
  | { type: "steps"; id: string; messages: AnuMessage[]; pages: string[]; files: string[] }
  | { type: "approval"; message: AnuMessage }
  | { type: "failed"; id: string; retryText: string | null };

function turnFailed(message: AnuMessage): boolean {
  if (message.kind !== "turn_complete") {
    return false;
  }
  const detail =
    typeof message.detail === "object" && message.detail !== null
      ? (message.detail as Record<string, unknown>)
      : {};
  return detail.status === "failed" || message.status === "failed";
}

/**
 * Folds messages into blocks: steps between replies collapse into one
 * block that also knows which pages were opened and which files were made,
 * consecutive replies share one avatar, and a failed turn becomes an error
 * block that can resend the message that started it.
 */
export function chatBlocks(messages: readonly AnuMessage[]): AnuChatBlock[] {
  const blocks: AnuChatBlock[] = [];
  let lastUserText: string | null = null;
  for (const message of messages) {
    const last = blocks.at(-1);
    if (message.role === "user") {
      lastUserText = message.content;
      blocks.push({ type: "user", message });
    } else if (message.role === "assistant") {
      blocks.push({ type: "assistant", message, firstOfRun: last?.type !== "assistant" });
    } else if (message.role === "approval") {
      blocks.push({ type: "approval", message });
    } else if (message.role === "tool") {
      const steps =
        last?.type === "steps"
          ? last
          : ({ type: "steps", id: message.id, messages: [], pages: [], files: [] } as Extract<
              AnuChatBlock,
              { type: "steps" }
            >);
      if (steps !== last) {
        blocks.push(steps);
      }
      steps.messages.push(message);
      const artifact = messageArtifact(message);
      if (artifact?.kind === "browser") {
        const page = artifact.url ?? "";
        if (!steps.pages.includes(page)) {
          steps.pages.push(page);
        }
      } else if (artifact?.kind === "file" && !steps.files.includes(artifact.path)) {
        steps.files.push(artifact.path);
      }
    } else if (turnFailed(message)) {
      blocks.push({ type: "failed", id: message.id, retryText: lastUserText });
    }
  }
  return blocks;
}
