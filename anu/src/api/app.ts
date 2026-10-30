import { z } from "zod";

import { AuthService, type SessionUser } from "../auth/service.js";
import { corsOriginMatcher } from "../config.js";
import { bearer, errorResponse, HttpError, json, readJson, safeEqual } from "../lib/http.js";
import type { Logger } from "../lib/log.js";
import { isTerminal, STEP_KINDS, STEP_STATUSES, stepView, taskView, approvalView } from "./model.js";
import type { TaskService } from "./tasks.js";

export interface AppDeps {
  auth: AuthService;
  tasks: TaskService;
  internalToken: string;
  corsOrigins: string;
  log: Logger;
  /** Interval for the SSE fallback poll and heartbeat, in milliseconds. */
  ssePollMs?: number;
  sseHeartbeatMs?: number;
}

export type Handler = (req: Request, clientAddress: string) => Promise<Response>;

type Params = Record<string, string>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handle: (ctx: { req: Request; params: Params; client: string; url: URL }) => Promise<Response>;
}

function route(method: string, path: string, handle: Route["handle"]): Route {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      }) +
      "$",
  );
  return { method, pattern, keys, handle };
}

const StepBody = z.object({
  kind: z.enum(STEP_KINDS),
  title: z.string().min(1).max(500),
  detail: z.unknown().optional(),
  status: z.enum(STEP_STATUSES).optional(),
});
const FinishBody = z.object({
  status: z.enum(["succeeded", "failed"]),
  result: z.string().max(100_000).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});
const ApprovalBody = z.object({ prompt: z.string().min(1).max(2000), detail: z.unknown().optional() });

function validate<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "invalid_body", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

const field = (body: unknown, key: string): unknown =>
  body && typeof body === "object" ? (body as Record<string, unknown>)[key] : undefined;

