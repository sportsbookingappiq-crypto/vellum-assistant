import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Sql } from "../db/client.js";
import { encodePng, MAX_FRAMES, saveFrame } from "../sandbox/browser-frames.js";
import { adminSql, makeTestApi, resetPhones, type TestApi } from "../test/helpers.js";

const OWNER = "+16065550100";
const OTHER = "+16065550101";

let sql: Sql;
let t: TestApi;
let token: string;
let otherToken: string;
let taskId: string;
let ws: string;
const outside = mkdtempSync(path.join(os.tmpdir(), "anu-outside-"));

beforeAll(async () => {
  sql = await adminSql();
  await resetPhones(sql, [OWNER, OTHER]);
  t = makeTestApi();
  token = await t.login(OWNER);
  otherToken = await t.login(OTHER);
  const res = await t.call("POST", "/v1/tasks", { token, body: { goal: "Workspace files" } });
  taskId = ((await res.json()) as { id: string }).id;
  ws = path.join(t.sandbox.workspaceRoot, taskId);
  mkdirSync(path.join(ws, "docs", "deep"), { recursive: true });
  writeFileSync(path.join(ws, "summary.md"), "# Summary\n");
  writeFileSync(path.join(ws, "data.json"), '{"a":1}');
  writeFileSync(path.join(ws, "page.html"), "<script>alert(1)</script>");
  writeFileSync(path.join(ws, "docs", "deep", "note.txt"), "hello");
  writeFileSync(path.join(outside, "secret.txt"), "top secret");
  symlinkSync(path.join(outside, "secret.txt"), path.join(ws, "escape.txt"));
  symlinkSync(outside, path.join(ws, "escape-dir"));
  symlinkSync(path.join(ws, "summary.md"), path.join(ws, "inside-link.md"));
});

afterAll(async () => {
  await t.close();
  await sql.end();
});

const get = (p: string, as = token) => t.call("GET", p, { token: as });

describe("task workspace files", () => {
  test("lists the root and subdirectories with name, type, size, mtime", async () => {
    const res = await get(`/v1/tasks/${taskId}/files`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; entries: { name: string; type: string; size: number; mtime: string }[] };
    expect(body.path).toBe("");
    const byName = Object.fromEntries(body.entries.map((e) => [e.name, e]));
    expect(byName.docs).toMatchObject({ type: "directory", path: "docs" });
    expect(byName["summary.md"]).toMatchObject({ type: "file", size: 10 });
    expect(byName["escape.txt"]!.type).toBe("symlink");
    expect(Date.parse(byName["summary.md"]!.mtime)).toBeGreaterThan(0);

    const sub = (await (await get(`/v1/tasks/${taskId}/files?path=docs/deep`)).json()) as { path: string; entries: { path: string }[] };
    expect(sub.path).toBe("docs/deep");
    expect(sub.entries.map((e) => e.path)).toEqual(["docs/deep/note.txt"]);
  });

  test("returns content with a correct content type", async () => {
    const md = await get(`/v1/tasks/${taskId}/files/content?path=summary.md`);
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(await md.text()).toBe("# Summary\n");
    const jsonRes = await get(`/v1/tasks/${taskId}/files/content?path=data.json`);
    expect(jsonRes.headers.get("content-type")).toContain("application/json");
    // Active content is never served as HTML.
    const html = await get(`/v1/tasks/${taskId}/files/content?path=page.html`);
    expect(html.headers.get("content-type")).toBe("text/plain;charset=utf-8");
    expect(html.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await get(`/v1/tasks/${taskId}/files/content?path=inside-link.md`)).status).toBe(200);
    expect((await get(`/v1/tasks/${taskId}/files/content?path=docs`)).status).toBe(400);
    expect((await get(`/v1/tasks/${taskId}/files/content?path=missing.txt`)).status).toBe(404);
  });

  test("rejects traversal and symlink escapes", async () => {
    for (const p of ["../x", "docs/../../x", "..", "/etc/passwd", "docs/%2e%2e/%2e%2e/etc/passwd", "a%00b"]) {
      const res = await get(`/v1/tasks/${taskId}/files/content?path=${p}`);
      expect([400, 403, 404]).toContain(res.status);
      expect(await res.text()).not.toContain("root:");
    }
    expect((await get(`/v1/tasks/${taskId}/files/content?path=escape.txt`)).status).toBe(403);
    expect((await get(`/v1/tasks/${taskId}/files?path=escape-dir`)).status).toBe(403);
    expect((await get(`/v1/tasks/${taskId}/files/content?path=escape-dir/secret.txt`)).status).toBe(403);
  });

  test("other users get 404 and the sandbox is not asked", async () => {
    const before = t.sandbox.calls.filter((c) => c.op === "read").length;
    for (const p of ["files", "files/content?path=summary.md", "browser", "browser/frame?frameId=f1"]) {
      expect((await get(`/v1/tasks/${taskId}/${p}`, otherToken)).status).toBe(404);
    }
    expect((await t.call("GET", `/v1/tasks/${taskId}/files`)).status).toBe(401);
    expect(t.sandbox.calls.filter((c) => c.op === "read").length).toBe(before);
  });
});

describe("browser frames", () => {
  test("keeps the last N frames and serves them as images", async () => {
    const empty = (await (await get(`/v1/tasks/${taskId}/browser`)).json()) as { latest: unknown };
    expect(empty.latest).toBeNull();
    for (let i = 0; i < MAX_FRAMES + 2; i++) {
      await saveFrame(ws, { data: encodePng(2, 2, () => [i, 0, 0]), url: `https://example.com/${i}`, action: "navigate" });
    }
    const body = (await (await get(`/v1/tasks/${taskId}/browser`)).json()) as {
      latest: { frameId: string; url: string };
      frames: { frameId: string }[];
    };
    expect(body.latest).toMatchObject({ frameId: `f${MAX_FRAMES + 2}`, url: `https://example.com/${MAX_FRAMES + 1}` });
    expect(body.frames.length).toBe(MAX_FRAMES);
    const frame = await get(`/v1/tasks/${taskId}/browser/frame?frameId=${body.latest.frameId}`);
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await frame.arrayBuffer()).slice(1, 4)).toEqual(new TextEncoder().encode("PNG"));
    expect((await get(`/v1/tasks/${taskId}/browser/frame?frameId=f1`)).status).toBe(404); // pruned
    expect((await get(`/v1/tasks/${taskId}/browser/frame?frameId=../x`)).status).toBe(400);
  });

  test("the browser step kind is accepted by the database", async () => {
    const res = await t.call("POST", `/internal/v1/tasks/${taskId}/steps`, {
      token: t.config.ANU_INTERNAL_TOKEN,
      body: { kind: "browser", title: "Browser navigate", detail: { url: "https://example.com", action: "navigate", frameId: "f1" } },
    });
    expect(res.status).toBe(201);
  });
});
