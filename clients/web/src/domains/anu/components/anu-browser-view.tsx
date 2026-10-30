/**
 * The Browser window's content (spec A.3.11): the newest page the bot has
 * open, full width at its real shape and updating live, a caption pill
 * saying what it is doing there, and a strip of the pages it visited. A tap
 * on a visited page shows that one. View only: the person watches.
 */

import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";

import type { AnuBrowserFrame, AnuScope } from "../anu-api";
import { urlHost } from "../anu-files-model";
import { useAnuBrowser, useAnuBrowserFrame } from "../use-anu-queries";

interface AnuBrowserViewProps {
  scope: AnuScope;
  live: boolean;
  /** What the bot is doing there, already in plain words. */
  caption: string | null;
  /** Reports the page on show, for the window's title bar. */
  onPage?: (page: { url: string | null; title: string | null }) => void;
}

function useFrameUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function Thumb({ scope, frame, selected, onSelect }: { scope: AnuScope; frame: AnuBrowserFrame; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation("anu");
  const image = useAnuBrowserFrame(scope, frame.frameId);
  const url = useFrameUrl(image.data?.blob);
  const host = frame.url ? urlHost(frame.url) : t("anuBrowser.noUrl");
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={t("anuBrowser.showPage", { site: host })}
      onClick={onSelect}
      className={cn(
        "flex w-28 shrink-0 flex-col gap-1 rounded-[12px] p-1 text-start",
        selected && "bg-[var(--anu-surface-2)]",
      )}
    >
      <span className="block aspect-[4/3] w-full overflow-hidden rounded-[8px] bg-[var(--anu-surface)]">
        {url ? <img src={url} alt="" className="h-full w-full object-cover object-top" /> : null}
      </span>
      <span dir="ltr" className="truncate px-0.5 text-start text-[13px] text-[var(--anu-muted)]">
        {host}
      </span>
    </button>
  );
}

export function AnuBrowserView({ scope, live, caption, onPage }: AnuBrowserViewProps) {
  const { t } = useTranslation("anu");
  const browser = useAnuBrowser(scope, live);
  const frames = browser.data?.frames ?? [];
  const latest = browser.data?.latest ?? frames.at(-1) ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const shown = (picked ? frames.find((frame) => frame.frameId === picked) : null) ?? latest;
  const image = useAnuBrowserFrame(scope, shown?.frameId ?? null);
  const url = useFrameUrl(image.data?.blob);

  useEffect(() => {
    onPage?.({ url: shown?.url ?? null, title: null });
  }, [shown?.url, onPage]);

  // One entry per page, newest last, for the strip.
  const pages = frames.filter(
    (frame, index) => frame.url && frames.findIndex((other) => other.url === frame.url) === index,
  );

  if (browser.isPending) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <div className="anu-skeleton aspect-[4/3] w-full rounded-[20px]" />
        <p className="text-[13px] text-[var(--anu-muted)]">{t("anuBrowser.connecting")}</p>
      </div>
    );
  }
  if (!shown) {
    return (
      <div className="flex flex-col gap-3">
        <div className="anu-skeleton aspect-[4/3] w-full rounded-[20px]" />
        <p className="text-[15px] text-[var(--anu-muted)]">{t("anuBrowser.none")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <figure className="relative overflow-hidden rounded-[20px] bg-[var(--anu-surface)]">
        {url ? (
          <img
            src={url}
            alt={t("anuBrowser.frameAlt", { url: shown.url ?? "" })}
            className={cn("block w-full", image.isFetching && !image.data && "opacity-60")}
          />
        ) : (
          <div className="aspect-[4/3] w-full" />
        )}
        {browser.isError ? (
          <div role="alert" className="absolute inset-x-3 top-3 flex items-center gap-3 rounded-[16px] bg-[var(--anu-bg)] px-4 py-2.5 shadow-[var(--anu-shadow)]">
            <span className="flex-1 text-[15px]">{t("anuBrowser.stopped")}</span>
            <button
              type="button"
              onClick={() => void browser.refetch()}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--anu-surface)] px-3 text-[15px]"
            >
              <RotateCw aria-hidden size={14} />
              {t("anuCommon.retry")}
            </button>
          </div>
        ) : null}
        {caption ? (
          <figcaption
            dir="auto"
            className="absolute inset-x-3 bottom-3 mx-auto w-fit max-w-[calc(100%-24px)] truncate rounded-full bg-[var(--anu-bg)] px-4 py-2 text-[13px] shadow-[var(--anu-shadow)]"
          >
            {caption}
          </figcaption>
        ) : null}
      </figure>
      {!live ? <p className="text-[13px] text-[var(--anu-muted)]">{t("anuBrowser.ended")}</p> : null}
      {pages.length > 1 ? (
        <div role="group" aria-label={t("anuBrowser.visited")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {pages.map((frame) => (
            <Thumb
              key={frame.frameId}
              scope={scope}
              frame={frame}
              selected={frame.url === shown.url}
              onSelect={() => setPicked(frame.frameId === latest?.frameId ? null : frame.frameId)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
