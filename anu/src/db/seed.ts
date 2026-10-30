import { insertAgent } from "../api/agents.js";
import { ensureDefaultBots, type BotRow } from "../api/bots.js";
import type { DefaultBotKey } from "../api/default-bots.js";
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
  /** The default bot the task runs as (ANU when omitted). */
  bot?: DefaultBotKey;
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
    bot: "shopper",
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
    bot: "researcher",
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

type Item = { kind: string; title: string; text?: string; detail?: unknown; status?: string };
interface SeedSession {
  id: string;
  userId: string;
  bot?: DefaultBotKey;
  title: string;
  status: string;
  items: Item[];
  approval?: { id: string; prompt: string };
}
const sid = (n: number) => `00000000-0000-4000-b000-${String(n).padStart(12, "0")}`;
const say = (text: string): Item => ({ kind: "user_message", title: text.slice(0, 200), text });
const reply = (text: string): Item => ({ kind: "assistant_message", title: text.slice(0, 200), text });
const turnDone: Item = { kind: "turn_complete", title: "Turn complete", detail: { status: "succeeded" } };

export const SEED_SESSIONS: SeedSession[] = [
  {
    id: sid(1),
    userId: primary.id,
    title: "Weekend trip ideas",
    status: "idle",
    items: [
      say("Where could I go for a weekend near the coast?"),
      { kind: "tool", title: "Read the conversation" },
      reply("Three options: a beach town two hours north, a harbor city with ferries, or a quiet cove with hiking trails."),
      turnDone,
      say("Which one is best for hiking?"),
      reply("The cove: it has coastal trails from 3 to 12 km and a campsite."),
      turnDone,
    ],
  },
  {
    id: sid(2),
    userId: primary.id,
    title: "Laptop research",
    bot: "shopper",
    status: "working",
    items: [
      say("Find a light laptop under 800 dollars"),
      { kind: "browser", title: "Browser navigate: https://example.com/laptops", detail: { url: "https://example.com/laptops", action: "navigate", frameId: null } },
    ],
  },
  {
    id: sid(3),
    userId: primary.id,
    title: "Tidy my downloads",
    status: "waiting_for_you",
    items: [
      say("Delete old installers from my downloads"),
      { kind: "approval_request", title: "Delete 12 installer files?", status: "pending" },
    ],
    approval: { id: "00000000-0000-4000-a000-000000000013", prompt: "Delete 12 installer files?" },
  },
  {
    id: sid(4),
    userId: primary.id,
    title: "Translate a letter",
    bot: "researcher",
    status: "failed",
    items: [
      say("Translate the attached letter to French"),
      { kind: "message", title: "The model gateway was unreachable", status: "failed" },
      { kind: "turn_complete", title: "Turn failed", detail: { status: "failed" }, status: "failed" },
    ],
  },
  {
    id: sid(5),
    userId: second.id,
    title: "Second user's private chat",
    status: "idle",
    items: [say("Hello"), reply("Hi, how can I help?"), turnDone],
  },
];

/**
 * Inserts the fake data. Safe to run repeatedly: existing rows are left as
 * they are. With reset, the seeded tasks are deleted first and recreated in
 * their original states (other tasks of the seeded users are kept).
 */
