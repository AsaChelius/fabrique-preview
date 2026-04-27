"use client";

/**
 * <ShardPhysicsDriver /> — runs the physics step once per frame.
 *
 * Owns cursor → world projection (raycasting to the z=0 plane) and
 * integrates offsets/velocities in the shared ShardPhysicsState. Render
 * components (<Shards /> and <Wires />) read the updated state in their
 * own useFrame hooks right after.
 *
 * The `cursorActive` ref tracks whether the cursor is actually on-screen
 * — when the user's mouse leaves the canvas, we stop applying repulsion
 * so shards settle back to home instead of chasing the last known
 * cursor position at the edge.
 *
 * Idle wind: every ~5s (jittered) we trigger a one-shot gust that
 * applies a small global-drag impulse for ~0.5s, then decays through
 * the existing pendulum-spring physics. Several preset directions
 * cycle so the idle motion never feels mechanical. The wind is added
 * on top of any cursor drag, so user input always dominates.
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { stepPhysics, type ShardPhysicsState } from "./physics";

/** Wind preset = a peak global-drag vector. The driver fades each gust
 *  in over WIND_RAMP_S, holds at peak for WIND_HOLD_S, then fades out
 *  over WIND_FADE_S. Values are in the same units `stepPhysics`
 *  consumes for `globalDragX/Y` (cursor delta-per-frame world units).
 *  ~0.04 reads as a noticeable gust without feeling like the cursor
 *  yanked the sculpture. */
const WIND_PRESETS: Array<{ x: number; y: number; durationS: number }> = [
  // Wind only blows horizontally. Each preset's durationS is the time
  // for one full sweep across the sculpture — longer durations mean
  // the gust traverses more slowly, like a long lazy breeze instead
  // of a quick puff.
  { x: 0.32, y: 0.0, durationS: 6.5 }, // strong gust right
  { x: -0.3, y: 0.0, durationS: 6.8 }, // strong gust left
  { x: 0.22, y: 0.0, durationS: 6.0 }, // softer right
  { x: -0.2, y: 0.0, durationS: 6.0 }, // softer left
  { x: 0.18, y: 0.0, durationS: 7.0 }, // gentle right
  { x: -0.16, y: 0.0, durationS: 7.0 }, // gentle left
];

const WIND_RAMP_S = 0.7;
const WIND_FADE_S = 2.4;
/** Mean delay between gusts (seconds). Bumped so wind events feel
 *  rare — long stretches of calm between each sweep. */
const WIND_INTERVAL_BASE_S = 14.0;
const WIND_INTERVAL_JITTER_S = 6.0;

