#!/usr/bin/env bun

import { join } from "path";
import { readFileSync } from "node:fs";

import { resolveConfigDir, SigningKeyContinuityError } from "@anu/local-mode";

import { emitCliError } from "./lib/cli-error.js";

import cliPkg from "../package.json";
import { backup } from "./commands/backup";
import { clean } from "./commands/clean";
import { client } from "./commands/client";
import { confirm } from "./commands/confirm";
import { connect } from "./commands/connect";
import { devices } from "./commands/devices";
import { env } from "./commands/env";
import { events } from "./commands/events";
import { exec } from "./commands/exec";
import { flags } from "./commands/flags";
import { gateway } from "./commands/gateway";
import { hatch } from "./commands/hatch";
import { login, logout, whoami } from "./commands/login";
import { logs } from "./commands/logs";
import { message } from "./commands/message";
import { pair } from "./commands/pair";
import { ps } from "./commands/ps";
import { recover } from "./commands/recover";
import { restore } from "./commands/restore";
import { roadmap } from "./commands/roadmap";
import { retire } from "./commands/retire";
import { rollback } from "./commands/rollback";
import { setup } from "./commands/setup";
import { sleep } from "./commands/sleep";
import { ssh } from "./commands/ssh";
import { debugBundle } from "./commands/debug-bundle";
import { teleport } from "./commands/teleport";
import { terminal } from "./commands/terminal";
import { tunnel } from "./commands/tunnel";
import { unpair } from "./commands/unpair";
import { upgrade } from "./commands/upgrade";
import { use } from "./commands/use";
import { voice } from "./commands/voice";
import { wake } from "./commands/wake";
import { workflows } from "./commands/workflows";
import { resolveAssistant, setActiveAssistant } from "./lib/assistant-config";
import { loadGuardianToken } from "./lib/guardian-token";
import { checkHealth } from "./lib/health-check";

const commands = {
  "debug-bundle": debugBundle,
  backup,
  clean,
  client,
  confirm,
  connect,
  devices,
  env,
  events,
  exec,
  flags,
  gateway,
  hatch,
  login,
  logout,
  logs,
  message,
  pair,
  ps,
  recover,
  restore,
  retire,
  roadmap,
  rollback,
  setup,
  sleep,
  ssh,
  teleport,
  terminal,
  tunnel,
  unpair,
  upgrade,
  use,
  voice,
  wake,
  whoami,
  workflows,
} as const;

type CommandName = keyof typeof commands;

const HELP_GROUPS = [
  "Create and run",
  "Talk to an assistant",
  "Data and versions",
  "Remote access",
  "Platform account",
  "Troubleshoot",
] as const;

/**
 * Top-level help, grouped by what a person is trying to do. Typed as a
 * `Record<CommandName, ...>` so adding a command without a help line fails
 * the type check. Commands print in insertion order within each group.
 */
const COMMAND_HELP: Record<
  CommandName,
  readonly [group: (typeof HELP_GROUPS)[number], description: string]
> = {
  hatch: [
    "Create and run",
    "Create an assistant: local (default), Docker, or ANU platform",
  ],
  wake: ["Create and run", "Start a local or Docker assistant and its gateway"],
  sleep: ["Create and run", "Stop the assistant and gateway; data is kept"],
  ps: [
    "Create and run",
    "List assistants, or one assistant's processes and health",
  ],
  use: [
    "Create and run",
    "Choose the assistant other commands target by default",
  ],
  setup: [
    "Create and run",
    "Store a model provider API key on the active assistant",
  ],
  client: [
    "Talk to an assistant",
    "Chat in this terminal, or open the web client",
  ],
  message: ["Talk to an assistant", "Send one message and exit"],
  events: [
    "Talk to an assistant",
    "Stream replies, tool calls, and confirmations live",
  ],
  confirm: [
    "Talk to an assistant",
    "Allow or deny a pending tool confirmation",
  ],
  voice: [
    "Talk to an assistant",
    "Type to an assistant and hear it answer out loud",
  ],
  workflows: ["Talk to an assistant", "Inspect and control workflow runs"],
  backup: [
    "Data and versions",
    "Export a running assistant to a .vbundle archive",
  ],
  restore: [
    "Data and versions",
    "Restore data (and optionally a version) from a .vbundle",
  ],
  teleport: [
    "Data and versions",
    "Move an assistant between local, Docker, and platform",
  ],
  upgrade: ["Data and versions", "Upgrade an assistant to a newer version"],
  rollback: ["Data and versions", "Return an assistant to a previous version"],
  retire: ["Data and versions", "Delete an assistant and its data"],
  recover: ["Data and versions", "Bring back a retired local assistant"],
  tunnel: ["Remote access", "Put a local assistant behind an HTTPS tunnel"],
  pair: [
    "Remote access",
    "Print a pairing link and QR code for another device [beta]",
  ],
  connect: [
    "Remote access",
    "Pair with an assistant on another machine [beta]",
  ],
  devices: [
    "Remote access",
    "List or revoke devices paired to a local assistant [beta]",
  ],
  unpair: [
    "Remote access",
    "Forget an assistant paired from another machine [beta]",
  ],
  terminal: [
    "Remote access",
    "Open a shell in a managed assistant's container",
  ],
  ssh: ["Remote access", "SSH into a remote assistant instance"],
  exec: ["Remote access", "Run a command inside an assistant's container"],
  login: ["Platform account", "Log in to the ANU platform"],
  logout: ["Platform account", "Log out of the ANU platform"],
  whoami: ["Platform account", "Show the logged-in platform user"],
  env: [
    "Platform account",
    "Show or set the default environment (production, local, ...)",
  ],
  roadmap: ["Platform account", "List and edit items on the ANU roadmap"],
  logs: ["Troubleshoot", "Show an assistant's logs"],
  flags: ["Troubleshoot", "Show and toggle feature flags"],
  gateway: ["Troubleshoot", "Manage gateway authentication tokens"],
  clean: [
    "Troubleshoot",
    "Stop leftover ANU processes that no assistant tracks",
  ],
  "debug-bundle": [
    "Troubleshoot",
    "Send ANU staff a debug bundle of a self-hosted assistant",
  ],
};

