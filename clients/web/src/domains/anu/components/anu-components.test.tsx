import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

import type { AnuApproval, AnuStep, AnuTaskDetail } from "../anu-api";
import { useAnuSessionStore } from "../anu-session-store";
import { AnuApprovalCard } from "./anu-approval-card";
import { AnuResultCard } from "./anu-result-card";
import { AnuStepTimeline } from "./anu-step-timeline";
import { AnuTaskRow } from "./anu-task-row";

const START = "2026-10-29T10:00:00.000Z";
const at = (ms: number) => new Date(Date.parse(START) + ms).toISOString();

function makeTask(overrides: Partial<AnuTaskDetail> = {}): AnuTaskDetail {
  return {
    id: "t-1",
    goal: "Draft a packing list for a three-day hiking trip",
    status: "running",
    result: null,
    confidence: null,
    createdAt: START,
    updatedAt: START,
    startedAt: START,
    finishedAt: null,
    approvals: [],
    ...overrides,
  };
}

function makeStep(seq: number, overrides: Partial<AnuStep> = {}): AnuStep {
  return {
    id: `s-${seq}`,
    taskId: "t-1",
    seq,
    kind: "tool",
    title: `Step ${seq}`,
    detail: {},
    status: "done",
    createdAt: at(seq * 1000),
    ...overrides,
  };
}

const APPROVAL: AnuApproval = {
  id: "a-1",
  taskId: "t-1",
  stepId: "s-3",
  prompt: "Write summary.md to the task workspace?",
  detail: { file: "summary.md" },
  status: "pending",
  createdAt: at(3000),
  decidedAt: null,
};

function wrap(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  useAnuSessionStore.setState({
    status: "signed-in",
    token: "anu_s_test",
    expiresAt: at(86_400_000),
  });
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("AnuStepTimeline", () => {
  test("renders the plan as an ordered list and each step's detail", () => {
    render(
      wrap(
        <AnuStepTimeline
          task={makeTask()}
          steps={[
            makeStep(1, {
              kind: "plan",
              title: "Plan",
              detail: { steps: ["Inspect the workspace", "Report the result"] },
            }),
            makeStep(2, { title: "Run env in the workspace", detail: { command: "env" } }),
          ]}
        />,
      ),
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toContain("Inspect the workspace");
    expect(screen.getByText("env")).toBeTruthy();
    expect(screen.getByText("+2.0s")).toBeTruthy();
  });

  test("shows the live row while a running task has no running step", () => {
    render(wrap(<AnuStepTimeline task={makeTask()} steps={[makeStep(1)]} />));
    expect(screen.getByText("Working on the next step")).toBeTruthy();
  });

  test("names the outcome of an answered question", () => {
    render(
      wrap(
        <AnuStepTimeline
          task={makeTask({
            status: "succeeded",
            approvals: [{ ...APPROVAL, status: "approved" }],
          })}
          steps={[
            makeStep(3, {
              kind: "approval_request",
              title: APPROVAL.prompt,
            }),
          ]}
        />,
      ),
    );
    expect(screen.getByText("You approved this.")).toBeTruthy();
    expect(screen.queryByText("Working on the next step")).toBeNull();
  });
});

describe("AnuApprovalCard", () => {
  test("posts the decision with the session token", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ...APPROVAL, status: "approved" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    render(wrap(<AnuApprovalCard approval={APPROVAL} />));
    expect(screen.getByText("summary.md")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.url).toEndWith("/v1/tasks/t-1/approvals/a-1");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      decision: "approve",
    });
    expect(
      (calls[0]?.init?.headers as Record<string, string>).authorization,
    ).toBe("Bearer anu_s_test");
  });

  test("a decided question shows its outcome instead of the answers", () => {
    render(wrap(<AnuApprovalCard approval={{ ...APPROVAL, status: "rejected" }} />));
    expect(screen.getByText("You declined this.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });
});

describe("AnuResultCard", () => {
  test("shows the answer, its confidence and what it rests on", () => {
    render(
      wrap(
        <AnuResultCard
          task={makeTask({
            status: "succeeded",
            result: "Three decisions were made and two items are still open.",
            confidence: 0.82,
            finishedAt: at(5000),
          })}
          steps={[makeStep(2, { detail: { file: "notes.md" } })]}
        />,
      ),
    );
    expect(screen.getByText("82%")).toBeTruthy();
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("82");
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.getByText("Step 2")).toBeTruthy();
  });

  test("says so when no tools were used", () => {
    render(
      wrap(
        <AnuResultCard
          task={makeTask({ status: "succeeded", result: "Answer.", confidence: 0.6 })}
          steps={[]}
        />,
      ),
    );
    expect(
      screen.getByText(
        "This run used no tools, so the answer rests on the model alone.",
      ),
    ).toBeTruthy();
  });
});

describe("AnuTaskRow", () => {
  test("links to the task and states its status and confidence", () => {
    render(
      wrap(
        <AnuTaskRow
          task={makeTask({ status: "succeeded", confidence: 0.9, finishedAt: at(4000) })}
          selected={false}
        />,
      ),
    );
    const link = screen.getByRole("link", {
      name: "Open task: Draft a packing list for a three-day hiking trip",
    });
    expect(link.getAttribute("href")).toBe("/anu/tasks/t-1");
    expect(screen.getByText("Done")).toBeTruthy();
    expect(screen.getByText("90% confident")).toBeTruthy();
  });
});
