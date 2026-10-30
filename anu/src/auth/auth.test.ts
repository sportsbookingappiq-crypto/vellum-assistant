import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { loadApiConfig } from "../config.js";
import type { Sql } from "../db/client.js";
import { adminSql, makeTestApi, resetPhones, secret, testDatabaseUrl, type TestApi } from "../test/helpers.js";
import { createOtpSender, DevOtpSender, generateCode } from "./otp.js";

// Example numbers only (ADR 0003): 555-0100 to 555-0199.
const P = {
  basic: "+13035550100",
  wrong: "+13035550101",
  lock: "+13035550102",
  expiry: "+13035550103",
  ratePhone: "+13035550104",
  rateClientA: "+13035550105",
  rateClientB: "+13035550106",
  rateClientC: "+13035550107",
  rateClientD: "+13035550108",
  session: "+13035550109",
  supersede: "+13035550110",
};

let sql: Sql;
let t: TestApi;

beforeAll(async () => {
  sql = await adminSql();
  await resetPhones(sql, Object.values(P));
  t = makeTestApi({ ANU_RATE_PHONE_MAX: "3", ANU_RATE_CLIENT_MAX: "3", ANU_SESSION_TTL_SECONDS: "3600" });
});

afterAll(async () => {
  await t.close();
  await sql.end();
});

async function requestCode(phone: string, client?: string) {
  const res = await t.call("POST", "/v1/auth/code/request", { body: { phone }, client });
  return { res, body: (await res.json()) as { devCode?: string; expiresAt?: string; error?: { code: string } } };
}

async function verify(phone: string, code: string) {
  const res = await t.call("POST", "/v1/auth/code/verify", { body: { phone, code } });
  return { res, body: (await res.json()) as { token?: string; error?: { code: string; attemptsRemaining?: number } } };
}

const wrongCodeFor = (code: string) => (code === "000000" ? "000001" : "000000");

describe("OTP request and verify", () => {
  test("issues a six-digit code, returns it only through the dev sender, and signs in", async () => {
    const { res, body } = await requestCode("+1 (303) 555-0100");
    expect(res.status).toBe(202);
    expect(body.devCode).toMatch(/^\d{6}$/);
    expect(new Date(body.expiresAt!).getTime() - t.clock.now.getTime()).toBe(5 * 60 * 1000);

    const verified = await verify(P.basic, body.devCode!);
    expect(verified.res.status).toBe(200);
    expect(verified.body.token).toStartWith("anu_s_");

    const me = await t.call("GET", "/v1/me", { token: verified.body.token });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { phone: string }).phone).toBe(P.basic);
  });

  test("stores only a keyed hash of the code and of the client address", async () => {
    const { body } = await requestCode(P.basic, "192.0.2.10");
    const rows = await sql`select code_hash, client_hash from login_codes where phone = ${P.basic} order by created_at desc limit 1`;
    expect(rows[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.code_hash).not.toContain(body.devCode!);
    expect(rows[0]!.client_hash).not.toContain("192.0.2.10");
  });

  test("rejects malformed phone numbers and codes", async () => {
    expect((await requestCode("5550100")).res.status).toBe(400);
    expect((await requestCode("not a phone")).res.status).toBe(400);
    expect((await verify(P.basic, "12ab56")).res.status).toBe(400);
  });

  test("a wrong code counts an attempt and reports how many remain", async () => {
    const { body } = await requestCode(P.wrong);
    const first = await verify(P.wrong, wrongCodeFor(body.devCode!));
    expect(first.res.status).toBe(400);
    expect(first.body.error).toMatchObject({ code: "invalid_code", attemptsRemaining: 4 });
    const second = await verify(P.wrong, wrongCodeFor(body.devCode!));
    expect(second.body.error?.attemptsRemaining).toBe(3);
    const [row] = await sql`select attempts from login_codes where phone = ${P.wrong} and locked_at is null`;
    expect(row!.attempts).toBe(2);
    expect((await verify(P.wrong, body.devCode!)).res.status).toBe(200);
  });

  test("five wrong attempts lock the code, so even the right code then fails", async () => {
    const { body } = await requestCode(P.lock);
    for (let i = 0; i < 5; i++) {
      expect((await verify(P.lock, wrongCodeFor(body.devCode!))).res.status).toBe(400);
    }
    const [row] = await sql`select attempts, locked_at from login_codes where phone = ${P.lock}`;
    expect(row!.attempts).toBe(5);
    expect(row!.locked_at).not.toBeNull();
    const after = await verify(P.lock, body.devCode!);
    expect(after.res.status).toBe(400);
    expect(after.body.token).toBeUndefined();
  });

  test("an expired code is rejected (injected clock)", async () => {
    const start = t.clock.now;
    try {
      const { body } = await requestCode(P.expiry);
      t.clock.now = new Date(start.getTime() + 5 * 60 * 1000 + 1);
      const result = await verify(P.expiry, body.devCode!);
      expect(result.res.status).toBe(400);
      expect(result.body.error?.code).toBe("code_expired");
    } finally {
      t.clock.now = start;
    }
  });

  test("a new code replaces the previous unused one", async () => {
    const first = await requestCode(P.supersede);
    const second = await requestCode(P.supersede);
    if (first.body.devCode !== second.body.devCode) {
      expect((await verify(P.supersede, first.body.devCode!)).res.status).toBe(400);
    }
    expect((await verify(P.supersede, second.body.devCode!)).res.status).toBe(200);
  });
});