function printHelp(): void {
  const entries = Object.entries(COMMAND_HELP);
  const width = Math.max(...entries.map(([name]) => name.length)) + 2;
  console.log("anu: create, run, and talk to ANU assistants.");
  console.log("");
  console.log("Usage: anu <command> [options]");
  console.log("");
  console.log(
    "With no command, anu opens the chat client for the active assistant if it",
  );
  console.log("is running, and prints this help otherwise.");
  for (const group of HELP_GROUPS) {
    console.log("");
    console.log(`${group}:`);
    for (const [name, [entryGroup, description]] of entries) {
      if (entryGroup === group) {
        console.log(`  ${name.padEnd(width)}${description}`);
      }
    }
  }
  console.log("");
  console.log("Options:");
  console.log(
    "  --no-color, --plain   Turn off colored output (honors NO_COLOR)",
  );
  console.log("  --version, -v         Print the CLI version");
  console.log("  --help, -h            Show this help");
  console.log("");
  console.log(
    "Run 'anu <command> --help' for a command's options and examples.",
  );
  console.log("First time? Run 'anu hatch', then 'anu client'.");
}

/**
 * Check for --no-color / --plain flags and set NO_COLOR env var
 * before any terminal capability detection runs.
 *
 * Per https://no-color.org/, setting NO_COLOR to any non-empty value
 * signals that color output should be suppressed.
 */
function applyNoColorFlags(argv: string[]): void {
  if (argv.includes("--no-color") || argv.includes("--plain")) {
    process.env.NO_COLOR = "1";
  }
}

/**
 * Load env vars from the vellum config dotenv file into `process.env` so
 * that `anu hatch` forwards provider API keys to containers and other
 * commands have access to them.
 *
 * Reads `$XDG_CONFIG_HOME/vellum{-env}/.env` — the same config directory
 * the CLI uses for guardian tokens and environment state. The file is
 * written by remote-hatch scripts and can be user-managed.
 *
 * Existing `process.env` values take precedence (standard dotenv convention).
 * Only KEY=VALUE lines are parsed. Lines starting with # are comments.
 * Values may be quoted with single or double quotes.
 */
function loadConfigDotenv(): void {
  const configDir = resolveConfigDir(process.env);
  const envPath = join(configDir, ".env");

  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) continue;

    // Existing env vars take precedence (dotenv convention).
    if (process.env[key] !== undefined) continue;

    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

/**
 * If a running assistant is detected, launch the TUI client and return true.
 * Otherwise return false so the caller can fall back to help text.
 */
async function tryLaunchClient(): Promise<boolean> {
  const entry = resolveAssistant();

  if (!entry) return false;

  const url = entry.localUrl || entry.runtimeUrl;
  if (!url) return false;

  const token = loadGuardianToken(entry.assistantId)?.accessToken;
  const result = await checkHealth(url, token);
  if (result.status !== "healthy") return false;

  // Ensure the resolved assistant is active so client() can find it
  // (client() independently reads the active assistant from config).
  setActiveAssistant(String(entry.assistantId));

  await client();
  return true;
}

async function main() {
  // Load $XDG_CONFIG_HOME/vellum/.env before any command runs so
  // provider API keys and other config are available to hatch, exec, etc.
  loadConfigDotenv();

  const args = process.argv.slice(2);

  // Must run before any command or terminal-capabilities usage
  applyNoColorFlags(args);

  // Global flags that are not command names
  const GLOBAL_FLAGS = new Set(["--no-color", "--plain"]);
  const commandName = args.find((a) => !GLOBAL_FLAGS.has(a));

  // Strip global flags from process.argv so subcommands that parse
  // process.argv.slice(3) don't see them as positional arguments.
  const filteredArgs = args.filter((a) => !GLOBAL_FLAGS.has(a));
  process.argv = [...process.argv.slice(0, 2), ...filteredArgs];

  if (commandName === "--version" || commandName === "-v") {
    console.log(`@anu/cli v${cliPkg.version}`);
    process.exit(0);
  }

  if (commandName === "--help" || commandName === "-h") {
    printHelp();
    process.exit(0);
  }

  if (!commandName) {
    const launched = await tryLaunchClient();
    if (!launched) {
      printHelp();
    }
    process.exit(0);
  }

  const command = commands[commandName as CommandName];

  if (!command) {
    console.error(
      `Unknown command '${commandName}'. Run 'anu --help' to see all commands.`,
    );
    process.exit(1);
  }

  try {
    await command();
  } catch (error) {
    if (error instanceof SigningKeyContinuityError) {
      emitCliError("AUTH_IDENTITY_UNAVAILABLE", error.message, error.code);
    }
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