export function ShardPhysicsDriver({
  state,
}: {
  state: ShardPhysicsState;
}) {
  const { camera, gl, pointer } = useThree();

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  // Plane normal is +Z, constant 0 — the z=0 plane, matching the center
  // of our anamorphic sculpture.
  const zPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    [],
  );
  const cursorWorld = useRef(new THREE.Vector3());
  const cursorActiveRef = useRef(false);

  // Idle wind state. `peak` = current preset's amplitude. `t` = seconds
  // since the gust started. `total` = total gust duration. `nextAt` =
  // wall-clock seconds to start the next gust.
  const wind = useRef({
    peakX: 0,
    peakY: 0,
    t: 0,
    total: 0,
    /** elapsed seconds since the route mounted (drives nextAt). */
    clock: 0,
    nextAt: WIND_INTERVAL_BASE_S, // first gust ~5s after mount
  });

  // Track whether the cursor is over the canvas. Canvas covers the
  // viewport on this route, so pointer leaving the window is enough.
  useEffect(() => {
    const canvas = gl.domElement;
    const onEnter = () => {
      cursorActiveRef.current = true;
    };
    const onLeave = () => {
      cursorActiveRef.current = false;
    };
    canvas.addEventListener("pointerenter", onEnter);
    canvas.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [gl]);

  useFrame((_, dt) => {
    // INSPECT debug mode — freeze all physics, zero out any accumulated
    // offset/velocity once on entry so shards snap back to home pose.
    const inspectActive = (window as unknown as { __inspect?: boolean }).__inspect === true;
    if (inspectActive) {
      const off = state.offset;
      const vel = state.velocity;
      for (let i = 0; i < off.length; i++) { off[i] = 0; vel[i] = 0; }
      return;
    }

    // ---- Idle wind: schedule + envelope --------------------------------
    const w = wind.current;
    w.clock += dt;
    if (w.t === 0 && w.clock >= w.nextAt) {
      // Pick a random preset (avoid repeating the previous one when
      // possible — if peakX/Y of the picked preset matches the last,
      // bump to the next preset).
      const idx = Math.floor(Math.random() * WIND_PRESETS.length);
      const preset = WIND_PRESETS[idx];
      w.peakX = preset.x;
      w.peakY = preset.y;
      w.total = preset.durationS;
      w.t = 1e-4; // tiny non-zero to mark "active"
      w.nextAt =
        w.clock +
        preset.durationS +
        WIND_INTERVAL_BASE_S +
        (Math.random() * 2 - 1) * WIND_INTERVAL_JITTER_S;
    }

    let windX = 0;
    let windY = 0;
    let waveCenter: number | null = null;
    let waveDirX = 1;
    let waveDirY = 0;
    if (w.t > 0) {
      w.t += dt;
      const T = w.t;
      const total = w.total;
      let envelope = 0;
      if (T < WIND_RAMP_S) {
        envelope = T / WIND_RAMP_S; // ramp-in
      } else if (T < total - WIND_FADE_S) {
        envelope = 1; // hold
      } else if (T < total) {
        envelope = (total - T) / WIND_FADE_S; // fade-out
      } else {
        envelope = 0;
        w.t = 0; // gust ended
      }
      windX = w.peakX * envelope;
      windY = w.peakY * envelope;
      // Build the traveling-wave parameters: the gust enters from the
      // upwind edge of the sculpture and sweeps to the downwind edge
      // over the course of the gust's duration. Wave-projection axis
      // is the unit-vector wind direction.
      const wmag = Math.hypot(w.peakX, w.peakY) || 1;
      waveDirX = w.peakX / wmag;
      waveDirY = w.peakY / wmag;
      // Travel from -SPAN to +SPAN over the full duration. SPAN is the
      // sculpture half-extent along the wave axis. Plaque is roughly
      // ±5.4 horizontally so 6 covers it with a tail past the edge.
      const SPAN = 6.5;
      const progress = w.t / total; // 0..1 over gust
      waveCenter = -SPAN + progress * (2 * SPAN);
    }

    // ---- Cursor position (for radial push) + step ----------------------
    // NOTE: cursor MOTION (dragX/dragY) is intentionally NOT fed into
    // global drag any more. Previously, moving the cursor across the
    // canvas sent a per-frame delta into stepPhysics' globalDragX/Y,
    // which made the whole sculpture lean toward the cursor — felt
    // like the metal was "looking at" the mouse. The cursor's PROXIMITY
    // push (cursorStrength × falloff in the inner loop) is plenty of
    // interaction; the lean was over-the-top. Wind still rides
    // globalDragX/Y so ambient motion is unaffected.
    if (cursorActiveRef.current) {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.ray.intersectPlane(zPlane, cursorWorld.current);
      if (hit) {
        stepPhysics(
          state,
          cursorWorld.current.x,
          cursorWorld.current.y,
          dt,
          true,
          windX,
          windY,
          waveCenter,
          waveDirX,
          waveDirY,
        );
        return;
      }
    }
    // No cursor — wind still applies so the sculpture has gentle
    // ambient motion even when nobody is hovering the canvas.
    stepPhysics(
      state,
      0,
      0,
      dt,
      false,
      windX,
      windY,
      waveCenter,
      waveDirX,
      waveDirY,
    );
  });

  return null;
}
