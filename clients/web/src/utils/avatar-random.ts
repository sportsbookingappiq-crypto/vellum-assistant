/**
 * Generate random character traits for the hatching avatar. The trait
 * space is defined by the bundled character components: body shapes,
 * eye styles, and colors. Each axis is sampled uniformly at random.
 */
import type { CharacterComponents, CharacterTraits } from "@/types/avatar";

export function randomCharacterTraits(
  components: CharacterComponents,
): CharacterTraits {
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const bodyShape = pick(components.bodyShapes).id;
  const eyeStyle = pick(components.eyeStyles).id;
  return {
    bodyShape,
    // Stellar is the brand's own character and never hatches looking shocked.
    eyeStyle:
      bodyShape === "stellar" && eyeStyle === "surprised" ? "quirky" : eyeStyle,
    color: pick(components.colors).id,
  };
}
