/**
 * `/anu/chats` (spec A.3.8): every chat, grouped Today and Earlier, with a
 * row of bot faces to filter by (`?bot=<id>`). A row is the bot's face, its
 * name and the chat's title, the last line, and when. Swiping a row toward
 * the start shows Delete; the delete can be undone for five seconds.
 */

import { Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { useTranslation } from "@/i18n";
import { ACTION_WIDTH_PX, useSwipeToReveal } from "@/hooks/use-swipe-to-reveal";
import { cn } from "@/utils/misc";
import { usePointerCoarse } from "@/utils/pointer";
import { routes } from "@/utils/routes";

import type { AnuSession } from "./anu-api";
import { groupSessionsByDay, sessionFace } from "./anu-bots-model";
import { useAnuUiStore } from "./anu-ui-store";
import { AnuAvatar } from "./components/anu-avatar";
import { AnuEmptyBlock, AnuErrorBlock, AnuPill, AnuScreen, AnuSkeletonRows } from "./components/anu-ui";
import { useAnuFormat } from "./use-anu-format";
import { useAnuBots, useAnuSessions, useDeleteAnuSession } from "./use-anu-queries";

function ChatRow({ session }: { session: AnuSession }) {
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const coarse = usePointerCoarse();
  const scheduleDelete = useAnuUiStore.use.scheduleDelete();
  const deleteSession = useDeleteAnuSession();
  const remove = () =>
    scheduleDelete({
      id: session.id,
      label: t("anuUndo.chatDeleted"),
      commit: () =>
        deleteSession.mutate(session.id, {
          onError: () => useAnuUiStore.getState().unhide(session.id),
        }),
    });
  const swipe = useSwipeToReveal({
    enabled: coarse,
    trailingActions: [{ id: "delete", label: t("anuChats.delete"), icon: Trash2, onSelect: remove, variant: "destructive" }],
  });
  const waiting = session.approvals.some((approval) => approval.status === "pending");
  const title = session.title ?? t("anuChat.untitled");
  return (
    <li className="relative overflow-hidden rounded-[16px]">
      {swipe.revealedSide !== "none" || swipe.isDragging ? (
        <button
          type="button"
          onClick={remove}
          className="absolute inset-y-0 end-0 flex items-center justify-center bg-[var(--anu-failed)] text-[15px] text-white"
          style={{ width: ACTION_WIDTH_PX }}
        >
          {t("anuChats.delete")}
        </button>
      ) : null}
      <div
        className={cn("relative flex items-center bg-[var(--anu-bg)]", !swipe.isDragging && "transition-transform duration-200")}
        style={{ transform: `translateX(${swipe.offset}px)` }}
        onTouchStart={swipe.onTouchStart}
        onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd}
        onTouchCancel={swipe.onTouchCancel}
      >
        <Link
          to={routes.anu.chat(session.id)}
          className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2"
        >
          <AnuAvatar face={sessionFace(session.status)} traits={session.avatar} size={40} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span dir="auto" className="truncate text-[15px]">
              <span className="anu-strong">{session.agentName ?? t("anuChat.defaultName")}</span>
              <span className="text-[var(--anu-muted)]"> · </span>
              {title}
            </span>
            {session.lastMessage ? (
              <span dir="auto" className="truncate text-[13px] text-[var(--anu-muted)]">
                {session.lastMessage}
              </span>
            ) : null}
          </span>
          {waiting ? (
            <AnuPill tone="waiting">{t("anuBots.needsYou")}</AnuPill>
          ) : (
            <span className="shrink-0 text-[13px] text-[var(--anu-muted)]">
              {format.relative(session.updatedAt ?? session.createdAt)}
            </span>
          )}
        </Link>
        {!coarse ? (
          <button
            type="button"
            aria-label={t("anuChats.deleteNamed", { title })}
            onClick={remove}
            className="ms-1 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--anu-muted)] opacity-0 focus:opacity-100 [li:hover_&]:opacity-100"
          >
            <Trash2 aria-hidden size={18} strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function AnuChatsPage() {
  const { t } = useTranslation("anu");
  const [search, setSearch] = useSearchParams();
  const botId = search.get("bot");
  const bots = useAnuBots();
  const sessions = useAnuSessions(botId);
  const hidden = useAnuUiStore.use.hidden();
  const visible = (sessions.data ?? []).filter((session) => !hidden.includes(session.id));
  const groups = groupSessionsByDay(visible, new Date());
  const botList = (bots.data?.bots ?? []).filter((bot) => !hidden.includes(bot.id));

  return (
    <AnuScreen title={t("anuChats.title")} fallback={routes.anu.root}>
      {botList.length > 1 ? (
        <div role="group" aria-label={t("anuChats.filter")} className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1">
          <button
            type="button"
            aria-pressed={!botId}
            onClick={() => setSearch({}, { replace: true })}
            className={cn(
              "inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[15px]",
              !botId ? "bg-[var(--anu-primary)] text-[var(--anu-primary-ink)]" : "bg-[var(--anu-surface)]",
            )}
          >
            {t("anuChats.all")}
          </button>
          {botList.map((bot) => (
            <button
              key={bot.id}
              type="button"
              aria-pressed={botId === bot.id}
              onClick={() => setSearch({ bot: bot.id }, { replace: true })}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-full pe-4 ps-1.5 text-[15px]",
                botId === bot.id ? "bg-[var(--anu-primary)] text-[var(--anu-primary-ink)]" : "bg-[var(--anu-surface)]",
              )}
            >
              <AnuAvatar traits={bot.avatar} size={28} />
              <span dir="auto">{bot.name}</span>
            </button>
          ))}
        </div>
      ) : null}

      {sessions.isPending ? (
        <AnuSkeletonRows count={6} avatar={40} height={64} label={t("anuCommon.loading")} />
      ) : sessions.isError ? (
        <AnuErrorBlock message={t("anuChats.loadError")} onRetry={() => void sessions.refetch()} />
      ) : visible.length === 0 ? (
        <AnuEmptyBlock message={t("anuChats.empty")} />
      ) : (
        <>
          {groups.today.length > 0 ? (
            <section aria-labelledby="anu-chats-today">
              <h2 id="anu-chats-today" className="pb-1 pt-3 text-[13px] text-[var(--anu-muted)]">
                {t("anuChats.today")}
              </h2>
              <ul>
                {groups.today.map((session) => (
                  <ChatRow key={session.id} session={session} />
                ))}
              </ul>
            </section>
          ) : null}
          {groups.earlier.length > 0 ? (
            <section aria-labelledby="anu-chats-earlier">
              <h2 id="anu-chats-earlier" className="pb-1 pt-5 text-[13px] text-[var(--anu-muted)]">
                {t("anuChats.earlier")}
              </h2>
              <ul>
                {groups.earlier.map((session) => (
                  <ChatRow key={session.id} session={session} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </AnuScreen>
  );
}
