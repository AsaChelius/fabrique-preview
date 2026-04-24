"use client";

/**
 * Animated metal strips — one InstancedMesh of thin vertical rectangles.
 *
 * Reads its slice of the shared ShardPhysicsState every frame and writes
 * instance matrices from home + cursor-offset + idle-sway. The physics
 * driver updates offsets before any Shards runs (useFrame order).
 *
 * Rotation (yaw + tilt) is precomputed once from placements and reused
 * every frame — it doesn't change with the physics. Position is the
 * only thing that moves.
 *
 * Chameleon color (showcase mode): when `showcaseRef.current.active` is
 * true and a `cardIndex` array is present, each shard samples a per-card
 * HSL hue that flows over time with per-shard noise. Colors are written
 * via `setColorAt`, which multiplies against `material.color`. When the
 * showcase closes, the per-instance color fades back to white so the
 * material.color (letterShard / frameShard palette colors) reads again.
 */

import type { MutableRefObject } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TUNING } from "./tuning";
import type { Placement } from "./placements";
import type { ShardPhysicsState } from "./physics";

export type ShowcaseRef = {
  active: boolean;
  cardIndex: Int8Array | null;
  /** (dx, dy, dz, t) per shard for outline meshes. Drives the snake
   *  wave flow along each card edge. Null for interior-fill meshes. */
  edgeFlow: Float32Array | null;
  /** 0..4 when the cursor is hovering that card's hitbox — shards
   *  whose `cardIndex` matches get a glow boost on their chameleon
   *  color (brighter + more saturated). Null = no hover. */
  hoveredCard: number | null;
  /** When not null, every shard tints from this single hue (the
   *  clicked card's hue) — used in "expanded" mode where all shards
   *  collapse into one big merged box. */
  dominantCard: number | null;
};

/**
 * `"still"` — suppress ALL motion during showcase. Wireframes locked.
 * `"snake"` — suppress sway, then ripple shards along their own edge
 *              direction with a traveling wave (phase = edge-t position,
 *              wave travels along the edge). Outline contour flow.
 * `"wind"`  — keep sway AND add per-axis XYZ wind displacement.
 *              Turbulent interior fill.
 */
export type ShowcaseMotion = "still" | "snake" | "wind";

export type ShardsProps = {
  placements: Placement[];
  color: string;
  /** Shared physics state (covers ALL shards globally). */
  state: ShardPhysicsState;
  /** Index in `state` where this mesh's slice starts. */
  stateStart: number;
  /** Live pointer into showcase state. Read each frame — no re-render
   *  on toggle. Produces per-instance chameleon color when active. */
  showcaseRef: MutableRefObject<ShowcaseRef>;
  /** How this mesh behaves while the showcase morph is > 0. Defaults
   *  to "still". */
  showcaseMotion?: ShowcaseMotion;
};