export function createApp(deps: AppDeps): Handler {
  const { auth, tasks, log } = deps;
  const originAllowed = corsOriginMatcher(deps.corsOrigins);
  const pollMs = deps.ssePollMs ?? 1000;
  const heartbeatMs = deps.sseHeartbeatMs ?? 15_000;

  async function requireUser(req: Request): Promise<SessionUser> {
    const session = await auth.authenticate(bearer(req));
    if (!session) throw new HttpError(401, "unauthorized", "A valid session token is required");
    return session;
  }

  function requireInternal(req: Request): void {
    const token = bearer(req);
    if (!token || !safeEqual(token, deps.internalToken)) {
      throw new HttpError(401, "unauthorized", "Internal token required");
    }
  }

  function events(req: Request, user: SessionUser, taskId: string, url: URL): Response {
    const afterParam = url.searchParams.get("after") ?? req.headers.get("last-event-id") ?? "0";
    let lastSeq = /^\d+$/.test(afterParam) ? Number(afterParam) : 0;
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let wake: (() => void) | null = null;
        const unsubscribe = tasks.events.subscribe(taskId, () => wake?.());
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe();
          wake?.();
          try {
            controller.close();
          } catch {}
        };
        req.signal.addEventListener("abort", close);
        const send = (event: string, data: unknown, id?: number) => {
          if (closed) return;
          const idLine = id === undefined ? "" : `id: ${id}\n`;
          controller.enqueue(encoder.encode(`event: ${event}\n${idLine}data: ${JSON.stringify(data)}\n\n`));
        };
        let lastFingerprint = "";
        let lastBeat = Date.now();
        controller.enqueue(encoder.encode(`retry: 2000\n\n`));
        try {
          while (!closed) {
            const snap = await tasks.snapshot(user.userId, taskId, lastSeq);
            if (!snap) {
              send("end", { reason: "deleted" });
              break;
            }
            for (const step of snap.steps) {
              send("step", stepView(step), step.seq);
              lastSeq = step.seq;
            }
            const approvals = snap.approvals.map(approvalView);
            const fingerprint = `${snap.task.status}|${snap.task.updated_at.getTime()}|${approvals.map((a) => a.status).join(",")}`;
            if (fingerprint !== lastFingerprint) {
              lastFingerprint = fingerprint;
              send("task", { ...taskView(snap.task), approvals });
            }
            if (isTerminal(snap.task.status)) {
              send("end", { status: snap.task.status });
              break;
            }
            if (Date.now() - lastBeat >= heartbeatMs) {
              controller.enqueue(encoder.encode(`: ping\n\n`));
              lastBeat = Date.now();
            }
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, pollMs);
              wake = () => {
                clearTimeout(timer);
                resolve();
              };
            });
            wake = null;
          }
        } catch (error) {
          log.error("sse.failed", { taskId, error });
          send("error", { message: "stream failed" });
        }
        close();
      },
      cancel() {
        closed = true;
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  const routes: Route[] = [
    route("GET", "/healthz", async () => json({ status: "ok" })),

    route("POST", "/v1/auth/code/request", async ({ req, client }) => {
      const body = await readJson(req);
      const result = await auth.requestCode(field(body, "phone"), client);
      return json({ expiresAt: result.expiresAt.toISOString(), ...(result.devCode ? { devCode: result.devCode } : {}) }, 202);
    }),
    route("POST", "/v1/auth/code/verify", async ({ req }) => {
      const body = await readJson(req);
      const result = await auth.verifyCode(field(body, "phone"), field(body, "code"));
      return json({ token: result.token, tokenType: "Bearer", expiresAt: result.expiresAt.toISOString(), userId: result.userId });
    }),
    route("POST", "/v1/auth/logout", async ({ req }) => {
      const user = await requireUser(req);
      await auth.logout(user);
      return new Response(null, { status: 204 });
    }),

    route("GET", "/v1/me", async ({ req }) => {
      const user = await requireUser(req);
      return json(await tasks.me(user.userId));
    }),
    route("GET", "/v1/me/export", async ({ req }) => {
      const user = await requireUser(req);
      const data = await tasks.exportUser(user.userId);
      return json(data, 200, { "content-disposition": 'attachment; filename="anu-export.json"' });
    }),
    route("DELETE", "/v1/me", async ({ req }) => {
      const user = await requireUser(req);
      await tasks.deleteUser(user.userId);
      return new Response(null, { status: 204 });
    }),

    route("POST", "/v1/tasks", async ({ req }) => {
      const user = await requireUser(req);
      const body = await readJson(req);
      return json(await tasks.create(user.userId, field(body, "goal")), 201);
    }),
    route("GET", "/v1/tasks", async ({ req, url }) => {
      const user = await requireUser(req);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1), 200);
      return json({ tasks: await tasks.list(user.userId, limit) });
    }),
    route("GET", "/v1/tasks/:id", async ({ req, params }) => {
      const user = await requireUser(req);
      return json(await tasks.get(user.userId, params.id!));
    }),
    route("GET", "/v1/tasks/:id/steps", async ({ req, params, url }) => {
      const user = await requireUser(req);
      const after = Number(url.searchParams.get("after") ?? "0") || 0;
      return json({ steps: await tasks.steps(user.userId, params.id!, after) });
    }),
    route("GET", "/v1/tasks/:id/events", async ({ req, params, url }) => {
      const user = await requireUser(req);
      await tasks.get(user.userId, params.id!); // 404 before opening a stream
      return events(req, user, params.id!, url);
    }),
    route("POST", "/v1/tasks/:id/stop", async ({ req, params }) => {
      const user = await requireUser(req);
      return json(await tasks.stop(user.userId, params.id!));
    }),
    route("POST", "/v1/tasks/:id/approvals/:approvalId", async ({ req, params }) => {
      const user = await requireUser(req);
      const body = await readJson(req);
      return json(await tasks.decide(user.userId, params.id!, params.approvalId!, field(body, "decision")));
    }),

    route("GET", "/v1/tasks/:id/files", async ({ req, params, url }) => {
      const user = await requireUser(req);
      return tasks.workspaceRead(user.userId, params.id!, "files", { path: url.searchParams.get("path") ?? "" });
    }),
    route("GET", "/v1/tasks/:id/files/content", async ({ req, params, url }) => {
      const user = await requireUser(req);
      return tasks.workspaceRead(user.userId, params.id!, "files/content", { path: url.searchParams.get("path") ?? "" });
    }),
    route("GET", "/v1/tasks/:id/browser", async ({ req, params }) => {
      const user = await requireUser(req);
      return tasks.workspaceRead(user.userId, params.id!, "browser", {});
    }),
    route("GET", "/v1/tasks/:id/browser/frame", async ({ req, params, url }) => {
      const user = await requireUser(req);
      return tasks.workspaceRead(user.userId, params.id!, "browser/frame", { frameId: url.searchParams.get("frameId") ?? "" });
    }),

    // Internal endpoints, for the sandbox server only.
    route("POST", "/internal/v1/tasks/:id/steps", async ({ req, params }) => {
      requireInternal(req);
      const body = validate(StepBody, await readJson(req));
      return json(await tasks.systemAddStep(params.id!, body), 201);
    }),
    route("POST", "/internal/v1/tasks/:id/approvals", async ({ req, params }) => {
      requireInternal(req);
      const body = validate(ApprovalBody, await readJson(req));
      return json(await tasks.systemRequestApproval(params.id!, body.prompt, body.detail ?? {}), 201);
    }),
    route("GET", "/internal/v1/tasks/:id/approvals/:approvalId", async ({ req, params }) => {
      requireInternal(req);
      return json(await tasks.systemGetApproval(params.id!, params.approvalId!));
    }),
    route("POST", "/internal/v1/tasks/:id/finish", async ({ req, params }) => {
      requireInternal(req);
      const body = validate(FinishBody, await readJson(req));
      const row = await tasks.systemFinish(params.id!, body.status, body.result ?? null, body.confidence ?? null);
      return json(taskView(row));
    }),
  ];

  function corsHeaders(req: Request, path: string): Record<string, string> {
    const origin = req.headers.get("origin");
    if (!origin || path.startsWith("/internal/") || !originAllowed(origin)) return {};
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, last-event-id",
      "access-control-max-age": "600",
      vary: "Origin",
    };
  }

  return async (req, clientAddress) => {
    const started = performance.now();
    const url = new URL(req.url);
    const cors = corsHeaders(req, url.pathname);
    let response: Response;
    if (req.method === "OPTIONS") {
      response = new Response(null, { status: cors["access-control-allow-origin"] ? 204 : 403 });
    } else {
      response = await dispatch(req, url, clientAddress);
    }
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    if (url.pathname !== "/healthz") {
      log.info("http.request", {
        method: req.method,
        path: url.pathname,
        status: response.status,
        ms: Math.round(performance.now() - started),
      });
    }
    return response;
  };

  async function dispatch(req: Request, url: URL, client: string): Promise<Response> {
    let methodMismatch = false;
    for (const candidate of routes) {
      const match = candidate.pattern.exec(url.pathname);
      if (!match) continue;
      if (candidate.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      const params: Params = {};
      candidate.keys.forEach((key, index) => (params[key] = decodeURIComponent(match[index + 1]!)));
      try {
        return await candidate.handle({ req, params, client, url });
      } catch (error) {
        if (error instanceof HttpError) return errorResponse(error);
        log.error("http.unhandled", { path: url.pathname, error });
        return errorResponse(new HttpError(500, "internal", "Internal error"));
      }
    }
    return errorResponse(
      methodMismatch ? new HttpError(405, "method_not_allowed", "Method not allowed") : new HttpError(404, "not_found", "Not found"),
    );
  }
}
