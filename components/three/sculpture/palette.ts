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
  /** Floor base color — kept equal to `background` in both modes so the
   *  ground plane itself never reads as a visible surface. Only the
   *  reflected sculpture on top of it is visible. This removes the
   *  "grey plane appears during light↔dark transition" artifact. */
  floor: string;
  /** Whether the ground plane uses MeshReflectorMaterial (true) or a
   *  plain meshBasicMaterial (false). Dark mode uses basic to avoid the
   *  blurred-reflection grey haze that drei's reflector bleeds even on
   *  a black base. */
  floorReflective: boolean;
  /** Reflection strength when `floorReflective`. 0-1. */
  floorMirror: number;
  /** How much of the reflected scene mixes on top of the floor's
   *  base color. High = bright reflection; 0 = no visible reflection. */
  floorMixStrength: number;
  /** Contrast curve applied to the reflection. >1 = punchier. */
  floorMixContrast: number;
  /** Per-mode blur settings for the reflection. */
  floorReflectBlur: number;
  floorMixBlur: number;
  dust: string;
  /** Subtle architectural beam above the sculpture (overhead.tsx). */
  ceilingBeam: string;
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
  frameShard: "#8f949a",
  // Floor stays visible as its own surface; reflection rides on top.
  floor: TUNING.floorColor,
  floorReflective: true,
  floorMirror: TUNING.floorReflectStrength,
  floorMixStrength: TUNING.floorMixStrength,
  floorMixContrast: 1.0,
  floorReflectBlur: TUNING.floorReflectBlur,
  floorMixBlur: TUNING.floorMixBlur,
  dust: TUNING.dustColor,
  ceilingBeam: TUNING.ceilingBeamColor,
  projectsBase: "#5a5e66",
  projectsEmissive: "#ffd48a",
  projectsWire: "#6f747a",
  keyLight: "#fff4e0",
  fillLight: "#d0dbee",
  rimLight: "#ffffff",
};

// Dark mode — hand-tuned, not straight invert.
const DARK: SculpturePalette = {
  background: "#030405",
  letterShard: "#f2f0ea",
  frameShard: "#4b4741",
  // Dark mode uses a MANUAL mirror (see sculpture-scene.tsx): a
  // flipped copy of the sculpture renders below the floor, and the
  // floor is a semi-transparent black plane on top. This sidesteps
  // drei's MeshReflectorMaterial, which kept bleeding grey onto near-
  // black floors no matter how we tuned mirror / mixStrength /
  // mixContrast. The reflection is now the shards themselves, seen
  // through a tinted sheet of glass.
  floor: "#000000",
  floorReflective: false,
  floorMirror: 1.0,
  floorMixStrength: 1.0,
  floorMixContrast: 1.0,
  floorReflectBlur: 0,
  floorMixBlur: 0,
  dust: "#e8e4d6",
  ceilingBeam: "#33302b",
  projectsBase: "#c6c2b8",
  projectsEmissive: "#ffd48a",
  projectsWire: "#7a7672",
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
