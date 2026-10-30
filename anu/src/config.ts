import path from "node:path";

import { z } from "zod";

export const ENVIRONMENTS = ["dev", "test", "staging", "production"] as const;
export const DRIVERS = ["scripted", "kilo", "harness"] as const;
export type DriverName = (typeof DRIVERS)[number];

export const ANU_DIR = path.resolve(import.meta.dir, "..");

export const DEFAULT_KILO_BASE_URL = "https://ai-gateway.kilo.ai/api/v1";
export const DEFAULT_KILO_MODEL = "kilo-auto/free";
export const DEFAULT_CORS_ORIGINS = "capacitor://localhost,https://localhost,http://localhost:*";

const port = (fallback: number) => z.coerce.number().int().min(0).max(65535).default(fallback);
const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const flag = z
  .enum(["0", "1", "true", "false"])
  .default("0")
  .transform((value) => value === "1" || value === "true");
const secret = (name: string) =>
  z.string().min(32, `${name} must be at least 32 characters (generate with: openssl rand -hex 32)`);

const baseShape = {
  ANU_ENV: z.enum(ENVIRONMENTS),
  OTP_SENDER: z.enum(["dev"]),
  KILO_API_KEY: z.string().min(1).optional(),
  KILO_BASE_URL: z.url().optional(),
};

const dbShape = {
  DATABASE_URL: z.string().min(1),
  ANU_DB_APP_ROLE: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/, "ANU_DB_APP_ROLE must be a plain lowercase role name")
    .default("anu_platform_app"),
};

const sharedServiceShape = {
  ANU_INTERNAL_TOKEN: secret("ANU_INTERNAL_TOKEN"),
  ANU_API_URL: z.url().default("http://127.0.0.1:8787"),
  ANU_SANDBOX_URL: z.url().default("http://127.0.0.1:8788"),
};

const apiShape = {
  ...baseShape,
  ...dbShape,
  ...sharedServiceShape,
  ANU_OTP_SECRET: secret("ANU_OTP_SECRET"),
  ANU_API_HOST: z.string().min(1).default("127.0.0.1"),
  ANU_API_PORT: port(8787),
  ANU_SESSION_TTL_SECONDS: positiveInt(24 * 60 * 60),
  ANU_CORS_ORIGINS: z.string().default(DEFAULT_CORS_ORIGINS),
  ANU_TRUST_PROXY: flag,
  ANU_RATE_WINDOW_SECONDS: positiveInt(15 * 60),
  ANU_RATE_PHONE_MAX: positiveInt(5),
  ANU_RATE_CLIENT_MAX: positiveInt(20),
};

const sandboxShape = {
  ...baseShape,
  ...sharedServiceShape,
  ANU_SANDBOX_HOST: z.string().min(1).default("127.0.0.1"),
  ANU_SANDBOX_PORT: port(8788),
  ANU_SANDBOX_ROOT: z.string().min(1).default(path.join(ANU_DIR, ".data", "sandboxes")),
  ANU_SANDBOX_DRIVER: z.enum(DRIVERS).default("scripted"),
  ANU_TASK_TIMEOUT_SECONDS: positiveInt(600),
  /** A chat session's worker shuts down after this long without a turn. */
  ANU_SESSION_IDLE_SECONDS: positiveInt(600),
  ANU_SCRIPTED_STEP_DELAY_MS: z.coerce.number().int().min(0).default(300),
  KILO_MODEL: z.string().min(1).default(DEFAULT_KILO_MODEL),
  ANU_ASSISTANT_DIR: z.string().min(1).default(path.resolve(ANU_DIR, "..", "assistant")),
};

function devSenderGuard(config: { ANU_ENV: string; OTP_SENDER: string }, ctx: z.RefinementCtx) {
  const devSenderAllowed = config.ANU_ENV === "dev" || config.ANU_ENV === "test";
  if (config.OTP_SENDER === "dev" && !devSenderAllowed) {
    ctx.addIssue({
      code: "custom",
      path: ["OTP_SENDER"],
      message: "OTP_SENDER=dev is allowed only when ANU_ENV is dev or test",
    });
  }
}

const ConfigSchema = z.object(baseShape).superRefine(devSenderGuard);
const ApiConfigSchema = z.object(apiShape).superRefine(devSenderGuard);
const SandboxConfigSchema = z.object(sandboxShape).superRefine(devSenderGuard);

export type AnuConfig = z.infer<typeof ConfigSchema>;
export type ApiConfig = z.infer<typeof ApiConfigSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

type Source = Record<string, string | undefined>;

function parse<T extends z.ZodType>(schema: T, source: Source): z.infer<T> {
  // Empty strings from shells mean "unset" for optional values with defaults,
  // except for keys that are validated as present-but-invalid.
  const cleaned: Source = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === "" && key !== "KILO_API_KEY") continue;
    cleaned[key] = value;
  }
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid ANU configuration:\n${problems.join("\n")}`);
  }
  return parsed.data;
}

export function loadConfig(source: Source): AnuConfig {
  return parse(ConfigSchema, source);
}

export function loadApiConfig(source: Source): ApiConfig {
  return parse(ApiConfigSchema, source);
}

export function loadSandboxConfig(source: Source): SandboxConfig {
  return parse(SandboxConfigSchema, source);
}

/** Parses ANU_CORS_ORIGINS. Entries may end in ":*" to allow any port. */
export function corsOriginMatcher(spec: string): (origin: string) => boolean {
  const entries = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return (origin: string) =>
    entries.some((entry) => {
      if (entry === origin) return true;
      if (entry.endsWith(":*")) {
        const prefix = entry.slice(0, -2);
        if (!origin.startsWith(prefix + ":")) return false;
        return /^\d{1,5}$/.test(origin.slice(prefix.length + 1));
      }
      return false;
    });
}
