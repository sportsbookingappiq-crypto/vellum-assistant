/**
 * Client for the ANU task API (`anu/`, documented in `anu/docs/api.md` and
 * `anu/openapi.yaml`).
 *
 * The ANU API is a separate service from the platform and the assistant
 * gateway, so it gets its own small fetch client rather than a HeyAPI
 * generated one: every response is validated with Zod at the boundary, every
 * error is an {@link AnuApiError} carrying the server's `code`, and the bearer
 * token is passed in per call so the caller (the session store) stays the one
 * owner of it.
 */

import { z } from "zod";

const DEFAULT_ANU_API_URL = "http://127.0.0.1:8787";

/** The ANU API base URL, without a trailing slash. */
export function anuApiBaseUrl(): string {
  const configured = import.meta.env.VITE_ANU_API_URL?.trim();
  return (configured || DEFAULT_ANU_API_URL).replace(/\/+$/, "");
}

export const TASK_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "stopped",
] as const;

export const STEP_KINDS = [
  "plan",
  "tool",
  "observation",
  "message",
  "approval_request",
  "result",
  "browser",
] as const;

export const STEP_STATUSES = ["pending", "running", "done", "failed"] as const;

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;

const nullableString = z.string().nullable().optional();

export const anuTaskSchema = z.object({
  id: z.string(),
  goal: z.string(),
  status: z.enum(TASK_STATUSES),
  result: nullableString,
  confidence: z.number().min(0).max(1).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: nullableString,
  finishedAt: nullableString,
});

export const anuApprovalSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  stepId: nullableString,
  prompt: z.string(),
  detail: z.unknown().optional(),
  status: z.enum(APPROVAL_STATUSES),
  createdAt: z.string(),
  decidedAt: nullableString,
});

export const anuTaskDetailSchema = anuTaskSchema.extend({
  approvals: z.array(anuApprovalSchema).default([]),
});

export const anuStepSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  seq: z.number().int().min(1),
  kind: z.enum(STEP_KINDS),
  title: z.string(),
  detail: z.unknown(),
  status: z.enum(STEP_STATUSES),
  createdAt: z.string(),
});

export const anuUserSchema = z.object({
  id: z.string(),
  phone: z.string(),
  createdAt: z.string(),
});

const codeRequestSchema = z.object({
  expiresAt: z.string(),
  devCode: z.string().optional(),
});

const sessionSchema = z.object({
  token: z.string().min(1),
  tokenType: z.literal("Bearer"),
  expiresAt: z.string(),
  userId: z.string(),
});

const errorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    attemptsRemaining: z.number().int().optional(),
  }),
});

export type AnuTaskStatus = (typeof TASK_STATUSES)[number];
export type AnuStepKind = (typeof STEP_KINDS)[number];
export type AnuStepStatus = (typeof STEP_STATUSES)[number];
export type AnuTask = z.infer<typeof anuTaskSchema>;
export type AnuTaskDetail = z.infer<typeof anuTaskDetailSchema>;
export type AnuApproval = z.infer<typeof anuApprovalSchema>;
export type AnuStep = z.infer<typeof anuStepSchema>;
export type AnuUser = z.infer<typeof anuUserSchema>;
export type AnuCodeRequest = z.infer<typeof codeRequestSchema>;
export type AnuAuthSession = z.infer<typeof sessionSchema>;
export type AnuDecision = "approve" | "reject";

/**
 * A failed ANU API call. `code` is the server's error code
 * (`invalid_code`, `code_expired`, `rate_limited`, ...) or one of the
 * client-side codes `network` and `invalid_response`.
 */
