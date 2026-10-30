/**
 * `/anu/agents` (spec A.3.9): the bots at work, each with its own face.
 * Waiting for you first (with Review), then working now with what each is
 * doing and for how long, then finished with the first line of what came
 * of it; failed ones sit there with a stilled face. Each group hides when
 * empty. The last card starts a new bot. The list refreshes while visible.
 */

import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import type { AnuAgent } from "./anu-api";
import { agentFace, groupAgents } from "./anu-bots-model";
import { useAnuUiStore } from "./anu-ui-store";
import { AnuAvatar } from "./components/anu-avatar";
import { useActivityText } from "./components/anu-chat-messages";
import { AnuEmptyBlock, AnuErrorBlock, AnuScreen, AnuSkeletonRows } from "./components/anu-ui";
import { useAnuFormat } from "./use-anu-format";
import { useAnuAgents } from "./use-anu-queries";

function agentLink(agent: AnuAgent): string {
  if (agent.sessionId) {
    return routes.anu.chat(agent.sessionId);
  }
  if (agent.taskId) {
    return routes.anu.task(agent.taskId);
  }
  return routes.anu.root;
}

function AgentRow({ agent, group }: { agent: AnuAgent; group: "waiting" | "working" | "finished" }) {
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const activity = useActivityText();
  const since = agent.updatedAt ?? agent.createdAt;
  const [now] = useState(() => Date.now());
  const line =
    group === "finished"
      ? agent.status === "failed"
        ? null
        : (agent.title ?? activity(agent.activity))
      : activity(agent.activity) ?? agent.title;
  return (
    <li>
      <Link to={agentLink(agent)} className="flex min-h-[72px] items-center gap-3 py-2">
        <AnuAvatar face={agentFace(agent)} traits={agent.avatar} size={48} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className="truncate text-[17px] leading-6 anu-strong">
            {agent.name}
          </span>
          {agent.status === "failed" ? (
            <span className="text-[13px] text-[var(--anu-failed)]">{t("anuAgents.didntFinish")}</span>
          ) : line ? (
            <span dir="auto" className="truncate text-[13px] text-[var(--anu-muted)]">
              {line}
            </span>
          ) : null}
        </span>
        {group === "waiting" ? (
          <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-[var(--anu-surface)] px-4 text-[15px]">
            {t("anuAgents.review")}
          </span>
        ) : group === "working" && agent.createdAt ? (
          <span className="shrink-0 text-[13px] tabular-nums text-[var(--anu-muted)]">
            {format.duration(now - Date.parse(agent.createdAt))}
          </span>
        ) : since ? (
          <span className="shrink-0 text-[13px] text-[var(--anu-muted)]">{format.relative(since)}</span>
        ) : null}
      </Link>
    </li>
  );
}

function NewBotCard() {
  const { t } = useTranslation("anu");
  const openSheet = useAnuUiStore.use.openSheet();
  return (
    <button
      type="button"
      onClick={() => openSheet({ kind: "create" })}
      className="mt-4 flex w-full items-center gap-3 rounded-[20px] bg-[var(--anu-surface)] p-4 text-start"
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--anu-muted)] text-[var(--anu-muted)]">
        <Plus aria-hidden size={20} />
      </span>
      <span className="flex flex-col">
        <span className="text-[17px] anu-strong">{t("anuAgents.newBot")}</span>
        <span className="text-[13px] text-[var(--anu-muted)]">{t("anuAgents.newBotHint")}</span>
      </span>
    </button>
  );
}

export function AnuAgentsPage() {
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const agents = useAnuAgents();
  const groups = groupAgents(agents.data ?? []);
  const sections = [
    { key: "waiting" as const, title: t("anuAgents.waiting"), rows: groups.waiting },
    { key: "working" as const, title: t("anuAgents.working"), rows: groups.working },
    { key: "finished" as const, title: t("anuAgents.finished"), rows: groups.finished },
  ];
  const updated = agents.dataUpdatedAt ? new Date(agents.dataUpdatedAt).toISOString() : null;

  return (
    <AnuScreen title={t("anuAgents.title")} fallback={routes.anu.root}>
      {agents.isPending ? (
        <AnuSkeletonRows count={5} avatar={48} height={72} label={t("anuCommon.loading")} />
      ) : agents.isError && !agents.data ? (
        <AnuErrorBlock message={t("anuAgents.loadError")} onRetry={() => void agents.refetch()} />
      ) : (
        <>
          {agents.isError && updated ? (
            <AnuErrorBlock
              className="pt-0"
              message={t("anuAgents.staleError", { time: format.clock(updated) })}
              onRetry={() => void agents.refetch()}
            />
          ) : null}
          {(agents.data ?? []).length === 0 ? <AnuEmptyBlock message={t("anuAgents.empty")} /> : null}
          {sections.map((section) =>
            section.rows.length > 0 ? (
              <section key={section.key} aria-labelledby={`anu-agents-${section.key}`} className="pt-3">
                <h2 id={`anu-agents-${section.key}`} className="pb-1 text-[13px] text-[var(--anu-muted)]">
                  {section.title}
                </h2>
                <ul>
                  {section.rows.map((agent) => (
                    <AgentRow key={agent.id} agent={agent} group={section.key} />
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </>
      )}
      <NewBotCard />
    </AnuScreen>
  );
}
