"use client";

import { TUNING } from "./tuning";

/**
 * Showcase target positions for the letter + frame shards.
 *
 * In showcase mode the entire shard population collapses into five 3D
 * rectangular-prism cards sitting in a row inside the plaque area:
 *   - Letter shards → the TWELVE EDGES of each card's wireframe
 *     (gives real forward/back depth on the outlines — the same kind of
 *     depth FABRIQUE itself has).
 *   - Frame shards (formerly the plaque backdrop) → the INTERIOR VOLUME
 *     of each card. This drops the visible grey plaque and brings every
 *     shard inside a box.
 *
 * Each shard also gets a `cardIndex` (0-4) so the chameleon color flow
 * in <Shards /> can tint it based on which card it belongs to.
 */

export const SHOWCASE_LAYOUT = {
  cardW: 1.7,
  cardH: 2.2,
  /** Card depth — pushed past half the full FABRIQUE cloud depth so the
   *  forward/back 3D read is pronounced and the interior wind has room
   *  to swirl without bunching against a shallow Z range. */
  cardD: 2.0,
  /** X centers of the 5 cards — evenly spaced at 2.6 units apart so
   *  gaps between every adjacent pair are identical. Previously the
   *  outer cards sat further out than the inner ones, which made the
   *  spacing look lopsided. */
  xCenters: [-5.2, -2.6, 0, 2.6, 5.2] as const,
  /** Y center of the card row. */
  centerY: 0,
  /** Z center of the card row. */
  centerZ: 0,
  /** Scatter around edge / interior positions so shards don't lock into
   *  a geometric line. Small for edges (keeps the wireframe crisp). */
  outlineJitter: 0.08,
} as const;

export type ShowcaseHomes = {
  /** Flat (x,y,z) triples, length = count*3. */
  positions: Float32Array;
  /** 0-4, one per shard. */
  cardIndex: Int8Array;
  /** For outline shards only: per-shard (dx, dy, dz, tAlongEdge). The
   *  unit vector points along the edge the shard sits on; `tAlongEdge`
   *  is 0..1 position along that edge. Feeds the snake-wave flow in
   *  Shards. Null for interior-fill shards. */
  edgeFlow: Float32Array | null;
};

const ABOUT_PANEL = {
  size: 5.65,
  centerY: 0.48,
  centerZ: 0,
  depth: 1.85,
  borderJitter: 0.038,
  sampleSize: 1800,
  alphaThreshold: 140,
  textInset: 0.78,
  contentDepth: 0.82,
} as const;

let cachedAboutLetterCount = -1;
let cachedAboutLetterHomes: ShowcaseHomes | null = null;
let cachedAboutFrameCount = -1;
let cachedAboutFrameHomes: ShowcaseHomes | null = null;

/**
 * Letter shards → distribute across the 12 edges of each 3D card.
 * Edge lengths are weighted by length so edge density reads uniform.
 */
