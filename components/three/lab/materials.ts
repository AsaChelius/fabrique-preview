/**
 * Letter material state machine.
 *
 * Each letter cycles through 4 distinct surface states on hard impact.
 * On flip: pick a state different from current, crossfade uniforms over
 * ~550ms (TUNING.materialCrossfadeMs), then cooldown so a cascade of
 * contacts doesn't strobe.
 *
 * One MeshPhysicalMaterial per letter; we tween its uniforms between
 * state presets rather than swapping material instances (avoids GPU state
 * churn and gives us free crossfade).
 */

import * as THREE from "three";

export type MaterialState = "obsidian" | "glass" | "frosted" | "matte";

export const MATERIAL_STATES: MaterialState[] = [
  "obsidian",
  "glass",
  "frosted",
  "matte",
];

type MaterialPreset = {
  color: THREE.ColorRepresentation;
  metalness: number;
  roughness: number;
  transmission: number;
  thickness: number;
  ior: number;
  clearcoat: number;
  clearcoatRoughness: number;
  reflectivity: number;
  emissive: THREE.ColorRepresentation;
  emissiveIntensity: number;
};

export const PRESETS: Record<MaterialState, MaterialPreset> = {
  // Polished black mirror. Subtle cool emissive so it's not a pure void.
  obsidian: {
    color: "#0a0d12",
    metalness: 1,
    roughness: 0.18,
    transmission: 0,
    thickness: 0,
    ior: 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    reflectivity: 1,
    emissive: "#1a2638",
    emissiveIntensity: 0.45,
  },
  // Crystal-clear glass with a faint internal glow — "lit from within".
  glass: {
    color: "#d4e2f0",
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    thickness: 1.1,
    ior: 1.52,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    reflectivity: 0.5,
    emissive: "#2c4a70",
    emissiveIntensity: 0.35,
  },
  // Frosted: partial transmission + high roughness. Soft internal glow.
  frosted: {
    color: "#9ab0c4",
    metalness: 0,
    roughness: 0.6,
    transmission: 0.55,
    thickness: 0.7,
    ior: 1.4,
    clearcoat: 0.3,
    clearcoatRoughness: 0.5,
    reflectivity: 0.35,
    emissive: "#304a66",
    emissiveIntensity: 0.35,
  },
  // Matte stone. Very slight warm glow so it reads against the void.
  matte: {
    color: "#4a5260",
    metalness: 0,
    roughness: 1,
    transmission: 0,
    thickness: 0,
    ior: 1.3,
    clearcoat: 0,
    clearcoatRoughness: 1,
    reflectivity: 0.1,
    emissive: "#28302a",
    emissiveIntensity: 0.3,
  },
};

/** Pick a new state — never the current one. */
export function pickNextState(current: MaterialState): MaterialState {
  const options = MATERIAL_STATES.filter((s) => s !== current);
  return options[Math.floor(Math.random() * options.length)];
}

/** Interpolate material uniforms between two presets by `t` in [0,1]. */
export function applyCrossfade(
  mat: THREE.MeshPhysicalMaterial,
  from: MaterialState,
  to: MaterialState,
  t: number,
): void {
  const a = PRESETS[from];
  const b = PRESETS[to];
  const lerp = (x: number, y: number) => x + (y - x) * t;

  const colA = new THREE.Color(a.color);
  const colB = new THREE.Color(b.color);
  mat.color.copy(colA).lerp(colB, t);

  const emA = new THREE.Color(a.emissive);
  const emB = new THREE.Color(b.emissive);
  mat.emissive.copy(emA).lerp(emB, t);

  mat.metalness = lerp(a.metalness, b.metalness);
  mat.roughness = lerp(a.roughness, b.roughness);
  mat.transmission = lerp(a.transmission, b.transmission);
  mat.thickness = lerp(a.thickness, b.thickness);
  mat.ior = lerp(a.ior, b.ior);
  mat.clearcoat = lerp(a.clearcoat, b.clearcoat);
  mat.clearcoatRoughness = lerp(a.clearcoatRoughness, b.clearcoatRoughness);
  mat.reflectivity = lerp(a.reflectivity, b.reflectivity);
  mat.emissiveIntensity = lerp(a.emissiveIntensity, b.emissiveIntensity);
}

/** Apply a preset instantly (no tween). */
export function applyPreset(
  mat: THREE.MeshPhysicalMaterial,
  state: MaterialState,
): void {
  applyCrossfade(mat, state, state, 1);
}
