"use client";

/**
 * Ambient artifacts for the /lab prototype.
 *
 * Three small metallic shapes that drift slowly in the zero-G field and
 * collide with letters. Distinct sound from letter impacts.
 */

import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { playArtifactHit } from "./lab-audio";

type ArtifactDef = {
  position: [number, number, number];
  seed: number;
  geometry: "octa" | "torus" | "dodec";
  scale: number;
};

const ARTIFACTS: ArtifactDef[] = [
  { position: [-3.8, 2.2, -1.4], seed: 11, geometry: "octa", scale: 0.38 },
  { position: [4.2, -2.6, 0.8], seed: 23, geometry: "torus", scale: 0.42 },
  { position: [1.1, 2.9, 1.2], seed: 31, geometry: "dodec", scale: 0.34 },
];

export function Artifacts() {
  return (
    <group>
      {ARTIFACTS.map((a, i) => (
        <Artifact key={i} def={a} />
      ))}
    </group>
  );
}

function Artifact({ def }: { def: ArtifactDef }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const lastSound = useRef(0);

  // Gentle drift force — pseudo-random per-artifact.
  const seedRef = useRef(def.seed);
  useFrame(({ clock }) => {
    const body = bodyRef.current;
    if (!body) return;
    const t = clock.elapsedTime;
    const s = seedRef.current;
    // Orbital hint: very small sinusoidal force, unique phase per artifact.
    const fx = Math.sin(t * 0.3 + s) * 0.004;
    const fy = Math.cos(t * 0.27 + s * 1.3) * 0.004;
    const fz = Math.sin(t * 0.21 + s * 0.7) * 0.003;
    body.applyImpulse({ x: fx, y: fy, z: fz }, true);
  });

  const onContactForce = (payload: { totalForceMagnitude: number }) => {
    const now = performance.now();
    if (payload.totalForceMagnitude < 1.5) return;
    if (now - lastSound.current < 140) return;
    lastSound.current = now;
    const vol = Math.min(0.55, 0.15 + payload.totalForceMagnitude / 90);
    playArtifactHit(vol);
  };

  // Initial gentle push so they're already in motion on scene load.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const s = seedRef.current;
    body.setLinvel(
      {
        x: Math.sin(s) * 0.4,
        y: Math.cos(s * 1.3) * 0.3,
        z: Math.sin(s * 0.7) * 0.2,
      },
      true,
    );
    body.setAngvel(
      { x: Math.sin(s * 2) * 0.5, y: Math.cos(s) * 0.5, z: Math.sin(s * 3) * 0.5 },
      true,
    );
  }, []);

  const radius = def.scale;
  return (
    <RigidBody
      ref={bodyRef}
      position={def.position}
      colliders="ball"
      linearDamping={1.2}
      angularDamping={0.8}
      gravityScale={0}
      onContactForce={onContactForce}
    >
      <mesh castShadow>
        {def.geometry === "octa" && <octahedronGeometry args={[radius, 0]} />}
        {def.geometry === "torus" && <torusGeometry args={[radius * 0.85, radius * 0.3, 16, 32]} />}
        {def.geometry === "dodec" && <dodecahedronGeometry args={[radius, 0]} />}
        <meshPhysicalMaterial
          color="#8a94a8"
          metalness={1}
          roughness={0.28}
          clearcoat={0.7}
          clearcoatRoughness={0.25}
          emissive="#2a3340"
          emissiveIntensity={0.35}
        />
      </mesh>
    </RigidBody>
  );
}
