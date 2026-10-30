/**
 * Small pieces every ANU screen shares, drawn from the spec's tokens
 * (anu/docs/design/phone-app.md, A.2): the screen frame with its back
 * control, icon buttons, the one status pill a row may carry, flat grey
 * placeholder rows, and the empty and error blocks every list has.
 */

import { ChevronLeft, RotateCw } from "lucide-react";
import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";

import { useAnuOnline } from "../use-anu-online";

export const SAFE_TOP = "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))";
export const SAFE_BOTTOM = "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))";

/** A 44px round control holding one icon; `label` is its accessible name. */
export function AnuIconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--anu-ink)] transition-colors duration-[140ms] active:bg-[var(--anu-surface)] disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** Goes back one level, or to `fallback` when the screen was opened directly. */
export function useAnuBack(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    const state = window.history.state as { idx?: number } | null;
    if (state && typeof state.idx === "number" && state.idx > 0) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  };
}

export function AnuBackButton({ fallback }: { fallback: string }) {
  const { t } = useTranslation("anu");
  const back = useAnuBack(fallback);
  return (
    <AnuIconButton label={t("anuCommon.back")} onClick={back} className="-ms-2">
      <ChevronLeft aria-hidden size={26} strokeWidth={1.75} className="rtl:-scale-x-100" />
    </AnuIconButton>
  );
}

interface AnuScreenProps {
  title: ReactNode;
  fallback: string;
  trailing?: ReactNode;
  children: ReactNode;
  /** A window (Browser, Files) covers the chat beneath instead of replacing it. */
  overlay?: boolean;
  /** Visible title is in the body (profile); the header keeps only back. */
  hideTitle?: boolean;
}

/** A pushed screen: back at the start edge, one 22px title, content beneath. */
export function AnuScreen({ title, fallback, trailing, children, overlay, hideTitle }: AnuScreenProps) {
  const { t } = useTranslation("anu");
  const online = useAnuOnline();
  return (
    <div
      data-anu-root
      className={cn(
        "flex min-h-dvh flex-col",
        overlay && "anu-window fixed inset-0 z-40 overflow-y-auto overscroll-contain",
      )}
      style={{ paddingTop: SAFE_TOP }}
    >
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-1 bg-[var(--anu-bg)] px-3">
        <AnuBackButton fallback={fallback} />
        <h1
          className={cn(
            "min-w-0 flex-1 truncate text-[22px] leading-7 anu-strong",
            hideTitle && "sr-only",
          )}
        >
          {title}
        </h1>
        {trailing}
      </header>
      {!online ? (
        <p role="status" className="px-4 pb-1 text-[13px] text-[var(--anu-muted)]">
          {t("anuCommon.offline")}
        </p>
      ) : null}
      <main
        className="mx-auto w-full max-w-[720px] flex-1 px-4 pt-2"
        style={{ paddingBottom: `calc(32px + ${SAFE_BOTTOM})` }}
      >
        {children}
      </main>
    </div>
  );
}

export type AnuPillTone = "waiting" | "working" | "failed" | "neutral";

/** The single status mark a row may carry. */
export function AnuPill({ tone, children }: { tone: AnuPillTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[13px] leading-none",
        tone === "waiting" && "bg-[var(--anu-waiting-tint)] text-[var(--anu-waiting)]",
        tone === "working" && "bg-[var(--anu-done-tint)] text-[var(--anu-done)]",
        tone === "failed" && "text-[var(--anu-failed)]",
        tone === "neutral" && "bg-[var(--anu-surface)] text-[var(--anu-muted)]",
      )}
    >
      {children}
    </span>
  );
}

/** Flat grey rows at the size of the real ones; no shimmer. */
export function AnuSkeletonRows({
  count = 3,
  avatar = 40,
  height = 64,
  label,
}: {
  count?: number;
  avatar?: number;
  height?: number;
  label: string;
}) {
  return (
    <div role="status" aria-label={label} className="flex flex-col">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3" style={{ height }}>
          {avatar > 0 ? (
            <span className="anu-skeleton shrink-0 rounded-full" style={{ width: avatar, height: avatar }} />
          ) : null}
          <span className="flex flex-1 flex-col gap-2">
            <span className="anu-skeleton h-3.5 w-2/5" />
            <span className="anu-skeleton h-3 w-3/4" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** What a list says when it failed to load, with the one action that helps. */
export function AnuErrorBlock({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useTranslation("anu");
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 py-6", className)}>
      <p className="text-[15px] leading-6 text-[var(--anu-ink)]">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--anu-surface)] px-4 text-[15px] text-[var(--anu-ink)]"
      >
        <RotateCw aria-hidden size={16} strokeWidth={1.75} />
        {t("anuCommon.retry")}
      </button>
    </div>
  );
}

/** What an empty list says: one plain sentence, sometimes with an action. */
export function AnuEmptyBlock({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-4 py-8">
      <p className="max-w-[34ch] text-[15px] leading-6 text-[var(--anu-muted)]">{message}</p>
      {action}
    </div>
  );
}

/** A primary filled pill (ink on light, light on dark). */
export function AnuPrimaryButton({
  className,
  loading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      type="button"
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[var(--anu-primary)] px-6 text-[17px] text-[var(--anu-primary-ink)] anu-strong transition-opacity duration-[140ms] active:opacity-80 disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-4 rounded-full border-2 border-current border-e-transparent motion-safe:animate-spin"
        />
      ) : (
        children
      )}
    </button>
  );
}

/** A quiet text action; `danger` turns it red. */
export function AnuTextButton({
  className,
  danger,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-11 items-center rounded-full px-3 text-[15px] disabled:opacity-40",
        danger ? "text-[var(--anu-failed)]" : "text-[var(--anu-ink)]",
        className,
      )}
      {...props}
    />
  );
}
