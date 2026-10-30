import type { Db, Tx } from "../db/client.js";
import { insertAgent } from "./agents.js";
import { botProfileOf, botView, resolveBot, touchBot, type BotRow } from "./bots.js";
import type { BotLocale } from "./default-bots.js";
import { HttpError, isUuid, notFound } from "../lib/http.js";
import type { Logger } from "../lib/log.js";
import {
  approvalView,
  isTerminal,
  stepView,
  taskView,
  agentView,
  itemView,
  sessionView,
  type AgentRow,
  type ApprovalRow,
  type ChatSessionRow,
  type SessionItemRow,
  type StepKind,
  type StepRow,
  type StepStatus,
  type TaskRow,
} from "./model.js";
import type { SandboxClient, WorkspaceResource } from "./sandbox-client.js";

type Listener = () => void;

/** In-process notifications so SSE streams wake up as soon as a task changes. */
export class TaskEvents {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(taskId: string, listener: Listener): () => void {
    let set = this.listeners.get(taskId);
    if (!set) this.listeners.set(taskId, (set = new Set()));
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(taskId);
    };
  }

  notify(taskId: string): void {
    for (const listener of this.listeners.get(taskId) ?? []) listener();
  }
}

export interface NewStep {
  kind: StepKind;
  title: string;
  detail?: unknown;
  status?: StepStatus;
}

const conflict = (message: string) => new HttpError(409, "conflict", message);

export class TaskService {
  constructor(
    private readonly db: Db,
    private readonly sandbox: SandboxClient,
    readonly events: TaskEvents,
    private readonly now: () => Date,
    private readonly log: Logger,
  ) {}

  // ---------- user-scoped operations ----------

