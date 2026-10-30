import { z } from "zod";

import { saveFrame } from "../browser-frames.js";

import type { DriverContext, DriverOutcome } from "./types.js";

/**
 * Drives one goal through a running assistant runtime and maps its event
 * stream to ANU steps. Kept apart from process startup so tests can run it
 * against a fake runtime.
 *
 * Mapping:
 * - Assistant text written before a tool call becomes a `message` step, so
 *   the timeline shows what the assistant said it was about to do.
 * - `tool_use_start` becomes a `tool` step with a one-line summary of the
 *   input; `tool_result` becomes an `observation` step with the duration and
 *   a summary of the output.
 * - `confirmation_request` (the runtime asking its user for consent) becomes
 *   an ANU approval. The user's decision is sent back through the runtime's
 *   own confirmation endpoint, so consent stays with the person, as the
 *   assistant's permission rules require.
 * - `secret_request` is cancelled: ANU has no way to collect a secret.
 * - `question_request` (the ask-question card) is closed unanswered and the
 *   question is recorded as a step, so the turn does not wait for a card the
 *   ANU app cannot show. The assistant sees the questions as skipped.
 */

/** HTTP access to the runtime, through its gateway. */
export interface RuntimeClient {
  call(method: string, route: string, body?: unknown): Promise<Record<string, unknown>>;
  /** Opens the event stream for a conversation. */
  events(conversationKey: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

export interface TurnOptions {
  inferenceProfile: string;
  /** How long the whole turn may take. */
  timeoutMs: number;
  /** The assistant's workspace directory. Paths inside it are shown relative to it. */
  workspace?: string;
}

/** Reported when every tool call in the run failed. */
export const LOW_CONFIDENCE = 0.2;

/**
 * The user message ANU sends for a task. A task arrives with nobody watching
 * the chat, so the request itself says to carry the work through in this turn
 * rather than announce it and wait.
 */
export function taskMessage(goal: string): string {
  return `${goal.trim()}\n\nThis is a task for you to carry out on your own, not a chat. Do the work now with your tools, say briefly what you are doing as you go, and finish this turn with the result.`;
}

interface SseFrame {
  event: string;
  data: string;
}

export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let index: number;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) yield { event, data: data.join("\n") };
    }
  }
}

const EnvelopeSchema = z.object({ message: z.record(z.string(), z.unknown()) });

const ToolUseStartSchema = z.object({
  type: z.literal("tool_use_start"),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()).catch({}),
  toolUseId: z.string().optional(),
  startedAt: z.number().optional(),
});

const ToolResultSchema = z.object({
  type: z.literal("tool_result"),
  toolName: z.string(),
  result: z.string().catch(""),
  isError: z.boolean().optional(),
  toolUseId: z.string().optional(),
  riskLevel: z.string().optional(),
  approvalMode: z.string().optional(),
  completedAt: z.number().optional(),
  diff: z.object({ filePath: z.string(), isNewFile: z.boolean() }).partial().optional(),
  /** Base64 images from the tool's content blocks (browser_screenshot returns one). */
  imageData: z.string().optional(),
  imageDataList: z.array(z.string()).optional(),
});

/** The page URL a browser tool result reports, if any (navigate, snapshot, extract). */
export function browserUrlFromResult(result: string): string | null {
  const match = /^Final URL:\s*(\S+)/im.exec(result) ?? /^(?:URL|Current URL):\s*(\S+)/im.exec(result);
  return match?.[1] ?? null;
}

const ConfirmationRequestSchema = z.object({
  type: z.literal("confirmation_request"),
  requestId: z.string(),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()).catch({}),
  riskLevel: z.string().catch("unknown"),
  riskReason: z.string().optional(),
  executionTarget: z.string().optional(),
  diff: z.object({ filePath: z.string(), isNewFile: z.boolean() }).partial().optional(),
});

const SecretRequestSchema = z.object({
  type: z.literal("secret_request"),
  requestId: z.string(),
  label: z.string().catch("a secret"),
  service: z.string().optional(),
});

const QuestionRequestSchema = z.object({
  type: z.literal("question_request"),
  requestId: z.string(),
  question: z.string().catch(""),
  questions: z.array(z.object({ question: z.string() })).catch([]),
});

const ErrorSchema = z.object({
  type: z.enum(["conversation_error", "error"]),
  userMessage: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
});

/** Input fields that best describe what a tool call does, in order of preference. */
const SUMMARY_FIELDS = ["command", "path", "file_path", "url", "query", "pattern", "name", "activity"] as const;

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A one-line description of a tool call's input, for step titles and approval prompts. */
export function summarizeToolInput(input: Record<string, unknown>, max = 120): string {
  for (const field of SUMMARY_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) return oneLine(value, max);
  }
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim()) return oneLine(value, max);
  }
  return "";
}

/** Shortens long string values so a step's detail stays readable on a phone. */
export function trimInput(input: Record<string, unknown>, max = 2000): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = typeof value === "string" && value.length > max ? `${value.slice(0, max)}… (${value.length} chars)` : value;
  }
  return out;
}

