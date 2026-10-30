/**
 * Maps a failed sign-in call to the sentence the login screen shows. Kept
 * apart from the screen so every server code has a tested destination.
 */

import { AnuApiError } from "./anu-api";

export type AnuLoginError =
  | { key: "anuLoginPage.errorInvalidPhone" }
  | { key: "anuLoginPage.errorInvalidCode"; count: number }
  | { key: "anuLoginPage.errorCodeFormat" }
  | { key: "anuLoginPage.errorCodeLocked" }
  | { key: "anuLoginPage.errorCodeExpired" }
  | { key: "anuLoginPage.errorRateLimited"; seconds: number }
  | { key: "anuLoginPage.errorNetwork" }
  | { key: "anuLoginPage.errorGeneric" };

export function anuLoginError(error: unknown): AnuLoginError {
  if (!(error instanceof AnuApiError)) {
    return { key: "anuLoginPage.errorGeneric" };
  }
  if (error.status === 429) {
    return {
      key: "anuLoginPage.errorRateLimited",
      seconds: error.retryAfterSeconds ?? 60,
    };
  }
  switch (error.code) {
    case "network":
      return { key: "anuLoginPage.errorNetwork" };
    case "invalid_phone":
      return { key: "anuLoginPage.errorInvalidPhone" };
    case "code_expired":
      return { key: "anuLoginPage.errorCodeExpired" };
    case "invalid_code_format":
      return { key: "anuLoginPage.errorCodeFormat" };
    case "invalid_code":
      // No attempts left, or no live code to check against: either way the
      // only way forward is a new code.
      if (!error.attemptsRemaining) {
        return { key: "anuLoginPage.errorCodeLocked" };
      }
      return {
        key: "anuLoginPage.errorInvalidCode",
        count: error.attemptsRemaining,
      };
    default:
      return { key: "anuLoginPage.errorGeneric" };
  }
}
