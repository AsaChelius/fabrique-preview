"use client";

/**
 * /projects scene — the "other perspective" of the FABRIQUE sculpture.
 *
 * Visually identical framework to /title (white bg, warehouse HDRI,
 * polished reflector floor, suspended metal shards + wires), but the
 * silhouette is three hollow circles instead of the FABRIQUE wordmark.
 *
 * Circles are placeholders — the eventual design will swap them for
 * app-specific icons or marks. Static for now (no physics state); we
 * can layer in sway + cursor push later if needed.
 */

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Environment, MeshReflectorMaterial } from "@react-three/drei";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PerspectiveCamera as PerspectiveCameraImpl } from "three";
import * as THREE from "three";
import { TUNING } from "./tuning";
import type { Placement } from "./placements";
import { setCursorHover } from "./cursor-bus";
import {
  SOUND_ASSETS,
  playSample,
  preloadSample,
  unlockAudio,
} from "@/lib/sound";

export function ProjectsScene() {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{
        position: [0, 0, TUNING.cameraZ],
        fov: TUNING.fov,
        near: 0.1,
        far: 40,
      }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={[TUNING.backgroundColor]} />

      <Suspense fallback={null}>
        <Environment
          preset="warehouse"
          background={false}
          environmentIntensity={TUNING.envMapIntensity}
        />
        <directionalLight
          position={[4, 5, 6]}
          intensity={2.4}
          color="#fff4e0"
        />
        <directionalLight
          position={[-5, 2, 3]}
          intensity={0.55}
          color="#d0dbee"
        />
        <directionalLight
          position={[0, 2, -6]}
          intensity={0.9}
          color="#ffffff"
        />
        <ambientLight intensity={0.22} />

        <ResponsiveCirclesCamera />
        <CirclesCloud />
        <CircleHitTargets />
        <ReflectiveFloor />
      </Suspense>
    </Canvas>
  );
}

// -----------------------------------------------------------------------
// Camera that fits the three circles horizontally regardless of window
// aspect. Same FOV-fitting trick as the title page but with the circles'
// own bounding box.

function ResponsiveCirclesCamera() {
  const { camera, size } = useThree();
  useFrame(() => {
    const cam = camera as PerspectiveCameraImpl;
    const viewportAspect = size.width / Math.max(size.height, 1);
    const camZ = TUNING.cameraZ;
    const halfW = CIRCLES.worldHalfWidth + 0.5;
    const halfH = CIRCLES.worldHalfHeight + 0.5;
    const halfVFovByW = Math.atan(halfW / (camZ * viewportAspect));
    const halfVFovByH = Math.atan(halfH / camZ);
    const halfVFov = Math.max(halfVFovByW, halfVFovByH);
    const target = (halfVFov * 2 * 180) / Math.PI;
    cam.fov += (target - cam.fov) * 0.2;
    cam.position.set(0, 0, camZ);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
  });
  return null;
}

// -----------------------------------------------------------------------
// Three hollow circles sampled to pixel coordinates, then placed on
// viewing rays from the sweet-spot camera so they resolve from the
// current camera pose.

const CIRCLES = {
  /** Sampling canvas dimensions. */
  sampleWidth: 1600,
  sampleHeight: 700,
  /** Half-width of the whole 3-circle group in world units. */
  worldHalfWidth: 4.2,
  /** Half-height of the group in world units. */
  worldHalfHeight: 1.4,
  /** Stroke width (sampling pixels) for each hollow ring. */
  strokeWidth: 26,
  /** Total shards across all three circles. */
  shardCount: 3600,
  /** Cloud depth range. */
  cloudDepth: 2.4,
  depthBias: 1.15,
  /** Shard + wire visuals — same family as FABRIQUE. */
  shardColor: "#4a4d55",
  localCeilingY: 7.5,
};

function CirclesCloud() {
  const [placements, setPlacements] = useState<Placement[] | null>(null);

  useLayoutEffect(() => {
    let cancelled = false;
    const run = () => {
      const p = computeCirclesPlacements();
      if (!cancelled) setPlacements(p);
    };
    // No custom fonts needed here — the sampler draws shapes, not text.
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const shardGeom = useMemo(
    () =>
      new THREE.BoxGeometry(
        TUNING.shardWidth,
        TUNING.shardHeight,
        TUNING.shardThickness,
      ),
    [],
  );

  const shardMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(CIRCLES.shardColor),
        metalness: TUNING.metalness,
        roughness: TUNING.roughness,
        envMapIntensity: TUNING.envMapIntensity,
      }),
    [],
  );

  const wireGeom = useMemo(
    () =>
      new THREE.CylinderGeometry(
        TUNING.wireRadius,
        TUNING.wireRadius,
        1,
        5,
        1,
        false,
      ),
    [],
  );

  const wireMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(TUNING.wireColor),
        metalness: 0.1,
        roughness: 0.8,
        transparent: true,
        opacity: TUNING.wireOpacity,
      }),
    [],
  );

  const shardMeshRef = useRef<THREE.InstancedMesh>(null);
  const wireMeshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    if (!placements) return;
    const sm = shardMeshRef.current;
    const wm = wireMeshRef.current;
    if (!sm || !wm) return;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const euler = new THREE.Euler();
    const ceilingY = CIRCLES.localCeilingY;
    const halfShardH = TUNING.shardHeight / 2;

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      pos.set(p.x, p.y, p.z);
      euler.set(p.tilt, p.yaw, 0, "YXZ");
      quat.setFromEuler(euler);
      m.compose(pos, quat, scale);
      sm.setMatrixAt(i, m);

      const topY = p.y + halfShardH;
      const length = ceilingY - topY;
      const midY = (ceilingY + topY) / 2;
      const wPos = new THREE.Vector3(p.x, midY, p.z);
      const wScale = new THREE.Vector3(1, length, 1);
      m.compose(wPos, new THREE.Quaternion(), wScale);
      wm.setMatrixAt(i, m);
    }
    sm.count = placements.length;
    wm.count = placements.length;
    sm.instanceMatrix.needsUpdate = true;
    wm.instanceMatrix.needsUpdate = true;
    sm.frustumCulled = false;
    wm.frustumCulled = false;
  }, [placements]);

  if (!placements) return null;

  return (
    <group>
      <instancedMesh
        ref={wireMeshRef}
        args={[wireGeom, wireMat, placements.length]}
      />
      <instancedMesh
        ref={shardMeshRef}
        args={[shardGeom, shardMat, placements.length]}
      />
    </group>
  );
}

