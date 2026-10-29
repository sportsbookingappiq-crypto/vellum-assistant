import { z } from "zod";

export const ENVIRONMENTS = ["dev", "test", "staging", "production"] as const;

const ConfigSchema = z
  .object({
    ANU_ENV: z.enum(ENVIRONMENTS),
    OTP_SENDER: z.enum(["dev"]),
    KILO_API_KEY: z.string().min(1).optional(),
    KILO_BASE_URL: z.url().optional(),
  })
  .superRefine((config, ctx) => {
    const devSenderAllowed = config.ANU_ENV === "dev" || config.ANU_ENV === "test";
    if (config.OTP_SENDER === "dev" && !devSenderAllowed) {
      ctx.addIssue({
        code: "custom",
        path: ["OTP_SENDER"],
        message: "OTP_SENDER=dev is allowed only when ANU_ENV is dev or test",
      });
    }
  });

export type AnuConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(source: Record<string, string | undefined>): AnuConfig {
  const parsed = ConfigSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new Error(`Invalid ANU configuration:\n${problems.join("\n")}`);
  }
  return parsed.data;
}
