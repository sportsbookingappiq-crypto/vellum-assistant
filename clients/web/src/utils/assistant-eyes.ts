/**
 * Shared sizing for the assistant's eye sprite wherever it perches inside a
 * nav row — the sidebar's assistant cluster and the onboarding tour's
 * flooded rows render the same eyes, so they draw from one set of numbers.
 */

/**
 * Hand-tuned base (unscaled) sprite width per eye style. Every pair in the
 * catalog is drawn at one scale, but their aspect ratios still range from
 * gentle (≈ 1.8 wide per tall) to grumpy (≈ 4.8), so the flat pairs get a
 * little extra width to keep their height from shrinking to a sliver.
 * Height follows each style's own aspect ratio at its width; the resting
 * eyes render at {@link REST_SCALE} times these. Styles missing from the
 * map (a future catalog addition) fall back to {@link DEFAULT_EYES_WIDTH}.
 */
export const EYE_STYLE_WIDTHS: Record<string, number> = {
  grumpy: 20,
  angry: 16,
  curious: 14,
  goofy: 14,
  surprised: 15,
  bashful: 17,
  gentle: 12,
  quirky: 14,
  dazed: 16,
};
export const DEFAULT_EYES_WIDTH = 14;

/** The eyes' permanent grown size at their perch. */
export const REST_SCALE = 2.1;
/** The extra growth spurt right before ducking under a row's bottom fold. */
export const DUCK_SCALE = 2.6;
/** How far the resting eyes sink through their row's bottom edge. */
export const EDGE_SINK = 4;
/** Reference height for scaling the bottom-edge sink: shapes about this
 *  tall sink the full {@link EDGE_SINK}; flatter ones sink less. */
export const SINK_REFERENCE_HEIGHT = 10;
/** Distance from a row's right edge to the eye slot (pre-scale). */
export const EYES_RIGHT_OFFSET = 18;

/** Base (unscaled) sprite width for an eye style. */
export function eyeStyleBaseWidth(styleId: string): number {
  return EYE_STYLE_WIDTHS[styleId] ?? DEFAULT_EYES_WIDTH;
}
