/**
 * The question ANU is holding a run for, in the agent's words, what it would
 * touch, and the two answers. It sits in the flow of the page rather than in
 * a box: a 3px edge in the attention hue on the reading side is the only
 * frame, because this is the one thing that cannot move without the person.
 */

import { Button } from "@anu/design-library";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";

import type { AnuApproval, AnuDecision } from "../anu-api";
import { useDecideAnuApproval } from "../use-anu-queries";

interface AnuApprovalCardProps {
  approval: AnuApproval;
  /** `answers` is the compact pair under a list row; `full` is the task's own. */
  density?: "answers" | "full";
  className?: string;
}

function detailEntries(detail: unknown): Array<[string, string]> {
  if (typeof detail !== "object" || detail === null || Array.isArray(detail)) {
    return [];
  }
  return Object.entries(detail)
    .filter((entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number",
    )
    .map(([key, value]) => [key, String(value)]);
}

export function AnuApprovalCard({
  approval,
  density = "full",
  className,
}: AnuApprovalCardProps) {
  const { t } = useTranslation("anu");
  const decide = useDecideAnuApproval();
  const pending = approval.status === "pending";
  const answer = (decision: AnuDecision) =>
    decide.mutate({ taskId: approval.taskId, approvalId: approval.id, decision });
  const deciding = decide.isPending ? decide.variables?.decision : undefined;
  const full = density === "full";

  const answers = pending ? (
    <div className={cn("flex items-center gap-2", full && "mt-5")}>
      <Button
        variant="primary"
        shape="pill"
        size={full ? "large" : "regular"}
        loading={deciding === "approve"}
        disabled={decide.isPending}
        onClick={() => answer("approve")}
        className={full ? "px-6" : "px-4"}
      >
        {t("anuApprovalCard.approve")}
      </Button>
      <Button
        variant="ghost"
        shape="pill"
        size={full ? "large" : "regular"}
        loading={deciding === "reject"}
        disabled={decide.isPending}
        onClick={() => answer("reject")}
        className={full ? "px-6" : "px-4"}
      >
        {t("anuApprovalCard.decline")}
      </Button>
    </div>
  ) : null;

  const error = decide.isError ? (
    <p role="alert" className="mt-2 text-[14px] text-[var(--system-negative-strong)]">
      {t("anuApprovalCard.error")}
    </p>
  ) : null;

  if (!full) {
    return (
      <div className={className}>
        <p dir="auto" className="mb-2.5 text-[15px] leading-6 text-[var(--content-default)]">
          {approval.prompt}
        </p>
        {answers}
        {error}
      </div>
    );
  }

  const entries = detailEntries(approval.detail);
  return (
    <section
      aria-label={t("anuApprovalCard.heading")}
      className={cn(
        "border-s-[3px] ps-5",
        pending ? "border-[var(--system-mid-strong)]" : "border-[var(--border-element)]",
        className,
      )}
    >
      <p className="text-[14px] font-medium text-[var(--content-secondary)]">
        {t("anuApprovalCard.heading")}
      </p>
      <p dir="auto" className="mt-1.5 text-[20px] font-medium leading-7 text-[var(--content-emphasised)]">
        {approval.prompt}
      </p>
      {entries.length > 0 ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
          {entries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-[var(--content-secondary)]">
                {key === "file" ? t("anuApprovalCard.detailFile") : t("anuApprovalCard.detailOther")}
              </dt>
              <dd dir="ltr" className="min-w-0 truncate text-start font-mono text-[14px] text-[var(--content-default)]">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {pending ? (
        answers
      ) : (
        <p className="mt-3 text-[15px] text-[var(--content-secondary)]">
          {approval.status === "approved"
            ? t("anuApprovalCard.approved")
            : approval.status === "rejected"
              ? t("anuApprovalCard.rejected")
              : t("anuApprovalCard.expired")}
        </p>
      )}
      {error}
    </section>
  );
}
