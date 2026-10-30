/**
 * On-screen preview of an iOS app icon.
 *
 * Draws what `clients/ios/scripts/generate-avatar-icons.ts` bakes into each
 * `avatar-eyes-<eyeStyle>-<color>.appiconset`: a solid field in the trait
 * color with the eye style's paths centered on it, the pair spanning that
 * style's share of the icon. The generator measures its artwork by rasterizing
 * it, which the web has no way to do, so the framing here comes from
 * `tightPathBBox`, whose curve-solved box is the same box a rasterizer would
 * find. Framing against the control-point box the voice room uses (`pathBBox`)
 * would place the `angry` eyes about 6% of the icon above where the shipped
 * PNG has them.
 *
 * The app's primary icon carries no eyes at all: it is the ANU mark on the
 * build's own ground, which {@link PrimaryAppIconPreview} draws on the same
 * squircle so a row can show either one.
 *
 * Purely presentational: no store, hook, or native bridge. An eye style or
 * color the components catalog does not carry renders as the field alone
 * rather than throwing, so a preview seeded from a stale or skewed icon name
 * still shows something.
 */

import { useMemo } from "react";

import {
  ARTWORK_SCALE as MARK_SCALE,
  MARK_FACETS,
  MARK_SILHOUETTE,
} from "@/components/ios-widget-previews/vellum-app-icon-mark";
import { tightPathBBox, unionBBox } from "@/utils/eye-bbox";
import type { CharacterComponents, EyePathDefinition } from "@/types/avatar";

/**
 * Fraction of the icon an eye pair's tight bounds span, for every style the
 * table below does not name.
 *
 * `clients/ios/scripts/generate-avatar-icons.ts` holds the shipped PNGs to
 * this same number and table, and each side pins them in its own tests, since
 * a web bundle cannot import a build script that rasterizes SVG. A span moves
 * here only alongside that generator, and the catalog is regenerated with it.
 */
const DEFAULT_EYE_SPAN_FRACTION = 0.5;

/** Eye styles framed wider or narrower than {@link DEFAULT_EYE_SPAN_FRACTION}. */
const EYE_SPAN_FRACTION_OVERRIDES: Record<string, number> = {
  dazed: 0.55,
  bashful: 0.4,
};

/**
 * Corner radius as a fraction of the icon's width. Close enough to the iOS
 * squircle that the preview reads as an app icon rather than a color swatch.
 */
const CORNER_RADIUS_FRACTION = 0.224;

/** Field painted when the color id is not in the catalog. */
const UNKNOWN_FIELD_FILL = "var(--surface-sunken)";

/** Default preview size, matching the avatar builder's inline thumbnails. */
const DEFAULT_SIZE = 64;

export interface AppIconPreviewProps {
  /** Trait catalog the ids resolve against. Null while it is still loading. */
  components: CharacterComponents | null;
  eyeStyle: string;
  color: string;
  /**
   * Paint the field this exact CSS color rather than the one `color` resolves
   * to, for a depiction whose field is not a catalog color at all. Any color
   * syntax the renderer parses works, wide-gamut `color()` included.
   */
  fieldColor?: string;
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
}

interface IconEyeArt {
  paths: EyePathDefinition[];
  /** Affine transform placing the artwork on the icon's field. */
  transform: string;
}

/** Fraction of the icon one style's pair spans. */
function eyeSpanFraction(eyeStyleId: string): number {
  return EYE_SPAN_FRACTION_OVERRIDES[eyeStyleId] ?? DEFAULT_EYE_SPAN_FRACTION;
}

/**
 * Scale and center an eye style's artwork on a `size` square field.
 *
 * The pair is fitted to its share of the field by its wider axis, so taking
 * the smaller of the two ratios caps a pair taller than it is wide at that
 * same fraction of the height and an unusually tall pair cannot outgrow a wide
 * one. Returns null for art that is missing or degenerate, which is what makes
 * an unknown id render the field alone.
 */
