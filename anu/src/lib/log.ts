import { maskPhone } from "./phone.js";

export type LogFields = Record<string, unknown>;
export type LogSink = (line: string) => void;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

// Anything that looks like a phone number (a "+" and 7 to 15 digits) is masked,
// as a safety net in case a caller passes one by mistake.
const PHONE_LIKE = /\+[1-9][0-9]{6,14}/g;

function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(PHONE_LIKE, (match) => maskPhone(match));
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return scrub(value.message, depth + 1);
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = scrub(item, depth + 1);
  return out;
}

export function createLogger(service: string, sink: LogSink = (line) => console.log(line)): Logger {
  const write = (level: string, event: string, fields: LogFields = {}) => {
    const record = { time: new Date().toISOString(), level, service, event, ...(scrub(fields) as LogFields) };
    sink(JSON.stringify(record));
  };
  return {
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
  };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
