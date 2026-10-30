/**
 * The bot sheets, mounted once for every ANU screen (spec A.3.4 and A.3.5):
 * the switcher that lists bots in their live state, the create flow
 * (describe in one sentence, a short generating moment, then the preview),
 * and the same preview in edit mode. Which one is open lives in the UI
 * store, so the drawer, the Agents page and a profile can all open them.
 */

import { BottomSheet } from "@anu/design-library";
import { Check, Mic, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { useTranslation } from "@/i18n";
import { haptic } from "@/utils/haptics";
import { cn } from "@/utils/misc";
import { routes } from "@/utils/routes";
import { useBundledAvatarComponents } from "@/utils/use-bundled-avatar-components";

import { AnuApiError, type AnuBot } from "../anu-api";
import { avatarFromSeed, botFace, orderBots, seedOf } from "../anu-bots-model";
import { useAnuUiStore } from "../anu-ui-store";
import {
  useAnuBot,
  useAnuBots,
  useCreateAnuBot,
  useCreateAnuSession,
  useDraftAnuBot,
  useUpdateAnuBot,
} from "../use-anu-queries";
import { useAnuDictation } from "../use-anu-dictation";
import { AnuAvatar } from "./anu-avatar";
import { AnuBotPreview, fieldsToInput, type AnuBotFields } from "./anu-bot-preview";
import { AnuErrorBlock, AnuPill, AnuPrimaryButton, AnuSkeletonRows, AnuTextButton } from "./anu-ui";

function useLocale(): "ar" | "en" {
  const { i18n } = useTranslation("anu");
  return i18n.language.startsWith("ar") ? "ar" : "en";
}

function AnuSheetFrame({
  open,
  title,
  children,
  tall,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  tall?: boolean;
}) {
  const closeSheet = useAnuUiStore.use.closeSheet();
  return (
    <BottomSheet.Root open={open} onOpenChange={(next) => (next ? undefined : closeSheet())}>
      <BottomSheet.Content
        data-anu-sheet
        aria-describedby={undefined}
        overlayClassName="bg-[var(--anu-scrim)]"
        className={cn(
          "mx-auto max-w-[640px] rounded-t-[20px] border-0 bg-[var(--anu-bg)] text-[var(--anu-ink)] shadow-[var(--anu-shadow)]",
          tall ? "max-h-[92dvh]" : "max-h-[80dvh]",
        )}
      >
        <div aria-hidden className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-[var(--anu-surface-2)]" />
        <BottomSheet.Title className="px-1 pb-2 text-[22px] leading-7 anu-strong text-[var(--anu-ink)]">
          {title}
        </BottomSheet.Title>
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">{children}</div>
      </BottomSheet.Content>
    </BottomSheet.Root>
  );
}

// ---------------------------------------------------------------------------
// Switcher
// ---------------------------------------------------------------------------

function BotRow({ bot, current, onPick }: { bot: AnuBot; current: boolean; onPick: () => void }) {
  const { t } = useTranslation("anu");
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-current={current || undefined}
        className="flex min-h-14 w-full items-center gap-3 rounded-[16px] px-1 py-2 text-start active:bg-[var(--anu-surface)]"
      >
        <AnuAvatar face={botFace(bot.status)} traits={bot.avatar} size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className="truncate text-[17px] leading-6 anu-strong">
            {bot.name}
          </span>
          {bot.role ? (
            <span dir="auto" className="truncate text-[13px] leading-5 text-[var(--anu-muted)]">
              {bot.role}
            </span>
          ) : null}
        </span>
        {bot.status === "waiting_for_you" ? (
          <AnuPill tone="waiting">{t("anuBots.needsYou")}</AnuPill>
        ) : bot.status === "working" ? (
          <AnuPill tone="working">{t("anuBots.working")}</AnuPill>
        ) : current ? (
          <Check aria-label={t("anuBots.current")} size={20} className="text-[var(--anu-accent)]" />
        ) : null}
      </button>
    </li>
  );
}

