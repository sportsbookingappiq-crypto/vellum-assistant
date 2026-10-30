/**
 * The ANU snowflake, drawn from the brand geometry in
 * `assets/brand/` and filled with `currentColor` so the chrome decides its
 * ink. Below 32px the mark switches to the favicon cut, whose heavier rays
 * and larger branches survive small sizes (assets/brand/BRAND.md).
 */

const MARK_PATH =
  "M9.3 73.5L25.34 60.76L17.26 53.72L29.94 57.1L34.16 53.75L32 50L34.16 46.25L29.94 42.9L17.26 46.28L25.34 39.24L9.3 26.5L28.35 34.02L30.41 23.51L33.82 36.18L38.84 38.16L41 34.41L45.33 34.41L46.12 29.08L36.86 19.79L46.99 23.26L50 3L53.01 23.26L63.14 19.79L53.88 29.08L54.67 34.41L59 34.41L61.16 38.16L66.18 36.18L69.59 23.51L71.65 34.02L90.7 26.5L74.66 39.24L82.74 46.28L70.06 42.9L65.84 46.25L68 50L65.84 53.75L70.06 57.1L82.74 53.72L74.66 60.76L90.7 73.5L71.65 65.98L69.59 76.49L66.18 63.82L61.16 61.84L59 65.59L54.67 65.59L53.88 70.92L63.14 80.21L53.01 76.74L50 97L46.99 76.74L36.86 80.21L46.12 70.92L45.33 65.59L41 65.59L38.84 61.84L33.82 63.82L30.41 76.49L28.35 65.98ZM43 50L46.5 56.06L53.5 56.06L57 50L53.5 43.94L46.5 43.94Z";

const SMALL_MARK_PATH =
  "M8.43 26L25.24 31.46L28.35 22.5L32.25 33.74L39.1 35.97L40.5 33.55L43.3 33.55L44.8 26.49L37.01 17.5L46.33 19.29L50 2L53.67 19.29L62.99 17.5L55.2 26.49L56.7 33.55L59.5 33.55L60.9 35.97L67.75 33.74L71.65 22.5L74.76 31.46L91.57 26L78.43 37.83L84.64 45L72.96 42.75L67.6 47.58L69 50L67.6 52.42L72.96 57.25L84.64 55L78.43 62.17L91.57 74L74.76 68.54L71.65 77.5L67.75 66.26L60.9 64.03L59.5 66.45L56.7 66.45L55.2 73.51L62.99 82.5L53.67 80.71L50 98L46.33 80.71L37.01 82.5L44.8 73.51L43.3 66.45L40.5 66.45L39.1 64.03L32.25 66.26L28.35 77.5L25.24 68.54L8.43 74L21.57 62.17L15.36 55L27.04 57.25L32.4 52.42L31 50L32.4 47.58L27.04 42.75L15.36 45L21.57 37.83ZM42.5 50L46.25 56.5L53.75 56.5L57.5 50L53.75 43.5L46.25 43.5Z";


interface AnuMarkProps {
  size: number;
  className?: string;
  /** Accessible name; omit when a visible name sits beside the mark. */
  label?: string;
}

export function AnuMark({ size, className, label }: AnuMarkProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <path
        d={size < 32 ? SMALL_MARK_PATH : MARK_PATH}
        fill="currentColor"
      />
    </svg>
  );
}