  private async ownedTask(tx: Tx, userId: string, taskId: string, lock = false): Promise<TaskRow> {
    if (!isUuid(taskId)) throw notFound();
    const rows = lock
      ? await tx<TaskRow[]>`select * from tasks where id = ${taskId} and user_id = ${userId} for update`
      : await tx<TaskRow[]>`select * from tasks where id = ${taskId} and user_id = ${userId}`;
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  async create(userId: string, goal: unknown, rawBotId: unknown = undefined, locale: BotLocale = "en") {
    if (typeof goal !== "string" || goal.trim().length === 0 || goal.length > 4000) {
      throw new HttpError(400, "invalid_goal", "goal must be a non-empty string of at most 4000 characters");
    }
    const now = this.now();
    const { task, bot } = await this.db.asUser(userId, async (tx) => {
      const botRow: BotRow | null = await resolveBot(tx, userId, rawBotId, locale, now);
      const bot = botRow ? botProfileOf(botRow) : undefined;
      const [row] = await tx<TaskRow[]>`
        insert into tasks (user_id, goal, bot_id, created_at, updated_at)
        values (${userId}, ${goal.trim()}, ${botRow?.id ?? null}, ${now}, ${now}) returning *`;
      await insertAgent(tx, userId, { taskId: row!.id }, now, bot ? { id: bot.id, name: bot.name, avatar: bot.avatar } : null);
      if (botRow) await touchBot(tx, botRow.id, now);
      await tx`insert into audit_log (user_id, action, target, created_at)
        values (${userId}, 'task.created', ${row!.id}, ${now})`;
      return { task: row!, bot };
    });
    this.log.info("task.created", { taskId: task.id, userId });

    try {
      const { driver } = await this.sandbox.startRun(task.id, task.goal, bot);
      await this.db.asUser(userId, (tx) => tx`update tasks set driver = ${driver} where id = ${task.id} and user_id = ${userId}`);
      task.driver = driver;
    } catch (error) {
      this.log.error("task.dispatch_failed", { taskId: task.id, error });
      return taskView(await this.systemFinish(task.id, "failed", "The sandbox could not start this task.", null));
    }
    return taskView(task);
  }

  async list(userId: string, limit: number) {
    const rows = await this.db.asUser(
      userId,
      (tx) => tx<TaskRow[]>`select * from tasks where user_id = ${userId} order by created_at desc limit ${limit}`,
    );
    return rows.map(taskView);
  }

  async get(userId: string, taskId: string) {
    return this.db.asUser(userId, async (tx) => {
      const task = await this.ownedTask(tx, userId, taskId);
      const approvals = await tx<ApprovalRow[]>`
        select * from approvals where task_id = ${task.id} and user_id = ${userId} order by created_at`;
      return { ...taskView(task), approvals: approvals.map(approvalView) };
    });
  }

  /**
   * Reads from the task's workspace through the sandbox server (files and
   * browser frames). Owner only; other users get 404 before the sandbox is asked.
   */
  async workspaceRead(userId: string, taskId: string, resource: WorkspaceResource, query: Record<string, string>): Promise<Response> {
    await this.db.asUser(userId, (tx) => this.ownedTask(tx, userId, taskId));
    return this.sandbox.read(taskId, resource, query);
  }

  async steps(userId: string, taskId: string, afterSeq = 0) {
    return this.db.asUser(userId, async (tx) => {
      const task = await this.ownedTask(tx, userId, taskId);
      const rows = await tx<StepRow[]>`
        select * from task_steps where task_id = ${task.id} and user_id = ${userId} and seq > ${afterSeq}
        order by seq`;
      return rows.map(stepView);
    });
  }

  async stop(userId: string, taskId: string) {
    const now = this.now();
    const { task, changed } = await this.db.asUser(userId, async (tx) => {
      const current = await this.ownedTask(tx, userId, taskId, true);
      if (isTerminal(current.status)) return { task: current, changed: false };
      await this.appendStep(tx, current, { kind: "message", title: "Stopped by user" }, now);
      await tx`update approvals set status = 'expired', decided_at = ${now}
        where task_id = ${current.id} and user_id = ${userId} and status = 'pending'`;
      const [row] = await tx<TaskRow[]>`
        update tasks set status = 'stopped', updated_at = ${now}, finished_at = ${now}
        where id = ${current.id} and user_id = ${userId} returning *`;
      await tx`insert into audit_log (user_id, action, target, created_at)
        values (${userId}, 'task.stopped', ${current.id}, ${now})`;
      return { task: row!, changed: true };
    });
    if (changed) {
      this.events.notify(task.id);
      this.sandbox.stopRun(task.id).catch((error) => this.log.warn("task.stop_push_failed", { taskId: task.id, error }));
    }
    return taskView(task);
  }

  async decide(userId: string, taskId: string, approvalId: string, rawDecision: unknown) {
    const decision =
      rawDecision === "approve" || rawDecision === "approved"
        ? "approved"
        : rawDecision === "reject" || rawDecision === "rejected"
          ? "rejected"
          : null;
    if (!decision) throw new HttpError(400, "invalid_decision", 'decision must be "approve" or "reject"');
    if (!isUuid(approvalId)) throw notFound();
    const now = this.now();
    const approval = await this.db.asUser(userId, async (tx) => {
      const task = await this.ownedTask(tx, userId, taskId, true);
      const [row] = await tx<ApprovalRow[]>`
        select * from approvals where id = ${approvalId} and task_id = ${task.id} and user_id = ${userId} for update`;
      if (!row) throw notFound();
      if (row.status !== "pending") throw conflict(`This approval is already ${row.status}`);
      if (isTerminal(task.status)) throw conflict(`The task is already ${task.status}`);
      const [updated] = await tx<ApprovalRow[]>`
        update approvals set status = ${decision}, decided_at = ${now} where id = ${row.id} returning *`;
      await this.appendStep(
        tx,
        task,
        {
          kind: "message",
          title: decision === "approved" ? "Approved by user" : "Rejected by user",
          detail: { approvalId: row.id },
        },
        now,
      );
      const [{ pending }] = await tx<{ pending: number }[]>`
        select count(*)::int as pending from approvals where task_id = ${task.id} and status = 'pending'`;
      if (pending === 0) {
        await tx`update tasks set status = 'running', updated_at = ${now} where id = ${task.id}`;
      }
      await tx`insert into audit_log (user_id, action, target, detail, created_at)
        values (${userId}, 'approval.decided', ${task.id}, ${tx.json({ approvalId: row.id, decision })}, ${now})`;
      return updated!;
    });
    this.events.notify(approval.task_id!);
    this.sandbox
      .sendDecision(approval.task_id!, approval.id, decision)
      .catch((error) => this.log.warn("task.decision_push_failed", { taskId: approval.task_id, error }));
    return approvalView(approval);
  }

  async me(userId: string) {
    const [user] = await this.db.asUser(
      userId,
      (tx) => tx<{ id: string; phone: string; created_at: Date }[]>`
        select id, phone, created_at from users where id = ${userId}`,
    );
    if (!user) throw notFound();
    return { id: user.id, phone: user.phone, createdAt: user.created_at.toISOString() };
  }

  async exportUser(userId: string) {
    const now = this.now();
    return this.db.asUser(userId, async (tx) => {
      const [user] = await tx<{ id: string; phone: string; created_at: Date }[]>`
        select id, phone, created_at from users where id = ${userId}`;
      if (!user) throw notFound();
      const tasks = await tx<TaskRow[]>`select * from tasks where user_id = ${userId} order by created_at`;
      const steps = await tx<StepRow[]>`select * from task_steps where user_id = ${userId} order by task_id, seq`;
      const approvals = await tx<ApprovalRow[]>`select * from approvals where user_id = ${userId} order by created_at`;
      const sessions = await tx<{ created_at: Date; expires_at: Date; revoked_at: Date | null }[]>`
        select created_at, expires_at, revoked_at from sessions where user_id = ${userId} order by created_at`;
      const chats = await tx<ChatSessionRow[]>`select * from chat_sessions where user_id = ${userId} order by created_at`;
      const items = await tx<SessionItemRow[]>`select * from session_items where user_id = ${userId} order by session_id, seq`;
      const agents = await tx<(AgentRow & { task_id: string | null; session_id: string | null })[]>`
        select * from agents where user_id = ${userId} order by created_at`;
      const bots = await tx<BotRow[]>`select * from bots where user_id = ${userId} order by created_at`;
      const audit = await tx<{ action: string; target: string | null; detail: unknown; created_at: Date }[]>`
        select action, target, detail, created_at from audit_log where user_id = ${userId} order by id`;
      await tx`insert into audit_log (user_id, action, created_at) values (${userId}, 'me.exported', ${now})`;
      return {
        exportedAt: now.toISOString(),
        user: { id: user.id, phone: user.phone, createdAt: user.created_at.toISOString() },
        tasks: tasks.map((task) => ({
          ...taskView(task),
          steps: steps.filter((step) => step.task_id === task.id).map(stepView),
          approvals: approvals.filter((approval) => approval.task_id === task.id).map(approvalView),
        })),
        chatSessions: chats.map((chat) => ({
          ...sessionView(chat),
          items: items.filter((item) => item.session_id === chat.id).map(itemView),
          approvals: approvals.filter((approval) => approval.session_id === chat.id).map(approvalView),
        })),
        agents: agents.map((agent) => ({ ...agentView(agent)!, taskId: agent.task_id, sessionId: agent.session_id })),
        bots: bots.map((bot) => botView(bot)),
        sessions: sessions.map((session) => ({
          createdAt: session.created_at.toISOString(),
          expiresAt: session.expires_at.toISOString(),
          revokedAt: session.revoked_at?.toISOString() ?? null,
        })),
        audit: audit.map((entry) => ({
          action: entry.action,
          target: entry.target,
          detail: entry.detail,
          createdAt: entry.created_at.toISOString(),
        })),
      };
    });
  }

  async deleteUser(userId: string): Promise<void> {
    const taskIds = await this.db.asUser(userId, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        select id from tasks where user_id = ${userId} union all select id from chat_sessions where user_id = ${userId}`;
      await tx`delete from users where id = ${userId}`;
      return rows.map((row) => row.id);
    });
    await this.db.asSystem(
      (tx) => tx`insert into audit_log (user_id, action, created_at) values (null, 'user.deleted', ${this.now()})`,
    );
    for (const taskId of taskIds) {
      this.events.notify(taskId);
      // Tasks and chat sessions share the workspace root and id space.
      this.sandbox.deleteSession(taskId).catch(() => {});
      this.sandbox.deleteRun(taskId).catch((error) => this.log.warn("task.workspace_delete_failed", { taskId, error }));
    }
    this.log.info("user.deleted", { userId, tasks: taskIds.length });
  }

  // ---------- internal operations, called by the sandbox ----------

  private async appendStep(tx: Tx, task: TaskRow, step: NewStep, now: Date): Promise<StepRow> {
    const [row] = await tx<StepRow[]>`
      insert into task_steps (task_id, user_id, seq, kind, title, detail, status, created_at)
      values (
        ${task.id}, ${task.user_id},
        (select coalesce(max(seq), 0) + 1 from task_steps where task_id = ${task.id}),
        ${step.kind}, ${step.title.slice(0, 500)}, ${tx.json((step.detail ?? {}) as never)},
        ${step.status ?? "done"}, ${now}
      ) returning *`;
    return row!;
  }

  private async lockActiveTask(tx: Tx, taskId: string): Promise<TaskRow> {
    if (!isUuid(taskId)) throw notFound();
    const [task] = await tx<TaskRow[]>`select * from tasks where id = ${taskId} for update`;
    if (!task) throw notFound();
    if (isTerminal(task.status)) throw conflict(`The task is already ${task.status}`);
    return task;
  }

  async systemAddStep(taskId: string, step: NewStep) {
    const now = this.now();
    const row = await this.db.asSystem(async (tx) => {
      const task = await this.lockActiveTask(tx, taskId);
      const inserted = await this.appendStep(tx, task, step, now);
      if (task.status === "queued") {
        await tx`update tasks set status = 'running', started_at = ${now}, updated_at = ${now} where id = ${task.id}`;
      } else {
        await tx`update tasks set updated_at = ${now} where id = ${task.id}`;
      }
      return inserted;
    });
    this.events.notify(taskId);
    return stepView(row);
  }

  async systemRequestApproval(taskId: string, prompt: string, detail: unknown) {
    const now = this.now();
    const approval = await this.db.asSystem(async (tx) => {
      const task = await this.lockActiveTask(tx, taskId);
      const step = await this.appendStep(
        tx,
        task,
        { kind: "approval_request", title: prompt.slice(0, 500), detail, status: "pending" },
        now,
      );
      const [row] = await tx<ApprovalRow[]>`
        insert into approvals (task_id, user_id, step_id, prompt, detail, created_at)
        values (${task.id}, ${task.user_id}, ${step.id}, ${prompt.slice(0, 2000)}, ${tx.json((detail ?? {}) as never)}, ${now})
        returning *`;
      await tx`update tasks set status = 'awaiting_approval', updated_at = ${now},
        started_at = coalesce(started_at, ${now}) where id = ${task.id}`;
      return row!;
    });
    this.events.notify(taskId);
    return approvalView(approval);
  }

  async systemGetApproval(taskId: string, approvalId: string) {
    if (!isUuid(taskId) || !isUuid(approvalId)) throw notFound();
    const [row] = await this.db.asSystem(
      (tx) => tx<ApprovalRow[]>`select * from approvals where id = ${approvalId} and task_id = ${taskId}`,
    );
    if (!row) throw notFound();
    return approvalView(row);
  }

  async systemFinish(taskId: string, status: "succeeded" | "failed", result: string | null, confidence: number | null) {
    const now = this.now();
    const row = await this.db.asSystem(async (tx) => {
      const task = await this.lockActiveTask(tx, taskId);
      if (status === "succeeded" && task.status === "awaiting_approval") {
        throw conflict("The task is waiting for an approval");
      }
      await this.appendStep(
        tx,
        task,
        {
          kind: "result",
          title: status === "succeeded" ? "Result" : "Task failed",
          detail: { result, confidence },
          status: status === "succeeded" ? "done" : "failed",
        },
        now,
      );
      await tx`update approvals set status = 'expired', decided_at = ${now}
        where task_id = ${task.id} and status = 'pending'`;
      const [updated] = await tx<TaskRow[]>`
        update tasks set status = ${status}, result = ${result}, confidence = ${confidence},
          updated_at = ${now}, finished_at = ${now}, started_at = coalesce(started_at, ${now})
        where id = ${task.id} returning *`;
      return updated!;
    });
    this.events.notify(taskId);
    this.log.info("task.finished", { taskId, status });
    return row;
  }

  /** Reads a task for the SSE stream. Returns null if it is gone or not owned. */
  async snapshot(userId: string, taskId: string, afterSeq: number) {
    return this.db.asUser(userId, async (tx) => {
      if (!isUuid(taskId)) return null;
      const [task] = await tx<TaskRow[]>`select * from tasks where id = ${taskId} and user_id = ${userId}`;
      if (!task) return null;
      const steps = await tx<StepRow[]>`
        select * from task_steps where task_id = ${task.id} and user_id = ${userId} and seq > ${afterSeq} order by seq`;
      const approvals = await tx<ApprovalRow[]>`
        select * from approvals where task_id = ${task.id} and user_id = ${userId} order by created_at`;
      return { task, steps, approvals };
    });
  }
}
