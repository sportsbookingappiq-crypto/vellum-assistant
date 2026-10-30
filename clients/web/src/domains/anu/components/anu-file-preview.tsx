/**
 * One workspace file, shown the way its type reads best: markdown rendered,
 * code highlighted, a CSV as a table, JSON as a tree, images and PDFs
 * inline, and anything else as a download. Bodies arrive as blobs over the
 * authorised fetch, so every inline view reads from an object URL or text.
 */

import { Button, MarkdownMessage, Skeleton } from "@anu/design-library";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/i18n";

import {
  CODE_LANGUAGES,
  fileExtension,
  parseCsv,
  previewKind,
} from "../anu-files-model";
import { useAnuFileContent } from "../use-anu-queries";
import { AnuCodeView } from "./anu-code-view";
import { AnuJsonTree } from "./anu-json-tree";

const CSV_ROW_LIMIT = 500;

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function useBlobText(blob: Blob | undefined, wanted: boolean): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || !wanted) {
      setText(null);
      return;
    }
    let live = true;
    void blob.text().then((value) => {
      if (live) {
        setText(value);
      }
    });
    return () => {
      live = false;
    };
  }, [blob, wanted]);
  return text;
}

function CsvTable({ text }: { text: string }) {
  const { t } = useTranslation("anu");
  const rows = useMemo(() => parseCsv(text), [text]);
  const [header, ...body] = rows;
  if (!header) {
    return null;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th
                key={index}
                className="border-b border-[var(--border-element)] px-2 py-2 text-start font-medium text-[var(--content-secondary)]"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.slice(0, CSV_ROW_LIMIT).map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-[var(--border-hover)]">
              {row.map((cell, index) => (
                <td key={index} className="px-2 py-1.5 text-[var(--content-default)]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {body.length > CSV_ROW_LIMIT ? (
        <p className="mt-2 text-[13px] text-[var(--content-secondary)]">
          {t("anuFiles.csvTruncated", { shown: CSV_ROW_LIMIT, total: body.length })}
        </p>
      ) : null}
    </div>
  );
}

interface AnuFilePreviewProps {
  taskId: string;
  path: string;
}

export function AnuFilePreview({ taskId, path }: AnuFilePreviewProps) {
  const { t } = useTranslation("anu");
  const content = useAnuFileContent(taskId, path);
  const kind = content.data ? previewKind(path, content.data.contentType) : null;
  const isText =
    kind === "markdown" ||
    kind === "csv" ||
    kind === "json" ||
    kind === "code" ||
    kind === "text";
  const text = useBlobText(content.data?.blob, isText);
  const url = useObjectUrl(content.data?.blob);
  const name = path.split("/").pop() ?? path;

  if (content.isError) {
    return (
      <p className="text-[15px] text-[var(--content-secondary)]">
        {t("anuFiles.previewError")}
      </p>
    );
  }
  if (!content.data || (isText && text === null)) {
    return <Skeleton className="h-40 w-full rounded-xl" />;
  }

  const download = url ? (
    <Button asChild variant="outlined" shape="pill" leftIcon={<Download size={16} />}>
      <a href={url} download={name}>
        {t("anuFiles.download")}
      </a>
    </Button>
  ) : null;

  switch (kind) {
    case "image":
      return url ? (
        <img
          src={url}
          alt={name}
          className="max-h-[70vh] w-auto max-w-full rounded-xl bg-[var(--surface-sunken)]"
        />
      ) : null;
    case "pdf":
      return url ? (
        <div className="flex flex-col gap-3">
          <object
            data={url}
            type="application/pdf"
            aria-label={name}
            className="h-[70vh] w-full rounded-xl bg-[var(--surface-sunken)]"
          />
          {download}
        </div>
      ) : null;
    case "markdown":
      return <MarkdownMessage content={text ?? ""} />;
    case "csv":
      return <CsvTable text={text ?? ""} />;
    case "json": {
      const parsed = parseJson(text ?? "");
      return parsed.ok ? (
        <div dir="ltr" className="-ms-4 font-mono text-[13px] leading-6">
          <AnuJsonTree value={parsed.value} />
        </div>
      ) : (
        <AnuCodeView code={text ?? ""} language={undefined} />
      );
    }
    case "code":
      return (
        <AnuCodeView
          code={text ?? ""}
          language={CODE_LANGUAGES[fileExtension(path)]}
        />
      );
    case "text":
      return <AnuCodeView code={text ?? ""} language={undefined} />;
    default:
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="text-[15px] text-[var(--content-secondary)]">
            {t("anuFiles.noPreview")}
          </p>
          {download}
        </div>
      );
  }
}
