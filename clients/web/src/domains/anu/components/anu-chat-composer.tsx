/**
 * The chat's composer (spec A.3.3): a floating pill with a field that grows
 * with its text (CSS grid mirror, docs/CAPACITOR.md), a mic where speech to
 * text exists, and one round control at the end. Send is the accent circle
 * only once there is text; while the bot works and the field is empty, it is
 * Stop. Enter sends on a keyboard; on a phone Return makes a new line.
 */

import { ArrowUp, Mic, Square } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";

import { useTranslation } from "@/i18n";
import { haptic } from "@/utils/haptics";
import { cn } from "@/utils/misc";
import { isPointerCoarse } from "@/utils/pointer";

import { useAnuDictation } from "../use-anu-dictation";

interface AnuChatComposerProps {
  working: boolean;
  sending: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Text to restore into the field (a send that failed). */
  draft?: string;
}

export function AnuChatComposer({ working, sending, onSend, onStop, draft }: AnuChatComposerProps) {
  const { t } = useTranslation("anu");
  const id = useId();
  const [text, setText] = useState(draft ?? "");
  const [restored, setRestored] = useState(draft);
  if (draft !== restored) {
    setRestored(draft);
    if (draft) {
      setText(draft);
    }
  }
  const dictation = useAnuDictation((spoken) => setText((current) => (current ? `${current} ${spoken}` : spoken)));
  const hasText = text.trim().length > 0;
  const canSend = hasText && !sending;
  const send = () => {
    if (canSend) {
      void haptic.light();
      onSend(text.trim());
      setText("");
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !isPointerCoarse()) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div>
      {dictation.denied ? (
        <p role="alert" className="mb-2 px-2 text-[13px] text-[var(--anu-muted)]">
          {t("anuComposer.micDenied")}
        </p>
      ) : null}
      <form
        className="flex items-end gap-1 rounded-full bg-[var(--anu-bg)] py-1.5 pe-1.5 ps-4 shadow-[var(--anu-shadow)] [&:has(textarea:focus-visible)]:outline [&:has(textarea:focus-visible)]:outline-2 [&:has(textarea:focus-visible)]:outline-[var(--anu-accent)]"
        style={{ borderRadius: 26 }}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t("anuComposer.label")}
        </label>
        <div
          className="grid min-w-0 flex-1 py-2 after:invisible after:col-start-1 after:row-start-1 after:whitespace-pre-wrap after:break-words after:text-[17px] after:leading-6 after:content-[attr(data-value)_'_']"
          data-value={text}
        >
          <textarea
            id={id}
            dir="auto"
            rows={1}
            value={text}
            enterKeyHint={isPointerCoarse() ? "enter" : "send"}
            placeholder={t("anuComposer.placeholder")}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="col-start-1 row-start-1 max-h-40 w-full resize-none overflow-y-auto bg-transparent text-[17px] leading-6 text-[var(--anu-ink)] outline-none placeholder:text-[var(--anu-muted)] focus-visible:outline-none"
          />
        </div>
        {dictation.supported ? (
          <button
            type="button"
            aria-label={dictation.listening ? t("anuComposer.micStop") : t("anuComposer.mic")}
            aria-pressed={dictation.listening}
            onClick={dictation.toggle}
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--anu-ink)]",
              dictation.listening && "bg-[var(--anu-surface)]",
            )}
          >
            <Mic aria-hidden size={20} strokeWidth={1.75} />
          </button>
        ) : null}
        {working && !hasText ? (
          <button
            type="button"
            aria-label={t("anuComposer.stop")}
            onClick={() => {
              void haptic.medium();
              onStop();
            }}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--anu-surface)] text-[var(--anu-ink)]"
          >
            <Square aria-hidden size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label={t("anuComposer.send")}
            disabled={!canSend}
            aria-busy={sending || undefined}
            className={cn(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-full transition-colors duration-[140ms]",
              hasText
                ? "bg-[var(--anu-accent)] text-[var(--anu-accent-ink)]"
                : "bg-[var(--anu-surface)] text-[var(--anu-muted)]",
            )}
          >
            <ArrowUp aria-hidden size={20} strokeWidth={2} />
          </button>
        )}
      </form>
    </div>
  );
}
