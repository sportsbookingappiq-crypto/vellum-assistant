/**
 * What the agent sees in its sandbox browser: the newest frame, the address
 * it is on and the last thing it did there. Read-only: the person watches,
 * the agent drives. Frames are fetched over the authorised client as the
 * metadata advances, and the previous frame stays up until the next lands.
 */

import { Skeleton } from "@anu/design-library";
import { Eye, Globe } from "lucide-react";
import { useEffect, useState } from "react";

import { useTranslation } from "@/i18n";

import type { AnuStep } from "../anu-api";
import { latestBrowserStep } from "../anu-files-model";
import { useAnuBrowser, useAnuBrowserFrame } from "../use-anu-queries";

interface AnuBrowserViewProps {
  taskId: string;
  live: boolean;
  steps: readonly AnuStep[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function AnuBrowserView({ taskId, live, steps }: AnuBrowserViewProps) {
  const { t } = useTranslation("anu");
  const browser = useAnuBrowser(taskId, live);
  const latestFrame = browser.data?.latest ?? null;
  const frame = useAnuBrowserFrame(taskId, latestFrame?.frameId ?? null);
  // The newest browser step names where the agent is now, even when that
  // action captured no image; the picture is the newest frame there is.
  const step = latestBrowserStep(steps);
  const detail =
    step && typeof step.detail === "object" && step.detail !== null
      ? (step.detail as Record<string, unknown>)
      : {};
  const state = step || latestFrame
    ? {
        url: text(detail.url) ?? latestFrame?.url ?? null,
        action: text(detail.action) ?? latestFrame?.action ?? null,
      }
    : null;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const blob = frame.data?.blob;
    if (!blob) {
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [frame.data?.blob]);

  if (browser.isPending) {
    return <Skeleton className="aspect-[4/3] w-full rounded-xl" />;
  }
  if (!state) {
    return (
      <p className="text-[15px] text-[var(--content-secondary)]">
        {t("anuBrowser.none")}
      </p>
    );
  }

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-full bg-[var(--surface-sunken)] px-4 py-2.5">
        <Globe aria-hidden size={16} className="shrink-0 text-[var(--content-tertiary)]" />
        <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-[14px] text-[var(--content-default)]">
          {state.url ?? t("anuBrowser.noUrl")}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[12px] text-[var(--content-tertiary)]">
          <Eye aria-hidden size={14} />
          {t("anuBrowser.readOnly")}
        </span>
      </div>
      <div className="overflow-hidden rounded-xl bg-[var(--surface-sunken)]">
        {url ? (
          <img
            src={url}
            alt={t("anuBrowser.frameAlt", { url: state.url ?? "" })}
            className="block w-full"
          />
        ) : (
          <div className="aspect-[4/3] w-full" />
        )}
      </div>
      {browser.isError ? (
        <p className="text-[14px] text-[var(--content-secondary)]">
          {t("anuBrowser.loadError")}
        </p>
      ) : null}
      {state.action ? (
        <figcaption className="text-[15px] text-[var(--content-default)]">
          {t("anuBrowser.lastAction", { action: state.action })}
        </figcaption>
      ) : null}
      {live ? (
        <p className="flex items-center gap-2 text-[13px] text-[var(--system-info-strong)]">
          <span aria-hidden className="size-2 rounded-full bg-current" />
          {t("anuBrowser.live")}
        </p>
      ) : null}
    </figure>
  );
}
