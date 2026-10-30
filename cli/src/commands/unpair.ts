/**
 * `anu unpair <name> [--yes]`
 *
 * Forget a pairing imported from another machine via `anu connect import`:
 * remove its lockfile entry and stored guardian token from THIS machine. Only
 * paired assistants (`cloud: "paired"`) can be unpaired — `anu retire` owns
 * local and managed assistants.
 *
 * This is client-side only: it forgets the connection here but does not revoke
 * the device on the host. (Host-side revocation is `anu devices`.)
 */

import {
  formatAssistantLookupError,
  getAssistantDisplayName,
  lookupAssistantByIdentifier,
  removeAssistantEntry,
} from "../lib/assistant-config";
import { parseAssistantTargetArg } from "../lib/assistant-target-args.js";
import {
  canPromptForConfirmation,
  confirmAction,
} from "../lib/confirm-action.js";
import { deleteGuardianToken } from "../lib/guardian-token";

function printUsage(): void {
  console.log(`anu unpair [beta] - Forget a paired assistant imported from another machine

USAGE:
    anu unpair <name> [--yes]

ARGUMENTS:
    <name>    Name or id of the paired assistant to forget

OPTIONS:
    --yes     Skip the interactive confirmation prompt (for automation)

Removes the local connection (lockfile entry + stored token). Only paired
assistants (imported via 'anu connect import') can be unpaired; use
'anu retire' for local or managed assistants.

EXAMPLES:
    anu unpair paired-desk
    anu unpair "Desk Box"
    anu unpair paired-desk --yes
`);
}

export async function unpair(): Promise<void> {
  const args = process.argv.slice(3);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const yes = args.includes("--yes");
  const name = parseAssistantTargetArg(args, []);
  if (!name) {
    console.error("Error: assistant name or id is required.");
    printUsage();
    process.exit(1);
  }

  const lookup = lookupAssistantByIdentifier(name);
  if (lookup.status !== "found") {
    console.error(formatAssistantLookupError(name, lookup));
    process.exit(1);
  }
  const entry = lookup.entry;

  if (entry.cloud !== "paired") {
    console.error(
      `Error: '${name}' is not a paired assistant. Use \`anu retire\` to remove a local or managed assistant.`,
    );
    process.exit(1);
  }

  // Print the resolved identity before acting (cli/AGENTS.md).
  const displayName = getAssistantDisplayName(entry);
  console.log("Pairing to unpair:");
  if (displayName !== entry.assistantId) {
    console.log(`  Name: ${displayName}`);
  }
  console.log(`  ID: ${entry.assistantId}`);
  if (entry.runtimeUrl) {
    console.log(`  Host: ${entry.runtimeUrl}`);
  }
  console.log("");

  if (!yes) {
    if (!canPromptForConfirmation()) {
      console.error(
        "Error: Refusing to unpair without confirmation in a non-interactive terminal.",
      );
      console.error("Re-run with --yes to confirm from automation.");
      process.exit(1);
    }
    const confirmed = await confirmAction(
      "Press Enter to unpair, or Esc/q to cancel: ",
    );
    if (!confirmed) {
      console.log("Unpair cancelled.");
      process.exit(1);
    }
  }

  removeAssistantEntry(entry.assistantId);
  deleteGuardianToken(entry.assistantId);

  console.log(
    `Unpaired '${name}'. Removed the local connection (lockfile entry + token).`,
  );
  console.log("");
  console.log(
    "Note: this only forgets the connection on this machine. The assistant's host can fully revoke this device from its side.",
  );
}
