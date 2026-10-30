/**
 * The bot asking before it acts (spec A.3.3, "Approval card"): one sentence
 * in the bot's voice with the concrete thing it wants to do, and two
 * answers, Allow and Not now. No risk levels, tool names or policy words.
 * Answers go through the existing approval endpoints unchanged.
 */

import { useTranslation } from "@/i18n";
import { haptic } from "@/utils/haptics";
import { cn } from "@/utils/misc";

import type { AnuApproval, AnuAvatarTraits, AnuDecision } from "../anu-api";
import { useDecideAnuApproval, useDecideAnuSessionApproval } from "../use-anu-queries";
import { AnuAvatar } from "./anu-avatar";

interface AnuApprovalCardProps {
  approval: AnuApproval;
  /** Kept for the task screens; both densities draw the same card now. */
  density?: "answers" | "full";
  /** Set when the question belongs to a chat session rather than a task. */
  sessionId?: string;
  traits?: AnuAvatarTraits | null;
  className?: string;
}

export function AnuApprovalCard({ approval, sessionId, traits, className }: AnuApprovalCardProps) {
  const { t } = useTranslation("anu");
  const decideTask = useDecideAnuApproval();
  const decideSession = useDecideAnuSessionApproval(sessionId ?? "");
  const decide = sessionId ? decideSession : decideTask;
  const pending = approval.status === "pending";
  const answer = (decision: AnuDecision) => {
    void haptic.light();
    if (sessionId) {
      decideSession.mutate({ approvalId: approval.id, decision });
    } else {
      decideTask.mutate({ taskId: approval.taskId, approvalId: approval.id, decision });
    }
  };
  const deciding = decide.isPending ? decide.variables?.decision : undefined;

  return (
    <section
      aria-label={t("anuApprovalCard.heading")}
      data-testid="anu-approval-card"
      className={cn("rounded-[20px] bg-[var(--anu-surface)] p-4", className)}
    >
      <div className="flex items-start gap-3">
        <AnuAvatar face={pending ? "waiting" : "rest"} traits={traits} size={24} className="mt-0.5" />
        <p dir="auto" className="min-w-0 flex-1 text-[17px] leading-6 text-[var(--anu-ink)]">
          {approval.prompt}
        </p>
      </div>
      {pending ? (
        <div className="mt-4 flex items-center gap-2 ps-9">
          <button
            type="button"
            disabled={decide.isPending}
            aria-busy={deciding === "approve" || undefined}
            onClick={() => answer("approve")}
            className="inline-flex h-11 min-w-24 items-center justify-center rounded-full bg-[var(--anu-primary)] px-5 text-[15px] text-[var(--anu-primary-ink)] anu-strong disabled:opacity-50"
          >
            {t("anuApprovalCard.approve")}
          </button>
          <button
            type="button"
            disabled={decide.isPending}
            aria-busy={deciding === "reject" || undefined}
            onClick={() => answer("reject")}
            className="inline-flex h-11 items-center justify-center rounded-full px-4 text-[15px] text-[var(--anu-ink)] disabled:opacity-50"
          >
            {t("anuApprovalCard.decline")}
          </button>
        </div>
      ) : (
        <p className="mt-2 ps-9 text-[13px] text-[var(--anu-muted)]">
          {approval.status === "approved"
            ? t("anuApprovalCard.approved")
            : approval.status === "rejected"
              ? t("anuApprovalCard.rejected")
              : t("anuApprovalCard.expired")}
        </p>
      )}
      {decide.isError ? (
        <p role="alert" className="mt-2 ps-9 text-[13px] text-[var(--anu-failed)]">
          {t("anuApprovalCard.error")}
        </p>
      ) : null}
    </section>
  );
}