function SwitcherSheet({ open, currentBotId }: { open: boolean; currentBotId: string | null }) {
  const { t } = useTranslation("anu");
  const bots = useAnuBots();
  const openSheet = useAnuUiStore.use.openSheet();
  const closeSheet = useAnuUiStore.use.closeSheet();
  const hidden = useAnuUiStore.use.hidden();
  const navigate = useNavigate();
  const list = orderBots((bots.data?.bots ?? []).filter((bot) => !hidden.includes(bot.id)));
  return (
    <AnuSheetFrame open={open} title={t("anuBots.title")}>
      {bots.isPending ? (
        <AnuSkeletonRows count={3} avatar={40} height={56} label={t("anuCommon.loading")} />
      ) : bots.isError ? (
        <AnuErrorBlock message={t("anuBots.loadError")} onRetry={() => void bots.refetch()} />
      ) : (
        <ul className="flex flex-col pb-2">
          {list.map((bot) => (
            <BotRow
              key={bot.id}
              bot={bot}
              current={bot.id === currentBotId}
              onPick={() => {
                void haptic.light();
                closeSheet();
                navigate(routes.anu.newChat(bot.id) + "&latest=1");
              }}
            />
          ))}
          <li>
            <button
              type="button"
              onClick={() => openSheet({ kind: "create" })}
              className="flex min-h-14 w-full items-center gap-3 rounded-[16px] px-1 py-2 text-start text-[17px] active:bg-[var(--anu-surface)]"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-[var(--anu-surface)]">
                <Plus aria-hidden size={20} strokeWidth={1.75} />
              </span>
              {t("anuBots.newBot")}
            </button>
          </li>
        </ul>
      )}
    </AnuSheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

type TemplateKey = "researcher" | "shopper" | "writer" | "tutor" | "planner" | "inbox";

function useTemplates(): Array<{ key: TemplateKey; label: string; description: string }> {
  const { t } = useTranslation("anu");
  return [
    { key: "researcher", label: t("anuTemplates.researcher"), description: t("anuTemplates.researcherDescription") },
    { key: "shopper", label: t("anuTemplates.shopper"), description: t("anuTemplates.shopperDescription") },
    { key: "writer", label: t("anuTemplates.writer"), description: t("anuTemplates.writerDescription") },
    { key: "tutor", label: t("anuTemplates.tutor"), description: t("anuTemplates.tutorDescription") },
    { key: "planner", label: t("anuTemplates.planner"), description: t("anuTemplates.plannerDescription") },
    { key: "inbox", label: t("anuTemplates.inbox"), description: t("anuTemplates.inboxDescription") },
  ];
}

/** Assembles the face while the draft is made: body, then eyes, then colour. */
function Assembling() {
  const { t } = useTranslation("anu");
  const components = useBundledAvatarComponents();
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setStage(3);
      return;
    }
    const timer = setInterval(() => setStage((value) => Math.min(3, value + 1)), 240);
    return () => clearInterval(timer);
  }, []);
  const first = {
    bodyShape: components?.bodyShapes[0]?.id ?? "",
    eyeStyle: components?.eyeStyles[0]?.id ?? "",
    color: components?.colors[0]?.id ?? "",
  };
  const target = avatarFromSeed(seedOf("draft"), {
    bodyShapes: components?.bodyShapes.map((entry) => entry.id) ?? [],
    eyeStyles: components?.eyeStyles.map((entry) => entry.id) ?? [],
    colors: components?.colors.map((entry) => entry.id) ?? [],
  });
  const traits = target
    ? {
        bodyShape: stage >= 1 ? target.bodyShape : first.bodyShape,
        eyeStyle: stage >= 2 ? target.eyeStyle : first.eyeStyle,
        color: stage >= 3 ? target.color : first.color,
      }
    : null;
  return (
    <div role="status" className="flex flex-col items-center gap-5 py-10">
      <AnuAvatar face="thinking" traits={traits} size={120} />
      <p className="text-[17px] text-[var(--anu-ink)]">{t("anuCreate.generating")}</p>
    </div>
  );
}

type CreateStep =
  | { step: "describe" }
  | { step: "generating" }
  | { step: "preview"; fields: AnuBotFields; note: "fallback" | null };

function emptyFields(name = ""): AnuBotFields {
  return {
    name,
    role: "",
    personality: "",
    greeting: "",
    instructions: "",
    starters: [],
    avatar: null,
    modelProfile: null,
    skills: [],
  };
}

export function useSaveNewBot(): {
  save: (fields: AnuBotFields) => void;
  pending: boolean;
  error: string | null;
} {
  const { t } = useTranslation("anu");
  const locale = useLocale();
  const create = useCreateAnuBot();
  const session = useCreateAnuSession();
  const closeSheet = useAnuUiStore.use.closeSheet();
  const navigate = useNavigate();
  const failure = create.error ?? session.error;
  let error: string | null = null;
  if (failure instanceof AnuApiError && failure.code === "bot_limit") {
    error = t("anuCreate.limit");
  } else if (failure instanceof AnuApiError && failure.status === 400) {
    error = t("anuCreate.invalid");
  } else if (failure) {
    error = t("anuCreate.saveError");
  }
  return {
    pending: create.isPending || session.isPending,
    error,
    save: (fields) => {
      create.mutate(fieldsToInput(fields, locale), {
        onSuccess: (bot) => {
          session.mutate(
            { botId: bot.id },
            {
              onSuccess: (created) => {
                void haptic.success();
                closeSheet();
                navigate(routes.anu.chat(created.id), { state: { justCreated: true } });
              },
            },
          );
        },
      });
    },
  };
}