export function computeShowcaseLetterHomes(count: number): ShowcaseHomes {
  const positions = new Float32Array(count * 3);
  const cardIndex = new Int8Array(count);
  const edgeFlow = new Float32Array(count * 4);
  const rand = mulberry32(0xca12d500);
  const { cardW, cardH, cardD, xCenters, centerY, centerZ, outlineJitter } =
    SHOWCASE_LAYOUT;
  const hw = cardW / 2;
  const hh = cardH / 2;
  const hd = cardD / 2;
  const nCards = xCenters.length;
  const perCard = Math.ceil(count / nCards);

  // Edge group thresholds (cumulative probability by axis).
  const totalEdgeLen = 4 * cardW + 4 * cardH + 4 * cardD;
  const thX = (4 * cardW) / totalEdgeLen;
  const thXY = (4 * cardW + 4 * cardH) / totalEdgeLen;

  for (let i = 0; i < count; i++) {
    const cardIdx = Math.min(nCards - 1, Math.floor(i / perCard));
    const cx = xCenters[cardIdx];
    const cy = centerY;
    const cz = centerZ;
    const axisRoll = rand();
    const cornerPick = rand();
    const j1 = (rand() - 0.5) * outlineJitter;
    const j2 = (rand() - 0.5) * outlineJitter;
    // Parametric t along the edge (0..1). Drives the snake wave phase
    // so shards sharing an edge ripple in sequence instead of in unison.
    const edgeT = rand();

    let x: number;
    let y: number;
    let z: number;
    let dx = 0;
    let dy = 0;
    let dz = 0;

    if (axisRoll < thX) {
      // X-aligned edge — picks one of the 4 (y,z) corners.
      x = cx - hw + edgeT * cardW;
      if (cornerPick < 0.25)      { y = cy + hh; z = cz + hd; }
      else if (cornerPick < 0.5)  { y = cy + hh; z = cz - hd; }
      else if (cornerPick < 0.75) { y = cy - hh; z = cz + hd; }
      else                         { y = cy - hh; z = cz - hd; }
      y += j1;
      z += j2;
      dx = 1;
    } else if (axisRoll < thXY) {
      // Y-aligned edge — picks one of the 4 (x,z) corners.
      y = cy - hh + edgeT * cardH;
      if (cornerPick < 0.25)      { x = cx + hw; z = cz + hd; }
      else if (cornerPick < 0.5)  { x = cx + hw; z = cz - hd; }
      else if (cornerPick < 0.75) { x = cx - hw; z = cz + hd; }
      else                         { x = cx - hw; z = cz - hd; }
      x += j1;
      z += j2;
      dy = 1;
    } else {
      // Z-aligned edge — picks one of the 4 (x,y) corners.
      z = cz - hd + edgeT * cardD;
      if (cornerPick < 0.25)      { x = cx + hw; y = cy + hh; }
      else if (cornerPick < 0.5)  { x = cx + hw; y = cy - hh; }
      else if (cornerPick < 0.75) { x = cx - hw; y = cy + hh; }
      else                         { x = cx - hw; y = cy - hh; }
      x += j1;
      y += j2;
      dz = 1;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    cardIndex[i] = cardIdx;
    edgeFlow[i * 4]     = dx;
    edgeFlow[i * 4 + 1] = dy;
    edgeFlow[i * 4 + 2] = dz;
    edgeFlow[i * 4 + 3] = edgeT;
  }

  return { positions, cardIndex, edgeFlow };
}

/**
 * Frame shards → uniform random fill inside each card's 3D volume.
 * The whole plaque vanishes in showcase mode; every grey shard ends up
 * inside a box where the chameleon color flow takes over.
 */
export function computeShowcaseFrameHomes(count: number): ShowcaseHomes {
  const positions = new Float32Array(count * 3);
  const cardIndex = new Int8Array(count);
  const rand = mulberry32(0x1ea7fb1e);
  const { cardW, cardH, cardD, xCenters, centerY, centerZ } = SHOWCASE_LAYOUT;
  const hw = cardW / 2;
  const hh = cardH / 2;
  const hd = cardD / 2;
  const nCards = xCenters.length;
  const perCard = Math.ceil(count / nCards);

  for (let i = 0; i < count; i++) {
    const cardIdx = Math.min(nCards - 1, Math.floor(i / perCard));
    const cx = xCenters[cardIdx];
    positions[i * 3]     = cx        + (rand() * 2 - 1) * hw;
    positions[i * 3 + 1] = centerY   + (rand() * 2 - 1) * hh;
    positions[i * 3 + 2] = centerZ   + (rand() * 2 - 1) * hd;
    cardIndex[i] = cardIdx;
  }

  return { positions, cardIndex, edgeFlow: null };
}

/**
 * Expanded mode — one big merged box. Letter shards land on that box's
 * 12 edges (same snake-flow support as showcase mode). `cardIndex` is
 * forced to 0 across the board since there's only one card visible;
 * the dominant hue is selected separately by suspended-cloud via
 * `dominantCard` on the showcase ref.
 */
export function computeExpandedLetterHomes(count: number): ShowcaseHomes {
  const positions = new Float32Array(count * 3);
  const cardIndex = new Int8Array(count);
  const edgeFlow = new Float32Array(count * 4);
  const rand = mulberry32(0xe89a1b1d);
  const cardW = TUNING.expandedBoxW;
  const cardH = TUNING.expandedBoxH;
  const cardD = TUNING.expandedBoxD;
  const hw = cardW / 2;
  const hh = cardH / 2;
  const hd = cardD / 2;
  const { outlineJitter } = SHOWCASE_LAYOUT;

  const totalEdgeLen = 4 * cardW + 4 * cardH + 4 * cardD;
  const thX = (4 * cardW) / totalEdgeLen;
  const thXY = (4 * cardW + 4 * cardH) / totalEdgeLen;

  for (let i = 0; i < count; i++) {
    const axisRoll = rand();
    const cornerPick = rand();
    const j1 = (rand() - 0.5) * outlineJitter;
    const j2 = (rand() - 0.5) * outlineJitter;
    const edgeT = rand();

    let x: number;
    let y: number;
    let z: number;
    let dx = 0;
    let dy = 0;
    let dz = 0;

    if (axisRoll < thX) {
      x = -hw + edgeT * cardW;
      if (cornerPick < 0.25)      { y =  hh; z =  hd; }
      else if (cornerPick < 0.5)  { y =  hh; z = -hd; }
      else if (cornerPick < 0.75) { y = -hh; z =  hd; }
      else                         { y = -hh; z = -hd; }
      y += j1;
      z += j2;
      dx = 1;
    } else if (axisRoll < thXY) {
      y = -hh + edgeT * cardH;
      if (cornerPick < 0.25)      { x =  hw; z =  hd; }
      else if (cornerPick < 0.5)  { x =  hw; z = -hd; }
      else if (cornerPick < 0.75) { x = -hw; z =  hd; }
      else                         { x = -hw; z = -hd; }
      x += j1;
      z += j2;
      dy = 1;
    } else {
      z = -hd + edgeT * cardD;
      if (cornerPick < 0.25)      { x =  hw; y =  hh; }
      else if (cornerPick < 0.5)  { x =  hw; y = -hh; }
      else if (cornerPick < 0.75) { x = -hw; y =  hh; }
      else                         { x = -hw; y = -hh; }
      x += j1;
      y += j2;
      dz = 1;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    cardIndex[i] = 0;
    edgeFlow[i * 4]     = dx;
    edgeFlow[i * 4 + 1] = dy;
    edgeFlow[i * 4 + 2] = dz;
    edgeFlow[i * 4 + 3] = edgeT;
  }

  return { positions, cardIndex, edgeFlow };
}

export function computeExpandedFrameHomes(count: number): ShowcaseHomes {
  const positions = new Float32Array(count * 3);
  const cardIndex = new Int8Array(count);
  const rand = mulberry32(0xe89afb1e);
  const hw = TUNING.expandedBoxW / 2;
  const hh = TUNING.expandedBoxH / 2;
  const hd = TUNING.expandedBoxD / 2;

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = (rand() * 2 - 1) * hw;
    positions[i * 3 + 1] = (rand() * 2 - 1) * hh;
    positions[i * 3 + 2] = (rand() * 2 - 1) * hd;
    cardIndex[i] = 0;
  }

  return { positions, cardIndex, edgeFlow: null };
}

/**
 * About mode — the whole FABRIQUE sculpture becomes a single suspended
 * metal box. Letter shards resolve into two human silhouettes; frame
 * shards resolve onto the 12 clean edges of the box only. No face fill:
 * filling the panel looked like rain behind the copy.
 */
export function computeAboutLetterHomes(count: number): ShowcaseHomes {
  if (cachedAboutLetterHomes && cachedAboutLetterCount === count) {
    return cachedAboutLetterHomes;
  }

  const W = ABOUT_PANEL.sampleSize;
  const H = ABOUT_PANEL.sampleSize;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    const empty = {
      positions: new Float32Array(count * 3),
      cardIndex: new Int8Array(count),
      edgeFlow: null,
    };
    return empty;
  }

  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";

  drawHumanSilhouette(ctx, W * 0.17, H * 0.62, W * 0.135);
  drawHumanSilhouette(ctx, W * 0.83, H * 0.62, W * 0.135);

  const inside = sampledPixels(ctx, W, H);
  const positions = new Float32Array(count * 3);
  const cardIndex = new Int8Array(count);
  const rand = mulberry32(0xab047500);
  const half = ABOUT_PANEL.size / 2;
  const contentHalf = half * ABOUT_PANEL.textInset;

  for (let i = 0; i < count; i++) {
    const pick = inside[(rand() * inside.length) | 0] ?? 0;
    const px = pick % W;
    const py = (pick / W) | 0;
    const nx = (px / W) * 2 - 1;
    const ny = -((py / H) * 2 - 1);
    const figureDepth = px < W / 2 ? -0.36 : 0.36;
    const u = rand() * 2 - 1;
    const dz =
      figureDepth +
      Math.sign(u) * Math.pow(Math.abs(u), 1.75) * ABOUT_PANEL.contentDepth;

    positions[i * 3] = nx * contentHalf;
    positions[i * 3 + 1] = ABOUT_PANEL.centerY + ny * contentHalf;
    positions[i * 3 + 2] = ABOUT_PANEL.centerZ + dz;
    cardIndex[i] = py > H * 0.58 ? (px < W / 2 ? 3 : 4) : 2;
  }

  cachedAboutLetterCount = count;
  cachedAboutLetterHomes = { positions, cardIndex, edgeFlow: null };
  return cachedAboutLetterHomes;
}

