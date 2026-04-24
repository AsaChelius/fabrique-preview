"use client";

/**
 * "Nos Projets" — an in-scene suspended-metal button.
 *
 * Samples its own small text silhouette, places shards along viewing rays
 * from the same sweet-spot camera (so the label resolves anamorphically
 * at the same angle as FABRIQUE), and renders them as a self-contained
 * mini-sculpture. A transparent hit-box plane above the shards captures
 * pointer events for hover/click without disturbing the main cursor
 * physics on the big sculpture.
 *
 * Static by design — these shards do NOT participate in the main
 * ShardPhysicsState, so the cursor cannot push them around. Hover raises
 * the material's emissiveIntensity smoothly so the button "lights up".
 * Click routes to /projects.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useSculpturePalette } from "./palette";
import {
  isShowcaseActive,
  onShowcaseChange,
  toggleShowcase,
} from "./showcase-bus";
import { TUNING } from "./tuning";
import type { Placement } from "./placements";

// ---- Button-local tuning -------------------------------------------------
const BUTTON = {
  label: "NOS PROJETS",
  /** Target route on click. */
  href: "/projects",

  // ---- Placement in the world (centerY + halfWidth live in TUNING so
  //      the plaque sampler can knock out this region to keep the
  //      button clear of frame shards). ----
  /** World Y where the button's own wires attach. Just above the label. */
  localCeilingY: -0.85,

  // ---- Sampling ---- (higher-res sampling → crisper silhouette edges)
  sampleWidth: 1800,
  sampleHeight: 260,
  alphaThreshold: 140,

  // ---- Shard config ---- (more shards + flatter cloud + tighter
  //      jitter → the label reads like sharp typography from the
  //      sweet-spot camera) ----
  shardCount: 1800,
  shardHeight: 0.042,
  shardWidth: 0.018,
  shardThickness: 0.0018,
  /** Small cloud depth so silhouette stays tight. */
  cloudDepth: 0.4,
  /** Strong bias toward the mid-plane — most shards sit near z=0 so
   *  silhouette edges aren't blurred by perspective spread. */
  depthBias: 2.4,
  /** Override TUNING.yawJitter locally — button wants less rotation
   *  scatter than the main FABRIQUE shards so it reads as a legible
   *  label, not a cloud. */
  yawJitter: 0.18,
  tiltJitter: 0.04,

  // ---- Material ----
  baseColor: "#5a5e66",
  /** Warm-white glow color blended in on hover. */
  hoverEmissive: "#ffd48a",
  /** Max emissive intensity when fully hovered. */
  hoverMaxEmissive: 1.1,
  /** Hover lerp speed (per frame). */
  hoverLerp: 0.18,

  // ---- Wire config ----
  wireRadius: 0.0005,
  wireColor: "#9aa0a8",
  wireOpacity: 0.55,

  // ---- Hitbox padding (world units) ----
  hitPaddingX: 0.35,
  hitPaddingY: 0.28,

  // ---- Hover oscillation ----
  /** Peak vertical wobble amplitude in world units. Button sways up/down
   *  this many units when hovered. */
  hoverOscillateAmp: 0.04,
  /** Oscillation angular frequency (rad / sec). 2π ≈ 1Hz. */
  hoverOscillateFreq: 6.5,
  /** Lerp toward the current hover target (0 or 1) — gives a smooth
   *  ramp-up/ramp-down instead of the wobble snapping on or off. */
  hoverOscillateLerp: 0.08,

  // ---- Back-arrow (shown when the showcase is open) ----
  /** Per-frame lerp toward the active layout (text or arrow). Low = slow
   *  smooth morph; higher = snappier. Bumped ~33% so the NOS PROJETS →
   *  arrow morph lands at the same pace as the rest of the showcase
   *  transition. */
  morphLerp: 0.10,
  /** Arrow geometry, world units. Shaft runs along x at buttonCenterY.
   *  Smaller than the original NOS PROJETS label so it reads as a
   *  secondary "back" control, not a headline. */
  arrowShaftHalfLength: 0.38,
  arrowShaftThickness: 0.07,
  /** Chevron from tip (left end of shaft) opening to the right at this
   *  half-length. */
  arrowChevronLength: 0.25,
  /** Vertical rise / drop of each chevron leg. */
  arrowChevronRise: 0.15,
  /** Thickness (perpendicular scatter) of each chevron leg. */
  arrowChevronThickness: 0.06,
} as const;

