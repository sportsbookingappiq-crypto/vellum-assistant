/**
 * The drawer (spec A.3.7): opens from the leading edge (the right in
 * Arabic) over the chat. "Needs you" first when anything waits, then every
 * bot as its own thread, then plain rows to Chats, Agents, Tasks and
 * Settings, and the account's number at the foot. No mark, no logo.
 */

import * as Dialog from "@radix-ui/react-dialog";
import { Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import { botFace, needsYou, orderBots } from "../anu-bots-model";
import { formatPhone } from "../anu-task-model";
import { useAnuUiStore } from "../anu-ui-store";
import { useAnuFormat } from "../use-anu-format";
import { useAnuBots, useAnuMe, useAnuSessions } from "../use-anu-queries";
import { AnuAvatar } from "./anu-avatar";
import { AnuErrorBlock, AnuSkeletonRows, SAFE_BOTTOM, SAFE_TOP } from "./anu-ui";

export function AnuDrawer() {
  const { t } = useTranslation("anu");
  const open = useAnuUiStore.use.drawerOpen();
  const setOpen = useAnuUiStore.use.setDrawerOpen();
  const openSheet = useAnuUiStore.use.openSheet();
  const hidden = useAnuUiStore.use.hidden();
  const bots = useAnuBots();
  const sessions = useAnuSessions();
  const me = useAnuMe();
  const format = useAnuFormat();
  const navigate = useNavigate();
  const waiting = needsYou((sessions.data ?? []).filter((session) => !hidden.includes(session.id)));
  const list = orderBots((bots.data?.bots ?? []).filter((bot) => !hidden.includes(bot.id)));
  const lastLine = (botId: string) =>
    (sessions.data ?? []).find((session) => session.botId === botId)?.lastMessage ?? null;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const rows = [
    { to: routes.anu.chats, label: t("anuDrawer.chats") },
    { to: routes.anu.agents, label: t("anuDrawer.agents") },
    { to: routes.anu.tasks, label: t("anuDrawer.tasks") },
    { to: routes.anu.settings, label: t("anuDrawer.settings") },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--anu-scrim)]" />
        <Dialog.Content
          data-anu-sheet
          aria-describedby={undefined}
          className="anu-drawer fixed inset-y-0 start-0 z-50 flex w-[86%] max-w-[360px] flex-col bg-[var(--anu-surface)] text-[var(--anu-ink)] shadow-[var(--anu-shadow)] outline-none"
          style={{ paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM }}
        >
          <Dialog.Title className="sr-only">{t("anuDrawer.title")}</Dialog.Title>
          <nav aria-label={t("anuDrawer.title")} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-4">
            {waiting.length > 0 ? (
              <section aria-labelledby="anu-drawer-needs" className="mb-4">
                <h2 id="anu-drawer-needs" className="px-2 pb-1 text-[13px] text-[var(--anu-muted)]">
                  {t("anuDrawer.needsYou")}
                </h2>
                <ul>
                  {waiting.map((row) => (
                    <li key={row.sessionId}>
                      <button
                        type="button"
                        onClick={() => go(routes.anu.chat(row.sessionId))}
                        className="flex min-h-14 w-full items-center gap-3 rounded-[16px] px-2 py-2 text-start active:bg-[var(--anu-surface-2)]"
                      >
                        <AnuAvatar face="waiting" traits={row.avatar} size={40} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span dir="auto" className="truncate text-[15px] anu-strong">
                            {row.botName ?? t("anuChat.untitled")}
                          </span>
                          <span dir="auto" className="truncate text-[13px] text-[var(--anu-waiting)]">
                            {row.request}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Link
                  to={routes.anu.agents}
                  onClick={() => setOpen(false)}
                  className="mt-1 inline-flex min-h-11 items-center px-2 text-[15px] text-[var(--anu-accent)]"
                >
                  {t("anuDrawer.seeAll")}
                </Link>
              </section>
            ) : null}

            <section aria-labelledby="anu-drawer-bots">
              <h2 id="anu-drawer-bots" className="px-2 pb-1 text-[13px] text-[var(--anu-muted)]">
                {t("anuDrawer.bots")}
              </h2>
              {bots.isPending ? (
                <div className="px-2">
                  <AnuSkeletonRows count={3} avatar={40} height={56} label={t("anuCommon.loading")} />
                </div>
              ) : bots.isError ? (
                <AnuErrorBlock className="px-2" message={t("anuBots.loadError")} onRetry={() => void bots.refetch()} />
              ) : (
                <ul>
                  {list.map((bot) => {
                    const line = lastLine(bot.id);
                    return (
                      <li key={bot.id}>
                        <button
                          type="button"
                          onClick={() => go(routes.anu.newChat(bot.id) + "&latest=1")}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            go(routes.anu.bot(bot.id));
                          }}
                          className="flex min-h-14 w-full items-center gap-3 rounded-[16px] px-2 py-2 text-start active:bg-[var(--anu-surface-2)]"
                        >
                          <AnuAvatar face={botFace(bot.status)} traits={bot.avatar} size={40} />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span dir="auto" className="truncate text-[15px] anu-strong">
                              {bot.name}
                            </span>
                            <span dir="auto" className="truncate text-[13px] text-[var(--anu-muted)]">
                              {line ?? bot.role}
                            </span>
                          </span>
                          {bot.lastUsedAt ? (
                            <span className="shrink-0 text-[13px] text-[var(--anu-muted)]">
                              {format.relative(bot.lastUsedAt)}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                  <li>
                    <button
                      type="button"
                      onClick={() => openSheet({ kind: "create" })}
                      className="flex min-h-14 w-full items-center gap-3 rounded-[16px] px-2 py-2 text-start text-[15px] active:bg-[var(--anu-surface-2)]"
                    >
                      <span className="flex size-10 items-center justify-center rounded-full bg-[var(--anu-surface-2)]">
                        <Plus aria-hidden size={20} strokeWidth={1.75} />
                      </span>
                      {t("anuBots.newBot")}
                    </button>
                  </li>
                </ul>
              )}
            </section>

            <ul className="mt-4 border-t border-[var(--anu-surface-2)] pt-2">
              {rows.map((row) => (
                <li key={row.to}>
                  <button
                    type="button"
                    onClick={() => go(row.to)}
                    className="flex min-h-12 w-full items-center rounded-[16px] px-2 text-start text-[17px] active:bg-[var(--anu-surface-2)]"
                  >
                    {row.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          {me.data ? (
            <p dir="ltr" className="px-5 py-4 text-start text-[13px] text-[var(--anu-muted)]">
              {formatPhone(me.data.phone)}
            </p>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
