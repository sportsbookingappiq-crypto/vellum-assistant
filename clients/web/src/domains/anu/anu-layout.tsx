/**
 * Root of the `/anu/*` branch. It owns the ANU query cache and the session:
 * the stored token is read once per launch, a signed-out visitor is sent to
 * `/anu/login`, and a signed-in one is kept off it. Nothing here touches the
 * platform session or the active assistant.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import { anuQueryClient } from "./anu-query-client";
import { useAnuSessionStore } from "./anu-session-store";
import { AnuMark } from "./components/anu-mark";

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
    return (
      <div
        role="status"
        data-anu-root
        aria-label={t("anuLayout.restoring")}
        className="flex min-h-dvh items-center justify-center bg-[var(--surface-base)] text-[var(--content-emphasised)]"
      >
        <AnuMark size={40} />
      </div>
    );
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
    </QueryClientProvider>
  );
}
