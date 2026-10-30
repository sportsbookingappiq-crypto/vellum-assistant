/**
 * Where a person gives ANU a goal, set as writing rather than as a form: a
 * large text field on the page itself, a short promise under it, and one
 * Start. A few example goals fill the field in one tap for someone who does
 * not know yet what to ask. The textarea grows with its text through the
 * CSS grid mirror (docs/CAPACITOR.md, "No JS height sync").
 */

import { Button } from "@anu/design-library";
import { useId, useState, type KeyboardEvent } from "react";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";
import { isPointerCoarse } from "@/utils/pointer";

import type { AnuTask } from "../anu-api";
import { useCreateAnuTask } from "../use-anu-queries";

export const ANU_GOAL_MAX_LENGTH = 4000;
const COUNTER_FROM = 3600;
const EXAMPLE_KEYS = [
  "anuGoalComposer.example1",
  "anuGoalComposer.example2",
  "anuGoalComposer.example3",
] as const;

interface AnuGoalComposerProps {
  onCreated: (task: AnuTask) => void;
  className?: string;
}

export function AnuGoalComposer({ onCreated, className }: AnuGoalComposerProps) {
  const { t } = useTranslation("anu");
  const id = useId();
  const [goal, setGoal] = useState("");
  const create = useCreateAnuTask();
  const trimmed = goal.trim();
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= ANU_GOAL_MAX_LENGTH && !create.isPending;

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    create.mutate(trimmed, {
      onSuccess: (task) => {
        setGoal("");
        onCreated(task);
      },
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    if (event.metaKey || event.ctrlKey || !isPointerCoarse()) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      className={cn("flex flex-col", className)}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {t("anuGoalComposer.label")}
      </label>
      <div
        className="grid border-b border-[var(--border-element)] pb-3 after:invisible after:col-start-1 after:row-start-1 after:whitespace-pre-wrap after:break-words after:text-[22px] after:leading-8 after:content-[attr(data-value)_'_'] focus-within:border-[var(--border-active)]"
        data-value={goal}
      >
        <textarea
          id={id}
          value={goal}
          rows={3}
          maxLength={ANU_GOAL_MAX_LENGTH}
          placeholder={t("anuGoalComposer.placeholder")}
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={onKeyDown}
          className="col-start-1 row-start-1 max-h-[45vh] min-h-24 w-full resize-none overflow-y-auto bg-transparent text-[22px] leading-8 text-[var(--content-emphasised)] outline-none placeholder:text-[var(--content-faint)]"
        />
      </div>
      <p className="mt-3 text-[14px] leading-5 text-[var(--content-secondary)]">
        {create.isError
          ? t("anuGoalComposer.error")
          : goal.length >= COUNTER_FROM
            ? t("anuGoalComposer.length", { count: goal.length, max: ANU_GOAL_MAX_LENGTH })
            : t("anuGoalComposer.hint")}
      </p>
      <Button
        type="submit"
        variant="primary"
        shape="pill"
        size="large"
        loading={create.isPending}
        disabled={!canSubmit}
        className="mt-5 self-start px-7"
      >
        {t("anuGoalComposer.submit")}
      </Button>
      {goal === "" ? (
        <div className="mt-10">
          <h2 className="text-[14px] font-semibold text-[var(--content-secondary)]">
            {t("anuGoalComposer.examplesTitle")}
          </h2>
          <ul className="mt-1">
            {EXAMPLE_KEYS.map((key) => (
              <li key={key} className="border-b border-[var(--border-hover)] last:border-b-0">
                <button
                  type="button"
                  onClick={() => setGoal(t(key))}
                  className="w-full py-3.5 text-start text-[16px] leading-6 text-[var(--content-default)] outline-none keyboard-focus:ring-2 keyboard-focus:ring-[var(--ring)]"
                >
                  {t(key)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