export function ProjectsButton() {
  const [hover, setHover] = useState(false);
  const [placements, setPlacements] = useState<Placement[] | null>(null);
  const [showcase, setShowcase] = useState<boolean>(() => isShowcaseActive());
  const palette = useSculpturePalette();

  useEffect(() => onShowcaseChange(setShowcase), []);

  // Back-arrow placements used when the showcase is open — same shard
  // count as the text so we can lerp 1:1 between the two layouts.
  const arrowPlacements = useMemo<Placement[] | null>(() => {
    if (!placements) return null;
    return computeArrowPlacements(placements.length);
  }, [placements]);

  // Sample text once, after fonts are ready.
  useLayoutEffect(() => {
    let cancelled = false;
    const run = () => {
      const p = computeButtonPlacements();
      if (!cancelled) setPlacements(p);
    };
    if (typeof document !== "undefined" && "fonts" in document) {
      document.fonts.ready.then(() => {
        if (!cancelled) run();
      });
    } else {
      run();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // CSS cursor over the canvas toggles to pointer on hover.
  useEffect(() => {
    if (!hover) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [hover]);

  const geometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        BUTTON.shardWidth,
        BUTTON.shardHeight,
        BUTTON.shardThickness,
      ),
    [],
  );

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(palette.projectsBase),
        metalness: 1,
        roughness: 0.3,
        emissive: new THREE.Color(palette.projectsEmissive),
        emissiveIntensity: 0,
        envMapIntensity: TUNING.envMapIntensity,
      }),
    // Created once — recreating would rebuild the InstancedMesh and
    // clear its per-instance matrices. Colors mutate in place below.
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const targetBase = useMemo(
    () => new THREE.Color(palette.projectsBase),
    [palette.projectsBase],
  );
  const targetEmissive = useMemo(
    () => new THREE.Color(palette.projectsEmissive),
    [palette.projectsEmissive],
  );
  useFrame(() => {
    material.color.lerp(targetBase, TUNING.paletteLerp);
    material.emissive.lerp(targetEmissive, TUNING.paletteLerp);
  });

  const shardMeshRef = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  // Smoothed hover amplitude (0 = resting, 1 = full wobble). Lerped
  // toward `hover ? 1 : 0` per frame so the oscillation fades in/out.
  const hoverAmp = useRef(0);

  // Rotations never change — precompute once from the text placements
  // and reuse for both text and arrow layouts. Gives a consistent
  // scattered look across the morph.
  const baseQuats = useMemo<Float32Array | null>(() => {
    if (!placements) return null;
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

  // Live position per shard. On mount starts at the text layout; the
  // useFrame below lerps it toward whichever target is active
  // (text or arrow). This is what drives the visible morph animation.
  const currentPos = useRef<Float32Array | null>(null);

  useLayoutEffect(() => {
    if (!placements) return;
    const shardMesh = shardMeshRef.current;
    if (!shardMesh) return;
    const N = placements.length;
    const buf = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      buf[i * 3] = placements[i].x;
      buf[i * 3 + 1] = placements[i].y;
      buf[i * 3 + 2] = placements[i].z;
    }
    currentPos.current = buf;
    shardMesh.count = N;
    shardMesh.frustumCulled = false;
  }, [placements]);

  // Per-frame: lerp each shard toward the active layout, then rewrite
  // the instance matrices.
  useFrame(() => {
    const cur = currentPos.current;
    const quats = baseQuats;
    const shardMesh = shardMeshRef.current;
    if (!placements || !cur || !quats || !shardMesh) return;

    const targets = showcase && arrowPlacements ? arrowPlacements : placements;
    const lerp = BUTTON.morphLerp;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < placements.length; i++) {
      const t = targets[i];
      const i3 = i * 3;
      cur[i3]     += (t.x - cur[i3])     * lerp;
      cur[i3 + 1] += (t.y - cur[i3 + 1]) * lerp;
      cur[i3 + 2] += (t.z - cur[i3 + 2]) * lerp;
      const x = cur[i3];
      const y = cur[i3 + 1];
      const z = cur[i3 + 2];

      const i4 = i * 4;
      q.set(quats[i4], quats[i4 + 1], quats[i4 + 2], quats[i4 + 3]);
      pos.set(x, y, z);
      m.compose(pos, q, scale);
      shardMesh.setMatrixAt(i, m);
    }

    shardMesh.instanceMatrix.needsUpdate = true;
  });

  // Lerp emissive intensity + hover wobble amplitude, then apply the
  // wobble to the group so all shards + wires sway together.
  useFrame((state) => {
    const emTarget = hover ? BUTTON.hoverMaxEmissive : 0;
    material.emissiveIntensity +=
      (emTarget - material.emissiveIntensity) * BUTTON.hoverLerp;

    const ampTarget = hover ? 1 : 0;
    hoverAmp.current +=
      (ampTarget - hoverAmp.current) * BUTTON.hoverOscillateLerp;

    const group = groupRef.current;
    if (group) {
      const t = state.clock.elapsedTime;
      group.position.y =
        hoverAmp.current *
        Math.sin(t * BUTTON.hoverOscillateFreq) *
        BUTTON.hoverOscillateAmp;
    }
  });

  if (!placements) return null;

  // Hitbox dimensions in world units: use label half-width + padding.
  const halfW = TUNING.buttonHalfWidth + BUTTON.hitPaddingX;
  const halfH = TUNING.buttonHalfHeight + BUTTON.hitPaddingY;

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(false);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    toggleShowcase();
  };

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={shardMeshRef}
        args={[geometry, material, placements.length]}
      />
      {/* Transparent hit-plane positioned at the button's z=0 center. Must
          be large enough to be easy to hover with a cursor. */}
      <mesh
        position={[0, TUNING.buttonCenterY, 0]}
        onPointerOver={onOver}
        onPointerOut={onOut}
        onClick={onClick}
        visible={false}
      >
        <planeGeometry args={[halfW * 2, halfH * 2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

// -----------------------------------------------------------------------

function computeButtonPlacements(): Placement[] {
  const W = BUTTON.sampleWidth;
  const H = BUTTON.sampleHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Fit to ~82% of the sampling width.
  const target = W * 0.82;
  let fontSize = Math.floor(H * 0.82);
  for (let iter = 0; iter < 20; iter++) {
    ctx.font = `700 ${fontSize}px ${TUNING.fontFamily}`;
    if (ctx.measureText(BUTTON.label).width <= target) break;
    fontSize = Math.floor(fontSize * 0.96);
  }
  ctx.font = `700 ${fontSize}px ${TUNING.fontFamily}`;
  ctx.fillText(BUTTON.label, W / 2, H / 2);

  const { data } = ctx.getImageData(0, 0, W, H);
  const inside: number[] = [];
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] >= BUTTON.alphaThreshold) inside.push((i - 3) >> 2);
  }
  if (inside.length === 0) return [];

  // Derive halfH from the sampling canvas aspect so the text preserves
  // its drawn proportions. TUNING.buttonHalfHeight is used separately for
  // the plaque-knockout region in sampling.ts.
  const halfW = TUNING.buttonHalfWidth;
  const halfH = halfW / (W / H);
  const camZ = TUNING.cameraZ;

  const rand = mulberry32(0xb0a7b07);
  const out: Placement[] = new Array(BUTTON.shardCount);

  for (let i = 0; i < BUTTON.shardCount; i++) {
    const pick = inside[(rand() * inside.length) | 0];
    const px = pick % W;
    const py = (pick / W) | 0;
    const nx = (px / W) * 2 - 1;
    const ny = -((py / H) * 2 - 1);

    // Pixel projects onto the z=0 plane at (nx*halfW, ny*halfH + centerY).
    const x0 = nx * halfW;
    const y0 = ny * halfH + TUNING.buttonCenterY;

    const u = rand() * 2 - 1;
    const biased = Math.sign(u) * Math.pow(Math.abs(u), BUTTON.depthBias);
    const dz = biased * BUTTON.cloudDepth;

    // Anamorphic ratio so each shard sits on the viewing ray from
    // (0, 0, camZ) through (x0, y0, 0). Same trick as the main cloud.
    const ratio = (camZ - dz) / camZ;
    const x = x0 * ratio;
    const y = y0 * ratio;

    const yaw = (rand() * 2 - 1) * BUTTON.yawJitter;
    const tilt = (rand() * 2 - 1) * BUTTON.tiltJitter;

    out[i] = { x, y, z: dz, yaw, tilt };
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

/**
 * Generate shard placements that form a left-pointing back arrow:
 * horizontal shaft + two chevron legs meeting at the tip. Output has
 * the same length as `textCount` so each text shard has a 1:1 arrow
 * target to lerp toward — rotations carry over unchanged.
 */
function computeArrowPlacements(textCount: number): Placement[] {
  const rand = mulberry32(0x4a2e0b1d);
  // Sit a touch below where the "NOS PROJETS" label lived so the arrow
  // reads as a secondary/back affordance, not a drop-in replacement.
  const cy = TUNING.buttonCenterY - 0.15;
  const shaftHalf = BUTTON.arrowShaftHalfLength;
  const shaftThick = BUTTON.arrowShaftThickness;
  const chevLen = BUTTON.arrowChevronLength;
  const chevRise = BUTTON.arrowChevronRise;
  const chevThick = BUTTON.arrowChevronThickness;
  const tipX = -shaftHalf;

  // Split: 50% shaft, 25% upper chevron, 25% lower chevron.
  const shaftCount = Math.floor(textCount * 0.5);
  const upperCount = Math.floor(textCount * 0.25);
  const lowerCount = textCount - shaftCount - upperCount;

  const out: Placement[] = new Array(textCount);

  for (let i = 0; i < shaftCount; i++) {
    const u = rand();
    out[i] = {
      x: tipX + u * (shaftHalf * 2),
      y: cy + (rand() - 0.5) * shaftThick,
      z: (rand() - 0.5) * 0.15,
      yaw: (rand() - 0.5) * 2 * BUTTON.yawJitter,
      tilt: (rand() - 0.5) * 2 * BUTTON.tiltJitter,
    };
  }
  // Upper chevron: tip → (tipX + chevLen, cy + chevRise)
  for (let i = 0; i < upperCount; i++) {
    const u = rand();
    const bx = tipX + u * chevLen;
    const by = cy + u * chevRise;
    out[shaftCount + i] = {
      x: bx + (rand() - 0.5) * chevThick * 0.7,
      y: by + (rand() - 0.5) * chevThick,
      z: (rand() - 0.5) * 0.15,
      yaw: (rand() - 0.5) * 2 * BUTTON.yawJitter,
      tilt: (rand() - 0.5) * 2 * BUTTON.tiltJitter,
    };
  }
  // Lower chevron: tip → (tipX + chevLen, cy - chevRise)
  for (let i = 0; i < lowerCount; i++) {
    const u = rand();
    const bx = tipX + u * chevLen;
    const by = cy - u * chevRise;
    out[shaftCount + upperCount + i] = {
      x: bx + (rand() - 0.5) * chevThick * 0.7,
      y: by + (rand() - 0.5) * chevThick,
      z: (rand() - 0.5) * 0.15,
      yaw: (rand() - 0.5) * 2 * BUTTON.yawJitter,
      tilt: (rand() - 0.5) * 2 * BUTTON.tiltJitter,
    };
  }
  return out;
}
