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

/** TEMP DEBUG: dimensions of the green bounding box around OUR PROJECTS.
 *  Single source of truth — DebugBoundingBox in sculpture-scene.tsx and
 *  every placement filter site read these constants so the visible box
 *  and the actual cull volume are always identical.
 *
 *  Tightened from the original (halfW 1.3965, height 1.0, top -0.73):
 *  shrunk symmetrically on all four sides so the white space hugs the
 *  OUR PROJECTS label more tightly.
 *
 *  Width:  ±1.26 in x  (was ±1.3965 → ~10% in)
 *  Height: 0.86         (was 1.00    → ~14% shorter)
 *  Center: y = -1.255   (was -1.23, micro-shift to keep label centered)
 *  Depth:  12           (z ∈ [-6, +6] — past the cloud's ±3 on both sides)
 */
export const GREEN_BOX = {
  halfW: 1.26,
  height: 0.86,
  depth: 12,
  /** Vertical center of the box. The OUR PROJECTS label sits at
   *  TUNING.buttonCenterY = -1.35; we offset slightly above so the
   *  label sits comfortably inside the white space. */
  centerY: -1.255,
} as const;

/** Center y of the green box. Kept as a separate export so existing
 *  imports (sculpture-scene.tsx) don't break. */
export const GREEN_BOX_CENTER_Y = GREEN_BOX.centerY;

/** True if the world point (x, y, z) is inside the green debug box, with
 *  padding for shard body extent. Shards have shardHeight=0.10 as their
 *  longest dimension; a shard whose CENTER is within ~0.06 of any wall
 *  has its body crossing the wireframe and reads as "inside" visually.
 *  We use 0.08 so the filter is conservative. */
export function isInsideGreenBox(x: number, y: number, z: number): boolean {
  const PAD = 0.08;
  const cy = GREEN_BOX_CENTER_Y;
  const halfH = GREEN_BOX.height / 2 + PAD;
  const halfD = GREEN_BOX.depth / 2 + PAD;
  const halfW = GREEN_BOX.halfW + PAD;
  return (
    Math.abs(x) <= halfW &&
    y >= cy - halfH &&
    y <= cy + halfH &&
    Math.abs(z) <= halfD
  );
}

/** True if the shard at world (x, y, z) is FULLY inside the green
 *  rectangular frustum — i.e., the camera's anamorphic projection of
 *  the shard lands inside the 2D screen rectangle, AND the entire
 *  shard body (≈0.10 long, ≈0.026 wide) fits within the rectangle with
 *  margin to spare. Partials (where the body straddles the wireframe)
 *  return false so they are NOT culled.
 *
 *  Frustum geometry (matching DebugBoundingBox):
 *    apex   = (0, 0, cameraZ)
 *    base   = 2D rectangle on the z=0 plane:
 *               x ∈ ±halfW
 *               y ∈ [centerY - halfH, centerY + halfH]
 *    a point (x, y, z) is inside the frustum iff its projection
 *    (x*9/(9-z), y*9/(9-z)) is inside the base rectangle. */
export function isFullyInsideGreenFrustum(
  x: number,
  y: number,
  z: number,
): boolean {
  // Shrink the rectangle inward by a bit more than half the longest
  // shard dimension so the entire body has to fit. shardHeight is 0.10,
  // so half is 0.05 — pad to 0.06 for safety.
  const BODY_PAD = 0.06;
  const halfW = GREEN_BOX.halfW - BODY_PAD;
  const halfH = GREEN_BOX.height / 2 - BODY_PAD;
  const cy = GREEN_BOX_CENTER_Y;
  // Anamorphic forward-projection from camera (0, 0, camZ) to z=0 plane.
  const camZ = TUNING.cameraZ;
  const denom = camZ - z;
  if (denom <= 0) return false; // shard at/behind the camera — ignore
  const t = camZ / denom;
  const xp = x * t;
  const yp = y * t;
  return (
    Math.abs(xp) <= halfW &&
    yp >= cy - halfH &&
    yp <= cy + halfH
  );
}

/** Drop every placement whose world position lies inside the green box —
 *  AND whose MIRROR-COPY world position would land inside the green box.
 *
 *  The sculpture renders twice: once upright at the placement's world
 *  position, and once below the floor inside a `<group position={[0,
 *  2*floorY, 0]} scale={[1, -1, 1]}>` (see MirrorBelow in sculpture-
 *  scene.tsx). A shard at upright world (x, y, z) therefore appears as
 *  a mirror twin at world (x, -y + 2*floorY, z). If we only filter by
 *  the upright position, anamorphically-stretched bottom-plaque shards
 *  (y_local ≈ -3 from `dz = -3` ratio = 1.333) get reflected to y ≈ -1.1
 *  — straight inside the green box. So we filter on EITHER overlap. */
export function filterOutsideGreenBox(placements: Placement[]): Placement[] {
  const FLOOR_Y = TUNING.floorY;
  return placements.filter((p) => {
    if (isInsideGreenBox(p.x, p.y, p.z)) return false;
    const mirrorY = -p.y + 2 * FLOOR_Y;
    if (isInsideGreenBox(p.x, mirrorY, p.z)) return false;
    return true;
  });
}

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
