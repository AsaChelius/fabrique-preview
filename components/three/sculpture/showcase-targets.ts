"use client";

/**
 * Compute showcase target positions for the letter shards.
 *
 * Input: number of letter shards.
 * Output: Float32Array of (x, y, z) triples arranged into five thin
 * rectangular outlines — one per project — sitting in a horizontal row
 * inside the plaque area. Fed into the physics state as new `home`
 * values; the existing spring restores shards to these new targets and
 * the morph animates itself.
 */

export const SHOWCASE_LAYOUT = {
  cardW: 1.7,
  cardH: 2.2,
  /** X centers of the 5 cards. */
  xCenters: [-3.8, -1.9, 0, 1.9, 3.8] as const,
  /** Y center of the entire row (matches FABRIQUE's vertical mid). */
  centerY: 0,
  /** Thickness (world units) of the perimeter band the shards fill. */
  outlineThickness: 0.09,
  /** Z spread per shard so outlines have slight depth. */
  zJitter: 0.08,
} as const;

export function computeShowcaseHomes(letterCount: number): Float32Array {
  const out = new Float32Array(letterCount * 3);
  const rand = mulberry32(0xca12d500);
  const { cardW, cardH, xCenters, centerY, outlineThickness, zJitter } =
    SHOWCASE_LAYOUT;
  const halfW = cardW / 2;
  const halfH = cardH / 2;
  const perim = 2 * cardW + 2 * cardH;
  const perCard = Math.ceil(letterCount / xCenters.length);

  for (let i = 0; i < letterCount; i++) {
    const cardIdx = Math.min(xCenters.length - 1, Math.floor(i / perCard));
    const cx = xCenters[cardIdx];
    const t = rand() * perim;
    let x: number;
    let y: number;
    if (t < cardW) {
      // top edge
      x = cx - halfW + t;
      y = centerY + halfH + (rand() - 0.5) * outlineThickness;
    } else if (t < 2 * cardW) {
      // bottom edge
      x = cx - halfW + (t - cardW);
      y = centerY - halfH + (rand() - 0.5) * outlineThickness;
    } else if (t < 2 * cardW + cardH) {
      // left edge
      x = cx - halfW + (rand() - 0.5) * outlineThickness;
      y = centerY - halfH + (t - 2 * cardW);
    } else {
      // right edge
      x = cx + halfW + (rand() - 0.5) * outlineThickness;
      y = centerY - halfH + (t - 2 * cardW - cardH);
    }
    const z = (rand() - 0.5) * zJitter;
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  }
  return out;
}

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