/** The first non-empty line of a tool result, shortened. */
export function summarizeResult(result: string, max = 160): string {
  const line = result.split("\n").find((l) => l.trim()) ?? "";
  return oneLine(line, max);
}

export function confirmationPrompt(toolName: string, input: Record<string, unknown>): string {
  const summary = summarizeToolInput(input, 200);
  return summary ? `Allow the assistant to run ${toolName}: ${summary}?` : `Allow the assistant to run ${toolName}?`;
}

function seconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

/** Replaces the workspace prefix in string values, so titles show `notes.md` instead of a long absolute path. */
export function relativize(input: Record<string, unknown>, workspace: string | undefined): Record<string, unknown> {
  if (!workspace) return input;
  const root = workspace.replace(/\/+$/, "");
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = typeof value === "string" ? value.split(`${root}/`).join("").split(root).join(".") : value;
  }
  return out;
}

/**
 * Records a `browser` step after a browser tool call. The runtime sends image
 * data only for tools that return images (browser_screenshot), so other actions
 * carry the last known URL and no frame.
 */
async function reportBrowser(
  ctx: DriverContext,
  toolName: string,
  data: { result: string; imageData?: string; imageDataList?: string[] },
  input: Record<string, unknown> | undefined,
  state: { url: string | null },
) {
  const action = toolName.slice("browser_".length);
  const url = browserUrlFromResult(data.result) ?? (action === "navigate" && typeof input?.url === "string" ? input.url : null);
  if (url) state.url = url;
  const image = data.imageDataList?.[0] ?? data.imageData;
  let frameId: string | null = null;
  if (image) {
    try {
      frameId = (await saveFrame(ctx.workspaceDir, { data: Buffer.from(image, "base64"), url: state.url, action }))?.frameId ?? null;
    } catch (error) {
      ctx.log(`browser frame not saved: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  ctx.step({
    kind: "browser",
    title: state.url ? `Browser ${action}: ${state.url}` : `Browser ${action}`,
    detail: { url: state.url, action, frameId },
  });
}

export async function runTurn(ctx: DriverContext, client: RuntimeClient, options: TurnOptions): Promise<DriverOutcome> {
  const conversationKey = `anu-${ctx.taskId}`;
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(options.timeoutMs)]);
  const stream = await client.events(conversationKey, signal);

  const send = async (content: string) => {
    let lastError: unknown = null;
    for (const sourceChannel of ["vellum", "anu"]) {
      try {
        return await client.call("POST", "/v1/messages", {
          conversationKey,
          content,
          sourceChannel,
          interface: "cli",
          inferenceProfile: options.inferenceProfile,
        });
      } catch (error) {
        lastError = error;
        if (!String(error).includes("HTTP 400")) throw error;
        ctx.log(`sourceChannel ${sourceChannel} rejected: ${String(error)}`);
      }
    }
    throw new Error(`assistant rejected the message for every known source channel: ${String(lastError)}`);
  };

  await send(taskMessage(ctx.goal));
  ctx.step({ kind: "message", title: "Sent the goal to the assistant", detail: { conversationKey } });

  const started = new Map<string, number>();
  let narration = "";
  let reply = "";
  const browserInputs = new Map<string, Record<string, unknown>>();
  const browserState = { url: null as string | null };
  let toolCalls = 0;
  let toolErrors = 0;
  let approvals = 0;
  let pending: Promise<unknown> = Promise.resolve();

  const flushNarration = () => {
    const text = narration.trim();
    narration = "";
    if (text) ctx.step({ kind: "message", title: oneLine(text, 160), detail: { text: text.slice(0, 4000) } });
  };

  const answerConfirmation = async (request: z.infer<typeof ConfirmationRequestSchema>) => {
    approvals++;
    const decision = await ctx.requestApproval(confirmationPrompt(request.toolName, relativize(request.input, options.workspace)), {
      source: "assistant_confirmation",
      toolName: request.toolName,
      riskLevel: request.riskLevel,
      riskReason: request.riskReason ?? null,
      executionTarget: request.executionTarget ?? null,
      file: request.diff?.filePath ?? null,
      input: trimInput(request.input),
    });
    try {
      await client.call("POST", "/v1/confirm", {
        requestId: request.requestId,
        decision: decision === "approved" ? "allow" : "deny",
      });
    } catch (error) {
      // 404 means the runtime already settled the prompt (timeout or superseded).
      ctx.log(`could not deliver the decision for ${request.requestId}: ${String(error)}`);
      ctx.step({
        kind: "observation",
        title: `The assistant no longer waited for approval of ${request.toolName}`,
        status: "failed",
      });
    }
  };

  for await (const frame of readSse(stream)) {
    let raw: unknown;
    try {
      raw = JSON.parse(frame.data);
    } catch {
      continue;
    }
    const envelope = EnvelopeSchema.safeParse(raw);
    if (!envelope.success) continue;
    const message = envelope.data.message;

    switch (message.type) {
      case "assistant_text_delta": {
        const text = typeof message.text === "string" ? message.text : "";
        narration += text;
        reply += text;
        break;
      }
      case "tool_use_start": {
        const parsed = ToolUseStartSchema.safeParse(message);
        if (!parsed.success) break;
        flushNarration();
        reply = "";
        toolCalls++;
        const { toolName, input, toolUseId, startedAt } = parsed.data;
        if (toolUseId) started.set(toolUseId, startedAt ?? Date.now());
        if (toolUseId && toolName.startsWith("browser_")) browserInputs.set(toolUseId, input);
        const summary = summarizeToolInput(relativize(input, options.workspace));
        ctx.step({
          kind: "tool",
          title: summary ? `${toolName}: ${summary}` : toolName,
          detail: { toolName, toolUseId: toolUseId ?? null, input: trimInput(input) },
        });
        break;
      }
      case "tool_result": {
        const parsed = ToolResultSchema.safeParse(message);
        if (!parsed.success) break;
        const { toolName, result, isError, toolUseId, riskLevel, approvalMode, completedAt, diff } = parsed.data;
        const start = toolUseId ? started.get(toolUseId) : undefined;
        const durationMs = start !== undefined ? Math.max(0, (completedAt ?? Date.now()) - start) : null;
        if (isError) toolErrors++;
        const timing = durationMs !== null ? ` in ${seconds(durationMs)}` : "";
        ctx.step({
          kind: "observation",
          title: isError ? `${toolName} failed${timing}: ${summarizeResult(result, 120)}` : `${toolName} finished${timing}`,
          detail: {
            toolName,
            toolUseId: toolUseId ?? null,
            isError: isError ?? false,
            durationMs,
            riskLevel: riskLevel ?? null,
            approvalMode: approvalMode ?? null,
            file: diff?.filePath ?? null,
            summary: summarizeResult(result),
            result: result.slice(0, 4000),
          },
          status: isError ? "failed" : "done",
        });
        if (toolName.startsWith("browser_") && !isError) {
          await reportBrowser(ctx, toolName, parsed.data, toolUseId ? browserInputs.get(toolUseId) : undefined, browserState);
        }
        break;
      }
      case "confirmation_request": {
        const parsed = ConfirmationRequestSchema.safeParse(message);
        if (!parsed.success) break;
        flushNarration();
        const request = parsed.data;
        pending = pending.then(() => answerConfirmation(request)).catch((error) => ctx.log(`approval failed: ${String(error)}`));
        break;
      }
      case "secret_request": {
        const parsed = SecretRequestSchema.safeParse(message);
        if (!parsed.success) break;
        ctx.step({
          kind: "observation",
          title: `The assistant asked for ${parsed.data.label}; ANU cannot collect secrets, so the request was declined`,
          status: "failed",
        });
        await client.call("POST", "/v1/secret", { requestId: parsed.data.requestId }).catch((error) => {
          ctx.log(`could not cancel secret request: ${String(error)}`);
        });
        break;
      }
      case "question_request": {
        const parsed = QuestionRequestSchema.safeParse(message);
        if (!parsed.success) break;
        flushNarration();
        const questions = parsed.data.questions.map((q) => q.question).filter(Boolean);
        const asked = questions.length ? questions : [parsed.data.question].filter(Boolean);
        ctx.step({
          kind: "observation",
          title: `The assistant asked: ${oneLine(asked.join(" / ") || "a question", 160)} (ANU cannot answer question cards yet, so it was skipped)`,
          detail: { questions: asked },
          status: "failed",
        });
        await client
          .call("POST", "/v1/question-response", { requestId: parsed.data.requestId, kind: "close" })
          .catch((error) => ctx.log(`could not close question request: ${String(error)}`));
        break;
      }
      case "conversation_error":
      case "error": {
        const parsed = ErrorSchema.safeParse(message);
        const text = parsed.success ? (parsed.data.userMessage ?? parsed.data.message ?? parsed.data.code) : undefined;
        throw new Error(`assistant error: ${text ?? "unknown error"}`);
      }
      case "generation_cancelled":
        throw new Error("assistant cancelled the generation");
      case "message_complete": {
        if (message.source === "aux") break;
        await pending;
        const text = reply.trim();
        const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
        // Every tool call failing usually means the reply explains why it could not act.
        const allToolsFailed = toolCalls > 0 && toolErrors === toolCalls;
        ctx.step({
          kind: "observation",
          title: `The assistant finished: ${plural(toolCalls, "tool call")}, ${toolErrors} failed, ${plural(approvals, "approval")}`,
          detail: { toolCalls, toolErrors, approvals },
          status: allToolsFailed ? "failed" : "done",
        });
        return {
          status: "succeeded",
          result: text || "(the assistant returned no text)",
          confidence: allToolsFailed ? LOW_CONFIDENCE : null,
        };
      }
    }
  }
  throw new Error("assistant event stream ended before message_complete");
}
