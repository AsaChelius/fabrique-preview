"use client";

import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import {
  getMode,
  onModeChange,
  setAboutMode,
  type ShowcaseMode,
} from "./showcase-bus";
import { SHOWCASE_LAYOUT } from "./showcase-targets";
import { setCursorHover } from "./cursor-bus";
import { TUNING } from "./tuning";
import type { Placement } from "./placements";
import { useSculpturePalette } from "./palette";
import { SOUND_ASSETS, playSample, preloadSample, unlockAudio } from "@/lib/sound";

const ABOUT = {
  label: "ABOUT US",
  sampleWidth: 1200,
  sampleHeight: 280,
  alphaThreshold: 145,
  shardCount: 1450,
  halfWidth: 1.28,
  targetY: SHOWCASE_LAYOUT.centerY + SHOWCASE_LAYOUT.cardH / 2 + 0.88,
  sourceY: TUNING.buttonCenterY - 0.04,
  localCeilingY: SHOWCASE_LAYOUT.centerY + SHOWCASE_LAYOUT.cardH / 2 + 1.38,
  shardHeight: 0.044,
  shardWidth: 0.018,
  shardThickness: 0.0018,
  cloudDepth: 0.32,
  depthBias: 2.2,
  yawJitter: 0.18,
  tiltJitter: 0.04,
  morphLerp: 0.075,
  opacityLerp: 0.065,
  hoverLerp: 0.16,
  hoverEmissive: 0.9,
  hitPaddingX: 0.25,
  hitPaddingY: 0.2,
  wireRadius: 0.00045,
  wireOpacity: 0.48,
} as const;

