/**
 * DoctorAvatar: rose Bloom character with a wink and a little
 * stethoscope draped across the lower half, used as the icon for the
 * Doctor settings panel.
 *
 * Body and eye paths are lifted from `packages/avatar-catalog` (the `flower`
 * body, `quirky` eyes, `pink` colour) so the Doctor icon matches the avatar
 * aesthetic without needing a live assistant to compose it at runtime. The
 * eyes are drawn in their own 600x600 source box and placed with the same
 * remap the compositor applies.
 */

const FLOWER_VIEWBOX = "0 0 524 583";
const PINK = "#E2588A";
const SCLERA = "#F4F8FD";
const PUPIL = "#0F1C38";

const FLOWER_PATH =
  "M118.92 168.8L227.17 106.3C248.65 93.9 274.97 93.9 296.45 106.3L404.7 168.8C426.18 181.2 439.35 204 439.35 228.8L439.35 353.8C439.35 378.6 426.18 401.4 404.7 413.8L296.45 476.3C274.97 488.7 248.65 488.7 227.17 476.3L118.92 413.8C97.44 401.4 84.27 378.6 84.27 353.8L84.27 228.8C84.27 204 97.44 181.2 118.92 168.8ZM206.38 23.3L227.17 11.3C248.65 -1.1 274.97 -1.1 296.45 11.3L317.24 23.3C338.71 35.7 351.88 58.5 351.88 83.3L351.88 107.3C351.88 132.1 338.71 154.9 317.24 167.3L296.45 179.3C274.97 191.7 248.65 191.7 227.17 179.3L206.38 167.3C184.91 154.9 171.74 132.1 171.74 107.3L171.74 83.3C171.74 58.5 184.91 35.7 206.38 23.3ZM466.19 109.3L486.98 121.3C508.45 133.7 521.62 156.5 521.62 181.3L521.62 205.3C521.62 230.1 508.45 252.9 486.98 265.3L466.19 277.3C444.71 289.7 418.39 289.7 396.91 277.3L376.13 265.3C354.65 252.9 341.48 230.1 341.48 205.3L341.48 181.3C341.48 156.5 354.65 133.7 376.13 121.3L396.91 109.3C418.39 96.9 444.71 96.9 466.19 109.3ZM521.62 377.3L521.62 401.3C521.62 426.1 508.45 448.9 486.98 461.3L466.19 473.3C444.71 485.7 418.39 485.7 396.91 473.3L376.13 461.3C354.65 448.9 341.48 426.1 341.48 401.3L341.48 377.3C341.48 352.5 354.65 329.7 376.13 317.3L396.91 305.3C418.39 292.9 444.71 292.9 466.19 305.3L486.98 317.3C508.45 329.7 521.62 352.5 521.62 377.3ZM317.24 559.3L296.45 571.3C274.97 583.7 248.65 583.7 227.17 571.3L206.38 559.3C184.91 546.9 171.74 524.1 171.74 499.3L171.74 475.3C171.74 450.5 184.91 427.7 206.38 415.3L227.17 403.3C248.65 390.9 274.97 390.9 296.45 403.3L317.24 415.3C338.71 427.7 351.88 450.5 351.88 475.3L351.88 499.3C351.88 524.1 338.71 546.9 317.24 559.3ZM57.43 473.3L36.64 461.3C15.17 448.9 2 426.1 2 401.3L2 377.3C2 352.5 15.17 329.7 36.64 317.3L57.43 305.3C78.91 292.9 105.23 292.9 126.71 305.3L147.49 317.3C168.97 329.7 182.14 352.5 182.14 377.3L182.14 401.3C182.14 426.1 168.97 448.9 147.49 461.3L126.71 473.3C105.23 485.7 78.91 485.7 57.43 473.3ZM2 205.3L2 181.3C2 156.5 15.17 133.7 36.64 121.3L57.43 109.3C78.91 96.9 105.23 96.9 126.71 109.3L147.49 121.3C168.97 133.7 182.14 156.5 182.14 181.3L182.14 205.3C182.14 230.1 168.97 252.9 147.49 265.3L126.71 277.3C105.23 289.7 78.91 289.7 57.43 277.3L36.64 265.3C15.17 252.9 2 230.1 2 205.3Z";

/** The catalog's eye remap: the wink's 600x600 source box onto the flower's face. */
const EYE_TRANSFORM = "matrix(0.8733,0,0,0.8733,0,35)";

const QUIRKY_EYE_PATHS: ReadonlyArray<{ d: string; fill: string }> = [
  {
    d: "M295.2 300C295.2 338 264.4 368.8 226.4 368.8C188.4 368.8 157.6 338 157.6 300C157.6 262 188.4 231.2 226.4 231.2C264.4 231.2 295.2 262 295.2 300Z",
    fill: SCLERA,
  },
  {
    d: "M283 304C283 332.72 259.72 356 231 356C202.28 356 179 332.72 179 304C179 275.28 202.28 252 231 252C259.72 252 283 275.28 283 304Z",
    fill: PUPIL,
  },
  {
    d: "M351.46 228.91L443.46 278.91C451.19 283.11 456 291.2 456 300C456 308.8 451.19 316.89 443.46 321.09L351.46 371.09C339.81 377.42 325.24 373.11 318.91 361.46C312.58 349.81 316.89 335.24 328.54 328.91L381.74 300L328.54 271.09C316.89 264.76 312.58 250.19 318.91 238.54C325.24 226.89 339.81 222.58 351.46 228.91Z",
    fill: SCLERA,
  },
];

export interface DoctorAvatarProps {
  className?: string;
}

export function DoctorAvatar({ className }: DoctorAvatarProps) {
  return (
    <svg
      viewBox={FLOWER_VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d={FLOWER_PATH} fill={PINK} />
      <g transform={EYE_TRANSFORM}>
        {QUIRKY_EYE_PATHS.map((eye, index) => (
          <path key={index} d={eye.d} fill={eye.fill} />
        ))}
      </g>
      {/* Stethoscope, draped across the lower half of the flower. */}
      {/* Drawn on a 724-wide canvas, so the outer group fits it to the
          flower; the inner one scales it 1.37x around its own centroid so
          strokes grow proportionally with the geometry. */}
      <g transform="translate(-14 78) scale(0.76)">
        <g transform="translate(370 510) scale(1.37) translate(-370 -510)">
          {/* Tubing: left earpiece -> U curve under the face -> drop cable to chestpiece. */}
          <path
            d="M 230 440 Q 210 560 320 585 Q 430 610 500 540"
            stroke="#1F1F23"
            strokeWidth="22"
            strokeLinecap="round"
            fill="none"
          />
          {/* Earpiece nub on the upper-left end of the tubing */}
          <circle cx="230" cy="435" r="16" fill="#1F1F23" />
          {/* Chestpiece outer ring */}
          <circle
            cx="510"
            cy="525"
            r="58"
            fill="#E4E4E7"
            stroke="#1F1F23"
            strokeWidth="10"
          />
          {/* Chestpiece diaphragm */}
          <circle cx="510" cy="525" r="34" fill="#52525B" />
          {/* Subtle highlight on diaphragm */}
          <circle cx="500" cy="515" r="10" fill="#A1A1AA" opacity="0.55" />
        </g>
      </g>
    </svg>
  );
}
