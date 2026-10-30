// Direct import — bun embeds this at compile time so it works in compiled binaries.
import cliPkg from "../../package.json";

import {
  saveAssistantEntry,
  setActiveAssistant,
} from "../lib/assistant-config";
import {
  SPECIES_CONFIG,
  VALID_REMOTE_HOSTS,
  VALID_SPECIES,
} from "../lib/constants";
import type { RemoteHost, Species } from "../lib/constants";
import { hatchDocker } from "../lib/docker";
import { parseFeatureFlagArgs, readAmbientFlagEnvVars } from "../lib/flag-args";
import { hatchLocal } from "../lib/hatch-local";
import {
  getPlatformUrl,
  hatchAssistant,
  readPlatformToken,
} from "../lib/platform-client";
import { validateAssistantName } from "../lib/retire-archive";

const DEFAULT_SPECIES: Species = "vellum";

const DEFAULT_REMOTE: RemoteHost = "local";

interface HatchArgs {
  species: Species;
  detached: boolean;
  keepAlive: boolean;
  name: string | null;
  remote: RemoteHost;
  watch: boolean;
  sourcePath: string | null;
  preview: boolean;
  configValues: Record<string, string>;
  flagEnvVars: Record<string, string>;
  analyze: boolean;
  disablePlatform: boolean;
  netnsContainer: string | null;
  gatewayPort: number | null;
  assistantCaCert: string | null;
}

function parseArgs(): HatchArgs {
  const { envVars: cliFlagVars, remaining: args } = parseFeatureFlagArgs(
    process.argv.slice(3),
  );
  const flagEnvVars = { ...readAmbientFlagEnvVars(), ...cliFlagVars };
  const disablePlatformAmbient =
    process.env.VELLUM_DISABLE_PLATFORM?.trim().toLowerCase();
  let disablePlatform =
    disablePlatformAmbient === "true" || disablePlatformAmbient === "1";
  let species: Species = DEFAULT_SPECIES;
  let detached = false;
  let keepAlive = false;
  let name: string | null = null;
  let remote: RemoteHost = DEFAULT_REMOTE;
  let watch = false;
  let sourcePath: string | null = null;
  let preview = false;
  const configValues: Record<string, string> = {};
  let analyze = false;
  let netnsContainer: string | null = null;
  let gatewayPort: number | null = null;
  let assistantCaCert: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: anu hatch [species] [options]");
      console.log("");
      console.log(
        "Create an assistant, start it, and make it the active assistant.",
      );
      console.log(
        "Assistants are recorded in ~/.vellum.lock.json (or the env-scoped lockfile).",
      );
      console.log("");
      console.log("Species:");
      console.log("  vellum       The ANU assistant runtime (default)");
      console.log("  openclaw     OpenClaw runtime behind the ANU gateway");
      console.log("");
      console.log("Options:");
      console.log(
        "  --remote <host>           Where to run it: local (default), docker, vellum (ANU platform), custom (not implemented)",
      );
      console.log(
        "  --name <name>             Instance name. Default: a generated name",
      );
      console.log(
        "  -d                        Docker only: return once containers start instead of watching startup",
      );
      console.log(
        "  --keep-alive              Local only: stay in the foreground after hatch; exit when the gateway stops",
      );
      console.log(
        "  --watch                   Run assistant and gateway in watch mode (hot reload on source changes)",
      );
      console.log(
        "  --source <path>           Docker only: build images from the source tree at <path> (no watcher)",
      );
      console.log(
        "  --preview                 Docker only: pull the latest preview release instead of latest stable. Same as VELLUM_HATCH_CHANNEL=preview",
      );
      console.log(
        "  --config <key=value>      Set a workspace config value (repeatable)",
      );
      console.log(
        "  --flag <key=value>        Set a feature flag override as VELLUM_FLAG_<KEY> (repeatable)",
      );
      console.log(
        "  --analyze                 Print a structured hatch-timing log line on stdout",
      );
      console.log(
        "  --disable-platform        Make no outbound ANU platform API calls",
      );
      console.log(
        "  --netns-container <name>  Docker only: join an existing container's network namespace instead of creating a network. Requires --gateway-port",
      );
      console.log(
        "  --gateway-port <port>     Docker only: use this host port for the gateway instead of picking a free one",
      );
      console.log(
        "  --assistant-ca-cert <path>  Docker only: trust an extra PEM CA bundle in the assistant container (NODE_EXTRA_CA_CERTS), for TLS-terminating egress proxies",
      );
      console.log("");
      console.log("Examples:");
      console.log(
        "  anu hatch                                  # local assistant",
      );
      console.log(
        "  anu hatch --remote docker --name research  # Docker containers named 'research'",
      );
      console.log(
        "  anu hatch --remote vellum                  # on the ANU platform (run 'anu login' first)",
      );
      console.log("");
      console.log(
        "After hatching: 'anu client' to chat, 'anu sleep' to stop, 'anu retire <name>' to delete.",
      );
      process.exit(0);
    } else if (arg === "-d") {
      detached = true;
    } else if (arg === "--watch") {
      watch = true;
    } else if (arg === "--analyze") {
      analyze = true;
    } else if (arg === "--preview") {
      preview = true;
    } else if (arg === "--source") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("Error: --source requires a path argument");
        process.exit(1);
      }
      sourcePath = next;
      i++;
    } else if (arg === "--keep-alive") {
      keepAlive = true;
    } else if (arg === "--name") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("Error: --name requires a value");
        process.exit(1);
      }
      try {
        validateAssistantName(next);
      } catch {
        console.error(
          `Error: --name '${next}' is not allowed. Names cannot contain '/' or '\\', or be '.' or '..'.`,
        );
        process.exit(1);
      }
      name = next;
      i++;
    } else if (arg === "--remote") {
      const next = args[i + 1];
      if (!next || !VALID_REMOTE_HOSTS.includes(next as RemoteHost)) {
        console.error(
          `Error: --remote requires one of: ${VALID_REMOTE_HOSTS.join(", ")}`,
        );
        process.exit(1);
      }
      remote = next as RemoteHost;
      i++;
    } else if (arg === "--config") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("Error: --config requires a key=value argument");
        process.exit(1);
      }
      const eqIndex = next.indexOf("=");
      if (eqIndex <= 0) {
        console.error(
          `Error: --config value must be in key=value format, got '${next}'`,
        );
        process.exit(1);
      }
      const key = next.slice(0, eqIndex);
      const value = next.slice(eqIndex + 1);
      configValues[key] = value;
      i++;
    } else if (arg === "--disable-platform") {
      disablePlatform = true;
    } else if (arg === "--netns-container") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("Error: --netns-container requires a container name");
        process.exit(1);
      }
      netnsContainer = next;
      i++;
    } else if (arg === "--gateway-port") {
      const next = args[i + 1];
      const parsed = next ? Number(next) : NaN;
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
        console.error(
          "Error: --gateway-port requires an integer port in 1-65535",
        );
        process.exit(1);
      }
      gatewayPort = parsed;
      i++;
    } else if (arg === "--assistant-ca-cert") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("Error: --assistant-ca-cert requires a path argument");
        process.exit(1);
      }
      assistantCaCert = next;
      i++;
    } else if (VALID_SPECIES.includes(arg as Species)) {
      species = arg as Species;
    } else {
      console.error(
        `Error: Unknown argument '${arg}'. Species: ${VALID_SPECIES.join(", ")}. Run 'anu hatch --help' for all options.`,
      );
      process.exit(1);
    }
  }

  return {
    species,
    detached,
    keepAlive,
    name,
    remote,
    watch,
    sourcePath,
    preview,
    configValues,
    flagEnvVars,
    analyze,
    disablePlatform,
    netnsContainer,
    gatewayPort,
    assistantCaCert,
  };
}

