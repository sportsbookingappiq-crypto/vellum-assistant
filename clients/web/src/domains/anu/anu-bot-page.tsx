/**
 * `/anu/bots/:botId` (spec A.3.6): one bot's profile. Its face, name and
 * role; how it greets; what it is told (four lines, then More); its recent
 * chats; and Edit, Duplicate and Delete at the end. ANU itself can be
 * edited but not deleted. A delete hides the bot at once and can be undone
 * for five seconds; its chats stay.
 */

import { BottomSheet } from "@anu/design-library";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import { AnuApiError } from "./anu-api";
import { botFace } from "./anu-bots-model";
import { useAnuUiStore } from "./anu-ui-store";
import { AnuAvatar } from "./components/anu-avatar";
import { AnuPrimaryButton, AnuScreen, AnuTextButton } from "./components/anu-ui";
import { useAnuFormat } from "./use-anu-format";
import {
  useAnuBot,
  useAnuBotOptions,
  useAnuSessions,
  useDeleteAnuBot,
  useDuplicateAnuBot,
} from "./use-anu-queries";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="pb-1 text-[13px] text-[var(--anu-muted)]">{title}</h2>
      {children}
    </section>
  );
}

export function AnuBotPage() {
  const { t } = useTranslation("anu");
  const { botId = "" } = useParams();
  const navigate = useNavigate();
  const format = useAnuFormat();
  const bot = useAnuBot(botId);
  const options = useAnuBotOptions();
  const sessions = useAnuSessions(botId);
  const duplicate = useDuplicateAnuBot();
  const deleteBot = useDeleteAnuBot();
  const openSheet = useAnuUiStore.use.openSheet();
  const scheduleDelete = useAnuUiStore.use.scheduleDelete();
  const hidden = useAnuUiStore.use.hidden();
  const [confirming, setConfirming] = useState(false);
  const [moreInstructions, setMoreInstructions] = useState(false);

  const notFound =
    hidden.includes(botId) || (bot.error instanceof AnuApiError && bot.error.status === 404);

  if (notFound) {
    return (
      <AnuScreen title={t("anuProfile.title")} fallback={routes.anu.root}>
        <p role="alert" className="pt-10 text-[17px]">
          {t("anuProfile.notFound")}
        </p>
      </AnuScreen>
    );
  }

  if (!bot.data) {
    return (
      <AnuScreen title={t("anuProfile.title")} fallback={routes.anu.root}>
        {bot.isError ? (
          <p role="alert" className="pt-10 text-[17px]">
            {t("anuProfile.loadError")}
          </p>
        ) : (
          <div role="status" aria-label={t("anuCommon.loading")} className="flex flex-col items-center gap-3 pt-6">
            <span className="anu-skeleton size-24 rounded-full" />
            <span className="anu-skeleton h-6 w-40" />
            <span className="anu-skeleton h-4 w-56" />
            <span className="anu-skeleton mt-6 h-20 w-full rounded-[20px]" />
          </div>
        )}
      </AnuScreen>
    );
  }

  const data = bot.data;
  const recent = (sessions.data ?? []).filter((session) => !hidden.includes(session.id)).slice(0, 3);
  const showModel = (options.data?.modelProfiles.length ?? 0) > 1;
  const skillLabels = (options.data?.skills ?? [])
    .filter((skill) => data.skills.includes(skill.id))
    .map((skill) => skill.label);

  return (
    <AnuScreen title={data.name} fallback={routes.anu.root} hideTitle>
      <div className="flex flex-col items-center pt-2 text-center">
        <AnuAvatar face={botFace(data.status)} traits={data.avatar} size={96} />
        <p dir="auto" aria-hidden className="mt-3 text-[22px] leading-7 anu-strong">
          {data.name}
        </p>
        {data.role ? (
          <p dir="auto" className="mt-1 text-[15px] text-[var(--anu-muted)]">
            {data.role}
          </p>
        ) : null}
        <AnuPrimaryButton className="mt-5" onClick={() => navigate(routes.anu.newChat(data.id))}>
          {t("anuProfile.chat")}
        </AnuPrimaryButton>
      </div>

      {data.greeting ? (
        <Section title={t("anuProfile.startsWith")}>
          <p dir="auto" className="text-[15px] leading-6">
            {data.greeting}
          </p>
        </Section>
      ) : null}

      {data.instructions || data.personality ? (
        <Section title={t("anuProfile.instructions")}>
          {data.personality ? (
            <p dir="auto" className="mb-1 text-[15px] text-[var(--anu-muted)]">
              {data.personality}
            </p>
          ) : null}
          <p
            dir="auto"
            className={moreInstructions ? "whitespace-pre-wrap text-[15px] leading-6" : "line-clamp-4 whitespace-pre-wrap text-[15px] leading-6"}
          >
            {data.instructions}
          </p>
          {!moreInstructions && data.instructions.split("\n").length + data.instructions.length / 80 > 4 ? (
            <AnuTextButton className="-ms-3" onClick={() => setMoreInstructions(true)}>
              {t("anuProfile.more")}
            </AnuTextButton>
          ) : null}
        </Section>
      ) : null}

      {showModel ? (
        <Section title={t("anuProfile.model")}>
          <p className="text-[15px]">{data.modelProfile ?? t("anuBotPreview.modelDefault")}</p>
        </Section>
      ) : null}

      {skillLabels.length > 0 ? (
        <Section title={t("anuProfile.skills")}>
          <p className="text-[15px]">{skillLabels.join(", ")}</p>
        </Section>
      ) : null}

      <Section title={t("anuProfile.recentChats")}>
        {sessions.isPending ? (
          <span className="anu-skeleton block h-12 w-full" />
        ) : recent.length === 0 ? (
          <p className="text-[15px] text-[var(--anu-muted)]">{t("anuProfile.noChats")}</p>
        ) : (
          <ul>
            {recent.map((session) => (
              <li key={session.id}>
                <Link to={routes.anu.chat(session.id)} className="flex min-h-12 items-center justify-between gap-3 py-2">
                  <span dir="auto" className="min-w-0 truncate text-[15px]">
                    {session.title ?? t("anuChat.untitled")}
                  </span>
                  <span className="shrink-0 text-[13px] text-[var(--anu-muted)]">
                    {format.relative(session.updatedAt ?? session.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {recent.length > 0 ? (
          <Link to={routes.anu.chatsOfBot(data.id)} className="inline-flex min-h-11 items-center text-[15px] text-[var(--anu-accent)]">
            {t("anuProfile.seeAll")}
          </Link>
        ) : null}
      </Section>

      <div className="mt-8 flex flex-col items-start border-t border-[var(--anu-surface)] pt-3">
        <AnuTextButton className="-ms-3" onClick={() => openSheet({ kind: "edit", botId: data.id })}>
          {t("anuProfile.edit")}
        </AnuTextButton>
        <AnuTextButton
          className="-ms-3"
          disabled={duplicate.isPending}
          onClick={() =>
            duplicate.mutate(data.id, {
              onSuccess: (copy) => navigate(routes.anu.bot(copy.id)),
            })
          }
        >
          {t("anuProfile.duplicate")}
        </AnuTextButton>
        {duplicate.error instanceof AnuApiError && duplicate.error.code === "bot_limit" ? (
          <p role="alert" className="text-[13px] text-[var(--anu-failed)]">
            {t("anuCreate.limit")}
          </p>
        ) : null}
        {data.deletable && data.defaultKey !== "anu" ? (
          <AnuTextButton danger className="-ms-3" onClick={() => setConfirming(true)}>
            {t("anuProfile.delete")}
          </AnuTextButton>
        ) : null}
      </div>

      <BottomSheet.Root open={confirming} onOpenChange={setConfirming}>
        <BottomSheet.Content
          data-anu-sheet
          aria-describedby={undefined}
          overlayClassName="bg-[var(--anu-scrim)]"
          className="mx-auto max-w-[640px] rounded-t-[20px] border-0 bg-[var(--anu-bg)] text-[var(--anu-ink)]"
        >
          <BottomSheet.Title className="text-[17px] leading-6 anu-strong text-[var(--anu-ink)]">
            {t("anuProfile.deleteConfirm")}
          </BottomSheet.Title>
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                scheduleDelete({
                  id: data.id,
                  label: t("anuUndo.botDeleted", { name: data.name }),
                  commit: () =>
                    deleteBot.mutate(data.id, {
                      onError: () => useAnuUiStore.getState().unhide(data.id),
                    }),
                });
                navigate(routes.anu.root, { replace: true });
              }}
              className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--anu-failed)] text-[17px] text-white"
            >
              {t("anuProfile.delete")}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="inline-flex h-12 items-center justify-center rounded-full text-[17px]">
              {t("anuCommon.cancel")}
            </button>
          </div>
        </BottomSheet.Content>
      </BottomSheet.Root>
    </AnuScreen>
  );
}
