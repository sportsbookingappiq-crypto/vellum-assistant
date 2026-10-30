import { describe, expect, test } from "bun:test";

import {
  AnuApiError,
  fetchAnuBrowser,
  fetchAnuFileContent,
  fetchAnuFiles,
  type AnuStep,
} from "./anu-api";
import { latestBrowserStep, parentPath, parseCsv, previewKind } from "./anu-files-model";

describe("previewKind", () => {
  test("chooses by content type, then extension", () => {
    expect(previewKind("shot.png", "image/png")).toBe("image");
    expect(previewKind("report.pdf", "application/pdf")).toBe("pdf");
    expect(previewKind("notes.md", "text/markdown")).toBe("markdown");
    expect(previewKind("data.csv", "text/csv")).toBe("csv");
    expect(previewKind("config.json", "application/json")).toBe("json");
    expect(previewKind("main.py", "text/plain")).toBe("code");
    expect(previewKind("summary.txt", "text/plain")).toBe("text");
    expect(previewKind("archive.zip", "application/zip")).toBe("download");
  });

  test("HTML and SVG served as text/plain are shown as source", () => {
    expect(previewKind("index.html", "text/plain")).toBe("code");
    expect(previewKind("logo.svg", "text/plain")).toBe("code");
    expect(previewKind("logo.svg", "image/svg+xml")).toBe("code");
  });
});

describe("parseCsv", () => {
  test("handles quotes, commas, doubled quotes and CRLF", () => {
    expect(parseCsv('name,note\r\n"Smith, A","said ""hi"""\nB,plain')).toEqual([
      ["name", "note"],
      ["Smith, A", 'said "hi"'],
      ["B", "plain"],
    ]);
  });
});

test("parentPath and latestBrowserStep", () => {
  expect(parentPath("docs/a/b.md")).toBe("docs/a");
  expect(parentPath("b.md")).toBe("");
  const step = (seq: number, kind: AnuStep["kind"]): AnuStep => ({
    id: `s${seq}`,
    taskId: "t",
    seq,
    kind,
    title: "",
    detail: {},
    status: "done",
    createdAt: "2026-10-29T10:00:00.000Z",
  });
  expect(latestBrowserStep([step(1, "browser"), step(2, "tool"), step(3, "browser")])?.seq).toBe(3);
});

function fakeFetch(status: number, body: BodyInit | null, type = "application/json") {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(body, { status, headers: { "content-type": type } });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

describe("files and browser client", () => {
  test("lists a folder and validates entry types", async () => {
    const { fetchImpl, urls } = fakeFetch(
      200,
      JSON.stringify({
        path: "docs",
        entries: [{ name: "a.md", path: "docs/a.md", type: "file", size: 12, mtime: "2026-10-29T10:00:00.000Z" }],
        truncated: false,
      }),
    );
    const list = await fetchAnuFiles("t-1", "docs", { token: "t", fetchImpl, baseUrl: "http://anu.test" });
    expect(list.entries[0]?.type).toBe("file");
    expect(urls[0]).toBe("http://anu.test/v1/tasks/t-1/files?path=docs");
  });

  test("file content keeps its content type", async () => {
    const { fetchImpl } = fakeFetch(200, "# Title", "text/markdown; charset=utf-8");
    const file = await fetchAnuFileContent("t-1", "a.md", { token: "t", fetchImpl, baseUrl: "http://anu.test" });
    expect(file.contentType).toBe("text/markdown");
    expect(await file.blob.text()).toBe("# Title");
  });

  test("a 413 on content is an AnuApiError", async () => {
    const { fetchImpl } = fakeFetch(413, null);
    const error = await fetchAnuFileContent("t-1", "big.bin", { token: "t", fetchImpl, baseUrl: "http://anu.test" }).catch((e: unknown) => e);
    expect((error as AnuApiError).status).toBe(413);
  });

  test("browser state parses latest and frames; 404 means none", async () => {
    const frame = { frameId: "f3", seq: 5, url: "https://example.com", action: "screenshot", contentType: "image/png", bytes: 10, capturedAt: "2026-10-29T10:00:00.000Z" };
    const ok = fakeFetch(200, JSON.stringify({ latest: frame, frames: [frame] }));
    const state = await fetchAnuBrowser("t-1", { token: "t", fetchImpl: ok.fetchImpl, baseUrl: "http://anu.test" });
    expect(state?.latest?.frameId).toBe("f3");
    const missing = fakeFetch(404, JSON.stringify({ error: { code: "not_found", message: "" } }));
    expect(await fetchAnuBrowser("t-1", { token: "t", fetchImpl: missing.fetchImpl, baseUrl: "http://anu.test" })).toBeNull();
  });
});
