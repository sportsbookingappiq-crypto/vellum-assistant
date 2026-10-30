import { createHash } from "node:crypto";

import { z } from "zod";

import type { Db, Tx } from "../db/client.js";
import { HttpError, isUuid, notFound } from "../lib/http.js";
import type { Logger } from "../lib/log.js";
import { BOT_MODEL_PROFILES, BOT_SKILLS, BOT_SKILL_IDS, botProfileVersion } from "../sandbox/drivers/bot-profile.js";
import type { BotProfile } from "../sandbox/drivers/types.js";
import { ASSIGNED_EYE_STYLES, AVATAR_COLORS, BODY_SHAPES, EYE_STYLES, agentStatusOf, type AgentStatus } from "./agents.js";
import { BOT_TEMPLATES, DEFAULT_BOTS, matchTemplate, type BotLocale, type DefaultBotKey, type Starter } from "./default-bots.js";
import type { DraftResult, SandboxClient } from "./sandbox-client.js";

/** Most bots one user may have. */
export const BOT_LIMIT = 20;
/** Drafts per user per hour. */
export const DRAFT_RATE_LIMIT = 10;
/** Model profiles a bot may choose (the sandbox applies them). */
export const BOT_MODEL_PROFILE_NAMES = Object.keys(BOT_MODEL_PROFILES);
export { BOT_SKILL_IDS };

export interface BotRow {
  id: string;
  user_id: string;
  default_key: DefaultBotKey | null;
  name: string;
  role: string;
  personality: string;
  greeting: string;
  instructions: string;
  starters: Starter[];
  body_shape: string;
  eye_style: string;
  color: string;
  model_profile: string | null;
  skills: string[];
  locale: BotLocale;
  last_used_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type BotStatus = "waiting_for_you" | "working" | "failed" | "idle";

// ---------- text cleaning and validation ----------

/** Trims and replaces em and en dashes with commas (repo copy rule). */
export function cleanText(value: string): string {
  return value
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "");
}

const text = (max: number, min = 0) =>
  z.preprocess((v) => (typeof v === "string" ? cleanText(v) : v), z.string().min(min).max(max));

const oneOf = (list: readonly string[], what: string) =>
  z.string().refine((v) => list.includes(v), { message: `must be one of the catalog ${what}` });

export const AvatarInput = z
  .object({ bodyShape: oneOf(BODY_SHAPES, "body shapes"), eyeStyle: oneOf(EYE_STYLES, "eye styles"), color: oneOf(AVATAR_COLORS, "colors") })
  .strict();

export const StarterInput = z.object({ label: text(60, 1), prompt: text(500, 1) }).strict();

export const BotInput = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === "string" ? cleanText(v) : v),
      z
        .string()
        .min(1, "Name is required")
        .max(40)
        .regex(/^[^\p{Cc}]*$/u, "must not contain control characters or newlines"),
    ),
    role: text(120).optional(),
    personality: text(200).optional(),
    greeting: text(280).optional(),
    instructions: text(4000).optional(),
    starters: z.array(StarterInput).max(3).optional(),
    avatar: AvatarInput.optional(),
    modelProfile: oneOf(BOT_MODEL_PROFILE_NAMES, "model profiles").nullable().optional(),
    skills: z.array(oneOf(BOT_SKILL_IDS, "skills")).max(20).optional(),
    locale: z.enum(["ar", "en"]).optional(),
  })
  .strict();
export type BotInput = z.infer<typeof BotInput>;
export const BotPatch = BotInput.partial().strict();

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      400,
      "invalid_request",
      parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
    );
  }
  return parsed.data;
}

/** Deterministic avatar from a name, same scheme as agentIdentityFor (sha256 seed). */
export function avatarForName(name: string): { bodyShape: string; eyeStyle: string; color: string } {
  const digest = createHash("sha256").update(`bot:${name.trim().toLowerCase()}`).digest();
  const pick = (list: readonly string[], byte: number) => list[digest.readUInt16BE(byte) % list.length]!;
  return { bodyShape: pick(BODY_SHAPES, 2), eyeStyle: pick(ASSIGNED_EYE_STYLES, 4), color: pick(AVATAR_COLORS, 6) };
}

/** `ar` when Accept-Language starts with ar, otherwise `en`. */
export function localeFrom(header: string | null | undefined): BotLocale {
  return header && /^\s*ar\b/i.test(header) ? "ar" : "en";
}