export function Shards({
  placements,
  color,
  state,
  stateStart,
  showcaseRef,
  showcaseMotion = "still",
}: ShardsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        TUNING.shardWidth,
        TUNING.shardHeight,
        TUNING.shardThickness,
      ),
    [],
  );

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(color),
        metalness: TUNING.metalness,
        roughness: TUNING.roughness,
        iridescence: TUNING.iridescence,
        iridescenceIOR: TUNING.iridescenceIOR,
        envMapIntensity: TUNING.envMapIntensity,
        // DoubleSide so shards still render correctly inside the
        // mirror group (scale=[1,-1,1] flips face winding; FrontSide
        // would cull the camera-facing faces in the reflection).
        side: THREE.DoubleSide,
      }),
    // Intentionally created once — recreating would rebuild the mesh and
    // wipe per-instance matrices + colors. Lerped in place below.
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const targetColor = useMemo(() => new THREE.Color(color), [color]);
  useFrame(() => {
    material.color.lerp(targetColor, TUNING.paletteLerp);
  });

  // Per-shard deterministic noise seed (for chameleon phase variation).
  const shardSeeds = useMemo(() => {
    const arr = new Float32Array(placements.length);
    for (let i = 0; i < placements.length; i++) {
      // Math.sin(seed * 12.9898) * 43758.5453 % 1 — deterministic noise
      // per CLAUDE.md's "use this, not Math.random()" rule.
      const s = Math.sin(i * 12.9898) * 43758.5453;
      arr[i] = s - Math.floor(s);
    }
    return arr;
  }, [placements]);

  // Per-axis wind phase for each shard. Three independent-ish streams
  // (different hash multipliers) so each shard drifts on its own beat
  // in x, y, and z. Stored flat as xyz triples for cache-friendly reads.
  const windPhases = useMemo(() => {
    const arr = new Float32Array(placements.length * 3);
    for (let i = 0; i < placements.length; i++) {
      const sx = Math.sin(i * 12.9898) * 43758.5453;
      const sy = Math.sin(i * 78.233) * 43758.5453;
      const sz = Math.sin(i * 43.758) * 29134.7421;
      arr[i * 3]     = (sx - Math.floor(sx)) * Math.PI * 2;
      arr[i * 3 + 1] = (sy - Math.floor(sy)) * Math.PI * 2;
      arr[i * 3 + 2] = (sz - Math.floor(sz)) * Math.PI * 2;
    }
    return arr;
  }, [placements]);

  // Precompute per-shard base quaternion (rotation never changes).
  const baseQuats = useMemo(() => {
    const arr = new Float32Array(placements.length * 4);
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      e.set(p.tilt, p.yaw, 0, "YXZ");
      q.setFromEuler(e);
      arr[i * 4] = q.x;
      arr[i * 4 + 1] = q.y;
      arr[i * 4 + 2] = q.z;
      arr[i * 4 + 3] = q.w;
    }
    return arr;
  }, [placements]);

  // Chameleon fade factor: 0 = no per-instance tint (material.color
  // reads), 1 = full chameleon. Lerps toward `showcaseRef.active ? 1 : 0`.
  const colorMorph = useRef(0);
  const prevColorMorph = useRef(0);
  // Last-known card-index assignment. When showcase deactivates the
  // parent nulls its ref immediately, but the color morph takes ~0.5s
  // to fade out — during that fade we keep tinting from the cached
  // assignment so colors don't snap to white the instant hover ends.
  const cachedCardIndex = useRef<Int8Array | null>(null);
  // Same caching for edge-flow data so the snake motion fades smoothly
  // as the showcase closes.
  const cachedEdgeFlow = useRef<Float32Array | null>(null);

  // Initial instance matrices (before any useFrame tick).
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      pos.set(p.x, p.y, p.z);
      quat.set(
        baseQuats[i * 4],
        baseQuats[i * 4 + 1],
        baseQuats[i * 4 + 2],
        baseQuats[i * 4 + 3],
      );
      m.compose(pos, quat, scale);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = placements.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
  }, [placements, baseQuats]);

  // Per-frame: home + physics offset + idle sway + chameleon color.
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const tmpCol = _tmpColor;
    const N = placements.length;
    const s = state;
    const yFactor = TUNING.swayVerticalFactor;

    // Update the chameleon fade factor.
    const target = showcaseRef.current.active ? 1 : 0;
    colorMorph.current +=
      (target - colorMorph.current) * TUNING.showcaseColorLerp;
    const morph = colorMorph.current;
    const prevMorph = prevColorMorph.current;

    // Write per-instance colors if:
    //   - we're currently in chameleon territory (morph > epsilon), OR
    //   - we just crossed the epsilon boundary on the way out (need one
    //     final pass to reset all instance colors to white so the
    //     material color takes over cleanly).
    const writingColors = morph > 0.005 || prevMorph > 0.005;
    const incoming = showcaseRef.current.cardIndex;
    if (incoming) cachedCardIndex.current = incoming;
    const cardIndex = cachedCardIndex.current;
    const incomingEdge = showcaseRef.current.edgeFlow;
    if (incomingEdge) cachedEdgeFlow.current = incomingEdge;
    const edgeFlow = cachedEdgeFlow.current;
    const hoveredCard = showcaseRef.current.hoveredCard;
    const dominantCard = showcaseRef.current.dominantCard;

    // Showcase motion mode (see ShowcaseMotion type for details).
    // `morph` is the same fade factor that drives the chameleon color,
    // so motion + color ramp together when the showcase opens / closes.
    const isWind = showcaseMotion === "wind";
    const isSnake = showcaseMotion === "snake";
    // sway fades out in "still" and "snake" modes — both want the
    // wireframe/pose locked; "wind" keeps full sway underneath the
    // wind layer.
    const swayScale = isWind ? 1 : 1 - morph;
    const windOn = isWind && morph > 0.005;
    const snakeOn = isSnake && morph > 0.005 && edgeFlow !== null;
    const wScale = morph;
    const wax = TUNING.windAmpX;
    const way = TUNING.windAmpY;
    const waz = TUNING.windAmpZ;
    const wfx = TUNING.windFreqX;
    const wfy = TUNING.windFreqY;
    const wfz = TUNING.windFreqZ;
    const snakeAmp = TUNING.snakeAmp;
    const snakeK = TUNING.snakeWaveCount * Math.PI * 2;
    const snakeOmega = TUNING.snakeWaveSpeed * Math.PI * 2;

    for (let i = 0; i < N; i++) {
      const gi = stateStart + i;
      const h3 = gi * 3;
      const phase = s.swayPhase[gi];
      const amp = s.swayAmp[gi];
      const freq = s.swayFreq[gi];
      const sway = Math.sin(t * freq + phase) * amp * swayScale;
      const bob = Math.cos(t * freq * 0.73 + phase) * amp * yFactor * swayScale;

      let dx = 0;
      let dy = 0;
      let dz = 0;

      if (windOn) {
        const w3 = i * 3;
        dx = Math.sin(t * wfx + windPhases[w3]) * wax * wScale;
        dy = Math.sin(t * wfy + windPhases[w3 + 1]) * way * wScale;
        dz = Math.sin(t * wfz + windPhases[w3 + 2]) * waz * wScale;
      } else if (snakeOn) {
        // Traveling wave along the shard's own edge. edgeT * k - t * ω
        // means later t-positions on the edge peak later in time —
        // the hump advances along the edge in the +t direction.
        const e4 = i * 4;
        const ex = edgeFlow![e4];
        const ey = edgeFlow![e4 + 1];
        const ez = edgeFlow![e4 + 2];
        const eT = edgeFlow![e4 + 3];
        const wave = Math.sin(eT * snakeK - t * snakeOmega) * snakeAmp * wScale;
        dx = ex * wave;
        dy = ey * wave;
        dz = ez * wave;
      }

      pos.set(
        s.home[h3] + s.offset[h3] + sway + dx,
        s.home[h3 + 1] + s.offset[h3 + 1] + bob + dy,
        s.home[h3 + 2] + s.offset[h3 + 2] + dz,
      );
      quat.set(
        baseQuats[i * 4],
        baseQuats[i * 4 + 1],
        baseQuats[i * 4 + 2],
        baseQuats[i * 4 + 3],
      );
      m.compose(pos, quat, scale);
      mesh.setMatrixAt(i, m);

      if (writingColors) {
        if (morph > 0.005 && cardIndex) {
          // Hue source: in "expanded" mode (dominantCard set) every
          // shard takes the clicked card's hue; otherwise per-shard.
          const hueCard = dominantCard !== null ? dominantCard : cardIndex[i];
          // Hover glow applies to shards whose OWN card is hovered —
          // ignored in expanded mode (dominantCard already overrides
          // the color and hover on the merged box is out of scope).
          const glow =
            dominantCard === null &&
            hoveredCard !== null &&
            cardIndex[i] === hoveredCard;
          chameleonColor(hueCard, t, shardSeeds[i], glow, tmpCol);
          // Blend toward white by (1 - morph) so the tint fades in/out.
          const im = 1 - morph;
          tmpCol.r = tmpCol.r * morph + im;
          tmpCol.g = tmpCol.g * morph + im;
          tmpCol.b = tmpCol.b * morph + im;
          mesh.setColorAt(i, tmpCol);
        } else {
          // Out — reset to white so material.color reads cleanly.
          tmpCol.setRGB(1, 1, 1);
          mesh.setColorAt(i, tmpCol);
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (writingColors && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    prevColorMorph.current = morph;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, placements.length]}
    />
  );
}

