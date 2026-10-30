import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { HttpError } from "../lib/http.js";

/** Frames live in the task workspace, so they outlive the run and go with the workspace. */
export const FRAMES_DIR = path.join(".anu", "browser");
/** How many frames are kept per task. Older ones are deleted. */
export const MAX_FRAMES = 20;

export interface FrameMeta {
  frameId: string;
  seq: number;
  url: string | null;
  action: string;
  contentType: "image/png" | "image/jpeg";
  bytes: number;
  capturedAt: string;
}

interface FrameIndex {
  frames: FrameMeta[];
}

const FRAME_ID = /^f\d{1,9}$/;
const indexPath = (workspaceDir: string) => path.join(workspaceDir, FRAMES_DIR, "index.json");
const framePath = (workspaceDir: string, meta: FrameMeta) =>
  path.join(workspaceDir, FRAMES_DIR, `${meta.frameId}.${meta.contentType === "image/png" ? "png" : "jpg"}`);

async function readIndex(workspaceDir: string): Promise<FrameIndex> {
  try {
    const parsed = JSON.parse(await readFile(indexPath(workspaceDir), "utf8")) as FrameIndex;
    return Array.isArray(parsed.frames) ? parsed : { frames: [] };
  } catch {
    return { frames: [] };
  }
}

export function sniffImageType(data: Uint8Array): FrameMeta["contentType"] | null {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  return null;
}

/**
 * Stores a frame and prunes to the last MAX_FRAMES. Called from the worker,
 * which is the only writer for its task, so no locking is needed.
 */
export async function saveFrame(
  workspaceDir: string,
  frame: { data: Uint8Array; url: string | null; action: string },
): Promise<FrameMeta | null> {
  const contentType = sniffImageType(frame.data);
  if (!contentType) return null;
  await mkdir(path.join(workspaceDir, FRAMES_DIR), { recursive: true, mode: 0o700 });
  const index = await readIndex(workspaceDir);
  const seq = (index.frames.at(-1)?.seq ?? 0) + 1;
  const meta: FrameMeta = {
    frameId: `f${seq}`,
    seq,
    url: frame.url,
    action: frame.action.slice(0, 200),
    contentType,
    bytes: frame.data.length,
    capturedAt: new Date().toISOString(),
  };
  await writeFile(framePath(workspaceDir, meta), frame.data);
  index.frames.push(meta);
  const dropped = index.frames.splice(0, Math.max(0, index.frames.length - MAX_FRAMES));
  const tmp = `${indexPath(workspaceDir)}.tmp`;
  await writeFile(tmp, JSON.stringify(index));
  await rename(tmp, indexPath(workspaceDir));
  await Promise.all(dropped.map((old) => rm(framePath(workspaceDir, old), { force: true })));
  return meta;
}

export async function listFrames(workspaceDir: string): Promise<FrameMeta[]> {
  return (await readIndex(workspaceDir)).frames;
}

export async function readFrame(workspaceDir: string, frameId: string): Promise<Response> {
  if (!FRAME_ID.test(frameId)) throw new HttpError(400, "invalid_frame_id", "Invalid frame id");
  const meta = (await readIndex(workspaceDir)).frames.find((f) => f.frameId === frameId);
  if (!meta) throw new HttpError(404, "not_found", "Frame not found");
  let data: Buffer;
  try {
    data = await readFile(framePath(workspaceDir, meta));
  } catch {
    throw new HttpError(404, "not_found", "Frame not found");
  }
  return new Response(new Uint8Array(data), {
    headers: { "content-type": meta.contentType, "content-length": String(data.length), "cache-control": "private, max-age=3600" },
  });
}

// ---------- a tiny PNG encoder, for the scripted driver's fake frames ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** An RGB PNG of the given size; `pixel` returns [r, g, b] for each coordinate. */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]);
}