// -----------------------------------------------------------------------

function CircleHitTargets() {
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const centers = useMemo(() => circleWorldCenters(), []);
  const radius = circleWorldRadius();

  useEffect(() => {
    preloadSample(SOUND_ASSETS.ringHover);
    preloadSample(SOUND_ASSETS.ringSelect);
    return () => {
      setCursorHover(false);
      if (document.body.style.cursor === "pointer") {
        document.body.style.cursor = "";
      }
    };
  }, []);

  return (
    <>
      {centers.map((x, idx) => {
        const active = hovered === idx || selected === idx;
        return (
          <group key={idx} position={[x, 0, 0.07]}>
            <mesh>
              <ringGeometry args={[radius - 0.09, radius + 0.09, 96]} />
              <meshBasicMaterial
                color={selected === idx ? "#20242c" : "#4f5663"}
                transparent
                opacity={active ? 0.22 : 0}
                depthWrite={false}
              />
            </mesh>
            <mesh
              onPointerOver={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHovered(idx);
                setCursorHover(true);
                document.body.style.cursor = "pointer";
                playSample(SOUND_ASSETS.ringHover, 0.28, 0, undefined, {
                  reverbSend: 0.14,
                });
              }}
              onPointerOut={(e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setHovered(null);
                setCursorHover(false);
                if (document.body.style.cursor === "pointer") {
                  document.body.style.cursor = "";
                }
              }}
              onClick={(e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                unlockAudio();
                setSelected(idx);
                playSample(SOUND_ASSETS.ringSelect, 0.42, 0, undefined, {
                  reverbSend: 0.26,
                });
              }}
              visible={false}
            >
              <circleGeometry args={[radius + 0.26, 64]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function circleWorldCenters(): number[] {
  const radiusPx = CIRCLES.sampleHeight * 0.36;
  const gapPx = radiusPx * 2.2;
  return [-gapPx, 0, gapPx].map((dx) => {
    const nx = (dx / CIRCLES.sampleWidth) * 2;
    return nx * CIRCLES.worldHalfWidth;
  });
}

function circleWorldRadius(): number {
  return 0.36 * 2 * CIRCLES.worldHalfHeight;
}

// -----------------------------------------------------------------------

function computeCirclesPlacements(): Placement[] {
  const W = CIRCLES.sampleWidth;
  const H = CIRCLES.sampleHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  // Draw three hollow rings.
  const cy = H / 2;
  const radius = H * 0.36;
  const gap = radius * 2.2; // center-to-center spacing
  const centers = [W / 2 - gap, W / 2, W / 2 + gap];
  ctx.strokeStyle = "#000";
  ctx.lineWidth = CIRCLES.strokeWidth;
  ctx.lineCap = "round";
  for (const cx of centers) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  const { data } = ctx.getImageData(0, 0, W, H);
  const inside: number[] = [];
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] >= TUNING.alphaThreshold) inside.push((i - 3) >> 2);
  }
  if (inside.length === 0) return [];

  const halfW = CIRCLES.worldHalfWidth;
  const halfH = CIRCLES.worldHalfHeight;
  const camZ = TUNING.cameraZ;
  const rand = mulberry32(0xc1c1ec17);
  const N = CIRCLES.shardCount;
  const out: Placement[] = new Array(N);

  for (let i = 0; i < N; i++) {
    const pick = inside[(rand() * inside.length) | 0];
    const px = pick % W;
    const py = (pick / W) | 0;
    const nx = (px / W) * 2 - 1;
    const ny = -((py / H) * 2 - 1);

    const x0 = nx * halfW;
    const y0 = ny * halfH;
    const u = rand() * 2 - 1;
    const biased = Math.sign(u) * Math.pow(Math.abs(u), CIRCLES.depthBias);
    const dz = biased * CIRCLES.cloudDepth;
    const ratio = (camZ - dz) / camZ;

    const yaw = (rand() * 2 - 1) * TUNING.yawJitter;
    const tilt = (rand() * 2 - 1) * TUNING.tiltJitter;

    out[i] = { x: x0 * ratio, y: y0 * ratio, z: dz, yaw, tilt };
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -----------------------------------------------------------------------

function ReflectiveFloor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, TUNING.floorY, 0]}>
      <planeGeometry args={[40, 40]} />
      <MeshReflectorMaterial
        color={TUNING.floorColor}
        mirror={TUNING.floorReflectStrength}
        blur={[TUNING.floorReflectBlur, TUNING.floorReflectBlur / 3]}
        mixBlur={TUNING.floorMixBlur}
        mixStrength={TUNING.floorMixStrength}
        resolution={1024}
        metalness={0}
        roughness={1.0}
        depthScale={0}
      />
    </mesh>
  );
}
