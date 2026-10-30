/**
 * What a user sees for each avatar trait id.
 *
 * The ids are persisted (workspace avatar manifests, pinned-app colours, app
 * icon names) and predate the ANU character designs, so several no longer
 * describe what they draw: `blob` is a hexagon, `teal` is azure. Surfaces
 * that show a trait show its label from here; the id stays an internal key.
 *
 * Its own subpath, like the palette, so a picker can name a trait without
 * pulling in the shapes' path data. An id with no entry (a future catalog
 * addition this build predates) falls back to the id itself.
 */

export const BODY_SHAPE_LABELS: Readonly<Record<string, string>> = {
  blob: "Hexa",
  cloud: "Flurry",
  sprout: "Sprig",
  star: "Stella",
  ghost: "Wisp",
  urchin: "Rime",
  stack: "Cairn",
  flower: "Bloom",
  burst: "Gem",
  ninja: "Lynx",
  stellar: "Stellar",
  dendrite: "Dendrite",
};

export const EYE_STYLE_LABELS: Readonly<Record<string, string>> = {
  grumpy: "Deadpan",
  angry: "Fierce",
  curious: "Curious",
  goofy: "Goofy",
  surprised: "Wide-eyed",
  bashful: "Cozy",
  gentle: "Gentle",
  quirky: "Wink",
  dazed: "Starry",
};

export const COLOR_LABELS: Readonly<Record<string, string>> = {
  teal: "Azure",
  purple: "Violet",
  pink: "Rose",
  orange: "Ember",
  yellow: "Gold",
  green: "Aurora",
};

export type AvatarTraitKind = "bodyShape" | "eyeStyle" | "color";

const LABELS_BY_KIND: Record<
  AvatarTraitKind,
  Readonly<Record<string, string>>
> = {
  bodyShape: BODY_SHAPE_LABELS,
  eyeStyle: EYE_STYLE_LABELS,
  color: COLOR_LABELS,
};

/** The display label for a trait id, or the id itself when it has none. */
export function avatarTraitLabel(kind: AvatarTraitKind, id: string): string {
  return Object.hasOwn(LABELS_BY_KIND[kind], id)
    ? LABELS_BY_KIND[kind][id]!
    : id;
}
