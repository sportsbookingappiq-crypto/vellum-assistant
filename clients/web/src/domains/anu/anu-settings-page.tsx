/**
 * `/anu/settings` (spec A.3.13): grouped plain rows, no logo, no upsell.
 * Account, language (Arabic turns the whole layout right to left),
 * appearance, the default bot and the person's bots, notifications, when
 * the bots ask first, exporting and deleting their data, and signing out.
 */

import { BottomSheet } from "@anu/design-library";
import { Check, ChevronRight } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { useThemePreference } from "@/hooks/use-theme-preference";
import { changeLocale, LOCALE_LABELS, useTranslation, type SupportedLocale } from "@/i18n";
import { cn } from "@/utils/misc";
import { routes } from "@/utils/routes";

import { anuNotifyPermission, requestAnuNotifyPermission, type AnuNotifyPermission } from "./anu-notify";
import { orderBots } from "./anu-bots-model";
import { formatPhone } from "./anu-task-model";
import { useAnuUiStore } from "./anu-ui-store";
import { AnuAvatar } from "./components/anu-avatar";
import { AnuScreen } from "./components/anu-ui";
import {
  useAnuBots,
  useAnuMe,
  useAnuSignOut,
  useDeleteAnuAccount,
  useExportAnuData,
  useSetAnuDefaultBot,
} from "./use-anu-queries";

/** The languages the ANU screens are written in. */
export const ANU_LOCALES: readonly SupportedLocale[] = ["ar", "en"];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="px-1 pb-1.5 text-[13px] text-[var(--anu-muted)]">{title}</h2>
      <div className="overflow-hidden rounded-[20px] bg-[var(--anu-surface)]">{children}</div>
    </section>
  );
}

function Choice({
  label,
  selected,
  onSelect,
  lang,
  leading,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  lang?: string;
  leading?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      lang={lang}
      onClick={onSelect}
      className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-start text-[17px]"
    >
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? <Check aria-hidden size={20} className="text-[var(--anu-accent)]" /> : null}
    </button>
  );
}

function useNotifyPermission(): [AnuNotifyPermission | null, () => void] {
  const [state, setState] = useState<AnuNotifyPermission | null>(null);
  useEffect(() => {
    void anuNotifyPermission().then(setState);
  }, []);
  return [state, () => void requestAnuNotifyPermission().then(setState)];
}

