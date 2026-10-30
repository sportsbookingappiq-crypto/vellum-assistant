/**
 * Locale-bound formatters for the ANU screens. Every figure goes through
 * `Intl`, never a hand-built string (docs/I18N.md, "Formatting is not copy").
 */

import { useMemo } from "react";

import { useTranslation } from "@/i18n";
import { formatRelativeTime } from "@/lib/relative-time";

export interface AnuFormat {
  /** "3 minutes ago", "yesterday". */
  relative: (iso: string) => string;
  /** "4.3 s", "2 min 5 s", "1 h 4 min". */
  duration: (ms: number) => string;
  /** "82%". */
  percent: (ratio: number) => string;
  /** "+1.2 s" from the start of the run, for timeline offsets. */
  offset: (ms: number) => string;
  /** "14:05" or "2:05 PM", with the date when it is not today. */
  clock: (iso: string) => string;
}

export function formatAnuDuration(ms: number, locale: string): string {
  const unit = (value: number, name: "second" | "minute" | "hour", digits = 0) =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "narrow",
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
  if (ms < 10_000) {
    return unit(ms / 1000, "second", 1);
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return unit(totalSeconds, "second");
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0
      ? unit(minutes, "minute")
      : `${unit(minutes, "minute")} ${unit(seconds, "second")}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? unit(hours, "hour")
    : `${unit(hours, "hour")} ${unit(rest, "minute")}`;
}

export function useAnuFormat(): AnuFormat {
  const { i18n } = useTranslation("anu");
  const locale = i18n.language;
  return useMemo(() => {
    const percent = new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 0,
    });
    const sameDay = new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
    const otherDay = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return {
      relative: (iso) =>
        formatRelativeTime(Date.parse(iso), { locale, minimumUnit: "minute" }),
      duration: (ms) => formatAnuDuration(ms, locale),
      percent: (ratio) => percent.format(ratio),
      offset: (ms) =>
        new Intl.NumberFormat(locale, {
          style: "unit",
          unit: "second",
          unitDisplay: "narrow",
          signDisplay: "always",
          maximumFractionDigits: 1,
          minimumFractionDigits: 1,
        }).format(ms / 1000),
      clock: (iso) => {
        const date = new Date(iso);
        const today = new Date();
        return date.toDateString() === today.toDateString()
          ? sameDay.format(date)
          : otherDay.format(date);
      },
    };
  }, [locale]);
}
