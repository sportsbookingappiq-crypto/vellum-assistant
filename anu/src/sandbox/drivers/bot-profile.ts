import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { upsertSetting, type RuntimeClient } from "./harness-turn.js";
import type { DriverSettings } from "../protocol.js";
import type { BotProfile } from "./types.js";

/**
 * How a bot reaches the harness. Every field maps to a mechanism the runtime
 * already has (see docs/design/phone-app.md, section C):
 * - name, role, personality: IDENTITY.md in the workspace, loaded into the system prompt.
 * - instructions: SOUL.md, the shipped template plus a `## This bot` section.
 * - avatar: POST /v1/avatar/render-from-traits.
 * - modelProfile: an `llm.profiles` entry, passed per turn as `inferenceProfile`.
 * - skills: POST /v1/skills/:id/enable.
 */

/** The profile every runtime gets. Its model is the sandbox's KILO_MODEL. */
export const DEFAULT_MODEL_PROFILE = "kilo-free";

/**
 * Inference profiles a bot may choose. `model: null` means the sandbox's
 * configured Kilo model. Every entry runs on the Kilo connection the driver
 * creates; users never send provider configuration.
 */
export const BOT_MODEL_PROFILES: Record<string, { model: string | null }> = {
  [DEFAULT_MODEL_PROFILE]: { model: null },
};

/**
 * Harness skill ids a bot may enable. Empty for now, so the app hides the
 * Skills switches. Labels are i18n keys resolved by the client.
 */
export const BOT_SKILLS: readonly { id: string; label: string }[] = [];
export const BOT_SKILL_IDS: readonly string[] = BOT_SKILLS.map((s) => s.id);

/** The sidecar that records which bot version the workspace files were written for. */
export const BOT_VERSION_FILE = ".anu-bot-version";

type VersionedFields = Omit<BotProfile, "version">;

