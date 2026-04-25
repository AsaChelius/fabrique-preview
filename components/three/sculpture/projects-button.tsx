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
  getMode,
  isShowcaseActive,
  onModeChange,
  onShowcaseChange,
  toggleShowcase,
  type ShowcaseMode,
} from "./showcase-bus";
import { TUNING } from "./tuning";
import type { Placement } from "./placements";
import { setCursorHover } from "./cursor-bus";
import {
  playSound,
  playSample,
  preloadSample,
  getSampleDuration,
  unlockAudio,
  type SampleHandle,
} from "@/lib/sound";

/** Reverse-cymbal swell that scores the NOS PROJETS morph. Trimmed
 *  region: skip 0.3s of dead air at the start, play 11s of swell. When
 *  the user clicks again mid-morph we stop the active playback and start
 *  a reversed copy at the matching position so the audio rewinds.
 *
 *  Forward playback covers original[CYMBAL_START_OFFSET .. CYMBAL_START_OFFSET+CYMBAL_PLAY_LEN].
 *  At elapsed time `e`, the playhead is at original time S+e.
 *  Reversed buffer index for original time T is `bufDuration - T`.
 *  So reversed-offset = bufDuration - (S + e); play for `e` seconds. */
const CYMBAL_URL = "/sounds/" + encodeURIComponent("reversecymbal_[cut_5sec].mp3");
// File is now manually trimmed to ~5s — no need to skip dead air or
// truncate. Start at 0 and play the whole thing. The actual duration
// is read into cymbalBufDuration on first preload and used for the
// reverse-offset math.
const CYMBAL_START_OFFSET = 0;
const CYMBAL_PLAY_LEN = 5;
const CYMBAL_VOLUME = 0.08;

// Module-level state for the cymbal toggle. Lives outside the component
// so click → click rapid-fire keeps a single active handle without
// fighting React re-renders.
let cymbalHandle: SampleHandle | null = null;
// Wall-clock ms when the current direction's playback began.
let cymbalStartedAt = 0;
// Original-buffer time (seconds) of the playhead at `cymbalStartedAt`.
// Forward starts at CYMBAL_START_OFFSET; mid-morph swaps anchor here so
// elapsed math gives the correct continuous position.
let cymbalAnchorOriginalT = 0;
// True while playing the reversed buffer.
let cymbalReversed = false;
// Cached buffer duration (seconds). Filled lazily after first preload.
let cymbalBufDuration: number | null = null;

let cymbalAutoClearId: ReturnType<typeof setTimeout> | null = null;

function scheduleCymbalAutoClear(seconds: number) {
  if (cymbalAutoClearId) clearTimeout(cymbalAutoClearId);
  cymbalAutoClearId = setTimeout(() => {
    cymbalHandle = null;
    cymbalAutoClearId = null;
  }, seconds * 1000 + 60);
}

/** Current original-buffer playhead time (seconds) for the active
 *  playback, accounting for direction. Forward = anchor + elapsed,
 *  reversed = anchor - elapsed. */
function currentOriginalT(now: number): number {
  const elapsed = (now - cymbalStartedAt) / 1000;
  return cymbalReversed
    ? cymbalAnchorOriginalT - elapsed
    : cymbalAnchorOriginalT + elapsed;
}