export class AnuApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly attemptsRemaining: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(options: {
    status: number;
    code: string;
    message: string;
    attemptsRemaining?: number;
    retryAfterSeconds?: number;
  }) {
    super(options.message);
    this.name = "AnuApiError";
    this.status = options.status;
    this.code = options.code;
    this.attemptsRemaining = options.attemptsRemaining;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/** Whether an error means the session token is missing, expired or revoked. */
export function isAnuUnauthorized(error: unknown): boolean {
  return error instanceof AnuApiError && error.status === 401;
}

export interface AnuRequestOptions {
  token?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * One request to the ANU API. Resolves with the validated body, or with
 * `undefined` for an empty success (`204`). Rejects with
 * {@link AnuApiError}.
 */
export async function anuRequest<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  schema: z.ZodType<T> | null,
  options: AnuRequestOptions & { body?: unknown } = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `${options.baseUrl ?? anuApiBaseUrl()}${path}`,
      {
        method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new AnuApiError({
      status: 0,
      code: "network",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const body = await readJson(response);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);
    throw new AnuApiError({
      status: response.status,
      code: parsed.success
        ? parsed.data.error.code
        : `http_${response.status}`,
      message: parsed.success
        ? parsed.data.error.message
        : response.statusText,
      attemptsRemaining: parsed.success
        ? parsed.data.error.attemptsRemaining
        : undefined,
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    });
  }

  if (schema === null) {
    return undefined as T;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AnuApiError({
      status: response.status,
      code: "invalid_response",
      message: parsed.error.message,
    });
  }
  return parsed.data;
}

export function requestAnuCode(
  phone: string,
  options?: AnuRequestOptions,
): Promise<AnuCodeRequest> {
  return anuRequest("POST", "/v1/auth/code/request", codeRequestSchema, {
    ...options,
    body: { phone },
  });
}

export function verifyAnuCode(
  phone: string,
  code: string,
  options?: AnuRequestOptions,
): Promise<AnuAuthSession> {
  return anuRequest("POST", "/v1/auth/code/verify", sessionSchema, {
    ...options,
    body: { phone, code },
  });
}

export function logoutAnu(options: AnuRequestOptions): Promise<void> {
  return anuRequest("POST", "/v1/auth/logout", null, options);
}

/** Everything the person has with ANU, as one JSON document to save. */
export function fetchAnuExport(options: AnuRequestOptions): Promise<unknown> {
  return anuRequest("GET", "/v1/me/export", z.unknown(), options);
}

/** Deletes the account and every bot, chat, task and file in it. */
export function deleteAnuAccount(options: AnuRequestOptions): Promise<void> {
  return anuRequest("DELETE", "/v1/me", null, options);
}

export function fetchAnuMe(options: AnuRequestOptions): Promise<AnuUser> {
  return anuRequest("GET", "/v1/me", anuUserSchema, options);
}

const taskListSchema = z.object({ tasks: z.array(anuTaskSchema) });
const stepListSchema = z.object({ steps: z.array(anuStepSchema) });

export async function fetchAnuTasks(
  options: AnuRequestOptions & { limit?: number },
): Promise<AnuTask[]> {
  const limit = options.limit ?? 50;
  const body = await anuRequest(
    "GET",
    `/v1/tasks?limit=${limit}`,
    taskListSchema,
    options,
  );
  return body.tasks;
}

export function fetchAnuTask(
  taskId: string,
  options: AnuRequestOptions,
): Promise<AnuTaskDetail> {
  return anuRequest(
    "GET",
    `/v1/tasks/${encodeURIComponent(taskId)}`,
    anuTaskDetailSchema,
    options,
  );
}

export async function fetchAnuSteps(
  taskId: string,
  options: AnuRequestOptions & { after?: number },
): Promise<AnuStep[]> {
  const body = await anuRequest(
    "GET",
    `/v1/tasks/${encodeURIComponent(taskId)}/steps?after=${options.after ?? 0}`,
    stepListSchema,
    options,
  );
  return body.steps;
}

export function createAnuTask(
  goal: string,
  options: AnuRequestOptions,
): Promise<AnuTask> {
  return anuRequest("POST", "/v1/tasks", anuTaskSchema, {
    ...options,
    body: { goal },
  });
}

export function stopAnuTask(
  taskId: string,
  options: AnuRequestOptions,
): Promise<AnuTask> {
  return anuRequest(
    "POST",
    `/v1/tasks/${encodeURIComponent(taskId)}/stop`,
    anuTaskSchema,
    options,
  );
}

export function decideAnuApproval(
  taskId: string,
  approvalId: string,
  decision: AnuDecision,
  options: AnuRequestOptions,
): Promise<AnuApproval> {
  return anuRequest(
    "POST",
    `/v1/tasks/${encodeURIComponent(taskId)}/approvals/${encodeURIComponent(approvalId)}`,
    anuApprovalSchema,
    { ...options, body: { decision } },
  );
}

/** Whether a task has reached a state it will not leave. */
export function isAnuTaskFinal(status: AnuTaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "stopped";
}

// ---------------------------------------------------------------------------
// Task workspace files and the live browser (anu/docs/api.md, "Workspace
// files" and "Browser frames").
// ---------------------------------------------------------------------------

export const anuFileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "directory", "symlink", "other"]),
  size: z.number().nullable().optional(),
  mtime: z.string().nullable().optional(),
});

