/**
 * `/anu/new`: the centre tab. A large title, the goal field, and a few
 * examples; starting a goal opens its task.
 */

import { useNavigate } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import { AnuGoalComposer } from "./components/anu-goal-composer";
import { AnuShell } from "./components/anu-shell";

export function AnuNewGoalPage() {
  const { t } = useTranslation("anu");
  const navigate = useNavigate();
  return (
    <AnuShell>
      <main className="mx-auto w-full max-w-[640px] px-5 pb-10 pt-6 lg:pt-12">
        <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.025em] text-[var(--content-emphasised)]">
          {t("anuNewGoalPage.title")}
        </h1>
        <p className="mt-2 text-[16px] leading-6 text-[var(--content-secondary)]">
          {t("anuNewGoalPage.lede")}
        </p>
        <AnuGoalComposer
          className="mt-8"
          onCreated={(task) => navigate(routes.anu.task(task.id))}
        />
      </main>
    </AnuShell>
  );
}