export function AnuSettingsPage() {
  const { t, i18n } = useTranslation("anu");
  const me = useAnuMe();
  const bots = useAnuBots();
  const setDefault = useSetAnuDefaultBot();
  const signOut = useAnuSignOut();
  const exportData = useExportAnuData();
  const deleteAccount = useDeleteAnuAccount();
  const { theme, setThemePreference } = useThemePreference();
  const hidden = useAnuUiStore.use.hidden();
  const [notify, askNotify] = useNotifyPermission();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = i18n.language;
  const list = orderBots((bots.data?.bots ?? []).filter((bot) => !hidden.includes(bot.id)));
  const defaultBotId =
    bots.data?.defaultBotId ?? list.find((bot) => bot.defaultKey === "anu")?.id ?? null;

  return (
    <AnuScreen title={t("anuSettings.title")} fallback={routes.anu.root}>
      <Group title={t("anuSettings.account")}>
        <p dir="ltr" className="flex min-h-12 items-center px-4 text-start text-[17px] tabular-nums rtl:justify-end">
          {me.data ? formatPhone(me.data.phone) : <span className="anu-skeleton h-4 w-32" />}
        </p>
      </Group>

      <Group title={t("anuSettings.language")}>
        <div role="radiogroup" aria-label={t("anuSettings.language")}>
          {ANU_LOCALES.map((locale) => (
            <Choice
              key={locale}
              label={LOCALE_LABELS[locale]}
              lang={locale}
              selected={current === locale}
              onSelect={() => void changeLocale(locale)}
            />
          ))}
        </div>
      </Group>

      <Group title={t("anuSettings.appearance")}>
        <div role="radiogroup" aria-label={t("anuSettings.appearance")}>
          <Choice label={t("anuSettings.system")} selected={theme === "system"} onSelect={() => setThemePreference("system")} />
          <Choice label={t("anuSettings.light")} selected={theme === "light"} onSelect={() => setThemePreference("light")} />
          <Choice
            label={t("anuSettings.dark")}
            selected={theme === "dark" || theme === "velvet"}
            onSelect={() => setThemePreference("dark")}
          />
        </div>
      </Group>

      {list.length > 0 ? (
        <>
          <Group title={t("anuSettings.defaultBot")}>
            <div role="radiogroup" aria-label={t("anuSettings.defaultBot")}>
              {list.map((bot) => (
                <Choice
                  key={bot.id}
                  label={bot.name}
                  leading={<AnuAvatar traits={bot.avatar} size={28} />}
                  selected={bot.id === defaultBotId}
                  onSelect={() => setDefault.mutate(bot.id)}
                />
              ))}
            </div>
          </Group>
          <Group title={t("anuSettings.myBots")}>
            <ul>
              {list.map((bot) => (
                <li key={bot.id}>
                  <Link to={routes.anu.bot(bot.id)} className="flex min-h-14 items-center gap-3 px-4 py-2">
                    <AnuAvatar traits={bot.avatar} size={32} />
                    <span dir="auto" className="min-w-0 flex-1 truncate text-[17px]">
                      {bot.name}
                    </span>
                    <ChevronRight aria-hidden size={18} className="text-[var(--anu-muted)] rtl:-scale-x-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </Group>
        </>
      ) : null}

      <Group title={t("anuSettings.notifications")}>
        <div className="flex min-h-12 items-center gap-3 px-4 py-2">
          <p className="min-w-0 flex-1 text-[15px]">
            {notify === "granted"
              ? t("anuSettings.notifyOn")
              : notify === "denied"
                ? t("anuSettings.notifyBlocked")
                : notify === "unsupported"
                  ? t("anuSettings.notifyUnsupported")
                  : t("anuSettings.notifyOff")}
          </p>
          {notify === "prompt" ? (
            <button
              type="button"
              onClick={askNotify}
              className="inline-flex h-10 shrink-0 items-center rounded-full bg-[var(--anu-primary)] px-4 text-[15px] text-[var(--anu-primary-ink)]"
            >
              {t("anuNotify.turnOn")}
            </button>
          ) : null}
        </div>
      </Group>

      <Group title={t("anuSettings.whenItAsks")}>
        <p className="px-4 py-3 text-[15px] leading-6">{t("anuSettings.whenItAsksBody")}</p>
      </Group>

      <Group title={t("anuSettings.yourData")}>
        <button
          type="button"
          disabled={exportData.isPending}
          aria-busy={exportData.isPending || undefined}
          onClick={() => exportData.mutate()}
          className="flex min-h-12 w-full items-center px-4 text-start text-[17px] disabled:opacity-50"
        >
          {exportData.isPending ? t("anuSettings.exporting") : t("anuSettings.export")}
        </button>
        {exportData.isError ? (
          <p role="alert" className="px-4 pb-3 text-[13px] text-[var(--anu-failed)]">
            {t("anuSettings.exportError")}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="flex min-h-12 w-full items-center px-4 text-start text-[17px] text-[var(--anu-failed)]"
        >
          {t("anuSettings.deleteAccount")}
        </button>
      </Group>

      <button
        type="button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        className={cn(
          "mt-6 flex min-h-12 w-full items-center rounded-[20px] bg-[var(--anu-surface)] px-4 text-start text-[17px] text-[var(--anu-failed)]",
        )}
      >
        {t("anuSettings.signOut")}
      </button>

      <p className="mt-8 px-1 text-center text-[13px] leading-5 text-[var(--anu-muted)]">
        {t("identity.oneLiner")}
      </p>

      <BottomSheet.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <BottomSheet.Content
          data-anu-sheet
          aria-describedby={undefined}
          overlayClassName="bg-[var(--anu-scrim)]"
          className="mx-auto max-w-[640px] rounded-t-[20px] border-0 bg-[var(--anu-bg)] text-[var(--anu-ink)]"
        >
          <BottomSheet.Title className="text-[17px] leading-6 anu-strong text-[var(--anu-ink)]">
            {t("anuSettings.deleteConfirmTitle")}
          </BottomSheet.Title>
          <p className="mt-2 text-[15px] leading-6 text-[var(--anu-muted)]">{t("anuSettings.deleteConfirmBody")}</p>
          {deleteAccount.isError ? (
            <p role="alert" className="mt-2 text-[13px] text-[var(--anu-failed)]">
              {t("anuSettings.deleteError")}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-2">
            <button
              type="button"
              disabled={deleteAccount.isPending}
              onClick={() => deleteAccount.mutate()}
              className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--anu-failed)] text-[17px] text-white disabled:opacity-50"
            >
              {t("anuSettings.deleteForever")}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="inline-flex h-12 items-center justify-center rounded-full text-[17px]">
              {t("anuCommon.cancel")}
            </button>
          </div>
        </BottomSheet.Content>
      </BottomSheet.Root>
    </AnuScreen>
  );
}
