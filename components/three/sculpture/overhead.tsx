"use client";

/**
 * Overhead gallery atmosphere: ceiling beam, soft light cones, drifting dust.
 *
 * Fills the whitespace above the FABRIQUE sculpture so the scene reads as a
 * lit room rather than an empty canvas. All three elements are deliberately
 * subtle — they set mood without competing with the wordmark.
 */

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useSculpturePalette } from "./palette";
import { TUNING } from "./tuning";

export function CeilingBeam() {
  const palette = useSculpturePalette();
  return (
    <mesh position={[0, TUNING.ceilingBeamY, 0]}>
      <boxGeometry
        args={[
          TUNING.ceilingBeamWidth,
          TUNING.ceilingBeamThickness,
          TUNING.ceilingBeamDepth,
        ]}
      />
      <meshStandardMaterial
        color={palette.ceilingBeam}
        metalness={0.15}
        roughness={0.85}
      />
    </mesh>
  );
}

export function DustMotes() {
  const palette = useSculpturePalette();
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const targetColor = useMemo(
    () => new THREE.Color(palette.dust),
    [palette.dust],
  );
  const { geometry, velocities } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const count = TUNING.dustCount;
    const positions = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const halfW = TUNING.dustAreaWidth / 2;
    const halfH = TUNING.dustAreaHeight / 2;
    const halfD = TUNING.dustAreaDepth / 2;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * halfW;
      positions[i * 3 + 1] = (Math.random() * 2 - 1) * halfH + TUNING.dustAreaY;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * halfD;
      vel[i * 3] = (Math.random() * 2 - 1) * TUNING.dustDrift;
      vel[i * 3 + 1] = -Math.random() * TUNING.dustFall;
      vel[i * 3 + 2] = (Math.random() * 2 - 1) * TUNING.dustDrift;
    }
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return { geometry: g, velocities: vel };
  }, []);

  const ref = useRef<THREE.Points>(null);

  useFrame((_, dt) => {
    const points = ref.current;
    if (!points) return;
    if (materialRef.current) {
      materialRef.current.color.lerp(targetColor, TUNING.paletteLerp);
    }
    const pos = (points.geometry.attributes.position as THREE.BufferAttribute)
      .array as Float32Array;
    const count = pos.length / 3;
    const halfW = TUNING.dustAreaWidth / 2;
    const halfD = TUNING.dustAreaDepth / 2;
    const minY = TUNING.dustAreaY - TUNING.dustAreaHeight / 2;
    const maxY = TUNING.dustAreaY + TUNING.dustAreaHeight / 2;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      pos[i3] += velocities[i3] * dt;
      pos[i3 + 1] += velocities[i3 + 1] * dt;
      pos[i3 + 2] += velocities[i3 + 2] * dt;
      if (pos[i3 + 1] < minY) pos[i3 + 1] = maxY;
      if (pos[i3] > halfW) pos[i3] = -halfW;
      else if (pos[i3] < -halfW) pos[i3] = halfW;
      if (pos[i3 + 2] > halfD) pos[i3 + 2] = -halfD;
      else if (pos[i3 + 2] < -halfD) pos[i3 + 2] = halfD;
    }
    points.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial
        ref={materialRef}
        color={palette.dust}
        size={TUNING.dustSize}
        sizeAttenuation
        transparent
        opacity={TUNING.dustOpacity}
        depthWrite={false}
      />
    </points>
  );
}