export async function seed(db: Db, options: { reset?: boolean } = {}): Promise<{ users: number; tasks: number; sessions: number }> {
  return db.asSystem(async (tx) => {
    if (options.reset) {
      await tx`delete from tasks where id in ${tx(SEED_TASKS.map((task) => task.id))}`;
      await tx`delete from chat_sessions where id in ${tx(SEED_SESSIONS.map((session) => session.id))}`;
    }
    for (const user of SEED_USERS) {
      await tx`insert into users (id, phone) values (${user.id}, ${user.phone}) on conflict do nothing`;
    }
    // Default bots for the users with seeded chats and tasks; the third user
    // gets them lazily on first request, in the app's language.
    const bots = new Map<string, BotRow>();
    for (const user of [primary, second]) {
      await ensureDefaultBots(tx, user.id, "en", new Date());
      for (const row of await tx<BotRow[]>`select * from bots where user_id = ${user.id} and default_key is not null`) {
        bots.set(`${user.id}:${row.default_key}`, row);
      }
    }
    const botFor = (userId: string, key: DefaultBotKey = "anu") => {
      const row = bots.get(`${userId}:${key}`) ?? bots.get(`${userId}:anu`);
      return row ? { id: row.id, name: row.name, avatar: { bodyShape: row.body_shape, eyeStyle: row.eye_style, color: row.color } } : null;
    };
    let created = 0;
    for (const task of SEED_TASKS) {
      const terminal = ["succeeded", "failed", "stopped"].includes(task.status);
      const inserted = await tx`
        insert into tasks (id, user_id, goal, status, driver, bot_id, result, confidence, started_at, finished_at)
        values (${task.id}, ${task.userId}, ${task.goal}, ${task.status}, 'seed', ${botFor(task.userId, task.bot)?.id ?? null}, ${task.result ?? null},
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
    for (const task of SEED_TASKS) {
      const bot = botFor(task.userId, task.bot);
      await insertAgent(tx, task.userId, { taskId: task.id }, new Date(), bot);
      if (!bot) continue;
      // Seeded rows without a bot take theirs, so a re-seed leaves no stranger agents.
      await tx`update tasks set bot_id = ${bot.id} where id = ${task.id} and bot_id is null`;
      await tx`update agents set bot_id = ${bot.id}, name = ${bot.name}, body_shape = ${bot.avatar.bodyShape},
        eye_style = ${bot.avatar.eyeStyle}, color = ${bot.avatar.color} where task_id = ${task.id} and bot_id is null`;
    }

    let sessionsCreated = 0;
    for (const session of SEED_SESSIONS) {
      const inserted = await tx`
        insert into chat_sessions (id, user_id, title, status, driver, bot_id)
        values (${session.id}, ${session.userId}, ${session.title}, ${session.status}, 'seed', ${botFor(session.userId, session.bot)?.id ?? null})
        on conflict (id) do nothing returning id`;
      const bot = botFor(session.userId, session.bot);
      if (inserted.length === 0) {
        if (!bot) continue;
        await tx`update chat_sessions set bot_id = ${bot.id} where id = ${session.id} and bot_id is null`;
        await tx`update agents set bot_id = ${bot.id}, name = ${bot.name}, body_shape = ${bot.avatar.bodyShape},
          eye_style = ${bot.avatar.eyeStyle}, color = ${bot.avatar.color} where session_id = ${session.id} and bot_id is null`;
        continue;
      }
      sessionsCreated++;
      await insertAgent(tx, session.userId, { sessionId: session.id }, new Date(), bot);
      let seq = 0;
      let turnId: string | null = null;
      for (const item of session.items) {
        const currentTurn: string | null = turnId;
        const rows: { id: string }[] = await tx<{ id: string }[]>`
          insert into session_items (session_id, user_id, seq, kind, title, text, detail, status, turn_id)
          values (${session.id}, ${session.userId}, ${++seq}, ${item.kind}, ${item.title}, ${item.text ?? null},
            ${tx.json((item.detail ?? {}) as never)}, ${item.status ?? "done"}, ${currentTurn})
          returning id`;
        if (item.kind === "user_message") {
          turnId = rows[0]!.id;
          await tx`update session_items set turn_id = ${turnId} where id = ${turnId}`;
        }
      }
      if (session.approval) {
        await tx`insert into approvals (id, session_id, user_id, prompt)
          values (${session.approval.id}, ${session.id}, ${session.userId}, ${session.approval.prompt})
          on conflict do nothing`;
      }
    }
    return { users: SEED_USERS.length, tasks: created, sessions: sessionsCreated };
  });
}