function CreateSheet({ open, prefill }: { open: boolean; prefill?: string }) {
  const { t } = useTranslation("anu");
  const locale = useLocale();
  const templates = useTemplates();
  const draft = useDraftAnuBot();
  const saver = useSaveNewBot();
  const [text, setText] = useState(prefill ?? "");
  const [state, setState] = useState<CreateStep>({ step: "describe" });
  const fieldId = useId();
  const cancelled = useRef(false);
  const dictation = useAnuDictation((spoken) => setText((current) => (current ? `${current} ${spoken}` : spoken)));
  const components = useBundledAvatarComponents();

  useEffect(() => {
    if (open) {
      setText(prefill ?? "");
      setState({ step: "describe" });
    }
  }, [open, prefill]);

  const fallbackAvatar = (name: string) =>
    avatarFromSeed(seedOf(name || text), {
      bodyShapes: components?.bodyShapes.map((entry) => entry.id) ?? [],
      eyeStyles: components?.eyeStyles.map((entry) => entry.id) ?? [],
      colors: components?.colors.map((entry) => entry.id) ?? [],
    });

  const generate = () => {
    const description = text.trim();
    if (!description) {
      return;
    }
    cancelled.current = false;
    setState({ step: "generating" });
    draft.mutate(
      { description, locale },
      {
        onSuccess: (result) => {
          if (cancelled.current) {
            return;
          }
          const showNote =
            result.source === "fallback" && result.fallbackReason !== "driver_unavailable";
          setState({
            step: "preview",
            note: showNote ? "fallback" : null,
            fields: {
              ...emptyFields(result.draft.name),
              role: result.draft.role,
              personality: result.draft.personality,
              greeting: result.draft.greeting,
              instructions: result.draft.instructions,
              starters: result.draft.starters,
              avatar: result.draft.avatar ?? fallbackAvatar(result.draft.name),
              modelProfile: result.draft.modelProfile ?? null,
              skills: result.draft.skills ?? [],
            },
          });
        },
        onError: () => {
          if (cancelled.current) {
            return;
          }
          const name = description.split(/\s+/).slice(0, 3).join(" ").slice(0, 40);
          setState({
            step: "preview",
            note: "fallback",
            fields: { ...emptyFields(name), instructions: description, avatar: fallbackAvatar(name) },
          });
        },
      },
    );
  };

  const rewrite = async (fields: AnuBotFields) => {
    const description = text.trim() || [fields.name, fields.role].filter(Boolean).join(", ");
    try {
      const result = await draft.mutateAsync({ description, locale });
      return result.draft.instructions || null;
    } catch {
      return null;
    }
  };

  return (
    <AnuSheetFrame open={open} title={state.step === "preview" ? t("anuCreate.previewTitle") : t("anuCreate.title")} tall>
      {state.step === "describe" ? (
        <div className="flex flex-col gap-4 pb-2">
          <div className="relative rounded-[20px] bg-[var(--anu-surface)]">
            <label htmlFor={fieldId} className="sr-only">
              {t("anuCreate.title")}
            </label>
            <textarea
              id={fieldId}
              dir="auto"
              rows={3}
              autoFocus
              value={text}
              maxLength={500}
              placeholder={t("anuCreate.placeholder")}
              onChange={(event) => setText(event.target.value)}
              className="block w-full resize-none bg-transparent px-4 pb-3 pt-3 pe-12 text-[17px] leading-6 outline-none placeholder:text-[var(--anu-muted)]"
            />
            {dictation.supported ? (
              <button
                type="button"
                aria-label={dictation.listening ? t("anuComposer.micStop") : t("anuComposer.mic")}
                aria-pressed={dictation.listening}
                onClick={dictation.toggle}
                className={cn(
                  "absolute bottom-2 end-2 inline-flex size-10 items-center justify-center rounded-full",
                  dictation.listening && "bg-[var(--anu-surface-2)]",
                )}
              >
                <Mic aria-hidden size={20} strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
          {dictation.denied ? (
            <p role="alert" className="text-[13px] text-[var(--anu-muted)]">
              {t("anuComposer.micDenied")}
            </p>
          ) : null}
          <ul className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <li key={template.key}>
                <button
                  type="button"
                  onClick={() => setText(template.description)}
                  className="inline-flex h-9 items-center rounded-full bg-[var(--anu-surface)] px-3.5 text-[15px]"
                >
                  {template.label}
                </button>
              </li>
            ))}
          </ul>
          <AnuPrimaryButton disabled={!text.trim()} onClick={generate} className="w-full">
            {t("anuCreate.create")}
          </AnuPrimaryButton>
          <AnuTextButton
            className="self-center"
            onClick={() =>
              setState({ step: "preview", note: null, fields: { ...emptyFields(), avatar: fallbackAvatar("") } })
            }
          >
            {t("anuCreate.writeYourself")}
          </AnuTextButton>
        </div>
      ) : state.step === "generating" ? (
        <div className="flex flex-col items-center pb-4">
          <Assembling />
          <AnuTextButton
            onClick={() => {
              cancelled.current = true;
              draft.reset();
              setState({ step: "describe" });
            }}
          >
            {t("anuCommon.cancel")}
          </AnuTextButton>
        </div>
      ) : (
        <AnuBotPreview
          initial={state.fields}
          mode="create"
          submitting={saver.pending}
          error={saver.error}
          onSubmit={saver.save}
          onRewrite={rewrite}
          note={
            state.note === "fallback" ? (
              <div role="status" className="flex flex-wrap items-center gap-2 rounded-[20px] bg-[var(--anu-waiting-tint)] px-4 py-3 text-[15px] text-[var(--anu-waiting)]">
                <span className="flex-1">{t("anuCreate.draftFailed")}</span>
                <button type="button" onClick={generate} className="underline underline-offset-2">
                  {t("anuCreate.tryAgain")}
                </button>
              </div>
            ) : undefined
          }
        />
      )}
    </AnuSheetFrame>
  );
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

