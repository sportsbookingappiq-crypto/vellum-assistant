/**
 * The launch moment: a plain white screen (#FFFFFF) with the snowflake and
 * the word ANU below it, both in solid black. No gradient, glow or colour.
 * It looks the same in light and dark and in every language (ANU stays
 * Latin), and matches the native launch screens and the boot splash in
 * `index.html`, so cold start never flashes. It is the only place inside the
 * app the mark appears. Shown once per cold start, never longer than 1.2s
 * in total; with reduced motion it cuts instead of fading.
 */

import { useEffect, useState } from "react";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";

/** Minimum hold so the mark registers; the splash leaves as soon as both this and auth are done. */
const MIN_HOLD_MS = 600;
/** The splash never outlives this, ready or not (spec A.3.1). */
export const ANU_SPLASH_MAX_MS = 1200;
const FADE_MS = 300;

/** Launch ground and ink, the same in every theme. */
export const ANU_SPLASH_GROUND = "#FFFFFF";
export const ANU_SPLASH_INK = "#000000";

/** The snowflake, same geometry as `anu-mark.tsx` (viewBox 0 0 100 100). */
const MARK_PATH =
  "M9.3 73.5L25.34 60.76L17.26 53.72L29.94 57.1L34.16 53.75L32 50L34.16 46.25L29.94 42.9L17.26 46.28L25.34 39.24L9.3 26.5L28.35 34.02L30.41 23.51L33.82 36.18L38.84 38.16L41 34.41L45.33 34.41L46.12 29.08L36.86 19.79L46.99 23.26L50 3L53.01 23.26L63.14 19.79L53.88 29.08L54.67 34.41L59 34.41L61.16 38.16L66.18 36.18L69.59 23.51L71.65 34.02L90.7 26.5L74.66 39.24L82.74 46.28L70.06 42.9L65.84 46.25L68 50L65.84 53.75L70.06 57.1L82.74 53.72L74.66 60.76L90.7 73.5L71.65 65.98L69.59 76.49L66.18 63.82L61.16 61.84L59 65.59L54.67 65.59L53.88 70.92L63.14 80.21L53.01 76.74L50 97L46.99 76.74L36.86 80.21L46.12 70.92L45.33 65.59L41 65.59L38.84 61.84L33.82 63.82L30.41 76.49L28.35 65.98ZM43 50L46.5 56.06L53.5 56.06L57 50L53.5 43.94L46.5 43.94Z";

/**
 * The word ANU from the brand lockup (assets/brand/anu-logo-white.svg), with
 * the N drawn as one outline. viewBox 107 28 128 43.
 */
const WORDMARK_PATH =
  "M107.7 70L128.7 28.8L149.7 70L141.39 70L136.38 60.16L121.02 60.16L116.01 70ZM124.04 54.24L133.36 54.24L128.7 45.1Z" +
  "M158.2 70L158.2 30L166.91 30L184.3 58.06L184.3 30L191.7 30L191.7 70L182.99 70L165.6 41.94L165.6 70Z" +
  "M202.2 30H209.6V53.75A8.85 8.85 0 0 0 227.3 53.75V30H234.7V53.75A16.25 16.25 0 0 1 202.2 53.75Z";

function SolidShape({
  d,
  viewBox,
  width,
  height,
}: {
  d: string;
  viewBox: string;
  width: number;
  height: number;
}) {
  return (
    <svg viewBox={viewBox} width={width} height={height} aria-hidden focusable="false">
      <path d={d} fill={ANU_SPLASH_INK} fillRule="evenodd" />
    </svg>
  );
}

let shownThisLoad = false;
/** Measured from when this module first loaded, across both splash mounts. */
const loadStartedAt = Date.now();

/** Whether this page load still owes the person its splash. */
export function anuSplashPending(): boolean {
  return !shownThisLoad;
}

export function AnuSplash({ ready }: { ready: boolean }) {
  const { t } = useTranslation("anu");
  const [phase, setPhase] = useState<"hold" | "fade" | "gone">(
    shownThisLoad ? "gone" : "hold",
  );

  useEffect(() => {
    if (phase !== "hold") {
      return;
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const leave = () => {
      shownThisLoad = true;
      setPhase(reduced ? "gone" : "fade");
    };
    // Leave once auth has resolved and the mark has had its moment, and in
    // any case before the hard cap so the whole splash stays under 1.2s.
    const elapsed = Date.now() - loadStartedAt;
    const ceiling = setTimeout(
      leave,
      Math.max(0, ANU_SPLASH_MAX_MS - (reduced ? 0 : FADE_MS) - elapsed),
    );
    const floor = ready ? setTimeout(leave, Math.max(0, MIN_HOLD_MS - elapsed)) : undefined;
    return () => {
      clearTimeout(ceiling);
      if (floor) {
        clearTimeout(floor);
      }
    };
  }, [phase, ready]);

  useEffect(() => {
    if (phase !== "fade") {
      return;
    }
    const timer = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === "gone") {
    return null;
  }
  return (
    <div
      role="status"
      aria-label={t("anuSplash.label")}
      data-testid="anu-splash"
      dir="ltr"
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#FFFFFF]",
        "transition-opacity ease-out",
        phase === "fade" ? "opacity-0" : "opacity-100",
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <SolidShape d={MARK_PATH} viewBox="0 0 100 100" width={96} height={96} />
      <SolidShape d={WORDMARK_PATH} viewBox="107 28 128 43" width={72} height={24} />
    </div>
  );
}
