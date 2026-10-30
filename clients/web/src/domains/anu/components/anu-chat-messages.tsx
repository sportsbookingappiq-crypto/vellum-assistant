/**
 * The messages of one chat (spec A.3.3). Bot replies are plain text on the
 * ground at the start edge with the bot's 24px face beside the first line of
 * each run; the person's messages are quiet bubbles at the end edge. Work
 * between replies folds into one steps card that expands in place, with a
 * Browser card and a Files card that open the full-screen windows. A
 * question waits inline as the approval card, a bot ANU drafted shows as
 * its preview card, and a failed turn says so with one Retry.
 */

import { MarkdownMessage } from "@anu/design-library";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import type { AnuAvatarTraits, AnuMessage, AnuSession } from "../anu-api";
import { parseBotDraftBlock, plainActivity, type AnuFace } from "../anu-bots-model";
import { chatBlocks, type AnuChatBlock } from "../anu-chat-model";
import { urlHost } from "../anu-files-model";
import { AnuApprovalCard } from "./anu-approval-card";
import { AnuAvatar } from "./anu-avatar";
import { useAnuFormat } from "../use-anu-format";
import { AnuBotPreview } from "./anu-bot-preview";
import { useSaveNewBot } from "./anu-bot-sheets";

/** A step title in everyday words (spec 0.3: never tool names or commands). */
export function useActivityText(): (raw: string | null | undefined) => string | null {
  const { t } = useTranslation("anu");
  return (raw) => {
    const activity = plainActivity(raw);
    if (!activity) {
      return null;
    }
    switch (activity.kind) {
      case "opening":
        return t("anuActivity.opening", { site: activity.host });
      case "searching":
        return t("anuActivity.searching", { query: activity.query });
      case "reading":
        return t("anuActivity.reading", { name: activity.name });
      case "writing":
        return t("anuActivity.writing", { name: activity.name });
      case "working":
        return t("anuActivity.working");
      default:
        return activity.text;
    }
  };
}

function CardLink({ to, title, detail }: { to: string; title: string; detail?: string | null }) {
  return (
    <Link
      to={to}
      className="flex min-h-14 items-center gap-3 rounded-[20px] bg-[var(--anu-surface)] px-4 py-2.5 active:bg-[var(--anu-surface-2)]"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] anu-strong">{title}</span>
        {detail ? (
          <span dir="auto" className="truncate text-[13px] text-[var(--anu-muted)]">
            {detail}
          </span>
        ) : null}
      </span>
      <ChevronRight aria-hidden size={18} className="shrink-0 text-[var(--anu-muted)] rtl:-scale-x-100" />
    </Link>
  );
}

