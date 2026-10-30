/**
 * `/anu/login`: phone number, then the six-digit code (anu/docs/api.md,
 * "Sign in"). On a wide window the right half is a night field holding a
 * run as ANU draws it, built from the same timeline component the task
 * screen uses, so the first thing a new person sees is the product itself:
 * a goal, its plan, what it found, and the question it stops to ask.
 */

import { Button, Input } from "@anu/design-library";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";
import { useTranslation } from "@/i18n";

import type { AnuStep, AnuTaskDetail } from "./anu-api";
import { anuLoginError } from "./anu-login-errors";
import { useAnuSessionStore } from "./anu-session-store";
import { formatPhone, normalizePhone } from "./anu-task-model";
import { ANU_TWO_PANE_QUERY } from "./anu-tasks-page";
import { AnuLockup, AnuMark } from "./components/anu-mark";
import { AnuStepTimeline } from "./components/anu-step-timeline";
import { useRequestAnuCode, useVerifyAnuCode } from "./use-anu-queries";

function useCountdown(expiresAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) {
    return null;
  }
  return Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function ExampleRun() {
  const { t } = useTranslation("anu");
  const sample = useMemo(() => {
    const start = Date.parse("2026-01-09T18:00:00.000Z");
    const at = (ms: number) => new Date(start + ms).toISOString();
    const task: AnuTaskDetail = {
      id: "example",
      goal: t("anuLoginPage.exampleGoal"),
      status: "awaiting_approval",
      result: null,
      confidence: null,
      createdAt: at(0),
      updatedAt: at(2900),
      startedAt: at(0),
      finishedAt: null,
      approvals: [],
    };
    const step = (
      seq: number,
      kind: AnuStep["kind"],
      title: string,
      ms: number,
      detail: unknown = {},
    ): AnuStep => ({
      id: `example-${seq}`,
      taskId: "example",
      seq,
      kind,
      title,
      detail,
      status: kind === "approval_request" ? "pending" : "done",
      createdAt: at(ms),
    });
    const steps = [
      step(1, "plan", t("anuLoginPage.examplePlanTitle"), 400, {
        steps: [t("anuLoginPage.examplePlanPick"), t("anuLoginPage.examplePlanAsk")],
      }),
      step(2, "observation", t("anuLoginPage.exampleFound"), 1700),
    ];
    return { task, steps };
  }, [t]);

  return (
    <figure
      data-ui
      data-theme="dark"
      className="w-full max-w-[460px] text-[var(--content-default)]"
    >
      <figcaption className="text-body-small-emphasised text-[var(--content-secondary)]">
        {t("anuLoginPage.exampleTitle")}
      </figcaption>
      <p className="mt-3 text-title-medium [--text-title-medium-line-height:1.3] [--text-title-medium-weight:600] text-[var(--content-emphasised)]">
        {sample.task.goal}
      </p>
      <div className="mt-6" aria-hidden>
        <AnuStepTimeline task={sample.task} steps={sample.steps} />
      </div>
      <div
        aria-hidden
        className="relative mt-6 overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--surface-lift)] p-5 ps-6 before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-[var(--system-mid-strong)]"
      >
        <p className="text-title-small [--text-title-small-line-height:24px] [--text-title-small-weight:500] text-[var(--content-emphasised)]">
          {t("anuLoginPage.exampleAsk")}
        </p>
        <div className="mt-4 flex gap-2">
          <span className="inline-flex h-10 items-center rounded-full bg-[var(--primary-base)] px-4 text-body-medium-default text-[var(--content-inset)]">
            {t("anuLoginPage.exampleApprove")}
          </span>
          <span className="inline-flex h-10 items-center rounded-full px-4 text-body-medium-default text-[var(--content-default)]">
            {t("anuLoginPage.exampleDecline")}
          </span>
        </div>
      </div>
      <p className="mt-4 text-body-medium-lighter text-[var(--content-secondary)] [--text-body-medium-lighter-line-height:20px]">
        {t("anuLoginPage.exampleCaption")}
      </p>
    </figure>
  );
}

