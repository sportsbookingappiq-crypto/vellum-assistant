import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

import { runTurn, type RuntimeClient } from "./harness-turn.js";
import { DriverUnavailableError, sleep, type Driver, type DriverContext, type DriverOutcome } from "./types.js";

/**
 * Boots the real assistant runtime (../assistant) for one task in the same
 * topology as a local `hatch`: the credential executor (CES), the daemon, and
 * the gateway, each in its own process group. It then leases a guardian token
 * from the gateway with a one-time bootstrap secret, configures the Kilo
 * Gateway as an `openai-compatible` connection, sends the goal, and maps the
 * event stream to steps (see harness-turn.ts).
 *
 * HTTP auth stays on: every call carries the guardian token. Because the
 * caller is the guardian, assistant tools run under the normal guardian
 * permission rules, the risk classifier is reachable over the gateway, and
 * consent prompts reach the user as ANU approvals.
 *
 * Still dev and test only: there is no network isolation, and the gateway
 * listens on all interfaces like a local hatch does.
 */

const READY_TIMEOUT_MS = 180_000;
const TURN_TIMEOUT_MS = 8 * 60_000;
const PROFILE = "kilo-free";

async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

interface Service {
  name: string;
  proc: Bun.Subprocess;
}

export const harnessDriver: Driver = {
  name: "harness",
  async run(ctx: DriverContext): Promise<DriverOutcome> {
    const { assistantDir, allowInsecureHarness, kiloBaseUrl, kiloApiKey, kiloModel } = ctx.settings;
    if (!allowInsecureHarness) {
      throw new DriverUnavailableError(
        "The harness driver runs an unisolated local assistant and is allowed only when ANU_ENV is dev or test.",
      );
    }
    const repoDir = path.dirname(assistantDir);
    const entries = {
      daemon: path.join(assistantDir, "src", "daemon", "main.ts"),
      gateway: path.join(repoDir, "gateway", "src", "index.ts"),
      ces: path.join(repoDir, "credential-executor", "src", "main.ts"),
    };
    for (const [name, entry] of Object.entries(entries)) {
      if (!existsSync(entry)) throw new DriverUnavailableError(`assistant ${name} entry not found at ${entry}`);
    }
    if (!existsSync(path.join(assistantDir, "node_modules"))) {
      throw new DriverUnavailableError(`assistant dependencies are not installed (run bun install in ${repoDir})`);
    }

    // Same layout as a local hatch instance directory.
    const root = path.join(ctx.workspaceDir, "harness");
    const workspace = path.join(root, ".vellum", "workspace");
    const protectedDir = path.join(root, ".vellum", "protected");
    const cesSocketDir = path.join(protectedDir, "credential-executor");
    for (const dir of [workspace, cesSocketDir]) mkdirSync(dir, { recursive: true });

    const [daemonPort, gatewayPort, qdrantPort] = [await freePort(), await freePort(), await freePort()];
    const bootstrapSecret = randomBytes(32).toString("hex");
    const env: Record<string, string> = {
      ...ctx.env,
      HOME: root,
      VELLUM_WORKSPACE_DIR: workspace,
      ANU_WORKSPACE_DIR: workspace,
      GATEWAY_SECURITY_DIR: protectedDir,
      CREDENTIAL_SECURITY_DIR: protectedDir,
      CES_BOOTSTRAP_SOCKET_DIR: cesSocketDir,
      RUNTIME_HTTP_PORT: String(daemonPort),
      RUNTIME_HTTP_HOST: "127.0.0.1",
      GATEWAY_PORT: String(gatewayPort),
      // Per task, so concurrent runs do not share the default Qdrant port.
      QDRANT_HTTP_PORT: String(qdrantPort),
      // Shared by the daemon and the gateway so tokens one mints the other accepts.
      ACTOR_TOKEN_SIGNING_KEY: randomBytes(32).toString("hex"),
    };

    const services: Service[] = [];
    const spawn = (name: string, entry: string, extraEnv: Record<string, string> = {}, args: string[] = []) => {
      const log = openSync(path.join(root, `${name}.log`), "a");
      // Own process group, so helpers (memory and embedding workers, Qdrant) die with it.
      const proc = Bun.spawn(["setsid", process.execPath, "run", path.basename(entry), ...args], {
        cwd: path.dirname(entry),
        env: { ...env, ...extraEnv },
        stdout: log,
        stderr: log,
      });
      services.push({ name, proc });
      return proc;
    };
    const killAll = () => {
      for (const { proc } of services) {
        try {
          process.kill(-proc.pid, "SIGKILL");
        } catch {}
        try {
          proc.kill("SIGKILL");
        } catch {}
      }
    };
    ctx.signal.addEventListener("abort", killAll);

    const bootStarted = Date.now();
    const waitReady = async (name: string, url: string, proc: Bun.Subprocess) => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline && proc.exitCode === null) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
          if (res.ok) return Date.now() - bootStarted;
        } catch {}
        await sleep(250, ctx.signal);
      }
      throw new Error(
        proc.exitCode !== null
          ? `assistant ${name} exited with code ${proc.exitCode} before it was ready (see harness/${name}.log in the task workspace)`
          : `assistant ${name} did not become ready in time`,
      );
    };

    try {
      ctx.step({
        kind: "tool",
        title: "Start the assistant runtime",
        detail: { services: ["credential-executor", "daemon", "gateway"], daemonPort, gatewayPort },
      });
      // CES binds its socket well before the daemon reaches its CES handshake,
      // which itself retries discovery, so the three start together.
      spawn("ces", entries.ces);
      const daemon = spawn("daemon", entries.daemon, { DEBUG_STDOUT_LOGS: "true" });
      const gateway = spawn("gateway", entries.gateway, { RUNTIME_PROXY_REQUIRE_AUTH: "true", GUARDIAN_BOOTSTRAP_SECRET: bootstrapSecret }, [
        "--vellum-gateway",
      ]);
      const daemonMs = await waitReady("daemon", `http://127.0.0.1:${daemonPort}/readyz`, daemon);
      // The gateway opens traffic only after the daemon reports its migrations done.
      const gatewayMs = await waitReady("gateway", `http://127.0.0.1:${gatewayPort}/readyz`, gateway);

      const base = `http://127.0.0.1:${gatewayPort}`;
      const init = await fetch(`${base}/v1/guardian/init`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bootstrap-secret": bootstrapSecret },
        body: JSON.stringify({ platform: "cli", deviceId: `anu-${ctx.taskId}`, clientReportedName: "anu-harness" }),
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]),
      });
      const initBody = (await init.json().catch(() => ({}))) as { accessToken?: unknown };
      if (!init.ok || typeof initBody.accessToken !== "string") {
        throw new Error(`assistant gateway refused the guardian bootstrap (HTTP ${init.status})`);
      }
      const token = initBody.accessToken;
      ctx.step({
        kind: "observation",
        title: `Assistant runtime is ready after ${(gatewayMs / 1000).toFixed(1)}s`,
        detail: { readyMs: { daemon: daemonMs, gateway: gatewayMs } },
      });

      const client: RuntimeClient = {
        async call(method, route, body) {
          const res = await fetch(base + route, {
            method,
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(60_000)]),
          });
          const text = await res.text();
          if (!res.ok) throw new Error(`assistant ${method} ${route} returned HTTP ${res.status}: ${text.slice(0, 300)}`);
          return text ? (JSON.parse(text) as Record<string, unknown>) : {};
        },
        async events(conversationKey, signal) {
          const res = await fetch(`${base}/v1/events?conversationKey=${encodeURIComponent(conversationKey)}`, {
            headers: { accept: "text/event-stream", authorization: `Bearer ${token}` },
            signal,
          });
          if (!res.ok || !res.body) throw new Error(`assistant event stream returned HTTP ${res.status}`);
          return res.body;
        },
      };

      await client.call("POST", "/v1/secrets", { type: "credential", name: "kilo:api_key", value: kiloApiKey });
      await client.call("POST", "/v1/inference/provider-connections", {
        name: "kilo",
        provider: "openai-compatible",
        label: "Kilo Gateway",
        base_url: kiloBaseUrl,
        models: [{ id: kiloModel }],
        auth: { type: "api_key", credential: "credential/kilo/api_key" },
      });
      await client.call("POST", "/v1/inference/profiles", {
        name: PROFILE,
        provider: "openai-compatible",
        model: kiloModel,
        connection: "kilo",
        maxTokens: 8192,
        thinking: false,
      });
      await client.call("POST", "/v1/config/set", { path: "llm.activeProfile", value: PROFILE });
      ctx.step({ kind: "tool", title: "Configure the Kilo Gateway connection", detail: { model: kiloModel } });

      return await runTurn(ctx, client, {
        inferenceProfile: PROFILE,
        timeoutMs: TURN_TIMEOUT_MS,
        workspace,
      });
    } finally {
      ctx.signal.removeEventListener("abort", killAll);
      killAll();
    }
  },
};
