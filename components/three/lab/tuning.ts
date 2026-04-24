/**
 * All tunable constants for the /lab title-page prototype.
 * Tweak here, HMR reloads, iterate.
 */

export const TUNING = {
  // ---------- Word + letters ----------
  word: "FABRIQUE",
  letterSize: 1.3,
  letterDepth: 0.55,
  letterSpacing: 1.55,

  // Home positions — zero-G, so "home" is a drift target, not a rest pose.
  homeY: 0,

  // ---------- Return-to-home spring (zero-G soft pull) ----------
  // Gentle so letters drift; too stiff and the scene never breathes.
  homeSpringK: 4.5,
  homeDamping: 1.3,

  // ---------- Rotation spring (letters return to upright) ----------
  // Restores body rotation to identity via quaternion torque impulse.
  // Stiffer than the position spring so random throws don't end with
  // letters hanging sideways for long.
  rotSpringK: 26,
  rotDamping: 1.6,
  // Rapier body angular damping — deliberately low so the spring, not the
  // body's internal friction, is what brings the letter back to upright.
  bodyAngularDamping: 0.9,

  // ---------- Water shell (thin film around each letter) ----------
  // This is the real solution to "water clings to letters": we clone each
  // letter's Text3D geometry and push vertices outward along their normals
  // by this distance, then render that mesh with the refractive water
  // material. Result: a thin sheath that hugs the glyph exactly (including
  // inside holes of A, B, Q, R because inner-wall normals displace inward).
  // Metaballs are unused for letters — they cannot produce thin films.
  shellNormalOffset: 0.07,

  // ---------- Drag ----------
  releaseImpulseMul: 0.55,
  maxReleaseImpulse: 12,

  // ---------- Impact thresholds ----------
  // Any contact above this plays a soft sound.
  softImpactForce: 2.5,
  // Above this: hard-impact events (material state flip + splash droplet).
  hardImpactForce: 12,
  impactSoundCooldownMs: 90,

  // ---------- Material state machine ----------
  materialCooldownMs: 1200,
  materialCrossfadeMs: 550,

  // ---------- Fluid (metaballs via MarchingCubes) ----------
  // Key insight: water should CLING to each letter as a thin vertical sheath,
  // not fill the space between letters. 3 small anchors stacked along Y
  // (top/mid/bottom of each letter) + low strength = a thin sausage per letter
  // that just barely merges with its neighbors (the "cohesion at the word level").
  fluidResolution: 56,
  fluidScale: 14,
  anchorsPerLetter: 3,
  anchorStrength: 0.095,
  anchorLagSeconds: 0.11,
  // Droplets: the "self-healing" element. Base count = ambient drifters;
  // hard impacts + drag releases spawn extras that migrate back and merge.
  baseFreeDroplets: 8,
  maxFreeDroplets: 22,
  dropletStrength: 0.18,
  dropletMergeDistance: 1.1,
  dropletMergeDuration: 4.2,

  // ---------- Camera / scene ----------
  cameraZ: 9.5,
  fov: 42,
  parallaxAmount: 0.25,

  // ---------- Idle director ----------
  idleTriggerSeconds: 20,
  idleNudgeImpulse: 0.9,

  // ---------- Bounds ----------
  boundsRadius: 5.0,
} as const;

export const LETTERS = TUNING.word.split("");

/** Home X coordinate for letter index i. */
export function homeXFor(i: number, total: number = LETTERS.length): number {
  return (i - (total - 1) / 2) * TUNING.letterSpacing;
}
