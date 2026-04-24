"use client";

/**
 * Sculpture color palette — single source of truth for light/dark modes.
 *
 * Dark mode swaps colors inside the R3F scene (CSS `filter: invert` breaks
 * on WebGL canvases). Consumers call `useSculpturePalette()` and pass the
 * resolved strings into material `color` props.
 *
 * Components re-render automatically when `body.sculpture-dark` toggles via
 * a MutationObserver on the body class attribute.
 */

import { useEffect, useState } from "react";
import { TUNING } from "./tuning";

export type SculpturePalette = {
  background: string;
  letterShard: string;
  frameShard: string;
  floor: string;
  /** Reflection strength of the ground plane (0 = invisible ground,
   *  no mirror; 1 = full reflection). Dark mode kills the reflection
   *  entirely so the "grey floor zone" disappears into the dark bg. */
  floorMirror: number;
  /** How much of the reflected scene mixes on top of the floor's
   *  base color. High = bright reflection; 0 = no visible reflection. */
  floorMixStrength: number;
  /** Contrast curve applied to the reflection. >1 = punchier; dim parts
   *  go darker, bright parts go brighter. */
  floorMixContrast: number;
  /** Per-mode blur settings for the reflection. Dark mode uses very
   *  small values so the reflection reads as a sharp silhouette of the
   *  bright shards instead of a grey haze. */
  floorReflectBlur: number;
  floorMixBlur: number;
  dust: string;
  projectsBase: string;
  projectsEmissive: string;
  projectsWire: string;
  keyLight: string;
  fillLight: string;
  rimLight: string;
};

const LIGHT: SculpturePalette = {
  background: TUNING.backgroundColor,
  letterShard: TUNING.letterShardColor,
  frameShard: TUNING.frameShardColor,
  floor: TUNING.floorColor,
  floorMirror: TUNING.floorReflectStrength,
  floorMixStrength: TUNING.floorMixStrength,
  /** Contrast curve applied to the reflection before it mixes with the
   *  base color. >1 = bright reflections brighter, dim reflections
   *  darker — lets us make the wordmark reflection pop while the dim
   *  plaque reflection disappears into the black floor. */
  floorMixContrast: 1.0,
  /** Reflection blur size. Light mode keeps the default soft mirror
   *  look; dark mode uses near-zero blur so the reflection reads as a
   *  crisp silhouette of the bright shards instead of a grey haze. */
  floorReflectBlur: TUNING.floorReflectBlur,
  floorMixBlur: TUNING.floorMixBlur,
  dust: TUNING.dustColor,
  projectsBase: "#5a5e66",
  projectsEmissive: "#ffd48a",
  projectsWire: "#9aa0a8",
  keyLight: "#fff4e0",
  fillLight: "#d0dbee",
  rimLight: "#ffffff",
};

// Dark mode — hand-tuned, not straight invert. The user wanted "darker
// darks, slightly whiter whites" so the contrast is punchier than a
// mechanical #faf8f3 → #050706 flip would give.
const DARK: SculpturePalette = {
  background: "#030405",
  letterShard: "#f2f0ea",
  frameShard: "#4b4741",
  // Dark mode: pure-black floor, sharp (near-zero-blur) reflection so
  // the bright wordmark + card shards appear as a crisp mirror image
  // instead of a blurry grey haze. Dim plaque pixels are still dark,
  // so they vanish into the black floor on their own.
  floor: "#000000",
  floorMirror: 1.0,
  floorMixStrength: 1.2,
  floorMixContrast: 1.0,
  floorReflectBlur: 1,
  floorMixBlur: 0,
  dust: "#e8e4d6",
  projectsBase: "#c6c2b8",
  projectsEmissive: "#ffd48a",
  projectsWire: "#7a7672",
  // Lights keep a warm/cool key so the sculpture doesn't look flat —
  // inverting a light source's color doesn't make physical sense.
  keyLight: "#fff4e0",
  fillLight: "#bcc7da",
  rimLight: "#e8ebf1",
};

export function useSculptureDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const update = () =>
      setDark(document.body.classList.contains("sculpture-dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export function useSculpturePalette(): SculpturePalette {
  return useSculptureDark() ? DARK : LIGHT;
}