/** sha256 of the canonical JSON of the profile fields (keys sorted, skills in order). */
export function botProfileVersion(fields: VersionedFields): string {
  const canonical = {
    avatar: { bodyShape: fields.avatar.bodyShape, color: fields.avatar.color, eyeStyle: fields.avatar.eyeStyle },
    id: fields.id,
    instructions: fields.instructions,
    modelProfile: fields.modelProfile,
    name: fields.name,
    personality: fields.personality,
    role: fields.role,
    skills: [...fields.skills],
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** One line for a markdown list item: no newlines, never empty. */
const line = (value: string, fallback: string) => value.replace(/\s+/g, " ").trim() || fallback;

export const BOT_NATURE = "A personal AI agent that helps with any task";

export function identityMarkdown(bot: BotProfile): string {
  return [
    "# IDENTITY.md",
    "",
    `- **Name:** ${line(bot.name, "ANU")}`,
    "- **Emoji:** none",
    `- **Nature:** ${BOT_NATURE}`,
    `- **Personality:** ${line(bot.personality, "Warm and plain-spoken")}`,
    `- **Role:** ${line(bot.role, "Helps with any task")}`,
    "",
    "## Avatar",
    "",
  ].join("\n");
}

export const THIS_BOT_HEADING = "## This bot";

/**
 * The shipped SOUL.md template, unchanged, with the bot's instructions
 * appended as `## This bot`. The template's own sections (Boundaries, How You
 * Work, and the rest) are never replaced.
 */
export function soulMarkdown(template: string, bot: BotProfile): string {
  const instructions = bot.instructions.trim();
  if (!instructions) return template;
  return `${template.trimEnd()}\n\n${THIS_BOT_HEADING}\n\n${instructions}\n`;
}

export function soulTemplatePath(assistantDir: string): string {
  return path.join(assistantDir, "src", "prompts", "templates", "SOUL.md");
}

/**
 * Pre-boot: writes IDENTITY.md and SOUL.md into the runtime workspace, unless
 * the sidecar says this bot version is already there. Skipping keeps the
 * assistant's own later edits to SOUL.md while the bot is unchanged; a new
 * version (an edit in the app) rewrites both files.
 */
export async function writeBotFiles(workspace: string, assistantDir: string, bot: BotProfile): Promise<"written" | "unchanged"> {
  const sidecar = path.join(workspace, BOT_VERSION_FILE);
  if (existsSync(sidecar) && (await readFile(sidecar, "utf8")).trim() === bot.version) return "unchanged";
  const templatePath = soulTemplatePath(assistantDir);
  if (!existsSync(templatePath)) throw new Error(`SOUL.md template not found at ${templatePath}`);
  const template = await readFile(templatePath, "utf8");
  await writeFile(path.join(workspace, "IDENTITY.md"), identityMarkdown(bot));
  await writeFile(path.join(workspace, "SOUL.md"), soulMarkdown(template, bot));
  await writeFile(sidecar, `${bot.version}\n`);
  return "written";
}

export function inferenceProfileFor(bot: BotProfile | undefined): string {
  const name = bot?.modelProfile;
  return name && name in BOT_MODEL_PROFILES ? name : DEFAULT_MODEL_PROFILE;
}

/** The model a bot runs on: its profile's model, else the sandbox's KILO_MODEL. */
export function modelFor(bot: BotProfile | undefined, settings: Pick<DriverSettings, "kiloModel">): string {
  return BOT_MODEL_PROFILES[inferenceProfileFor(bot)]?.model ?? settings.kiloModel;
}

/** The harness connection every model runs on. */
export const KILO_CONNECTION = "kilo";

/** An inference profile on the Kilo connection, as the runtime's profile routes take it. */
export function kiloProfileFields(model: string) {
  return { provider: "openai-compatible", model, connection: KILO_CONNECTION, maxTokens: 8192, thinking: false };
}

/**
 * Post-boot: avatar, extra inference profile, skills. Every call is
 * idempotent, so a resumed session repeats them safely. The avatar is
 * cosmetic for the runtime (the app renders from traits), so its failure is
 * logged, never fatal.
 */
export async function applyBotRuntime(
  client: RuntimeClient,
  bot: BotProfile,
  settings: Pick<DriverSettings, "kiloModel">,
  log: (message: string) => void,
): Promise<void> {
  try {
    await client.call("POST", "/v1/avatar/render-from-traits", bot.avatar);
  } catch (error) {
    log(`avatar render-from-traits failed: ${String(error)}`);
  }
  const profile = inferenceProfileFor(bot);
  if (profile !== DEFAULT_MODEL_PROFILE) {
    await upsertSetting(client, "/v1/inference/profiles", profile, kiloProfileFields(modelFor(bot, settings)));
  }
  for (const skill of bot.skills) {
    if (!BOT_SKILL_IDS.includes(skill)) {
      log(`skill ${skill} is not on the allowlist, skipped`);
      continue;
    }
    await client.call("POST", `/v1/skills/${encodeURIComponent(skill)}/enable`);
  }
}

/** System prompt for drivers without a harness (kilo): the same persona in one message. */
export function personaSystemPrompt(bot: BotProfile | undefined, base: string): string {
  const nature = `${BOT_NATURE.charAt(0).toLowerCase()}${BOT_NATURE.slice(1)}`;
  if (!bot) return `You are ANU, ${nature}. ${base}`;
  const parts = [`You are ${line(bot.name, "ANU")}, ${nature}.`];
  if (bot.role.trim()) parts.push(`Your role: ${line(bot.role, "").replace(/[.]+$/, "")}.`);
  if (bot.personality.trim()) parts.push(`Your personality: ${line(bot.personality, "").replace(/[.]+$/, "")}.`);
  parts.push(base);
  const head = parts.join(" ");
  const instructions = bot.instructions.trim();
  return instructions ? `${head}\n\nInstructions for this bot:\n${instructions}` : head;
}

/**
 * The profile a draft runtime boots with. Writing IDENTITY.md keeps the
 * runtime from seeding its first-run onboarding (BOOTSTRAP.md), which would
 * otherwise compete with the draft prompt.
 */
export function draftBotProfile(): BotProfile {
  const fields = {
    id: "00000000-0000-4000-8000-000000000000",
    name: "ANU",
    role: "Designs personal assistant bots",
    personality: "Concise",
    instructions: "",
    avatar: { bodyShape: "stellar", eyeStyle: "gentle", color: "teal" },
    modelProfile: null,
    skills: [],
  };
  return { ...fields, version: botProfileVersion(fields) };
}

/**
 * The one turn a draft job sends. The reply must be a single JSON object
 * (see the API's draft schema); anything else is treated as invalid output.
 */
export function draftPrompt(description: string, locale: "ar" | "en"): string {
  const language = locale === "ar" ? "Arabic" : "English";
  return [
    "Design a personal assistant bot from this description. Reply with one JSON object and nothing else.",
    `Description: ${JSON.stringify(description)}`,
    `Keys: "name" (1 to 3 words, at most 40 characters), "role" (one line, at most 120 characters), "personality" (a few words, at most 200 characters), "greeting" (one or two short sentences the bot says first, at most 280 characters), "instructions" (how the bot should work, in English, under 600 characters, ending with "Reply in the user's language."), "starters" (up to 3 objects with "label", at most 60 characters, and "prompt", at most 500 characters, that a user could tap to start).`,
    `Write name, role, personality, greeting and starters in ${language}. Plain, warm words. No emoji, no em dashes.`,
  ].join("\n");
}