const fileListSchema = z.object({
  path: z.string().default(""),
  entries: z.array(anuFileEntrySchema),
  truncated: z.boolean().optional(),
});

export type AnuFileEntry = z.infer<typeof anuFileEntrySchema>;
export type AnuFileList = z.infer<typeof fileListSchema>;

/** Whose workspace and browser a call is about: a task or a chat session. */
export interface AnuScope {
  kind: "tasks" | "sessions";
  id: string;
}

export function anuScopePath(scope: AnuScope): string {
  return `/v1/${scope.kind}/${encodeURIComponent(scope.id)}`;
}

export function fetchAnuFiles(
  scope: AnuScope,
  path: string,
  options: AnuRequestOptions,
): Promise<AnuFileList> {
  return anuRequest(
    "GET",
    `${anuScopePath(scope)}/files?path=${encodeURIComponent(path)}`,
    fileListSchema,
    options,
  );
}

/** A file or frame body as it came off the wire. */
export interface AnuBlob {
  blob: Blob;
  contentType: string;
}

async function fetchAnuBlob(
  path: string,
  options: AnuRequestOptions,
): Promise<AnuBlob> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl ?? anuApiBaseUrl()}${path}`, {
      headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new AnuApiError({
      status: 0,
      code: "network",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!response.ok) {
    throw new AnuApiError({
      status: response.status,
      code: `http_${response.status}`,
      message: response.statusText,
    });
  }
  const blob = await response.blob();
  return {
    blob,
    contentType:
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      blob.type ||
      "application/octet-stream",
  };
}

export function fetchAnuFileContent(
  scope: AnuScope,
  path: string,
  options: AnuRequestOptions,
): Promise<AnuBlob> {
  return fetchAnuBlob(
    `${anuScopePath(scope)}/files/content?path=${encodeURIComponent(path)}`,
    options,
  );
}

export const anuBrowserFrameSchema = z.object({
  frameId: z.string(),
  seq: z.number().nullable().optional(),
  url: z.string().nullable().optional(),
  action: z.string().nullable().optional(),
  contentType: z.string().nullable().optional(),
  capturedAt: z.string().nullable().optional(),
});

export const anuBrowserStateSchema = z.object({
  latest: anuBrowserFrameSchema.nullable(),
  frames: z.array(anuBrowserFrameSchema).default([]),
});

export type AnuBrowserFrame = z.infer<typeof anuBrowserFrameSchema>;
export type AnuBrowserState = z.infer<typeof anuBrowserStateSchema>;

/** The live browser's latest frame metadata, or `null` when it never opened. */
export async function fetchAnuBrowser(
  scope: AnuScope,
  options: AnuRequestOptions,
): Promise<AnuBrowserState | null> {
  try {
    return await anuRequest(
      "GET",
      `${anuScopePath(scope)}/browser`,
      anuBrowserStateSchema,
      options,
    );
  } catch (error) {
    if (error instanceof AnuApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export function fetchAnuBrowserFrame(
  scope: AnuScope,
  frameId: string | null | undefined,
  options: AnuRequestOptions,
): Promise<AnuBlob> {
  const query = frameId ? `?frameId=${encodeURIComponent(frameId)}` : "";
  return fetchAnuBlob(
    `${anuScopePath(scope)}/browser/frame${query}`,
    options,
  );
}

// ---------------------------------------------------------------------------
// Agents and chat sessions (anu/docs/api.md, "Agents" and "Chat sessions").
// The wire shapes are mapped once here onto what the screens draw.
// ---------------------------------------------------------------------------

export const AGENT_STATUSES = [
  "working",
  "waiting",
  "idle",
  "finished",
  "failed",
] as const;

export type AnuAgentStatus = (typeof AGENT_STATUSES)[number];

/** The server's `waiting_for_you` is the screens' `waiting`. */
const agentStatusSchema = z
  .string()
  .transform((value): AnuAgentStatus =>
    value === "waiting_for_you"
      ? "waiting"
      : (AGENT_STATUSES as readonly string[]).includes(value)
        ? (value as AnuAgentStatus)
        : "idle",
  );

export const anuAvatarTraitsSchema = z.object({
  bodyShape: z.string(),
  eyeStyle: z.string(),
  color: z.string(),
});

export type AnuAvatarTraits = z.infer<typeof anuAvatarTraitsSchema>;

export const anuAgentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: agentStatusSchema,
    doing: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    avatar: anuAvatarTraitsSchema.nullable().optional(),
    kind: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    taskId: z.string().nullable().optional(),
    botId: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
  })
  .transform(({ doing, ...agent }) => ({ ...agent, activity: doing ?? null }));

export type AnuAgent = z.infer<typeof anuAgentSchema>;

export async function fetchAnuAgents(options: AnuRequestOptions): Promise<AnuAgent[]> {
  const body = await anuRequest(
    "GET",
    "/v1/agents",
    z.object({ agents: z.array(anuAgentSchema) }),
    options,
  );
  return body.agents;
}

export const MESSAGE_ROLES = ["user", "assistant", "tool", "approval", "system"] as const;

function itemRole(kind: string): (typeof MESSAGE_ROLES)[number] {
  switch (kind) {
    case "user_message":
      return "user";
    case "assistant_message":
      return "assistant";
    case "approval_request":
      return "approval";
    case "turn_complete":
      return "system";
    default:
      return "tool";
  }
}

/** One session item, read as a chat message: who said it, and its text. */
export const anuMessageSchema = z
  .object({
    id: z.string(),
    seq: z.number().int().optional(),
    kind: z.string(),
    title: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
    detail: z.unknown().optional(),
    status: z.string().nullable().optional(),
    turnId: z.string().nullable().optional(),
    createdAt: z.string(),
  })
  .transform((item) => ({
    id: item.id,
    seq: item.seq,
    kind: item.kind,
    role: itemRole(item.kind),
    content: item.text ?? item.title ?? null,
    detail: item.detail,
    status: item.status ?? null,
    createdAt: item.createdAt,
  }));

export type AnuMessage = z.infer<typeof anuMessageSchema>;

export const anuSessionSchema = z
  .object({
    id: z.string(),
    title: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    botId: z.string().nullable().optional(),
    bot: z
      .object({ id: z.string(), name: z.string(), avatar: anuAvatarTraitsSchema.nullable().optional() })
      .nullable()
      .optional(),
    agent: z
      .object({ id: z.string(), name: z.string(), avatar: anuAvatarTraitsSchema.nullable().optional() })
      .nullable()
      .optional(),
    lastItem: z
      .object({ text: z.string().nullable().optional(), title: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
    approvals: z
      .array(anuApprovalSchema.extend({ taskId: z.string().nullable().optional() }))
      .default([]),
    createdAt: z.string(),
    updatedAt: z.string().nullable().optional(),
  })
  .transform((session) => ({
    ...session,
    status: session.status === "waiting_for_you" ? "waiting" : (session.status ?? "idle"),
    botId: session.botId ?? session.bot?.id ?? null,
    /** The bot's face when it still exists, else the agent's stored one. */
    avatar: session.bot?.avatar ?? session.agent?.avatar ?? null,
    agentName: session.bot?.name ?? session.agent?.name ?? null,
    lastMessage: session.lastItem?.text ?? session.lastItem?.title ?? null,
  }));

export type AnuSession = z.infer<typeof anuSessionSchema>;

export async function fetchAnuSessions(
  options: AnuRequestOptions & { botId?: string },
): Promise<AnuSession[]> {
  const query = options.botId ? `&botId=${encodeURIComponent(options.botId)}` : "";
  const body = await anuRequest(
    "GET",
    `/v1/sessions?limit=50${query}`,
    z.object({ sessions: z.array(anuSessionSchema) }),
    options,
  );
  return body.sessions;
}

export function fetchAnuSession(id: string, options: AnuRequestOptions): Promise<AnuSession> {
  return anuRequest("GET", `/v1/sessions/${encodeURIComponent(id)}`, anuSessionSchema, options);
}

export function createAnuSession(
  input: { title?: string; botId?: string },
  options: AnuRequestOptions,
): Promise<AnuSession> {
  const body: { title?: string; botId?: string } = {};
  if (input.title) {
    body.title = input.title;
  }
  if (input.botId) {
    body.botId = input.botId;
  }
  return anuRequest("POST", "/v1/sessions", anuSessionSchema, { ...options, body });
}

export function deleteAnuSession(id: string, options: AnuRequestOptions): Promise<void> {
  return anuRequest("DELETE", `/v1/sessions/${encodeURIComponent(id)}`, null, options);
}

export async function fetchAnuMessages(
  sessionId: string,
  options: AnuRequestOptions,
): Promise<AnuMessage[]> {
  const body = await anuRequest(
    "GET",
    `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    z.object({ items: z.array(anuMessageSchema) }),
    options,
  );
  return body.items;
}

