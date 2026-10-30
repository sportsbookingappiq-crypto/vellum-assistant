/**
 * The task's workspace: what the agent read and wrote, browsable as folders
 * and opened in place. One region at a time, like the rest of the phone app:
 * the folder, or the file with a way back to it.
 */

import { Button, Skeleton } from "@anu/design-library";
import { ChevronLeft, File, Folder } from "lucide-react";
import { useState } from "react";

import { useTranslation } from "@/i18n";

import { parentPath } from "../anu-files-model";
import { useAnuFiles } from "../use-anu-queries";
import { AnuFilePreview } from "./anu-file-preview";

interface AnuFilesViewProps {
  taskId: string;
}

export function AnuFilesView({ taskId }: AnuFilesViewProps) {
  const { t, i18n } = useTranslation("anu");
  const [folder, setFolder] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const listing = useAnuFiles(taskId, folder);
  const bytes = new Intl.NumberFormat(i18n.language, {
    notation: "compact",
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
  });

  const back = (label: string, onClick: () => void) => (
    <Button
      variant="ghost"
      shape="pill"
      leftIcon={<ChevronLeft size={18} className="rtl:-scale-x-100" />}
      onClick={onClick}
      className="-ms-2 mb-3"
    >
      {label}
    </Button>
  );

  if (file !== null) {
    return (
      <div>
        {back(folder || t("anuFiles.workspace"), () => setFile(null))}
        <h3 className="mb-4 break-all font-mono text-[14px] text-[var(--content-emphasised)]" dir="ltr">
          {file}
        </h3>
        <AnuFilePreview taskId={taskId} path={file} />
      </div>
    );
  }

  return (
    <div>
      {folder
        ? back(parentPath(folder) || t("anuFiles.workspace"), () =>
            setFolder(parentPath(folder)),
          )
        : null}
      {listing.isPending ? (
        <div className="flex flex-col gap-4" aria-busy>
          <Skeleton className="h-5 w-2/3 rounded" />
          <Skeleton className="h-5 w-1/2 rounded" />
        </div>
      ) : listing.isError ? (
        <p className="text-[15px] text-[var(--content-secondary)]">
          {t("anuFiles.loadError")}
        </p>
      ) : listing.data.entries.length === 0 ? (
        <p className="text-[15px] text-[var(--content-secondary)]">
          {t("anuFiles.empty")}
        </p>
      ) : (
        <ul>
          {listing.data.entries
            .filter(
              (entry) =>
                (entry.type === "file" || entry.type === "directory") &&
                !entry.name.startsWith("."),
            )
            .map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                onClick={() =>
                  entry.type === "directory"
                    ? setFolder(entry.path)
                    : setFile(entry.path)
                }
                className="flex min-h-12 w-full items-center gap-3 border-b border-[var(--border-hover)] text-start outline-none keyboard-focus:ring-2 keyboard-focus:ring-[var(--ring)]"
              >
                {entry.type === "directory" ? (
                  <Folder aria-hidden size={18} strokeWidth={1.75} className="shrink-0 text-[var(--content-secondary)]" />
                ) : (
                  <File aria-hidden size={18} strokeWidth={1.75} className="shrink-0 text-[var(--content-tertiary)]" />
                )}
                <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-[15px] text-[var(--content-emphasised)]">
                  {entry.name}
                </span>
                {entry.type !== "directory" && entry.size != null ? (
                  <span className="text-[13px] tabular-nums text-[var(--content-tertiary)]">
                    {bytes.format(entry.size)}
                  </span>
                ) : null}
              </button>
            </li>
            ))}
        </ul>
      )}
    </div>
  );
}
