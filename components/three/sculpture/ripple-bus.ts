/**
 * Water ripple state bus.
 *
 * Concentric DROP ripples expanding from a point. Caused by metal
 * pieces falling from the FABRIQUE sculpture into the water below
 * (see fall-bus.ts). The drop's (cx, cy) is the impact point on the
 * floor plane in world (X, Z) coords.
 */

export type DropRipple = {
  /** World X of the impact point on the floor plane. */
  cx: number;
  /** World Z of the impact point on the floor plane. */
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

const MAX_DROPS = 10;
const drops: DropRipple[] = [];

export function spawnDrop(d: DropRipple): void {
  drops.push(d);
  if (drops.length > MAX_DROPS) drops.shift();
}

export function getDrops(): readonly DropRipple[] {
  return drops;
}

export function pruneDrops(now: number): void {
  for (let i = drops.length - 1; i >= 0; i--) {
    if (now - drops[i].startT > drops[i].lifeS) drops.splice(i, 1);
  }
}
