"use client";

/**
 * Free water droplets for the /lab prototype.
 *
 * Previous versions used MarchingCubes for both letter shells AND droplets.
 * The letter shells are now a separate rigid mesh per letter (see
 * `letters.tsx`), and droplets here render as an InstancedMesh of small
 * refractive spheres. This gives us:
 *   - Droplets that are visibly smaller than letters (tuned radius).
 *   - A clean visual "merge" via per-instance scale lerping to 0 when
 *     a droplet migrates close to its target letter.
 *   - Much cheaper than MarchingCubes since there's no isosurface
 *     evaluation every frame.
 *
 * Droplets spawn at the CONTACT POINT reported by Rapier (not the letter's
 * centroid), with velocity along the contact normal — so bubbles visibly
 * emerge FROM the collision, not out of thin air.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TUNING } from "./tuning";
import type { EventQueue, LetterHandle } from "./shared";
import { playBubbleDetach, playBubbleMerge } from "./lab-audio";

type FluidProps = {
  lettersRef: React.MutableRefObject<LetterHandle[]>;
  events: EventQueue;
};

// ---- Droplet pool -----------------------------------------------------------

type Droplet = {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  /** Display radius in world units. Smaller than a letter on purpose. */
  radius: number;
  migrating: boolean;
  homeTarget: THREE.Vector3;
  /** Animation factor: ramps 0→1 on spawn (pop-in), and back 1→0 on merge. */
  phase: number;
  /** -1 when merging (shrinking), +1 when living (growing / stable). */
  phaseDir: number;
};

function makeDroplet(): Droplet {
  return {
    active: false,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    age: 0,
    radius: 0.1,
    migrating: false,
    homeTarget: new THREE.Vector3(),
    phase: 0,
    phaseDir: 1,
  };
}

// -----------------------------------------------------------------------------

