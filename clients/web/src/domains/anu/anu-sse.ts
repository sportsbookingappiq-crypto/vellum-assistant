/**
 * Live updates for one ANU task: `GET /v1/tasks/:id/events`.
 *
 * The stream needs the `Authorization` header, which `EventSource` cannot
 * send, so it is read with `fetch` and parsed here. The parser is pure and
 * incremental (chunks may split a frame anywhere, including inside a CRLF);
 * the reader on top of it resumes from the last step it saw with `?after=`
 * after a dropped connection, and aborts a connection that has gone silent
 * for longer than the server's heartbeat allows (a WKWebView can hold a dead
 * stream open without ever surfacing an error, see docs/CAPACITOR.md).
 */

import { z } from "zod";

import {
  AnuApiError,
  anuApiBaseUrl,
  anuStepSchema,
  anuTaskDetailSchema,
  TASK_STATUSES,
  type AnuStep,
  type AnuTaskDetail,
  type AnuTaskStatus,
} from "./anu-api";

/** One dispatched server-sent event. */
export interface SseFrame {
  event: string;
  data: string;
  id: string | undefined;
}

/**
 * Incremental parser for the `text/event-stream` format (WHATWG HTML,
 * "Parsing an event stream"). Comment lines and `retry` fields are consumed
 * without producing a frame; `onComment` reports comments so a caller can
 * count heartbeats as traffic.
 */
export function createSseParser(onComment?: (text: string) => void): {
  push: (chunk: string) => SseFrame[];
} {
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let id: string | undefined;

  const dispatch = (frames: SseFrame[]) => {
    if (data.length > 0) {
      frames.push({ event: event || "message", data: data.join("\n"), id });
    }
    event = "";
    data = [];
    id = undefined;
  };

  const handleLine = (line: string, frames: SseFrame[]) => {
    if (line === "") {
      dispatch(frames);
      return;
    }
    if (line.startsWith(":")) {
      onComment?.(line.slice(1).trimStart());
      return;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    } else if (field === "id") {
      id = value;
    }
  };

  return {
    push(chunk: string): SseFrame[] {
      buffer += chunk;
      const frames: SseFrame[] = [];
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match) {
          break;
        }
        // A lone CR at the very end may be the first half of a CRLF split
        // across chunks; wait for the next chunk before deciding.
        if (match[0] === "\r" && match.index === buffer.length - 1) {
          break;
        }
        handleLine(buffer.slice(0, match.index), frames);
        buffer = buffer.slice(match.index + match[0].length);
      }
      return frames;
    },
  };
}

export type AnuTaskEvent =
  | { type: "task"; task: AnuTaskDetail }
  | { type: "step"; step: AnuStep }
  | { type: "end"; status: AnuTaskStatus | null; deleted: boolean }
  | { type: "error"; message: string };

const endSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  reason: z.string().optional(),
});
const errorSchema = z.object({ message: z.string() });

/** Turns a raw frame into a typed ANU task event, or `null` if unknown or malformed. */
export function parseAnuTaskEvent(frame: SseFrame): AnuTaskEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (frame.event === "task") {
    const parsed = anuTaskDetailSchema.safeParse(json);
    return parsed.success ? { type: "task", task: parsed.data } : null;
  }
  if (frame.event === "step") {
    const parsed = anuStepSchema.safeParse(json);
    return parsed.success ? { type: "step", step: parsed.data } : null;
  }
  if (frame.event === "end") {
    const parsed = endSchema.safeParse(json);
    if (!parsed.success) {
      return null;
    }
    return {
      type: "end",
      status: parsed.data.status ?? null,
      deleted: parsed.data.reason === "deleted",
    };
  }
  if (frame.event === "error") {
    const parsed = errorSchema.safeParse(json);
    return parsed.success
      ? { type: "error", message: parsed.data.message }
      : null;
  }
  return null;
}

export interface StreamAnuTaskOptions {
  taskId: string;
  token: string;
  /** Resume after this step `seq`. */
  after?: number;
  signal: AbortSignal;
  onEvent: (event: AnuTaskEvent) => void;
  /** Called with `true` while connected and `false` while reconnecting. */
  onConnectionChange?: (connected: boolean) => void;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Abort a connection after this long without a byte. Default 40 s. */
  idleTimeoutMs?: number;
  /** Wait before reconnecting after a drop. Default 2 s. */
  reconnectDelayMs?: number;
  /** Give up after this many reconnects in a row without traffic. Default 8. */
  maxReconnects?: number;
}

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/**
 * Follows a task's event stream until the server sends `end`, the caller
 * aborts, or the server refuses the stream (401, 404), which rejects with
 * {@link AnuApiError}. Dropped connections are resumed from the last step.
 */
export async function streamAnuTaskEvents(
  options: StreamAnuTaskOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const idleTimeoutMs = options.idleTimeoutMs ?? 40_000;
  const reconnectDelayMs = options.reconnectDelayMs ?? 2_000;
  const maxReconnects = options.maxReconnects ?? 8;
  let lastSeq = options.after ?? 0;
  let failures = 0;

  while (!options.signal.aborted) {
    const connection = new AbortController();
    const abortConnection = () => connection.abort();
    options.signal.addEventListener("abort", abortConnection, { once: true });
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => connection.abort(), idleTimeoutMs);
    };

    let ended = false;
    try {
      armIdle();
      const response = await fetchImpl(
        `${options.baseUrl ?? anuApiBaseUrl()}/v1/tasks/${encodeURIComponent(options.taskId)}/events?after=${lastSeq}`,
        {
          headers: {
            accept: "text/event-stream",
            authorization: `Bearer ${options.token}`,
          },
          signal: connection.signal,
        },
      );
      if (response.status === 401 || response.status === 404) {
        throw new AnuApiError({
          status: response.status,
          code: response.status === 401 ? "unauthorized" : "not_found",
          message: response.statusText,
        });
      }
      if (!response.ok || !response.body) {
        throw new Error(`event stream returned HTTP ${response.status}`);
      }
      options.onConnectionChange?.(true);
      const parser = createSseParser(() => armIdle());
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        armIdle();
        failures = 0;
        for (const frame of parser.push(value)) {
          const event = parseAnuTaskEvent(frame);
          if (!event) {
            continue;
          }
          if (event.type === "step") {
            lastSeq = Math.max(lastSeq, event.step.seq);
          }
          options.onEvent(event);
          if (event.type === "end") {
            ended = true;
          }
        }
        if (ended) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    } catch (error) {
      if (error instanceof AnuApiError) {
        throw error;
      }
    } finally {
      clearTimeout(idleTimer);
      options.signal.removeEventListener("abort", abortConnection);
    }

    if (ended || options.signal.aborted) {
      return;
    }
    failures += 1;
    options.onConnectionChange?.(false);
    if (failures > maxReconnects) {
      throw new AnuApiError({
        status: 0,
        code: "stream_lost",
        message: "The live stream could not be restored.",
      });
    }
    await delay(reconnectDelayMs, options.signal);
  }
}
