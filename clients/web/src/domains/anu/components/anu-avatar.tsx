/**
 * ANU's own Frostling beside a task's status, acting out where the run
 * stands: thinking while it works, swaying while it waits on the person,
 * and one hop when it succeeds. The look is the catalog's first character,
 * since the ANU API carries no avatar of its own.
 */

import { ChatAvatar } from "@/components/avatar/chat-avatar";
import { useBundledAvatarComponents } from "@/utils/use-bundled-avatar-components";

import type { AnuTaskStatus } from "../anu-api";

interface AnuAvatarProps {
  status: AnuTaskStatus;
  size?: number;
}

export function AnuAvatar({ status, size = 32 }: AnuAvatarProps) {
  const components = useBundledAvatarComponents();
  const body = components?.bodyShapes[0]?.id;
  const eyes = components?.eyeStyles[0]?.id;
  const color = components?.colors[0]?.id;
  const traits =
    body && eyes && color ? { bodyShape: body, eyeStyle: eyes, color } : null;
  return (
    <ChatAvatar
      components={components}
      traits={traits}
      customImageUrl={null}
      size={size}
      isAssistantBusy={status === "running" || status === "queued"}
      reaction={
        status === "awaiting_approval"
          ? "waiting"
          : status === "succeeded"
            ? "success"
            : null
      }
    />
  );
}
