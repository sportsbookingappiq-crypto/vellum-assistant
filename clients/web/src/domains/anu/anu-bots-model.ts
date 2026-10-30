/**
 * Pure rules for the chat-first screens (anu/docs/design/phone-app.md):
 * the order bots are listed in, which face state each one shows, how agents
 * group on the Agents page, the "Needs you" rows, the plain caption that
 * says what a bot is doing, and the `anu-bot-draft` block ANU answers with
 * when asked to make a bot. Nothing here touches React or the network.
 */

import type {
  AnuAgent,
  AnuAvatarTraits,
  AnuBot,
  AnuBotStatus,
  AnuMessage,
  AnuSession,
  AnuStarter,
} from "./anu-api";

/** The face states the screens draw (spec A.2, "Avatar is the status display"). */
export type AnuFace = "rest" | "thinking" | "waiting" | "success" | "failed";

const STATUS_RANK: Record<AnuBotStatus, number> = {
  waiting_for_you: 0,
  working: 1,
  failed: 2,
  idle: 3,
};

function time(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Needs you, then working, then most recently used (spec A.3.4). */
export function orderBots(bots: readonly AnuBot[]): AnuBot[] {
  return [...bots].sort((a, b) => {
    const urgentA = Math.min(STATUS_RANK[a.status], 2);
    const urgentB = Math.min(STATUS_RANK[b.status], 2);
    if (urgentA !== urgentB) {
      return urgentA - urgentB;
    }
    return time(b.lastUsedAt ?? b.createdAt) - time(a.lastUsedAt ?? a.createdAt);
  });
}

export function botFace(status: AnuBotStatus): AnuFace {
  switch (status) {
    case "waiting_for_you":
      return "waiting";
    case "working":
      return "thinking";
    case "failed":
      return "failed";
    default:
      return "rest";
  }
}

export function sessionFace(status: string | null | undefined): AnuFace {
  if (status === "working") {
    return "thinking";
  }
  if (status === "waiting") {
    return "waiting";
  }
  if (status === "failed") {
    return "failed";
  }
  return "rest";
}

export function agentFace(agent: Pick<AnuAgent, "status">): AnuFace {
  switch (agent.status) {
    case "working":
      return "thinking";
    case "waiting":
      return "waiting";
    case "failed":
      return "failed";
    default:
      return "rest";
  }
}

export interface AgentGroups {
  waiting: AnuAgent[];
  working: AnuAgent[];
  finished: AnuAgent[];
}

/** Waiting for you, working now, finished (failed sit with finished). */
export function groupAgents(agents: readonly AnuAgent[]): AgentGroups {
  const groups: AgentGroups = { waiting: [], working: [], finished: [] };
  for (const agent of agents) {
    if (agent.status === "waiting") {
      groups.waiting.push(agent);
    } else if (agent.status === "working") {
      groups.working.push(agent);
    } else {
      groups.finished.push(agent);
    }
  }
  const recent = (a: AnuAgent, b: AnuAgent) =>
    time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt);
  groups.waiting.sort(recent);
  groups.working.sort(recent);
  groups.finished.sort(recent);
  return groups;
}

export interface NeedsYouRow {
  sessionId: string;
  botName: string | null;
  avatar: AnuAvatarTraits | null;
  request: string;
}

/** Sessions holding an open question, at most `limit`, newest first. */
export function needsYou(sessions: readonly AnuSession[], limit = 3): NeedsYouRow[] {
  const rows: NeedsYouRow[] = [];
  const open = [...sessions]
    .filter((session) => session.approvals.some((approval) => approval.status === "pending"))
    .sort((a, b) => time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt));
  for (const session of open) {
    const approval = session.approvals.find((entry) => entry.status === "pending");
    if (!approval) {
      continue;
    }
    rows.push({
      sessionId: session.id,
      botName: session.agentName,
      avatar: session.avatar,
      request: approval.prompt,
    });
    if (rows.length >= limit) {
      break;
    }
  }
  return rows;
}

/** Splits sessions into today and earlier, newest first in each. */
export function groupSessionsByDay(
  sessions: readonly AnuSession[],
  now: Date,
): { today: AnuSession[]; earlier: AnuSession[] } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const sorted = [...sessions].sort(
    (a, b) => time(b.updatedAt ?? b.createdAt) - time(a.updatedAt ?? a.createdAt),
  );
  return {
    today: sorted.filter((session) => time(session.updatedAt ?? session.createdAt) >= start.getTime()),
    earlier: sorted.filter((session) => time(session.updatedAt ?? session.createdAt) < start.getTime()),
  };
}

