import { z } from "zod";

import type { WorkspaceResource } from "../api/sandbox-client.js";
import { loadSandboxConfig, type SandboxConfig } from "../config.js";
import { bearer, errorResponse, HttpError, json, readJson, safeEqual } from "../lib/http.js";
import { createLogger, type Logger } from "../lib/log.js";
import type { DriverSettings } from "./protocol.js";
import { listFrames, readFrame } from "./browser-frames.js";
import { listDirectory, readWorkspaceFile } from "./workspace-files.js";
import { HttpReporter, HttpSessionReporter, RunManager, type Reporter, type SessionReporter } from "./runs.js";
import { SessionManager } from "./sessions.js";
import { DraftRunner } from "./drafts.js";

/** A bot profile as the API sends it (see drivers/types.ts BotProfile). */
export const BotProfileBody = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(40),
  role: z.string().max(120),
  personality: z.string().max(200),
  instructions: z.string().max(4000),
  avatar: z.object({ bodyShape: z.string().min(1).max(40), eyeStyle: z.string().min(1).max(40), color: z.string().min(1).max(40) }),
  modelProfile: z.string().max(80).nullable(),
  skills: z.array(z.string().max(120)).max(20),
  version: z.string().regex(/^[0-9a-f]{64}$/),
});
const RunBody = z.object({ taskId: z.uuid(), goal: z.string().min(1).max(4000), bot: BotProfileBody.optional() });
const DraftBody = z.object({ description: z.string().min(1).max(500), locale: z.enum(["ar", "en"]).default("en") });
const TurnBody = z.object({
  turnId: z.uuid(),
  text: z.string().min(1).max(20_000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(100_000) })).max(500).default([]),
  bot: BotProfileBody.optional(),
});
const DecisionBody = z.object({ decision: z.enum(["approved", "rejected"]) });

/** Serves a read-only view of a task workspace: directory listings, file content, browser frames. */
export async function serveWorkspaceRead(workspace: string, resource: WorkspaceResource, query: Record<string, string>): Promise<Response> {
  switch (resource) {
    case "files":
      return json(await listDirectory(workspace, query.path ?? ""));
    case "files/content":
      return readWorkspaceFile(workspace, query.path ?? "");
    case "browser": {
      const frames = await listFrames(workspace);
      return json({ latest: frames.at(-1) ?? null, frames: frames.slice().reverse() });
    }
    case "browser/frame":
      return readFrame(workspace, query.frameId ?? "");
  }
}

export function driverSettings(config: SandboxConfig): DriverSettings {
  return {
    kiloBaseUrl: config.KILO_BASE_URL ?? "https://ai-gateway.kilo.ai/api/v1",
    kiloApiKey: config.KILO_API_KEY ?? "anonymous",
    kiloModel: config.KILO_MODEL,
    assistantDir: config.ANU_ASSISTANT_DIR,
    scriptedStepDelayMs: config.ANU_SCRIPTED_STEP_DELAY_MS,
    allowInsecureHarness: config.ANU_ENV === "dev" || config.ANU_ENV === "test",
  };
}

/**
 * How long a draft may take. A harness draft boots a whole runtime before the
 * model turn; a kilo draft is one completion. The sandbox enforces this and
 * answers `timeout`, which the API turns into a template draft.
 */
export const draftTimeoutMs = (driver: SandboxConfig["ANU_SANDBOX_DRIVER"]) => (driver === "harness" ? 60_000 : 14_000);

