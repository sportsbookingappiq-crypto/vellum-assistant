import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Sql } from "../db/client.js";
import { adminSql, makeTestApi, resetPhones, type TestApi } from "../test/helpers.js";

const ALICE = "+15055550100";
const BOB = "+15055550101";

let sql: Sql;
let t: TestApi;
let alice: string;
let bob: string;
let bobTask: string;
let bobApproval: string;
let aliceId: string;
let bobId: string;

beforeAll(async () => {
  sql = await adminSql();
  await resetPhones(sql, [ALICE, BOB]);
  t = makeTestApi();
  alice = await t.login(ALICE);
  bob = await t.login(BOB);
  aliceId = ((await (await t.call("GET", "/v1/me", { token: alice })).json()) as { id: string }).id;
  bobId = ((await (await t.call("GET", "/v1/me", { token: bob })).json()) as { id: string }).id;
  await t.call("POST", "/v1/tasks", { token: alice, body: { goal: "Alice's task" } });
  const created = await t.call("POST", "/v1/tasks", { token: bob, body: { goal: "Bob's secret task" } });
  bobTask = ((await created.json()) as { id: string }).id;
  const approval = await t.call("POST", `/internal/v1/tasks/${bobTask}/approvals`, {
    token: t.config.ANU_INTERNAL_TOKEN,
    body: { prompt: "Bob's approval" },
  });
  bobApproval = ((await approval.json()) as { id: string }).id;
});

afterAll(async () => {
  await t.close();
  await sql.end();
});

describe("cross-user isolation over HTTP", () => {
  test("Alice gets 404 for every operation on Bob's task", async () => {
    const attempts: [string, string, unknown?][] = [
      ["GET", `/v1/tasks/${bobTask}`],
      ["GET", `/v1/tasks/${bobTask}/steps`],
      ["GET", `/v1/tasks/${bobTask}/events`],
      ["POST", `/v1/tasks/${bobTask}/stop`],
      ["POST", `/v1/tasks/${bobTask}/approvals/${bobApproval}`, { decision: "approve" }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await t.call(method, path, { token: alice, body });
      expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 404`);
    }
    const state = (await (await t.call("GET", `/v1/tasks/${bobTask}`, { token: bob })).json()) as {
      status: string;
      approvals: { status: string }[];
    };
    expect(state.status).toBe("awaiting_approval");
    expect(state.approvals[0]!.status).toBe("pending");
  });

  test("Alice cannot approve Bob's approval through her own task id either", async () => {
    const aliceTasks = (await (await t.call("GET", "/v1/tasks", { token: alice })).json()) as { tasks: { id: string }[] };
    const res = await t.call("POST", `/v1/tasks/${aliceTasks.tasks[0]!.id}/approvals/${bobApproval}`, {
      token: alice,
      body: { decision: "approve" },
    });
    expect(res.status).toBe(404);
  });

  test("lists and exports contain only the caller's data", async () => {
    const list = (await (await t.call("GET", "/v1/tasks", { token: alice })).json()) as { tasks: { goal: string }[] };
    expect(list.tasks.map((x) => x.goal)).toEqual(["Alice's task"]);
    const exported = JSON.stringify(await (await t.call("GET", "/v1/me/export", { token: alice })).json());
    expect(exported).not.toContain("Bob");
    expect(exported).not.toContain(BOB);
    expect(exported).not.toContain(bobTask);
  });

  test("internal endpoints reject user session tokens and missing tokens", async () => {
    for (const token of [alice, bob, undefined, "anu_s_forged"]) {
      const res = await t.call("POST", `/internal/v1/tasks/${bobTask}/steps`, { token, body: { kind: "plan", title: "x" } });
      expect(res.status).toBe(401);
      const finish = await t.call("POST", `/internal/v1/tasks/${bobTask}/finish`, { token, body: { status: "failed" } });
      expect(finish.status).toBe(401);
      const get = await t.call("GET", `/internal/v1/tasks/${bobTask}/approvals/${bobApproval}`, { token });
      expect(get.status).toBe(401);
    }
  });

  test("the internal token is not a user session", async () => {
    const res = await t.call("GET", "/v1/tasks", { token: t.config.ANU_INTERNAL_TOKEN });
    expect(res.status).toBe(401);
  });
});

describe("row-level security (defense in depth)", () => {
  test("a user-scoped query without an owner filter still sees only that user's rows", async () => {
    const rows = await t.api.db.asUser(aliceId, (tx) => tx<{ user_id: string }[]>`select user_id from tasks`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.user_id === aliceId)).toBe(true);
    const users = await t.api.db.asUser(aliceId, (tx) => tx`select phone from users`);
    expect(users.map((u) => u.phone)).toEqual([ALICE]);
    const codes = await t.api.db.asUser(aliceId, (tx) => tx`select * from login_codes`);
    expect(codes.length).toBe(0);
  });

  test("a user scope cannot write rows owned by someone else", async () => {
    await expect(
      t.api.db.asUser(aliceId, (tx) => tx`insert into tasks (user_id, goal) values (${bobId}, 'forged')`),
    ).rejects.toThrow(/row-level security/);
    const updated = await t.api.db.asUser(aliceId, (tx) => tx`update tasks set status = 'stopped' where id = ${bobTask}`);
    expect(updated.count).toBe(0);
  });

  test("the application role sees nothing without a scope", async () => {
    const rows = await t.api.db.sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${t.config.ANU_DB_APP_ROLE}`);
      return tx`select * from tasks`;
    });
    expect(rows.length).toBe(0);
  });
});
