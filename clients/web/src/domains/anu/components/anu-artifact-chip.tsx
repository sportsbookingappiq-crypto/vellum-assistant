/**
 * A compact link from a step or message to what it touched: the page the
 * browser opened, or a file it wrote. Tapping opens the full-screen viewer.
 */

import { FileText, Globe } from "lucide-react";
import { Link } from "react-router";

import { useTranslation } from "@/i18n";

interface AnuArtifactChipProps {
  kind: "browser" | "file";
  label: string;
  to: string;
}

export function AnuArtifactChip({ kind, label, to }: AnuArtifactChipProps) {
  const { t } = useTranslation("anu");
  const Icon = kind === "browser" ? Globe : FileText;
  return (
    <Link
      to={to}
      aria-label={
        kind === "browser"
          ? t("anuArtifactChip.openBrowser", { place: label })
          : t("anuArtifactChip.openFile", { file: label })
      }
      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-active)] px-3 py-1.5 text-[13px] text-[var(--content-default)] outline-none hover:bg-[var(--surface-hover)] keyboard-focus:ring-2 keyboard-focus:ring-[var(--ring)]"
    >
      <Icon aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-[var(--content-secondary)]" />
      <span dir="ltr" className="min-w-0 truncate">
        {label}
      </span>
    </Link>
  );
}