function resolveEyeArt(
  components: CharacterComponents | null,
  eyeStyleId: string,
  size: number,
): IconEyeArt | null {
  const eyeStyle = components?.eyeStyles.find((eye) => eye.id === eyeStyleId);
  if (!eyeStyle || eyeStyle.paths.length === 0) {
    return null;
  }
  const bbox = unionBBox(
    eyeStyle.paths.map((path) => tightPathBBox(path.svgPath)),
  );
  if (bbox.w <= 0 || bbox.h <= 0) {
    return null;
  }
  const span = size * eyeSpanFraction(eyeStyleId);
  const scale = Math.min(span / bbox.w, span / bbox.h);
  const translateX = size / 2 - (bbox.x + bbox.w / 2) * scale;
  const translateY = size / 2 - (bbox.y + bbox.h / 2) * scale;
  return {
    paths: eyeStyle.paths,
    transform: `matrix(${scale},0,0,${scale},${translateX},${translateY})`,
  };
}

export function AppIconPreview({
  components,
  eyeStyle,
  color,
  fieldColor,
  size = DEFAULT_SIZE,
  className,
}: AppIconPreviewProps) {
  const art = useMemo(
    () => resolveEyeArt(components, eyeStyle, size),
    [components, eyeStyle, size],
  );
  const catalogHex = components?.colors.find(
    (entry) => entry.id === color,
  )?.hex;
  const fieldFill = fieldColor ?? catalogHex;
  const radius = size * CORNER_RADIUS_FRACTION;

  return (
    <svg
      aria-hidden="true"
      data-testid="app-icon-preview"
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect
        data-testid="app-icon-preview-field"
        width={size}
        height={size}
        rx={radius}
        ry={radius}
        fill={fieldFill ?? UNKNOWN_FIELD_FILL}
      />
      {art ? (
        <g data-testid="app-icon-preview-eyes" transform={art.transform}>
          {art.paths.map((path, index) => (
            <path key={index} d={path.svgPath} fill={path.color} />
          ))}
        </g>
      ) : null}
    </svg>
  );
}

/**
 * The two tones the mark is drawn in: `ice` (Sky silhouette, Ice facets) on a
 * night ground, `night` (Night 900 silhouette, Deep Blue facets) on a light
 * one, as `assets/brand/BRAND.md` pairs them for flat renders.
 */
export const PRIMARY_MARK_TONES = {
  ice: { silhouette: "#7DD3FC", facets: "#E0F2FE" },
  night: { silhouette: "#0A1633", facets: "#1E40AF" },
} as const;

export type PrimaryMarkTone = keyof typeof PRIMARY_MARK_TONES;

export interface PrimaryAppIconPreviewProps {
  /** The ground the installed build's icon is drawn on, as any CSS color. */
  fieldColor: string;
  /** Which of the mark's two-tone renders that build's icon carries. */
  tone: PrimaryMarkTone;
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
}

/**
 * On-screen preview of the app's primary icon: the ANU mark centered on the
 * build's ground, its 100-unit canvas filling the share of the tile the icon
 * gives it. Same squircle and test ids as {@link AppIconPreview}, so a surface
 * showing whichever icon is installed reads the field the same way.
 */
export function PrimaryAppIconPreview({
  fieldColor,
  tone,
  size = DEFAULT_SIZE,
  className,
}: PrimaryAppIconPreviewProps) {
  const radius = size * CORNER_RADIUS_FRACTION;
  const scale = (size * MARK_SCALE) / 100;
  const offset = (size - size * MARK_SCALE) / 2;
  const colors = PRIMARY_MARK_TONES[tone];

  return (
    <svg
      aria-hidden="true"
      data-testid="app-icon-preview"
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ display: "block", flexShrink: 0 }}
    >
      <rect
        data-testid="app-icon-preview-field"
        width={size}
        height={size}
        rx={radius}
        ry={radius}
        fill={fieldColor}
      />
      <g
        data-testid="app-icon-preview-mark"
        transform={`matrix(${scale},0,0,${scale},${offset},${offset})`}
      >
        <path d={MARK_SILHOUETTE} fill={colors.silhouette} />
        <path d={MARK_FACETS} fill={colors.facets} />
      </g>
    </svg>
  );
}
