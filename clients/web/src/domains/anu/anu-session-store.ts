/**
 * Client state for the ANU screens: the session token, and the phone number
 * a sign-in is in progress for. Server data (tasks, steps, the user) is never
 * kept here; it lives in the ANU query cache (`anu-query-client.ts`).
 */

import { create } from "zustand";

import { createSelectors } from "@/utils/create-selectors";

import {
  clearAnuSession,
  loadAnuSession,
  saveAnuSession,
  type StoredAnuSession,
} from "./anu-token-storage";

export type AnuSessionStatus = "restoring" | "signed-out" | "signed-in";

export interface AnuSessionState {
  status: AnuSessionStatus;
  token: string | null;
  expiresAt: string | null;
  /** E.164 number a code was last sent to; drives the code step of sign-in. */
  pendingPhone: string | null;
}

export interface AnuSessionActions {
  /** Reads the stored token once per launch. `reason` labels a native unlock prompt. */
  restore: (reason: string) => Promise<void>;
  signIn: (session: StoredAnuSession) => Promise<void>;
  /** Forgets the token locally. The caller revokes it on the server first. */
  signOut: () => Promise<void>;
  setPendingPhone: (phone: string | null) => void;
}

export type AnuSessionStore = AnuSessionState & AnuSessionActions;

let restoring: Promise<void> | null = null;

const useAnuSessionStoreBase = create<AnuSessionStore>()((set, get) => ({
  status: "restoring",
  token: null,
  expiresAt: null,
  pendingPhone: null,
  restore: (reason) => {
    if (get().status !== "restoring") {
      return Promise.resolve();
    }
    restoring ??= loadAnuSession(reason)
      .then((stored) => {
        if (get().status !== "restoring") {
          return;
        }
        set(
          stored
            ? {
                status: "signed-in",
                token: stored.token,
                expiresAt: stored.expiresAt,
              }
            : { status: "signed-out", token: null, expiresAt: null },
        );
      })
      .finally(() => {
        restoring = null;
      });
    return restoring;
  },
  signIn: async (session) => {
    set({
      status: "signed-in",
      token: session.token,
      expiresAt: session.expiresAt,
      pendingPhone: null,
    });
    await saveAnuSession(session);
  },
  signOut: async () => {
    set({ status: "signed-out", token: null, expiresAt: null });
    await clearAnuSession();
  },
  setPendingPhone: (pendingPhone) => set({ pendingPhone }),
}));

export const useAnuSessionStore = createSelectors(useAnuSessionStoreBase);
