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

import { useLayoutEffect, useMemo, useState } from "react";
import { sampleSignSilhouette, type SampledLayers } from "./sampling";
import { computePlacements, type Placement } from "./placements";
import { Shards } from "./shards";
import { Wires } from "./wires";
import { ShardPhysicsDriver } from "./physics-driver";
import { createPhysicsState, type ShardPhysicsState } from "./physics";
import { TUNING } from "./tuning";

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

  if (!clouds) return null;

  const frameStart = 0;
  const letterStart = clouds.frame.length;

  return (
    <>
      <ShardPhysicsDriver state={clouds.physics} />
      <Wires placements={clouds.all} state={clouds.physics} />
      <Shards
        placements={clouds.frame}
        color={TUNING.frameShardColor}
        state={clouds.physics}
        stateStart={frameStart}
      />
      <Shards
        placements={clouds.letter}
        color={TUNING.letterShardColor}
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
