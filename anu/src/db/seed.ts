import type { Db } from "./client.js";

/** Fake people. Numbers are from the reserved 555-0100 to 555-0199 range. */
export const SEED_USERS = [
  { id: "00000000-0000-4000-8000-000000000100", phone: "+12025550100", label: "primary test user" },
  { id: "00000000-0000-4000-8000-000000000101", phone: "+12025550101", label: "second user, for isolation checks" },
  { id: "00000000-0000-4000-8000-000000000102", phone: "+12025550102", label: "user with no tasks" },
] as const;

type Step = { kind: string; title: string; detail?: unknown; status?: string };
interface SeedTask {
  id: string;
  userId: string;
  goal: string;
  status: string;
  result?: string;
  confidence?: number;
  steps: Step[];
  approval?: { id: string; prompt: string; status: string; stepSeq: number };
}

const [primary, second] = SEED_USERS;
const tid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

export const SEED_TASKS: SeedTask[] = [
  {
    id: tid(1),
    userId: primary.id,
    goal: "Draft a packing list for a three-day hiking trip",
    status: "queued",
    steps: [],
  },
  {
    id: tid(2),
    userId: primary.id,
    goal: "Compare three budget laptops for students",
    status: "running",
    steps: [
      { kind: "plan", title: "Plan", detail: { steps: ["Find candidates", "Compare specs", "Summarize"] } },
      { kind: "tool", title: "Search product listings", detail: { query: "budget student laptop" } },
    ],
  },
  {
    id: tid(3),
    userId: primary.id,
    goal: "Book a table for two on Friday #approval",
    status: "awaiting_approval",
    steps: [
      { kind: "plan", title: "Plan", detail: { steps: ["Pick a restaurant", "Ask before booking"] } },
      { kind: "observation", title: "Found 3 restaurants with Friday availability" },
      { kind: "approval_request", title: "Book Example Bistro for 7pm Friday?", status: "pending" },
    ],
    approval: { id: "00000000-0000-4000-a000-000000000003", prompt: "Book Example Bistro for 7pm Friday?", status: "pending", stepSeq: 3 },
  },
  {
    id: tid(4),
    userId: primary.id,
    goal: "Summarize this week's team notes",
    status: "succeeded",
    result: "Three decisions were made and two items are still open.",
    confidence: 0.82,
    steps: [
      { kind: "plan", title: "Plan", detail: { steps: ["Read notes", "Extract decisions", "Summarize"] } },
      { kind: "observation", title: "Read 5 notes" },
      { kind: "result", title: "Result", detail: { result: "Three decisions were made and two items are still open.", confidence: 0.82 } },
    ],
  },
  {
    id: tid(5),
    userId: primary.id,
    goal: "Convert the expense sheet to a chart",
    status: "failed",
    result: "The spreadsheet could not be read.",
    steps: [
      { kind: "plan", title: "Plan", detail: { steps: ["Open the sheet", "Build the chart"] } },
      { kind: "result", title: "Task failed", detail: { result: "The spreadsheet could not be read." }, status: "failed" },
    ],
  },
  {
    id: tid(6),
    userId: primary.id,
    goal: "Find flights to the conference",
    status: "stopped",
    steps: [
      { kind: "plan", title: "Plan", detail: { steps: ["Search flights"] } },
      { kind: "message", title: "Stopped by user" },
    ],
  },
  {
    id: tid(7),
    userId: second.id,
    goal: "Second user's private task",
    status: "succeeded",
    result: "Private result for the second user.",
    confidence: 0.7,
    steps: [{ kind: "result", title: "Result", detail: { result: "Private result for the second user." } }],
  },
];

/**
 * Inserts the fake data. Safe to run repeatedly: existing rows are left as
 * they are. With reset, the seeded tasks are deleted first and recreated in
 * their original states (other tasks of the seeded users are kept).
 */
export async function seed(db: Db, options: { reset?: boolean } = {}): Promise<{ users: number; tasks: number }> {
  return db.asSystem(async (tx) => {
    if (options.reset) {
      await tx`delete from tasks where id in ${tx(SEED_TASKS.map((task) => task.id))}`;
    }
    for (const user of SEED_USERS) {
      await tx`insert into users (id, phone) values (${user.id}, ${user.phone}) on conflict do nothing`;
    }
    let created = 0;
    for (const task of SEED_TASKS) {
      const terminal = ["succeeded", "failed", "stopped"].includes(task.status);
      const inserted = await tx`
        insert into tasks (id, user_id, goal, status, driver, result, confidence, started_at, finished_at)
        values (${task.id}, ${task.userId}, ${task.goal}, ${task.status}, 'seed', ${task.result ?? null},
          ${task.confidence ?? null}, ${task.status === "queued" ? null : new Date()}, ${terminal ? new Date() : null})
        on conflict (id) do nothing returning id`;
      if (inserted.length === 0) continue;
      created++;
      let seq = 0;
      const stepIds: string[] = [];
      for (const step of task.steps) {
        const [row] = await tx<{ id: string }[]>`
          insert into task_steps (task_id, user_id, seq, kind, title, detail, status)
          values (${task.id}, ${task.userId}, ${++seq}, ${step.kind}, ${step.title},
            ${tx.json((step.detail ?? {}) as never)}, ${step.status ?? "done"})
          returning id`;
        stepIds.push(row!.id);
      }
      if (task.approval) {
        await tx`insert into approvals (id, task_id, user_id, step_id, prompt, status)
          values (${task.approval.id}, ${task.id}, ${task.userId}, ${stepIds[task.approval.stepSeq - 1] ?? null},
            ${task.approval.prompt}, ${task.approval.status})
          on conflict do nothing`;
      }
    }
    return { users: SEED_USERS.length, tasks: created };
  });
}