export function computeAboutFrameHomes(count: number): ShowcaseHomes {
  if (cachedAboutFrameHomes && cachedAboutFrameCount === count) {
    return cachedAboutFrameHomes;
  }

  const positions = new Float32Array(count * 3);
  const cardIndex = new Int8Array(count);
  const edgeFlow = new Float32Array(count * 4);
  const rand = mulberry32(0xabf2a4e0);
  const half = ABOUT_PANEL.size / 2;
  const hd = ABOUT_PANEL.depth / 2;

  const edgeWeights = [
    0.14, 0.02, 0.09, 0.09,
    0.14, 0.02, 0.09, 0.09,
    0.006, 0.15, 0.006, 0.15,
  ] as const;

  for (let i = 0; i < count; i++) {
    const edge = pickWeighted(edgeWeights, rand());
    const t = rand() * 2 - 1;
    const j1 = (rand() - 0.5) * ABOUT_PANEL.borderJitter;
    const j2 = (rand() - 0.5) * ABOUT_PANEL.borderJitter;
    let x = 0;
    let y = 0;
    let z = 0;
    let dx = 0;
    let dy = 0;
    let dz = 0;

    if (edge < 8) {
      z = edge < 4 ? hd : -hd;
      const side = edge % 4;
      if (side === 0) {
        x = t * half;
        y = half + j1;
        dx = 1;
      } else if (side === 1) {
        x = t * half;
        y = -half + j1;
        dx = 1;
      } else if (side === 2) {
        x = -half + j1;
        y = t * half;
        dy = 1;
      } else {
        x = half + j1;
        y = t * half;
        dy = 1;
      }
    } else {
      const corner = edge - 8;
      x = corner < 2 ? -half + j1 : half + j1;
      y = corner === 0 || corner === 2 ? -half + j2 : half + j2;
      z = t * hd;
      dz = 1;
    }

    positions[i * 3] = x;
    positions[i * 3 + 1] = ABOUT_PANEL.centerY + y;
    positions[i * 3 + 2] = ABOUT_PANEL.centerZ + z;
    cardIndex[i] = 1;
    edgeFlow[i * 4] = dx;
    edgeFlow[i * 4 + 1] = dy;
    edgeFlow[i * 4 + 2] = dz;
    edgeFlow[i * 4 + 3] = (t + 1) * 0.5;
  }

  cachedAboutFrameCount = count;
  cachedAboutFrameHomes = { positions, cardIndex, edgeFlow };
  return cachedAboutFrameHomes;
}

