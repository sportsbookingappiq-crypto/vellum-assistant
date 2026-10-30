import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { randomCharacterTraits } from "@/utils/avatar-random";
import { BUNDLED_COMPONENTS } from "@/utils/avatar-bundled-components";

afterEach(() => {
  (Math.random as unknown as { mockRestore?: () => void }).mockRestore?.();
});

describe("randomCharacterTraits", () => {
  test("gives a stellar body the wink when the draw lands on wide-eyed", () => {
    const { bodyShapes, eyeStyles } = BUNDLED_COMPONENTS;
    const bodyDraw =
      (bodyShapes.findIndex((b) => b.id === "stellar") + 0.5) /
      bodyShapes.length;
    const eyeDraw =
      (eyeStyles.findIndex((e) => e.id === "surprised") + 0.5) /
      eyeStyles.length;
    const draws = [bodyDraw, eyeDraw, 0];
    spyOn(Math, "random").mockImplementation(() => draws.shift() ?? 0);

    const traits = randomCharacterTraits(BUNDLED_COMPONENTS);

    expect(traits.bodyShape).toBe("stellar");
    expect(traits.eyeStyle).toBe("quirky");
  });
});
