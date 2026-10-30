import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

import type { AnuConfig } from "../config.js";

/** Delivers a one-time code to a phone number (ADR 0003). */
export interface OtpSender {
  readonly name: string;
  /**
   * Sends the code. A sender may return `devCode` only if it is the dev
   * sender; the API includes it in the response so tests can sign in.
   */
  send(phone: string, code: string): Promise<{ devCode?: string }>;
}

/** Sends nothing and hands the code back. Refused outside dev and test. */
export class DevOtpSender implements OtpSender {
  readonly name = "dev";

  constructor(env: AnuConfig["ANU_ENV"]) {
    if (env !== "dev" && env !== "test") {
      throw new Error("The dev OTP sender is allowed only when ANU_ENV is dev or test");
    }
  }

  async send(_phone: string, code: string): Promise<{ devCode?: string }> {
    return { devCode: code };
  }
}

/** Fails closed: an environment that does not allow the configured sender cannot start. */
export function createOtpSender(config: Pick<AnuConfig, "ANU_ENV" | "OTP_SENDER">): OtpSender {
  switch (config.OTP_SENDER) {
    case "dev":
      return new DevOtpSender(config.ANU_ENV);
  }
}

/** Six digits from a CSPRNG, uniformly distributed, zero padded. */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** Keyed hash of a code, bound to the phone number it was issued for. */
export function hashCode(secret: string, phone: string, code: string): string {
  return createHmac("sha256", secret).update(`otp:${phone}:${code}`).digest("hex");
}

/** Keyed hash of a client address, so raw addresses are never stored. */
export function hashClient(secret: string, address: string): string {
  return createHmac("sha256", secret).update(`client:${address}`).digest("hex");
}

export const SESSION_PREFIX = "anu_s_";

export function newSessionToken(): string {
  return SESSION_PREFIX + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
