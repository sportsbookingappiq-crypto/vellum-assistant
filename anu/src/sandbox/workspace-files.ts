import { lstat, open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "../lib/http.js";

/** Largest file the content endpoint returns. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Most entries one directory listing returns. */
export const MAX_LIST_ENTRIES = 1000;

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
  mtime: string;
}

/**
 * Resolves a client-supplied relative path inside a workspace. Rejects absolute
 * paths, `..` segments, NUL bytes, and anything whose real path (after following
 * symlinks) lies outside the workspace's real path.
 */
export async function resolveInside(root: string, relative: string): Promise<{ abs: string; rel: string }> {
  if (relative.includes("\0")) throw new HttpError(400, "invalid_path", "Invalid path");
  const cleaned = relative.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.split("/").some((part) => part === "..")) throw new HttpError(400, "invalid_path", "Path must stay inside the workspace");
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    throw new HttpError(404, "not_found", "Workspace not found");
  }
  const joined = path.resolve(realRoot, cleaned || ".");
  let real: string;
  try {
    real = await realpath(joined);
  } catch {
    throw new HttpError(404, "not_found", "File not found");
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new HttpError(403, "path_outside_workspace", "Path must stay inside the workspace");
  }
  return { abs: real, rel: path.relative(realRoot, real).split(path.sep).join("/") };
}

export async function listDirectory(root: string, relative: string): Promise<{ path: string; entries: FileEntry[]; truncated: boolean }> {
  const { abs, rel } = await resolveInside(root, relative);
  if (!(await stat(abs)).isDirectory()) throw new HttpError(400, "not_a_directory", "Path is not a directory");
  const dirents = await readdir(abs, { withFileTypes: true });
  dirents.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  const entries: FileEntry[] = [];
  for (const dirent of dirents.slice(0, MAX_LIST_ENTRIES)) {
    try {
      const info = await lstat(path.join(abs, dirent.name));
      entries.push({
        name: dirent.name,
        path: rel ? `${rel}/${dirent.name}` : dirent.name,
        type: info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
        size: info.isFile() ? info.size : 0,
        mtime: info.mtime.toISOString(),
      });
    } catch {
      // Removed while listing.
    }
  }
  return { path: rel, entries, truncated: dirents.length > MAX_LIST_ENTRIES };
}

/** Content types that a browser could execute are served as plain text. */
const ACTIVE_TYPES = /^(text\/html|application\/xhtml|image\/svg|application\/xml|text\/xml|application\/javascript|text\/javascript)/;

export function contentTypeFor(file: string): string {
  const type = Bun.file(file).type || "application/octet-stream";
  if (ACTIVE_TYPES.test(type)) return "text/plain;charset=utf-8";
  return type;
}

export async function readWorkspaceFile(root: string, relative: string): Promise<Response> {
  const { abs, rel } = await resolveInside(root, relative);
  const info = await stat(abs);
  if (!info.isFile()) throw new HttpError(400, "not_a_file", "Path is not a regular file");
  if (info.size > MAX_FILE_BYTES) throw new HttpError(413, "file_too_large", `Files over ${MAX_FILE_BYTES} bytes cannot be downloaded`);
  const handle = await open(abs, "r");
  let data: Buffer;
  try {
    data = await handle.readFile();
  } finally {
    await handle.close();
  }
  const name = path.basename(rel).replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": contentTypeFor(abs),
      "content-length": String(data.length),
      "content-disposition": `inline; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'",
      "last-modified": info.mtime.toUTCString(),
      "cache-control": "private, no-store",
    },
  });
}