// ---------------------------------------------------------------------------
// What the bot is doing, in plain words.
// ---------------------------------------------------------------------------

/**
 * A step title read as an everyday activity. The API's titles are often the
 * tool's own ("Browser navigate: https://..."); the person sees "Opening
 * example.com" instead. Returns a key and its values so the caller
 * translates; `null` text means there is nothing worth saying.
 */
export type PlainActivity =
  | { kind: "opening"; host: string }
  | { kind: "searching"; query: string }
  | { kind: "reading"; name: string }
  | { kind: "writing"; name: string }
  | { kind: "working" }
  | { kind: "text"; text: string };

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function lastSegment(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

const TOOLISH = /^[a-z_]+[a-z0-9_.]*(\s|$)|^[A-Z][a-z]+ [a-z_]+:/;

export function plainActivity(raw: string | null | undefined): PlainActivity | null {
  const text = raw?.trim();
  if (!text) {
    return null;
  }
  const url = /(https?:\/\/[^\s)]+)/.exec(text)?.[1];
  if (/^browser\b|navigate|open_url|web_fetch|fetch_url/i.test(text) && url) {
    return { kind: "opening", host: hostOf(url) };
  }
  const search = /^(?:web[_ ])?search(?:ing)?[:\s]+["']?(.+?)["']?$/i.exec(text);
  if (search?.[1]) {
    return { kind: "searching", query: search[1] };
  }
  const read = /^(?:read|file_read|cat|view)[_ ]?(?:file)?[:\s]+(\S+)/i.exec(text);
  if (read?.[1]) {
    return { kind: "reading", name: lastSegment(read[1]) };
  }
  const write = /^(?:write|file_write|edit|create)[_ ]?(?:file)?[:\s]+(\S+)/i.exec(text);
  if (write?.[1]) {
    return { kind: "writing", name: lastSegment(write[1]) };
  }
  if (/^(bash|shell|exec|run|command|tool)\b/i.test(text) || TOOLISH.test(text)) {
    return { kind: "working" };
  }
  return { kind: "text", text };
}

export interface ProgressInfo {
  caption: string | null;
  step: number | null;
  total: number | null;
}

function numberField(detail: unknown, ...names: string[]): number | null {
  if (typeof detail !== "object" || detail === null) {
    return null;
  }
  const record = detail as Record<string, unknown>;
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

/**
 * The caption line for a busy chat: the newest step title of the running
 * turn, and the step count when the turn says how many there are.
 */
export function turnProgress(messages: readonly AnuMessage[]): ProgressInfo {
  let lastUser = -1;
  messages.forEach((message, index) => {
    if (message.role === "user") {
      lastUser = index;
    }
  });
  const steps = messages.slice(lastUser + 1).filter((message) => message.role === "tool");
  const latest = steps.at(-1);
  const total = steps.reduce<number | null>(
    (found, message) => numberField(message.detail, "totalSteps", "total") ?? found,
    null,
  );
  return {
    caption: latest?.content ?? null,
    step: total ? Math.min(steps.length, total) : null,
    total,
  };
}

/** The true fraction for the progress edge, or null when the count is unknown. */
export function progressFraction(progress: ProgressInfo): number | null {
  if (!progress.total || progress.step === null) {
    return null;
  }
  return Math.max(0, Math.min(1, progress.step / progress.total));
}

// ---------------------------------------------------------------------------
// ANU's inline bot preview (spec B.2, "Chat route").
// ---------------------------------------------------------------------------

export interface AnuBotDraftFields {
  name: string;
  role: string;
  personality: string;
  greeting: string;
  instructions: string;
  starters: AnuStarter[];
}

const DRAFT_FENCE = /```anu-bot-draft\s*\n([\s\S]*?)```/;

function clamp(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[–—]/g, ",").trim().slice(0, max) : "";
}

/**
 * Finds an `anu-bot-draft` fenced block in a reply. Returns the text around
 * it and the parsed fields, or null when there is no valid block (the reply
 * then renders as ordinary text).
 */
export function parseBotDraftBlock(
  text: string,
): { before: string; after: string; draft: AnuBotDraftFields } | null {
  const match = DRAFT_FENCE.exec(text);
  if (!match || match.index === undefined) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1] ?? "");
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const name = clamp(record.name, 40);
  if (!name) {
    return null;
  }
  const starters = Array.isArray(record.starters)
    ? record.starters
        .map((entry: unknown) => {
          const starter = (entry ?? {}) as Record<string, unknown>;
          return { label: clamp(starter.label, 60), prompt: clamp(starter.prompt, 500) };
        })
        .filter((starter) => starter.label && starter.prompt)
        .slice(0, 3)
    : [];
  return {
    before: text.slice(0, match.index).trim(),
    after: text.slice(match.index + match[0].length).trim(),
    draft: {
      name,
      role: clamp(record.role, 120),
      personality: clamp(record.personality, 200),
      greeting: clamp(record.greeting, 280),
      instructions: clamp(record.instructions, 4000),
      starters,
    },
  };
}

