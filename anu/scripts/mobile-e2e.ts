/**
 * Simulated phone run of the ANU thin client (no phone OS needed).
 *
 * Loads the web app's `/anu` screens in Chromium at 390x844 with an iPhone and
 * then a Pixel user agent, with a stub of the Capacitor native bridge that
 * reports platform `ios` / `android` and implements the `NativeBiometric`
 * secure token store the `/anu` code uses on native. Every request the page
 * makes is recorded and checked: data requests may only go to the ANU API.
 *
 * Then it checks identity matching through the app: right code, wrong code
 * (attempt counted), expired code, per-user task lists, another user's task
 * id returning 404, logout clearing and revoking the token, and approve and
 * stop round trips through the API and the sandbox (scripted driver).
 *
 * Needs: API :8787 and sandbox :8788 (`bun run dev`, `ANU_ENV=dev`, `dev`
 * code sender), the web dev server on :3000 (`cd clients/web && bun run dev`).
 * Run from `anu/`: `bun run mobile:e2e`. Phones 555-0160 to 555-0163 only.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { connect } from "../src/db/client.js";

const require = createRequire(join(import.meta.dir, "../../clients/web/package.json"));
// Playwright lives in clients/web; its types do not resolve from anu/, so the
// few calls used here are loosely typed.
const { chromium } = require("playwright") as { chromium: any };

const API = (process.env.ANU_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const WEB = (process.env.ANU_WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set (run from anu/ so .env loads)");
// Owner connection, used only to read attempts and to expire a code.
const sql = connect(DATABASE_URL, { max: 1 });

const DEVICES = [
  {
    name: "iOS (iPhone UA)",
    platform: "ios",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    phoneA: "+12025550160",
  },
  {
    name: "Android (Pixel UA)",
    platform: "android",
    ua: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36; wv",
    phoneA: "+12025550162",
  },
] as const;
const PHONE_B = "+12025550161";
const TEST_PHONES = ["+12025550160", "+12025550161", "+12025550162"];

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

async function api(path: string, init: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function loginDirect(phone: string): Promise<string> {
  const req = await api("/v1/auth/code/request", { method: "POST", body: JSON.stringify({ phone }) });
  const code = req.body?.devCode;
  if (!code) throw new Error(`no devCode for ${phone}; is ANU_ENV=dev with the dev sender?`);
  const ver = await api("/v1/auth/code/verify", { method: "POST", body: JSON.stringify({ phone, code }) });
  return ver.body.token;
}

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Stub of the Capacitor native bridge, installed before any page script. */
function capacitorStub(platform: "ios" | "android"): void {
  const w = window as any;
  if (platform === "android") w.androidBridge = { postMessage() {} };
  else w.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
  // The secure store outlives page loads, like the Keychain/Keystore does
  // across launches; the stub keeps it under a test-only key.
  const VAULT_KEY = "__stub_native_vault";
  const vault = new Map<string, string>(JSON.parse(sessionStorage.getItem(VAULT_KEY) ?? "[]"));
  const persist = () => sessionStorage.setItem(VAULT_KEY, JSON.stringify([...vault]));
  const calls: string[] = [];
  w.__anuNative = { vault, calls };
  const promise = (m: string) => ({ name: m, rtype: "promise" });
  w.Capacitor = {
    PluginHeaders: [
      {
        name: "NativeBiometric",
        methods: ["storeToken", "retrieveToken", "deleteToken", "isAvailable"].map(promise),
      },
    ],
    async nativePromise(plugin: string, method: string, options: any) {
      calls.push(`${plugin}.${method}`);
      if (plugin === "NativeBiometric") {
        if (method === "storeToken") return void (vault.set(options.server, options.token), persist());
        if (method === "retrieveToken") {
          if (!vault.has(options.server)) throw new Error("no token");
          return { token: vault.get(options.server) };
        }
        if (method === "deleteToken") return void (vault.delete(options.server), persist());
        return { isAvailable: true };
      }
      throw new Error(`${plugin}.${method} is not implemented in the stub`);
    },
    nativeCallback(plugin: string, method: string) {
      calls.push(`${plugin}.${method}`);
      return "stub";
    },
  };
}

