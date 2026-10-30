/**
 * Where the ANU session token lives between launches.
 *
 * The ANU API asks clients to keep the token in the platform's secure store,
 * never in `localStorage` (anu/docs/api.md, "Sign in"). In the Capacitor
 * shells that is the Keychain (iOS) or the Keystore (Android), reached
 * through the app-local `NativeBiometric` plugin that already guards the
 * platform session, keyed by the ANU API origin so the two tokens never
 * share an entry. A browser has no secure store, so there the token lives in
 * `sessionStorage`: it survives a reload and dies with the tab.
 */

import { z } from "zod";

import { isNativePlatform } from "@/runtime/native-auth";
import { NativeBiometric as SecureToken } from "@/runtime/native-biometric";

import { anuApiBaseUrl } from "./anu-api";

const BROWSER_KEY = "anu:session";

const storedSessionSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string(),
});

export type StoredAnuSession = z.infer<typeof storedSessionSchema>;

function secureServer(): string {
  return `anu-session:${anuApiBaseUrl()}`;
}

function parseStored(raw: string | null): StoredAnuSession | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = storedSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Whether a stored session has passed its expiry. */
export function isStoredSessionExpired(
  session: StoredAnuSession,
  now: number = Date.now(),
): boolean {
  const expires = Date.parse(session.expiresAt);
  return Number.isNaN(expires) || expires <= now;
}

export async function saveAnuSession(session: StoredAnuSession): Promise<void> {
  const raw = JSON.stringify(session);
  if (isNativePlatform()) {
    try {
      await SecureToken.storeToken({ token: raw, server: secureServer() });
    } catch (error) {
      console.warn("[anu] could not store the session token", error);
    }
    return;
  }
  try {
    sessionStorage.setItem(BROWSER_KEY, raw);
  } catch {
    // Private windows can refuse storage; the session then lasts the page.
  }
}

/**
 * The stored session, or `null` when there is none, it has expired, or the
 * user cancelled the unlock prompt. `reason` is the text of that prompt.
 */
export async function loadAnuSession(
  reason: string,
): Promise<StoredAnuSession | null> {
  let stored: StoredAnuSession | null = null;
  if (isNativePlatform()) {
    try {
      const { token } = await SecureToken.retrieveToken({
        server: secureServer(),
        reason,
      });
      stored = parseStored(token);
    } catch {
      stored = null;
    }
  } else {
    try {
      stored = parseStored(sessionStorage.getItem(BROWSER_KEY));
    } catch {
      stored = null;
    }
  }
  if (stored && isStoredSessionExpired(stored)) {
    await clearAnuSession();
    return null;
  }
  return stored;
}

export async function clearAnuSession(): Promise<void> {
  if (isNativePlatform()) {
    try {
      await SecureToken.deleteToken({ server: secureServer() });
    } catch {
      // Nothing stored is the state this call wants.
    }
    return;
  }
  try {
    sessionStorage.removeItem(BROWSER_KEY);
  } catch {
    // Storage that cannot be read holds nothing to clear.
  }
}