function drawHumanSilhouette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
): void {
  ctx.save();
  ctx.lineWidth = scale * 0.13;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000";

  ctx.beginPath();
  ctx.ellipse(cx, cy - scale * 1.04, scale * 0.42, scale * 0.48, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - scale * 0.32, cy - scale * 0.52);
  ctx.bezierCurveTo(
    cx - scale * 0.9,
    cy - scale * 0.24,
    cx - scale * 1.08,
    cy + scale * 0.65,
    cx - scale * 1.05,
    cy + scale * 1.08,
  );
  ctx.lineTo(cx + scale * 1.05, cy + scale * 1.08);
  ctx.bezierCurveTo(
    cx + scale * 1.08,
    cy + scale * 0.65,
    cx + scale * 0.9,
    cy - scale * 0.24,
    cx + scale * 0.32,
    cy - scale * 0.52,
  );
  ctx.quadraticCurveTo(cx, cy - scale * 0.34, cx - scale * 0.32, cy - scale * 0.52);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - scale * 0.8, cy + scale * 1.08);
  ctx.lineTo(cx + scale * 0.8, cy + scale * 1.08);
  ctx.stroke();
  ctx.restore();
}

function sampledPixels(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): number[] {
  const { data } = ctx.getImageData(0, 0, W, H);
  const inside: number[] = [];
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] >= ABOUT_PANEL.alphaThreshold) inside.push((i - 3) >> 2);
  }
  return inside.length > 0 ? inside : [0];
}

function pickWeighted(weights: readonly number[], roll: number): number {
  let total = 0;
  for (const w of weights) total += w;
  let acc = 0;
  const target = roll * total;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (target <= acc) return i;
  }
  return weights.length - 1;
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
