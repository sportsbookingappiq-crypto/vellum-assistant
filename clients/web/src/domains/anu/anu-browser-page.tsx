/**
 * The Browser window (spec A.3.11), `/anu/chat/:sessionId/browser` and
 * `/anu/tasks/:taskId/browser`: full screen over the chat or task it came
 * from, never a tab. The top bar has close, the site the bot is on, Live
 * while it still works, and a way to open the page outside the app.
 */

import { ExternalLink } from "lucide-react";
import { useCallback, useState } from "react";
import { useParams } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import { isAnuTaskFinal } from "./anu-api";
import { turnProgress } from "./anu-bots-model";
import { urlHost } from "./anu-files-model";
import { AnuBrowserView } from "./components/anu-browser-view";
import { useActivityText } from "./components/anu-chat-messages";
import { AnuPill, AnuScreen } from "./components/anu-ui";
import { useAnuMessages, useAnuSession, useAnuSteps, useAnuTask } from "./use-anu-queries";

function BrowserWindow({
  scope,
  live,
  caption,
  fallback,
}: {
  scope: { kind: "tasks" | "sessions"; id: string };
  live: boolean;
  caption: string | null;
  fallback: string;
}) {
  const { t } = useTranslation("anu");
  const [page, setPage] = useState<string | null>(null);
  const onPage = useCallback((next: { url: string | null }) => setPage(next.url), []);
  return (
    <AnuScreen
      overlay
      fallback={fallback}
      title={
        <span className="flex flex-col">
          <span className="truncate text-[17px] leading-6">{t("anuBrowser.title")}</span>
          {page ? (
            <span dir="ltr" className="truncate text-start text-[13px] font-normal text-[var(--anu-muted)]">
              {urlHost(page)}
            </span>
          ) : null}
        </span>
      }
      trailing={
        <>
          {live ? <AnuPill tone="working">{t("anuBrowser.live")}</AnuPill> : null}
          {page ? (
            <a
              href={page}
              target="_blank"
              rel="noreferrer"
              aria-label={t("anuBrowser.openOutside")}
              className="inline-flex size-11 items-center justify-center rounded-full"
            >
              <ExternalLink aria-hidden size={20} strokeWidth={1.75} />
            </a>
          ) : null}
        </>
      }
    >
      <AnuBrowserView scope={scope} live={live} caption={caption} onPage={onPage} />
    </AnuScreen>
  );
}

export function AnuTaskBrowserPage() {
  const { taskId = "" } = useParams();
  const activity = useActivityText();
  const task = useAnuTask(taskId);
  const steps = useAnuSteps(taskId);
  const live = task.data ? !isAnuTaskFinal(task.data.status) : false;
  const latest = (steps.data ?? []).at(-1);
  return (
    <BrowserWindow
      scope={{ kind: "tasks", id: taskId }}
      live={live}
      caption={live ? activity(latest?.title) : null}
      fallback={routes.anu.task(taskId)}
    />
  );
}

export function AnuSessionBrowserPage() {
  const { sessionId = "" } = useParams();
  const activity = useActivityText();
  const session = useAnuSession(sessionId);
  const messages = useAnuMessages(sessionId);
  const live = session.data?.status === "working";
  return (
    <BrowserWindow
      scope={{ kind: "sessions", id: sessionId }}
      live={live}
      caption={live ? activity(turnProgress(messages.data ?? []).caption) : null}
      fallback={routes.anu.chat(sessionId)}
    />
  );
}