// ---------- views and profiles ----------

export function botView(row: BotRow, status: BotStatus = "idle") {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    personality: row.personality,
    greeting: row.greeting,
    instructions: row.instructions,
    starters: row.starters,
    avatar: { bodyShape: row.body_shape, eyeStyle: row.eye_style, color: row.color },
    modelProfile: row.model_profile,
    skills: row.skills,
    locale: row.locale,
    isDefault: row.default_key !== null,
    defaultKey: row.default_key,
    deletable: row.default_key !== "anu",
    status,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
export type BotView = ReturnType<typeof botView>;

/** What the sandbox applies to a runtime (drivers/types.ts BotProfile). */
export function botProfileOf(row: BotRow): BotProfile {
  const fields = {
    id: row.id,
    name: row.name,
    role: row.role,
    personality: row.personality,
    instructions: row.instructions,
    avatar: { bodyShape: row.body_shape, eyeStyle: row.eye_style, color: row.color },
    modelProfile: row.model_profile,
    skills: [...row.skills],
  };
  return { ...fields, version: botProfileVersion(fields) };
}

// ---------- shared helpers for sessions and tasks ----------

/**
 * Creates the user's default bots once, in their locale. The users row lock
 * makes concurrent first requests wait for each other; `on conflict` keeps it
 * idempotent; `default_bots_seeded_at` keeps a deleted default from coming back.
 */
export async function ensureDefaultBots(tx: Tx, userId: string, locale: BotLocale, now: Date): Promise<void> {
  const [quick] = await tx<{ seeded: Date | null }[]>`select default_bots_seeded_at as seeded from users where id = ${userId}`;
  if (!quick || quick.seeded) return;
  const [user] = await tx<{ seeded: Date | null }[]>`
    select default_bots_seeded_at as seeded from users where id = ${userId} for update`;
  if (!user || user.seeded) return;
  for (const bot of DEFAULT_BOTS) {
    const t = bot.text[locale];
    await tx`insert into bots (user_id, default_key, name, role, personality, greeting, instructions, starters,
        body_shape, eye_style, color, locale, created_at, updated_at)
      values (${userId}, ${bot.key}, ${t.name}, ${t.role}, ${t.personality}, ${t.greeting}, ${bot.instructions},
        ${tx.json(t.starters as never)}, ${bot.avatar.bodyShape}, ${bot.avatar.eyeStyle}, ${bot.avatar.color},
        ${locale}, ${now}, ${now})
      on conflict (user_id, default_key) do nothing`;
  }
  await tx`update users set default_bots_seeded_at = ${now},
      default_bot_id = coalesce(default_bot_id, (select id from bots where user_id = ${userId} and default_key = 'anu'))
    where id = ${userId}`;
}

/** The user's bot by id; 404 for a malformed id or another user's bot. */
export async function ownedBot(tx: Tx, userId: string, botId: string, lock = false): Promise<BotRow> {
  if (!isUuid(botId)) throw notFound();
  const rows = lock
    ? await tx<BotRow[]>`select * from bots where id = ${botId} and user_id = ${userId} for update`
    : await tx<BotRow[]>`select * from bots where id = ${botId} and user_id = ${userId}`;
  if (!rows[0]) throw notFound();
  return rows[0];
}

/** The bot a new session or task uses: the given one, else the user's default, else ANU. */
export async function resolveBot(tx: Tx, userId: string, rawBotId: unknown, locale: BotLocale, now: Date): Promise<BotRow | null> {
  if (rawBotId !== undefined && rawBotId !== null && typeof rawBotId !== "string") {
    throw new HttpError(400, "invalid_request", "botId must be a uuid");
  }
  await ensureDefaultBots(tx, userId, locale, now);
  if (typeof rawBotId === "string") return ownedBot(tx, userId, rawBotId);
  const [row] = await tx<BotRow[]>`
    select b.* from bots b
    where b.user_id = ${userId}
      and (b.id = (select default_bot_id from users where id = ${userId}) or b.default_key = 'anu')
    order by (b.default_key = 'anu') nulls first
    limit 1`;
  return row ?? null;
}

export async function touchBot(tx: Tx, botId: string, now: Date): Promise<void> {
  await tx`update bots set last_used_at = ${now} where id = ${botId}`;
}

// ---------- draft parsing ----------

/** The first balanced `{ ... }` block in a reply, respecting JSON strings. */
export function firstJsonObject(reply: string): unknown {
  for (let start = reply.indexOf("{"); start !== -1; start = reply.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < reply.length; i++) {
      const ch = reply[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(reply.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

/** Cuts to `max` UTF-16 units without leaving half of a surrogate pair. */
const clip = (value: string, max: number) =>
  cleanText(value)
    .slice(0, max)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trim();

/** A model's reply. Anything but `name` may be missing or malformed and is left empty. */
const optionalText = z.string().catch("");
const DraftReply = z.object({
  name: z.string(),
  role: optionalText,
  personality: optionalText,
  greeting: optionalText,
  instructions: optionalText,
  starters: z.array(z.object({ label: optionalText, prompt: optionalText }).catch({ label: "", prompt: "" })).catch([]),
});

/** The draft input shape (D.5), with over-long strings truncated instead of refused. */
export function draftFromReply(reply: string): BotInput | null {
  const parsed = DraftReply.safeParse(firstJsonObject(reply));
  if (!parsed.success) return null;
  const { data } = parsed;
  const name = clip(data.name.replace(/[\p{Cc}]+/gu, " "), 40);
  if (!name) return null;
  return {
    name,
    role: clip(data.role, 120),
    personality: clip(data.personality, 200),
    greeting: clip(data.greeting, 280),
    instructions: clip(data.instructions, 4000),
    starters: data.starters
      .map((s) => ({ label: clip(s.label, 60), prompt: clip(s.prompt, 500) }))
      .filter((s) => s.label && s.prompt)
      .slice(0, 3),
  };
}

/** Deterministic draft from the template catalog. A 1 to 3 word input is taken as the name. */
export function fallbackDraft(description: string, locale: BotLocale): BotInput {
  const cleaned = cleanText(description).replace(/\s+/g, " ");
  const template = matchTemplate(cleaned);
  const t = template.text[locale];
  const words = cleaned.split(" ").filter(Boolean);
  const looksLikeName = words.length <= 3 && cleaned.length <= 40 && template.key === "generic";
  const name = looksLikeName ? cleaned : t.name;
  const instructions = looksLikeName
    ? template.instructions
    : `${template.instructions}\n\nWhat the user asked this bot to do: ${cleaned}`.slice(0, 4000);
  return {
    name,
    role: t.role,
    personality: t.personality,
    greeting: t.greeting,
    instructions,
    starters: t.starters.map((s) => ({ ...s })),
  };
}

// ---------- service ----------

interface LiveStatusRow {
  bot_id: string;
  kind: "task" | "session";
  status: string;
  updated_at: Date;
}

const STATUS_RANK: Record<BotStatus, number> = { waiting_for_you: 3, working: 2, failed: 1, idle: 0 };
/** A failed task counts toward its bot's status for this long. */
const RECENT_FAILURE_MS = 24 * 60 * 60 * 1000;

export class BotService {
  constructor(
    private readonly db: Db,
    private readonly sandbox: SandboxClient,
    private readonly now: () => Date,
    private readonly log: Logger,
  ) {}

  private async statuses(tx: Tx, userId: string): Promise<Map<string, BotStatus>> {
    const rows = await tx<LiveStatusRow[]>`
      select bot_id, 'session' as kind, status, updated_at from chat_sessions
        where user_id = ${userId} and bot_id is not null and status <> 'idle'
      union all
      select bot_id, 'task' as kind, status, updated_at from tasks
        where user_id = ${userId} and bot_id is not null and status in ('queued', 'running', 'awaiting_approval', 'failed')`;
    const now = this.now().getTime();
    const out = new Map<string, BotStatus>();
    for (const row of rows) {
      const agent: AgentStatus = agentStatusOf(row.kind, row.status);
      if (agent === "failed" && row.kind === "task" && now - row.updated_at.getTime() > RECENT_FAILURE_MS) continue;
      const status: BotStatus = agent === "waiting_for_you" || agent === "working" || agent === "failed" ? agent : "idle";
      if (STATUS_RANK[status] > STATUS_RANK[out.get(row.bot_id) ?? "idle"]) out.set(row.bot_id, status);
    }
    return out;
  }

  private async view(tx: Tx, userId: string, row: BotRow) {
    return botView(row, (await this.statuses(tx, userId)).get(row.id) ?? "idle");
  }

  async list(userId: string, locale: BotLocale) {
    return this.db.asUser(userId, async (tx) => {
      await ensureDefaultBots(tx, userId, locale, this.now());
      const rows = await tx<BotRow[]>`
        select * from bots where user_id = ${userId} order by last_used_at desc nulls last, created_at`;
      const statuses = await this.statuses(tx, userId);
      const [user] = await tx<{ default_bot_id: string | null }[]>`select default_bot_id from users where id = ${userId}`;
      const bots = rows
        .map((row, index) => ({ view: botView(row, statuses.get(row.id) ?? "idle"), index }))
        .sort((a, b) => {
          const urgent = (s: BotStatus) => (s === "waiting_for_you" ? 2 : s === "working" ? 1 : 0);
          return urgent(b.view.status) - urgent(a.view.status) || a.index - b.index;
        })
        .map((entry) => entry.view);
      const defaultBotId = user?.default_bot_id ?? rows.find((r) => r.default_key === "anu")?.id ?? null;
      return { bots, defaultBotId };
    });
  }

  options() {
    return {
      modelProfiles: BOT_MODEL_PROFILE_NAMES,
      skills: BOT_SKILLS.map((s) => ({ id: s.id, label: s.label })),
      templates: BOT_TEMPLATES.filter((t) => t.key !== "generic").map((t) => ({
        key: t.key,
        label: `anu.bots.templates.${t.key}.label`,
        description: `anu.bots.templates.${t.key}.description`,
      })),
    };
  }

  async get(userId: string, botId: string) {
    return this.db.asUser(userId, async (tx) => this.view(tx, userId, await ownedBot(tx, userId, botId)));
  }

  /** Locks the user row and refuses when the bot limit is reached. */
  private async checkLimit(tx: Tx, userId: string): Promise<void> {
    await tx`select id from users where id = ${userId} for update`;
    const [{ count }] = await tx<{ count: number }[]>`select count(*)::int as count from bots where user_id = ${userId}`;
    if (count >= BOT_LIMIT) {
      throw new HttpError(409, "bot_limit", `You've reached the limit of ${BOT_LIMIT} bots. Delete one to add another.`);
    }
  }

  async create(userId: string, body: unknown, locale: BotLocale) {
    const input = parse(BotInput, body);
    const now = this.now();
    return this.db.asUser(userId, async (tx) => {
      await ensureDefaultBots(tx, userId, locale, now);
      await this.checkLimit(tx, userId);
      const avatar = input.avatar ?? avatarForName(input.name);
      const [row] = await tx<BotRow[]>`
        insert into bots (user_id, name, role, personality, greeting, instructions, starters, body_shape, eye_style, color,
          model_profile, skills, locale, created_at, updated_at)
        values (${userId}, ${input.name}, ${input.role ?? ""}, ${input.personality ?? ""}, ${input.greeting ?? ""},
          ${input.instructions ?? ""}, ${tx.json((input.starters ?? []) as never)}, ${avatar.bodyShape}, ${avatar.eyeStyle},
          ${avatar.color}, ${input.modelProfile ?? null}, ${input.skills ?? []}, ${input.locale ?? locale}, ${now}, ${now})
        returning *`;
      await tx`insert into audit_log (user_id, action, target, created_at) values (${userId}, 'bot.created', ${row!.id}, ${now})`;
      return botView(row!);
    });
  }

  async update(userId: string, botId: string, body: unknown) {
    const patch = parse(BotPatch, body);
    const now = this.now();
    return this.db.asUser(userId, async (tx) => {
      const current = await ownedBot(tx, userId, botId, true);
      const avatar = patch.avatar ?? { bodyShape: current.body_shape, eyeStyle: current.eye_style, color: current.color };
      const [row] = await tx<BotRow[]>`
        update bots set
          name = ${patch.name ?? current.name},
          role = ${patch.role ?? current.role},
          personality = ${patch.personality ?? current.personality},
          greeting = ${patch.greeting ?? current.greeting},
          instructions = ${patch.instructions ?? current.instructions},
          starters = ${tx.json((patch.starters ?? current.starters) as never)},
          body_shape = ${avatar.bodyShape}, eye_style = ${avatar.eyeStyle}, color = ${avatar.color},
          model_profile = ${patch.modelProfile === undefined ? current.model_profile : patch.modelProfile},
          skills = ${patch.skills ?? current.skills},
          locale = ${patch.locale ?? current.locale},
          updated_at = ${now}
        where id = ${current.id} returning *`;
      // Agents keep showing the bot's face and name.
      await tx`update agents set name = ${row!.name}, body_shape = ${avatar.bodyShape}, eye_style = ${avatar.eyeStyle},
        color = ${avatar.color} where bot_id = ${current.id}`;
      await tx`insert into audit_log (user_id, action, target, created_at) values (${userId}, 'bot.updated', ${current.id}, ${now})`;
      return this.view(tx, userId, row!);
    });
  }

  async delete(userId: string, botId: string) {
    const now = this.now();
    await this.db.asUser(userId, async (tx) => {
      const bot = await ownedBot(tx, userId, botId, true);
      if (bot.default_key === "anu") throw new HttpError(409, "bot_not_deletable", "ANU can be edited but not deleted");
      await tx`delete from bots where id = ${bot.id}`;
      await tx`insert into audit_log (user_id, action, target, created_at) values (${userId}, 'bot.deleted', ${bot.id}, ${now})`;
    });
  }

  async duplicate(userId: string, botId: string) {
    const now = this.now();
    return this.db.asUser(userId, async (tx) => {
      const source = await ownedBot(tx, userId, botId);
      await this.checkLimit(tx, userId);
      const suffix = source.locale === "ar" ? " ٢" : " 2";
      const name = `${source.name.slice(0, 40 - suffix.length).trim()}${suffix}`;
      const [row] = await tx<BotRow[]>`
        insert into bots (user_id, name, role, personality, greeting, instructions, starters, body_shape, eye_style, color,
          model_profile, skills, locale, created_at, updated_at)
        values (${userId}, ${name}, ${source.role}, ${source.personality}, ${source.greeting}, ${source.instructions},
          ${tx.json(source.starters as never)}, ${source.body_shape}, ${source.eye_style}, ${source.color},
          ${source.model_profile}, ${source.skills}, ${source.locale}, ${now}, ${now})
        returning *`;
      await tx`insert into audit_log (user_id, action, target, detail, created_at)
        values (${userId}, 'bot.created', ${row!.id}, ${tx.json({ duplicateOf: source.id })}, ${now})`;
      return botView(row!);
    });
  }

  async setDefault(userId: string, body: unknown) {
    const { botId } = parse(z.object({ botId: z.string() }).strict(), body);
    await this.db.asUser(userId, async (tx) => {
      const bot = await ownedBot(tx, userId, botId);
      await tx`update users set default_bot_id = ${bot.id} where id = ${userId}`;
    });
  }

  /**
   * Drafts a bot from one sentence. The model call happens in the sandbox,
   * through the configured driver (for the harness, its own provider); this
   * service only parses. Any failure falls back to a template draft.
   */
  async draft(userId: string, body: unknown, requestLocale: BotLocale) {
    const input = parse(
      z.object({ description: text(500, 1), locale: z.enum(["ar", "en"]).optional() }).strict(),
      body,
    );
    const locale = input.locale ?? requestLocale;
    const now = this.now();
    await this.db.asUser(userId, async (tx) => {
      const since = new Date(now.getTime() - 60 * 60 * 1000);
      const [{ count }] = await tx<{ count: number }[]>`
        select count(*)::int as count from audit_log where user_id = ${userId} and action = 'bot.drafted' and created_at > ${since}`;
      if (count >= DRAFT_RATE_LIMIT) {
        throw new HttpError(429, "rate_limited", "Too many drafts. Try again later.", { "retry-after": "3600" });
      }
      await tx`insert into audit_log (user_id, action, created_at) values (${userId}, 'bot.drafted', ${now})`;
    });

    let result: DraftResult;
    try {
      result = await this.sandbox.draft(input.description, locale);
    } catch (error) {
      this.log.warn("bot.draft_failed", { error });
      result = { status: "failed", error: "the sandbox could not be reached" };
    }
    if (result.status === "succeeded" && result.json) {
      const draft = draftFromReply(result.json);
      if (draft) return { draft: { ...draft, avatar: avatarForName(draft.name), locale }, source: "model" as const };
      this.log.warn("bot.draft_invalid_output", { length: result.json.length });
    }
    const fallbackReason =
      result.status === "unavailable"
        ? ("driver_unavailable" as const)
        : result.status === "timeout"
          ? ("timeout" as const)
          : result.status === "succeeded"
            ? ("invalid_output" as const)
            : ("error" as const);
    const draft = fallbackDraft(input.description, locale);
    return { draft: { ...draft, avatar: avatarForName(draft.name), locale }, source: "fallback" as const, fallbackReason };
  }
}
