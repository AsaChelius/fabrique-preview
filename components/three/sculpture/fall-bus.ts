/**
 * Falling-shard state bus.
 *
 * Periodically a metal piece detaches from the FABRIQUE sculpture and
 * falls into the water below. While in flight, the shard is rendered
 * along its falling trajectory (gravity from its current position
 * down to the floor plane). When it hits the water surface it is
 * marked "fallen" — hidden from rendering — and a drop ripple is
 * spawned at the impact point.
 *
 * Two states tracked per shard:
 *   - falling: still in mid-air, animated each frame
 *   - fallen: already hit the water, hidden from now on
 */

export type FallingShard = {
  /** Index into the shared physics state's per-shard arrays. */
  shardIndex: number;
  /** clock.elapsedTime when the fall began. */
  startT: number;
  /** World Y the shard was at when the fall began. */
  startY: number;
};

const falling = new Map<number, FallingShard>();
const fallen = new Set<number>();

export function startFall(f: FallingShard): void {
  if (fallen.has(f.shardIndex) || falling.has(f.shardIndex)) return;
  falling.set(f.shardIndex, f);
}

export function getFalling(): ReadonlyMap<number, FallingShard> {
  return falling;
}

export function isFalling(shardIndex: number): FallingShard | undefined {
  return falling.get(shardIndex);
}

export function isFallen(shardIndex: number): boolean {
  return fallen.has(shardIndex);
}

export function markFallen(shardIndex: number): void {
  falling.delete(shardIndex);
  fallen.add(shardIndex);
}

/** Wipe all falling/fallen state. Used by the INSPECT debug toggle so the
 *  page snaps back to a "nothing is mid-fall and nothing is hidden" state
 *  before freezing animation. */
export function clearAllFalls(): void {
  falling.clear();
  fallen.clear();
}
