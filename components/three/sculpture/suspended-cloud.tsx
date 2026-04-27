"use client";

/**
 * <SuspendedCloud /> — owns one-time sampling, placement computation,
 * and the shared ShardPhysicsState. Renders:
 *   - <ShardPhysicsDriver /> — integrates offsets/velocities per frame
 *   - <Wires />               — reads state, follows moving shards
 *   - <Shards />              — two meshes (frame + letter) read their
 *                               slice of the state + apply idle sway
 *
 * Mount order matters: the physics driver must run its useFrame BEFORE
 * the meshes read state. R3F runs hooks in mount order, so the driver
 * is the first child.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sampleSignSilhouette, type SampledLayers } from "./sampling";
import { isFullyInsideGreenFrustum, type Placement } from "./placements";
import {
  CAPTURED_LETTER_B64,
  CAPTURED_LETTER_COUNT,
  CAPTURED_FRAME_B64,
  CAPTURED_FRAME_COUNT,
} from "./captured-github-positions";

/** Decode a base64-packed Float32 stream of [x, y, z, yaw, tilt] into a
 *  Placement[]. Used to swap the runtime-computed sign positions for the
 *  exact positions captured from the clean github (origin/asa-branch)
 *  build, so the pre-pull functionality layer renders the github
 *  structure verbatim. */
function decodeCapturedPlacements(b64: string, count: number): Placement[] {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const f32 = new Float32Array(bytes.buffer);
  const out: Placement[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * 5;
    out[i] = {
      x: f32[o],
      y: f32[o + 1],
      z: f32[o + 2],
      yaw: f32[o + 3],
      tilt: f32[o + 4],
    };
  }
  return out;
}

const GITHUB_LETTER_PLACEMENTS = decodeCapturedPlacements(
  CAPTURED_LETTER_B64,
  CAPTURED_LETTER_COUNT,
);
const GITHUB_FRAME_PLACEMENTS = decodeCapturedPlacements(
  CAPTURED_FRAME_B64,
  CAPTURED_FRAME_COUNT,
);
import { Shards, type ShowcaseRef } from "./shards";
import { ShardPhysicsDriver } from "./physics-driver";
import { createPhysicsState, type ShardPhysicsState } from "./physics";
import { useSculpturePalette } from "./palette";
import {
  onModeChange,
  onHoveredChange,
  onCardImpulse,
  getMode,
  getExpandedCard,
  getHoveredCard,
  type ShowcaseMode,
} from "./showcase-bus";
import { TUNING } from "./tuning";
import {
  computeShowcaseLetterHomes,
  computeShowcaseFrameHomes,
  computeExpandedLetterHomes,
  computeExpandedFrameHomes,
  computeAboutLetterHomes,
  computeAboutFrameHomes,
} from "./showcase-targets";

type Clouds = {
  letter: Placement[];
  frame: Placement[];
  /** Global ordering: frame first, then letter. The physics state is
   *  built from this concatenation. Shards that render `frame` use
   *  stateStart=0, letter uses stateStart=frame.length. */
  all: Placement[];
  physics: ShardPhysicsState;
};

/**
 * Module-level singleton holding the most recently created Clouds.
 * The upright (interactive=true) SuspendedCloud creates this on first
 * render. The mirror copy (interactive=false) reads the same instance
 * so it shares state.physics.offset with the upright — when the
 * driver mutates offsets in response to cursor pushes / wind impulses,
 * the mirror's Shards see the same updated positions and the
 * reflection actually tracks the sign instead of having its own
 * independent simulation.
 */
let _sharedClouds: Clouds | null = null;

/** External access for the FallScheduler — it needs to know how many
 *  shards exist (state.home.length / 3) and read their home positions
 *  to pick a random one to drop into the water. */
export function getSharedClouds(): Clouds | null {
  return _sharedClouds;
}

// TEMP: window exposure for the INSPECT debug overlay verification.
if (typeof window !== "undefined") {
  (window as unknown as { __getSharedClouds: typeof getSharedClouds }).__getSharedClouds = getSharedClouds;
}

