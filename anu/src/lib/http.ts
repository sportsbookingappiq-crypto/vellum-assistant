import { timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorResponse(error: HttpError): Response {
  return json({ error: { code: error.code, message: error.message, ...error.extra } }, error.status, error.headers);
}

export const notFound = () => new HttpError(404, "not_found", "Not found");

const MAX_BODY_BYTES = 64 * 1024;

export async function readJson(req: Request): Promise<unknown> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large", "Request body is too large");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "body_too_large", "Request body is too large");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

/** Constant-time comparison of two bearer secrets. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function bearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1]! : null;
}
