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
export type AnuSession = z.infer<typeof sessionSchema>;
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
  method: "GET" | "POST" | "DELETE",
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
): Promise<AnuSession> {
  return anuRequest("POST", "/v1/auth/code/verify", sessionSchema, {
    ...options,
    body: { phone, code },
  });
}

export function logoutAnu(options: AnuRequestOptions): Promise<void> {
  return anuRequest("POST", "/v1/auth/logout", null, options);
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

export function fetchAnuFiles(
  taskId: string,
  path: string,
  options: AnuRequestOptions,
): Promise<AnuFileList> {
  return anuRequest(
    "GET",
    `/v1/tasks/${encodeURIComponent(taskId)}/files?path=${encodeURIComponent(path)}`,
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
  taskId: string,
  path: string,
  options: AnuRequestOptions,
): Promise<AnuBlob> {
  return fetchAnuBlob(
    `/v1/tasks/${encodeURIComponent(taskId)}/files/content?path=${encodeURIComponent(path)}`,
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
  taskId: string,
  options: AnuRequestOptions,
): Promise<AnuBrowserState | null> {
  try {
    return await anuRequest(
      "GET",
      `/v1/tasks/${encodeURIComponent(taskId)}/browser`,
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
  taskId: string,
  frameId: string | null | undefined,
  options: AnuRequestOptions,
): Promise<AnuBlob> {
  const query = frameId ? `?frameId=${encodeURIComponent(frameId)}` : "";
  return fetchAnuBlob(
    `/v1/tasks/${encodeURIComponent(taskId)}/browser/frame${query}`,
    options,
  );
}
