"use client";

/**
 * Animated hanging wires — one InstancedMesh of thin unit-height cylinders.
 *
 * Each wire's TOP is fixed at the ceiling directly above the shard's
 * HOME position (wires are physically tethered to the ceiling and never
 * move at the top). Its BOTTOM follows the shard's current position as
 * physics + sway push the shard around.
 *
 * Per instance we compute length, midpoint, and the rotation that aligns
 * the cylinder's default +Y axis with the wire direction, so wires tilt
 * naturally when shards swing.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TUNING } from "./tuning";
import type { Placement } from "./placements";
import type { ShardPhysicsState } from "./physics";

export function Wires({
  placements,
  state,
}: {
  placements: Placement[];
  state: ShardPhysicsState;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    // Unit-height cylinder — scaled Y per-instance to the wire length.
    // 5 radial segments at ~0.001 world radius is plenty.
    return new THREE.CylinderGeometry(
      TUNING.wireRadius,
      TUNING.wireRadius,
      1,
      5,
      1,
      false,
    );
  }, []);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(TUNING.wireColor),
        metalness: 0.1,
        roughness: 0.8,
        transparent: true,
        opacity: TUNING.wireOpacity,
        depthWrite: true,
      }),
    [],
  );

  // Initial matrices (matches static vertical wires from shardTop → ceiling).
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const ceilingY = TUNING.ceilingY;
    const shardTopOffset = TUNING.shardHeight / 2;

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      const topY = p.y + shardTopOffset;
      const length = ceilingY - topY;
      pos.set(p.x, (ceilingY + topY) / 2, p.z);
      scale.set(1, length, 1);
      m.compose(pos, quat, scale);
      mesh.setMatrixAt(i, m);
    }
    mesh.count = placements.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
  }, [placements]);

  // Per-frame: each wire goes from ceiling-above-home to shard-top-current.
  // Because shards are paired with state by their global index, we need
  // the SAME stateStart logic — but for wires we render ALL shards in one
  // mesh matching `state` 1:1, so stateStart is always 0.
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const m = new THREE.Matrix4();
    const anchor = new THREE.Vector3();
    const bottom = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    const ceilingY = TUNING.ceilingY;
    const shardTopOffset = TUNING.shardHeight / 2;
    const N = state.count;
    const s = state;

    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      // Anchor = directly above the shard's HOME (not its current offset).
      anchor.set(s.home[i3], ceilingY, s.home[i3 + 2]);
      // Bottom = shard's current top (home + offset, raised by half-height).
      bottom.set(
        s.home[i3] + s.offset[i3],
        s.home[i3 + 1] + s.offset[i3 + 1] + shardTopOffset,
        s.home[i3 + 2] + s.offset[i3 + 2],
      );

      dir.subVectors(bottom, anchor);
      const len = dir.length();
      if (len < 1e-5) continue;
      mid.addVectors(anchor, bottom).multiplyScalar(0.5);
      dir.multiplyScalar(1 / len);
      // Cylinder is Y-aligned by default. We want +Y to align with `dir`
      // from top-down, but our cylinder extends in +/-Y, so align +Y with
      // (anchor - bottom) = -dir. Equivalent to rotating up (0,1,0) onto -dir.
      const neg = dir.clone().multiplyScalar(-1);
      quat.setFromUnitVectors(up, neg);
      scale.set(1, len, 1);
      m.compose(mid, quat, scale);
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
