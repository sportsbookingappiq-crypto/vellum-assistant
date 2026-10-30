/**
 * Client-only state for the chat-first ANU screens: which overlay is open
 * (drawer, bot switcher, create or edit sheet) and the one pending undo.
 * Server data stays in the ANU query cache; nothing here mirrors it.
 */

import { create } from "zustand";

import { createSelectors } from "@/utils/create-selectors";

export type AnuSheet =
  | { kind: "switcher" }
  | { kind: "create"; prefill?: string }
  | { kind: "edit"; botId: string };

/**
 * A delete the person can still take back. The server call runs only when
 * the undo window closes (`commit`), so Undo needs nothing from the server.
 */
export interface AnuPendingUndo {
  id: string;
  label: string;
  commit: () => void;
}

interface AnuUiState {
  drawerOpen: boolean;
  sheet: AnuSheet | null;
  undo: AnuPendingUndo | null;
  /** Ids hidden from lists while their delete waits out the undo window. */
  hidden: readonly string[];
  /** The bot of the chat on screen, for the switcher's check mark. */
  currentBotId: string | null;
}

interface AnuUiActions {
  setDrawerOpen: (open: boolean) => void;
  setCurrentBotId: (botId: string | null) => void;
  openSheet: (sheet: AnuSheet) => void;
  closeSheet: () => void;
  /** Hides `id` now and deletes it after the undo window unless undone. */
  scheduleDelete: (undo: AnuPendingUndo) => void;
  undoDelete: () => void;
  /** Runs the pending delete now (the toast timed out or was dismissed). */
  flushDelete: () => void;
  /** Shows an id again, when its delete failed on the server. */
  unhide: (id: string) => void;
}

export const ANU_UNDO_MS = 5_000;

export const useAnuUiStore = createSelectors(
  create<AnuUiState & AnuUiActions>()((set, get) => ({
    drawerOpen: false,
    sheet: null,
    undo: null,
    hidden: [],
    currentBotId: null,
    setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
    setCurrentBotId: (currentBotId) => set({ currentBotId }),
    openSheet: (sheet) => set({ sheet, drawerOpen: false }),
    closeSheet: () => set({ sheet: null }),
    scheduleDelete: (undo) => {
      get().flushDelete();
      set((state) => ({ undo, hidden: [...state.hidden, undo.id] }));
    },
    undoDelete: () => {
      const { undo } = get();
      if (!undo) {
        return;
      }
      set((state) => ({ undo: null, hidden: state.hidden.filter((id) => id !== undo.id) }));
    },
    flushDelete: () => {
      const { undo } = get();
      if (!undo) {
        return;
      }
      set({ undo: null });
      undo.commit();
    },
    unhide: (id) => set((state) => ({ hidden: state.hidden.filter((entry) => entry !== id) })),
  })),
);
