/**
 * What the run produced, and how far to trust it, as the close of the
 * task's own flow rather than a separate card: the answer in full, the
 * agent's own confidence as a figure and a bar at its true ratio, and the
 * tools and files the answer rests on, each traced to the step it came from.
 */

import { useTranslation } from "@/i18n";

import type { AnuStep, AnuTaskDetail } from "../anu-api";
import { deriveSources, taskResult, type AnuSource } from "../anu-task-model";
import { useAnuFormat } from "../use-anu-format";

const SOURCE_LABEL_KEY = {
  command: "anuResultCard.sourceCommand",
  query: "anuResultCard.sourceQuery",
  file: "anuResultCard.sourceFile",
  link: "anuResultCard.sourceLink",
} as const satisfies Record<AnuSource["kind"], string>;

interface AnuResultCardProps {
  task: AnuTaskDetail;
  steps: readonly AnuStep[];
}

export function AnuResultCard({ task, steps }: AnuResultCardProps) {
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const result = taskResult(task, steps);
  if (!result) {
    return null;
  }
  const failed = task.status === "failed";
  const sources = deriveSources(steps);
  const headingId = `anu-result-${task.id}`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col"
    >
      <h2
        id={headingId}
        className="text-[14px] font-medium text-[var(--content-secondary)]"
      >
        {failed ? t("anuResultCard.failedHeading") : t("anuResultCard.heading")}
      </h2>
      <p dir="auto" className="mt-1.5 whitespace-pre-wrap text-[18px] leading-7 text-[var(--content-emphasised)]">
        {result.text}
      </p>

      {failed ? null : (
        <div className="mt-5">
          <p className="text-[14px] font-medium text-[var(--content-secondary)]">
            {t("anuResultCard.confidence")}
          </p>
          {result.confidence === null ? (
            <p className="mt-1 text-body-medium-lighter text-[var(--content-secondary)]">
              {t("anuResultCard.noConfidence")}
            </p>
          ) : (
            <div className="mt-1 flex items-center gap-3">
              <span className="text-[24px] font-medium leading-8 tabular-nums text-[var(--content-emphasised)]">
                {format.percent(result.confidence)}
              </span>
              <span
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(result.confidence * 100)}
                aria-label={t("anuResultCard.confidence")}
                className="relative h-1.5 w-full max-w-60 overflow-hidden rounded-full bg-[var(--surface-active)] rtl:-scale-x-100"
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-[var(--content-default)]"
                  style={{ width: `${result.confidence * 100}%` }}
                />
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-[14px] font-medium text-[var(--content-secondary)]">
          {t("anuResultCard.sources")}
        </h3>
        {sources.length === 0 ? (
          <p className="mt-2 text-body-medium-lighter text-[var(--content-secondary)] [--text-body-medium-lighter-line-height:20px]">
            {t("anuResultCard.noSources")}
          </p>
        ) : (
          <ul className="mt-1">
            {sources.map((source) => (
              <li
                key={`${source.kind}:${source.value}`}
                className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-3 border-t border-[var(--border-hover)] py-2 first:border-t-0"
              >
                <span className="text-[12px] leading-4 text-[var(--content-tertiary)]">
                  {t(SOURCE_LABEL_KEY[source.kind])}
                </span>
                <span dir="ltr" className="min-w-0 truncate text-start font-mono text-[13px] leading-5 text-[var(--content-default)]">
                  {source.value}
                </span>
                <span className="text-[12px] leading-4 tabular-nums text-[var(--content-tertiary)]">
                  {t("anuResultCard.sourceStep", { seq: source.seq })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