function EditSheet({ open, botId }: { open: boolean; botId: string }) {
  const { t } = useTranslation("anu");
  const locale = useLocale();
  const bot = useAnuBot(botId);
  const update = useUpdateAnuBot(botId);
  const draft = useDraftAnuBot();
  const closeSheet = useAnuUiStore.use.closeSheet();
  const failure = update.error;
  const error =
    failure instanceof AnuApiError && failure.status === 400
      ? t("anuCreate.invalid")
      : failure
        ? t("anuCreate.saveError")
        : null;
  return (
    <AnuSheetFrame open={open} title={t("anuEdit.title")} tall>
      {bot.data ? (
        <AnuBotPreview
          key={bot.data.id}
          mode="edit"
          initial={{
            name: bot.data.name,
            role: bot.data.role,
            personality: bot.data.personality,
            greeting: bot.data.greeting,
            instructions: bot.data.instructions,
            starters: bot.data.starters,
            avatar: bot.data.avatar,
            modelProfile: bot.data.modelProfile,
            skills: bot.data.skills,
          }}
          submitting={update.isPending}
          error={error}
          onSubmit={(fields) => {
            const { locale: _ignored, ...patch } = fieldsToInput(fields, locale);
            update.mutate(patch, {
              onSuccess: () => {
                void haptic.success();
                closeSheet();
              },
            });
          }}
          onRewrite={async (fields) => {
            try {
              const result = await draft.mutateAsync({
                description: [fields.name, fields.role, fields.instructions].filter(Boolean).join(". ").slice(0, 500),
                locale,
              });
              return result.draft.instructions || null;
            } catch {
              return null;
            }
          }}
        />
      ) : bot.isError ? (
        <AnuErrorBlock message={t("anuProfile.notFound")} onRetry={() => void bot.refetch()} />
      ) : (
        <AnuSkeletonRows count={4} avatar={0} height={48} label={t("anuCommon.loading")} />
      )}
    </AnuSheetFrame>
  );
}

/** Mount once under the ANU layout; reads which sheet is open from the store. */
export function AnuBotSheets() {
  const sheet = useAnuUiStore.use.sheet();
  const currentBotId = useAnuUiStore.use.currentBotId();
  return (
    <>
      <SwitcherSheet open={sheet?.kind === "switcher"} currentBotId={currentBotId} />
      <CreateSheet open={sheet?.kind === "create"} prefill={sheet?.kind === "create" ? sheet.prefill : undefined} />
      {sheet?.kind === "edit" ? <EditSheet open botId={sheet.botId} /> : null}
    </>
  );
}
