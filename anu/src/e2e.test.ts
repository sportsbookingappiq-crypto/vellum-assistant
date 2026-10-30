/**
 * End to end: the API and the sandbox server run as separate processes and
 * talk over HTTP, with the scripted driver and the test database.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ANU_DIR } from "./config.js";
import { Db, type Sql } from "./db/client.js";
import { SEED_USERS, seed } from "./db/seed.js";
import { adminSql, secret, TEST_ROLE, testDatabaseUrl } from "./test/helpers.js";

const [ALICE, BOB] = SEED_USERS;
const workDir = mkdtempSync(path.join(os.tmpdir(), "anu-e2e-"));
const internalToken = secret();
const procs: { name: string; proc: Bun.Subprocess<"ignore", "pipe", "pipe">; output: string[] }[] = [];
let sql: Sql;
let api = "";
let sandbox = "";

function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port!;
  probe.stop(true);
  return port;
}

async function collect(stream: ReadableStream<Uint8Array>, sink: string[]) {
  const decoder = new TextDecoder();
  for await (const chunk of stream) sink.push(decoder.decode(chunk));
}

function spawn(name: string, script: string, env: Record<string, string>) {
  // cwd is an empty directory so no .env file is loaded; env is explicit.
  const proc = Bun.spawn([process.execPath, path.join(ANU_DIR, script)], {
    cwd: workDir,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: workDir, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const output: string[] = [];
  void collect(proc.stdout, output);
  void collect(proc.stderr, output);
  procs.push({ name, proc, output });
}

async function waitHealthy(url: string) {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    try {
      if ((await fetch(`${url}/healthz`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`${url} did not become healthy:\n${procs.map((p) => p.output.join("")).join("\n")}`);
}

async function login(phone: string): Promise<string> {
  const requested = await fetch(`${api}/v1/auth/code/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  expect(requested.status).toBe(202);
  const { devCode } = (await requested.json()) as { devCode: string };
  const verified = await fetch(`${api}/v1/auth/code/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, code: devCode }),
  });
  expect(verified.status).toBe(200);
  return ((await verified.json()) as { token: string }).token;
}

const authed = (token: string, method = "GET", body?: unknown): RequestInit => ({
  method,
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

interface SseEvent {
  event: string;
  id?: string;
  data: any;
}

async function* sse(res: Response): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body!) {
    buffer += decoder.decode(chunk, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const event: Partial<SseEvent> = {};
      for (const line of raw.split("\n")) {
        if (line.startsWith("event: ")) event.event = line.slice(7);
        else if (line.startsWith("id: ")) event.id = line.slice(4);
        else if (line.startsWith("data: ")) event.data = JSON.parse(line.slice(6));
      }
      if (event.event) yield event as SseEvent;
    }
  }
}

beforeAll(async () => {
  sql = await adminSql();
  const db = new Db(sql, TEST_ROLE);
  await seed(db);
  await sql`delete from login_codes where phone in ${sql(SEED_USERS.map((u) => u.phone))}`;

  const apiPort = freePort();
  const sandboxPort = freePort();
  api = `http://127.0.0.1:${apiPort}`;
  sandbox = `http://127.0.0.1:${sandboxPort}`;
  const shared = {
    ANU_ENV: "test",
    OTP_SENDER: "dev",
    ANU_INTERNAL_TOKEN: internalToken,
    ANU_API_URL: api,
    ANU_SANDBOX_URL: sandbox,
  };
  spawn("api", "src/api/server.ts", {
    ...shared,
    DATABASE_URL: testDatabaseUrl(),
    ANU_DB_APP_ROLE: TEST_ROLE,
    ANU_OTP_SECRET: secret(),
    ANU_API_PORT: String(apiPort),
  });
  spawn("sandbox", "src/sandbox/server.ts", {
    ...shared,
    ANU_SANDBOX_PORT: String(sandboxPort),
    ANU_SANDBOX_ROOT: path.join(workDir, "sandboxes"),
    ANU_SANDBOX_DRIVER: "scripted",
    ANU_SCRIPTED_STEP_DELAY_MS: "50",
  });
  await waitHealthy(api);
  await waitHealthy(sandbox);
});

afterAll(async () => {
  for (const { proc } of procs) proc.kill("SIGTERM");
  await Promise.all(procs.map(({ proc }) => proc.exited));
  await sql.end();
  rmSync(workDir, { recursive: true, force: true });
});

describe("end to end over HTTP", () => {
  test("a seeded user signs in, runs a task with an approval, and it succeeds", async () => {
    const token = await login(ALICE.phone);
    const me = (await (await fetch(`${api}/v1/me`, authed(token))).json()) as { id: string };
    expect(me.id).toBe(ALICE.id);

    const seeded = (await (await fetch(`${api}/v1/tasks`, authed(token))).json()) as { tasks: { status: string }[] };
    expect(new Set(seeded.tasks.map((t) => t.status))).toEqual(
      new Set(["queued", "running", "awaiting_approval", "succeeded", "failed", "stopped"]),
    );

    const created = await fetch(`${api}/v1/tasks`, authed(token, "POST", { goal: "Tidy my notes #approval" }));
    expect(created.status).toBe(201);
    const task = (await created.json()) as { id: string };

    const stream = await fetch(`${api}/v1/tasks/${task.id}/events`, {
      ...authed(token),
      signal: AbortSignal.timeout(20_000),
    });
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const steps: { seq: number; kind: string }[] = [];
    let approved = false;
    let end: any = null;
    for await (const event of sse(stream)) {
      if (event.event === "step") steps.push(event.data);
      if (event.event === "task" && !approved) {
        const pending = event.data.approvals.find((a: { status: string }) => a.status === "pending");
        if (pending) {
          expect(event.data.status).toBe("awaiting_approval");
          const decided = await fetch(
            `${api}/v1/tasks/${task.id}/approvals/${pending.id}`,
            authed(token, "POST", { decision: "approve" }),
          );
          expect(decided.status).toBe(200);
          approved = true;
        }
      }
      if (event.event === "end") {
        end = event.data;
        break;
      }
    }
    expect(approved).toBe(true);
    expect(end).toEqual({ status: "succeeded" });
    expect(steps.map((s) => s.seq)).toEqual(steps.map((_, i) => i + 1));
    expect(steps.map((s) => s.kind)).toEqual([
      "plan",
      "tool",
      "observation",
      "browser",
      "browser",
      "approval_request",
      "message",
      "tool",
      "result",
    ]);
    const observation = steps[2] as unknown as { detail: { envNames: string[] } };
    expect(observation.detail.envNames).not.toContain("ANU_INTERNAL_TOKEN");
    expect(observation.detail.envNames).not.toContain("DATABASE_URL");

    const final = (await (await fetch(`${api}/v1/tasks/${task.id}`, authed(token))).json()) as {
      status: string;
      result: string;
      confidence: number;
    };
    expect(final).toMatchObject({ status: "succeeded", confidence: 0.9 });
    expect(final.result).toContain("Tidy my notes");

    // Another seeded user cannot see or touch it.
    const bob = await login(BOB.phone);
    expect((await fetch(`${api}/v1/tasks/${task.id}`, authed(bob))).status).toBe(404);
    expect((await fetch(`${api}/v1/tasks/${task.id}/stop`, authed(bob, "POST"))).status).toBe(404);
    expect((await fetch(`${api}/v1/tasks/${task.id}/steps`, authed(bob))).status).toBe(404);

    // After the run ends, the owner can browse the workspace and the browser frames.
    const files = (await (await fetch(`${api}/v1/tasks/${task.id}/files`, authed(token))).json()) as { entries: { name: string }[] };
    expect(files.entries.map((e) => e.name)).toContain("summary.md");
    const summary = await fetch(`${api}/v1/tasks/${task.id}/files/content?path=summary.md`, authed(token));
    expect(summary.headers.get("content-type")).toContain("text/markdown");
    expect(await summary.text()).toContain("Tidy my notes");
    expect((await fetch(`${api}/v1/tasks/${task.id}/files/content?path=../../etc/passwd`, authed(token))).status).toBe(400);
    const browserSteps = steps.filter((s) => s.kind === "browser") as unknown as { detail: { frameId: string; url: string } }[];
    const browser = (await (await fetch(`${api}/v1/tasks/${task.id}/browser`, authed(token))).json()) as {
      latest: { frameId: string; url: string };
    };
    expect(browser.latest).toMatchObject({ frameId: browserSteps.at(-1)!.detail.frameId, url: browserSteps.at(-1)!.detail.url });
    const frame = await fetch(`${api}/v1/tasks/${task.id}/browser/frame?frameId=${browser.latest.frameId}`, authed(token));
    expect(frame.headers.get("content-type")).toBe("image/png");
    expect((await frame.arrayBuffer()).byteLength).toBeGreaterThan(50);
    expect((await fetch(`${api}/v1/tasks/${task.id}/files`, authed(bob))).status).toBe(404);
    expect((await fetch(`${api}/v1/tasks/${task.id}/browser/frame?frameId=f1`, authed(bob))).status).toBe(404);
  });

  test("stopping a running task ends the stream and kills the run", async () => {
    const token = await login(ALICE.phone);
    const task = (await (await fetch(`${api}/v1/tasks`, authed(token, "POST", { goal: "Long job #slow" }))).json()) as {
      id: string;
    };
    const stream = await fetch(`${api}/v1/tasks/${task.id}/events`, { ...authed(token), signal: AbortSignal.timeout(20_000) });
    let end: any = null;
    let stopSent = false;
    for await (const event of sse(stream)) {
      if (event.event === "step" && event.data.kind === "message" && !stopSent) {
        stopSent = true;
        const stopped = await fetch(`${api}/v1/tasks/${task.id}/stop`, authed(token, "POST"));
        expect(((await stopped.json()) as { status: string }).status).toBe("stopped");
      }
      if (event.event === "end") {
        end = event.data;
        break;
      }
    }
    expect(end).toEqual({ status: "stopped" });
    const deadline = Date.now() + 5000;
    let active = -1;
    while (Date.now() < deadline) {
      active = ((await (await fetch(`${sandbox}/healthz`)).json()) as { activeRuns: number }).activeRuns;
      if (active === 0) break;
      await Bun.sleep(100);
    }
    expect(active).toBe(0);
  });

  test("the sandbox refuses user tokens and the API's logs hold no full phone numbers", async () => {
    const token = await login(ALICE.phone);
    const res = await fetch(`${sandbox}/v1/runs`, authed(token, "POST", { taskId: crypto.randomUUID(), goal: "x" }));
    expect(res.status).toBe(401);
    const apiLog = procs.find((p) => p.name === "api")!.output.join("");
    expect(apiLog).toContain("auth.login");
    for (const user of SEED_USERS) expect(apiLog).not.toContain(user.phone);
  });
});
