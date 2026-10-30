import type { SubagentStatus } from "@anu/assistant-api";
import { statusColor, statusLabel } from "@/utils/subagent-status";
import { StatusBadgePill } from "@/domains/chat/components/status-badge-pill";

export function StatusBadge({ status }: { status: SubagentStatus }) {
  return (
    <StatusBadgePill color={statusColor(status)} label={statusLabel(status)} />
  );
}
