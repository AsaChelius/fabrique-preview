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
import { Shards } from "./shards";
import { ShardPhysicsDriver } from "./physics-driver";
import { createPhysicsState, type ShardPhysicsState } from "./physics";
import { useSculpturePalette } from "./palette";
import { onShowcaseChange, isShowcaseActive } from "./showcase-bus";
import { computeShowcaseHomes, SHOWCASE_LAYOUT } from "./showcase-targets";

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

  // Letter shards morph into the 5 card outlines via the existing
  // pendulum springs — no scatter burst. Frame shards redistribute
  // uniformly across the plaque rectangle so the FABRIQUE letter
  // knockouts get filled in and the backdrop reads as a plain box
  // instead of still spelling "FABRIQUE" in negative space.
  const originalLetterHomes = useRef<Float32Array | null>(null);
  const originalFrameHomes = useRef<Float32Array | null>(null);
  const frameBbox = useRef<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  } | null>(null);

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
      // Compute the axis-aligned bbox of the plaque once so we can
      // redistribute frame shards uniformly inside it during showcase.
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      const h = originalFrameHomes.current;
      for (let i = 0; i < frameCount; i++) {
        const x = h[i * 3];
        const y = h[i * 3 + 1];
        const z = h[i * 3 + 2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      frameBbox.current = { minX, maxX, minY, maxY, minZ, maxZ };
    }

    const applyShowcase = (active: boolean) => {
      const home = state.home;
      const offset = state.offset;

      // Snapshot the old homes so we can compensate offsets below. If we
      // just overwrite home without touching offset, each shard's world
      // position (= home + offset) jumps by exactly (new_home - old_home),
      // which reads as an instant teleport. Adding the delta to offset
      // keeps every shard visually in place at the moment of the swap,
      // and the existing pendulum springs then lerp offset back toward 0
      // — giving the smooth animated morph the user asked for.
      const oldHome = home.slice();

      if (active) {
        home.set(computeShowcaseHomes(letterCount), letterStart3);
        // Frame shards form a single backdrop rectangle covering the
        // original plaque bbox, but skipping the interiors of the 5 card
        // outlines so the black boxes stay visually empty (reserved for
        // future colorful shapes).
        const bb = frameBbox.current;
        if (bb) {
          const { cardW, cardH, xCenters, centerY } = SHOWCASE_LAYOUT;
          const halfW = cardW / 2;
          const halfH = cardH / 2;
          const insideMargin = 0.12;
          for (let i = 0; i < frameCount; i++) {
            let x = 0;
            let y = 0;
            for (let attempt = 0; attempt < 20; attempt++) {
              x = bb.minX + Math.random() * (bb.maxX - bb.minX);
              y = bb.minY + Math.random() * (bb.maxY - bb.minY);
              let insideCard = false;
              for (let c = 0; c < xCenters.length; c++) {
                const cx = xCenters[c];
                if (
                  Math.abs(x - cx) < halfW - insideMargin &&
                  Math.abs(y - centerY) < halfH - insideMargin
                ) {
                  insideCard = true;
                  break;
                }
              }
              if (!insideCard) break;
            }
            const i3 = i * 3;
            home[i3]     = x;
            home[i3 + 1] = y;
            home[i3 + 2] = bb.minZ + Math.random() * (bb.maxZ - bb.minZ);
          }
        }
      } else {
        if (originalLetterHomes.current) {
          home.set(originalLetterHomes.current, letterStart3);
        }
        if (originalFrameHomes.current) {
          home.set(originalFrameHomes.current, frameStart3);
        }
      }

      // Compensate offsets so world positions are preserved at the swap.
      for (let i = 0; i < home.length; i++) {
        offset[i] += oldHome[i] - home[i];
      }
    };

    applyShowcase(isShowcaseActive());
    return onShowcaseChange(applyShowcase);
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
      />
      <Shards
        placements={clouds.letter}
        color={palette.letterShard}
        state={clouds.physics}
        stateStart={letterStart}
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
