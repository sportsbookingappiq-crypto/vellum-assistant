import type { Db, Tx } from "../db/client.js";
import { HttpError, isUuid, notFound } from "../lib/http.js";
import type { Logger } from "../lib/log.js";
import { insertAgent } from "./agents.js";
import { botProfileOf, ownedBot, resolveBot, touchBot, ensureDefaultBots, type BotRow } from "./bots.js";
import type { BotLocale } from "./default-bots.js";
import {
  agentView,
  approvalView,
  itemView,
  sessionBotView,
  sessionView,
  type AgentRow,
  type ApprovalRow,
  type ChatSessionRow,
  type ItemKind,
  type SessionItemRow,
  type StepStatus,
} from "./model.js";
import type { SandboxClient, WorkspaceResource } from "./sandbox-client.js";
import type { TaskEvents } from "./tasks.js";

export interface NewItem {
  kind: ItemKind;
  title: string;
  text?: string | null;
  detail?: unknown;
  status?: StepStatus;
  turnId?: string | null;
}

const conflict = (message: string) => new HttpError(409, "conflict", message);
const firstLine = (text: string, max = 200) => {
  const line = text.trim().split("\n")[0]!.trim() || "(empty)";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
/** How many earlier messages are sent to a new worker. */
const HISTORY_LIMIT = 100;

/**
 * Chat sessions: a conversation with an agent, separate from tasks. Each user
 * message starts a turn in the session's long-lived sandbox worker. Items
 * (messages, steps, approvals, turn ends) share one ordered sequence.
 */
export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly sandbox: SandboxClient,
    /** Shared with tasks; session and task ids never collide. */
    readonly events: TaskEvents,
    private readonly now: () => Date,
    private readonly log: Logger,
  ) {}

  private async owned(tx: Tx, userId: string, sessionId: string, lock = false): Promise<ChatSessionRow> {
    if (!isUuid(sessionId)) throw notFound();
    const rows = lock
      ? await tx<ChatSessionRow[]>`select * from chat_sessions where id = ${sessionId} and user_id = ${userId} for update`
      : await tx<ChatSessionRow[]>`select * from chat_sessions where id = ${sessionId} and user_id = ${userId}`;
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  private async detail(tx: Tx, session: ChatSessionRow) {
    const [agent] = await tx<AgentRow[]>`select * from agents where session_id = ${session.id}`;
    const approvals = await tx<ApprovalRow[]>`
      select * from approvals where session_id = ${session.id} and user_id = ${session.user_id} order by created_at`;
    const [last] = await tx<SessionItemRow[]>`
      select * from session_items where session_id = ${session.id} order by seq desc limit 1`;
    const [bot] = session.bot_id ? await tx<BotRow[]>`select * from bots where id = ${session.bot_id}` : [];
    return {
      ...sessionView(session),
      bot: sessionBotView(bot),
      agent: agentView(agent),
      lastItem: last ? itemView(last) : null,
      approvals: approvals.map(approvalView),
    };
  }

  async create(userId: string, rawTitle: unknown, rawBotId: unknown = undefined, locale: BotLocale = "en") {
    if (rawTitle !== undefined && rawTitle !== null && (typeof rawTitle !== "string" || rawTitle.length > 200)) {
      throw new HttpError(400, "invalid_title", "title must be a string of at most 200 characters");
    }
    const title = (typeof rawTitle === "string" && rawTitle.trim()) || "New chat";
    const now = this.now();
    return this.db.asUser(userId, async (tx) => {
      const bot = await resolveBot(tx, userId, rawBotId, locale, now);
      const profile = bot ? botProfileOf(bot) : null;
      const [row] = await tx<ChatSessionRow[]>`
        insert into chat_sessions (user_id, title, bot_id, bot_version, created_at, updated_at)
        values (${userId}, ${title.trim()}, ${bot?.id ?? null}, ${profile?.version ?? null}, ${now}, ${now}) returning *`;
      await insertAgent(tx, userId, { sessionId: row!.id }, now, bot && profile ? { id: bot.id, name: bot.name, avatar: profile.avatar } : null);
      if (bot) await touchBot(tx, bot.id, now);
      await tx`insert into audit_log (user_id, action, target, created_at)
        values (${userId}, 'session.created', ${row!.id}, ${now})`;
      return this.detail(tx, row!);
    });
  }

  async list(userId: string, limit: number, botId: string | null = null, locale: BotLocale = "en") {
    return this.db.asUser(userId, async (tx) => {
      await ensureDefaultBots(tx, userId, locale, this.now());
      if (botId !== null) await ownedBot(tx, userId, botId);
      const rows = botId
        ? await tx<ChatSessionRow[]>`
            select * from chat_sessions where user_id = ${userId} and bot_id = ${botId} order by updated_at desc limit ${limit}`
        : await tx<ChatSessionRow[]>`
            select * from chat_sessions where user_id = ${userId} order by updated_at desc limit ${limit}`;
      const out = [];
      for (const row of rows) out.push(await this.detail(tx, row));
      return out;
    });
  }

  async get(userId: string, sessionId: string) {
    return this.db.asUser(userId, async (tx) => this.detail(tx, await this.owned(tx, userId, sessionId)));
  }

  async items(userId: string, sessionId: string, afterSeq = 0) {
    return this.db.asUser(userId, async (tx) => {
      const session = await this.owned(tx, userId, sessionId);
      const rows = await tx<SessionItemRow[]>`
        select * from session_items where session_id = ${session.id} and user_id = ${userId} and seq > ${afterSeq}
        order by seq limit 1000`;
      return rows.map(itemView);
    });
  }

  async workspaceRead(userId: string, sessionId: string, resource: WorkspaceResource, query: Record<string, string>) {
    await this.db.asUser(userId, (tx) => this.owned(tx, userId, sessionId));
    return this.sandbox.read(sessionId, resource, query);
  }

  private async append(tx: Tx, session: ChatSessionRow, item: NewItem, now: Date): Promise<SessionItemRow> {
    const [row] = await tx<SessionItemRow[]>`
      insert into session_items (session_id, user_id, seq, kind, title, text, detail, status, turn_id, created_at)
      values (
        ${session.id}, ${session.user_id},
        (select coalesce(max(seq), 0) + 1 from session_items where session_id = ${session.id}),
        ${item.kind}, ${item.title.slice(0, 500)}, ${item.text ?? null}, ${tx.json((item.detail ?? {}) as never)},
        ${item.status ?? "done"}, ${item.turnId ?? null}, ${now}
      ) returning *`;
    return row!;
  }

  /** Stores the user's message and starts a turn. Returns 202 data. */
  async send(userId: string, sessionId: string, text: unknown) {
    if (typeof text !== "string" || text.trim().length === 0 || text.length > 20_000) {
      throw new HttpError(400, "invalid_text", "text must be a non-empty string of at most 20000 characters");
    }
    const now = this.now();
    const { item, history, bot } = await this.db.asUser(userId, async (tx) => {
      const session = await this.owned(tx, userId, sessionId, true);
      if (session.status === "working" || session.status === "waiting_for_you") {
        throw conflict("The agent is still answering. Stop the turn or wait for it to finish.");
      }
      const earlier = await tx<{ kind: string; text: string | null }[]>`
        select kind, text from session_items
        where session_id = ${session.id} and kind in ('user_message', 'assistant_message') and text is not null
        order by seq desc limit ${HISTORY_LIMIT}`;
      const item = await this.append(tx, session, { kind: "user_message", title: firstLine(text), text }, now);
      await tx`update session_items set turn_id = ${item.id} where id = ${item.id}`;
      item.turn_id = item.id;
      const title = session.title === "New chat" && earlier.length === 0 ? firstLine(text, 80) : session.title;
      // The bot as it is now: an edit since the last turn reaches the runtime
      // from this turn (the sandbox replaces an idle worker of an older version).
      const [botRow] = session.bot_id ? await tx<BotRow[]>`select * from bots where id = ${session.bot_id}` : [];
      const bot = botRow ? botProfileOf(botRow) : undefined;
      await tx`update chat_sessions set status = 'working', title = ${title}, bot_version = ${bot?.version ?? null},
        updated_at = ${now} where id = ${session.id}`;
      if (botRow) await touchBot(tx, botRow.id, now);
      return {
        bot,
        item,
        history: earlier.reverse().map((row) => ({
          role: row.kind === "user_message" ? ("user" as const) : ("assistant" as const),
          text: row.text!,
        })),
      };
    });
    this.events.notify(sessionId);
    try {
      const { driver } = await this.sandbox.sendTurn(sessionId, item.id, text, history, bot);
      await this.db.asUser(userId, (tx) => tx`update chat_sessions set driver = ${driver} where id = ${sessionId}`);
    } catch (error) {
      this.log.error("session.dispatch_failed", { sessionId, error });
      await this.systemTurnDone(sessionId, item.id, "failed", "The sandbox could not start this turn.").catch(() => {});
    }
    return { turnId: item.id, item: itemView(item) };
  }

  async stop(userId: string, sessionId: string) {
    const now = this.now();
    const { session, changed } = await this.db.asUser(userId, async (tx) => {
      const current = await this.owned(tx, userId, sessionId, true);
      if (current.status !== "working" && current.status !== "waiting_for_you") return { session: current, changed: false };
      const [open] = await tx<{ turn_id: string | null }[]>`
        select turn_id from session_items where session_id = ${current.id} and kind = 'user_message' order by seq desc limit 1`;
      await tx`update approvals set status = 'expired', decided_at = ${now}
        where session_id = ${current.id} and status = 'pending'`;
      await this.append(tx, current, { kind: "message", title: "Stopped by user", turnId: open?.turn_id ?? null }, now);
      await this.append(
        tx,
        current,
        { kind: "turn_complete", title: "Turn stopped", detail: { status: "stopped" }, turnId: open?.turn_id ?? null },
        now,
      );
      const [row] = await tx<ChatSessionRow[]>`
        update chat_sessions set status = 'idle', updated_at = ${now} where id = ${current.id} returning *`;
      return { session: row!, changed: true };
    });
    if (changed) {
      this.events.notify(sessionId);
      this.sandbox.stopSession(sessionId).catch((error) => this.log.warn("session.stop_push_failed", { sessionId, error }));
    }
    return this.get(userId, session.id);
  }

  async decide(userId: string, sessionId: string, approvalId: string, rawDecision: unknown) {
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
      const session = await this.owned(tx, userId, sessionId, true);
      const [row] = await tx<ApprovalRow[]>`
        select * from approvals where id = ${approvalId} and session_id = ${session.id} and user_id = ${userId} for update`;
      if (!row) throw notFound();
      if (row.status !== "pending") throw conflict(`This approval is already ${row.status}`);
      const [updated] = await tx<ApprovalRow[]>`
        update approvals set status = ${decision}, decided_at = ${now} where id = ${row.id} returning *`;
      await this.append(
        tx,
        session,
        { kind: "message", title: decision === "approved" ? "Approved by user" : "Rejected by user", detail: { approvalId: row.id } },
        now,
      );
      const [{ pending }] = await tx<{ pending: number }[]>`
        select count(*)::int as pending from approvals where session_id = ${session.id} and status = 'pending'`;
      if (pending === 0) await tx`update chat_sessions set status = 'working', updated_at = ${now} where id = ${session.id}`;
      await tx`insert into audit_log (user_id, action, target, detail, created_at)
        values (${userId}, 'approval.decided', ${session.id}, ${tx.json({ approvalId: row.id, decision })}, ${now})`;
      return updated!;
    });
    this.events.notify(sessionId);
    this.sandbox
      .sendDecision(sessionId, approval.id, decision)
      .catch((error) => this.log.warn("session.decision_push_failed", { sessionId, error }));
    return approvalView(approval);
  }

  async delete(userId: string, sessionId: string) {
    const now = this.now();
    await this.db.asUser(userId, async (tx) => {
      const session = await this.owned(tx, userId, sessionId, true);
      await tx`delete from chat_sessions where id = ${session.id}`;
      await tx`insert into audit_log (user_id, action, target, created_at) values (${userId}, 'session.deleted', ${session.id}, ${now})`;
    });
    this.events.notify(sessionId);
    this.sandbox.deleteSession(sessionId).catch((error) => this.log.warn("session.delete_push_failed", { sessionId, error }));
  }

  /** For the SSE stream. Null when gone or not owned. */
  async snapshot(userId: string, sessionId: string, afterSeq: number) {
    return this.db.asUser(userId, async (tx) => {
      if (!isUuid(sessionId)) return null;
      const [session] = await tx<ChatSessionRow[]>`select * from chat_sessions where id = ${sessionId} and user_id = ${userId}`;
      if (!session) return null;
      const items = await tx<SessionItemRow[]>`
        select * from session_items where session_id = ${session.id} and seq > ${afterSeq} order by seq limit 500`;
      const approvals = await tx<ApprovalRow[]>`select * from approvals where session_id = ${session.id} order by created_at`;
      return { session, items, approvals };
    });
  }

  // ---------- internal operations, called by the sandbox ----------

  /** Locks a session whose turn `turnId` is still open; 409 otherwise (stopped, finished, or replaced). */
  private async lockTurn(tx: Tx, sessionId: string, turnId: string): Promise<ChatSessionRow> {
    if (!isUuid(sessionId) || !isUuid(turnId)) throw notFound();
    const [session] = await tx<ChatSessionRow[]>`select * from chat_sessions where id = ${sessionId} for update`;
    if (!session) throw notFound();
    const [open] = await tx<{ turn_id: string | null }[]>`
      select turn_id from session_items where session_id = ${session.id} and kind = 'user_message' order by seq desc limit 1`;
    const [done] = await tx<{ id: string }[]>`
      select id from session_items where session_id = ${session.id} and kind = 'turn_complete' and turn_id = ${turnId} limit 1`;
    if (open?.turn_id !== turnId || done || (session.status !== "working" && session.status !== "waiting_for_you")) {
      throw conflict("This turn is no longer active");
    }
    return session;
  }

  async systemAddItem(sessionId: string, turnId: string, item: NewItem) {
    const now = this.now();
    const row = await this.db.asSystem(async (tx) => {
      const session = await this.lockTurn(tx, sessionId, turnId);
      const inserted = await this.append(tx, session, { ...item, turnId }, now);
      await tx`update chat_sessions set updated_at = ${now} where id = ${session.id}`;
      return inserted;
    });
    this.events.notify(sessionId);
    return itemView(row);
  }

  async systemRequestApproval(sessionId: string, turnId: string, prompt: string, detail: unknown) {
    const now = this.now();
    const approval = await this.db.asSystem(async (tx) => {
      const session = await this.lockTurn(tx, sessionId, turnId);
      const item = await this.append(
        tx,
        session,
        { kind: "approval_request", title: prompt.slice(0, 500), detail, status: "pending", turnId },
        now,
      );
      const [row] = await tx<ApprovalRow[]>`
        insert into approvals (session_id, user_id, prompt, detail, created_at)
        values (${session.id}, ${session.user_id}, ${prompt.slice(0, 2000)}, ${tx.json({ ...(detail as object), itemId: item.id } as never)}, ${now})
        returning *`;
      await tx`update chat_sessions set status = 'waiting_for_you', updated_at = ${now} where id = ${session.id}`;
      return row!;
    });
    this.events.notify(sessionId);
    return approvalView(approval);
  }

  async systemTurnDone(sessionId: string, turnId: string, status: "succeeded" | "failed" | "stopped", reply: string) {
    const now = this.now();
    await this.db.asSystem(async (tx) => {
      const session = await this.lockTurn(tx, sessionId, turnId);
      if (reply.trim()) {
        await this.append(
          tx,
          session,
          status === "succeeded"
            ? { kind: "assistant_message", title: firstLine(reply), text: reply, turnId }
            : { kind: "message", title: firstLine(reply), detail: { error: reply }, status: "failed", turnId },
          now,
        );
      }
      await this.append(
        tx,
        session,
        {
          kind: "turn_complete",
          title: status === "succeeded" ? "Turn complete" : status === "stopped" ? "Turn stopped" : "Turn failed",
          detail: { status },
          status: status === "failed" ? "failed" : "done",
          turnId,
        },
        now,
      );
      await tx`update approvals set status = 'expired', decided_at = ${now} where session_id = ${session.id} and status = 'pending'`;
      await tx`update chat_sessions set status = ${status === "failed" ? "failed" : "idle"}, updated_at = ${now} where id = ${session.id}`;
    });
    this.events.notify(sessionId);
  }
}