describe("rate limits", () => {
  test("limits code requests per phone number", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await requestCode(P.ratePhone, `198.51.100.${i}`)).res.status).toBe(202);
    }
    const limited = await requestCode(P.ratePhone, "198.51.100.99");
    expect(limited.res.status).toBe(429);
    expect(limited.res.headers.get("retry-after")).toBeTruthy();
  });

  test("limits code requests per client address across phone numbers", async () => {
    const client = "203.0.113.7";
    expect((await requestCode(P.rateClientA, client)).res.status).toBe(202);
    expect((await requestCode(P.rateClientB, client)).res.status).toBe(202);
    expect((await requestCode(P.rateClientC, client)).res.status).toBe(202);
    expect((await requestCode(P.rateClientD, client)).res.status).toBe(429);
    expect((await requestCode(P.rateClientD, "203.0.113.8")).res.status).toBe(202);
  });

  test("the window slides: requests are allowed again after it passes", async () => {
    const start = t.clock.now;
    try {
      t.clock.now = new Date(start.getTime() + 16 * 60 * 1000);
      expect((await requestCode(P.ratePhone, "198.51.100.200")).res.status).toBe(202);
    } finally {
      t.clock.now = start;
    }
  });
});

describe("sessions", () => {
  test("missing, malformed, and unknown tokens are rejected", async () => {
    expect((await t.call("GET", "/v1/me")).status).toBe(401);
    expect((await t.call("GET", "/v1/me", { token: "garbage" })).status).toBe(401);
    expect((await t.call("GET", "/v1/me", { token: "anu_s_" + "x".repeat(43) })).status).toBe(401);
  });

  test("sessions are stored hashed, expire, and can be revoked", async () => {
    const token = await t.login(P.session);
    const rows = await sql`select token_hash from sessions s join users u on u.id = s.user_id where u.phone = ${P.session}`;
    expect(rows.length).toBe(1);
    expect(rows[0]!.token_hash).not.toContain(token.slice(6));

    const start = t.clock.now;
    t.clock.now = new Date(start.getTime() + 3601 * 1000);
    expect((await t.call("GET", "/v1/me", { token })).status).toBe(401);
    t.clock.now = start;
    expect((await t.call("GET", "/v1/me", { token })).status).toBe(200);

    expect((await t.call("POST", "/v1/auth/logout", { token })).status).toBe(204);
    expect((await t.call("GET", "/v1/me", { token })).status).toBe(401);
  });
});

describe("dev sender guard and log hygiene", () => {
  test("the dev sender is refused outside dev and test", () => {
    for (const env of ["staging", "production"] as const) {
      expect(() => new DevOtpSender(env)).toThrow("dev or test");
      expect(() => createOtpSender({ ANU_ENV: env, OTP_SENDER: "dev" })).toThrow();
      expect(() =>
        loadApiConfig({
          ANU_ENV: env,
          OTP_SENDER: "dev",
          DATABASE_URL: testDatabaseUrl(),
          ANU_OTP_SECRET: secret(),
          ANU_INTERNAL_TOKEN: secret(),
        }),
      ).toThrow("OTP_SENDER=dev is allowed only when ANU_ENV is dev or test");
    }
    expect(createOtpSender({ ANU_ENV: "dev", OTP_SENDER: "dev" }).name).toBe("dev");
  });

  test("logs never contain a full phone number", () => {
    expect(t.logs.length).toBeGreaterThan(10);
    const all = t.logs.join("\n");
    for (const phone of Object.values(P)) {
      expect(all).not.toContain(phone);
      expect(all).not.toContain(phone.slice(2)); // without the country code
    }
  });

  test("codes are uniformly six digits", () => {
    const codes = Array.from({ length: 200 }, generateCode);
    expect(codes.every((code) => /^\d{6}$/.test(code))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(190);
  });
});
