/**
 * Shared placement computation for the suspended-cloud sculpture.
 *
 * Given the sampled silhouette pixels, produces one Placement per shard
 * that both <Shards /> and <Wires /> consume. Computing this once in a
 * parent component and passing down keeps the two meshes perfectly aligned
 * and halves the sampling work.
 *
 * The anamorphic trick lives here: each placement sits on the viewing ray
 * from the sweet-spot camera through its sampled pixel. Move the camera
 * and the letters stop resolving.
 */

import { TUNING } from "./tuning";
import type { SampledPixel } from "./sampling";

export type Placement = {
  /** World-space position of the shard's center. */
  x: number;
  y: number;
  z: number;
  /** Rotation around the vertical axis, radians. */
  yaw: number;
  /** Small pitch around the horizontal axis, radians. */
  tilt: number;
};

export function computePlacements(
  samples: SampledPixel[],
  seed = 0x5ca1ab1e,
): Placement[] {
  const count = samples.length;
  const out: Placement[] = new Array(count);

  const rand = rng(seed);
  const camZ = TUNING.cameraZ;
  const canvasAspect = TUNING.sampleWidth / TUNING.sampleHeight;
  const halfW = TUNING.wordHalfWidth;
  const halfH = TUNING.wordHalfWidth / canvasAspect;

  for (let i = 0; i < count; i++) {
    const s = samples[i];

    // Where this pixel lands on the z=0 plane when viewed from (0,0,camZ).
    const x0 = s.nx * halfW;
    const y0 = s.ny * halfH;

    // Pick a depth along the viewing ray. Biased toward mid-plane via a
    // signed power curve so we don't end up with shards piled at the
    // extremes of the depth range.
    const u = rand() * 2 - 1; // [-1, 1]
    const biased = Math.sign(u) * Math.pow(Math.abs(u), TUNING.depthBias);
    const dz = biased * TUNING.cloudDepth;

    // Anamorphic ratio: move along the viewing ray. Camera on +Z means
    // x,y shrink proportionally as we approach the camera (dz > 0).
    const ratio = (camZ - dz) / camZ;
    const x = x0 * ratio;
    const y = y0 * ratio;

    const yaw = (rand() * 2 - 1) * TUNING.yawJitter;
    const tilt = (rand() * 2 - 1) * TUNING.tiltJitter;

    out[i] = { x, y, z: dz, yaw, tilt };
  }
  return out;
}

// ---- Deterministic PRNG (mulberry32) -------------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
