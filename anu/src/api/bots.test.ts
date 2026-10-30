import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Sql } from "../db/client.js";
import { adminSql, makeTestApi, resetPhones, type TestApi } from "../test/helpers.js";
import { BOT_LIMIT, avatarForName, cleanText, draftFromReply, fallbackDraft, firstJsonObject, localeFrom } from "./bots.js";
import { DEFAULT_BOTS } from "./default-bots.js";

const OWNER = "+18085550100";
const OTHER = "+18085550101";
const ARABIC = "+18085550102";
const RACER = "+18085550103";
const LIMITED = "+18085550104";

let sql: Sql;
let t: TestApi;
let token: string;
let otherToken: string;

beforeAll(async () => {
  sql = await adminSql();
  await resetPhones(sql, [OWNER, OTHER, ARABIC, RACER, LIMITED]);
  t = makeTestApi();
  token = await t.login(OWNER);
  otherToken = await t.login(OTHER);
});

afterAll(async () => {
  await t.close();
  await sql.end();
});

const getJson = async (p: string, as = token, headers: Record<string, string> = {}) =>
  (await t.call("GET", p, { token: as, headers })).json() as Promise<any>;
const post = (p: string, body: unknown, as = token, headers: Record<string, string> = {}) => t.call("POST", p, { token: as, body, headers });

const NO_DASHES = /[\u2013\u2014]/;