// ---- Chameleon color ----------------------------------------------------

const _tmpColor = new THREE.Color();

function chameleonColor(
  cardIdx: number,
  t: number,
  shardPhase: number,
  glow: boolean,
  out: THREE.Color,
): void {
  const base = TUNING.cardHues[cardIdx] ?? 0;
  const drift = t * TUNING.hueDriftRate;
  const swirl =
    TUNING.hueFlowAmp * Math.sin(t * 0.6 + cardIdx * 1.37);
  const wiggle =
    TUNING.hueShardNoise *
    Math.sin(t * 1.1 + shardPhase * Math.PI * 2);
  const hue = positiveMod(base + drift + swirl + wiggle, 1);
  // Glow = raise saturation and lightness for a "lit up" read, clamped
  // just below 1 so the HSL conversion stays stable.
  const satBoost = glow ? TUNING.glowSatBoost : 0;
  const lightBoost = glow ? TUNING.glowLightBoost : 0;
  const sat = Math.min(
    0.99,
    TUNING.chameleonSat + satBoost - 0.08 * Math.sin(t * 0.7 + shardPhase * 3.14),
  );
  const light = Math.min(
    0.94,
    TUNING.chameleonLight + lightBoost + 0.05 * Math.sin(t * 0.9 + shardPhase * 7),
  );
  out.setHSL(hue, sat, light);
}

function positiveMod(x: number, n: number): number {
  return ((x % n) + n) % n;
}
