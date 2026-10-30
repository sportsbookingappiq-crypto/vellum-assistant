/**
 * Printed after a successful local or Docker hatch. Hatch makes the new
 * assistant active, so these commands target it without a name.
 */
export function logHatchNextSteps(
  log: (message: string) => void,
  instanceName: string,
): void {
  log(`Next steps (${instanceName} is now the active assistant):`);
  log("  anu client            Chat with it in this terminal");
  log(
    "  anu message \"hello\"   Send one message; watch the reply with 'anu events'",
  );
  log(
    "  anu ps                Check that the assistant and gateway are healthy",
  );
  log(
    "  anu sleep             Stop it; data is kept. 'anu wake' starts it again",
  );
  log("");
}
