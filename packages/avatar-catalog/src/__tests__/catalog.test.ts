import { describe, expect, test } from "bun:test";

import { getCharacterComponents, SCLERA } from "../index.js";
import { accentHexForColorId, AVATAR_COLORS } from "../colors.js";
import {
  avatarTraitLabel,
  BODY_SHAPE_LABELS,
  COLOR_LABELS,
  EYE_STYLE_LABELS,
} from "../labels.js";

/**
 * Trait ids are persisted in workspace avatar manifests, on pinned apps, and in
 * the iOS and Android alternate icon names, so the set is pinned here: a
 * redesign changes what an id draws, never which ids exist.
 */
const PERSISTED_BODY_IDS = [
  "blob",
  "cloud",
  "sprout",
  "star",
  "ghost",
  "urchin",
  "stack",
  "flower",
  "burst",
  "ninja",
  "stellar",
  "dendrite",
];
const PERSISTED_EYE_IDS = [
  "grumpy",
  "angry",
  "curious",
  "goofy",
  "surprised",
  "bashful",
  "gentle",
  "quirky",
  "dazed",
];
const PERSISTED_COLOR_IDS = [
  "green",
  "orange",
  "pink",
  "purple",
  "teal",
  "yellow",
];

/** Absolute moveto/lineto/curveto/close only: every number is half of an x,y pair. */
const PAIRED_PATH = /^(?:[MLC](?:-?\d+(?:\.\d+)?[ ]?)+|Z)+$/;

function numbersOf(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

const components = getCharacterComponents();

describe("avatar catalog ids", () => {
  test("keeps every persisted body shape id", () => {
    expect(components.bodyShapes.map((b) => b.id).sort()).toEqual(
      [...PERSISTED_BODY_IDS].sort(),
    );
  });

  test("keeps every persisted eye style id", () => {
    expect(components.eyeStyles.map((e) => e.id).sort()).toEqual(
      [...PERSISTED_EYE_IDS].sort(),
    );
  });

  test("keeps every persisted colour id", () => {
    expect(AVATAR_COLORS.map((c) => c.id).sort()).toEqual(
      [...PERSISTED_COLOR_IDS].sort(),
    );
    expect(components.colors).toBe(AVATAR_COLORS);
  });

  test("no id carries an underscore (Android resource names swap dashes for them)", () => {
    for (const id of [...PERSISTED_EYE_IDS, ...PERSISTED_COLOR_IDS]) {
      expect(id).not.toContain("_");
    }
  });
});

describe("avatar catalog geometry", () => {
  test("body paths are paired absolute path data inside their viewBox", () => {
    for (const body of components.bodyShapes) {
      expect(body.svgPath).toMatch(PAIRED_PATH);
      const nums = numbersOf(body.svgPath);
      expect(nums.length % 2).toBe(0);
      // Curve control points may poke a little past the ink, never far.
      const slack = 0.02 * Math.max(body.viewBox.width, body.viewBox.height);
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]!).toBeGreaterThanOrEqual(-slack);
        expect(nums[i]!).toBeLessThanOrEqual(body.viewBox.width + slack);
        expect(nums[i + 1]!).toBeGreaterThanOrEqual(-slack);
        expect(nums[i + 1]!).toBeLessThanOrEqual(body.viewBox.height + slack);
      }
      expect(body.faceCenter.x).toBeGreaterThan(0);
      expect(body.faceCenter.x).toBeLessThan(body.viewBox.width);
      expect(body.faceCenter.y).toBeGreaterThan(0);
      expect(body.faceCenter.y).toBeLessThan(body.viewBox.height);
    }
  });

  test("eye paths are paired absolute path data in sclera or pupil", () => {
    for (const eye of components.eyeStyles) {
      expect(eye.paths.length).toBeGreaterThan(0);
      for (const path of eye.paths) {
        expect(path.svgPath).toMatch(PAIRED_PATH);
        expect(path.color).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  test("every eye style has sclera, so a themed-icon mask is never empty", () => {
    for (const eye of components.eyeStyles) {
      expect(eye.paths.some((path) => path.color === SCLERA)).toBe(true);
    }
  });

  test("face-centre overrides name real traits", () => {
    const bodies = new Set(PERSISTED_BODY_IDS);
    const eyes = new Set(PERSISTED_EYE_IDS);
    for (const override of components.faceCenterOverrides) {
      expect(bodies.has(override.bodyShape)).toBe(true);
      expect(eyes.has(override.eyeStyle)).toBe(true);
    }
  });
});

describe("avatar palette", () => {
  test("every colour is a distinct #RRGGBB hex", () => {
    for (const color of AVATAR_COLORS) {
      expect(color.hex).toMatch(/^#[0-9A-F]{6}$/);
    }
    expect(new Set(AVATAR_COLORS.map((c) => c.hex)).size).toBe(
      AVATAR_COLORS.length,
    );
  });

  test("resolves a colour id to its hex, and anything else to null", () => {
    expect(accentHexForColorId(AVATAR_COLORS[0]!.id)).toBe(
      AVATAR_COLORS[0]!.hex,
    );
    expect(accentHexForColorId("nope")).toBeNull();
    expect(accentHexForColorId(null)).toBeNull();
    expect(accentHexForColorId(undefined)).toBeNull();
  });
});

describe("avatar trait labels", () => {
  test("every trait id has a label", () => {
    for (const id of PERSISTED_BODY_IDS) {
      expect(BODY_SHAPE_LABELS[id]).toBeTruthy();
    }
    for (const id of PERSISTED_EYE_IDS) {
      expect(EYE_STYLE_LABELS[id]).toBeTruthy();
    }
    for (const id of PERSISTED_COLOR_IDS) {
      expect(COLOR_LABELS[id]).toBeTruthy();
    }
  });

  test("labels resolve by kind and fall back to the id", () => {
    expect(avatarTraitLabel("bodyShape", "blob")).toBe(BODY_SHAPE_LABELS.blob!);
    expect(avatarTraitLabel("color", "teal")).toBe(COLOR_LABELS.teal!);
    expect(avatarTraitLabel("eyeStyle", "future-style")).toBe("future-style");
    expect(avatarTraitLabel("color", "toString")).toBe("toString");
  });
});
