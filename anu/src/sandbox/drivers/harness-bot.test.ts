import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { DriverSettings } from "../protocol.js";
import {
  BOT_MODEL_PROFILES,
  BOT_SKILL_IDS,
  BOT_VERSION_FILE,
  THIS_BOT_HEADING,
  botProfileVersion,
  draftBotProfile,
  identityMarkdown,
  inferenceProfileFor,
  personaSystemPrompt,
  soulTemplatePath,
  writeBotFiles,
} from "./bot-profile.js";
import { configureRuntime, harnessSession } from "./harness.js";
import type { RuntimeClient } from "./harness-turn.js";
import type { BotProfile, DriverContext, SessionContext, SessionTurn } from "./types.js";

const ASSISTANT_DIR = path.resolve(import.meta.dir, "../../../../assistant");
const tmp = mkdtempSync(path.join(os.tmpdir(), "anu-harness-bot-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function bot(overrides: Partial<Omit<BotProfile, "version">> = {}): BotProfile {
  const fields = {
    id: "6f1c2a8e-3b4d-4c5e-9f60-7a8b9c0d1e2f",
    name: "Researcher",
    role: "Finds and compares sources",
    personality: "Calm and careful",
    instructions: "Cite each claim with a link.\nReply in the user's language.",
    avatar: { bodyShape: "dendrite", eyeStyle: "curious", color: "teal" },
    modelProfile: null as string | null,
    skills: [] as string[],
    ...overrides,
  };
  return { ...fields, version: botProfileVersion(fields) };
}

const settings = {
  kiloBaseUrl: "https://ai-gateway.kilo.ai/api/v1",
  kiloApiKey: "anonymous",
  kiloModel: "kilo/free-model",
  assistantDir: ASSISTANT_DIR,
  scriptedStepDelayMs: 0,
  allowInsecureHarness: true,
} satisfies DriverSettings;

function context(b?: BotProfile): { ctx: DriverContext; logs: string[] } {
  const logs: string[] = [];
  return {
    logs,
    ctx: {
      taskId: "00000000-0000-4000-8000-000000000009",
      goal: "",
      workspaceDir: tmp,
      env: {},
      settings,
      ...(b ? { bot: b } : {}),
      signal: new AbortController().signal,
      step() {},
      requestApproval: async () => "approved",
      log: (m) => void logs.push(m),
    },
  };
}

/** Records calls; POST /v1/messages answers with one reply on the event stream. */
function fakeRuntime() {
  const calls: { method: string; route: string; body: unknown }[] = [];
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const client: RuntimeClient = {
    async call(method, route, body) {
      calls.push({ method, route, body });
      if (route === "/v1/messages") {
        queueMicrotask(() => {
          for (const message of [{ type: "assistant_text_delta", text: "Here is a clear and complete answer for you." }, { type: "message_complete" }]) {
            controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ message })}\n\n`));
          }
        });
      }
      return { accepted: true };
    },
    async events() {
      return new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    },
  };
  return { client, calls };
}

describe("bot profile files (pre-boot)", () => {
  test("IDENTITY.md carries name, role and personality in the harness template format", async () => {
    const ws = mkdtempSync(path.join(tmp, "ws-"));
    const b = bot();
    expect(await writeBotFiles(ws, ASSISTANT_DIR, b)).toBe("written");
    const identity = readFileSync(path.join(ws, "IDENTITY.md"), "utf8");
    expect(identity).toBe(identityMarkdown(b));
    expect(identity).toContain("- **Name:** Researcher");
    expect(identity).toContain("- **Emoji:** none");
    expect(identity).toContain("- **Nature:** A personal AI agent that helps with any task");
    expect(identity).toContain("- **Personality:** Calm and careful");
    expect(identity).toContain("- **Role:** Finds and compares sources");
    expect(identity).toContain("## Avatar");
    // Not the shipped template, so the runtime uses it and seeds no onboarding.
    expect(identity).not.toBe(readFileSync(path.join(ASSISTANT_DIR, "src/prompts/templates/IDENTITY.md"), "utf8"));
  });

  test("SOUL.md is the template unchanged plus `## This bot`", async () => {
    const ws = mkdtempSync(path.join(tmp, "ws-"));
    await writeBotFiles(ws, ASSISTANT_DIR, bot());
    const soul = readFileSync(path.join(ws, "SOUL.md"), "utf8");
    const template = readFileSync(soulTemplatePath(ASSISTANT_DIR), "utf8");
    expect(soul.startsWith(template.trimEnd())).toBe(true);
    for (const heading of ["## Boundaries", "## How You Work", "## Personality"]) expect(soul).toContain(heading);
    expect(soul.trimEnd().endsWith(`${THIS_BOT_HEADING}\n\nCite each claim with a link.\nReply in the user's language.`)).toBe(true);
    expect(soul.split(THIS_BOT_HEADING)).toHaveLength(2);
    expect(readFileSync(path.join(ws, BOT_VERSION_FILE), "utf8").trim()).toBe(bot().version);
  });

  test("an unchanged version keeps the assistant's own edits; a new version rewrites", async () => {
    const ws = mkdtempSync(path.join(tmp, "ws-"));
    await writeBotFiles(ws, ASSISTANT_DIR, bot());
    const soulPath = path.join(ws, "SOUL.md");
    writeFileSync(soulPath, readFileSync(soulPath, "utf8") + "\nLearned: the user likes short answers.\n");
    expect(await writeBotFiles(ws, ASSISTANT_DIR, bot())).toBe("unchanged");
    expect(readFileSync(soulPath, "utf8")).toContain("Learned: the user likes short answers.");

    const edited = bot({ instructions: "Only use primary sources." });
    expect(edited.version).not.toBe(bot().version);
    expect(await writeBotFiles(ws, ASSISTANT_DIR, edited)).toBe("written");
    const soul = readFileSync(soulPath, "utf8");
    expect(soul).not.toContain("Learned:");
    expect(soul).toContain("Only use primary sources.");
  });

  test("a bot without instructions gets the template as is; versions are canonical", async () => {
    const ws = mkdtempSync(path.join(tmp, "ws-"));
    await writeBotFiles(ws, ASSISTANT_DIR, bot({ instructions: "  " }));
    expect(readFileSync(path.join(ws, "SOUL.md"), "utf8")).toBe(readFileSync(soulTemplatePath(ASSISTANT_DIR), "utf8"));
    const a = bot();
    const reordered = botProfileVersion({ ...a, avatar: { color: "teal", eyeStyle: "curious", bodyShape: "dendrite" } });
    expect(reordered).toBe(a.version);
    expect(existsSync(path.join(ws, BOT_VERSION_FILE))).toBe(true);
  });

  test("the draft profile is neutral and versioned", () => {
    const d = draftBotProfile();
    expect(d.name).toBe("ANU");
    expect(d.version).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("runtime configuration (post-boot)", () => {
  test("no bot: only the Kilo connection and the default profile", async () => {
    const { client, calls } = fakeRuntime();
    await configureRuntime(context().ctx, client);
    expect(calls.map((c) => c.route)).toEqual([
      "/v1/secrets",
      "/v1/inference/provider-connections",
      "/v1/inference/profiles",
      "/v1/config/set",
    ]);
    expect(calls[1]!.body).toMatchObject({ name: "kilo", provider: "openai-compatible", base_url: "https://ai-gateway.kilo.ai/api/v1" });
    expect(calls[0]!.body).toMatchObject({ value: "anonymous" });
  });

  test("a bot adds its avatar, an extra inference profile, and allowlisted skills", async () => {
    BOT_MODEL_PROFILES["kilo-alt"] = { model: "kilo/other-free-model" };
    (BOT_SKILL_IDS as string[]).push("weather");
    try {
      const b = bot({ modelProfile: "kilo-alt", skills: ["weather", "not-allowed"] });
      const { client, calls } = fakeRuntime();
      const { ctx, logs } = context(b);
      await configureRuntime(ctx, client);
      const after = calls.slice(4);
      expect(after).toEqual([
        { method: "POST", route: "/v1/avatar/render-from-traits", body: b.avatar },
        {
          method: "POST",
          route: "/v1/inference/profiles",
          body: { name: "kilo-alt", provider: "openai-compatible", model: "kilo/other-free-model", connection: "kilo", maxTokens: 8192, thinking: false },
        },
        { method: "POST", route: "/v1/skills/weather/enable", body: undefined },
      ]);
      expect(logs.join("\n")).toContain("not-allowed is not on the allowlist");
      expect(inferenceProfileFor(b)).toBe("kilo-alt");
    } finally {
      delete BOT_MODEL_PROFILES["kilo-alt"];
      (BOT_SKILL_IDS as string[]).pop();
    }
  });

  test("an avatar failure is logged, never fatal", async () => {
    const { client, calls } = fakeRuntime();
    const failing: RuntimeClient = {
      ...client,
      async call(method, route, body) {
        if (route === "/v1/avatar/render-from-traits") throw new Error("avatar store unavailable");
        return client.call(method, route, body);
      },
    };
    const { ctx, logs } = context(bot());
    await configureRuntime(ctx, failing);
    expect(logs.join("\n")).toContain("avatar render-from-traits failed");
    expect(calls.map((c) => c.route)).not.toContain("/v1/skills/weather/enable");
  });

  test("each chat turn passes the bot's inference profile", async () => {
    BOT_MODEL_PROFILES["kilo-alt"] = { model: null };
    try {
      for (const [b, expected] of [
        [bot({ modelProfile: "kilo-alt" }), "kilo-alt"],
        [bot(), "kilo-free"],
        [undefined, "kilo-free"],
        [bot({ modelProfile: "removed-profile" }), "kilo-free"],
      ] as const) {
        const { client, calls } = fakeRuntime();
        const ended: string[] = [];
        async function* turns(): AsyncGenerator<SessionTurn> {
          yield { turnId: "00000000-0000-4000-8000-0000000000aa", text: "hello" };
        }
        const session: SessionContext = {
          ...context(b).ctx,
          history: [],
          turns: turns(),
          endTurn: (_id, status) => void ended.push(status),
        };
        await harnessSession(session, client, tmp);
        expect(ended).toEqual(["succeeded"]);
        expect(calls.find((c) => c.route === "/v1/messages")!.body).toMatchObject({ inferenceProfile: expected });
      }
    } finally {
      delete BOT_MODEL_PROFILES["kilo-alt"];
    }
  });
});

describe("persona for drivers without a harness", () => {
  test("names the bot, its role, personality and instructions", () => {
    const prompt = personaSystemPrompt(bot(), "Answer plainly.");
    expect(prompt).toContain("You are Researcher, a personal AI agent that helps with any task.");
    expect(prompt).toContain("Your role: Finds and compares sources.");
    expect(prompt).toContain("Your personality: Calm and careful.");
    expect(prompt).toContain("Instructions for this bot:\nCite each claim with a link.");
    expect(personaSystemPrompt(undefined, "Answer plainly.")).toBe("You are ANU, a personal AI agent that helps with any task. Answer plainly.");
  });
});
