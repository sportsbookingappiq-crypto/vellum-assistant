import { randomBytes } from "node:crypto";
import os from "node:os";

import { buildApi } from "../api/server.js";
import { mkdtempSync } from "node:fs";
import path from "node:path";

import type { DraftResult, SandboxClient, WorkspaceResource } from "../api/sandbox-client.js";
import type { BotProfile } from "../sandbox/drivers/types.js";
import { errorResponse, HttpError } from "../lib/http.js";
import { serveWorkspaceRead } from "../sandbox/server.js";
import { loadApiConfig, type ApiConfig } from "../config.js";
import { connect, type Sql } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { createLogger } from "../lib/log.js";

export const TEST_ROLE = "anu_platform_app";

export function testDatabaseUrl(): string {
  return (
    process.env.ANU_TEST_DATABASE_URL ||
    `postgres://${os.userInfo().username}@localhost:5432/anu_platform_test?host=/var/run/postgresql`
  );
}

let migrated = false;
/** An admin connection to the test database, migrated once per process. */
export async function adminSql(): Promise<Sql> {
  const sql = connect(testDatabaseUrl(), { max: 2 });
  if (!migrated) {
    await migrate(sql, TEST_ROLE);
    migrated = true;
  }
  return sql;
}

export const secret = () => randomBytes(32).toString("hex");

export function testConfig(overrides: Record<string, string> = {}): ApiConfig {
  return loadApiConfig({
    ANU_ENV: "test",
    OTP_SENDER: "dev",
    DATABASE_URL: testDatabaseUrl(),
    ANU_DB_APP_ROLE: TEST_ROLE,
    ANU_OTP_SECRET: secret(),
    ANU_INTERNAL_TOKEN: secret(),
    ...overrides,
  });
}

export class FakeSandbox implements SandboxClient {
  calls: { op: string; taskId: string; extra?: unknown }[] = [];
  failStart = false;
  async startRun(taskId: string, _goal: string, bot?: BotProfile) {
    if (this.failStart) throw new Error("sandbox down");
    this.calls.push({ op: "start", taskId, extra: { bot } });
    return { driver: "fake" };
  }
  async stopRun(taskId: string) {
    this.calls.push({ op: "stop", taskId });
  }
  async sendDecision(taskId: string, approvalId: string, decision: string) {
    this.calls.push({ op: "decision", taskId, extra: { approvalId, decision } });
  }
  async deleteRun(taskId: string) {
    this.calls.push({ op: "delete", taskId });
  }
  turns: { sessionId: string; turnId: string; text: string; history: unknown[]; bot?: BotProfile }[] = [];
  async sendTurn(sessionId: string, turnId: string, text: string, history: unknown[], bot?: BotProfile) {
    if (this.failStart) throw new Error("sandbox down");
    this.turns.push({ sessionId, turnId, text, history, ...(bot ? { bot } : {}) });
    return { driver: "fake" };
  }
  /** What the next draft job returns. Defaults to the scripted driver's answer. */
  draftResult: DraftResult = { status: "unavailable", error: "the scripted driver has no model to draft a bot with" };
  drafts: { description: string; locale: string }[] = [];
  async draft(description: string, locale: "ar" | "en") {
    this.drafts.push({ description, locale });
    return this.draftResult;
  }
  async stopSession(sessionId: string) {
    this.calls.push({ op: "stopSession", taskId: sessionId });
  }
  async deleteSession(sessionId: string) {
    this.calls.push({ op: "deleteSession", taskId: sessionId });
  }
  /** Workspaces for `read`, one directory per task under this root. */
  workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "anu-fake-sandbox-"));
  async read(taskId: string, resource: WorkspaceResource, query: Record<string, string>) {
    this.calls.push({ op: "read", taskId, extra: { resource, query } });
    try {
      return await serveWorkspaceRead(path.join(this.workspaceRoot, taskId), resource, query);
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error);
      throw error;
    }
  }
}

export interface TestApi {
  config: ApiConfig;
  call: (method: string, path: string, options?: { token?: string; body?: unknown; client?: string; headers?: Record<string, string> }) => Promise<Response>;
  login: (phone: string) => Promise<string>;
  sandbox: FakeSandbox;
  clock: { now: Date };
  logs: string[];
  api: ReturnType<typeof buildApi>;
  close: () => Promise<void>;
}

export function makeTestApi(overrides: Record<string, string> = {}): TestApi {
  const config = testConfig(overrides);
  const sandbox = new FakeSandbox();
  const clock = { now: new Date() };
  const logs: string[] = [];
  const api = buildApi({
    config,
    sandbox,
    now: () => clock.now,
    log: createLogger("api", (line) => logs.push(line)),
  });
  let clientCounter = 0;
  const call: TestApi["call"] = (method, path, options = {}) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const req = new Request(`http://anu.test${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return api.handler(req, options.client ?? `10.0.0.${++clientCounter % 250}`);
  };
  const login = async (phone: string) => {
    const requested = await call("POST", "/v1/auth/code/request", { body: { phone } });
    if (requested.status !== 202) throw new Error(`code request failed: ${requested.status} ${await requested.text()}`);
    const { devCode } = (await requested.json()) as { devCode: string };
    const verified = await call("POST", "/v1/auth/code/verify", { body: { phone, code: devCode } });
    if (verified.status !== 200) throw new Error(`verify failed: ${verified.status}`);
    return ((await verified.json()) as { token: string }).token;
  };
  return { config, call, login, sandbox, clock, logs, api, close: () => api.db.close() };
}

/** Deletes users with these phone numbers so a test file starts clean. */
export async function resetPhones(sql: Sql, phones: string[]): Promise<void> {
  await sql`delete from login_codes where phone in ${sql(phones)}`;
  await sql`delete from users where phone in ${sql(phones)}`;
}