export function buildSandbox(
  config: SandboxConfig,
  options: { reporter?: Reporter; sessionReporter?: SessionReporter; log?: Logger } = {},
) {
  const log = options.log ?? createLogger("sandbox");
  const runs = new RunManager({
    root: config.ANU_SANDBOX_ROOT,
    driver: config.ANU_SANDBOX_DRIVER,
    settings: driverSettings(config),
    timeoutMs: config.ANU_TASK_TIMEOUT_SECONDS * 1000,
    reporter: options.reporter ?? new HttpReporter(config.ANU_API_URL, config.ANU_INTERNAL_TOKEN),
    log,
  });
  const sessions = new SessionManager({
    root: config.ANU_SANDBOX_ROOT,
    driver: config.ANU_SANDBOX_DRIVER,
    settings: driverSettings(config),
    turnTimeoutMs: config.ANU_TASK_TIMEOUT_SECONDS * 1000,
    idleMs: config.ANU_SESSION_IDLE_SECONDS * 1000,
    reporter: options.sessionReporter ?? new HttpSessionReporter(config.ANU_API_URL, config.ANU_INTERNAL_TOKEN),
    log,
  });

  const drafts = new DraftRunner({
    root: config.ANU_SANDBOX_ROOT,
    driver: config.ANU_SANDBOX_DRIVER,
    settings: driverSettings(config),
    timeoutMs: draftTimeoutMs(config.ANU_SANDBOX_DRIVER),
    log,
  });

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/healthz" && req.method === "GET") {
      return json({ status: "ok", driver: config.ANU_SANDBOX_DRIVER, activeRuns: runs.active, activeSessions: sessions.active });
    }
    const token = bearer(req);
    if (!token || !safeEqual(token, config.ANU_INTERNAL_TOKEN)) {
      throw new HttpError(401, "unauthorized", "Internal token required");
    }
    if (url.pathname === "/v1/runs" && req.method === "POST") {
      const parsed = RunBody.safeParse(await readJson(req));
      if (!parsed.success) throw new HttpError(400, "invalid_body", "taskId (uuid) and goal are required");
      return json(await runs.start(parsed.data.taskId, parsed.data.goal, parsed.data.bot), 202);
    }
    if (url.pathname === "/internal/drafts" && req.method === "POST") {
      const parsed = DraftBody.safeParse(await readJson(req));
      if (!parsed.success) throw new HttpError(400, "invalid_body", "description (1 to 500 characters) is required");
      return json(await drafts.run(parsed.data.description, parsed.data.locale));
    }
    const session = /^\/v1\/sessions\/([0-9a-f-]{36})(\/turns|\/stop)?$/i.exec(url.pathname);
    if (session) {
      const sessionId = session[1]!;
      if (session[2] === "/turns" && req.method === "POST") {
        const parsed = TurnBody.safeParse(await readJson(req));
        if (!parsed.success) throw new HttpError(400, "invalid_body", "turnId (uuid) and text are required");
        const { turnId, text, history, bot } = parsed.data;
        return json(await sessions.turn(sessionId, turnId, text, history, bot), 202);
      }
      if (session[2] === "/stop" && req.method === "POST") return json({ stopped: await sessions.stop(sessionId) });
      if (!session[2] && req.method === "DELETE") {
        await sessions.remove(sessionId);
        return new Response(null, { status: 204 });
      }
    }
    const read = /^\/v1\/runs\/([0-9a-f-]{36})\/(files|files\/content|browser|browser\/frame)$/i.exec(url.pathname);
    if (read && req.method === "GET") {
      return serveWorkspaceRead(runs.workspaceFor(read[1]!), read[2] as WorkspaceResource, Object.fromEntries(url.searchParams));
    }
    const match = /^\/v1\/runs\/([0-9a-f-]{36})(\/stop|\/approvals\/([0-9a-f-]{36}))?$/i.exec(url.pathname);
    if (match) {
      const taskId = match[1]!;
      if (match[2] === "/stop" && req.method === "POST") {
        return json({ stopped: await runs.stop(taskId) });
      }
      if (match[3] && req.method === "POST") {
        const parsed = DecisionBody.safeParse(await readJson(req));
        if (!parsed.success) throw new HttpError(400, "invalid_body", "decision must be approved or rejected");
        const delivered =
          runs.decide(taskId, match[3], parsed.data.decision) || sessions.decide(taskId, match[3], parsed.data.decision);
        return json({ delivered }, delivered ? 200 : 404);
      }
      if (!match[2] && req.method === "DELETE") {
        await runs.remove(taskId);
        return new Response(null, { status: 204 });
      }
    }
    throw new HttpError(404, "not_found", "Not found");
  }

  const handler = async (req: Request): Promise<Response> => {
    try {
      return await handle(req);
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error);
      log.error("http.unhandled", { error });
      return errorResponse(new HttpError(500, "internal", "Internal error"));
    }
  };
  return { runs, sessions, drafts, handler, log };
}

if (import.meta.main) {
  const config = loadSandboxConfig(process.env);
  const sandbox = buildSandbox(config);
  const server = Bun.serve({
    hostname: config.ANU_SANDBOX_HOST,
    port: config.ANU_SANDBOX_PORT,
    fetch: sandbox.handler,
  });
  sandbox.log.info("sandbox.listening", {
    url: server.url.toString(),
    driver: config.ANU_SANDBOX_DRIVER,
    root: config.ANU_SANDBOX_ROOT,
  });
  const shutdown = async () => {
    server.stop(true);
    await Promise.all([sandbox.runs.shutdown(), sandbox.sessions.shutdown()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
