/**
 * Root of the `/anu/*` branch. It owns the ANU query cache and the session:
 * the stored token is read once per launch, a signed-out visitor is sent to
 * `/anu/login`, and a signed-in one is kept off it. A cold start opens on
 * the splash (white, the black mark and ANU). The bot sheets, the undo bar
 * and the background question banners are mounted here once, for every
 * screen. Nothing here touches the platform session or the active assistant.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import { newApprovalIds, postAnuNotification } from "./anu-notify";
import { anuQueryClient } from "./anu-query-client";
import { useAnuSessionStore } from "./anu-session-store";
import { AnuBotSheets } from "./components/anu-bot-sheets";
import { AnuSplash } from "./components/anu-splash";
import { AnuUndoToast } from "./components/anu-undo-toast";
import { useAnuSessions } from "./use-anu-queries";

/** Raises a banner when a bot asks something while the app is hidden. */
function AnuBackgroundQuestions() {
  const { t } = useTranslation("anu");
  const sessions = useAnuSessions();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!sessions.data) {
      return;
    }
    if (seen.current === null) {
      // What was already open at launch is not news.
      seen.current = new Set();
      newApprovalIds(seen.current, sessions.data);
      return;
    }
    const fresh = newApprovalIds(seen.current, sessions.data);
    if (document.visibilityState !== "hidden") {
      return;
    }
    for (const { sessionId, approvalId } of fresh) {
      const session = sessions.data.find((entry) => entry.id === sessionId);
      const approval = session?.approvals.find((entry) => entry.id === approvalId);
      if (!session || !approval) {
        continue;
      }
      void postAnuNotification({
        title: t("anuNotify.asksTitle", { name: session.agentName ?? t("anuNotify.yourBot") }),
        body: approval.prompt,
        path: routes.anu.chat(sessionId),
      });
    }
  }, [sessions.data, t]);
  return null;
}

export function AnuLayout() {
  const { t } = useTranslation("anu");
  const status = useAnuSessionStore.use.status();
  const restore = useAnuSessionStore.use.restore();
  const location = useLocation();
  const onLogin = location.pathname === routes.anu.login;

  useEffect(() => {
    void restore(t("anuLayout.unlockReason"));
  }, [restore, t]);

  useEffect(() => {
    if (status === "signed-out") {
      anuQueryClient.clear();
    }
  }, [status]);

  if (status === "restoring") {
    return <AnuSplash ready={false} />;
  }
  if (status === "signed-out" && !onLogin) {
    return <Navigate to={routes.anu.login} replace />;
  }
  if (status === "signed-in" && onLogin) {
    return <Navigate to={routes.anu.root} replace />;
  }

  return (
    <QueryClientProvider client={anuQueryClient}>
      <Outlet />
      {status === "signed-in" ? (
        <>
          <AnuBotSheets />
          <AnuUndoToast />
          <AnuBackgroundQuestions />
        </>
      ) : null}
      <AnuSplash ready />
    </QueryClientProvider>
  );
}
