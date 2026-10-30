import path from "node:path";

/** Variables a sandboxed process may inherit from the sandbox server. Nothing else passes. */
export const INHERITED_ENV = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM"] as const;

/** Names that must never reach a sandboxed process, even if a caller adds them. */
const FORBIDDEN = /(^ANU_INTERNAL_TOKEN$|^ANU_OTP_SECRET$|^DATABASE_URL$|^PG[A-Z]*$|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_KEY$|^AWS_|^GOOGLE_|^ANTHROPIC_|^OPENAI_)/i;

export function isForbiddenEnvName(name: string): boolean {
  return FORBIDDEN.test(name);
}

/**
 * Builds the environment for a sandboxed child process from an allowlist.
 * HOME and TMPDIR point inside the task workspace. `extra` may add
 * non-secret settings; secret-looking names in it are rejected.
 */
export function sanitizeEnv(
  parent: Record<string, string | undefined>,
  workspaceDir: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  env.PATH ??= "/usr/local/bin:/usr/bin:/bin";
  env.HOME = workspaceDir;
  env.TMPDIR = path.join(workspaceDir, "tmp");
  for (const [name, value] of Object.entries(extra)) {
    if (isForbiddenEnvName(name)) throw new Error(`refusing to pass ${name} into the sandbox`);
    env[name] = value;
  }
  return env;
}