function handleCymbalToggle() {
  // Cache buffer duration on first interaction. Until it resolves we
  // fall back to (CYMBAL_START_OFFSET + CYMBAL_PLAY_LEN) for the math —
  // accurate when the file is exactly that long, close-enough otherwise.
  if (cymbalBufDuration == null) {
    getSampleDuration(CYMBAL_URL).then((d) => {
      if (d != null) cymbalBufDuration = d;
    });
  }
  const bufDuration = cymbalBufDuration ?? CYMBAL_START_OFFSET + CYMBAL_PLAY_LEN;

  const now = performance.now();

  if (cymbalHandle) {
    // Mid-morph click: figure out where the playhead is in original-
    // buffer time, then start the OPPOSITE direction at that exact spot.
    const playheadT = Math.max(
      CYMBAL_START_OFFSET,
      Math.min(CYMBAL_START_OFFSET + CYMBAL_PLAY_LEN, currentOriginalT(now)),
    );
    cymbalHandle.stop(40);

    cymbalReversed = !cymbalReversed;
    let offset: number;
    let durationToPlay: number;
    if (cymbalReversed) {
      // Reversed buffer index for original time T is (bufDuration - T).
      // Play backwards from playheadT down to CYMBAL_START_OFFSET.
      offset = bufDuration - playheadT;
      durationToPlay = playheadT - CYMBAL_START_OFFSET;
    } else {
      // Forward from playheadT up to the end of the trimmed region.
      offset = playheadT;
      durationToPlay = CYMBAL_START_OFFSET + CYMBAL_PLAY_LEN - playheadT;
    }
    cymbalHandle = playSample(CYMBAL_URL, CYMBAL_VOLUME, offset, durationToPlay, {
      reversed: cymbalReversed,
    });
    cymbalAnchorOriginalT = playheadT;
    cymbalStartedAt = now;
    scheduleCymbalAutoClear(durationToPlay);
    return;
  }

  // Fresh click — opening the showcase. Forward from CYMBAL_START_OFFSET.
  cymbalReversed = false;
  cymbalAnchorOriginalT = CYMBAL_START_OFFSET;
  cymbalStartedAt = now;
  cymbalHandle = playSample(
    CYMBAL_URL,
    CYMBAL_VOLUME,
    CYMBAL_START_OFFSET,
    CYMBAL_PLAY_LEN,
    { reversed: false },
  );
  scheduleCymbalAutoClear(CYMBAL_PLAY_LEN);
}

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

  // ---- Hover separation ----
  // On hover each shard drifts outward along its own random direction —
  // replaces the old vertical oscillation, which read as the whole
  // label bouncing instead of as the piece reacting to the cursor.
  /** Peak outward displacement per shard (world units). Small — it's a
   *  subtle "pieces breathe apart" effect, not an explosion. */
  hoverSeparationAmp: 0.022,
  /** Lerp toward hover target (0 or 1). Low = smooth ramp in/out. */
  hoverSeparationLerp: 0.085,

  // ---- 3D tilt (pointer-driven rotation) ----
  /** Max rotation around Y when pointer is at horizontal edge (radians).
   *  ~0.2 rad ≈ 11° — pronounced enough to read as a real 3D swing
   *  without flipping the label off-axis. */
  tiltMaxRotY: 0.22,
  /** Max rotation around X when pointer is at vertical edge (radians). */
  tiltMaxRotX: 0.14,
  /** Per-frame lerp toward the target rotation — matches the scene's
   *  tiltLerp character so button + camera parallax move together. */
  tiltLerp: 0.12,

  // ---- Back-arrow extra Y offset while inside a project ----
  /** When the user is in "expanded" mode (one of the 5 cards opened
   *  into the big merged box), the back-arrow slides down by this many
   *  world units so it sits clear of the expanded card's lower edge
   *  instead of poking into it. Lerp happens automatically via the
   *  existing morph spring — the arrow just eases down into place. */
  expandedArrowDrop: -0.18,

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
  const [mode, setMode] = useState<ShowcaseMode>(() => getMode());
  const palette = useSculpturePalette();

  useEffect(() => onShowcaseChange(setShowcase), []);
  useEffect(() => onModeChange((m) => setMode(m)), []);

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
  // Smoothed hover factor (0 = resting, 1 = fully separated). Drives
  // the per-shard outward displacement applied on top of the text
  // layout. Lerped toward hover ? 1 : 0 each frame.
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

  // Precomputed per-shard random outward direction. Used for the hover
  // separation effect — scale by hoverAmp.current * hoverSeparationAmp
  // and add to the live position each frame. Magnitudes vary per shard
  // (0.5..1) so the effect reads as organic, not uniform scaling.
  const separationDirs = useMemo<Float32Array | null>(() => {
    if (!placements) return null;
    const arr = new Float32Array(placements.length * 3);
    const rand = mulberry32(0xc0ffee13);
    for (let i = 0; i < placements.length; i++) {
      // Uniform point on the sphere via inverse CDF, then scale down so
      // separation prefers in-plane motion (Z spread is narrower than
      // XY — the button is ~flat so big Z jumps break the silhouette).
      const u = rand() * 2 - 1;
      const theta = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const mag = 0.5 + rand() * 0.5;
      arr[i * 3] = r * Math.cos(theta) * mag;
      arr[i * 3 + 1] = u * mag;
      arr[i * 3 + 2] = r * Math.sin(theta) * mag * 0.35;
    }
    return arr;
  }, [placements]);

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

    const showingArrow = showcase && arrowPlacements;
    const targets = showingArrow ? arrowPlacements! : placements;
    const lerp = BUTTON.morphLerp;
    const sepMag = hoverAmp.current * BUTTON.hoverSeparationAmp;
    const sepDirs = separationDirs;
    // Drop the arrow slightly while inside a project (expanded mode).
    // Only applies when the arrow layout is active; the text layout is
    // never shown in expanded mode.
    const arrowYOffset =
      showingArrow && mode === "expanded" ? BUTTON.expandedArrowDrop : 0;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < placements.length; i++) {
      const t = targets[i];
      const i3 = i * 3;
      const ty = t.y + arrowYOffset;
      cur[i3]     += (t.x - cur[i3])     * lerp;
      cur[i3 + 1] += (ty  - cur[i3 + 1]) * lerp;
      cur[i3 + 2] += (t.z - cur[i3 + 2]) * lerp;

      // Hover separation lives ON TOP of the live position — added
      // each frame, never accumulated into `cur`. That way toggling
      // hover off snaps back cleanly without drift in the base layout.
      let x = cur[i3];
      let y = cur[i3 + 1];
      let z = cur[i3 + 2];
      if (sepMag > 0.0005 && sepDirs) {
        x += sepDirs[i3] * sepMag;
        y += sepDirs[i3 + 1] * sepMag;
        z += sepDirs[i3 + 2] * sepMag;
      }

      const i4 = i * 4;
      q.set(quats[i4], quats[i4 + 1], quats[i4 + 2], quats[i4 + 3]);
      pos.set(x, y, z);
      m.compose(pos, q, scale);
      shardMesh.setMatrixAt(i, m);
    }

    shardMesh.instanceMatrix.needsUpdate = true;
  });

  // Lerp emissive intensity + hover separation amplitude + apply a
  // group-level 3D tilt driven by the pointer. The tilt rotation
  // amplifies the camera-parallax response on the button itself so the
  // piece visibly reacts to mouse movement (the shards are placed
  // anamorphically toward the sweet-spot, which makes pure camera
  // parallax look subtle on them — adding rotation gives it real 3D).
  useFrame((state) => {
    const emTarget = hover ? BUTTON.hoverMaxEmissive : 0;
    material.emissiveIntensity +=
      (emTarget - material.emissiveIntensity) * BUTTON.hoverLerp;

    const ampTarget = hover ? 1 : 0;
    hoverAmp.current +=
      (ampTarget - hoverAmp.current) * BUTTON.hoverSeparationLerp;

    const group = groupRef.current;
    if (group) {
      // Pointer is normalized to [-1, 1]. Tilt around Y from horizontal
      // movement, around X from vertical (inverted so "mouse up" tips
      // the top toward the camera — matches natural expectation).
      const targetRotY = state.pointer.x * BUTTON.tiltMaxRotY;
      const targetRotX = -state.pointer.y * BUTTON.tiltMaxRotX;
      group.rotation.y += (targetRotY - group.rotation.y) * BUTTON.tiltLerp;
      group.rotation.x += (targetRotX - group.rotation.x) * BUTTON.tiltLerp;
    }
  });

  if (!placements) return null;

  // Hitbox dimensions in world units: use label half-width + padding.
  const halfW = TUNING.buttonHalfWidth + BUTTON.hitPaddingX;
  const halfH = TUNING.buttonHalfHeight + BUTTON.hitPaddingY;

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
    setCursorHover(true);
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(false);
    setCursorHover(false);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    unlockAudio();
    preloadSample(CYMBAL_URL);
    handleCymbalToggle();
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
