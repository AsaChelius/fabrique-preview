/**
 * Shared per-shard physics state + animation driver.
 *
 * Each shard is modeled as a damped pendulum hanging from a fixed point
 * on the ceiling (where its wire attaches). Restoring force toward the
 * home position scales as 1/wireLength so long wires feel sluggish,
 * short wires snap back quickly — the correct real-pendulum behavior.
 *
 * Idle sway is a deterministic sin wave per shard (separate from the
 * spring integration) so the sculpture never goes completely still.
 *
 * Cursor pushes apply an outward impulse when the cursor is within
 * TUNING.cursorRadius in world space, falling off smoothly with distance.
 *
 * Data is stored in Float32Arrays (not objects) so the per-frame inner
 * loop stays cache-friendly for 10k+ shards.
 */

import { TUNING } from "./tuning";
import type { Placement } from "./placements";

export type ShardPhysicsState = {
  count: number;
  /** 3*N — home world positions (never change after init). */
  home: Float32Array;
  /** 3*N — current displacement from home. */
  offset: Float32Array;
  /** 3*N — current velocity. */
  velocity: Float32Array;
  /** N — per-shard idle sway phase (radians). */
  swayPhase: Float32Array;
  /** N — per-shard idle sway amplitude (world units). */
  swayAmp: Float32Array;
  /** N — per-shard idle sway angular frequency (rad/s). */
  swayFreq: Float32Array;
  /** N — 1 / pendulum-wire-length (used as spring-k scalar). */
  invL: Float32Array;
};

/** Allocate the physics state for all shards combined. Indices are global:
 *  downstream components that only render a slice pass a `start` offset. */
export function createPhysicsState(placements: Placement[]): ShardPhysicsState {
  const N = placements.length;
  const state: ShardPhysicsState = {
    count: N,
    home: new Float32Array(N * 3),
    offset: new Float32Array(N * 3),
    velocity: new Float32Array(N * 3),
    swayPhase: new Float32Array(N),
    swayAmp: new Float32Array(N),
    swayFreq: new Float32Array(N),
    invL: new Float32Array(N),
  };

  const rand = mulberry32(0xdec0ded);
  const ampMin = TUNING.swayAmpMin;
  const ampRange = TUNING.swayAmpMax - TUNING.swayAmpMin;
  const freqMin = TUNING.swayFreqMin;
  const freqRange = TUNING.swayFreqMax - TUNING.swayFreqMin;
  const shardTopOffset = TUNING.shardHeight / 2;

  for (let i = 0; i < N; i++) {
    const p = placements[i];
    state.home[i * 3] = p.x;
    state.home[i * 3 + 1] = p.y;
    state.home[i * 3 + 2] = p.z;

    state.swayPhase[i] = rand() * Math.PI * 2;
    state.swayAmp[i] = ampMin + rand() * ampRange;
    state.swayFreq[i] = freqMin + rand() * freqRange;

    const wireLen = Math.max(0.25, TUNING.ceilingY - (p.y + shardTopOffset));
    state.invL[i] = 1 / wireLen;
  }
  return state;
}

/**
 * Advance the physics one step. Call from a useFrame in a dedicated
 * driver component so it runs exactly once per frame, before the meshes
 * read the state.
 *
 *  cursorX / cursorY — cursor projected to the z=0 plane in world space.
 *  dt                 — seconds since last step (clamped inside).
 */
export function stepPhysics(
  state: ShardPhysicsState,
  cursorX: number,
  cursorY: number,
  dt: number,
  cursorActive: boolean,
): void {
  const N = state.count;
  const h = state.home;
  const o = state.offset;
  const v = state.velocity;
  const invL = state.invL;

  const G = TUNING.pendulumGravity;
  const D = TUNING.physicsDamping;
  const R = TUNING.cursorRadius;
  const Rsq = R * R;
  const pushStrength = TUNING.cursorStrength;

  const cappedDt = Math.min(dt, TUNING.physicsMaxDt);
  const dampFactor = Math.exp(-D * cappedDt);

  for (let i = 0; i < N; i++) {
    const i3 = i * 3;

    // Current world XY (home + offset). We only use XY for cursor repulsion
    // because the cursor is picked on the z=0 plane — not meaningful to
    // push in Z.
    const wx = h[i3] + o[i3];
    const wy = h[i3 + 1] + o[i3 + 1];

    if (cursorActive) {
      const dx = wx - cursorX;
      const dy = wy - cursorY;
      const d2 = dx * dx + dy * dy;
      if (d2 < Rsq && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        // Smooth falloff, squared so close pushes are much stronger than
        // fringe ones — feels like a real "poke".
        const falloff = 1 - d / R;
        const force = pushStrength * falloff * falloff;
        const invD = 1 / d;
        v[i3]     += dx * invD * force * cappedDt;
        // Less vertical push so shards get deflected sideways more than up.
        v[i3 + 1] += dy * invD * force * 0.35 * cappedDt;
      }
    }

    // Spring restoring force — pendulum-like, stiffer on short wires.
    const k = G * invL[i];
    v[i3]     -= k * o[i3]     * cappedDt;
    v[i3 + 1] -= k * o[i3 + 1] * cappedDt;
    v[i3 + 2] -= k * o[i3 + 2] * cappedDt;

    // Exponential damping — frame-rate independent decay.
    v[i3]     *= dampFactor;
    v[i3 + 1] *= dampFactor;
    v[i3 + 2] *= dampFactor;

    // Integrate.
    o[i3]     += v[i3]     * cappedDt;
    o[i3 + 1] += v[i3 + 1] * cappedDt;
    o[i3 + 2] += v[i3 + 2] * cappedDt;
  }
}

// ---- PRNG ----------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
