/**
 * The Files window (spec A.3.12): `/anu/chat/:sessionId/files` and
 * `/anu/tasks/:taskId/files`, full screen over the chat or task, with the
 * count in its title. `.../files/:path` is the File preview, full screen
 * too, with Share and Save. Closing either goes back one level.
 */

import { Download, Share2 } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import { useTranslation } from "@/i18n";
import { routes } from "@/utils/routes";

import type { AnuScope } from "./anu-api";
import { AnuFilePreview } from "./components/anu-file-preview";
import { AnuFilesView } from "./components/anu-files-view";
import { AnuIconButton, AnuScreen } from "./components/anu-ui";
import { useAnuFormat } from "./use-anu-format";
import { useAnuFileContent } from "./use-anu-queries";

async function shareFile(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name }).catch(() => undefined);
    return;
  }
  saveFile(blob, name);
}

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function FilePreviewWindow({ scope, path, fallback }: { scope: AnuScope; path: string; fallback: string }) {
  const { t } = useTranslation("anu");
  const content = useAnuFileContent(scope, path);
  const name = path.split("/").pop() ?? path;
  const blob = content.data?.blob;
  return (
    <AnuScreen
      overlay
      fallback={fallback}
      title={<span dir="ltr">{name}</span>}
      trailing={
        blob ? (
          <>
            <AnuIconButton label={t("anuFiles.share")} onClick={() => void shareFile(blob, name)}>
              <Share2 aria-hidden size={20} strokeWidth={1.75} />
            </AnuIconButton>
            <AnuIconButton label={t("anuFiles.save")} onClick={() => saveFile(blob, name)}>
              <Download aria-hidden size={20} strokeWidth={1.75} />
            </AnuIconButton>
          </>
        ) : null
      }
    >
      <AnuFilePreview scope={scope} path={path} />
    </AnuScreen>
  );
}

function FilesWindow({ kind, id }: { kind: "tasks" | "sessions"; id: string }) {
  const { t } = useTranslation("anu");
  const format = useAnuFormat();
  const { path } = useParams();
  const [count, setCount] = useState<number | null>(null);
  const scope = { kind, id };
  const home = kind === "tasks" ? routes.anu.task(id) : routes.anu.chat(id);
  if (path) {
    return <FilePreviewWindow scope={scope} path={decodeURIComponent(path)} fallback={routes.anu.files(kind, id)} />;
  }
  return (
    <AnuScreen
      overlay
      fallback={home}
      title={
        <span className="flex items-baseline gap-2">
          {t("anuFiles.title")}
          {count ? (
            <span className="text-[15px] font-normal text-[var(--anu-muted)]">
              {t("anuFiles.count", { count, n: format.number(count) })}
            </span>
          ) : null}
        </span>
      }
    >
      <AnuFilesView scope={scope} onCount={setCount} />
    </AnuScreen>
  );
}

export function AnuTaskFilesPage() {
  const { taskId = "" } = useParams();
  return <FilesWindow kind="tasks" id={taskId} />;
}

export function AnuSessionFilesPage() {
  const { sessionId = "" } = useParams();
  return <FilesWindow kind="sessions" id={sessionId} />;
}
