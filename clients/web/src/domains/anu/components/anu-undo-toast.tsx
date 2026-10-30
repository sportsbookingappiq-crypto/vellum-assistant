/**
 * The one undo the app offers (spec A.4, "Delete with undo"): after a chat
 * or a bot is deleted it disappears at once and this bar holds the delete
 * for five seconds. Undo brings it back; otherwise the delete goes through.
 */

import { useEffect } from "react";

import { useTranslation } from "@/i18n";

import { ANU_UNDO_MS, useAnuUiStore } from "../anu-ui-store";
import { SAFE_BOTTOM } from "./anu-ui";

export function AnuUndoToast() {
  const { t } = useTranslation("anu");
  const undo = useAnuUiStore.use.undo();
  const undoDelete = useAnuUiStore.use.undoDelete();
  const flushDelete = useAnuUiStore.use.flushDelete();

  useEffect(() => {
    if (!undo) {
      return;
    }
    const timer = setTimeout(flushDelete, ANU_UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo, flushDelete]);

  // Leaving the page must not lose a delete the person meant.
  useEffect(() => {
    const flush = () => useAnuUiStore.getState().flushDelete();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  if (!undo) {
    return null;
  }
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ bottom: `calc(96px + ${SAFE_BOTTOM})` }}
    >
      <div
        role="status"
        data-anu-sheet
        className="pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-[20px] bg-[var(--anu-primary)] py-2 pe-2 ps-4 text-[15px] text-[var(--anu-primary-ink)] shadow-[var(--anu-shadow)]"
        style={{ background: "var(--anu-primary)", color: "var(--anu-primary-ink)" }}
      >
        <span dir="auto" className="min-w-0 flex-1 truncate">
          {undo.label}
        </span>
        <button type="button" onClick={undoDelete} className="inline-flex h-10 items-center rounded-full px-4 anu-strong">
          {t("anuCommon.undo")}
        </button>
      </div>
    </div>
  );
}
