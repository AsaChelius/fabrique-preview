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
 */

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { stepPhysics, type ShardPhysicsState } from "./physics";

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
  const prevCursorWorld = useRef(new THREE.Vector3());
  const hasPrevCursorWorld = useRef(false);
  const cursorActiveRef = useRef(false);

  // Track whether the cursor is over the canvas. Canvas covers the
  // viewport on this route, so pointer leaving the window is enough.
  useEffect(() => {
    const canvas = gl.domElement;
    const onEnter = () => {
      cursorActiveRef.current = true;
    };
    const onLeave = () => {
      cursorActiveRef.current = false;
      hasPrevCursorWorld.current = false;
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
    if (cursorActiveRef.current) {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.ray.intersectPlane(zPlane, cursorWorld.current);
      if (hit) {
        let dragX = 0;
        let dragY = 0;
        if (hasPrevCursorWorld.current) {
          dragX = cursorWorld.current.x - prevCursorWorld.current.x;
          dragY = cursorWorld.current.y - prevCursorWorld.current.y;
        } else {
          hasPrevCursorWorld.current = true;
        }
        prevCursorWorld.current.copy(cursorWorld.current);
        stepPhysics(
          state,
          cursorWorld.current.x,
          cursorWorld.current.y,
          dt,
          true,
          dragX,
          dragY,
        );
        return;
      }
    }
    // No cursor — integrate with cursor disabled so shards settle.
    hasPrevCursorWorld.current = false;
    stepPhysics(state, 0, 0, dt, false);
  });

  return null;
}
