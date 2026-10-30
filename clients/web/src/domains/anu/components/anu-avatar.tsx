/**
 * A bot's Frostling, acting out its state (spec A.2): thinking only while it
 * works, the waiting pose held while it asks the person something, one
 * success hop when a turn completes, and a still, desaturated face when it
 * failed. Under reduced motion every state shows its final pose. The look
 * comes from the bot's traits; unknown or missing traits fall back to the
 * catalog's first character rather than drawing nothing.
 */

import { useEffect, useRef, useState } from "react";

import { ChatAvatar } from "@/components/avatar/chat-avatar";
import { cn } from "@/utils/misc";
import { useBundledAvatarComponents } from "@/utils/use-bundled-avatar-components";

import type { AnuAvatarTraits } from "../anu-api";
import type { AnuFace } from "../anu-bots-model";

/** The older mood names the task screens pass; mapped onto faces. */
export type AnuAvatarMood = "working" | "waiting" | "success" | "still";

function moodFace(mood: AnuAvatarMood): AnuFace {
  switch (mood) {
    case "working":
      return "thinking";
    case "waiting":
      return "waiting";
    case "success":
      return "success";
    default:
      return "rest";
  }
}

interface AnuAvatarProps {
  face?: AnuFace;
  /** @deprecated pass `face`. */
  mood?: AnuAvatarMood;
  traits?: AnuAvatarTraits | null;
  size?: number;
  className?: string;
}

/** How long the success hop is left on before the face rests again. */
const SUCCESS_MS = 700;

export function AnuAvatar({ face, mood, traits, size = 32, className }: AnuAvatarProps) {
  const components = useBundledAvatarComponents();
  const resolvedFace = face ?? (mood ? moodFace(mood) : "rest");
  // Success plays once, then rests: hold the reaction only briefly after the
  // face turns to success.
  const [hop, setHop] = useState(false);
  const previous = useRef<AnuFace | null>(null);
  useEffect(() => {
    if (resolvedFace === "success" && previous.current !== "success") {
      setHop(true);
      const timer = setTimeout(() => setHop(false), SUCCESS_MS);
      previous.current = resolvedFace;
      return () => clearTimeout(timer);
    }
    previous.current = resolvedFace;
    return undefined;
  }, [resolvedFace]);

  const known =
    traits &&
    components?.bodyShapes.some((shape) => shape.id === traits.bodyShape) &&
    components.eyeStyles.some((eyes) => eyes.id === traits.eyeStyle) &&
    components.colors.some((color) => color.id === traits.color);
  const body = components?.bodyShapes[0]?.id;
  const eyes = components?.eyeStyles[0]?.id;
  const color = components?.colors[0]?.id;
  const resolved = known
    ? traits
    : body && eyes && color
      ? { bodyShape: body, eyeStyle: eyes, color }
      : null;
  return (
    <span
      aria-hidden
      data-face={resolvedFace}
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        resolvedFace === "failed" && "opacity-70 grayscale",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <ChatAvatar
        components={components}
        traits={resolved}
        customImageUrl={null}
        size={size}
        isAssistantBusy={resolvedFace === "thinking"}
        reaction={resolvedFace === "waiting" ? "waiting" : hop ? "success" : null}
      />
    </span>
  );
}
