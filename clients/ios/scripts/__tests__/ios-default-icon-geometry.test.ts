/**
 * Drift guard for the iOS default app icon geometry.
 *
 * The ANU snowflake is duplicated by design between the brand sources in
 * `assets/brand/`, the three Icon Composer bundles, and the widget extension's
 * asset catalog, which draws the app's mark on the New Chat surfaces; asset
 * catalogs cannot read the brand folder, so the path data is embedded verbatim
 * and this test pins every copy to the brand source. A change to the mark, or a
 * hand edit to any one copy's SVG, fails here until every copy agrees again.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../../../..");
const IOS_APP_DIR = join(REPO_ROOT, "clients/ios/App");
const BRAND_DIR = join(REPO_ROOT, "assets/brand");

/** The icon bundles and the layer each one draws. */
const BUNDLES = [
  { icon: "AppIcon.icon", layer: "anu-mark.svg" },
  { icon: "AppIcon-Dev.icon", layer: "anu-mark-night.svg" },
  { icon: "AppIcon-Staging.icon", layer: "anu-mark-night.svg" },
] as const;

const WIDGET_MARK =
  "VoiceActivity/Assets.xcassets/VellumAppIconEyes.imageset/anu-mark.svg";

function pathData(svg: string): string[] {
  return [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

function fills(svg: string): string[] {
  return [...svg.matchAll(/<path\b[^>]*\bfill="([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

function readBrand(name: string): string {
  return readFileSync(join(BRAND_DIR, name), "utf8");
}

function readBundleLayer(icon: string, layer: string): string {
  return readFileSync(join(IOS_APP_DIR, "App", icon, "Assets", layer), "utf8");
}

describe("ios default icon geometry", () => {
  // anu-mark.svg holds the silhouette then the lit facets; favicon.svg holds
  // the same pair for the small-size cut.
  const markPaths = pathData(readBrand("anu-mark.svg"));
  const smallPaths = pathData(readBrand("favicon.svg"));

  test("the brand sources carry a silhouette and a facet path", () => {
    expect(markPaths.length).toBe(2);
    expect(smallPaths.length).toBe(2);
  });

  for (const { icon, layer } of BUNDLES) {
    test(`${icon} names a layer that exists`, () => {
      const manifest = JSON.parse(
        readFileSync(join(IOS_APP_DIR, "App", icon, "icon.json"), "utf8"),
      );
      const names = manifest.groups.flatMap(
        (group: { layers: Array<{ "image-name": string }> }) =>
          group.layers.map((entry) => entry["image-name"]),
      );
      expect(names).toEqual([layer]);
      expect(existsSync(join(IOS_APP_DIR, "App", icon, "Assets", layer))).toBe(
        true,
      );
    });

    test(`${icon} embeds the brand mark paths verbatim`, () => {
      expect(pathData(readBundleLayer(icon, layer))).toEqual(markPaths);
    });
  }

  test("Dev and Staging share one layer byte for byte", () => {
    expect(readBundleLayer("AppIcon-Dev.icon", "anu-mark-night.svg")).toBe(
      readBundleLayer("AppIcon-Staging.icon", "anu-mark-night.svg"),
    );
  });

  test("the widget mark embeds the small-size brand paths verbatim", () => {
    const widget = readFileSync(join(IOS_APP_DIR, WIDGET_MARK), "utf8");
    expect(pathData(widget)).toEqual(smallPaths);
  });

  test("the widget mark wears the production layer's two tones", () => {
    const widget = readFileSync(join(IOS_APP_DIR, WIDGET_MARK), "utf8");
    expect(fills(widget)).toEqual(
      fills(readBundleLayer("AppIcon.icon", "anu-mark.svg")),
    );
  });

  test("every layer keeps the 100x100 brand canvas", () => {
    const layers = [
      ...BUNDLES.map(({ icon, layer }) => readBundleLayer(icon, layer)),
      readFileSync(join(IOS_APP_DIR, WIDGET_MARK), "utf8"),
    ];
    for (const svg of layers) {
      expect(svg).toContain(
        '<svg width="100" height="100" viewBox="0 0 100 100"',
      );
    }
  });
});