export function AnuLoginPage() {
  const { t } = useTranslation("anu");
  const twoPane = useMediaQuery(ANU_TWO_PANE_QUERY);
  const pendingPhone = useAnuSessionStore.use.pendingPhone();
  const setPendingPhone = useAnuSessionStore.use.setPendingPhone();
  const [phoneInput, setPhoneInput] = useState(pendingPhone ?? "");
  const [code, setCode] = useState("");
  const requestCode = useRequestAnuCode();
  const verify = useVerifyAnuCode();
  const expiresAt = requestCode.data?.expiresAt ?? null;
  const secondsLeft = useCountdown(pendingPhone ? expiresAt : null);
  const expired = secondsLeft === 0;
  const devCode = requestCode.data?.devCode;

  const sendCode = (phone: string) => {
    verify.reset();
    setCode("");
    requestCode.mutate(phone, {
      onSuccess: () => setPendingPhone(phone),
    });
  };

  const onPhoneSubmit = (event: FormEvent) => {
    event.preventDefault();
    const phone = normalizePhone(phoneInput);
    if (phone) {
      sendCode(phone);
    }
  };

  const onCodeSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (pendingPhone && /^\d{6}$/.test(code)) {
      verify.mutate({ phone: pendingPhone, code });
    }
  };

  const phoneError =
    !pendingPhone && requestCode.isError ? anuLoginError(requestCode.error) : null;
  const codeError = pendingPhone
    ? verify.isError
      ? anuLoginError(verify.error)
      : requestCode.isError
        ? anuLoginError(requestCode.error)
        : null
    : null;

  const form = (
    <div className="w-full max-w-[400px]">
      <AnuLockup
        height={36}
        label={t("anuMark.label")}
        className="text-[var(--content-emphasised)]"
      />
      <h1 className="mt-10 text-[34px] font-bold leading-[1.1] tracking-[-0.025em] text-[var(--content-emphasised)]">
        {t("anuLoginPage.title")}
      </h1>
      <p className="mt-3 text-body-large-lighter text-[var(--content-secondary)] [--text-body-large-lighter-line-height:24px]">
        {t("anuLoginPage.lede")}
      </p>

      {pendingPhone ? (
        <form className="mt-8 flex flex-col gap-4" onSubmit={onCodeSubmit} noValidate>
          <p className="text-body-medium-lighter tabular-nums text-[var(--content-default)] [--text-body-medium-lighter-line-height:20px]">
            {t("anuLoginPage.codeSentTo", { phone: formatPhone(pendingPhone) })}{" "}
            <Button
              variant="link"
              type="button"
              onClick={() => {
                setPendingPhone(null);
                requestCode.reset();
                verify.reset();
              }}
            >
              {t("anuLoginPage.changeNumber")}
            </Button>
          </p>
          <Input
            label={t("anuLoginPage.codeLabel")}
            value={code}
            onChange={(event) =>
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            fullWidth
            className="h-12 text-[22px] tracking-[0.3em] tabular-nums"
            helperText={
              expired
                ? t("anuLoginPage.expired")
                : secondsLeft !== null
                  ? t("anuLoginPage.expiresIn", { time: formatClock(secondsLeft) })
                  : undefined
            }
            errorText={codeError ? t(codeError.key, codeError) : undefined}
          />
          {devCode ? (
            <p className="flex items-center gap-2 text-body-small-lighter tabular-nums text-[var(--content-secondary)]">
              {t("anuLoginPage.devCode", { code: devCode })}
              <Button variant="link" type="button" onClick={() => setCode(devCode)}>
                {t("anuLoginPage.useDevCode")}
              </Button>
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            shape="pill"
            size="large"
            fullWidth
            loading={verify.isPending}
            disabled={code.length !== 6 || expired}
          >
            {t("anuLoginPage.verify")}
          </Button>
          <Button
            variant="ghost"
            type="button"
            className="self-start"
            loading={requestCode.isPending}
            onClick={() => sendCode(pendingPhone)}
          >
            {t("anuLoginPage.resend")}
          </Button>
        </form>
      ) : (
        <form className="mt-8 flex flex-col gap-4" onSubmit={onPhoneSubmit} noValidate>
          <Input
            label={t("anuLoginPage.phoneLabel")}
            value={phoneInput}
            onChange={(event) => setPhoneInput(event.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus={twoPane}
            fullWidth
            className="h-12 text-[18px] tabular-nums"
            helperText={t("anuLoginPage.phoneHint")}
            errorText={phoneError ? t(phoneError.key, phoneError) : undefined}
          />
          <Button
            type="submit"
            variant="primary"
            shape="pill"
            size="large"
            fullWidth
            loading={requestCode.isPending}
            disabled={!normalizePhone(phoneInput)}
          >
            {t("anuLoginPage.sendCode")}
          </Button>
        </form>
      )}
    </div>
  );

  return (
    <div data-anu-root className="flex min-h-dvh bg-[var(--surface-base)] text-[var(--content-default)] max-lg:flex-col">
      <main
        className="flex min-w-0 flex-1 items-start justify-center px-5 pb-12 md:px-10 lg:items-center"
        style={{
          paddingTop:
            "calc(48px + var(--safe-area-inset-top, env(safe-area-inset-top, 0px)))",
        }}
      >
        {form}
      </main>
      <aside
        data-theme="dark"
        className="relative flex shrink-0 justify-center overflow-hidden bg-[var(--surface-base)] px-5 pb-[calc(40px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] pt-10 md:px-10 lg:w-[46%] lg:max-w-[720px] lg:items-center lg:px-12 lg:py-0"
      >
        <AnuMark
          size={twoPane ? 520 : 360}
          className="pointer-events-none absolute -end-40 -top-40 text-[var(--surface-lift)] max-lg:-end-28 max-lg:-top-28"
        />
        <div className="relative w-full max-w-[460px]">
          <ExampleRun />
        </div>
      </aside>
    </div>
  );
}
