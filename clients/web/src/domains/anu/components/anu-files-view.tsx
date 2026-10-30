/**
 * The Files window's list (spec A.3.12): what the bot made in this chat or
 * task, one row per file with its type, size and time beneath its name.
 * Folders open in place; a file opens its full-screen preview.
 */

import { ChevronRight, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import type { AnuFileList, AnuScope } from "../anu-api";
import { fileExtension, parentPath } from "../anu-files-model";
import { anuIntlLocale, useAnuFormat } from "../use-anu-format";
import { useAnuFiles } from "../use-anu-queries";
import { AnuEmptyBlock, AnuErrorBlock, AnuSkeletonRows, AnuTextButton } from "./anu-ui";

/** Files and folders the person cares about (no dot files). */
export function visibleEntries(list: AnuFileList | undefined) {
  return (list?.entries ?? []).filter(
    (entry) => (entry.type === "file" || entry.type === "directory") && !entry.name.startsWith("."),
  );
}

export function AnuFilesView({ scope, onCount }: { scope: AnuScope; onCount?: (count: number) => void }) {
  const { t, i18n } = useTranslation("anu");
  const format = useAnuFormat();
  const [folder, setFolder] = useState("");
  const listing = useAnuFiles(scope, folder);
  const entries = visibleEntries(listing.data);
  const bytes = new Intl.NumberFormat(anuIntlLocale(i18n.language), {
    notation: "compact",
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
  });
  const fileCount = folder === "" && listing.data ? entries.filter((entry) => entry.type === "file").length : null;
  useEffect(() => {
    if (fileCount !== null) {
      onCount?.(fileCount);
    }
  }, [fileCount, onCount]);

  return (
    <div>
      {folder ? (
        <AnuTextButton className="-ms-3 mb-1" onClick={() => setFolder(parentPath(folder))}>
          {parentPath(folder) || t("anuFiles.title")}
        </AnuTextButton>
      ) : null}
      {listing.isPending ? (
        <AnuSkeletonRows count={4} avatar={0} height={60} label={t("anuCommon.loading")} />
      ) : listing.isError ? (
        <AnuErrorBlock message={t("anuFiles.loadError")} onRetry={() => void listing.refetch()} />
      ) : entries.length === 0 ? (
        <AnuEmptyBlock message={t("anuFiles.empty")} />
      ) : (
        <ul>
          {entries.map((entry) => {
            const meta = [
              entry.type === "directory" ? t("anuFiles.folder") : fileExtension(entry.path).toUpperCase() || t("anuFiles.file"),
              entry.type !== "directory" && entry.size != null ? bytes.format(entry.size) : null,
              entry.mtime ? format.relative(entry.mtime) : null,
            ]
              .filter(Boolean)
              .join(", ");
            const content = (
              <>
                {entry.type === "directory" ? (
                  <Folder aria-hidden size={20} strokeWidth={1.75} className="shrink-0 text-[var(--anu-muted)]" />
                ) : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span dir="ltr" className="truncate text-start text-[15px]">
                    {entry.name}
                  </span>
                  <span className="truncate text-[13px] text-[var(--anu-muted)]">{meta}</span>
                </span>
                <ChevronRight aria-hidden size={18} className="shrink-0 text-[var(--anu-muted)] rtl:-scale-x-100" />
              </>
            );
            return (
              <li key={entry.path}>
                {entry.type === "directory" ? (
                  <button
                    type="button"
                    onClick={() => setFolder(entry.path)}
                    className="flex min-h-[60px] w-full items-center gap-3 text-start"
                  >
                    {content}
                  </button>
                ) : (
                  <Link
                    to={routes.anu.files(scope.kind, scope.id, entry.path)}
                    className="flex min-h-[60px] w-full items-center gap-3"
                  >
                    {content}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
