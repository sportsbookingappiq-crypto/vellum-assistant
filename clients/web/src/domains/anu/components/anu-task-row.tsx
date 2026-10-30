/**
 * One task in the list: its state glyph, the goal in the person's own words,
 * and a second line on where the run stands, with the time at the end edge.
 * Rows sit on the page itself, divided by a hairline, never boxed.
 */

import { type ReactNode } from "react";
import { Link } from "react-router";

import { MidlineDot } from "@/components/midline-dot";
import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";
import { routes } from "@/utils/routes";

import type { AnuTask } from "../anu-api";
import { statusShape, statusTone } from "../anu-task-model";
import { useAnuFormat } from "../use-anu-format";
import { AnuStatusMark } from "./anu-status-mark";
import { ANU_STATUS_LABEL_KEY } from "../anu-status-labels";

interface AnuTaskRowProps {
  task: AnuTask;
  selected: boolean;
  /** Shown under the row, outside the link: the answers to a waiting question. */
  footer?: ReactNode;
}

export function AnuTaskRow({ task, selected, footer }: AnuTaskRowProps) {
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const tone = statusTone(task.status);
  const when = task.finishedAt ?? task.startedAt ?? task.createdAt;

  return (
    <li
      className={cn(
        "border-b border-[var(--border-hover)] last:border-b-0",
        selected && "-mx-3 rounded-2xl border-transparent bg-[var(--surface-active)] px-3",
      )}
    >
      <Link
        to={routes.anu.task(task.id)}
        aria-label={t("anuTaskRow.openTask", { goal: task.goal })}
        aria-current={selected ? "page" : undefined}
        className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-start gap-x-3 py-3.5 outline-none keyboard-focus:ring-2 keyboard-focus:ring-[var(--ring)]"
      >
        <span className="flex h-6 items-center">
          <AnuStatusMark tone={tone} shape={statusShape(task.status)} />
        </span>
        <span className="min-w-0">
          <span dir="auto" className="line-clamp-2 text-[16px] font-medium leading-6 text-[var(--content-emphasised)]">
            {task.goal}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[14px] leading-5 text-[var(--content-secondary)]">
            <span className={tone === "attention" ? "text-[var(--content-emphasised)]" : undefined}>
              {t(ANU_STATUS_LABEL_KEY[task.status])}
            </span>
            {task.status === "succeeded" && task.confidence != null ? (
              <>
                <MidlineDot />
                <span className="truncate tabular-nums">
                  {t("anuTaskRow.confidence", { percent: format.percent(task.confidence) })}
                </span>
              </>
            ) : null}
            {task.status === "failed" && task.result ? (
              <>
                <MidlineDot />
                <span dir="auto" className="truncate">{task.result}</span>
              </>
            ) : null}
          </span>
        </span>
        <time
          dateTime={when}
          className="whitespace-nowrap pt-0.5 text-[13px] leading-5 tabular-nums text-[var(--content-tertiary)]"
        >
          {format.relative(when)}
        </time>
      </Link>
      {footer ? <div className="ps-[30px] pb-3.5">{footer}</div> : null}
    </li>
  );
}
