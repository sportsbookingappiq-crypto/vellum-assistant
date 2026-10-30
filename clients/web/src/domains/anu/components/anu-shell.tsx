/**
 * The frame of the signed-in ANU screens, built like a phone app rather than
 * a web console: each screen sets its own large title, and the navigation is
 * a tab bar at the thumb, with a new goal as its centre action. On a wide
 * window the same three destinations stand in a narrow rail instead.
 */

import { ListTodo, Plus, Settings } from "lucide-react";
import { type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";
import { routes } from "@/utils/routes";

import { AnuMark } from "./anu-mark";

interface AnuShellProps {
  children: ReactNode;
}

export function AnuShell({ children }: AnuShellProps) {
  const { t } = useTranslation("anu");
  const tabs = [
    { to: routes.anu.root, label: t("anuShell.tasks"), icon: ListTodo, end: false },
    { to: routes.anu.new, label: t("anuShell.newGoal"), icon: Plus, end: true },
    { to: routes.anu.settings, label: t("anuShell.settings"), icon: Settings, end: true },
  ];
  const { pathname } = useLocation();
  const onTasks =
    pathname === routes.anu.root || pathname.startsWith(`${routes.anu.root}/tasks`);

  return (
    <div
      data-anu-root
      className="flex min-h-dvh bg-[var(--surface-base)] text-[var(--content-default)] max-lg:flex-col lg:h-dvh"
    >
      <nav
        aria-label={t("anuShell.navigation")}
        className="flex w-16 shrink-0 flex-col items-center gap-2 border-e border-[var(--border-base)] py-5 max-lg:hidden"
      >
        <AnuMark size={26} label={t("anuMark.label")} className="mb-6 text-[var(--content-emphasised)]" />
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            aria-label={label}
            title={label}
            className={({ isActive }) =>
              cn(
                "flex size-11 items-center justify-center rounded-full outline-none keyboard-focus:ring-2 keyboard-focus:ring-[var(--ring)]",
                (to === routes.anu.root ? onTasks : isActive)
                  ? "bg-[var(--primary-base)] text-[var(--content-inset)]"
                  : "text-[var(--content-secondary)] hover:bg-[var(--surface-hover)]",
              )
            }
          >
            <Icon aria-hidden size={20} strokeWidth={1.75} />
          </NavLink>
        ))}
      </nav>

      <div
        className="flex min-h-0 min-w-0 flex-1"
        style={{ paddingTop: "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))" }}
      >
        {children}
      </div>

      <nav
        aria-label={t("anuShell.navigation")}
        className="sticky bottom-0 z-10 grid grid-cols-3 border-t border-[var(--border-base)] bg-[var(--surface-base)] lg:hidden"
        style={{ paddingBottom: "var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))" }}
      >
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => {
              const active = to === routes.anu.root ? onTasks : isActive;
              return cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium outline-none keyboard-focus:ring-2 keyboard-focus:ring-[var(--ring)]",
                active ? "text-[var(--content-emphasised)]" : "text-[var(--content-tertiary)]",
              );
            }}
          >
            {to === routes.anu.new ? (
              <span className="flex size-9 items-center justify-center rounded-full bg-[var(--primary-base)] text-[var(--content-inset)]">
                <Icon aria-hidden size={20} strokeWidth={2} />
              </span>
            ) : (
              <Icon aria-hidden size={22} strokeWidth={1.75} />
            )}
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