export async function sendAnuMessage(
  sessionId: string,
  text: string,
  options: AnuRequestOptions,
): Promise<AnuMessage> {
  const body = await anuRequest(
    "POST",
    `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    z.object({ turnId: z.string().optional(), item: anuMessageSchema }),
    { ...options, body: { text } },
  );
  return body.item;
}

export function stopAnuSession(sessionId: string, options: AnuRequestOptions): Promise<void> {
  return anuRequest("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/stop`, null, options);
}

export function decideAnuSessionApproval(
  sessionId: string,
  approvalId: string,
  decision: AnuDecision,
  options: AnuRequestOptions,
): Promise<void> {
  return anuRequest(
    "POST",
    `/v1/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
    null,
    { ...options, body: { decision } },
  );
}

// ---------------------------------------------------------------------------
// Bots (anu/docs/design/phone-app.md, section D). A bot is a profile the
// person made or was given: a name, a face, how it greets and what it is
// told. Chats and tasks run with one.
// ---------------------------------------------------------------------------

export const BOT_STATUSES = ["waiting_for_you", "working", "failed", "idle"] as const;
export type AnuBotStatus = (typeof BOT_STATUSES)[number];

export const anuStarterSchema = z.object({
  label: z.string(),
  prompt: z.string(),
});

export type AnuStarter = z.infer<typeof anuStarterSchema>;

export const anuBotSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().default(""),
  personality: z.string().default(""),
  greeting: z.string().default(""),
  instructions: z.string().default(""),
  starters: z.array(anuStarterSchema).default([]),
  avatar: anuAvatarTraitsSchema,
  modelProfile: z.string().nullable().default(null),
  skills: z.array(z.string()).default([]),
  locale: z.string().default("en"),
  isDefault: z.boolean().default(false),
  defaultKey: z.string().nullable().default(null),
  deletable: z.boolean().default(true),
  status: z
    .string()
    .transform((value): AnuBotStatus =>
      (BOT_STATUSES as readonly string[]).includes(value) ? (value as AnuBotStatus) : "idle",
    )
    .default("idle"),
  lastUsedAt: z.string().nullable().default(null),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

export type AnuBot = z.infer<typeof anuBotSchema>;

/** What a bot is made from: everything the person can set. */
export interface AnuBotInput {
  name: string;
  role?: string;
  personality?: string;
  greeting?: string;
  instructions?: string;
  starters?: AnuStarter[];
  avatar?: AnuAvatarTraits;
  modelProfile?: string | null;
  skills?: string[];
  locale?: "ar" | "en";
}

const botListSchema = z.object({
  bots: z.array(anuBotSchema),
  defaultBotId: z.string().nullable().default(null),
});

export type AnuBotList = z.infer<typeof botListSchema>;

export const anuBotOptionsSchema = z.object({
  modelProfiles: z.array(z.string()).default([]),
  skills: z.array(z.object({ id: z.string(), label: z.string() })).default([]),
  templates: z
    .array(z.object({ key: z.string(), label: z.string(), description: z.string() }))
    .default([]),
});

export type AnuBotOptions = z.infer<typeof anuBotOptionsSchema>;

export const anuBotDraftSchema = z.object({
  draft: z.object({
    name: z.string(),
    role: z.string().default(""),
    personality: z.string().default(""),
    greeting: z.string().default(""),
    instructions: z.string().default(""),
    starters: z.array(anuStarterSchema).default([]),
    avatar: anuAvatarTraitsSchema.optional(),
    modelProfile: z.string().nullable().optional(),
    skills: z.array(z.string()).optional(),
    locale: z.enum(["ar", "en"]).optional(),
  }),
  source: z.enum(["model", "fallback"]),
  fallbackReason: z.string().nullable().optional(),
});

export type AnuBotDraft = z.infer<typeof anuBotDraftSchema>;

export function fetchAnuBots(options: AnuRequestOptions): Promise<AnuBotList> {
  return anuRequest("GET", "/v1/bots", botListSchema, options);
}

export function fetchAnuBot(botId: string, options: AnuRequestOptions): Promise<AnuBot> {
  return anuRequest("GET", `/v1/bots/${encodeURIComponent(botId)}`, anuBotSchema, options);
}

export function fetchAnuBotOptions(options: AnuRequestOptions): Promise<AnuBotOptions> {
  return anuRequest("GET", "/v1/bots/options", anuBotOptionsSchema, options);
}

export function draftAnuBot(
  input: { description: string; locale?: "ar" | "en" },
  options: AnuRequestOptions,
): Promise<AnuBotDraft> {
  return anuRequest("POST", "/v1/bots/draft", anuBotDraftSchema, { ...options, body: input });
}

export function createAnuBot(input: AnuBotInput, options: AnuRequestOptions): Promise<AnuBot> {
  return anuRequest("POST", "/v1/bots", anuBotSchema, { ...options, body: input });
}

export function updateAnuBot(
  botId: string,
  patch: Partial<AnuBotInput>,
  options: AnuRequestOptions,
): Promise<AnuBot> {
  return anuRequest("PATCH", `/v1/bots/${encodeURIComponent(botId)}`, anuBotSchema, {
    ...options,
    body: patch,
  });
}

export function deleteAnuBot(botId: string, options: AnuRequestOptions): Promise<void> {
  return anuRequest("DELETE", `/v1/bots/${encodeURIComponent(botId)}`, null, options);
}

export function duplicateAnuBot(botId: string, options: AnuRequestOptions): Promise<AnuBot> {
  return anuRequest(
    "POST",
    `/v1/bots/${encodeURIComponent(botId)}/duplicate`,
    anuBotSchema,
    options,
  );
}

export function setAnuDefaultBot(botId: string, options: AnuRequestOptions): Promise<void> {
  return anuRequest("PUT", "/v1/me/default-bot", null, { ...options, body: { botId } });
}
