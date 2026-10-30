/**
 * Telling the person a bot needs them while the app is in the background
 * (spec A.4, "Approval while in background"). The permission is asked only
 * after the person says yes to the in-app prompt, never at launch. Banners
 * are posted locally while the app is alive: a native local notification in
 * the phone shells, a system Notification in a browser. The banner text is
 * the bot's own question, so it reads like the card in the chat.
 */

import { Capacitor } from "@capacitor/core";

import {
  ensureNotificationPermission,
  getNotificationPermission,
  isNotificationsSupported,
  refreshNotificationPermission,
} from "@/runtime/notifications";

export type AnuNotifyPermission = "granted" | "denied" | "prompt" | "unsupported";

const DISMISSED_KEY = "anu:notify-prompt-dismissed";

export async function anuNotifyPermission(): Promise<AnuNotifyPermission> {
  if (!isNotificationsSupported()) {
    return "unsupported";
  }
  const state = await refreshNotificationPermission().catch(() => "unsupported" as const);
  return state === "granted" || state === "denied" || state === "prompt" ? state : "unsupported";
}

export async function requestAnuNotifyPermission(): Promise<AnuNotifyPermission> {
  if (!isNotificationsSupported()) {
    return "unsupported";
  }
  const state = await ensureNotificationPermission().catch(() => "unsupported" as const);
  return state === "granted" || state === "denied" || state === "prompt" ? state : "unsupported";
}

/** Whether the person already said "Not now" to the in-app prompt. */
export function anuNotifyPromptDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissAnuNotifyPrompt(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Best effort: the prompt may show again next launch.
  }
}

let nextId = 1;

/** Posts one banner when allowed; silently does nothing otherwise. */
export async function postAnuNotification(args: {
  title: string;
  body: string;
  /** The ANU path a tap should open. */
  path: string;
}): Promise<void> {
  if ((await getNotificationPermission().catch(() => "unsupported")) !== "granted") {
    return;
  }
  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      nextId = (nextId % 100_000) + 1;
      await LocalNotifications.schedule({
        notifications: [{ id: 70_000 + nextId, title: args.title, body: args.body, extra: { anuPath: args.path } }],
      });
      return;
    }
    if (typeof Notification !== "undefined") {
      const banner = new Notification(args.title, { body: args.body, tag: args.path });
      banner.onclick = () => {
        window.focus();
        window.location.assign(args.path);
      };
    }
  } catch {
    // A banner that could not be shown is not worth an error screen.
  }
}

/** Pending approvals not seen before; remembers what it has returned. */
export function newApprovalIds(
  seen: Set<string>,
  sessions: ReadonlyArray<{ id: string; approvals: ReadonlyArray<{ id: string; status: string }> }>,
): Array<{ sessionId: string; approvalId: string }> {
  const fresh: Array<{ sessionId: string; approvalId: string }> = [];
  for (const session of sessions) {
    for (const approval of session.approvals) {
      if (approval.status === "pending" && !seen.has(approval.id)) {
        seen.add(approval.id);
        fresh.push({ sessionId: session.id, approvalId: approval.id });
      }
    }
  }
  return fresh;
}
