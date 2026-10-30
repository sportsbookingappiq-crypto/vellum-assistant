const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * Normalizes user input to E.164. Accepts spaces, dashes, dots, and
 * parentheses as separators, and requires a leading "+" country code.
 * Returns null when the result is not a valid E.164 number.
 */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const compact = input.trim().replace(/[\s\-().]/g, "");
  return E164.test(compact) ? compact : null;
}

/** Masks a phone number for logs: keeps the country prefix length hidden and the last two digits. */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return "***";
  return `+${"*".repeat(Math.max(phone.length - 3, 1))}${phone.slice(-2)}`;
}
