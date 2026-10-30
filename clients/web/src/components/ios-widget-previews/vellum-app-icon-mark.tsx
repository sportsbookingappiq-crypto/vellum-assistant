/**
 * The app's own mark, at the size a control wears it: an icon ground with the
 * ANU snowflake on it.
 *
 * The paths are the small-size cut of the mark from `assets/brand/favicon.svg`
 * (a 100x100 canvas), the same artwork the widget extension draws, in the
 * two-tone the Icon Composer layer uses: a sky silhouette with ice facets.
 *
 * The ground is per environment on the device, where each build carries its own
 * icon's fill. A story has no build to ask, so it takes one.
 *
 * @see clients/ios/App/VoiceActivity/Widgets/WidgetActionControls.swift
 * @see clients/ios/App/App/Shared/AppIconGround.swift
 */

/** The three grounds the Icon Composer bundles declare, in sRGB. */
export const APP_ICON_GROUNDS = {
  production: "#0F2557",
  staging: "#E9C91A",
  dev: "#FF88C9",
} as const;

export type AppIconEnvironment = keyof typeof APP_ICON_GROUNDS;

/** The mark's outline on its 100x100 canvas, core hole included. */
export const MARK_SILHOUETTE =
  "M8.43 26L25.24 31.46L28.35 22.5L32.25 33.74L39.1 35.97L40.5 33.55L43.3 33.55L44.8 26.49L37.01 17.5L46.33 19.29L50 2L53.67 19.29L62.99 17.5L55.2 26.49L56.7 33.55L59.5 33.55L60.9 35.97L67.75 33.74L71.65 22.5L74.76 31.46L91.57 26L78.43 37.83L84.64 45L72.96 42.75L67.6 47.58L69 50L67.6 52.42L72.96 57.25L84.64 55L78.43 62.17L91.57 74L74.76 68.54L71.65 77.5L67.75 66.26L60.9 64.03L59.5 66.45L56.7 66.45L55.2 73.51L62.99 82.5L53.67 80.71L50 98L46.33 80.71L37.01 82.5L44.8 73.51L43.3 66.45L40.5 66.45L39.1 64.03L32.25 66.26L28.35 77.5L25.24 68.54L8.43 74L21.57 62.17L15.36 55L27.04 57.25L32.4 52.42L31 50L32.4 47.58L27.04 42.75L15.36 45L21.57 37.83ZM42.5 50L46.25 56.5L53.75 56.5L57.5 50L53.75 43.5L46.25 43.5Z";

/** The lit half of each ray, drawn over the silhouette in the lighter tone. */
export const MARK_FACETS =
  "M8.43 26L28.35 37.5L43.07 46L44.38 46.75L42.5 50L31 50L32.4 47.58L27.04 42.75L15.36 45L21.57 37.83ZM8.43 74L24.02 65L28.35 62.5L35.75 58.23L43.07 54L44.38 53.25L46.25 56.5L45.38 58L42.54 62.91L40.5 66.45L39.1 64.03L32.25 66.26L28.35 77.5L25.24 68.54ZM37.01 17.5L46.33 19.29L50 2L50 43.5L46.25 43.5L45.38 42L40.5 33.55L43.3 33.55L44.8 26.49ZM50 56.5L53.75 56.5L54.62 58L57.46 62.91L59.5 66.45L56.7 66.45L55.2 73.51L62.99 82.5L53.67 80.71L50 98ZM53.75 43.5L54.62 42L57.46 37.09L59.5 33.55L60.9 35.97L67.75 33.74L71.65 22.5L74.76 31.46L91.57 26L91.57 26L75.98 35L71.65 37.5L64.25 41.77L56.93 46L55.63 46.75ZM55.63 53.25L57.5 50L69 50L67.6 52.42L72.96 57.25L84.64 55L78.43 62.17L91.57 74L75.98 65L71.65 62.5L64.25 58.23L56.93 54Z";

/** A corner in the family the icon's own squircle is drawn with. */
const CORNER_RADIUS_RATIO = 0.28;

/**
 * The share of the tile the mark's canvas fills, as on the icon itself: the
 * Icon Composer layer scales the 100-unit canvas by 6.4 on a 1024 icon.
 */
export const ARTWORK_SCALE = 0.625;

interface VellumAppIconMarkProps {
  size: number;
  /** Which build's icon to draw. Defaults to the one users install. */
  environment?: AppIconEnvironment;
  flattened?: boolean;
}

export function VellumAppIconMark({
  size,
  environment = "production",
  flattened = false,
}: VellumAppIconMarkProps) {
  const artwork = size * ARTWORK_SCALE;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * CORNER_RADIUS_RATIO,
        background: flattened ? "transparent" : APP_ICON_GROUNDS[environment],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      <svg
        width={artwork}
        height={artwork}
        viewBox="0 0 100 100"
        style={{
          flexShrink: 0,
          // Flattened, the system keeps alpha and throws the colors away.
          opacity: flattened ? 0.85 : 1,
        }}
      >
        <path d={MARK_SILHOUETTE} fill={flattened ? "#FFFFFF" : "#7DD3FC"} />
        {flattened ? null : <path d={MARK_FACETS} fill="#E0F2FE" />}
      </svg>
    </span>
  );
}
