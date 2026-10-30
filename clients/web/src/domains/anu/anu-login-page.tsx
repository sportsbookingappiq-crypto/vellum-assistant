/**
 * `/anu/login` (spec A.3.2): the phone number, then the code. One field per
 * step, no mark, no marketing copy, no illustration. The code fills six
 * cells over one `one-time-code` input and submits on the sixth digit. A
 * resend unlocks after 30 seconds. Too many tries and an ended session each
 * say so in one plain line.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";

import { useTranslation } from "@/i18n";
import { cn } from "@/utils/misc";

import { anuLoginError } from "./anu-login-errors";
import { useAnuSessionStore } from "./anu-session-store";
import { formatPhone, normalizePhone, toLatinDigits } from "./anu-task-model";
import { AnuPrimaryButton, AnuTextButton, SAFE_BOTTOM, SAFE_TOP } from "./components/anu-ui";
import { useRequestAnuCode, useVerifyAnuCode } from "./use-anu-queries";

const RESEND_SECONDS = 30;

function useSecondsSince(start: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (start === null) {
      return;
    }
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [start]);
  return start === null ? Number.POSITIVE_INFINITY : Math.floor((now - start) / 1000);
}

function CodeCells({
  value,
  onChange,
  label,
  invalid,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  invalid: boolean;
  describedBy?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(true);
  return (
    <div className="relative" onClick={() => input.current?.focus()}>
      <input
        ref={input}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        value={value}
        onChange={(event) => onChange(toLatinDigits(event.target.value).replace(/\D/g, "").slice(0, 6))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        className="absolute inset-0 h-full w-full opacity-0"
      />
      <div aria-hidden dir="ltr" className="flex justify-between gap-2">
        {Array.from({ length: 6 }, (_, index) => {
          const active = focused && index === Math.min(value.length, 5);
          return (
            <span
              key={index}
              className={cn(
                "flex h-14 flex-1 items-center justify-center rounded-[14px] bg-[var(--anu-surface)] text-[22px] tabular-nums",
                active && "outline outline-2 outline-[var(--anu-accent)]",
                invalid && "text-[var(--anu-failed)]",
              )}
            >
              {value[index] ?? ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function AnuLoginPage() {
  const { t } = useTranslation("anu");
  const pendingPhone = useAnuSessionStore.use.pendingPhone();
  const setPendingPhone = useAnuSessionStore.use.setPendingPhone();
  const expired = useAnuSessionStore.use.expired();
  const [phoneInput, setPhoneInput] = useState(pendingPhone ?? "");
  const [code, setCode] = useState("");
  const [sentAt, setSentAt] = useState<number | null>(() => (pendingPhone ? Date.now() : null));
  const requestCode = useRequestAnuCode();
  const verify = useVerifyAnuCode();
  const since = useSecondsSince(sentAt);
  const resendIn = Math.max(0, RESEND_SECONDS - since);
  const devCode = requestCode.data?.devCode;

  const sendCode = (phone: string) => {
    verify.reset();
    setCode("");
    requestCode.mutate(phone, {
      onSuccess: () => {
        setPendingPhone(phone);
        setSentAt(Date.now());
      },
    });
  };

  const submitCode = (value: string) => {
    if (pendingPhone && /^\d{6}$/.test(value) && !verify.isPending) {
      verify.mutate({ phone: pendingPhone, code: value });
    }
  };

  const onPhoneSubmit = (event: FormEvent) => {
    event.preventDefault();
    const phone = normalizePhone(phoneInput);
    if (phone) {
      sendCode(phone);
    }
  };

  const phoneError = !pendingPhone && requestCode.isError ? anuLoginError(requestCode.error) : null;
  const codeError = pendingPhone
    ? verify.isError
      ? anuLoginError(verify.error)
      : requestCode.isError
        ? anuLoginError(requestCode.error)
        : null
    : null;

  return (
    <div
      data-anu-root
      className="flex min-h-dvh flex-col items-center px-4"
      style={{ paddingTop: `calc(64px + ${SAFE_TOP})`, paddingBottom: `calc(24px + ${SAFE_BOTTOM})` }}
    >
      <main className="w-full max-w-[400px]">
        {expired ? (
          <p role="status" className="mb-6 rounded-[20px] bg-[var(--anu-surface)] px-4 py-3 text-[15px]">
            {t("anuLoginPage.sessionExpired")}
          </p>
        ) : null}
        {pendingPhone ? (
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              submitCode(code);
            }}
            noValidate
          >
            <h1 className="text-[28px] leading-9 anu-strong">{t("anuLoginPage.codeTitle")}</h1>
            <p className="-mt-3 text-[15px] text-[var(--anu-muted)]">
              {t("anuLoginPage.codeSentTo", { phone: formatPhone(pendingPhone) })}
            </p>
            <CodeCells
              value={code}
              label={t("anuLoginPage.codeLabel")}
              invalid={codeError !== null}
              describedBy={codeError ? "anu-code-error" : undefined}
              onChange={(value) => {
                setCode(value);
                if (value.length === 6) {
                  submitCode(value);
                }
              }}
            />
            {codeError ? (
              <p id="anu-code-error" role="alert" className="-mt-2 text-[15px] text-[var(--anu-failed)]">
                {t(codeError.key, codeError)}
              </p>
            ) : null}
            {devCode ? (
              <AnuTextButton className="-ms-3 self-start text-[var(--anu-muted)]" onClick={() => {
                setCode(devCode);
                submitCode(devCode);
              }}>
                {t("anuLoginPage.devCode", { code: devCode })}
              </AnuTextButton>
            ) : null}
            <AnuPrimaryButton type="submit" loading={verify.isPending} disabled={code.length !== 6} className="w-full">
              {t("anuLoginPage.verify")}
            </AnuPrimaryButton>
            <div className="flex items-center justify-between">
              {resendIn > 0 ? (
                <span className="text-[15px] tabular-nums text-[var(--anu-muted)]">
                  {t("anuLoginPage.resendIn", { time: `0:${String(resendIn).padStart(2, "0")}` })}
                </span>
              ) : (
                <AnuTextButton
                  className="-ms-3"
                  disabled={requestCode.isPending}
                  onClick={() => sendCode(pendingPhone)}
                >
                  {t("anuLoginPage.resend")}
                </AnuTextButton>
              )}
              <AnuTextButton
                className="-me-3 text-[var(--anu-muted)]"
                onClick={() => {
                  setPendingPhone(null);
                  setSentAt(null);
                  requestCode.reset();
                  verify.reset();
                }}
              >
                {t("anuLoginPage.changeNumber")}
              </AnuTextButton>
            </div>
          </form>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={onPhoneSubmit} noValidate>
            <h1 className="text-[28px] leading-9 anu-strong">
              <label htmlFor="anu-phone">{t("anuLoginPage.title")}</label>
            </h1>
            <input
              id="anu-phone"
              dir="ltr"
              value={phoneInput}
              onChange={(event) => setPhoneInput(event.target.value)}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              placeholder={t("anuLoginPage.phonePlaceholder")}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? "anu-phone-error" : undefined}
              className="h-14 w-full rounded-[14px] bg-[var(--anu-surface)] px-4 text-start text-[17px] tabular-nums outline-none placeholder:text-[var(--anu-muted)] focus:outline-2 focus:outline-[var(--anu-accent)] rtl:text-end"
            />
            {phoneError ? (
              <p id="anu-phone-error" role="alert" className="-mt-2 text-[15px] text-[var(--anu-failed)]">
                {t(phoneError.key, phoneError)}
              </p>
            ) : null}
            <AnuPrimaryButton
              type="submit"
              loading={requestCode.isPending}
              disabled={!normalizePhone(phoneInput)}
              className="w-full"
            >
              {t("anuLoginPage.sendCode")}
            </AnuPrimaryButton>
          </form>
        )}
      </main>
    </div>
  );
}
