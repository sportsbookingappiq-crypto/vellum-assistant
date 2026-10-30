import { describe, expect, test } from "bun:test";

import {
  AnuApiError,
  createAnuTask,
  decideAnuApproval,
  fetchAnuSteps,
  fetchAnuTask,
  fetchAnuTasks,
  isAnuTaskFinal,
  isAnuUnauthorized,
  requestAnuCode,
  verifyAnuCode,
} from "./anu-api";

const BASE = "http://anu.test";

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const TASK = {
  id: "00000000-0000-4000-9000-000000000004",
  goal: "Summarize this week's team notes",
  status: "succeeded",
  result: "Three decisions were made and two items are still open.",
  confidence: 0.82,
  createdAt: "2026-10-29T10:00:00.000Z",
  updatedAt: "2026-10-29T10:00:05.000Z",
  startedAt: "2026-10-29T10:00:01.000Z",
  finishedAt: "2026-10-29T10:00:05.000Z",
};

describe("anu api client", () => {
  test("requestAnuCode posts the phone and returns the dev code", async () => {
    const { fetchImpl, calls } = fakeFetch(202, {
      expiresAt: "2026-10-29T10:05:00.000Z",
      devCode: "123456",
    });
    const result = await requestAnuCode("+12025550100", {
      fetchImpl,
      baseUrl: BASE,
    });
    expect(result.devCode).toBe("123456");
    expect(calls[0]?.url).toBe(`${BASE}/v1/auth/code/request`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      phone: "+12025550100",
    });
  });

  test("verifyAnuCode returns the session", async () => {
    const { fetchImpl } = fakeFetch(200, {
      token: "anu_s_abc",
      tokenType: "Bearer",
      expiresAt: "2026-10-30T10:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000100",
    });
    const session = await verifyAnuCode("+12025550100", "123456", {
      fetchImpl,
      baseUrl: BASE,
    });
    expect(session.token).toBe("anu_s_abc");
  });

  test("an error body becomes an AnuApiError with its code and attempts", async () => {
    const { fetchImpl } = fakeFetch(400, {
      error: {
        code: "invalid_code",
        message: "The code is not valid.",
        attemptsRemaining: 3,
      },
    });
    const failure = await verifyAnuCode("+12025550100", "000000", {
      fetchImpl,
      baseUrl: BASE,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AnuApiError);
    const error = failure as AnuApiError;
    expect(error.status).toBe(400);
    expect(error.code).toBe("invalid_code");
    expect(error.attemptsRemaining).toBe(3);
  });

  test("a 429 carries Retry-After in seconds", async () => {
    const { fetchImpl } = fakeFetch(
      429,
      { error: { code: "rate_limited", message: "Too many requests" } },
      { "retry-after": "42" },
    );
    const error = (await requestAnuCode("+12025550100", {
      fetchImpl,
      baseUrl: BASE,
    }).catch((caught: unknown) => caught)) as AnuApiError;
    expect(error.retryAfterSeconds).toBe(42);
  });

  test("a network failure is an AnuApiError with status 0", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const error = (await fetchAnuTasks({
      token: "t",
      fetchImpl,
      baseUrl: BASE,
    }).catch((caught: unknown) => caught)) as AnuApiError;
    expect(error.code).toBe("network");
    expect(error.status).toBe(0);
  });

  test("sends the bearer token and validates the task list", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { tasks: [TASK] });
    const tasks = await fetchAnuTasks({
      token: "anu_s_abc",
      fetchImpl,
      baseUrl: BASE,
    });
    expect(tasks).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/v1/tasks?limit=50`);
    expect(
      (calls[0]?.init.headers as Record<string, string>).authorization,
    ).toBe("Bearer anu_s_abc");
  });

  test("a response that breaks the schema is rejected, not trusted", async () => {
    const { fetchImpl } = fakeFetch(200, {
      tasks: [{ ...TASK, status: "exploded" }],
    });
    const error = (await fetchAnuTasks({
      token: "t",
      fetchImpl,
      baseUrl: BASE,
    }).catch((caught: unknown) => caught)) as AnuApiError;
    expect(error.code).toBe("invalid_response");
  });

  test("task detail defaults missing approvals to an empty list", async () => {
    const { fetchImpl } = fakeFetch(200, TASK);
    const task = await fetchAnuTask(TASK.id, {
      token: "t",
      fetchImpl,
      baseUrl: BASE,
    });
    expect(task.approvals).toEqual([]);
  });

  test("steps are fetched after a sequence number", async () => {
    const { fetchImpl, calls } = fakeFetch(200, { steps: [] });
    await fetchAnuSteps(TASK.id, {
      token: "t",
      after: 4,
      fetchImpl,
      baseUrl: BASE,
    });
    expect(calls[0]?.url).toBe(`${BASE}/v1/tasks/${TASK.id}/steps?after=4`);
  });

  test("createAnuTask and decideAnuApproval post their bodies", async () => {
    const created = fakeFetch(201, { ...TASK, status: "queued" });
    await createAnuTask("Find flights", {
      token: "t",
      fetchImpl: created.fetchImpl,
      baseUrl: BASE,
    });
    expect(JSON.parse(String(created.calls[0]?.init.body))).toEqual({
      goal: "Find flights",
    });

    const decided = fakeFetch(200, {
      id: "a-1",
      taskId: TASK.id,
      prompt: "Write summary.md?",
      status: "approved",
      createdAt: TASK.createdAt,
    });
    const approval = await decideAnuApproval(TASK.id, "a-1", "approve", {
      token: "t",
      fetchImpl: decided.fetchImpl,
      baseUrl: BASE,
    });
    expect(approval.status).toBe("approved");
    expect(decided.calls[0]?.url).toBe(
      `${BASE}/v1/tasks/${TASK.id}/approvals/a-1`,
    );
  });

  test("isAnuUnauthorized and isAnuTaskFinal", () => {
    expect(
      isAnuUnauthorized(
        new AnuApiError({ status: 401, code: "unauthorized", message: "" }),
      ),
    ).toBe(true);
    expect(isAnuUnauthorized(new Error("x"))).toBe(false);
    expect(isAnuTaskFinal("succeeded")).toBe(true);
    expect(isAnuTaskFinal("stopped")).toBe(true);
    expect(isAnuTaskFinal("awaiting_approval")).toBe(false);
  });
});