export function AboutUsMetalButton() {
  const [mode, setMode] = useState<ShowcaseMode>(() => getMode());
  const [hover, setHover] = useState(false);
  const [targetPlacements, setTargetPlacements] = useState<Placement[] | null>(
    null,
  );
  const [sourcePlacements, setSourcePlacements] = useState<Placement[] | null>(
    null,
  );
  const palette = useSculpturePalette();

  useEffect(() => onModeChange((m) => setMode(m)), []);
  useEffect(() => {
    preloadSample(SOUND_ASSETS.galleryHover);
    preloadSample(SOUND_ASSETS.routeSwell);
  }, []);

  useLayoutEffect(() => {
    let cancelled = false;
    const run = () => {
      const target = computeAboutPlacements(ABOUT.targetY);
      const source = computeAboutPlacements(ABOUT.sourceY);
      if (!cancelled) {
        setTargetPlacements(target);
        setSourcePlacements(source);
      }
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

  const shardGeometry = useMemo(
    () =>
      new THREE.BoxGeometry(
        ABOUT.shardWidth,
        ABOUT.shardHeight,
        ABOUT.shardThickness,
      ),
    [],
  );
  const wireGeometry = useMemo(
    () =>
      new THREE.CylinderGeometry(
        ABOUT.wireRadius,
        ABOUT.wireRadius,
        1,
        5,
        1,
        false,
      ),
    [],
  );
  const shardMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(palette.projectsBase),
        metalness: 1,
        roughness: 0.28,
        transparent: true,
        opacity: 0,
        emissive: new THREE.Color(palette.projectsEmissive),
        emissiveIntensity: 0,
        envMapIntensity: TUNING.envMapIntensity,
      }),
    // Mutated in useFrame so the instanced mesh keeps its matrices.
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const wireMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(palette.projectsWire),
        metalness: 0.1,
        roughness: 0.8,
        transparent: true,
        opacity: 0,
      }),
    // Mutated in useFrame.
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const targetBase = useMemo(
    () => new THREE.Color(palette.projectsBase),
    [palette.projectsBase],
  );
  const targetWire = useMemo(
    () => new THREE.Color(palette.projectsWire),
    [palette.projectsWire],
  );
  const targetEmissive = useMemo(
    () => new THREE.Color(palette.projectsEmissive),
    [palette.projectsEmissive],
  );

  const shardRef = useRef<THREE.InstancedMesh>(null);
  const wireRef = useRef<THREE.InstancedMesh>(null);
  const currentPos = useRef<Float32Array | null>(null);
  const morph = useRef(0);
  const opacity = useRef(0);

  const baseQuats = useMemo<Float32Array | null>(() => {
    if (!targetPlacements) return null;
    const arr = new Float32Array(targetPlacements.length * 4);
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < targetPlacements.length; i++) {
      const p = targetPlacements[i];
      e.set(p.tilt, p.yaw, 0, "YXZ");
      q.setFromEuler(e);
      arr[i * 4] = q.x;
      arr[i * 4 + 1] = q.y;
      arr[i * 4 + 2] = q.z;
      arr[i * 4 + 3] = q.w;
    }
    return arr;
  }, [targetPlacements]);

  useLayoutEffect(() => {
    if (!sourcePlacements) return;
    const N = sourcePlacements.length;
    const buf = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      buf[i * 3] = sourcePlacements[i].x;
      buf[i * 3 + 1] = sourcePlacements[i].y;
      buf[i * 3 + 2] = sourcePlacements[i].z;
    }
    currentPos.current = buf;
    if (shardRef.current) {
      shardRef.current.count = N;
      shardRef.current.frustumCulled = false;
    }
    if (wireRef.current) {
      wireRef.current.count = N;
      wireRef.current.frustumCulled = false;
    }
  }, [sourcePlacements]);

  useFrame(() => {
    const cur = currentPos.current;
    const shardMesh = shardRef.current;
    const wireMesh = wireRef.current;
    if (
      !targetPlacements ||
      !sourcePlacements ||
      !baseQuats ||
      !cur ||
      !shardMesh ||
      !wireMesh
    ) {
      return;
    }

    const active = mode === "showcase";
    const targetMorph = active ? 1 : 0;
    morph.current += (targetMorph - morph.current) * ABOUT.morphLerp;
    opacity.current += (targetMorph - opacity.current) * ABOUT.opacityLerp;

    const visibleOpacity = opacity.current;
    shardMaterial.color.lerp(targetBase, TUNING.paletteLerp);
    shardMaterial.emissive.lerp(targetEmissive, TUNING.paletteLerp);
    shardMaterial.opacity = visibleOpacity;
    shardMaterial.emissiveIntensity +=
      ((hover && active ? ABOUT.hoverEmissive : 0) -
        shardMaterial.emissiveIntensity) *
      ABOUT.hoverLerp;
    wireMaterial.color.lerp(targetWire, TUNING.paletteLerp);
    wireMaterial.opacity = visibleOpacity * ABOUT.wireOpacity;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const wirePos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const wireQ = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);
    const halfShardH = ABOUT.shardHeight / 2;

    for (let i = 0; i < targetPlacements.length; i++) {
      const i3 = i * 3;
      const source = sourcePlacements[i];
      const target = targetPlacements[i];
      const tx = source.x + (target.x - source.x) * morph.current;
      const ty = source.y + (target.y - source.y) * morph.current;
      const tz = source.z + (target.z - source.z) * morph.current;

      cur[i3] += (tx - cur[i3]) * 0.18;
      cur[i3 + 1] += (ty - cur[i3 + 1]) * 0.18;
      cur[i3 + 2] += (tz - cur[i3 + 2]) * 0.18;

      const i4 = i * 4;
      q.set(baseQuats[i4], baseQuats[i4 + 1], baseQuats[i4 + 2], baseQuats[i4 + 3]);
      pos.set(cur[i3], cur[i3 + 1], cur[i3 + 2]);
      m.compose(pos, q, scale);
      shardMesh.setMatrixAt(i, m);

      const topY = cur[i3 + 1] + halfShardH;
      const wireLen = Math.max(0.001, ABOUT.localCeilingY - topY);
      wirePos.set(cur[i3], topY + wireLen / 2, cur[i3 + 2]);
      m.compose(wirePos, wireQ, scale.set(1, wireLen, 1));
      wireMesh.setMatrixAt(i, m);
      scale.set(1, 1, 1);
    }

    shardMesh.instanceMatrix.needsUpdate = true;
    wireMesh.instanceMatrix.needsUpdate = true;
  });

  if (!targetPlacements) return null;

  const hitW = ABOUT.halfWidth * 2 + ABOUT.hitPaddingX * 2;
  const hitH =
    ABOUT.halfWidth / (ABOUT.sampleWidth / ABOUT.sampleHeight) * 2 +
    ABOUT.hitPaddingY * 2;

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(true);
    setCursorHover(true);
    playSample(SOUND_ASSETS.galleryHover, 0.1, 0, undefined, {
      reverbSend: 0.025,
    });
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(false);
    setCursorHover(false);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    unlockAudio();
    playSample(SOUND_ASSETS.routeSwell, 0.11, 0, 1.1, { reverbSend: 0.08 });
    setAboutMode();
  };

  return (
    <group>
      <instancedMesh
        ref={wireRef}
        args={[wireGeometry, wireMaterial, targetPlacements.length]}
      />
      <instancedMesh
        ref={shardRef}
        args={[shardGeometry, shardMaterial, targetPlacements.length]}
      />
      {mode === "showcase" ? (
        <mesh
          position={[0, ABOUT.targetY, SHOWCASE_LAYOUT.centerZ]}
          onPointerOver={onOver}
          onPointerOut={onOut}
          onClick={onClick}
          visible={false}
        >
          <planeGeometry args={[hitW, hitH]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

function computeAboutPlacements(centerY: number): Placement[] {
  const W = ABOUT.sampleWidth;
  const H = ABOUT.sampleHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];

  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 9;
  ctx.strokeStyle = "#000";
  ctx.strokeRect(W * 0.1, H * 0.22, W * 0.8, H * 0.56);

  const target = W * 0.66;
  let fontSize = Math.floor(H * 0.34);
  for (let iter = 0; iter < 20; iter++) {
    ctx.font = `700 ${fontSize}px ${TUNING.fontFamily}`;
    if (ctx.measureText(ABOUT.label).width <= target) break;
    fontSize = Math.floor(fontSize * 0.96);
  }
  ctx.font = `700 ${fontSize}px ${TUNING.fontFamily}`;
  ctx.fillText(ABOUT.label, W / 2, H / 2);

  const { data } = ctx.getImageData(0, 0, W, H);
  const inside: number[] = [];
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] >= ABOUT.alphaThreshold) inside.push((i - 3) >> 2);
  }
  if (inside.length === 0) return [];

  const halfW = ABOUT.halfWidth;
  const halfH = halfW / (W / H);
  const camZ = TUNING.cameraZ;
  const rand = mulberry32(0xab0075);
  const out: Placement[] = new Array(ABOUT.shardCount);

  for (let i = 0; i < ABOUT.shardCount; i++) {
    const pick = inside[(rand() * inside.length) | 0];
    const px = pick % W;
    const py = (pick / W) | 0;
    const nx = (px / W) * 2 - 1;
    const ny = -((py / H) * 2 - 1);
    const x0 = nx * halfW;
    const y0 = ny * halfH + centerY;
    const u = rand() * 2 - 1;
    const dz =
      Math.sign(u) * Math.pow(Math.abs(u), ABOUT.depthBias) * ABOUT.cloudDepth;
    const ratio = (camZ - dz) / camZ;
    out[i] = {
      x: x0 * ratio,
      y: y0 * ratio,
      z: dz,
      yaw: (rand() * 2 - 1) * ABOUT.yawJitter,
      tilt: (rand() * 2 - 1) * ABOUT.tiltJitter,
    };
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
