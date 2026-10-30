/**
 * The bot preview card (spec A.3.5, Sheet 2): the generated bot with every
 * field editable in place. The avatar sits beside a reroll that changes name
 * and face together; tapping the avatar opens body, eyes and colour. The
 * instructions and the "More" options stay folded. Used by the create sheet,
 * the edit sheet, and inline in a chat when ANU drafts a bot.
 */

import { Dices, Plus, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";
import { useBundledAvatarComponents } from "@/utils/use-bundled-avatar-components";

import type { AnuAvatarTraits, AnuBotInput, AnuStarter } from "../anu-api";
import { reroll, validateBotFields, type AvatarCatalogIds } from "../anu-bots-model";
import { useAnuBotOptions } from "../use-anu-queries";
import { AnuAvatar } from "./anu-avatar";
import { AnuPrimaryButton, AnuTextButton } from "./anu-ui";

export interface AnuBotFields {
  name: string;
  role: string;
  personality: string;
  greeting: string;
  instructions: string;
  starters: AnuStarter[];
  avatar: AnuAvatarTraits | null;
  modelProfile: string | null;
  skills: string[];
}

export function fieldsToInput(fields: AnuBotFields, locale: "ar" | "en"): AnuBotInput {
  return {
    name: fields.name.trim(),
    role: fields.role.trim(),
    personality: fields.personality.trim(),
    greeting: fields.greeting.trim(),
    instructions: fields.instructions.trim(),
    starters: fields.starters
      .map((starter) => ({ label: starter.label.trim(), prompt: starter.prompt.trim() || starter.label.trim() }))
      .filter((starter) => starter.label),
    ...(fields.avatar ? { avatar: fields.avatar } : {}),
    modelProfile: fields.modelProfile,
    skills: fields.skills,
    locale,
  };
}

/** Names the reroll moves through, one literal key each so the catalog test sees them. */
function useRerollNames(): string[] {
  const { t } = useTranslation("anu");
  return [
    t("anuNames.n1"),
    t("anuNames.n2"),
    t("anuNames.n3"),
    t("anuNames.n4"),
    t("anuNames.n5"),
    t("anuNames.n6"),
    t("anuNames.n7"),
    t("anuNames.n8"),
    t("anuNames.n9"),
    t("anuNames.n10"),
    t("anuNames.n11"),
    t("anuNames.n12"),
  ];
}

function useCatalogIds(): AvatarCatalogIds {
  const components = useBundledAvatarComponents();
  return {
    bodyShapes: components?.bodyShapes.map((shape) => shape.id) ?? [],
    eyeStyles: components?.eyeStyles.map((eyes) => eyes.id) ?? [],
    colors: components?.colors.map((color) => color.id) ?? [],
  };
}

/** A field that reads as text and edits in place. */
function InlineField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  multiline,
  error,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength: number;
  multiline?: boolean;
  error?: string;
  className?: string;
}) {
  const id = useId();
  const shared = cn(
    "w-full resize-none rounded-[12px] bg-transparent px-2 py-1.5 -mx-2 outline-none transition-colors duration-[140ms] focus:bg-[var(--anu-surface)] placeholder:text-[var(--anu-muted)]",
    className,
  );
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          dir="auto"
          rows={2}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
          className={shared}
        />
      ) : (
        <input
          id={id}
          dir="auto"
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value.replace(/\n/g, " "))}
          className={shared}
        />
      )}
      {error ? (
        <p role="alert" className="mt-1 text-[13px] text-[var(--anu-failed)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-[20px] bg-[var(--anu-surface)] px-4 py-1">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[15px] text-[var(--anu-ink)] marker:hidden">
        {title}
        <Plus aria-hidden size={18} strokeWidth={1.75} className="transition-transform duration-[140ms] group-open:rotate-45" />
      </summary>
      <div className="pb-3">{children}</div>
    </details>
  );
}

