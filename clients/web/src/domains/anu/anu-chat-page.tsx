/**
 * `/anu` and `/anu/chat/:sessionId`: the root of the app is always a chat
 * (spec A.1 and A.3.3). The header holds the menu, the bot chip and New
 * chat, never a logo. Without a session in the URL the root opens the most
 * recent chat, or a new one with the default bot; `?bot=<id>` starts a new
 * chat with that bot (`&latest=1` reopens its newest chat instead). A new
 * chat exists only on the server once its first message is sent. Browser
 * and Files are child routes drawn over this screen, so closing them comes
 * back to the same scroll position.
 */

import { ActionMenu } from "@anu/design-library";
import { ChevronDown, EllipsisVertical, Menu, SquarePen } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams, useSearchParams } from "react-router";

import { useTranslation } from "@/i18n";
import { haptic } from "@/utils/haptics";
import { routes } from "@/utils/routes";

import { AnuApiError, type AnuAvatarTraits, type AnuBot, type AnuStarter } from "./anu-api";
import {
  anuNotifyPermission,
  anuNotifyPromptDismissed,
  dismissAnuNotifyPrompt,
  requestAnuNotifyPermission,
} from "./anu-notify";
import { pickBot, progressFraction, sessionFace, turnProgress, type AnuFace } from "./anu-bots-model";
import { useAnuUiStore } from "./anu-ui-store";
import { AnuAvatar } from "./components/anu-avatar";
import { AnuChatComposer } from "./components/anu-chat-composer";
import { AnuChatMessages, useActivityText } from "./components/anu-chat-messages";
import { AnuDrawer } from "./components/anu-drawer";
import { AnuIconButton, AnuPrimaryButton, SAFE_BOTTOM, SAFE_TOP } from "./components/anu-ui";
import { useAnuFormat } from "./use-anu-format";
import { useAnuOnline } from "./use-anu-online";
import {
  useAnuBots,
  useAnuMessages,
  useAnuSession,
  useAnuSessions,
  useDeleteAnuSession,
  useSendAnuMessage,
  useStartAnuChat,
  useStopAnuSession,
} from "./use-anu-queries";
import { useAnuSessionStream } from "./use-anu-session-stream";

/** Where each chat was scrolled to, so coming back lands in the same place. */
const scrollPositions = new Map<string, number>();

interface ChatBot {
  id: string | null;
  name: string;
  avatar: AnuAvatarTraits | null;
  greeting: string;
  starters: AnuStarter[];
}

