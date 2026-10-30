/**
 * `/anu/settings`: who is signed in, the language the app speaks (Arabic
 * turns the whole layout right to left), and the way out.
 */

import { Button } from "@anu/design-library";
import { Check } from "lucide-react";

import { changeLocale, LOCALE_LABELS, useTranslation, type SupportedLocale } from "@/i18n";
import { cn } from "@/utils/misc";

import { formatPhone } from "./anu-task-model";
import { AnuShell } from "./components/anu-shell";
import { useAnuMe, useAnuSignOut } from "./use-anu-queries";

/** The languages the ANU screens are written in. */
export const ANU_LOCALES: readonly SupportedLocale[] = ["en", "ar"];

export function AnuSettingsPage() {
  const { t, i18n } = useTranslation("anu");
  const me = useAnuMe();
  const signOut = useAnuSignOut();
  const current = i18n.language;

  return (
    <AnuShell>
      <main className="mx-auto w-full max-w-[640px] px-5 pb-10 pt-6 lg:pt-12">
        <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.025em] text-[var(--content-emphasised)]">
          {t("anuSettingsPage.title")}
        </h1>

        <section aria-labelledby="anu-settings-account" className="mt-9">
          <h2 id="anu-settings-account" className="text-[14px] font-semibold text-[var(--content-secondary)]">
            {t("anuSettingsPage.account")}
          </h2>
          <p dir="ltr" className="mt-2 text-start text-[20px] font-medium tabular-nums text-[var(--content-emphasised)]">
            {me.data ? formatPhone(me.data.phone) : " "}
          </p>
        </section>

        <section aria-labelledby="anu-settings-language" className="mt-9">
          <h2 id="anu-settings-language" className="text-[14px] font-semibold text-[var(--content-secondary)]">
            {t("anuSettingsPage.language")}
          </h2>
          <ul role="radiogroup" aria-labelledby="anu-settings-language" className="mt-1">
            {ANU_LOCALES.map((locale) => {
              const selected = current === locale;
              return (
                <li key={locale} className="border-b border-[var(--border-hover)] last:border-b-0">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    lang={locale}
                    onClick={() => void changeLocale(locale)}
                    className={cn(
                      "flex min-h-13 w-full items-center justify-between py-3.5 text-start text-[17px] outline-none keyboard-focus:ring-2 keyboard-focus:ring-[var(--ring)]",
                      selected ? "font-medium text-[var(--content-emphasised)]" : "text-[var(--content-default)]",
                    )}
                  >
                    {LOCALE_LABELS[locale]}
                    {selected ? <Check aria-hidden size={20} className="text-[var(--content-emphasised)]" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <Button
          variant="dangerOutline"
          shape="pill"
          size="large"
          className="mt-12 px-6"
          loading={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          {t("anuShell.signOut")}
        </Button>
      </main>
    </AnuShell>
  );
}
