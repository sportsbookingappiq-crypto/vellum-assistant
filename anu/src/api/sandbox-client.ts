import { z } from "zod";

import type { BotProfile } from "../sandbox/drivers/types.js";

/** The sandbox's answer to a bot draft job. `json` is the model's raw reply. */
export interface DraftResult {
  status: "succeeded" | "unavailable" | "failed" | "timeout";
  json?: string;
  error?: string;
}

/** A backstop just past the sandbox's own per-driver draft limit. */
export const DRAFT_WAIT_MS = 65_000;

const DraftResultBody = z.object({
  status: z.enum(["succeeded", "unavailable", "failed", "timeout"]),
  json: z.string().optional(),
  error: z.string().optional(),
});

/** Read-only workspace resources the sandbox serves for a task. */
export type WorkspaceResource = "files" | "files/content" | "browser" | "browser/frame";

/** Response headers passed through from the sandbox to the client. */
const PASS_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "content-security-policy",
  "x-content-type-options",
  "last-modified",
  "cache-control",
];

/** How the API talks to the sandbox server. Tests substitute a fake. */
export interface SandboxClient {
  startRun(taskId: string, goal: string, bot?: BotProfile): Promise<{ driver: string }>;
  stopRun(taskId: string): Promise<void>;
  sendDecision(taskId: string, approvalId: string, decision: "approved" | "rejected"): Promise<void>;
  deleteRun(taskId: string): Promise<void>;
  /** Sends one chat turn; the sandbox starts the session's worker if needed. */
  sendTurn(
    sessionId: string,
    turnId: string,
    text: string,
    history: { role: "user" | "assistant"; text: string }[],
    bot?: BotProfile,
  ): Promise<{ driver: string }>;
  /** Runs a bot draft job and waits for it (up to DRAFT_WAIT_MS). */
  draft(description: string, locale: "ar" | "en"): Promise<DraftResult>;
  stopSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  /** Proxies a read of the task workspace. The response is safe to return to the task owner. */
  read(taskId: string, resource: WorkspaceResource, query: Record<string, string>): Promise<Response>;
}

export class HttpSandboxClient implements SandboxClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly timeoutMs = 10_000,
  ) {}

  private async call(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${this.internalToken}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    if (!res.ok && res.status !== 404) {
      throw new Error(`sandbox ${method} ${path} failed with HTTP ${res.status}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async startRun(taskId: string, goal: string, bot?: BotProfile) {
    const body = (await this.call("POST", "/v1/runs", { taskId, goal, ...(bot ? { bot } : {}) })) as { driver?: string } | null;
    return { driver: body?.driver ?? "unknown" };
  }

  async stopRun(taskId: string) {
    await this.call("POST", `/v1/runs/${taskId}/stop`);
  }

  async sendDecision(taskId: string, approvalId: string, decision: "approved" | "rejected") {
    await this.call("POST", `/v1/runs/${taskId}/approvals/${approvalId}`, { decision });
  }

  async deleteRun(taskId: string) {
    await this.call("DELETE", `/v1/runs/${taskId}`);
  }

  async sendTurn(
    sessionId: string,
    turnId: string,
    text: string,
    history: { role: "user" | "assistant"; text: string }[],
    bot?: BotProfile,
  ) {
    const body = (await this.call("POST", `/v1/sessions/${sessionId}/turns`, { turnId, text, history, ...(bot ? { bot } : {}) })) as {
      driver?: string;
    } | null;
    return { driver: body?.driver ?? "unknown" };
  }

  async draft(description: string, locale: "ar" | "en"): Promise<DraftResult> {
    try {
      const body = DraftResultBody.safeParse(await this.call("POST", "/internal/drafts", { description, locale }, DRAFT_WAIT_MS));
      return body.success ? body.data : { status: "failed", error: "unreadable draft response" };
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return { status: timedOut ? "timeout" : "failed", error: error instanceof Error ? error.message : String(error) };
    }
  }

  async stopSession(sessionId: string) {
    await this.call("POST", `/v1/sessions/${sessionId}/stop`);
  }

  async deleteSession(sessionId: string) {
    await this.call("DELETE", `/v1/sessions/${sessionId}`);
  }

  async read(taskId: string, resource: WorkspaceResource, query: Record<string, string>): Promise<Response> {
    const url = new URL(`/v1/runs/${taskId}/${resource}`, this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${this.internalToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status >= 500 || res.status === 401) {
      throw new Error(`sandbox GET ${resource} failed with HTTP ${res.status}`);
    }
    const headers = new Headers();
    for (const name of PASS_HEADERS) {
      const value = res.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(res.body, { status: res.status, headers });
  }
}
