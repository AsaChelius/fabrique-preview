"use client";

/**
 * Sculpture color palette — single source of truth for light/grey/dark modes.
 *
 * Mode swaps colors inside the R3F scene (CSS `filter: invert` breaks
 * on WebGL canvases). Consumers call `useSculpturePalette()` and pass the
 * resolved strings into material `color` props.
 *
 * Mode is encoded as a body class:
 *   - no class         → light   (default cream/white)
 *   - sculpture-sunset → sunset  (warm orange, directional warm lighting)
 *   - sculpture-dark   → dark    (near-black)
 *
 * Components re-render automatically when the body class changes via a
 * MutationObserver on the body class attribute.
 */

import { useEffect, useState } from "react";
import { TUNING } from "./tuning";

export type SculptureMode = "light" | "sunset" | "dark";

export type SculpturePalette = {
  background: string;
  letterShard: string;
  frameShard: string;
  /** Floor base color — kept equal to `background` so the ground plane
   *  itself never reads as a visible surface. Only the reflected
   *  sculpture (via the MirrorBelow trick) is visible. */
  floor: string;
  /** Whether the ground plane uses MeshReflectorMaterial (true) or a
   *  plain transparent meshBasicMaterial over the manual mirror (false).
   *  All three modes now use the manual-mirror approach for a true
   *  literal-mirror reflection without drei's blurred bleed. */
  floorReflective: boolean;
  /** Opacity of the tinted glass over the manual mirror. Lower = more
   *  literal mirror; higher = more dimmed reflection. */
  floorOpacity: number;
  /** Reflection strength when `floorReflective`. 0-1. (Legacy / unused
   *  now that all modes manual-mirror; kept so the type stays stable.) */
  floorMirror: number;
  /** Mix strength of reflected scene — legacy. */
  floorMixStrength: number;
  /** Contrast curve applied to the reflection. Legacy. */
  floorMixContrast: number;
  /** Per-mode blur settings for the reflection. Legacy. */
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
  /** EXACT match to bg so the tinted plane painted over empty water
   *  blends to bg (mix(bg, bg, X) = bg) and the camera horizon line
   *  becomes invisible — water and air are the same color. The
   *  reflection only shows up where the mirror copy actually has
   *  geometry behind the plane; that's the only visible "water". */
  floor: TUNING.backgroundColor,
  floorReflective: false,
  /** Tinted glass over the manual mirror. At 0.85 only ~15% of the
   *  mirror bleeds through — the reflection reads as a faint ghost
   *  rather than a crisp mirror, AND the residual color seam at the
   *  camera horizon (where mirror-tinted area meets pure bg) drops
   *  below visual-threshold (verified by pixel sampling: bg shift
   *  Δ ≈ (1, 2, 2) instead of (3, 9, 8) at lower opacities).
   *  Tradeoff: the reflection is subtle. That's the right read for
   *  "water surface", not "polished marble". */
  floorOpacity: 0.85,
  floorMirror: 1.0,
  floorMixStrength: 1.0,
  floorMixContrast: 1.0,
  floorReflectBlur: 0,
  floorMixBlur: 0,
  dust: TUNING.dustColor,
  ceilingBeam: TUNING.ceilingBeamColor,
  projectsBase: "#5a5e66",
  projectsEmissive: "#ffd48a",
  projectsWire: "#6f747a",
  keyLight: "#fff4e0",
  fillLight: "#d0dbee",
  rimLight: "#ffffff",
};

// Sunset mode — warm orange ambient with directional warm lighting.
// There's no visible "sun" disk in the scene; instead the directional
// light is intensely warm and asymmetric, so the sculpture reads as
// being lit by a low-angle late-afternoon sun. The cool blue fill from
// the opposite side simulates ambient sky bounce. Floor opacity is
// dialled in so the water reflection picks up the warm ambient bg
// while staying visibly liquid.
const SUNSET: SculpturePalette = {
  /** Was a dusty peach (#e89260). Pushed warmer/brighter so the
   *  scene reads as actual sunset sky rather than grey-orange paint. */
  background: "#ff7a3c",
  letterShard: "#1f1208",
  frameShard: "#b8612f",
  /** Exact bg match — air and water indistinguishable in empty areas. */
  floor: "#ff7a3c",
  floorReflective: false,
  /** See LIGHT comment — 0.85 puts the seam below visual threshold
   *  while keeping a faint, ghost-like reflection visible. */
  floorOpacity: 0.85,
  floorMirror: 1.0,
  floorMixStrength: 1.0,
  floorMixContrast: 1.0,
  floorReflectBlur: 0,
  floorMixBlur: 0,
  dust: "#f4d4ae",
  ceilingBeam: "#5a2c12",
  projectsBase: "#3a1f10",
  projectsEmissive: "#ffd48a",
  projectsWire: "#8b5232",
  /** "Sun" key light — warm gold, brighter to match the more
   *  saturated sky. */
  keyLight: "#ffb866",
  /** Fill light — the cool side of the sky opposite the warm sun. */
  fillLight: "#5a6a98",
  /** Rim light — gentle warm haze on the back edges. */
  rimLight: "#ffd5a8",
};

const DARK: SculpturePalette = {
  background: "#030405",
  letterShard: "#f2f0ea",
  frameShard: "#4b4741",
  /** Exact bg match — was #000000 vs bg #030405 which produced a
   *  faintly visible horizon line at high opacity. */
  floor: "#030405",
  floorReflective: false,
  /** Dark mode tolerates a touch more reflection because the mirror's
   *  dark colors are closer to bg, so the seam is naturally smaller. */
  floorOpacity: 0.92,
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

export function useSculptureMode(): SculptureMode {
  const [mode, setMode] = useState<SculptureMode>("light");
  useEffect(() => {
    const update = () => {
      const cl = document.body.classList;
      if (cl.contains("sculpture-dark")) setMode("dark");
      else if (cl.contains("sculpture-sunset")) setMode("sunset");
      else setMode("light");
    };
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);
  return mode;
}

/** Legacy boolean — kept so callers that only need to know "are we dark"
 *  don't have to convert from the 3-state mode. */
export function useSculptureDark(): boolean {
  return useSculptureMode() === "dark";
}

export function useSculpturePalette(): SculpturePalette {
  const mode = useSculptureMode();
  if (mode === "dark") return DARK;
  if (mode === "sunset") return SUNSET;
  return LIGHT;
}
