"use client";

/**
 * "Nos Projets" — an in-scene suspended-metal button.
 *
 * Samples its own small text silhouette, places shards along viewing rays
 * from the same sweet-spot camera (so the label resolves anamorphically
 * at the same angle as FABRIQUE), and renders them as a self-contained
 * mini-sculpture. A transparent hit-box plane above the shards captures
 * pointer events for hover/click without disturbing the main cursor
 * physics on the big sculpture.
 *
 * Static by design — these shards do NOT participate in the main
 * ShardPhysicsState, so the cursor cannot push them around. Hover raises
 * the material's emissiveIntensity smoothly so the button "lights up".
 * Click routes to /projects.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { navigateWithFade } from "./route-transition";
import { TUNING } from "./tuning";
import type { Placement } from "./placements";

// ---- Button-local tuning -------------------------------------------------
const BUTTON = {
  label: "NOS PROJETS",
  /** Target route on click. */
  href: "/projects",

  // ---- Placement in the world (centerY + halfWidth live in TUNING so
  //      the plaque sampler can knock out this region to keep the
  //      button clear of frame shards). ----
  /** World Y where the button's own wires attach. Just above the label. */
  localCeilingY: -0.85,

  // ---- Sampling ---- (higher-res sampling → crisper silhouette edges)
  sampleWidth: 1800,
  sampleHeight: 260,
  alphaThreshold: 140,

  // ---- Shard config ---- (more shards + flatter cloud + tighter
  //      jitter → the label reads like sharp typography from the
  //      sweet-spot camera) ----
  shardCount: 1800,
  shardHeight: 0.042,
  shardWidth: 0.018,
  shardThickness: 0.0018,
  /** Small cloud depth so silhouette stays tight. */
  cloudDepth: 0.4,
  /** Strong bias toward the mid-plane — most shards sit near z=0 so
   *  silhouette edges aren't blurred by perspective spread. */
  depthBias: 2.4,
  /** Override TUNING.yawJitter locally — button wants less rotation
   *  scatter than the main FABRIQUE shards so it reads as a legible
   *  label, not a cloud. */
  yawJitter: 0.18,
  tiltJitter: 0.04,

  // ---- Material ----
  baseColor: "#5a5e66",
  /** Warm-white glow color blended in on hover. */
  hoverEmissive: "#ffd48a",
  /** Max emissive intensity when fully hovered. */
  hoverMaxEmissive: 1.1,
  /** Hover lerp speed (per frame). */
  hoverLerp: 0.18,

  // ---- Wire config ----
  wireRadius: 0.0005,
  wireColor: "#9aa0a8",
  wireOpacity: 0.55,

  // ---- Hitbox padding (world units) ----
  hitPaddingX: 0.35,
  hitPaddingY: 0.28,
} as const;