describe("default bots", () => {
  test("seeded lazily on first list, in English, with ANU first as the default", async () => {
    const list = await getJson("/v1/bots");
    expect(list.bots.map((b: any) => b.defaultKey)).toEqual(["anu", "researcher", "shopper"]);
    const anu = list.bots[0];
    expect(list.defaultBotId).toBe(anu.id);
    expect(anu).toMatchObject({
      name: "ANU",
      greeting: "Hi, I'm ANU. What can I help with?",
      avatar: { bodyShape: "stellar", eyeStyle: "gentle", color: "teal" },
      isDefault: true,
      deletable: false,
      status: "idle",
      locale: "en",
      modelProfile: null,
      skills: [],
    });
    expect(anu.starters.map((s: any) => s.label)).toEqual(["Plan my weekend", "Summarize a news story", "Make me a bot"]);
    expect(list.bots[1]).toMatchObject({ name: "Researcher", avatar: { bodyShape: "dendrite", eyeStyle: "curious", color: "teal" }, deletable: true });
    expect(list.bots[2]).toMatchObject({ name: "Shopper", avatar: { bodyShape: "cloud", eyeStyle: "goofy", color: "orange" } });
    for (const bot of list.bots) {
      expect(JSON.stringify(bot)).not.toMatch(NO_DASHES);
      expect(bot.instructions).toContain("Reply in the user's language.");
    }
  });

  test("seeded in Arabic from Accept-Language, and idempotent under concurrent first requests", async () => {
    const arToken = await t.login(ARABIC);
    const headers = { "accept-language": "ar-SA,ar;q=0.9" };
    const results = await Promise.all([
      t.call("GET", "/v1/bots", { token: arToken, headers }),
      t.call("GET", "/v1/sessions", { token: arToken, headers }),
      t.call("POST", "/v1/sessions", { token: arToken, headers, body: {} }),
      t.call("GET", "/v1/bots", { token: arToken, headers }),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 201, 200]);
    const list = await getJson("/v1/bots", arToken, headers);
    expect(list.bots).toHaveLength(3);
    const byKey = Object.fromEntries(list.bots.map((b: any) => [b.defaultKey, b]));
    expect(byKey.anu).toMatchObject({ name: "ANU", greeting: "أهلاً، أنا ANU. بماذا أساعدك؟", locale: "ar" });
    expect(byKey.researcher.name).toBe("باحث");
    expect(byKey.shopper.name).toBe("متسوّق");
    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count from bots b join users u on u.id = b.user_id where u.phone = ${ARABIC}`;
    expect(count).toBe(3);
  });

  test("concurrent first requests from a new user never duplicate defaults", async () => {
    const racer = await t.login(RACER);
    await Promise.all(Array.from({ length: 6 }, () => t.call("GET", "/v1/bots", { token: racer })));
    expect((await getJson("/v1/bots", racer)).bots).toHaveLength(3);
  });

  test("a deleted default bot is not recreated, ANU cannot be deleted", async () => {
    const list = await getJson("/v1/bots", otherToken);
    const shopper = list.bots.find((b: any) => b.defaultKey === "shopper");
    const anu = list.bots.find((b: any) => b.defaultKey === "anu");
    expect((await t.call("DELETE", `/v1/bots/${shopper.id}`, { token: otherToken })).status).toBe(204);
    expect((await getJson("/v1/bots", otherToken)).bots.map((b: any) => b.defaultKey)).not.toContain("shopper");
    const refused = await t.call("DELETE", `/v1/bots/${anu.id}`, { token: otherToken });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as any).error.code).toBe("bot_not_deletable");
    // ANU can still be edited.
    const edited = await t.call("PATCH", `/v1/bots/${anu.id}`, { token: otherToken, body: { greeting: "Hello there." } });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as any).greeting).toBe("Hello there.");
  });
});

describe("bot CRUD", () => {
  test("create, get, patch, duplicate, delete", async () => {
    const created = await post("/v1/bots", {
      name: "  Flight watcher  ",
      role: "Watches prices \u2014 and tells me",
      greeting: "Hi, I watch flights.",
      instructions: "Check prices to Dubai daily.",
      starters: [{ label: "Check now", prompt: "Check flights to Dubai now." }],
    });
    expect(created.status).toBe(201);
    const bot = (await created.json()) as any;
    expect(bot).toMatchObject({
      name: "Flight watcher",
      role: "Watches prices, and tells me",
      isDefault: false,
      defaultKey: null,
      deletable: true,
      avatar: avatarForName("Flight watcher"),
      locale: "en",
    });
    expect(await getJson(`/v1/bots/${bot.id}`)).toEqual(bot);

    const patched = await t.call("PATCH", `/v1/bots/${bot.id}`, {
      token,
      body: { name: "Fare watcher", avatar: { bodyShape: "stellar", eyeStyle: "dazed", color: "pink" }, modelProfile: "kilo-free" },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      name: "Fare watcher",
      role: "Watches prices, and tells me",
      avatar: { bodyShape: "stellar", eyeStyle: "dazed", color: "pink" },
      modelProfile: "kilo-free",
    });

    const dup = await post(`/v1/bots/${bot.id}/duplicate`, undefined);
    expect(dup.status).toBe(201);
    const copy = (await dup.json()) as any;
    expect(copy).toMatchObject({ name: "Fare watcher 2", defaultKey: null, role: "Watches prices, and tells me" });
    expect(copy.id).not.toBe(bot.id);

    expect((await t.call("DELETE", `/v1/bots/${copy.id}`, { token })).status).toBe(204);
    expect((await t.call("GET", `/v1/bots/${copy.id}`, { token })).status).toBe(404);
  });

  test("validation rejects bad fields and unknown properties", async () => {
    const cases: unknown[] = [
      {},
      { name: "" },
      { name: "   " },
      { name: "x".repeat(41) },
      { name: "two\nlines" },
      { name: "ok", role: "r".repeat(121) },
      { name: "ok", instructions: "i".repeat(4001) },
      { name: "ok", starters: [{ label: "a", prompt: "b" }, { label: "a", prompt: "b" }, { label: "a", prompt: "b" }, { label: "a", prompt: "b" }] },
      { name: "ok", starters: [{ label: "", prompt: "b" }] },
      { name: "ok", avatar: { bodyShape: "dragon", eyeStyle: "gentle", color: "teal" } },
      { name: "ok", avatar: { bodyShape: "stellar", eyeStyle: "gentle", color: "teal", glow: true } },
      { name: "ok", modelProfile: "gpt-unknown" },
      { name: "ok", skills: ["shell"] },
      { name: "ok", locale: "fr" },
      { name: "ok", tagline: "nope" },
    ];
    for (const body of cases) {
      const res = await post("/v1/bots", body);
      expect([JSON.stringify(body).slice(0, 60), res.status]).toEqual([JSON.stringify(body).slice(0, 60), 400]);
      expect(((await res.json()) as any).error.code).toBe("invalid_request");
    }
    const named = await post("/v1/bots", { name: "" });
    expect(((await named.json()) as any).error.message).toContain("name");
    const { bots } = await getJson("/v1/bots");
    expect((await t.call("PATCH", `/v1/bots/${bots[0].id}`, { token, body: { unknown: 1 } })).status).toBe(400);
    expect((await t.call("PATCH", `/v1/bots/${bots[0].id}`, { token, body: { name: "" } })).status).toBe(400);
  });

  test("another user's bot is 404 for every operation", async () => {
    const bot = (await (await post("/v1/bots", { name: "Mine only" })).json()) as any;
    const attempts: [string, string, unknown?][] = [
      ["GET", `/v1/bots/${bot.id}`],
      ["PATCH", `/v1/bots/${bot.id}`, { name: "Stolen" }],
      ["DELETE", `/v1/bots/${bot.id}`],
      ["POST", `/v1/bots/${bot.id}/duplicate`],
      ["PUT", "/v1/me/default-bot", { botId: bot.id }],
      ["GET", "/v1/bots/not-a-uuid"],
    ];
    for (const [method, p, body] of attempts) {
      expect([method, p, (await t.call(method, p, { token: otherToken, body })).status]).toEqual([method, p, 404]);
    }
    expect((await getJson("/v1/bots", otherToken)).bots.map((b: any) => b.id)).not.toContain(bot.id);
    expect((await getJson(`/v1/bots/${bot.id}`)).name).toBe("Mine only");
    // RLS is the second line: the other user's scope sees no row even without the owner filter.
    const [other] = await sql<{ id: string }[]>`select id from users where phone = ${OTHER}`;
    const visible = await t.api.db.asUser(other!.id, (tx) => tx`select id from bots where id = ${bot.id}`);
    expect(visible.length).toBe(0);
  });

  test("auth is required", async () => {
    for (const [method, p] of [["GET", "/v1/bots"], ["POST", "/v1/bots"], ["GET", "/v1/bots/options"], ["POST", "/v1/bots/draft"]]) {
      expect((await t.call(method!, p!)).status).toBe(401);
    }
  });

  test("default bot can be changed and new sessions use it", async () => {
    const bot = (await (await post("/v1/bots", { name: "My default" })).json()) as any;
    expect((await t.call("PUT", "/v1/me/default-bot", { token, body: { botId: bot.id } })).status).toBe(204);
    expect((await getJson("/v1/bots")).defaultBotId).toBe(bot.id);
    const s = (await (await post("/v1/sessions", {})).json()) as any;
    expect(s.botId).toBe(bot.id);
    expect((await t.call("PUT", "/v1/me/default-bot", { token, body: {} })).status).toBe(400);
    // Deleting the default falls back to ANU.
    await t.call("DELETE", `/v1/bots/${bot.id}`, { token });
    const anu = (await getJson("/v1/bots")).bots.find((b: any) => b.defaultKey === "anu");
    expect(((await (await post("/v1/sessions", {})).json()) as any).botId).toBe(anu.id);
  });

  test("the bot limit is 20", async () => {
    const limited = await t.login(LIMITED);
    await getJson("/v1/bots", limited); // 3 defaults
    for (let i = 0; i < BOT_LIMIT - 3; i++) expect((await post("/v1/bots", { name: `Bot ${i}` }, limited)).status).toBe(201);
    const over = await post("/v1/bots", { name: "One too many" }, limited);
    expect(over.status).toBe(409);
    expect(((await over.json()) as any).error.code).toBe("bot_limit");
    const anyBot = (await getJson("/v1/bots", limited)).bots[0];
    expect((await post(`/v1/bots/${anyBot.id}/duplicate`, undefined, limited)).status).toBe(409);
  });

  test("status reflects the bot's live sessions, and the list puts waiting bots first", async () => {
    const bot = (await (await post("/v1/bots", { name: "Busy one" })).json()) as any;
    const s = (await (await post("/v1/sessions", { botId: bot.id })).json()) as any;
    await post(`/v1/sessions/${s.id}/messages`, { text: "go" });
    expect((await getJson(`/v1/bots/${bot.id}`)).status).toBe("working");
    const turnId = t.sandbox.turns.at(-1)!.turnId;
    await t.call("POST", `/internal/v1/sessions/${s.id}/approvals`, {
      token: t.config.ANU_INTERNAL_TOKEN,
      body: { turnId, prompt: "Send this email to Sara?" },
    });
    const list = await getJson("/v1/bots");
    expect(list.bots[0]).toMatchObject({ id: bot.id, status: "waiting_for_you" });
  });

  test("options list model profiles, skills and template keys", async () => {
    const options = await getJson("/v1/bots/options");
    expect(options.modelProfiles).toEqual(["kilo-free"]);
    expect(options.skills).toEqual([]);
    expect(options.templates.map((x: any) => x.key)).toEqual(["researcher", "shopper", "writer", "tutor", "planner", "inbox"]);
    expect(options.templates[0]).toEqual({
      key: "researcher",
      label: "anu.bots.templates.researcher.label",
      description: "anu.bots.templates.researcher.description",
    });
  });

  test("export includes bots", async () => {
    const data = await getJson("/v1/me/export");
    expect(data.bots.map((b: any) => b.defaultKey)).toContain("anu");
  });
});

describe("drafts", () => {
  test("scripted driver: deterministic fallback with a reason, matching a template", async () => {
    const res = await post("/v1/bots/draft", { description: "watches flight prices to Dubai and tells me when they drop" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ source: "fallback", fallbackReason: "driver_unavailable" });
    expect(body.draft).toMatchObject({ name: "Shopper", locale: "en", avatar: avatarForName("Shopper") });
    expect(body.draft.instructions).toContain("watches flight prices to Dubai");
    expect(body.draft.starters.length).toBeGreaterThan(0);
    // The draft is valid input for POST /v1/bots as it is.
    expect((await post("/v1/bots", body.draft)).status).toBe(201);
    expect(t.sandbox.drafts.at(-1)).toEqual({ description: "watches flight prices to Dubai and tells me when they drop", locale: "en" });
  });

  test("Arabic and a short name-like input", async () => {
    const ar = (await (await post("/v1/bots/draft", { description: "يتابع أسعار الرحلات إلى دبي", locale: "ar" })).json()) as any;
    expect(ar.draft).toMatchObject({ name: "متسوّق", locale: "ar" });
    const named = (await (await post("/v1/bots/draft", { description: "Captain Recipes" })).json()) as any;
    expect(named.draft.name).toBe("Captain Recipes");
    const header = (await (await post("/v1/bots/draft", { description: "Sous chef" }, token, { "accept-language": "ar" })).json()) as any;
    expect(header.draft.locale).toBe("ar");
  });

  test("model output is parsed, cleaned and truncated", async () => {
    t.sandbox.draftResult = {
      status: "succeeded",
      json: 'Here you go:\n```json\n{"name": "Fare Finder \u2014 Pro", "role": "' + "r".repeat(200) + '", "personality": "calm", "greeting": "Hi!", "instructions": "Watch fares. Reply in the user\'s language.", "starters": [{"label": "Check", "prompt": "Check fares {now}"}, {"label": "", "prompt": "x"}]}\n```',
    };
    const body = (await (await post("/v1/bots/draft", { description: "finds cheap fares" })).json()) as any;
    expect(body.source).toBe("model");
    expect(body.fallbackReason).toBeUndefined();
    expect(body.draft).toMatchObject({ name: "Fare Finder, Pro", personality: "calm", greeting: "Hi!" });
    expect(body.draft.role).toHaveLength(120);
    expect(body.draft.starters).toEqual([{ label: "Check", prompt: "Check fares {now}" }]);
    expect(body.draft.avatar).toEqual(avatarForName("Fare Finder, Pro"));

    t.sandbox.draftResult = { status: "succeeded", json: "I cannot do that." };
    expect(await (await post("/v1/bots/draft", { description: "anything" })).json()).toMatchObject({
      source: "fallback",
      fallbackReason: "invalid_output",
    });
    t.sandbox.draftResult = { status: "timeout" };
    expect(((await (await post("/v1/bots/draft", { description: "anything" })).json()) as any).fallbackReason).toBe("timeout");
    t.sandbox.draftResult = { status: "failed", error: "boom" };
    expect(((await (await post("/v1/bots/draft", { description: "anything" })).json()) as any).fallbackReason).toBe("error");
  });

  test("validation and the hourly rate limit", async () => {
    expect((await post("/v1/bots/draft", { description: "" }, otherToken)).status).toBe(400);
    expect((await post("/v1/bots/draft", { description: "x".repeat(501) }, otherToken)).status).toBe(400);
    expect((await post("/v1/bots/draft", { description: "ok", extra: 1 }, otherToken)).status).toBe(400);
    for (let i = 0; i < 10; i++) expect((await post("/v1/bots/draft", { description: `bot ${i}` }, otherToken)).status).toBe(200);
    const limited = await post("/v1/bots/draft", { description: "one more" }, otherToken);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as any).error.code).toBe("rate_limited");
  });
});

describe("helpers", () => {
  test("cleanText, firstJsonObject, draftFromReply, fallbackDraft, localeFrom", () => {
    expect(cleanText("  a \u2014 b \u2013 c  ")).toBe("a, b, c");
    expect(firstJsonObject('x {"a": "}{", "b": {"c": 1}} y {"z": 2}')).toEqual({ a: "}{", b: { c: 1 } });
    expect(firstJsonObject("{broken {\"ok\": true}")).toEqual({ ok: true });
    expect(draftFromReply('{"role": "no name"}')).toBeNull();
    expect(fallbackDraft("teach me algebra", "en").name).toBe("Tutor");
    expect(fallbackDraft("something unusual entirely here", "en").name).toBe("Helper");
    expect(localeFrom("ar-EG")).toBe("ar");
    expect(localeFrom("en-US,ar;q=0.5")).toBe("en");
    expect(localeFrom(null)).toBe("en");
    for (const bot of DEFAULT_BOTS) expect(JSON.stringify(bot)).not.toMatch(NO_DASHES);
  });
});
