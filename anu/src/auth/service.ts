import { timingSafeEqual } from "node:crypto";

import type { Db } from "../db/client.js";
import { HttpError } from "../lib/http.js";
import type { Logger } from "../lib/log.js";
import { maskPhone, normalizePhone } from "../lib/phone.js";
import {
  generateCode,
  hashClient,
  hashCode,
  hashToken,
  newSessionToken,
  type OtpSender,
} from "./otp.js";

export const CODE_TTL_MS = 5 * 60 * 1000;
export const MAX_ATTEMPTS = 5;

export interface AuthSettings {
  otpSecret: string;
  sessionTtlSeconds: number;
  rateWindowSeconds: number;
  ratePhoneMax: number;
  rateClientMax: number;
}

export interface SessionUser {
  userId: string;
  sessionId: string;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly sender: OtpSender,
    private readonly settings: AuthSettings,
    private readonly now: () => Date,
    private readonly log: Logger,
  ) {}

  async requestCode(rawPhone: unknown, clientAddress: string) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new HttpError(400, "invalid_phone", "Phone must be in E.164 format, for example +12025550142");
    const now = this.now();
    const clientHash = hashClient(this.settings.otpSecret, clientAddress);
    const windowStart = new Date(now.getTime() - this.settings.rateWindowSeconds * 1000);
    const code = generateCode();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);

    await this.db.asSystem(async (tx) => {
      // Serialize requests for the same phone so concurrent calls cannot slip past the limit.
      await tx`select pg_advisory_xact_lock(hashtext(${"otp:" + phone}))`;
      const [{ byPhone }] = await tx<{ byPhone: number }[]>`
        select count(*)::int as "byPhone" from login_codes
        where phone = ${phone} and created_at > ${windowStart}`;
      const [{ byClient }] = await tx<{ byClient: number }[]>`
        select count(*)::int as "byClient" from login_codes
        where client_hash = ${clientHash} and created_at > ${windowStart}`;
      if (byPhone >= this.settings.ratePhoneMax || byClient >= this.settings.rateClientMax) {
        this.log.warn("auth.code_rate_limited", {
          phone: maskPhone(phone),
          scope: byPhone >= this.settings.ratePhoneMax ? "phone" : "client",
        });
        throw new HttpError(
          429,
          "rate_limited",
          "Too many code requests. Try again later.",
          { "retry-after": String(this.settings.rateWindowSeconds) },
        );
      }
      // A new code replaces any earlier unused one.
      await tx`update login_codes set locked_at = ${now}
        where phone = ${phone} and consumed_at is null and locked_at is null`;
      await tx`insert into login_codes (phone, code_hash, client_hash, created_at, expires_at)
        values (${phone}, ${hashCode(this.settings.otpSecret, phone, code)}, ${clientHash}, ${now}, ${expiresAt})`;
    });

    const { devCode } = await this.sender.send(phone, code);
    this.log.info("auth.code_sent", { phone: maskPhone(phone), sender: this.sender.name });
    return { expiresAt, ...(devCode ? { devCode } : {}) };
  }

  async verifyCode(rawPhone: unknown, rawCode: unknown) {
    const phone = normalizePhone(rawPhone);
    if (!phone) throw new HttpError(400, "invalid_phone", "Phone must be in E.164 format");
    if (typeof rawCode !== "string" || !/^[0-9]{6}$/.test(rawCode)) {
      throw new HttpError(400, "invalid_code_format", "Code must be six digits");
    }
    const now = this.now();
    const expected = Buffer.from(hashCode(this.settings.otpSecret, phone, rawCode));

    const outcome = await this.db.asSystem(async (tx) => {
      const [row] = await tx<
        { id: string; code_hash: string; expires_at: Date; attempts: number }[]
      >`select id, code_hash, expires_at, attempts from login_codes
        where phone = ${phone} and consumed_at is null and locked_at is null
        order by created_at desc limit 1 for update`;
      if (!row) return { kind: "invalid" as const, remaining: 0 };
      if (row.expires_at.getTime() <= now.getTime()) return { kind: "expired" as const };
      const stored = Buffer.from(row.code_hash);
      const matches = stored.length === expected.length && timingSafeEqual(stored, expected);
      if (!matches) {
        const attempts = row.attempts + 1;
        const locked = attempts >= MAX_ATTEMPTS;
        await tx`update login_codes set attempts = ${attempts}, locked_at = ${locked ? now : null}
          where id = ${row.id}`;
        return { kind: "invalid" as const, remaining: MAX_ATTEMPTS - attempts };
      }
      await tx`update login_codes set consumed_at = ${now} where id = ${row.id}`;
      const [user] = await tx<{ id: string; created_at: Date }[]>`
        insert into users (phone, created_at) values (${phone}, ${now})
        on conflict (phone) do update set phone = excluded.phone
        returning id, created_at`;
      const token = newSessionToken();
      const expiresAt = new Date(now.getTime() + this.settings.sessionTtlSeconds * 1000);
      await tx`insert into sessions (user_id, token_hash, created_at, expires_at)
        values (${user!.id}, ${hashToken(token)}, ${now}, ${expiresAt})`;
      await tx`insert into audit_log (user_id, action, created_at) values (${user!.id}, 'auth.login', ${now})`;
      return { kind: "ok" as const, token, expiresAt, userId: user!.id };
    });

    if (outcome.kind === "expired") {
      throw new HttpError(400, "code_expired", "The code has expired. Request a new one.");
    }
    if (outcome.kind === "invalid") {
      this.log.info("auth.code_rejected", { phone: maskPhone(phone), remaining: outcome.remaining });
      throw new HttpError(400, "invalid_code", "The code is not valid. Request a new one if needed.", {}, {
        attemptsRemaining: outcome.remaining,
      });
    }
    this.log.info("auth.login", { phone: maskPhone(phone), userId: outcome.userId });
    return { token: outcome.token, expiresAt: outcome.expiresAt, userId: outcome.userId };
  }

  async authenticate(token: string | null): Promise<SessionUser | null> {
    if (!token || !token.startsWith("anu_s_") || token.length > 200) return null;
    const now = this.now();
    const rows = await this.db.asSystem(
      (tx) => tx<{ id: string; user_id: string }[]>`
        select id, user_id from sessions
        where token_hash = ${hashToken(token)} and revoked_at is null and expires_at > ${now}`,
    );
    const row = rows[0];
    return row ? { userId: row.user_id, sessionId: row.id } : null;
  }

  async logout(session: SessionUser): Promise<void> {
    const now = this.now();
    await this.db.asUser(session.userId, (tx) =>
      tx`update sessions set revoked_at = ${now} where id = ${session.sessionId} and user_id = ${session.userId}`,
    );
  }
}
