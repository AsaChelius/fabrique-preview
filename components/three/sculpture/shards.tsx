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
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TUNING } from "./tuning";
import type { Placement } from "./placements";
import type { ShardPhysicsState } from "./physics";

export type ShardsProps = {
  placements: Placement[];
  color: string;
  /** Shared physics state (covers ALL shards globally). */
  state: ShardPhysicsState;
  /** Index in `state` where this mesh's slice starts. */
  stateStart: number;
};

export function Shards({ placements, color, state, stateStart }: ShardsProps) {
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
      }),
    [color],
  );

  // Precompute per-shard base quaternion (rotation never changes). Stored
  // flat as xyzw quads so we can read without allocating.
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

  // Set initial matrices once so the first frame renders something even
  // before the first useFrame tick.
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

  // Per-frame: home + physics offset + deterministic idle sway.
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const N = placements.length;
    const s = state;
    const yFactor = TUNING.swayVerticalFactor;

    for (let i = 0; i < N; i++) {
      const gi = stateStart + i; // global index into physics state
      const h3 = gi * 3;
      const phase = s.swayPhase[gi];
      const amp = s.swayAmp[gi];
      const freq = s.swayFreq[gi];
      const sway = Math.sin(t * freq + phase) * amp;
      // Small bob out of phase with sway for a less robotic motion.
      const bob = Math.cos(t * freq * 0.73 + phase) * amp * yFactor;

      pos.set(
        s.home[h3] + s.offset[h3] + sway,
        s.home[h3 + 1] + s.offset[h3 + 1] + bob,
        s.home[h3 + 2] + s.offset[h3 + 2],
      );
      quat.set(
        baseQuats[i * 4],
        baseQuats[i * 4 + 1],
        baseQuats[i * 4 + 2],
        baseQuats[i * 4 + 3],
      );
      m.compose(pos, quat, scale);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, placements.length]}
    />
  );
}
