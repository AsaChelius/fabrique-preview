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
import { computePlacements, type Placement } from "./placements";
import { Shards, type ShowcaseRef } from "./shards";
import { ShardPhysicsDriver } from "./physics-driver";
import { createPhysicsState, type ShardPhysicsState } from "./physics";
import { useSculpturePalette } from "./palette";
import {
  onModeChange,
  onHoveredChange,
  getMode,
  getExpandedCard,
  getHoveredCard,
  type ShowcaseMode,
} from "./showcase-bus";
import {
  computeShowcaseLetterHomes,
  computeShowcaseFrameHomes,
  computeExpandedLetterHomes,
  computeExpandedFrameHomes,
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

export function SuspendedCloud() {
  const layers = useLayers();
  const palette = useSculpturePalette();

  const clouds = useMemo<Clouds | null>(() => {
    if (!layers) return null;
    const letter = computePlacements(layers.letter, 0x5ca1ab1e);
    const frame = computePlacements(layers.frame, 0x7a1e9ace);
    // Frame first so the letter slice sits on top in the shared state —
    // helps the occasional debugging query ("first NF indices = frame").
    const all = frame.concat(letter);
    const physics = createPhysicsState(all);
    return { letter, frame, all, physics };
  }, [layers]);

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
    hoveredCard: null,
    dominantCard: null,
  });
  const frameShowcase = useRef<ShowcaseRef>({
    active: false,
    cardIndex: null,
    edgeFlow: null,
    hoveredCard: null,
    dominantCard: null,
  });

  useEffect(() => {
    if (!clouds) return;
    const state = clouds.physics;
    const frameCount = clouds.frame.length;
    const letterCount = clouds.letter.length;
    const frameStart3 = 0;
    const letterStart3 = frameCount * 3;
    const frameSize3 = frameCount * 3;
    const letterSize3 = letterCount * 3;

    if (originalLetterHomes.current == null) {
      originalLetterHomes.current = state.home.slice(
        letterStart3,
        letterStart3 + letterSize3,
      );
    }
    if (originalFrameHomes.current == null) {
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
          hoveredCard: prevHoveredL,
          dominantCard: null,
        };

        const frameResult = computeShowcaseFrameHomes(frameCount);
        home.set(frameResult.positions, frameStart3);
        frameShowcase.current = {
          active: true,
          cardIndex: frameResult.cardIndex,
          edgeFlow: frameResult.edgeFlow,
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
          hoveredCard: null,
          dominantCard: expandedCard,
        };

        const frameResult = computeExpandedFrameHomes(frameCount);
        home.set(frameResult.positions, frameStart3);
        frameShowcase.current = {
          active: true,
          cardIndex: frameResult.cardIndex,
          edgeFlow: frameResult.edgeFlow,
          hoveredCard: null,
          dominantCard: expandedCard,
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
          hoveredCard: null,
          dominantCard: null,
        };
        frameShowcase.current = {
          active: false,
          cardIndex: null,
          edgeFlow: null,
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
    return () => {
      unsubMode();
      unsubHover();
    };
  }, [clouds]);

  if (!clouds) return null;

  const frameStart = 0;
  const letterStart = clouds.frame.length;

  return (
    <>
      <ShardPhysicsDriver state={clouds.physics} />
      <Shards
        placements={clouds.frame}
        color={palette.frameShard}
        state={clouds.physics}
        stateStart={frameStart}
        showcaseRef={frameShowcase}
        showcaseMotion="wind"
      />
      <Shards
        placements={clouds.letter}
        color={palette.letterShard}
        state={clouds.physics}
        stateStart={letterStart}
        showcaseRef={letterShowcase}
        showcaseMotion="snake"
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
