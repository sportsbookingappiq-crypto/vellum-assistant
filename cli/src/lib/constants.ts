/**
 * Canonical internal assistant ID used as the default/fallback across the CLI
 * and daemon. Mirrors `DAEMON_INTERNAL_ASSISTANT_ID` from
 * `assistant/src/runtime/assistant-scope.ts`.
 */
export const DAEMON_INTERNAL_ASSISTANT_ID = "self" as const;

export const FIREWALL_TAG = "vellum-assistant";
export const GATEWAY_PORT = process.env.GATEWAY_PORT
  ? Number(process.env.GATEWAY_PORT)
  : 7830;

/** Default ports used as scan start points for multi-instance allocation. */
export const DEFAULT_DAEMON_PORT = 7821;
export const DEFAULT_GATEWAY_PORT = 7830;
export const DEFAULT_QDRANT_PORT = 6333;
export const DEFAULT_CES_PORT = 8090;

export const VALID_REMOTE_HOSTS = [
  "local",
  "docker",
  "custom",
  "vellum",
] as const;
export type RemoteHost = (typeof VALID_REMOTE_HOSTS)[number];
export const VALID_SPECIES = ["openclaw", "vellum"] as const;
export type Species = (typeof VALID_SPECIES)[number];

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  brightBlue: "\x1b[94m",
} as const;

interface SpeciesConfig {
  /** Name shown to people. The species id itself is a persisted contract. */
  label: string;
  color: string;
  art: string[];
  hatchedEmoji: string;
  waitingMessages: string[];
  runningMessages: string[];
}

export const SPECIES_CONFIG: Record<Species, SpeciesConfig> = {
  openclaw: {
    label: "OpenClaw",
    color: ANSI.red,
    art: [
      `${ANSI.red}     ___${ANSI.reset}`,
      `${ANSI.red}    / ${ANSI.reset}${ANSI.bold}o${ANSI.reset}${ANSI.red} \\${ANSI.reset}`,
      `${ANSI.red}   |  ${ANSI.reset}${ANSI.bold}>${ANSI.reset}${ANSI.red}  |${ANSI.reset}`,
      `${ANSI.red}   /|   |\\${ANSI.reset}`,
      `${ANSI.red}  / |___| \\${ANSI.reset}`,
      `${ANSI.red} |  /   \\  |${ANSI.reset}`,
      `${ANSI.red} |_/     \\_|${ANSI.reset}`,
      `${ANSI.red}  V       V${ANSI.reset}`,
      `${ANSI.red}  |_|   |_|${ANSI.reset}`,
    ],
    hatchedEmoji: "🦞",
    waitingMessages: [
      "Warming up the egg...",
      "Getting cozy in there...",
      "Preparing the nest...",
      "Gathering shell fragments...",
    ],
    runningMessages: [
      "Running startup script...",
      "Teaching the hatchling to code...",
      "Growing stronger...",
      "Almost ready to peek out...",
    ],
  },
  vellum: {
    label: "ANU",
    color: ANSI.brightBlue,
    // The ANU mark in six lines: six rays, branches on the vertical pair, and
    // an open core (see assets/brand/BRAND.md).
    art: [
      `${ANSI.brightBlue}       |${ANSI.reset}`,
      `${ANSI.brightBlue} \`-.  \\|/  .-'${ANSI.reset}`,
      `${ANSI.brightBlue}    \`-/ \\-'${ANSI.reset}`,
      `${ANSI.brightBlue}    .-\\ /-.${ANSI.reset}`,
      `${ANSI.brightBlue} .-'  /|\\  \`-.${ANSI.reset}`,
      `${ANSI.brightBlue}       |${ANSI.reset}`,
    ],
    hatchedEmoji: "✼",
    waitingMessages: [
      "Waiting for the assistant to start...",
      "Waiting for the gateway...",
    ],
    runningMessages: [
      "Running startup script...",
      "Starting the assistant...",
      "Checking health...",
    ],
  },
};
