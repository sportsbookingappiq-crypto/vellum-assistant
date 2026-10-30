import { describe, expect, test } from "bun:test";

import { buildLlmsText } from "./llms-text";

describe("buildLlmsText", () => {
  test("lists pages sorted by route with .md URLs and descriptions", () => {
    const text = buildLlmsText([
      {
        route: "/docs/pricing",
        title: "Pricing",
        description: "ANU pricing",
      },
      {
        route: "/docs/getting-started",
        title: "Getting Started",
        description: "Install ANU",
      },
    ]);

    const bullets = text
      .split("\n")
      .filter((line) => line.startsWith("- "));
    expect(bullets).toEqual([
      "- [Getting Started](https://www.anu.ai/docs/getting-started.md): Install ANU",
      "- [Pricing](https://www.anu.ai/docs/pricing.md): ANU pricing",
    ]);
  });

  test("maps the docs index route to index.md and omits empty descriptions", () => {
    const text = buildLlmsText([
      { route: "/docs", title: "ANU Docs", description: "" },
    ]);

    expect(text).toContain("- [ANU Docs](https://www.anu.ai/docs/index.md)");
    expect(text).not.toContain("index.md):");
  });

  test("starts with the header and ends with a single trailing newline", () => {
    const text = buildLlmsText([]);

    expect(text.startsWith("# ANU Docs\n")).toBe(true);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  test("throws for a route outside /docs", () => {
    expect(() =>
      buildLlmsText([{ route: "/blog/post", title: "Post", description: "" }]),
    ).toThrow("No markdown alternate path");
  });
});
