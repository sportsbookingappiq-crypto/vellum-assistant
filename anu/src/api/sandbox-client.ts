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
  startRun(taskId: string, goal: string): Promise<{ driver: string }>;
  stopRun(taskId: string): Promise<void>;
  sendDecision(taskId: string, approvalId: string, decision: "approved" | "rejected"): Promise<void>;
  deleteRun(taskId: string): Promise<void>;
  /** Proxies a read of the task workspace. The response is safe to return to the task owner. */
  read(taskId: string, resource: WorkspaceResource, query: Record<string, string>): Promise<Response>;
}

export class HttpSandboxClient implements SandboxClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly timeoutMs = 10_000,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${this.internalToken}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok && res.status !== 404) {
      throw new Error(`sandbox ${method} ${path} failed with HTTP ${res.status}`);
    }
    return text ? JSON.parse(text) : null;
  }

  async startRun(taskId: string, goal: string) {
    const body = (await this.call("POST", "/v1/runs", { taskId, goal })) as { driver?: string } | null;
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