export function ProjectsButton() {
  const [hover, setHover] = useState(false);
  const [placements, setPlacements] = useState<Placement[] | null>(null);

  // Sample text once, after fonts are ready.
  useLayoutEffect(() => {
    let cancelled = false;
    const run = () => {
      const p = computeButtonPlacements();
      if (!cancelled) setPlacements(p);
    };
    if (typeof document !== "undefined" && "fonts" in document) {
      document.fonts.ready.then(() => {
        if (!cancelled) run();
      });
    } else {
      run();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // CSS cursor over the canvas toggles to pointer on hover.
  useEffect(() => {
    if (!hover) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = "pointer";
    return () => {
      document.body.style.cursor = prev;
    };
  }, [hover]);

  const geometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        BUTTON.shardWidth,
        BUTTON.shardHeight,
        BUTTON.shardThickness,
      ),
    [],
  );

  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(BUTTON.baseColor),
        metalness: 1,
        roughness: 0.3,
        emissive: new THREE.Color(BUTTON.hoverEmissive),
        emissiveIntensity: 0,
        envMapIntensity: TUNING.envMapIntensity,
      }),
    [],
  );

  const wireGeometry = useMemo(
    () =>
      new THREE.CylinderGeometry(
        BUTTON.wireRadius,
        BUTTON.wireRadius,
        1,
        5,
        1,
        false,
      ),
    [],
  );

  const wireMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(BUTTON.wireColor),
        metalness: 0.1,
        roughness: 0.8,
        transparent: true,
        opacity: BUTTON.wireOpacity,
      }),
    [],
  );

  // Precompute matrices: shard transforms + wire transforms. Both are
  // static so we only need to write them once.
  const shardMeshRef = useRef<THREE.InstancedMesh>(null);
  const wireMeshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    if (!placements) return;
    const shardMesh = shardMeshRef.current;
    const wireMesh = wireMeshRef.current;
    if (!shardMesh || !wireMesh) return;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const euler = new THREE.Euler();
    const ceilY = BUTTON.localCeilingY;
    const halfShardH = BUTTON.shardHeight / 2;

    for (let i = 0; i < placements.length; i++) {
      const p = placements[i];
      pos.set(p.x, p.y, p.z);
      euler.set(p.tilt, p.yaw, 0, "YXZ");
      quat.setFromEuler(euler);
      m.compose(pos, quat, scale);
      shardMesh.setMatrixAt(i, m);

      // Wire from (p.x, ceilY, p.z) down to (p.x, p.y + halfH, p.z).
      const topY = p.y + halfShardH;
      const length = ceilY - topY;
      const midY = (ceilY + topY) / 2;
      const wirePos = new THREE.Vector3(p.x, midY, p.z);
      const wireScale = new THREE.Vector3(1, length, 1);
      const wireQuat = new THREE.Quaternion(); // identity — wires are axis-aligned
      m.compose(wirePos, wireQuat, wireScale);
      wireMesh.setMatrixAt(i, m);
    }
    shardMesh.count = placements.length;
    wireMesh.count = placements.length;
    shardMesh.instanceMatrix.needsUpdate = true;
    wireMesh.instanceMatrix.needsUpdate = true;
    shardMesh.frustumCulled = false;
    wireMesh.frustumCulled = false;
  }, [placements]);

  // Lerp emissive intensity toward target on hover state.
  useFrame(() => {
    const target = hover ? BUTTON.hoverMaxEmissive : 0;
    material.emissiveIntensity +=
      (target - material.emissiveIntensity) * BUTTON.hoverLerp;
  });

  if (!placements) return null;

  // Hitbox dimensions in world units: use label half-width + padding.
  const halfW = TUNING.buttonHalfWidth + BUTTON.hitPaddingX;
  const halfH = TUNING.buttonHalfHeight + BUTTON.hitPaddingY;

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(false);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    navigateWithFade(BUTTON.href);
  };

  return (
    <group>
      <instancedMesh
        ref={wireMeshRef}
        args={[wireGeometry, wireMaterial, placements.length]}
      />
      <instancedMesh
        ref={shardMeshRef}
        args={[geometry, material, placements.length]}
      />
      {/* Transparent hit-plane positioned at the button's z=0 center. Must
          be large enough to be easy to hover with a cursor. */}
      <mesh
        position={[0, TUNING.buttonCenterY, 0]}
        onPointerOver={onOver}
        onPointerOut={onOut}
        onClick={onClick}
        visible={false}
      >
        <planeGeometry args={[halfW * 2, halfH * 2]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

// -----------------------------------------------------------------------

function computeButtonPlacements(): Placement[] {
  const W = BUTTON.sampleWidth;
  const H = BUTTON.sampleHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Fit to ~82% of the sampling width.
  const target = W * 0.82;
  let fontSize = Math.floor(H * 0.82);
  for (let iter = 0; iter < 20; iter++) {
    ctx.font = `700 ${fontSize}px ${TUNING.fontFamily}`;
    if (ctx.measureText(BUTTON.label).width <= target) break;
    fontSize = Math.floor(fontSize * 0.96);
  }
  ctx.font = `700 ${fontSize}px ${TUNING.fontFamily}`;
  ctx.fillText(BUTTON.label, W / 2, H / 2);

  const { data } = ctx.getImageData(0, 0, W, H);
  const inside: number[] = [];
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] >= BUTTON.alphaThreshold) inside.push((i - 3) >> 2);
  }
  if (inside.length === 0) return [];

  // Derive halfH from the sampling canvas aspect so the text preserves
  // its drawn proportions. TUNING.buttonHalfHeight is used separately for
  // the plaque-knockout region in sampling.ts.
  const halfW = TUNING.buttonHalfWidth;
  const halfH = halfW / (W / H);
  const camZ = TUNING.cameraZ;

  const rand = mulberry32(0xb0a7b07);
  const out: Placement[] = new Array(BUTTON.shardCount);

  for (let i = 0; i < BUTTON.shardCount; i++) {
    const pick = inside[(rand() * inside.length) | 0];
    const px = pick % W;
    const py = (pick / W) | 0;
    const nx = (px / W) * 2 - 1;
    const ny = -((py / H) * 2 - 1);

    // Pixel projects onto the z=0 plane at (nx*halfW, ny*halfH + centerY).
    const x0 = nx * halfW;
    const y0 = ny * halfH + TUNING.buttonCenterY;

    const u = rand() * 2 - 1;
    const biased = Math.sign(u) * Math.pow(Math.abs(u), BUTTON.depthBias);
    const dz = biased * BUTTON.cloudDepth;

    // Anamorphic ratio so each shard sits on the viewing ray from
    // (0, 0, camZ) through (x0, y0, 0). Same trick as the main cloud.
    const ratio = (camZ - dz) / camZ;
    const x = x0 * ratio;
    const y = y0 * ratio;

    const yaw = (rand() * 2 - 1) * BUTTON.yawJitter;
    const tilt = (rand() * 2 - 1) * BUTTON.tiltJitter;

    out[i] = { x, y, z: dz, yaw, tilt };
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
