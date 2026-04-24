/**
 * Silhouette sampling — rasterizes FABRIQUE + the surrounding plaque to
 * offscreen canvases, extracts opaque pixel coordinates for each layer,
 * then randomly picks N samples per layer.
 *
 * Returns two SampledPixel arrays:
 *   - letter: pixels inside the glyph shapes
 *   - frame:  pixels inside the plaque rectangle but OUTSIDE the glyphs
 *             (with a small knockout padding so the plaque doesn't touch
 *             the letter edges)
 *
 * Downstream, each array is fed through the same placement pipeline, so
 * the two layers share the anamorphic geometry and only differ in which
 * pixels they sample.
 */

import { TUNING } from "./tuning";

export type SampledPixel = {
  /** Normalized x in [-1, 1] (left to right) */
  nx: number;
  /** Normalized y in [-1, 1] (bottom to top) */
  ny: number;
};

export type SampledLayers = {
  letter: SampledPixel[];
  frame: SampledPixel[];
};

export function sampleSignSilhouette(): SampledLayers {
  const W = TUNING.sampleWidth;
  const H = TUNING.sampleHeight;

  // ---- Letter canvas ---------------------------------------------------
  const letterCanvas = makeCanvas(W, H);
  const lctx = getCtx(letterCanvas);
  drawWord(lctx, W, H);
  const letterMask = opaquePixels(lctx, W, H);

  // ---- Frame canvas: rectangle minus letters ---------------------------
  const frameCanvas = makeCanvas(W, H);
  const fctx = getCtx(frameCanvas);
  // Fill the plaque.
  const fw = W * TUNING.frameWidthFrac;
  const fh = H * TUNING.frameHeightFrac;
  const fx = (W - fw) / 2;
  const fy = (H - fh) / 2;
  fctx.fillStyle = "#000";
  fctx.fillRect(fx, fy, fw, fh);
  // Knock out the letter shapes, with extra padding so letters and plaque
  // never touch. "destination-out" makes the next draw punch transparent
  // holes in what we already drew.
  fctx.globalCompositeOperation = "destination-out";
  // Draw the letters thicker to create padding: use shadowBlur for a
  // uniform radial padding, then draw with a shadow so the knockout eats
  // into the frame wider than the glyph itself.
  fctx.shadowColor = "#000";
  fctx.shadowBlur = TUNING.letterKnockoutPadding * 1.2;
  drawWord(fctx, W, H);
  fctx.shadowBlur = 0;
  fctx.globalCompositeOperation = "source-over";
  const frameMask = opaquePixels(fctx, W, H);

  if (letterMask.length === 0 || frameMask.length === 0) {
    // Fonts not loaded yet — caller will retry.
    return { letter: [], frame: [] };
  }

  return {
    letter: pickN(letterMask, W, H, TUNING.letterShardCount, 0xfab01c01),
    frame: pickN(frameMask, W, H, TUNING.frameShardCount, 0xcafeface),
  };
}

// -----------------------------------------------------------------------
// helpers

function makeCanvas(W: number, H: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return c;
}

function getCtx(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  return ctx;
}

/** Render TUNING.wordRows centered on the canvas. Assumes the context is
 *  fresh (no prior fill style set). Uses the letterSpacing tuning so the
 *  word reads tight enough to feel like a single unit. */
function drawWord(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): void {
  ctx.fillStyle = "#000";
  ctx.textAlign = "left"; // we position per-char manually
  ctx.textBaseline = "alphabetic";

  const rows = TUNING.wordRows;
  const longest = rows.reduce(
    (max, r) => (r.length > max.length ? r : max),
    rows[0],
  );

  // Fit the longest row to ~80% of the inner plaque width so there's
  // breathing room on the sign.
  const targetWidth = W * TUNING.frameWidthFrac * 0.86;
  let fontSize = Math.floor(H * 0.85);
  for (let iter = 0; iter < 32; iter++) {
    ctx.font = `${TUNING.fontWeight} ${fontSize}px ${TUNING.fontFamily}`;
    const measured = measureRow(ctx, longest);
    if (measured <= targetWidth) break;
    fontSize = Math.floor(fontSize * 0.96);
  }
  ctx.font = `${TUNING.fontWeight} ${fontSize}px ${TUNING.fontFamily}`;

  const ascent = fontSize * 0.78;
  const rowAdvance = fontSize * TUNING.lineHeight;
  const blockHeight = ascent + rowAdvance * (rows.length - 1);
  const firstBaseline = (H - blockHeight) / 2 + ascent;

  for (let r = 0; r < rows.length; r++) {
    drawRow(ctx, rows[r], W, firstBaseline + r * rowAdvance, fontSize);
  }
}

/** Draw a single row with explicit per-character spacing, centered on W. */
function drawRow(
  ctx: CanvasRenderingContext2D,
  row: string,
  W: number,
  baseline: number,
  fontSize: number,
): void {
  const spacing = TUNING.letterSpacing * fontSize;
  const widths = [...row].map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (row.length - 1);
  let x = (W - total) / 2;
  for (let i = 0; i < row.length; i++) {
    ctx.fillText(row[i], x, baseline);
    x += widths[i] + spacing;
  }
}

function measureRow(ctx: CanvasRenderingContext2D, row: string): number {
  const widths = [...row].map((c) => ctx.measureText(c).width);
  const spacing =
    TUNING.letterSpacing * parseInt(ctx.font.match(/(\d+)px/)?.[1] ?? "0", 10);
  return widths.reduce((a, b) => a + b, 0) + spacing * (row.length - 1);
}

/** Return a flat array of pixel indices (row * W + col) where alpha > threshold. */
function opaquePixels(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): number[] {
  const { data } = ctx.getImageData(0, 0, W, H);
  const inside: number[] = [];
  const thresh = TUNING.alphaThreshold;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] >= thresh) inside.push((i - 3) >> 2);
  }
  return inside;
}

/** Pick N random samples (with replacement) from the mask, converting each
 *  to normalized (nx, ny) in [-1, 1]. */
function pickN(
  mask: number[],
  W: number,
  H: number,
  N: number,
  seed: number,
): SampledPixel[] {
  const rand = mulberry32(seed);
  const out: SampledPixel[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const pick = mask[(rand() * mask.length) | 0];
    const px = pick % W;
    const py = (pick / W) | 0;
    out[i] = {
      nx: (px / W) * 2 - 1,
      ny: -((py / H) * 2 - 1),
    };
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