function AvatarPicker({
  value,
  onChange,
}: {
  value: AnuAvatarTraits | null;
  onChange: (value: AnuAvatarTraits) => void;
}) {
  const { t } = useTranslation("anu");
  const components = useBundledAvatarComponents();
  if (!components) {
    return null;
  }
  const base: AnuAvatarTraits = value ?? {
    bodyShape: components.bodyShapes[0]?.id ?? "",
    eyeStyle: components.eyeStyles[0]?.id ?? "",
    color: components.colors[0]?.id ?? "",
  };
  const rows: Array<{ key: keyof AnuAvatarTraits; title: string; ids: string[] }> = [
    { key: "bodyShape", title: t("anuBotPreview.pickBody"), ids: components.bodyShapes.map((entry) => entry.id) },
    { key: "eyeStyle", title: t("anuBotPreview.pickEyes"), ids: components.eyeStyles.map((entry) => entry.id) },
    { key: "color", title: t("anuBotPreview.pickColor"), ids: components.colors.map((entry) => entry.id) },
  ];
  return (
    <div className="flex flex-col gap-3" data-testid="anu-avatar-picker">
      {rows.map((row) => (
        <fieldset key={row.key}>
          <legend className="mb-1.5 text-[13px] text-[var(--anu-muted)]">{row.title}</legend>
          <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
            {row.ids.map((id, index) => {
              const traits = { ...base, [row.key]: id };
              const selected = base[row.key] === id;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={t("anuBotPreview.option", { index: index + 1, count: row.ids.length })}
                  onClick={() => onChange(traits)}
                  className={cn(
                    "flex size-12 shrink-0 items-center justify-center rounded-full",
                    selected && "bg-[var(--anu-surface-2)]",
                  )}
                >
                  <AnuAvatar traits={traits} size={36} />
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

interface AnuBotPreviewProps {
  initial: AnuBotFields;
  mode: "create" | "edit";
  /** Shown above the card when the draft fell back (spec A.3.5, errors). */
  note?: ReactNode;
  submitting: boolean;
  /** A server error to show above the button, already in plain words. */
  error?: string | null;
  onSubmit: (fields: AnuBotFields) => void;
  /** Redrafts the instructions only; resolves to the new text. */
  onRewrite?: (fields: AnuBotFields) => Promise<string | null>;
  /** Inline chat card: no surrounding padding, the face a bit smaller. */
  compact?: boolean;
}

export function AnuBotPreview({
  initial,
  mode,
  note,
  submitting,
  error,
  onSubmit,
  onRewrite,
  compact,
}: AnuBotPreviewProps) {
  const { t } = useTranslation("anu");
  const names = useRerollNames();
  const catalog = useCatalogIds();
  const options = useAnuBotOptions();
  const [fields, setFields] = useState<AnuBotFields>(initial);
  const [turn, setTurn] = useState(0);
  const [picking, setPicking] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const set = <K extends keyof AnuBotFields>(key: K, value: AnuBotFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));
  const errors = validateBotFields(fields);
  const modelProfiles = options.data?.modelProfiles ?? [];
  const skills = options.data?.skills ?? [];

  const submit = () => {
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      return;
    }
    onSubmit(fields);
  };

  const fieldError = (key: keyof typeof errors) => {
    if (!showErrors || !errors[key]) {
      return undefined;
    }
    return errors[key] === "required" ? t("anuBotPreview.nameRequired") : t("anuBotPreview.tooLong");
  };

  return (
    <div className={cn("flex flex-col gap-4", !compact && "pb-2")} data-testid="anu-bot-preview">
      {note}
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t("anuBotPreview.changeFace")}
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
          className="rounded-full"
        >
          <AnuAvatar face="rest" traits={fields.avatar} size={compact ? 72 : 96} />
        </button>
        <button
          type="button"
          aria-label={t("anuBotPreview.reroll")}
          title={t("anuBotPreview.reroll")}
          onClick={() => {
            const next = reroll({ name: fields.name, avatar: fields.avatar }, names, catalog, turn);
            setTurn((value) => value + 1);
            setFields((current) => ({ ...current, name: next.name, avatar: next.avatar ?? current.avatar }));
          }}
          className="inline-flex size-11 items-center justify-center rounded-full bg-[var(--anu-surface)] text-[var(--anu-ink)]"
        >
          <Dices aria-hidden size={20} strokeWidth={1.75} />
        </button>
      </div>
      {picking ? <AvatarPicker value={fields.avatar} onChange={(value) => set("avatar", value)} /> : null}

      <div className="flex flex-col gap-1">
        <InlineField
          label={t("anuBotPreview.name")}
          value={fields.name}
          onChange={(value) => set("name", value)}
          placeholder={t("anuBotPreview.name")}
          maxLength={40}
          error={fieldError("name")}
          className="text-[22px] leading-7 anu-strong"
        />
        <InlineField
          label={t("anuBotPreview.role")}
          value={fields.role}
          onChange={(value) => set("role", value)}
          placeholder={t("anuBotPreview.rolePlaceholder")}
          maxLength={120}
          error={fieldError("role")}
          className="text-[15px] text-[var(--anu-muted)]"
        />
      </div>

      <div>
        <p className="text-[13px] text-[var(--anu-muted)]">{t("anuBotPreview.greeting")}</p>
        <InlineField
          label={t("anuBotPreview.greeting")}
          value={fields.greeting}
          onChange={(value) => set("greeting", value)}
          maxLength={280}
          multiline
          error={fieldError("greeting")}
          className="text-[15px] leading-6"
        />
      </div>

      <div>
        <p className="mb-1.5 text-[13px] text-[var(--anu-muted)]">{t("anuBotPreview.starters")}</p>
        <ul className="flex flex-wrap gap-2">
          {fields.starters.map((starter, index) => (
            <li key={index} className="flex h-9 items-center gap-1 rounded-full bg-[var(--anu-surface)] ps-3 pe-1">
              <input
                dir="auto"
                aria-label={t("anuBotPreview.starterLabel", { index: index + 1 })}
                value={starter.label}
                maxLength={60}
                size={Math.max(6, starter.label.length)}
                onChange={(event) =>
                  set(
                    "starters",
                    fields.starters.map((entry, at) =>
                      at === index
                        ? {
                            label: event.target.value,
                            prompt: entry.prompt === entry.label ? event.target.value : entry.prompt,
                          }
                        : entry,
                    ),
                  )
                }
                className="min-w-0 bg-transparent text-[15px] outline-none"
              />
              <button
                type="button"
                aria-label={t("anuBotPreview.removeStarter", { label: starter.label })}
                onClick={() => set("starters", fields.starters.filter((_, at) => at !== index))}
                className="inline-flex size-7 items-center justify-center rounded-full text-[var(--anu-muted)]"
              >
                <X aria-hidden size={14} />
              </button>
            </li>
          ))}
          {fields.starters.length < 3 ? (
            <li>
              <button
                type="button"
                onClick={() => set("starters", [...fields.starters, { label: "", prompt: "" }])}
                className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[15px] text-[var(--anu-muted)]"
              >
                <Plus aria-hidden size={16} />
                {t("anuBotPreview.addStarter")}
              </button>
            </li>
          ) : null}
        </ul>
      </div>

      <Fold title={t("anuBotPreview.instructions")}>
        <InlineField
          label={t("anuBotPreview.instructions")}
          value={fields.instructions}
          onChange={(value) => set("instructions", value)}
          maxLength={4000}
          multiline
          error={fieldError("instructions")}
          className="min-h-32 text-[15px] leading-6"
        />
        {onRewrite ? (
          <AnuTextButton
            disabled={rewriting}
            aria-busy={rewriting || undefined}
            onClick={() => {
              setRewriting(true);
              void onRewrite(fields)
                .then((text) => {
                  if (text) {
                    set("instructions", text);
                  }
                })
                .finally(() => setRewriting(false));
            }}
            className="-ms-3 mt-1"
          >
            {rewriting ? t("anuBotPreview.rewriting") : t("anuBotPreview.rewrite")}
          </AnuTextButton>
        ) : null}
      </Fold>

      {modelProfiles.length > 1 || skills.length > 0 ? (
        <Fold title={t("anuBotPreview.more")}>
          {modelProfiles.length > 1 ? (
            <label className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
              {t("anuBotPreview.model")}
              <select
                value={fields.modelProfile ?? ""}
                onChange={(event) => set("modelProfile", event.target.value || null)}
                className="rounded-full bg-[var(--anu-surface-2)] px-3 py-1.5 text-[15px]"
              >
                <option value="">{t("anuBotPreview.modelDefault")}</option>
                {modelProfiles.map((profile) => (
                  <option key={profile} value={profile}>
                    {profile}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {skills.map((skill) => (
            <label key={skill.id} className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
              {skill.label}
              <input
                type="checkbox"
                role="switch"
                checked={fields.skills.includes(skill.id)}
                onChange={(event) =>
                  set(
                    "skills",
                    event.target.checked
                      ? [...fields.skills, skill.id]
                      : fields.skills.filter((id) => id !== skill.id),
                  )
                }
                className="size-5 accent-[var(--anu-accent)]"
              />
            </label>
          ))}
        </Fold>
      ) : null}

      {error ? (
        <p role="alert" className="text-[15px] text-[var(--anu-failed)]">
          {error}
        </p>
      ) : null}
      <AnuPrimaryButton loading={submitting} disabled={submitting} onClick={submit} className="w-full">
        {mode === "create" ? t("anuBotPreview.start") : t("anuBotPreview.save")}
      </AnuPrimaryButton>
    </div>
  );
}
