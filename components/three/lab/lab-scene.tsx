"use client";

/**
 * /lab scene — prototype for the new physics+fluid title page.
 *
 * Composition:
 *   Canvas
 *   └── Suspense
 *       ├── <Environment preset="night"> (image-based lighting for the
 *       │    physical materials — glass / obsidian / frosted all need it)
 *       ├── Lights (key + rim + ambient)
 *       ├── <Physics> (zero-G)
 *       │   ├── <Letters/>     ← Rapier bodies, draggable
 *       │   └── <Artifacts/>   ← ambient metallic objects
 *       └── <Fluid/>           ← MarchingCubes metaball blob, reads letter
 *                                positions each frame (no physics coupling
 *                                in return — water only reacts visually).
 *
 * Camera parallax: the whole camera yaws + pitches a small amount based
 * on cursor NDC. Subtle but keeps the scene alive.
 *
 * Idle director: if no pointerdown has happened for TUNING.idleTriggerSeconds,
 * we pick a random letter and apply a small impulse. Resets on any user input.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef } from "react";
import type { PerspectiveCamera as PerspectiveCameraImpl } from "three";
import * as THREE from "three";
import { Letters } from "./letters";
import { Artifacts } from "./artifacts";
import { Fluid } from "./fluid";
import { TUNING } from "./tuning";
import { EventQueue, type LetterHandle } from "./shared";
import { unlockLabAudio, startAmbient, stopAmbient } from "./lab-audio";

export function LabScene() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, TUNING.cameraZ], fov: TUNING.fov }}
      gl={{ antialias: true, alpha: false }}
      onPointerDown={() => {
        unlockLabAudio();
        startAmbient();
      }}
    >
      <color attach="background" args={["#04050a"]} />
      <fog attach="fog" args={["#04050a", 14, 28]} />
      <Suspense fallback={null}>
        <SceneContents />
      </Suspense>
    </Canvas>
  );
}

function SceneContents() {
  // Shared refs for cross-component runtime data.
  const lettersRef = useRef<LetterHandle[]>([]);
  const events = useMemo(() => new EventQueue(), []);
  useAmbientCleanup();

  return (
    <>
      <Lights />
      <Environment preset="night" background={false} environmentIntensity={0.85} />
      <ResponsiveCamera />
      <CameraParallax />
      <IdleDirector lettersRef={lettersRef} />

      <Physics
        gravity={[0, 0, 0]}
        timeStep="vary"
        // Rapier needs contact force events enabled for our onContactForce
        // handlers to fire; they're on per-RigidBody already.
      >
        <Letters lettersRef={lettersRef} events={events} />
        <Artifacts />
      </Physics>

      {/* Toggle fluid off temporarily via ?nofluid query for debugging. */}
      {typeof window !== "undefined" && window.location.search.includes("nofluid") ? null : (
        <Fluid lettersRef={lettersRef} events={events} />
      )}
    </>
  );
}

// -----------------------------------------------------------------------------

function Lights() {
  return (
    <>
      <ambientLight intensity={0.25} />
      {/* Key — cool, above-front. Creates the subaqueous rim on glass. */}
      <directionalLight position={[4, 6, 5]} intensity={1.8} color="#cfe0ff" />
      {/* Warm rim, low angle. Pushes blob edges away from the void. */}
      <directionalLight position={[-5, -3, -4]} intensity={0.9} color="#ffb48a" />
      {/* Soft front fill so matte / obsidian never go pitch-black. */}
      <pointLight position={[0, 0, 6]} intensity={6} color="#a8c4e0" distance={16} decay={1.4} />
      {/* Undercaustic — faint blue pool light up from below to sell "underwater". */}
      <pointLight position={[0, -4, 2]} intensity={3.5} color="#5a88c8" distance={12} decay={1.6} />
      {/* Backlight — strong cool light BEHIND the letters (at -z) so glass +
          frosted letters glow at their edges and the whole composition
          silhouettes against a soft halo. Single most impactful light for
          the "lit from within / behind" feel. */}
      <pointLight position={[0, 0.5, -4.5]} intensity={22} color="#6fa6e8" distance={14} decay={1.1} />
      {/* Narrow accent spots mirroring the key, aimed through the word —
          gives the fluid sheath directional highlights. */}
      <pointLight position={[-6, 3, 2]} intensity={2.2} color="#cfe0ff" distance={10} decay={1.8} />
      <pointLight position={[6, -3, 2]} intensity={2.2} color="#9fb8e0" distance={10} decay={1.8} />
    </>
  );
}

/** Mounts a single effect to stop ambient audio on unmount. */
function useAmbientCleanup() {
  useEffect(() => {
    return () => stopAmbient();
  }, []);
}

// -----------------------------------------------------------------------------

/**
 * Adapts camera distance to viewport aspect so the word always fits
 * horizontally. Critical on portrait/narrow windows where a fixed
 * cameraZ of 9.5 cuts the outer letters off-screen.
 */
function ResponsiveCamera() {
  const { camera, size } = useThree();
  // Half-width we want visible, including a bit of margin around the word.
  const wantHalfWidth = (TUNING.word.length * TUNING.letterSpacing) / 2 + 1.3;
  useFrame(() => {
    const cam = camera as PerspectiveCameraImpl;
    const aspect = size.width / Math.max(size.height, 1);
    // fov is vertical; horizontal fov derived from aspect.
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    // z so that halfWidth = z * tan(hfov/2)
    const neededZ = wantHalfWidth / Math.tan(hfov / 2);
    const z = Math.max(TUNING.cameraZ, neededZ);
    // Smoothly ease z; don't fight the parallax lerp below.
    cam.position.z += (z - cam.position.z) * 0.08;
    cam.updateProjectionMatrix();
  });
  return null;
}

function CameraParallax() {
  const { camera, pointer } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const amt = TUNING.parallaxAmount;
    // Preserve camera z set by ResponsiveCamera; only shift x/y.
    target.set(pointer.x * amt, pointer.y * amt * 0.6, camera.position.z);
    camera.position.lerp(target, 1 - Math.exp(-dt * 2.5));
    camera.lookAt(0, 0, 0);
  });
  return null;
}

// -----------------------------------------------------------------------------

function IdleDirector({
  lettersRef,
}: {
  lettersRef: React.MutableRefObject<LetterHandle[]>;
}) {
  const lastInteractionRef = useRef(performance.now());

  useEffect(() => {
    const bump = () => {
      lastInteractionRef.current = performance.now();
    };
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, []);

  useFrame(() => {
    const now = performance.now();
    const since = (now - lastInteractionRef.current) / 1000;
    if (since < TUNING.idleTriggerSeconds) return;

    // Re-arm: we only nudge once per idle window, then reset the timer
    // (but set it in the past so we nudge again in ~idleTriggerSeconds).
    lastInteractionRef.current = now - TUNING.idleTriggerSeconds * 0.4;

    // Pick a random letter and shove it gently in a random direction.
    const letters = lettersRef.current.filter((l) => l && l.body && !l.grabbed);
    if (letters.length === 0) return;
    const pick = letters[Math.floor(Math.random() * letters.length)];
    const body = pick.body;
    if (!body) return;
    const ang = Math.random() * Math.PI * 2;
    const up = Math.random() * 0.6 - 0.3;
    body.applyImpulse(
      {
        x: Math.cos(ang) * TUNING.idleNudgeImpulse,
        y: Math.sin(ang) * TUNING.idleNudgeImpulse + up,
        z: 0,
      },
      true,
    );
  });
  return null;
}