export { hatchLocal };

function getCliVersion(): string {
  return cliPkg.version ?? "unknown";
}

export async function hatch(): Promise<void> {
  const cliVersion = getCliVersion();
  console.log(`@anu/cli v${cliVersion}`);

  const {
    species,
    detached,
    keepAlive,
    name,
    remote,
    watch,
    sourcePath,
    preview,
    configValues,
    flagEnvVars,
    analyze,
    disablePlatform,
    netnsContainer,
    gatewayPort,
    assistantCaCert,
  } = parseArgs();

  if (disablePlatform) {
    process.env.VELLUM_DISABLE_PLATFORM = "true";
    flagEnvVars.VELLUM_DISABLE_PLATFORM = "true";
  }

  if (watch && remote !== "local" && remote !== "docker") {
    console.error(
      "Error: --watch is only supported for local and docker hatch targets.",
    );
    process.exit(1);
  }

  if (sourcePath !== null && remote !== "docker") {
    console.error(
      "Error: --source is only supported for docker hatch targets.",
    );
    process.exit(1);
  }

  if (
    (netnsContainer !== null ||
      gatewayPort !== null ||
      assistantCaCert !== null) &&
    remote !== "docker"
  ) {
    console.error(
      "Error: --netns-container, --gateway-port, and --assistant-ca-cert are only supported for docker hatch targets.",
    );
    process.exit(1);
  }

  if (netnsContainer !== null && gatewayPort === null) {
    console.error(
      "Error: --gateway-port is required with --netns-container (the namespace owner publishes the port before hatch runs).",
    );
    process.exit(1);
  }

  if (remote === "local") {
    await hatchLocal(
      species,
      name,
      watch,
      keepAlive,
      configValues,
      flagEnvVars,
    );
    return;
  }

  if (remote === "docker") {
    await hatchDocker({
      species,
      detached,
      name,
      watch,
      configValues,
      flagEnvVars,
      sourcePath,
      analyze,
      channel: preview ? "preview" : undefined,
      netnsContainer: netnsContainer ?? undefined,
      gatewayPort: gatewayPort ?? undefined,
      assistantCaCertPath: assistantCaCert ?? undefined,
    });
    return;
  }

  if (remote === "vellum") {
    await hatchVellumPlatform();
    return;
  }

  console.error(`Error: Remote host '${remote}' is not yet supported.`);
  process.exit(1);
}

async function hatchVellumPlatform(): Promise<void> {
  const token = readPlatformToken();
  if (!token) {
    console.error(
      "Not logged in to the ANU platform. Run 'anu login', then 'anu hatch --remote vellum' again.",
    );
    process.exit(1);
  }

  const config = SPECIES_CONFIG.vellum;
  console.log("");
  for (const line of config.art) {
    console.log(`   ${line}`);
  }
  console.log("");
  console.log("   Hatching assistant on ANU platform...");
  console.log("");

  const { assistant: result } = await hatchAssistant(token);

  const platformUrl = getPlatformUrl();

  saveAssistantEntry({
    assistantId: result.id,
    runtimeUrl: platformUrl,
    cloud: "vellum",
    species: "vellum",
    hatchedAt: new Date().toISOString(),
  });
  setActiveAssistant(result.id);

  console.log(
    `   ${config.hatchedEmoji}  Assistant hatched on the ANU platform.`,
  );
  console.log("");
  console.log(`   ID:     ${result.id}`);
  console.log(`   Name:   ${result.name}`);
  console.log(`   Status: ${result.status}`);
  console.log("");
  console.log("   It is now the active assistant. Chat with it: anu client");
  console.log("");
}
