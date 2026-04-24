"use client";

/**
 * Anamorphic FABRIQUE — Phase 1.
 *
 * White gallery scene. One camera pose (sweet-spot A). Studio HDRI for
 * reflections on the shards. Contact shadow on the floor sells the
 * "suspended in air" read.
 *
 * No interaction, no camera animation, no dual silhouette — all of that
 * comes later. Phase 1's job is to prove the shard cloud looks beautiful
 * from the correct angle.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, MeshReflectorMaterial } from "@react-three/drei";
import { Suspense, useEffect, useRef } from "react";
import * as THREE from "three";
import type { PerspectiveCamera as PerspectiveCameraImpl } from "three";
import { SuspendedCloud } from "./suspended-cloud";
import { ProjectsButton } from "./projects-button";
import { TUNING } from "./tuning";
import { onReveal } from "./reveal-bus";

export function SculptureScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{
        // Mount at the overture pose so the reveal animation has a smooth
        // starting frame. RevealCamera lerps from here to the sweet-spot.
        position: [
          TUNING.overtureOffset.x,
          TUNING.overtureOffset.y,
          TUNING.cameraZ + TUNING.overtureOffset.z,
        ],
        fov: TUNING.fov,
        near: 0.1,
        far: 40,
      }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={[TUNING.backgroundColor]} />

      <Suspense fallback={null}>
        {/* "warehouse" gives shards contrasty darker bays to reflect, so
            metal reads as metal against white. "studio" is pure soft white
            which makes chrome look like paper. */}
        <Environment preset="warehouse" background={false} environmentIntensity={TUNING.envMapIntensity} />

        {/* Strong key light — metal needs hard specular hotspots to look
            metallic. Without this everything goes matte against white. */}
        <directionalLight
          position={[4, 5, 6]}
          intensity={2.4}
          color="#fff4e0"
        />
        {/* Cool fill from the opposite side — picks out edges the key misses. */}
        <directionalLight position={[-5, 2, 3]} intensity={0.55} color="#d0dbee" />
        {/* Back rim — separates the cloud from the white. */}
        <directionalLight position={[0, 2, -6]} intensity={0.9} color="#ffffff" />
        {/* Faint ambient so back-facing shards never crush to black. */}
        <ambientLight intensity={0.22} />

        <ResponsiveCamera />
        <RevealCamera />
        <SuspendedCloud />
        <ProjectsButton />
        <ReflectiveFloor />
      </Suspense>
    </Canvas>
  );
}

/**
 * Keeps the full FABRIQUE silhouette visible regardless of window aspect.
 *
 * Why FOV and not camera z: the shards are placed on viewing rays from a
 * fixed camera pose. Moving the camera changes which rays converge on
 * which pixels, breaking the illusion. FOV only changes how much of the
 * view frustum is captured — the rays themselves stay put.
 *
 * We solve for the vertical FOV that makes both the horizontal and
 * vertical bounds of the cloud fit, with a small margin. On wide windows
 * this means a small FOV (cloud looks smaller in a big frame); on tall
 * phone windows this means a wider FOV (we zoom out to fit both rows).
 */
function ResponsiveCamera() {
  const { camera, size } = useThree();
  useFrame(() => {
    const cam = camera as PerspectiveCameraImpl;
    const viewportAspect = size.width / Math.max(size.height, 1);
    const camZ = TUNING.cameraZ;
    const halfW = TUNING.wordHalfWidth + TUNING.fitMargin;
    const canvasAspect = TUNING.sampleWidth / TUNING.sampleHeight;
    const halfH = TUNING.wordHalfWidth / canvasAspect + TUNING.fitMargin;

    // vfov needed so horizontal extent fits:
    //   halfW = camZ * tan(halfHFov) = camZ * tan(halfVFov) * viewportAspect
    //   => halfVFov = atan(halfW / (camZ * viewportAspect))
    const halfVFovByW = Math.atan(halfW / (camZ * viewportAspect));
    // vfov needed so vertical extent fits:
    const halfVFovByH = Math.atan(halfH / camZ);
    const halfVFov = Math.max(halfVFovByW, halfVFovByH);
    const targetFov = (halfVFov * 2 * 180) / Math.PI;

    cam.fov += (targetFov - cam.fov) * 0.2;
    cam.updateProjectionMatrix();
  });
  return null;
}

/**
 * Camera pan from an overture pose to the sweet-spot. While the pan runs,
 * shards appear as a scattered cloud; at t=1 the camera sits exactly at
 * (0, 0, cameraZ), the rays converge, and FABRIQUE resolves — the reveal.
 *
 * Runs once on mount and again on every `triggerReveal()` from the UI.
 * ResponsiveCamera keeps managing FOV concurrently; position and FOV are
 * orthogonal so they don't fight.
 */
function RevealCamera() {
  const { camera } = useThree();
  // null = idle (camera stays at sweet-spot); number = ms timestamp when
  // the current pan started.
  const startRef = useRef<number | null>(null);
  const endPos = useRef(new THREE.Vector3(0, 0, TUNING.cameraZ));
  const startPos = useRef(
    new THREE.Vector3(
      TUNING.overtureOffset.x,
      TUNING.overtureOffset.y,
      TUNING.cameraZ + TUNING.overtureOffset.z,
    ),
  );

  // Kick off on mount.
  useEffect(() => {
    startRef.current = performance.now();
    return onReveal(() => {
      startRef.current = performance.now();
    });
  }, []);

  useFrame(() => {
    const started = startRef.current;
    const cam = camera as PerspectiveCameraImpl;
    if (started == null) {
      // Idle: lock to sweet-spot so the silhouette stays resolved.
      cam.position.set(0, 0, cam.position.z);
      cam.lookAt(0, 0, 0);
      return;
    }
    const elapsed = performance.now() - started;
    const t = Math.min(1, elapsed / TUNING.revealDurationMs);
    // easeOutCubic — quick move that settles gently onto the sweet-spot.
    const eased = 1 - Math.pow(1 - t, 3);

    cam.position.lerpVectors(startPos.current, endPos.current, eased);
    // Keep z at whatever ResponsiveCamera wanted — only lerp x,y during
    // the pan. At t=1 both x and y are 0, so rays converge for the illusion.
    // ResponsiveCamera will settle z independently.
    cam.lookAt(0, 0, 0);

    if (t >= 1) {
      startRef.current = null;
    }
  });

  return null;
}

/**
 * Invisible floor that shows ONLY as a soft reflection of the sculpture.
 *
 * The plane's base color matches the background exactly, so the surface
 * itself has no visible edge. MeshReflectorMaterial renders the scene
 * from underneath and blends that reflection in at low strength, so what
 * you see is a ghost of the hanging shards mirrored on the ground.
 */
function ReflectiveFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TUNING.floorY, 0]}>
      {/* Generous extent so reflections don't clip at the edges when the
          camera pans. 40x40 world units is plenty. */}
      <planeGeometry args={[40, 40]} />
      <MeshReflectorMaterial
        color={TUNING.floorColor}
        mirror={TUNING.floorReflectStrength}
        blur={[TUNING.floorReflectBlur, TUNING.floorReflectBlur / 3]}
        mixBlur={TUNING.floorMixBlur}
        mixStrength={TUNING.floorMixStrength}
        resolution={1024}
        /* metalness=0 + high base roughness kills the directional-light
           specular hotspot (the "glare" in the center of the reflection).
           The mirror reflection still comes through via mixStrength because
           that blend is separate from the base material's Phong response. */
        metalness={0}
        roughness={1.0}
        depthScale={0}
      />
    </mesh>
  );
}