function toChatBot(bot: AnuBot | null, fallbackName: string): ChatBot {
  return bot
    ? { id: bot.id, name: bot.name, avatar: bot.avatar, greeting: bot.greeting, starters: bot.starters }
    : { id: null, name: fallbackName, avatar: null, greeting: "", starters: [] };
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function ChatHeader({
  bot,
  face,
  working,
  sessionId,
  progress,
  onDelete,
}: {
  bot: ChatBot;
  face: AnuFace;
  working: boolean;
  sessionId: string | null;
  progress: number | null;
  onDelete: () => void;
}) {
  const { t } = useTranslation("anu");
  const setDrawerOpen = useAnuUiStore.use.setDrawerOpen();
  const openSheet = useAnuUiStore.use.openSheet();
  const navigate = useNavigate();
  return (
    <header className="relative z-10 shrink-0 bg-[var(--anu-bg)]" style={{ paddingTop: SAFE_TOP }}>
      <div className="flex h-12 items-center gap-1 px-2">
        <AnuIconButton label={t("anuChat.menu")} onClick={() => setDrawerOpen(true)}>
          <Menu aria-hidden size={22} strokeWidth={1.75} />
        </AnuIconButton>
        <div className="flex min-w-0 flex-1 items-center">
          {bot.id ? (
            <Link
              to={routes.anu.bot(bot.id)}
              aria-label={t("anuChat.openProfile", { name: bot.name })}
              className="shrink-0 rounded-full p-1"
            >
              <AnuAvatar face={face} traits={bot.avatar} size={28} />
            </Link>
          ) : (
            <span className="shrink-0 p-1">
              <AnuAvatar face={face} traits={bot.avatar} size={28} />
            </span>
          )}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={t("anuChat.switchBot", { name: bot.name })}
            onClick={() => openSheet({ kind: "switcher" })}
            className="flex min-h-11 min-w-0 items-center gap-1 rounded-full pe-2 ps-1 text-start"
          >
            <span className="flex min-w-0 flex-col">
              <span dir="auto" className="truncate text-[17px] leading-6 anu-strong">
                {bot.name}
              </span>
              {working ? (
                <span className="text-[13px] leading-4 text-[var(--anu-muted)]">{t("anuChat.working")}</span>
              ) : null}
            </span>
            <ChevronDown aria-hidden size={16} className="shrink-0 text-[var(--anu-muted)]" />
          </button>
        </div>
        <AnuIconButton
          label={t("anuChat.newChat")}
          onClick={() => navigate(bot.id ? routes.anu.newChat(bot.id) : `${routes.anu.root}?new=1`)}
        >
          <SquarePen aria-hidden size={21} strokeWidth={1.75} />
        </AnuIconButton>
        {sessionId ? (
          <ActionMenu.Root>
            <ActionMenu.Trigger asChild>
              <button
                type="button"
                aria-label={t("anuChat.more")}
                className="inline-flex size-11 items-center justify-center rounded-full"
              >
                <EllipsisVertical aria-hidden size={21} strokeWidth={1.75} />
              </button>
            </ActionMenu.Trigger>
            <ActionMenu.Content title={t("anuChat.more")} align="end">
              <ActionMenu.Item
                label={t("anuChat.seeWhatItsDoing")}
                onSelect={() => navigate(routes.anu.browser("sessions", sessionId))}
              />
              <ActionMenu.Item
                label={t("anuChat.files")}
                onSelect={() => navigate(routes.anu.files("sessions", sessionId))}
              />
              <ActionMenu.Item label={t("anuChat.deleteChat")} tone="destructive" onSelect={onDelete} />
            </ActionMenu.Content>
          </ActionMenu.Root>
        ) : null}
      </div>
      {progress !== null ? (
        <div
          role="progressbar"
          aria-label={t("anuChat.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="absolute inset-x-0 bottom-0 h-[3px]"
        >
          <div
            className="h-full bg-[var(--anu-accent)] opacity-60 transition-[width] duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      ) : null}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Pieces of the body
// ---------------------------------------------------------------------------

function HistorySkeleton() {
  const { t } = useTranslation("anu");
  return (
    <div role="status" aria-label={t("anuCommon.loading")} className="flex flex-col gap-5 pt-4">
      <span className="anu-skeleton ms-auto h-11 w-3/5 rounded-[18px]" />
      <span className="flex gap-3">
        <span className="anu-skeleton size-6 shrink-0 rounded-full" />
        <span className="flex flex-1 flex-col gap-2">
          <span className="anu-skeleton h-4 w-11/12" />
          <span className="anu-skeleton h-4 w-4/5" />
          <span className="anu-skeleton h-4 w-2/5" />
        </span>
      </span>
      <span className="anu-skeleton ms-auto h-11 w-2/5 rounded-[18px]" />
    </div>
  );
}

function EmptyChat({ bot }: { bot: ChatBot }) {
  const { t } = useTranslation("anu");
  return (
    <div className="flex flex-col items-center pt-[14vh] text-center">
      <AnuAvatar face="rest" traits={bot.avatar} size={96} />
      <p dir="auto" className="mt-5 max-w-[30ch] text-[22px] leading-8 anu-strong">
        {bot.greeting || t("anuChat.defaultGreeting", { name: bot.name })}
      </p>
    </div>
  );
}

function Starters({ starters, onPick }: { starters: AnuStarter[]; onPick: (prompt: string) => void }) {
  if (starters.length === 0) {
    return null;
  }
  return (
    <ul className="mb-3 flex flex-wrap justify-center gap-2">
      {starters.slice(0, 3).map((starter) => (
        <li key={starter.label}>
          <button
            type="button"
            dir="auto"
            onClick={() => onPick(starter.prompt || starter.label)}
            className="inline-flex min-h-10 items-center rounded-full bg-[var(--anu-surface)] px-4 text-[15px] active:bg-[var(--anu-surface-2)]"
          >
            {starter.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Asks once, in context, whether to send a banner when a bot needs the person. */
function NotifyPrompt({ name }: { name: string }) {
  const { t } = useTranslation("anu");
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (anuNotifyPromptDismissed()) {
      return;
    }
    let live = true;
    void anuNotifyPermission().then((state) => {
      if (live && state === "prompt") {
        setVisible(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  if (!visible) {
    return null;
  }
  return (
    <div role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-[20px] bg-[var(--anu-surface)] px-4 py-2.5">
      <p className="min-w-0 flex-1 text-[15px]">{t("anuNotify.prompt", { name })}</p>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
          dismissAnuNotifyPrompt();
          void requestAnuNotifyPermission();
        }}
        className="inline-flex h-10 items-center rounded-full bg-[var(--anu-primary)] px-4 text-[15px] text-[var(--anu-primary-ink)]"
      >
        {t("anuNotify.turnOn")}
      </button>
      <button
        type="button"
        onClick={() => {
          setVisible(false);
          dismissAnuNotifyPrompt();
        }}
        className="inline-flex h-10 items-center rounded-full px-3 text-[15px]"
      >
        {t("anuNotify.notNow")}
      </button>
    </div>
  );
}

function ChatFrame({ header, children, footer }: { header: ReactNode; children: ReactNode; footer: ReactNode }) {
  return (
    <div data-anu-root className="flex h-dvh flex-col overflow-hidden">
      {header}
      {children}
      <div className="shrink-0 px-3 pt-1" style={{ paddingBottom: `calc(10px + ${SAFE_BOTTOM})` }}>
        <div className="mx-auto w-full max-w-[720px]">{footer}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The chat
// ---------------------------------------------------------------------------

function ChatView({ sessionId, bot: requestedBot }: { sessionId: string | null; bot: AnuBot | null }) {
  const { t } = useTranslation("anu");
  const navigate = useNavigate();
  const location = useLocation();
  const online = useAnuOnline();
  const activity = useActivityText();
  const format = useAnuFormat();
  const bots = useAnuBots();
  const session = useAnuSession(sessionId ?? "");
  const messages = useAnuMessages(sessionId ?? "");
  const stream = useAnuSessionStream(sessionId ?? "");
  const send = useSendAnuMessage(sessionId ?? "");
  const start = useStartAnuChat();
  const stop = useStopAnuSession(sessionId ?? "");
  const deleteSession = useDeleteAnuSession();
  const scheduleDelete = useAnuUiStore.use.scheduleDelete();
  const setCurrentBotId = useAnuUiStore.use.setCurrentBotId();
  const scroller = useRef<HTMLDivElement>(null);
  const [failedDraft, setFailedDraft] = useState<string | undefined>();
  const [sendError, setSendError] = useState<"busy" | "failed" | null>(null);

  const sessionBotId = session.data?.botId ?? null;
  const bot: ChatBot = sessionId
    ? (() => {
        const found = bots.data?.bots.find((entry) => entry.id === sessionBotId) ?? null;
        if (found) {
          return toChatBot(found, found.name);
        }
        return {
          id: sessionBotId,
          name: session.data?.agentName ?? t("anuChat.untitled"),
          avatar: session.data?.avatar ?? null,
          greeting: "",
          starters: [],
        };
      })()
    : toChatBot(requestedBot, t("anuChat.defaultName"));

  useEffect(() => {
    setCurrentBotId(bot.id);
  }, [bot.id, setCurrentBotId]);

  const list = sessionId ? (messages.data ?? []) : [];
  const status = session.data?.status ?? "idle";
  const approvals = session.data?.approvals ?? [];
  const waiting = approvals.some((approval) => approval.status === "pending");
  const working = status === "working" || send.isPending || start.isPending;

  // Success plays once when a turn finishes, and once on a bot just made.
  const [celebrate, setCelebrate] = useState(
    Boolean((location.state as { justCreated?: boolean } | null)?.justCreated),
  );
  const wasWorking = useRef(working);
  useEffect(() => {
    if (wasWorking.current && !working && status !== "failed") {
      setCelebrate(true);
      void haptic.success();
    }
    wasWorking.current = working;
  }, [working, status]);
  useEffect(() => {
    if (!celebrate) {
      return;
    }
    const timer = setTimeout(() => setCelebrate(false), 900);
    return () => clearTimeout(timer);
  }, [celebrate]);

  const face: AnuFace = waiting
    ? "waiting"
    : working
      ? "thinking"
      : celebrate
        ? "success"
        : sessionFace(status === "failed" ? "failed" : "idle");

  const progress = working ? turnProgress(list) : null;
  const fraction = progress ? progressFraction(progress) : null;

  // Keep the newest message in view while near the bottom; restore the
  // place the person left this chat at.
  const restored = useRef(false);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !sessionId || !messages.data) {
      return;
    }
    if (!restored.current) {
      restored.current = true;
      const saved = scrollPositions.get(sessionId);
      node.scrollTop = saved ?? node.scrollHeight;
      return;
    }
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 160;
    if (nearBottom) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages.data, sessionId]);
  useEffect(() => {
    const node = scroller.current;
    return () => {
      if (node && sessionId) {
        scrollPositions.set(sessionId, node.scrollTop);
      }
    };
  }, [sessionId]);

  const submit = (text: string) => {
    setSendError(null);
    setFailedDraft(undefined);
    const onError = (error: unknown) => {
      setFailedDraft(text);
      setSendError(error instanceof AnuApiError && error.status === 409 ? "busy" : "failed");
      void haptic.error();
    };
    if (sessionId) {
      send.mutate(text, { onError });
      return;
    }
    start.mutate(
      { botId: bot.id ?? undefined, text },
      {
        onSuccess: (created) => navigate(routes.anu.chat(created.id), { replace: true }),
        onError,
      },
    );
  };

  const deleteChat = () => {
    if (!sessionId) {
      return;
    }
    const id = sessionId;
    scheduleDelete({
      id,
      label: t("anuUndo.chatDeleted"),
      commit: () =>
        deleteSession.mutate(id, {
          onError: () => useAnuUiStore.getState().unhide(id),
        }),
    });
    navigate(bot.id ? routes.anu.newChat(bot.id) : routes.anu.root, { replace: true });
  };

  // What the line above the composer says, most urgent first.
  let caption: string | null = null;
  if (!online) {
    caption = t("anuChat.offline");
  } else if (sessionId && (stream === "reconnecting" || stream === "lost")) {
    caption = t("anuChat.reconnecting");
  } else if (sendError === "busy") {
    caption = t("anuChat.busy");
  } else if (sendError === "failed") {
    caption = t("anuChat.sendError");
  } else if (working) {
    const doing = activity(progress?.caption) ?? t("anuChat.thinking");
    caption =
      progress?.step && progress.total
        ? t("anuChat.stepOf", { doing, step: format.number(progress.step), total: format.number(progress.total) })
        : doing;
  }

  const empty = list.length === 0;
  const notFound = session.error instanceof AnuApiError && session.error.status === 404;

  return (
    <ChatFrame
      header={
        <ChatHeader
          bot={bot}
          face={face}
          working={working}
          sessionId={sessionId}
          progress={fraction}
          onDelete={deleteChat}
        />
      }
      footer={
        <>
          {waiting ? <NotifyPrompt name={bot.name} /> : null}
          {empty && !messages.isPending ? (
            <Starters starters={bot.starters} onPick={submit} />
          ) : null}
          {caption ? (
            <p role="status" aria-live="polite" dir="auto" className="mb-2 truncate px-2 text-[13px] text-[var(--anu-muted)]">
              {caption}
            </p>
          ) : null}
          <AnuChatComposer
            working={working}
            sending={send.isPending || start.isPending}
            onSend={submit}
            onStop={() => stop.mutate()}
            draft={failedDraft}
          />
        </>
      }
    >
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
        <div className="mx-auto w-full max-w-[720px] pb-4 pt-2">
          {notFound ? (
            <div role="alert" className="flex flex-col items-start gap-4 pt-16">
              <p className="text-[17px]">{t("anuChat.notFound")}</p>
              <AnuPrimaryButton onClick={() => navigate(routes.anu.root, { replace: true })}>
                {t("anuChat.newChat")}
              </AnuPrimaryButton>
            </div>
          ) : sessionId && messages.isPending ? (
            <HistorySkeleton />
          ) : sessionId && messages.isError ? (
            <div role="alert" className="flex flex-col items-start gap-3 pt-16">
              <p className="text-[17px]">{t("anuChat.loadError")}</p>
              <button
                type="button"
                onClick={() => void messages.refetch()}
                className="inline-flex h-10 items-center rounded-full bg-[var(--anu-surface)] px-4 text-[15px]"
              >
                {t("anuCommon.retry")}
              </button>
            </div>
          ) : empty && !start.isPending ? (
            <EmptyChat bot={bot} />
          ) : (
            <AnuChatMessages
              sessionId={sessionId ?? ""}
              messages={list}
              approvals={approvals}
              traits={bot.avatar}
              face={face}
              onRetry={submit}
            />
          )}
        </div>
      </div>
      <AnuDrawer />
      <Outlet />
    </ChatFrame>
  );
}

function RootSkeleton() {
  const { t } = useTranslation("anu");
  return (
    <ChatFrame
      header={
        <header className="shrink-0" style={{ paddingTop: SAFE_TOP }}>
          <div className="flex h-12 items-center gap-3 px-4">
            <span className="anu-skeleton size-6 rounded-full" />
            <span className="anu-skeleton size-7 rounded-full" />
            <span className="anu-skeleton h-4 w-24" />
          </div>
        </header>
      }
      footer={<div className="h-[52px] rounded-full bg-[var(--anu-surface)]" />}
    >
      <div role="status" aria-label={t("anuCommon.loading")} className="flex-1" />
    </ChatFrame>
  );
}

export function AnuChatPage() {
  const { sessionId } = useParams();
  const [search] = useSearchParams();
  const requestedBot = search.get("bot");
  const reopenLatest = search.get("latest") === "1";
  const fresh = search.get("new") === "1";
  const bots = useAnuBots();
  const sessions = useAnuSessions();
  const hidden = useAnuUiStore.use.hidden();

  if (sessionId) {
    return <ChatView key={sessionId} sessionId={sessionId} bot={null} />;
  }

  // The bot list may be unavailable (an older API): chat with the default.
  const botsSettled = !bots.isPending;
  if (!botsSettled || sessions.isPending) {
    return <RootSkeleton />;
  }
  const visible = (sessions.data ?? []).filter((session) => !hidden.includes(session.id));
  if (!requestedBot && !fresh && visible[0]) {
    return <Navigate to={routes.anu.chat(visible[0].id)} replace />;
  }
  if (requestedBot && reopenLatest) {
    const latest = visible.find((session) => session.botId === requestedBot);
    if (latest) {
      return <Navigate to={routes.anu.chat(latest.id)} replace />;
    }
  }
  const bot = pickBot(bots.data?.bots ?? [], requestedBot, bots.data?.defaultBotId);
  return <ChatView key={`new:${bot?.id ?? "default"}`} sessionId={null} bot={bot} />;
}
