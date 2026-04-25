/**
 * Water ripple state bus.
 *
 * Two kinds of ripples drive the floor's mirrored shards:
 *
 *   1. DROP ripples — concentric circles expanding from a point. Spawn
 *      at random positions every few seconds. Each ripple has a center,
 *      a start time, and decays over its lifetime. Multiple drops can
 *      be active simultaneously.
 *
 *   2. WIND ripples — directional linear waves traveling across the
 *      water. Continuous, with a slowly-varying direction so the wind
 *      doesn't feel mechanical.
 *
 * <RippleScheduler /> spawns drops on its own timer; <Shards />
 * (mirror copy) reads the active state per frame and adds the
 * displacement on top of the existing micro-wave noise.
 */

export type DropRipple = {
  /** World X of the impact point. */
  cx: number;
  /** World Y of the impact point (used as world-Z on the water plane —
   *  the mirror lives at the floor and we project onto the camera-facing
   *  XY of the flipped sculpture, so we use world Y as the second axis). */
  cy: number;
  /** Wall-clock seconds when this ripple started (clock.elapsedTime). */
  startT: number;
  /** Total lifetime in seconds. */
  lifeS: number;
  /** Peak amplitude (world units). */
  amp: number;
  /** Wave speed — radius growth in world units / second. */
  speed: number;
  /** Wavelength of the concentric rings (world units). */
  wavelength: number;
};

const MAX_DROPS = 6;
const drops: DropRipple[] = [];

export function spawnDrop(d: DropRipple): void {
  drops.push(d);
  // Keep the array bounded — drop the oldest if we exceed the cap.
  if (drops.length > MAX_DROPS) drops.shift();
}

/** Returns the live drop list. Callers must NOT mutate. The Shards
 *  mirror reads this every frame and culls expired drops itself
 *  (cheaper than running a separate cleanup pass). */
export function getDrops(): readonly DropRipple[] {
  return drops;
}

export function pruneDrops(now: number): void {
  for (let i = drops.length - 1; i >= 0; i--) {
    if (now - drops[i].startT > drops[i].lifeS) drops.splice(i, 1);
  }
}

// ---- Wind ripples ---------------------------------------------------------

export const wind = {
  /** Direction of wave propagation (unit-ish vector in world XY). The
   *  primary wave sweeps left-to-right across the entire water surface
   *  so it reads as wind blowing in one direction. */
  dirX: 1.0,
  dirY: 0.0,
  /** Wave amplitude — bumped so the wind crests are clearly visible
   *  on the water tone. */
  amp: 0.06,
  /** Spatial frequency (radians per world unit). Low so each crest is
   *  several world units wide — gives the "rolling band" look rather
   *  than tight chop. */
  k: 0.55,
  /** Temporal frequency (radians per second). Lower = slower sweep, so
   *  the eye can track the crest moving across the surface. */
  omega: 0.85,
  /** A weak secondary wave at a different angle / freq adds organic
   *  cross-hatching without dominating the primary direction. */
  dir2X: 0.6,
  dir2Y: 0.4,
  amp2: 0.022,
  k2: 1.05,
  omega2: 0.55,
};