// ---------------------------------------------------------------------------
// Faces and names for the create flow.
// ---------------------------------------------------------------------------

/** FNV-1a: a small stable hash so a name always gets the same face. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface AvatarCatalogIds {
  bodyShapes: readonly string[];
  eyeStyles: readonly string[];
  colors: readonly string[];
}

/** A face picked from the catalog by `seed`; null when the catalog is empty. */
export function avatarFromSeed(seed: number, catalog: AvatarCatalogIds): AnuAvatarTraits | null {
  const { bodyShapes, eyeStyles, colors } = catalog;
  if (!bodyShapes.length || !eyeStyles.length || !colors.length) {
    return null;
  }
  return {
    bodyShape: bodyShapes[seed % bodyShapes.length] ?? bodyShapes[0] ?? "",
    eyeStyle: eyeStyles[Math.floor(seed / 7) % eyeStyles.length] ?? eyeStyles[0] ?? "",
    color: colors[Math.floor(seed / 53) % colors.length] ?? colors[0] ?? "",
  };
}

/**
 * The next reroll: a different name from `names` and a different face.
 * `turn` counts rerolls so each tap moves on.
 */
export function reroll(
  current: { name: string; avatar: AnuAvatarTraits | null },
  names: readonly string[],
  catalog: AvatarCatalogIds,
  turn: number,
): { name: string; avatar: AnuAvatarTraits | null } {
  const pool = names.filter((name) => name !== current.name);
  const seed = seedOf(`${current.name}:${turn}`);
  const name = pool.length ? (pool[seed % pool.length] ?? current.name) : current.name;
  let avatar = avatarFromSeed(seed, catalog);
  for (let step = 1; step < 6 && avatar && current.avatar && sameAvatar(avatar, current.avatar); step += 1) {
    avatar = avatarFromSeed(seed + step * 97, catalog);
  }
  return { name, avatar };
}

function sameAvatar(a: AnuAvatarTraits, b: AnuAvatarTraits): boolean {
  return a.bodyShape === b.bodyShape && a.eyeStyle === b.eyeStyle && a.color === b.color;
}

/** Text that reads as a name (1 to 3 words, nothing that looks like a sentence). */
export function looksLikeName(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 3 && !/[.,،?!؟:]/.test(text);
}

/** Validation the editor shows inline before saving (spec B.1). */
export function validateBotFields(fields: {
  name: string;
  role: string;
  greeting: string;
  instructions: string;
}): { name?: "required" | "tooLong"; role?: "tooLong"; greeting?: "tooLong"; instructions?: "tooLong" } {
  const errors: ReturnType<typeof validateBotFields> = {};
  const name = fields.name.trim();
  if (!name) {
    errors.name = "required";
  } else if (name.length > 40) {
    errors.name = "tooLong";
  }
  if (fields.role.length > 120) {
    errors.role = "tooLong";
  }
  if (fields.greeting.length > 280) {
    errors.greeting = "tooLong";
  }
  if (fields.instructions.length > 4000) {
    errors.instructions = "tooLong";
  }
  return errors;
}

/** The bot a chat opens with: the requested one, else the default, else ANU, else the first. */
export function pickBot(
  bots: readonly AnuBot[],
  requested: string | null | undefined,
  defaultBotId: string | null | undefined,
): AnuBot | null {
  return (
    bots.find((bot) => bot.id === requested) ??
    bots.find((bot) => bot.id === defaultBotId) ??
    bots.find((bot) => bot.defaultKey === "anu") ??
    bots[0] ??
    null
  );
}