export function SuspendedCloud({ interactive = true }: { interactive?: boolean } = {}) {
  const layers = useLayers();
  const palette = useSculpturePalette();

  const clouds = useMemo<Clouds | null>(() => {
    if (!layers) return null;
    // Mirror reads the upright's clouds so they share the same
    // physics state. If the singleton isn't populated yet (first
    // render race), fall back to creating a new one — but in
    // practice the upright always renders first since it sits
    // earlier in the JSX tree.
    if (!interactive && _sharedClouds) return _sharedClouds;
    // Use the captured GITHUB sign positions (decoded once at module
    // load) instead of recomputing fresh from the local sampling. Keeps
    // the structure of every metal piece identical to the clean
    // origin/asa-branch build.
    void layers;
    // Black FABRIQUE letter shards are kept verbatim (not filtered) so
    // the wordmark always stays whole.
    const letter = GITHUB_LETTER_PLACEMENTS;
    // Grey plaque (frame) shards: cull only those whose ENTIRE body is
    // fully inside the green rectangular frustum. Shards straddling the
    // wireframe (partial overlap) are left in place. Mirror twins also
    // checked so the in-box reflection doesn't show plaque clutter.
    const FLOOR_Y = TUNING.floorY;
    const filteredFrame = GITHUB_FRAME_PLACEMENTS.filter((p) => {
      if (isFullyInsideGreenFrustum(p.x, p.y, p.z)) return false;
      const mirrorY = -p.y + 2 * FLOOR_Y;
      if (isFullyInsideGreenFrustum(p.x, mirrorY, p.z)) return false;
      return true;
    });

    // ---- Small bottom-right gap fill -------------------------------
    // The box's bottom-right corner is just outside (+1.26, -1.685, 0).
    // The captured github sampling left a sparse patch in the screen
    // region just to the right of and below that corner — fill it with
    // a handful of grey shards. Sample positions are chosen on the z=0
    // screen plane *outside* the box (x ∈ [+1.30, +1.55], y ∈
    // [-1.85, -1.72]) so even after anamorphic depth they project
    // outside the wireframe — never intrude into the white space.
    const fillRand = mulberry32(0xa5b1f110);
    const camZ = TUNING.cameraZ;
    const fillCount = 28;
    const fill: Placement[] = [];
    for (let i = 0; i < fillCount; i++) {
      const x0 = 1.30 + fillRand() * 0.25; // outside right edge of box
      const y0 = -1.85 + fillRand() * 0.13; // outside bottom edge of box
      const u = fillRand() * 2 - 1;
      const biased = Math.sign(u) * Math.pow(Math.abs(u), TUNING.depthBias);
      const dz = biased * TUNING.cloudDepth;
      const ratio = (camZ - dz) / camZ;
      const yaw = (fillRand() * 2 - 1) * TUNING.yawJitter;
      const tilt = (fillRand() * 2 - 1) * TUNING.tiltJitter;
      fill.push({ x: x0 * ratio, y: y0 * ratio, z: dz, yaw, tilt });
    }
    const frame = filteredFrame.concat(fill);
    const all = frame.concat(letter);
    const physics = createPhysicsState(all);
    const created = { letter, frame, all, physics };
    if (interactive) _sharedClouds = created;
    return created;
  }, [layers, interactive]);

  // Showcase: BOTH shard groups collapse into the 5 cards. Letter shards
  // land on the card wireframe edges (real 3D depth — same forward/back
  // range as FABRIQUE). Frame shards fill the card interior volumes —
  // no grey left between cards. Each shard receives a `cardIndex` so
  // the Shards component's per-frame chameleon color flow can tint it.
  const originalLetterHomes = useRef<Float32Array | null>(null);
  const originalFrameHomes = useRef<Float32Array | null>(null);

  // ShowcaseRef = live pointer into current mode + card assignment +
  // edge-flow data + hover/dominant-card signals. Shards reads this
  // ref per-frame to decide chameleon color, snake-wave flow, hover
  // glow, and expanded-mode single-hue override. Stable across renders.
  const letterShowcase = useRef<ShowcaseRef>({
    active: false,
    cardIndex: null,
    edgeFlow: null,
    orientToEdge: false,
    motionStrength: 0,
    hoveredCard: null,
    dominantCard: null,
  });
  const frameShowcase = useRef<ShowcaseRef>({
    active: false,
    cardIndex: null,
    edgeFlow: null,
    orientToEdge: false,
    motionStrength: 0,
    hoveredCard: null,
    dominantCard: null,
  });

  useEffect(() => {
    if (!clouds) return;
    // Mirror copy shares state with the upright — only the upright
    // owns the showcase logic that mutates state.home / state.offset.
    // Letting both run would double-apply every mode change.
    if (!interactive) return;
    const state = clouds.physics;
    const frameCount = clouds.frame.length;
    const letterCount = clouds.letter.length;
    const frameStart3 = 0;
    const letterStart3 = frameCount * 3;
    const frameSize3 = frameCount * 3;
    const letterSize3 = letterCount * 3;

    // Re-capture originals if missing OR if their size doesn't match the
    // current physics state (HMR + density-boost changes can resize the
    // shard counts; a stale ref from a previous build would crash
    // `home.set()` later with a RangeError).
    if (
      originalLetterHomes.current == null ||
      originalLetterHomes.current.length !== letterSize3
    ) {
      originalLetterHomes.current = state.home.slice(
        letterStart3,
        letterStart3 + letterSize3,
      );
    }
    if (
      originalFrameHomes.current == null ||
      originalFrameHomes.current.length !== frameSize3
    ) {
      originalFrameHomes.current = state.home.slice(
        frameStart3,
        frameStart3 + frameSize3,
      );
    }

    const applyMode = (mode: ShowcaseMode, expandedCard: number | null) => {
      const home = state.home;
      const offset = state.offset;
      // Snapshot old home so we can compensate offsets — otherwise every
      // shard teleports by (new - old) at the swap. The pendulum springs
      // then lerp offset back to 0 and the morph animates.
      const oldHome = home.slice();

      // Preserve hover state across mode changes — only the mode-related
      // fields get overwritten here.
      const prevHoveredL = letterShowcase.current.hoveredCard;
      const prevHoveredF = frameShowcase.current.hoveredCard;

      if (mode === "showcase") {
        const letterResult = computeShowcaseLetterHomes(letterCount);
        home.set(letterResult.positions, letterStart3);
        letterShowcase.current = {
          active: true,
          cardIndex: letterResult.cardIndex,
          edgeFlow: letterResult.edgeFlow,
          orientToEdge: false,
          motionStrength: 0,
          hoveredCard: prevHoveredL,
          dominantCard: null,
        };

        const frameResult = computeShowcaseFrameHomes(frameCount);
        home.set(frameResult.positions, frameStart3);
        frameShowcase.current = {
          active: true,
          cardIndex: frameResult.cardIndex,
          edgeFlow: frameResult.edgeFlow,
          orientToEdge: false,
          motionStrength: 0,
          hoveredCard: prevHoveredF,
          dominantCard: null,
        };
      } else if (mode === "expanded") {
        const letterResult = computeExpandedLetterHomes(letterCount);
        home.set(letterResult.positions, letterStart3);
        letterShowcase.current = {
          active: true,
          cardIndex: letterResult.cardIndex,
          edgeFlow: letterResult.edgeFlow,
          orientToEdge: false,
          motionStrength: 0,
          hoveredCard: null,
          dominantCard: expandedCard,
        };

        const frameResult = computeExpandedFrameHomes(frameCount);
        home.set(frameResult.positions, frameStart3);
        frameShowcase.current = {
          active: true,
          cardIndex: frameResult.cardIndex,
          edgeFlow: frameResult.edgeFlow,
          orientToEdge: false,
          motionStrength: 0,
          hoveredCard: null,
          dominantCard: expandedCard,
        };
      } else if (mode === "about") {
        const letterResult = computeAboutLetterHomes(letterCount);
        home.set(letterResult.positions, letterStart3);
        letterShowcase.current = {
          active: false,
          cardIndex: letterResult.cardIndex,
          edgeFlow: letterResult.edgeFlow,
          orientToEdge: false,
          motionStrength: 0.88,
          hoveredCard: null,
          dominantCard: null,
        };

        const frameResult = computeAboutFrameHomes(frameCount);
        home.set(frameResult.positions, frameStart3);
        frameShowcase.current = {
          active: false,
          cardIndex: frameResult.cardIndex,
          edgeFlow: frameResult.edgeFlow,
          orientToEdge: false,
          motionStrength: 0.78,
          hoveredCard: null,
          dominantCard: null,
        };
      } else {
        if (originalLetterHomes.current) {
          home.set(originalLetterHomes.current, letterStart3);
        }
        if (originalFrameHomes.current) {
          home.set(originalFrameHomes.current, frameStart3);
        }
        letterShowcase.current = {
          active: false,
          cardIndex: null,
          edgeFlow: null,
          orientToEdge: false,
          motionStrength: 0,
          hoveredCard: null,
          dominantCard: null,
        };
        frameShowcase.current = {
          active: false,
          cardIndex: null,
          edgeFlow: null,
          orientToEdge: false,
          motionStrength: 0,
          hoveredCard: null,
          dominantCard: null,
        };
      }

      // Compensate offsets so world positions are preserved at the swap.
      for (let i = 0; i < home.length; i++) {
        offset[i] += oldHome[i] - home[i];
      }
    };

    applyMode(getMode(), getExpandedCard());
    // Hover doesn't change shard homes — it only repaints color via the
    // ShowcaseRef field the Shards useFrame reads every tick. So the
    // hover listener simply mutates the ref in place.
    letterShowcase.current.hoveredCard = getHoveredCard();
    frameShowcase.current.hoveredCard = getHoveredCard();

    const unsubMode = onModeChange(applyMode);
    const unsubHover = onHoveredChange((h) => {
      letterShowcase.current.hoveredCard = h;
      frameShowcase.current.hoveredCard = h;
    });
    const applyImpulseToSlice = (
      cardIdx: number,
      dx: number,
      dy: number,
      speed: number,
      cardIndex: Int8Array | null,
      start: number,
      count: number,
    ) => {
      if (!cardIndex) return;
      const strength =
        TUNING.cardImpulseStrength * Math.min(1.8, 0.65 + speed * 34);
      const max = TUNING.cardImpulseMax;
      const ix = Math.max(-max, Math.min(max, dx * strength));
      const iy = Math.max(-max, Math.min(max, dy * strength * 0.75));
      const izBase = Math.max(
        -max,
        Math.min(max, dx * strength * TUNING.cardImpulseZ),
      );
      for (let i = 0; i < count; i++) {
        if (cardIndex[i] !== cardIdx) continue;
        const globalIdx = start + i;
        const i3 = globalIdx * 3;
        const n = Math.sin((globalIdx + 1) * 12.9898) * 43758.5453;
        const jitter = 0.72 + (n - Math.floor(n)) * 0.56;
        const zSign = globalIdx % 2 === 0 ? 1 : -1;
        state.velocity[i3] += ix * jitter;
        state.velocity[i3 + 1] += iy * jitter;
        state.velocity[i3 + 2] += izBase * zSign * jitter;
        state.offset[i3] += ix * 0.018 * jitter;
        state.offset[i3 + 1] += iy * 0.014 * jitter;
        state.offset[i3 + 2] += izBase * 0.012 * zSign * jitter;
      }
    };
    const unsubImpulse = onCardImpulse(({ cardIdx, dx, dy, speed }) => {
      applyImpulseToSlice(
        cardIdx,
        dx,
        dy,
        speed,
        frameShowcase.current.cardIndex,
        frameStart,
        frameCount,
      );
      applyImpulseToSlice(
        cardIdx,
        dx,
        dy,
        speed,
        letterShowcase.current.cardIndex,
        letterStart,
        letterCount,
      );
    });
    return () => {
      unsubMode();
      unsubHover();
      unsubImpulse();
    };
  }, [clouds, interactive]);

  useEffect(() => {
    // Only run the warm-up once — the upright owns it.
    if (!interactive) return;
    if (!clouds || typeof window === "undefined") return;
    let cancelled = false;
    const warmAboutTargets = () => {
      if (cancelled) return;
      computeAboutLetterHomes(clouds.letter.length);
      computeAboutFrameHomes(clouds.frame.length);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        cb: IdleRequestCallback,
        opts?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(warmAboutTargets, {
        timeout: 1800,
      });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(id);
      };
    }
    const id = window.setTimeout(warmAboutTargets, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [clouds, interactive]);

  if (!clouds) return null;

  const frameStart = 0;
  const letterStart = clouds.frame.length;

  return (
    <>
      {/* Only the interactive (above-water) copy runs the physics
          driver. The mirror copy SHARES the same physics state via
          the module-level singleton, so cursor pushes / wind impulses
          that the driver applies to state.offset are immediately
          visible in the mirror's render — the reflection now actually
          tracks the sign instead of having an independent simulation. */}
      {interactive && <ShardPhysicsDriver state={clouds.physics} />}
      <Shards
        placements={clouds.frame}
        color={palette.frameShard}
        state={clouds.physics}
        stateStart={frameStart}
        showcaseRef={frameShowcase}
        showcaseMotion="wind"
        interactive={interactive}
      />
      <Shards
        placements={clouds.letter}
        color={palette.letterShard}
        state={clouds.physics}
        stateStart={letterStart}
        showcaseRef={letterShowcase}
        showcaseMotion="snake"
        interactive={interactive}
      />
    </>
  );
}

function useLayers(): SampledLayers | null {
  const [layers, setLayers] = useState<SampledLayers | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    const run = () => {
      const s = sampleSignSilhouette();
      if (!cancelled) setLayers(s);
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

  return layers;
}

/** Deterministic small-state PRNG. Used by the bottom-right gap fill so
 *  that fill positions are stable across reloads. */
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
