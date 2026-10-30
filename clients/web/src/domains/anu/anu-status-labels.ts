/** The catalog key that names each task status. */
export const ANU_STATUS_LABEL_KEY = {
  queued: "anuTaskStatus.queued",
  running: "anuTaskStatus.running",
  awaiting_approval: "anuTaskStatus.awaiting_approval",
  succeeded: "anuTaskStatus.succeeded",
  failed: "anuTaskStatus.failed",
  stopped: "anuTaskStatus.stopped",
} as const;
