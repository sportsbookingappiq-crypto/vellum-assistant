/**
 * Drift guard for the Android launcher icon geometry.
 *
 * The ANU snowflake is duplicated by design across the brand sources in
 * `assets/brand/` and the Android launcher XMLs (the adaptive foreground, the
 * themed-icon mask, and the two pre-adaptive fallbacks). Android resources
 * cannot read the brand folder, so the path data is embedded verbatim and this
 * test pins the copies to the brand source: a change to the mark, or a hand
 * edit to any one launcher XML, fails here until every copy agrees again.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../../../..");
const ANDROID_RES = join(REPO_ROOT, "clients/android/app/src/main/res");

const LAUNCHER_XMLS = [
  "drawable/ic_launcher_foreground.xml",
  "mipmap-anydpi/ic_launcher.xml",
  "mipmap-anydpi/ic_launcher_round.xml",
];

/** The mark's center in its 100x100 brand canvas. */
const MARK_CENTER = 50;

function brandPaths(): string[] {
  const svg = readFileSync(
    join(REPO_ROOT, "assets/brand/anu-mark.svg"),
    "utf8",
  );
  return [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

function extractMarkPaths(xml: string): Array<{ fill: string; d: string }> {
  const paths: Array<{ fill: string; d: string }> = [];
  const pathTag = /<path\b[^>]*\/>/gs;
  for (const match of xml.match(pathTag) ?? []) {
    const fill = /android:fillColor="([^"]+)"/.exec(match)?.[1];
    const d = /android:pathData="([^"]+)"/.exec(match)?.[1];
    if (fill === undefined || d === undefined) {
      continue;
    }
    if (fill.startsWith("@color/")) {
      // The pre-adaptive launchers paint their own background path from the
      // flavor's launcher_background resource; only literal-color paths are
      // mark geometry.
      continue;
    }
    paths.push({ fill, d });
  }
  return paths;
}

describe("android launcher icon geometry", () => {
  const [silhouette] = brandPaths();

  for (const relativePath of LAUNCHER_XMLS) {
    test(`${relativePath} draws the brand silhouette in solid black`, () => {
      const xml = readFileSync(join(ANDROID_RES, relativePath), "utf8");
      expect(extractMarkPaths(xml)).toEqual([
        { fill: "#000000", d: silhouette },
      ]);
    });
  }
});

describe("android themed icon mask", () => {
  test("ic_launcher_monochrome.xml embeds the brand silhouette verbatim", () => {
    const xml = readFileSync(
      join(ANDROID_RES, "drawable/ic_launcher_monochrome.xml"),
      "utf8",
    );
    expect(extractMarkPaths(xml).map(({ d }) => d)).toEqual([brandPaths()[0]]);
  });
});

describe("android launcher icon transforms", () => {
  const GROUP_ATTRS = [
    "pivotX",
    "pivotY",
    "scaleX",
    "scaleY",
    "translateX",
    "translateY",
  ] as const;

  function extractTransform(relativePath: string): Record<string, string> {
    const xml = readFileSync(join(ANDROID_RES, relativePath), "utf8");
    const transform: Record<string, string> = {};
    for (const attr of GROUP_ATTRS) {
      const value = new RegExp(`android:${attr}="([^"]+)"`).exec(xml)?.[1];
      if (value === undefined) {
        throw new Error(`${relativePath} is missing android:${attr}`);
      }
      transform[attr] = value;
    }
    return transform;
  }

  const adaptive = extractTransform("drawable/ic_launcher_foreground.xml");
  const monochrome = extractTransform("drawable/ic_launcher_monochrome.xml");
  const legacy = extractTransform("mipmap-anydpi/ic_launcher.xml");
  const legacyRound = extractTransform("mipmap-anydpi/ic_launcher_round.xml");

  test("every launcher group pivots on the mark center", () => {
    for (const transform of [adaptive, monochrome, legacy, legacyRound]) {
      expect(transform.pivotX).toBe(String(MARK_CENTER));
      expect(transform.pivotY).toBe(String(MARK_CENTER));
    }
  });

  test("the monochrome mask shares the adaptive foreground transform", () => {
    expect(monochrome).toEqual(adaptive);
  });

  test("both legacy fallbacks share one transform", () => {
    expect(legacyRound).toEqual(legacy);
  });

  test("every launcher group centers the pivot on the 108dp canvas", () => {
    // A VectorDrawable group maps the pivot to pivot + translate, so this sum
    // is the on-canvas position of the mark center and must be the canvas
    // center.
    for (const transform of [adaptive, monochrome, legacy, legacyRound]) {
      expect(Number(transform.pivotX) + Number(transform.translateX)).toBe(54);
      expect(Number(transform.pivotY) + Number(transform.translateY)).toBe(54);
    }
  });

  test("scales are uniform and the legacy scale fills the unmasked canvas", () => {
    expect(adaptive.scaleY).toBe(adaptive.scaleX);
    expect(legacy.scaleY).toBe(legacy.scaleX);
    expect(legacy.translateX).toBe(adaptive.translateX);
    expect(legacy.translateY).toBe(adaptive.translateY);
    // Legacy icons fill the full 108dp canvas while adaptive art targets the
    // 72dp a launcher mask reveals, so the scales differ by exactly 108/72.
    expect(Number(legacy.scaleX)).toBeCloseTo(
      Number(adaptive.scaleX) * 1.5,
      10,
    );
  });
});
