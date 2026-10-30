import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Sql } from "../db/client.js";
import { adminSql, makeTestApi, resetPhones, type TestApi } from "../test/helpers.js";

const OWNER = "+14045550100";
const DELETER = "+14045550101";

let sql: Sql;
let t: TestApi;
let token: string;

beforeAll(async () => {
  sql = await adminSql();
  await resetPhones(sql, [OWNER, DELETER]);
  t = makeTestApi();
  token = await t.login(OWNER);
});

afterAll(async () => {
  await t.close();
  await sql.end();
});

const internal = (method: string, path: string, body?: unknown) =>
  t.call(method, path, { token: t.config.ANU_INTERNAL_TOKEN, body });

async function createTask(goal: string, as = token) {
  const res = await t.call("POST", "/v1/tasks", { token: as, body: { goal } });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; status: string; goal: string };
}

describe("task CRUD", () => {
  test("create dispatches to the sandbox and starts queued", async () => {
    const task = await createTask("  Write a haiku about tests  ");
    expect(task.status).toBe("queued");
    expect(task.goal).toBe("Write a haiku about tests");
    expect(t.sandbox.calls).toContainEqual({ op: "start", taskId: task.id });
  });

  test("invalid goals are rejected", async () => {
    for (const goal of ["", "   ", 42, "x".repeat(4001)]) {
      const res = await t.call("POST", "/v1/tasks", { token, body: { goal } });
      expect(res.status).toBe(400);
    }
  });

  test("a task fails cleanly when the sandbox cannot be reached", async () => {
    t.sandbox.failStart = true;
    try {
      const task = await createTask("This cannot start");
      expect(task.status).toBe("failed");
    } finally {
      t.sandbox.failStart = false;
    }
  });

  test("list, get, and steps reflect internal reports in order", async () => {
    const task = await createTask("Plan a weekend");
    expect((await internal("POST", `/internal/v1/tasks/${task.id}/steps`, { kind: "plan", title: "Plan", detail: { steps: ["a"] } })).status).toBe(201);
    await internal("POST", `/internal/v1/tasks/${task.id}/steps`, { kind: "tool", title: "Search" });

    const list = (await (await t.call("GET", "/v1/tasks", { token })).json()) as { tasks: { id: string }[] };
    expect(list.tasks.map((x) => x.id)).toContain(task.id);

    const got = (await (await t.call("GET", `/v1/tasks/${task.id}`, { token })).json()) as { status: string; startedAt: string };
    expect(got.status).toBe("running");
    expect(got.startedAt).toBeTruthy();

    const steps = (await (await t.call("GET", `/v1/tasks/${task.id}/steps`, { token })).json()) as { steps: { seq: number; kind: string }[] };
    expect(steps.steps.map((s) => [s.seq, s.kind])).toEqual([[1, "plan"], [2, "tool"]]);

    const after = (await (await t.call("GET", `/v1/tasks/${task.id}/steps?after=1`, { token })).json()) as { steps: unknown[] };
    expect(after.steps.length).toBe(1);
  });

  test("bad internal payloads are rejected", async () => {
    const task = await createTask("Validate payloads");
    expect((await internal("POST", `/internal/v1/tasks/${task.id}/steps`, { kind: "nope", title: "x" })).status).toBe(400);
    expect((await internal("POST", `/internal/v1/tasks/${task.id}/finish`, { status: "succeeded", confidence: 2 })).status).toBe(400);
    expect((await internal("POST", `/internal/v1/tasks/not-a-uuid/steps`, { kind: "plan", title: "x" })).status).toBe(404);
  });

  test("approval flow: request, decide, finish", async () => {
    const task = await createTask("Needs approval");
    const approvalRes = await internal("POST", `/internal/v1/tasks/${task.id}/approvals`, { prompt: "Send the email?" });
    expect(approvalRes.status).toBe(201);
    const approval = (await approvalRes.json()) as { id: string };

    const waiting = (await (await t.call("GET", `/v1/tasks/${task.id}`, { token })).json()) as {
      status: string;
      approvals: { id: string; status: string }[];
    };
    expect(waiting.status).toBe("awaiting_approval");
    expect(waiting.approvals).toEqual([expect.objectContaining({ id: approval.id, status: "pending" })]);

    // Cannot finish successfully while waiting.
    expect((await internal("POST", `/internal/v1/tasks/${task.id}/finish`, { status: "succeeded", result: "x" })).status).toBe(409);

    expect((await t.call("POST", `/v1/tasks/${task.id}/approvals/${approval.id}`, { token, body: { decision: "maybe" } })).status).toBe(400);
    const decided = await t.call("POST", `/v1/tasks/${task.id}/approvals/${approval.id}`, { token, body: { decision: "approve" } });
    expect(decided.status).toBe(200);
    expect(t.sandbox.calls).toContainEqual({ op: "decision", taskId: task.id, extra: { approvalId: approval.id, decision: "approved" } });
    expect((await t.call("POST", `/v1/tasks/${task.id}/approvals/${approval.id}`, { token, body: { decision: "approve" } })).status).toBe(409);

    const status = (await (await internal("GET", `/internal/v1/tasks/${task.id}/approvals/${approval.id}`)).json()) as { status: string };
    expect(status.status).toBe("approved");

    const finished = await internal("POST", `/internal/v1/tasks/${task.id}/finish`, { status: "succeeded", result: "Done", confidence: 0.75 });
    expect(finished.status).toBe(200);
    const final = (await (await t.call("GET", `/v1/tasks/${task.id}`, { token })).json()) as { status: string; result: string; confidence: number };
    expect(final).toMatchObject({ status: "succeeded", result: "Done", confidence: 0.75 });
    const steps = (await (await t.call("GET", `/v1/tasks/${task.id}/steps`, { token })).json()) as { steps: { kind: string }[] };
    expect(steps.steps.map((s) => s.kind)).toEqual(["approval_request", "message", "result"]);
  });

  test("stop marks the task stopped, pushes to the sandbox, and refuses later reports", async () => {
    const task = await createTask("Long task");
    await internal("POST", `/internal/v1/tasks/${task.id}/steps`, { kind: "plan", title: "Plan" });
    const stopped = await t.call("POST", `/v1/tasks/${task.id}/stop`, { token });
    expect(stopped.status).toBe(200);
    expect(((await stopped.json()) as { status: string }).status).toBe("stopped");
    expect(t.sandbox.calls).toContainEqual({ op: "stop", taskId: task.id });
    expect((await internal("POST", `/internal/v1/tasks/${task.id}/steps`, { kind: "tool", title: "late" })).status).toBe(409);
    expect((await internal("POST", `/internal/v1/tasks/${task.id}/finish`, { status: "succeeded", result: "late" })).status).toBe(409);
    // Stopping again is a no-op.
    expect((await t.call("POST", `/v1/tasks/${task.id}/stop`, { token })).status).toBe(200);
  });

  test("the SSE stream sends the snapshot, steps, and an end event", async () => {
    const task = await createTask("Stream me");
    await internal("POST", `/internal/v1/tasks/${task.id}/steps`, { kind: "plan", title: "Plan" });
    const res = await t.call("GET", `/v1/tasks/${task.id}/events`, { token });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    setTimeout(() => {
      void internal("POST", `/internal/v1/tasks/${task.id}/finish`, { status: "succeeded", result: "ok" });
    }, 50);
    const text = await res.text();
    expect(text).toContain("event: task");
    expect(text).toContain("event: step\nid: 1");
    expect(text).toContain("event: step\nid: 2"); // the result step
    expect(text).toContain('event: end\ndata: {"status":"succeeded"}');
  });

  test("export returns the user's tasks with steps and approvals", async () => {
    const res = await t.call("GET", "/v1/me/export", { token });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      user: { phone: string };
      tasks: { steps: unknown[]; approvals: unknown[] }[];
      sessions: unknown[];
      audit: { action: string }[];
    };
    expect(data.user.phone).toBe(OWNER);
    expect(data.tasks.length).toBeGreaterThanOrEqual(5);
    expect(data.tasks.some((task) => task.approvals.length > 0)).toBe(true);
    expect(data.sessions.length).toBe(1);
    expect(JSON.stringify(data.sessions)).not.toContain("token");
    expect(data.audit.map((a) => a.action)).toContain("task.created");
  });

  test("DELETE /v1/me removes every row the user owns", async () => {
    const deleterToken = await t.login(DELETER);
    const task = await createTask("Delete me later", deleterToken);
    await internal("POST", `/internal/v1/tasks/${task.id}/approvals`, { prompt: "ok?" });
    const [user] = await sql`select id from users where phone = ${DELETER}`;

    expect((await t.call("DELETE", "/v1/me", { token: deleterToken })).status).toBe(204);
    expect(t.sandbox.calls).toContainEqual({ op: "delete", taskId: task.id });
    for (const table of ["tasks", "task_steps", "approvals", "sessions", "audit_log"]) {
      const [{ n }] = (await sql.unsafe(`select count(*)::int as n from ${table} where user_id = $1`, [user!.id])) as { n: number }[];
      expect(n).toBe(0);
    }
    expect((await sql`select 1 from users where phone = ${DELETER}`).length).toBe(0);
    expect((await t.call("GET", "/v1/me", { token: deleterToken })).status).toBe(401);
  });
});

describe("CORS", () => {
  test("allows configured client origins and refuses others", async () => {
    for (const origin of ["capacitor://localhost", "https://localhost", "http://localhost:5173"]) {
      const res = await t.call("OPTIONS", "/v1/tasks", { headers: { origin, "access-control-request-method": "POST" } });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
    }
    const evil = await t.call("OPTIONS", "/v1/tasks", { headers: { origin: "https://evil.example" } });
    expect(evil.status).toBe(403);
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
    const internalPreflight = await t.call("OPTIONS", "/internal/v1/tasks/x/steps", { headers: { origin: "https://localhost" } });
    expect(internalPreflight.headers.get("access-control-allow-origin")).toBeNull();
  });
});
