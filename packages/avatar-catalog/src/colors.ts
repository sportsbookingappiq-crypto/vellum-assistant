import type { ColorDefinition } from "./types.js";

/**
 * The avatar colour palette, in the order the picker offers it.
 *
 * Its own module because the palette is the one part of the catalog that
 * boot-path code needs: a sidebar pin resolves a stored colour id on first
 * render, and the accent CSS variable falls back to the first entry before
 * the daemon's own catalog arrives. Importing the shapes to reach six hex
 * values would put the SVG path data on that path.
 *
 * The ids are stored in every workspace's avatar manifest, on pinned apps,
 * and in app icon names, so they outlive the hues they were named for: `teal`
 * is now ANU's azure and leads the list so the fallback accent is the brand
 * blue. Show a colour by its label (`./labels.ts`), never by its id.
 *
 * Every hue clears 3:1 against white and 4:1 against the night-blue dark
 * surface, except gold, which is yellow and clears 2:1 on white instead.
 */
export const AVATAR_COLORS: ColorDefinition[] = [
  { id: "teal", hex: "#2F86E0" }, // Azure
  { id: "purple", hex: "#7B68E6" }, // Violet
  { id: "pink", hex: "#E2588A" }, // Rose
  { id: "orange", hex: "#E96D38" }, // Ember
  { id: "yellow", hex: "#E0A91F" }, // Gold
  { id: "green", hex: "#1FA088" }, // Aurora
];

/** The palette hex for a colour id, or null for an id the palette does not have. */
export function accentHexForColorId(
  colorId: string | null | undefined,
): string | null {
  if (!colorId) {
    return null;
  }
  return AVATAR_COLORS.find((c) => c.id === colorId)?.hex ?? null;
}
