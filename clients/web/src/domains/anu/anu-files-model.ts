/**
 * How a workspace file is shown: decided from its content type first and its
 * extension second, because a sandbox often serves source code as
 * `text/plain` or `application/octet-stream`.
 */

import type { AnuStep } from "./anu-api";

export type AnuPreviewKind =
  | "image"
  | "pdf"
  | "markdown"
  | "csv"
  | "json"
  | "code"
  | "text"
  | "download";

/** Extension to the highlight.js language registered in `anu-code-view`. */
export const CODE_LANGUAGES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  sh: "bash",
  bash: "bash",
  html: "xml",
  xml: "xml",
  svg: "xml",
  css: "css",
  yml: "yaml",
  yaml: "yaml",
  sql: "sql",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
};

export function fileExtension(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function previewKind(path: string, contentType: string): AnuPreviewKind {
  const type = contentType.toLowerCase();
  const ext = fileExtension(path);
  if (
    (type.startsWith("image/") && type !== "image/svg+xml") ||
    ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)
  ) {
    return "image";
  }
  if (type === "application/pdf" || ext === "pdf") {
    return "pdf";
  }
  if (type === "text/markdown" || ext === "md" || ext === "markdown") {
    return "markdown";
  }
  if (type === "text/csv" || ext === "csv") {
    return "csv";
  }
  if (type === "application/json" || ext === "json") {
    return "json";
  }
  // HTML, SVG, XML and JavaScript are served as text/plain on purpose, so
  // they are always shown as source, never rendered.
  if (ext in CODE_LANGUAGES) {
    return "code";
  }
  if (type.startsWith("text/") || ["txt", "log", "env", "ini", "toml"].includes(ext)) {
    return "text";
  }
  return "download";
}

/**
 * RFC 4180 CSV: quoted fields may hold commas, line breaks and doubled
 * quotes. Rows are returned as written; the caller treats the first as the
 * header.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The newest `browser` step, which carries the page the agent is on. */
export function latestBrowserStep(steps: readonly AnuStep[]): AnuStep | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index]?.kind === "browser") {
      return steps[index];
    }
  }
  return undefined;
}

/** The parent of a workspace path ("" is the root). */
export function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

/**
 * Where the agent's browser is now: the URL and action of the newest
 * browser step or message, whether or not it captured an image.
 */
export function browserPlace(
  items: ReadonlyArray<{ kind: string | null; detail: unknown }>,
): { url: string | null; action: string | null } | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "browser") {
      continue;
    }
    const detail =
      typeof item.detail === "object" && item.detail !== null
        ? (item.detail as Record<string, unknown>)
        : {};
    return {
      url: typeof detail.url === "string" ? detail.url : null,
      action: typeof detail.action === "string" ? detail.action : null,
    };
  }
  return null;
}

/** The host of a URL for a compact chip, or the URL itself if it will not parse. */
export function urlHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