export function Fluid({ lettersRef, events }: FluidProps) {
  const instRef = useRef<THREE.InstancedMesh>(null);

  const droplets = useMemo<Droplet[]>(
    () => Array.from({ length: TUNING.maxFreeDroplets }, makeDroplet),
    [],
  );

  // Seed ambient drifters on mount so there are always some bubbles around.
  useEffect(() => {
    for (let i = 0; i < TUNING.baseFreeDroplets; i++) {
      const d = droplets[i];
      d.active = true;
      const ang = (i / TUNING.baseFreeDroplets) * Math.PI * 2;
      const r = 3.2 + Math.sin(i * 1.7) * 0.8;
      d.pos.set(Math.cos(ang) * r, Math.sin(ang) * r * 0.55, Math.sin(i) * 0.6);
      d.vel.set(Math.sin(ang) * 0.05, -Math.cos(ang) * 0.05, 0);
      d.radius = 0.09 + Math.random() * 0.05;
      d.age = 99;
      d.migrating = false;
      d.phase = 1;
      d.phaseDir = 1;
    }
  }, [droplets]);

  // ---- Reused temporaries ------------------------------------------------
  const tmpMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tmpScale = useMemo(() => new THREE.Vector3(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 30);
    const inst = instRef.current;
    if (!inst) return;

    // --- 1. Drain impact events → spawn droplets at the CONTACT POINT.
    const es = events.drain();
    for (const e of es) {
      if (e.kind !== "hard" && e.kind !== "drag-release") continue;
      const n = e.kind === "drag-release" ? Math.min(3, 1 + Math.floor(e.force * 0.25)) : 1;
      let spawned = 0;
      for (let k = 0; k < n; k++) {
        const slot = droplets.find((d) => !d.active);
        if (!slot) break;
        slot.active = true;
        // Spawn EXACTLY at the contact point (plus tiny spread for multi-spawn).
        slot.pos.copy(e.position);
        if (n > 1) {
          slot.pos.x += (Math.random() - 0.5) * 0.12;
          slot.pos.y += (Math.random() - 0.5) * 0.12;
          slot.pos.z += (Math.random() - 0.5) * 0.12;
        }
        // Velocity along the contact normal + random scatter.
        const kick = e.kind === "drag-release" ? 0.8 + e.force * 0.08 : 1.3;
        slot.vel.set(
          e.normal.x * kick + (Math.random() - 0.5) * 0.6,
          e.normal.y * kick + (Math.random() - 0.5) * 0.35,
          e.normal.z * kick + (Math.random() - 0.5) * 0.6,
        );
        slot.age = 0;
        slot.migrating = false;
        slot.radius = 0.08 + Math.random() * 0.07; // noticeably SMALLER than letters (~1.3 world units)
        slot.phase = 0;
        slot.phaseDir = 1; // pop in
        spawned++;
      }
      if (spawned > 0) {
        playBubbleDetach(e.kind === "hard" ? 0.3 : 0.2);
      }
    }

    // --- 2. Compute centroid of all letter bodies (migration target fallback).
    const letters = lettersRef.current;
    let avgX = 0, avgY = 0, avgZ = 0, avgN = 0;
    for (let li = 0; li < letters.length; li++) {
      const L = letters[li];
      if (!L || !L.body) continue;
      const p = L.body.translation();
      avgX += p.x; avgY += p.y; avgZ += p.z; avgN++;
    }
    if (avgN > 0) {
      avgX /= avgN; avgY /= avgN; avgZ /= avgN;
    }

    // --- 3. Update droplets (physics + migration + phase anim).
    for (const d of droplets) {
      if (!d.active) continue;
      d.age += dt;

      // Phase animation: pop in at birth, shrink at merge.
      d.phase = THREE.MathUtils.clamp(d.phase + d.phaseDir * dt * 4.5, 0, 1);

      if (!d.migrating && d.age > TUNING.dropletMergeDuration) {
        d.migrating = true;
        // Pick the nearest letter body as home target.
        let bestD = Infinity;
        d.homeTarget.set(avgX, avgY, avgZ);
        for (let li = 0; li < letters.length; li++) {
          const L = letters[li];
          if (!L || !L.body) continue;
          const p = L.body.translation();
          const dx = d.pos.x - p.x;
          const dy = d.pos.y - p.y;
          const dz = d.pos.z - p.z;
          const dd = dx * dx + dy * dy + dz * dz;
          if (dd < bestD) {
            bestD = dd;
            d.homeTarget.set(p.x, p.y, p.z);
          }
        }
      }

      if (d.migrating) {
        const dx = d.homeTarget.x - d.pos.x;
        const dy = d.homeTarget.y - d.pos.y;
        const dz = d.homeTarget.z - d.pos.z;
        const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dd < TUNING.dropletMergeDistance) {
          // Start shrink-out animation if not already.
          if (d.phaseDir > 0) {
            d.phaseDir = -1;
            playBubbleMerge(0.2);
          }
          // When fully shrunk, free the slot.
          if (d.phase <= 0.001) {
            d.active = false;
            continue;
          }
        } else {
          const inv = 1 / Math.max(dd, 1e-3);
          const pullStrength = 1.6;
          d.vel.x += dx * inv * pullStrength * dt;
          d.vel.y += dy * inv * pullStrength * dt;
          d.vel.z += dz * inv * pullStrength * dt;
        }
      }

      // Integrate + damp.
      d.pos.x += d.vel.x * dt;
      d.pos.y += d.vel.y * dt;
      d.pos.z += d.vel.z * dt;
      const damping = d.migrating ? 1.4 : 0.85;
      d.vel.multiplyScalar(Math.exp(-damping * dt));

      // Keep inside the scene volume.
      const half = TUNING.fluidScale / 2 - 0.2;
      if (Math.abs(d.pos.x) > half) { d.pos.x = Math.sign(d.pos.x) * half; d.vel.x *= -0.2; }
      if (Math.abs(d.pos.y) > half) { d.pos.y = Math.sign(d.pos.y) * half; d.vel.y *= -0.2; }
      if (Math.abs(d.pos.z) > half) { d.pos.z = Math.sign(d.pos.z) * half; d.vel.z *= -0.2; }
    }

    // --- 4. Write instance matrices.
    tmpQuat.identity();
    let visible = 0;
    for (let i = 0; i < droplets.length; i++) {
      const d = droplets[i];
      if (!d.active || d.phase <= 0) {
        // Hide by scaling to zero at origin.
        tmpScale.set(0, 0, 0);
        tmpMatrix.compose(new THREE.Vector3(), tmpQuat, tmpScale);
      } else {
        const s = d.radius * d.phase;
        tmpScale.set(s, s, s);
        tmpMatrix.compose(d.pos, tmpQuat, tmpScale);
        visible++;
      }
      inst.setMatrixAt(i, tmpMatrix);
    }
    inst.count = droplets.length;
    inst.instanceMatrix.needsUpdate = true;
    void visible;
  });

  return (
    <instancedMesh
      ref={instRef}
      args={[undefined, undefined, TUNING.maxFreeDroplets]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 14, 10]} />
      <meshPhysicalMaterial
        color="#dcebf6"
        metalness={0}
        roughness={0.04}
        transmission={1}
        thickness={0.25}
        ior={1.33}
        clearcoat={1}
        clearcoatRoughness={0.05}
        attenuationColor="#5a7aa0"
        attenuationDistance={6}
        reflectivity={0.4}
        specularIntensity={0.6}
      />
    </instancedMesh>
  );
}
