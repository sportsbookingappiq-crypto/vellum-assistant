/**
 * The small glyph that carries a task's or a step's state, in a fixed 16px
 * slot so rows line up. Shape and colour both encode the state, so it reads
 * without colour too: a filled dot for live work, a diamond for a question
 * waiting on the person, a check for done, a cross for failed, a square for
 * stopped and a hollow ring for not started.
 */

import { cn } from "@/utils/misc";

import type { AnuStatusTone } from "../anu-task-model";

export type AnuMarkShape = "dot" | "diamond" | "check" | "cross" | "square" | "ring";

const TONE_COLOR: Record<AnuStatusTone, string> = {
  live: "text-[var(--system-info-strong)]",
  attention: "text-[var(--system-mid-strong)]",
  positive: "text-[var(--system-positive-strong)]",
  negative: "text-[var(--system-negative-strong)]",
  neutral: "text-[var(--content-tertiary)]",
};

interface AnuStatusMarkProps {
  tone: AnuStatusTone;
  shape: AnuMarkShape;
  className?: string;
}

export function AnuStatusMark({ tone, shape, className }: AnuStatusMarkProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      aria-hidden
      focusable="false"
      className={cn("shrink-0", TONE_COLOR[tone], className)}
    >
      {shape === "dot" ? <circle cx="8" cy="8" r="4" fill="currentColor" /> : null}
      {shape === "ring" ? (
        <circle
          cx="8"
          cy="8"
          r="3.75"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      ) : null}
      {shape === "diamond" ? (
        <path d="M8 2.5L13.5 8L8 13.5L2.5 8Z" fill="currentColor" />
      ) : null}
      {shape === "square" ? (
        <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
      ) : null}
      {shape === "check" ? (
        <path
          d="M3.5 8.5L6.5 11.5L12.5 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {shape === "cross" ? (
        <path
          d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
