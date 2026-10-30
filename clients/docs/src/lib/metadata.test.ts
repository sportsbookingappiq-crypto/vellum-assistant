import { describe, expect, test } from "bun:test";

import { agentMarkdownPathForPage } from "@/lib/agent-markdown-paths";
import { createMetadata } from "@/lib/metadata";

describe("createMetadata", () => {
  test("builds the canonical URL from SITE_URL and path", () => {
    const metadata = createMetadata({
      title: "Pricing",
      description: "ANU pricing",
      path: "/docs/pricing",
    });

    expect(metadata.alternates?.canonical).toBe(
      "https://www.anu.ai/docs/pricing",
    );
  });

  test("adds a .md markdown alternate for a docs page", () => {
    const metadata = createMetadata({
      title: "Pricing",
      description: "ANU pricing",
      path: "/docs/pricing",
    });

    expect(metadata.alternates?.types).toEqual({
      "text/markdown": "https://www.anu.ai/docs/pricing.md",
    });
  });

  test("adds a markdown alternate for a nested docs path", () => {
    const metadata = createMetadata({
      title: "Privacy and Data",
      description: "Trust and security",
      path: "/docs/trust-security/privacy-and-data",
    });

    expect(metadata.alternates?.types).toEqual({
      "text/markdown":
        "https://www.anu.ai/docs/trust-security/privacy-and-data.md",
    });
  });

  test("uses the static docs OG image for OG and Twitter cards", () => {
    const metadata = createMetadata({
      title: "Pricing",
      description: "ANU pricing",
      path: "/docs/pricing",
    });

    expect(metadata.openGraph?.images).toEqual([
      {
        url: "https://www.anu.ai/docs/og.png",
        width: 1200,
        height: 630,
        alt: "Pricing",
      },
    ]);
    expect(metadata.twitter?.images).toEqual([
      {
        url: "https://www.anu.ai/docs/og.png",
        alt: "Pricing",
      },
    ]);
  });

  test("maps the docs index to /docs/index.md", () => {
    const metadata = createMetadata({
      title: "Docs",
      description: "ANU docs",
      path: "/docs",
    });

    expect(metadata.alternates?.canonical).toBe("https://www.anu.ai/docs");
    expect(metadata.alternates?.types).toEqual({
      "text/markdown": "https://www.anu.ai/docs/index.md",
    });
  });
});

describe("agentMarkdownPathForPage", () => {
  test("returns undefined for non-docs paths", () => {
    expect(agentMarkdownPathForPage("/blog/some-post")).toBeUndefined();
    expect(agentMarkdownPathForPage("/")).toBeUndefined();
  });
});