async function runDevice(device: (typeof DEVICES)[number], tokenB: string, taskB: string): Promise<void> {
  console.log(`\n== ${device.name} ==`);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  }).catch(() => chromium.launch({ executablePath: "/usr/bin/chromium" }));
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: device.ua,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(capacitorStub, device.platform);
  const page = await context.newPage();

  const requests: { url: string; type: string; method: string }[] = [];
  page.on("request", (r: any) => requests.push({ url: r.url(), type: r.resourceType(), method: r.method() }));
  const codes: string[] = [];
  page.on("response", async (r: any) => {
    if (r.url().endsWith("/v1/auth/code/request") && r.request().method() === "POST") {
      try { codes.push((await r.json()).devCode); } catch {}
    }
  });
  const platform = await (async () => {
    await page.goto(`${WEB}/anu`);
    return page.evaluate(() => (window as any).Capacitor.getPlatform?.());
  })();
  check("Capacitor reports the native platform", platform === device.platform, String(platform));
  await page.waitForURL(/\/anu\/login/);
  check("signed-out launch lands on /anu/login (no platform login)", page.url().startsWith(`${WEB}/anu/login`), page.url());

  // Request a code, then a wrong code.
  await page.getByLabel("Phone number").fill(device.phoneA);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await waitFor(async () => codes.length >= 1);
  const firstCode = codes[0]!;
  const wrong = firstCode === "000000" ? "111111" : "000000";
  await page.getByLabel("6-digit code").fill(wrong);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText(/That code is not right\. 4 attempts left/).waitFor({ timeout: 10_000 }).then(
    () => check("wrong code rejected, shows 4 attempts left", true),
    () => check("wrong code rejected, shows 4 attempts left", false),
  );
  const [row] = await sql`select attempts from login_codes where phone = ${device.phoneA} and consumed_at is null order by created_at desc limit 1`;
  check("wrong code counted in the database", row?.attempts === 1, `attempts=${row?.attempts}`);

  // Expire the code server side, then try the right code.
  await sql`update login_codes set expires_at = now() - interval '1 second' where phone = ${device.phoneA} and consumed_at is null`;
  await page.getByLabel("6-digit code").fill(firstCode);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText(/This code has expired/).first().waitFor({ timeout: 10_000 }).then(
    () => check("expired code rejected", true),
    () => check("expired code rejected", false),
  );
  check("still on the login screen", page.url().includes("/anu/login"));

  // New code, right code.
  await page.getByRole("button", { name: "Send a new code" }).click();
  await waitFor(async () => codes.length >= 2);
  await page.getByLabel("6-digit code").fill(codes[1]!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u: URL) => !u.pathname.startsWith("/anu/login"), { timeout: 10_000 });
  check("correct code logs in", new URL(page.url()).pathname.startsWith("/anu"), page.url());

  const stored = await page.evaluate(() => {
    const vault: Map<string, string> = (window as any).__anuNative.vault;
    return { entries: [...vault.entries()], browser: sessionStorage.getItem("anu:session"), local: JSON.stringify(localStorage).includes("token") };
  });
  check("token stored in the native secure store", stored.entries.length === 1 && stored.entries[0]![0] === `anu-session:${API}`, stored.entries[0]?.[0]);
  check("token not in sessionStorage/localStorage on native", stored.browser === null && !stored.local);
  const tokenA = JSON.parse(stored.entries[0]![1]).token as string;

  // Isolation, called from inside the page with the stored token.
  const iso = await page.evaluate(async ({ api, token, taskB }: { api: string; token: string; taskB: string }) => {
    const h = { authorization: `Bearer ${token}` };
    const list = await (await fetch(`${api}/v1/tasks`, { headers: h })).json();
    const other = await fetch(`${api}/v1/tasks/${taskB}`, { headers: h });
    const steps = await fetch(`${api}/v1/tasks/${taskB}/steps`, { headers: h });
    const stop = await fetch(`${api}/v1/tasks/${taskB}/stop`, { method: "POST", headers: h });
    return { ids: (list.tasks ?? list).map((t: any) => t.id), other: other.status, steps: steps.status, stop: stop.status };
  }, { api: API, token: tokenA, taskB });
  check("A's list does not contain B's task", !iso.ids.includes(taskB), `${iso.ids.length} tasks`);
  check("A's token on B's task id -> 404", iso.other === 404, String(iso.other));
  check("A's token on B's steps / stop -> 404", iso.steps === 404 && iso.stop === 404, `${iso.steps}/${iso.stop}`);
  const bList = await api("/v1/tasks", { token: tokenB });
  check("B still sees B's task", (bList.body.tasks ?? bList.body).some((t: any) => t.id === taskB));

  // Approve round trip through the UI.
  const goalBox = page.getByRole("textbox", { name: "New goal" });
  const openComposer = () => page.goto(`${WEB}/anu/new`);
  await openComposer();
  await goalBox.fill(`Mobile e2e approval ${device.platform} #approval`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Approve" }).waitFor({ timeout: 30_000 });
  check("approval request reached the phone via the sandbox", true);
  await page.getByRole("button", { name: "Approve" }).click();
  const approvedId = await waitFor(async () => {
    const list = await api("/v1/tasks", { token: tokenA });
    const t = (list.body.tasks ?? list.body).find((x: any) => x.goal.includes(`approval ${device.platform}`));
    return t?.status === "succeeded" ? t.id : undefined;
  }, 30_000).catch(() => undefined);
  check("approved task succeeded", Boolean(approvedId));
  if (approvedId) {
    const steps = await api(`/v1/tasks/${approvedId}/steps`, { token: tokenA });
    const list = steps.body.steps ?? steps.body;
    check("steps written by the sandbox", list.length >= 3, `${list.length} steps`);
  }

  // Stop round trip.
  await openComposer();
  await goalBox.fill(`Mobile e2e stop ${device.platform} #slow`);
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Stop" }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Stop" }).click();
  const stopped = await waitFor(async () => {
    const list = await api("/v1/tasks", { token: tokenA });
    const t = (list.body.tasks ?? list.body).find((x: any) => x.goal.includes(`stop ${device.platform}`));
    return t?.status === "stopped" ? t : undefined;
  }, 30_000).catch(() => undefined);
  check("stop from the phone stopped the task", Boolean(stopped));

  // Logout.
  await page.goto(`${WEB}/anu/settings`);
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL(/\/anu\/login/, { timeout: 10_000 });
  const after = await page.evaluate(() => (window as any).__anuNative.vault.size);
  check("logout clears the stored token", after === 0);
  const me = await api("/v1/me", { token: tokenA });
  check("logged-out token is revoked by the API", me.status === 401, String(me.status));

  // Network audit.
  const apiOrigin = new URL(API).origin;
  const webOrigin = new URL(WEB).origin;
  const data = requests.filter((r) => ["fetch", "xhr", "eventsource", "websocket"].includes(r.type));
  const badData = data.filter((r) => new URL(r.url).origin !== apiOrigin);
  const foreign = requests.filter((r) => ![apiOrigin, webOrigin].includes(new URL(r.url).origin) && !r.url.startsWith("data:"));
  const origins = [...new Set(requests.map((r) => new URL(r.url).origin))];
  console.log(`  requests: ${requests.length} total, ${data.length} data; origins: ${origins.join(", ")}`);
  check("all data requests go to the ANU API origin only", badData.length === 0, badData.map((r) => r.url).slice(0, 5).join(" "));
  check("no request leaves the app host and ANU API", foreign.length === 0, foreign.map((r) => r.url).slice(0, 5).join(" "));
  check("no vellum.ai / model provider / sandbox(:8788) requests", !requests.some((r) => /vellum\.ai|openai|anthropic|kilo\.ai|:8788/.test(r.url)));
  const calls = await page.evaluate(() => (window as any).__anuNative.calls as string[]);
  console.log(`  native plugin calls: ${[...new Set(calls)].join(", ") || "none"}`);
  await browser.close();
}

try {
  await sql`delete from login_codes where phone = any(${TEST_PHONES})`;
  const tokenB = await loginDirect(PHONE_B);
  const created = await api("/v1/tasks", { method: "POST", token: tokenB, body: JSON.stringify({ goal: "Mobile e2e: B's private task" }) });
  const taskB = created.body.id ?? created.body.task?.id;
  if (!taskB) throw new Error(`could not create B's task: ${JSON.stringify(created.body)}`);
  for (const device of DEVICES) {
    await sql`delete from login_codes where phone = ${device.phoneA}`;
    await runDevice(device, tokenB, taskB);
  }
} finally {
  await sql.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