function StepsBlock({
  block,
  sessionId,
}: {
  block: Extract<AnuChatBlock, { type: "steps" }>;
  sessionId: string;
}) {
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const activity = useActivityText();
  const [open, setOpen] = useState(false);
  const pages = block.pages.filter(Boolean);
  const pageCount = Math.max(1, block.pages.length);
  return (
    <div className="flex flex-col gap-2 ps-9">
      {block.pages.length > 0 ? (
        <CardLink
          to={routes.anu.browser("sessions", sessionId)}
          title={t("anuChat.openedPages", { count: pageCount, n: format.number(pageCount) })}
          detail={pages.slice(0, 3).map(urlHost).join(", ") || null}
        />
      ) : null}
      {block.files.length > 0 ? (
        <CardLink
          to={routes.anu.files("sessions", sessionId)}
          title={t("anuChat.fileCount", { count: block.files.length, n: format.number(block.files.length) })}
          detail={block.files[0]?.split("/").at(-1)}
        />
      ) : null}
      <div className="rounded-[20px] bg-[var(--anu-surface)] px-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-12 w-full items-center justify-between gap-3 text-start"
        >
          <span className="text-[15px]">{t("anuChat.steps", { count: block.messages.length, n: format.number(block.messages.length) })}</span>
          <span className="text-[13px] text-[var(--anu-muted)]">
            {open ? t("anuChat.hideSteps") : t("anuChat.showSteps")}
          </span>
        </button>
        {open ? (
          <ol className="flex flex-col gap-2 pb-3">
            {block.messages.map((message) => (
              <li key={message.id} dir="auto" className="text-[15px] leading-6 text-[var(--anu-ink)]">
                {activity(message.content) ?? t("anuActivity.working")}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

function DraftCard({ text }: { text: string }) {
  const { t } = useTranslation("anu");
  const parsed = parseBotDraftBlock(text);
  const saver = useSaveNewBot();
  if (!parsed) {
    return <MarkdownMessage content={text} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {parsed.before ? <MarkdownMessage content={parsed.before} /> : null}
      <div className="rounded-[20px] bg-[var(--anu-surface)] p-4" aria-label={t("anuChat.botDraft")}>
        <AnuBotPreview
          compact
          mode="create"
          initial={{ ...parsed.draft, avatar: null, modelProfile: null, skills: [] }}
          submitting={saver.pending}
          error={saver.error}
          onSubmit={saver.save}
        />
      </div>
      {parsed.after ? <MarkdownMessage content={parsed.after} /> : null}
    </div>
  );
}

interface AnuChatMessagesProps {
  sessionId: string;
  messages: readonly AnuMessage[];
  approvals: AnuSession["approvals"];
  traits: AnuAvatarTraits | null | undefined;
  /** Face of the newest reply's avatar; earlier ones rest. */
  face: AnuFace;
  onRetry: (text: string) => void;
}

export function AnuChatMessages({ sessionId, messages, approvals, traits, face, onRetry }: AnuChatMessagesProps) {
  const { t } = useTranslation("anu");
  const blocks = chatBlocks(messages);
  const lastReplyId = [...blocks].reverse().find((block) => block.type === "assistant");
  const pending = approvals.filter((approval) => approval.status === "pending");
  const shownApprovals = new Set<string>();

  return (
    <ol className="flex flex-col gap-5" aria-live="polite" aria-relevant="additions">
      {blocks.map((block) => {
        if (block.type === "user") {
          return (
            <li key={block.message.id} className="flex justify-end">
              <p
                dir="auto"
                className="max-w-[82%] whitespace-pre-wrap break-words rounded-[18px] bg-[var(--anu-surface)] px-4 py-2.5 text-[17px] leading-6"
              >
                {block.message.content}
              </p>
            </li>
          );
        }
        if (block.type === "steps") {
          return (
            <li key={block.id}>
              <StepsBlock block={block} sessionId={sessionId} />
            </li>
          );
        }
        if (block.type === "approval") {
          const approval =
            approvals.find((entry) => entry.stepId === block.message.id) ??
            pending.find((entry) => !shownApprovals.has(entry.id));
          if (!approval || shownApprovals.has(approval.id)) {
            return null;
          }
          shownApprovals.add(approval.id);
          return (
            <li key={block.message.id} className="ps-9">
              <AnuApprovalCard
                approval={{ ...approval, taskId: approval.taskId ?? "" }}
                sessionId={sessionId}
                traits={traits}
              />
            </li>
          );
        }
        if (block.type === "failed") {
          return (
            <li key={block.id} role="alert" className="ps-9">
              <div className="flex flex-wrap items-center gap-3 rounded-[20px] bg-[var(--anu-surface)] px-4 py-3">
                <span className="flex-1 text-[15px] text-[var(--anu-failed)]">{t("anuChat.replyFailed")}</span>
                {block.retryText ? (
                  <button
                    type="button"
                    onClick={() => onRetry(block.retryText ?? "")}
                    className="inline-flex h-10 items-center rounded-full bg-[var(--anu-bg)] px-4 text-[15px]"
                  >
                    {t("anuCommon.retry")}
                  </button>
                ) : null}
              </div>
            </li>
          );
        }
        const text = block.message.content ?? "";
        return (
          <li key={block.message.id} className="flex gap-3">
            <span className="w-6 shrink-0 pt-0.5">
              {block.firstOfRun ? (
                <AnuAvatar face={block === lastReplyId ? face : "rest"} traits={traits} size={24} />
              ) : null}
            </span>
            <div dir="auto" className="min-w-0 flex-1 text-[17px] leading-[26px] text-[var(--anu-ink)]">
              {text.includes("```anu-bot-draft") ? <DraftCard text={text} /> : <MarkdownMessage content={text} />}
            </div>
          </li>
        );
      })}
      {pending
        .filter((approval) => !shownApprovals.has(approval.id))
        .map((approval) => (
          <li key={approval.id} className="ps-9">
            <AnuApprovalCard approval={{ ...approval, taskId: approval.taskId ?? "" }} sessionId={sessionId} traits={traits} />
          </li>
        ))}
    </ol>
  );
}
