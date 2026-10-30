import { createHash } from "node:crypto";

import { getCharacterComponents } from "../../../packages/avatar-catalog/src/index.js";
import type { Db, Tx } from "../db/client.js";

/** Display names for agents. Assignment is by hash of the task or session id. */
export const AGENT_NAMES = ["Nova", "Orion", "Lyra", "Vega", "Atlas", "Juno", "Echo", "Iris", "Rune", "Sol", "Wren", "Zephyr"];

const catalog = getCharacterComponents();
export const BODY_SHAPES = catalog.bodyShapes.map((b) => b.id);
export const EYE_STYLES = catalog.eyeStyles.map((e) => e.id);
export const AVATAR_COLORS = catalog.colors.map((c) => c.id);
/**
 * Eye styles handed out automatically. `surprised` looks shocked and has by far
 * the narrowest pupil, so only a user's own choice can pick it.
 */
export const ASSIGNED_EYE_STYLES = EYE_STYLES.filter((id) => id !== "surprised");

export interface AgentIdentity {
  name: string;
  avatar: { bodyShape: string; eyeStyle: string; color: string };
}

/** Deterministic name and avatar traits for a task or session id. */
export function agentIdentityFor(seed: string): AgentIdentity {
  const digest = createHash("sha256").update(seed).digest();
  const pick = <T>(list: readonly T[], byte: number) => list[digest.readUInt16BE(byte) % list.length]!;
  return {
    name: pick(AGENT_NAMES, 0),
    avatar: { bodyShape: pick(BODY_SHAPES, 2), eyeStyle: pick(ASSIGNED_EYE_STYLES, 4), color: pick(AVATAR_COLORS, 6) },
  };
}

/** The bot an agent runs as. Its name and face become the agent's. */
export interface AgentBot extends AgentIdentity {
  id: string;
}

export async function insertAgent(
  tx: Tx,
  userId: string,
  link: { taskId: string } | { sessionId: string },
  now: Date,
  bot?: AgentBot | null,
) {
  const id = "taskId" in link ? link.taskId : link.sessionId;
  const { name, avatar } = bot ?? agentIdentityFor(id);
  await tx`insert into agents (user_id, name, body_shape, eye_style, color, task_id, session_id, bot_id, created_at)
    values (${userId}, ${name}, ${avatar.bodyShape}, ${avatar.eyeStyle}, ${avatar.color},
      ${"taskId" in link ? link.taskId : null}, ${"sessionId" in link ? link.sessionId : null}, ${bot?.id ?? null}, ${now})
    on conflict do nothing`;
}

export const AGENT_STATUSES = ["working", "waiting_for_you", "idle", "finished", "failed"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export function agentStatusOf(kind: "task" | "session", status: string): AgentStatus {
  if (kind === "task") {
    if (status === "queued" || status === "running") return "working";
    if (status === "awaiting_approval") return "waiting_for_you";
    if (status === "failed") return "failed";
    return "finished"; // succeeded, stopped
  }
  if (status === "working" || status === "waiting_for_you" || status === "failed") return status;
  return "idle";
}

interface AgentListRow {
  id: string;
  name: string;
  body_shape: string;
  eye_style: string;
  color: string;
  task_id: string | null;
  session_id: string | null;
  bot_id: string | null;
  created_at: Date;
  status: string;
  label: string;
  updated_at: Date;
  doing: string | null;
}

export class AgentService {
  constructor(private readonly db: Db) {}

  async list(userId: string, filter?: string | null) {
    const rows = await this.db.asUser(
      userId,
      (tx) => tx<AgentListRow[]>`
        select a.id, a.name, a.body_shape, a.eye_style, a.color, a.task_id, a.session_id, a.bot_id, a.created_at,
          coalesce(t.status, s.status) as status,
          coalesce(t.goal, s.title) as label,
          coalesce(t.updated_at, s.updated_at) as updated_at,
          case when a.task_id is not null
            then (select title from task_steps where task_id = a.task_id order by seq desc limit 1)
            else (select title from session_items where session_id = a.session_id order by seq desc limit 1)
          end as doing
        from agents a
        left join tasks t on t.id = a.task_id and t.user_id = ${userId}
        left join chat_sessions s on s.id = a.session_id and s.user_id = ${userId}
        where a.user_id = ${userId} and (t.id is not null or s.id is not null)
        order by coalesce(t.updated_at, s.updated_at) desc
        limit 200`,
    );
    const agents = rows.map((row) => {
      const kind = row.task_id ? ("task" as const) : ("session" as const);
      return {
        id: row.id,
        name: row.name,
        avatar: { bodyShape: row.body_shape, eyeStyle: row.eye_style, color: row.color },
        kind,
        taskId: row.task_id,
        sessionId: row.session_id,
        botId: row.bot_id,
        status: agentStatusOf(kind, row.status),
        sourceStatus: row.status,
        title: row.label,
        doing: row.doing,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      };
    });
    return filter ? agents.filter((a) => a.status === filter) : agents;
  }
}
