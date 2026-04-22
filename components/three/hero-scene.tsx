"use client";

/**
 * FABRIQUE hero — R3F WITHOUT a physics engine.
 *
 * We were fighting a persistent "Maximum update depth exceeded" loop
 * originating inside @react-three/rapier on this route only (coal page
 * works fine). Removing Rapier from the hero kills both the error AND
 * the black-frame flicker it was causing.
 *
 * Replacement physics:
 *  - Each letter has a home slot in the FABRIQUE formation.
 *  - Per-frame PD spring (position + damping) pulls the letter toward home.
 *  - Idle wave: sin(omega*t - i*phase) adds a gentle Y nudge + emissive
 *    pulse that travels across the wordmark.
 *  - Drag: on pointerdown, record offset; on pointermove, follow the
 *    cursor's z=0 plane projection; on pointerup, convert cursor velocity
 *    into a release impulse.
 *
 * No collisions, no gravity engine — just math per letter. Fast and stable.
 */

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Text3D, Center, Stars } from "@react-three/drei";
// Postprocessing removed entirely — Bloom / Vignette / EffectComposer's
// extra render passes were the remaining likely source of the black-frame
// flicker on this route. Glow now comes from per-material emissive +
// `toneMapped: false` + the blue back-face outline on each letter.
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { playSound, type SoundName } from "@/lib/sound";

const WORD = "FABRIQUE";
const LETTERS = WORD.split("");

const TUNING = {
  letterDepth: 0.5,
  letterSize: 1.25,
  letterSpacing: 1.55,
  homeY: 1.9,

  // PD spring back to home
  springK: 28,
  springC: 6,

  // Drag spring (even stronger, user always wins)
  dragK: 90,
  dragC: 12,

  // Idle wave — slower per user feedback.
  waveOmega: 0.65,
  wavePhasePerLetter: (Math.PI * 2) / 8,
  waveYAmp: 0.1,
  // Emissive wave — tuned so letters have presence without going back to
  // the old chubby-blue look. Base ~= average interior glow.
  waveEmissiveAmp: 0.4,
  waveEmissiveBase: 1.4,

  // Collision: each letter treated as a sphere of this radius for pair-pair
  // contact resolution. Tuned so letters touch visually but don't overlap.
  collisionRadius: 0.72,
  collisionDamping: 0.55,
  /** Minimum ms between clack SFX plays per letter pair. */
  clackCooldownMs: 180,
  /** Minimum closing speed to trigger a clack — filters out grazing contacts. */
  clackMinSpeed: 1.3,
  /** How much the GRABBED letter shares of a collision's push-apart (vs. the
      non-grabbed one taking all of it). A bit >0 so the user can't drag a
      letter fully through another — it gets resistance at the contact edge. */
  grabbedCollisionShare: 0.25,

  // Playfield bounds — walls so letters can't drift off-screen on big throws.
  boundsX: 6.5,
  boundsYMin: -3.2,
  boundsYMax: 3.6,
  boundsZ: 2.2,
  boundsBounce: 0.5,

  // Release: convert cursor velocity into momentum that decays.
  releaseVelMul: 0.6,
  // Idle natural jitter in velocity — tiny, so letters always feel alive.
  jitterVelAmp: 0.06,
} as const;

function homeXFor(i: number, total: number) {
  return (i - (total - 1) / 2) * TUNING.letterSpacing;
}

type LetterState = {
  pos: THREE.Vector3;      // current position
  vel: THREE.Vector3;      // current velocity
  home: THREE.Vector3;     // home slot
  index: number;
  grabbed: boolean;
  grabOffset: THREE.Vector3; // captured at grab time (world-cursor - pos)
  /** Collision radius (per-object). Letters use TUNING.collisionRadius,
      orbs use their own per-shape radius. */
  radius: number;
  /** Identifies whether this physics entity is a letter or an orb, so the
      idle wave can skip orbs (they pulse on their own). */
  kind: "letter" | "orb";
  /** Which synth voice to play on collision impact. Letters → "clack";
      orbs → shape-specific per SHAPE_SOUNDS. */
  soundName: SoundName;
};

/** Map each orb shape to its impact sound. */
const SHAPE_SOUNDS: Record<OrbShape, SoundName> = {
  sphere: "orb-pop",
  cube:   "orb-knock",
  octa:   "orb-ping",
  icosa:  "orb-chime",
  torus:  "orb-wobble",
  dodec:  "orb-thump",
};

/** Total letters — orbs index AFTER these in the shared stateRefs array. */
const MAX_LETTERS = 8;

type OrbShape = "sphere" | "cube" | "octa" | "icosa" | "torus" | "dodec";

/** Decorative physics orbs scattered around the letter formation. Same
    draggable + spring-back + collision system as letters. Collisions are
    per-radius so differently-sized shapes resolve cleanly. */
const ORBS: Array<{
  home: [number, number, number];
  shape: OrbShape;
  color: string;
  radius: number;
}> = [
  { home: [-5.4,  2.8, -1.2], shape: "sphere", color: "#ff40a0", radius: 0.42 },
  { home: [ 5.4,  2.8,  1.2], shape: "octa",   color: "#40ffe0", radius: 0.48 },
  { home: [-4.8, -0.8,  1.5], shape: "icosa",  color: "#ffb040", radius: 0.4  },
  { home: [ 4.8, -0.8, -1.5], shape: "torus",  color: "#a040ff", radius: 0.52 },
  { home: [ 0,    3.3,  2.0], shape: "cube",   color: "#40a0ff", radius: 0.4  },
  { home: [ 0,   -1.4, -1.8], shape: "dodec",  color: "#ff6060", radius: 0.46 },
];

type DragHandle = {
  state: LetterState;
};

const HERO_DPR: [number, number] = [1, 2];
const HERO_CAMERA = { position: [0, 2.4, 9.5] as [number, number, number], fov: 48 };
const HERO_GL = {
  antialias: true,
  alpha: false,
  powerPreference: "high-performance" as const,
  stencil: false,
};
const HERO_BG_ARGS: [string] = ["#06080f"];
const HERO_ON_CREATED = ({ camera }: { camera: THREE.Camera }) => {
  camera.lookAt(0, 1.4, 0);
};

/** Single letter — group position is controlled manually each frame. */
function Letter({
  char,
  index,
  total,
  stateRefs,
  materialRefs,
  onGrab,
}: {
  char: string;
  index: number;
  total: number;
  stateRefs: React.MutableRefObject<Array<LetterState | null>>;
  materialRefs: React.MutableRefObject<Array<THREE.MeshPhysicalMaterial | null>>;
  onGrab: (state: LetterState, eventPoint: THREE.Vector3) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);

  // Build once.
  const state = useMemo<LetterState>(() => {
    const home = new THREE.Vector3(homeXFor(index, total), TUNING.homeY, 0);
    return {
      pos: home.clone(),
      vel: new THREE.Vector3(),
      home,
      index,
      grabbed: false,
      grabOffset: new THREE.Vector3(),
      radius: TUNING.collisionRadius,
      kind: "letter" as const,
      soundName: "clack" as SoundName,
    };
  }, [index, total]);

  useEffect(() => {
    stateRefs.current[index] = state;
    return () => {
      stateRefs.current[index] = null;
      materialRefs.current[index] = null;
    };
  }, [stateRefs, materialRefs, index, state]);

  return (
    <group
      ref={groupRef}
      position={[state.home.x, state.home.y, state.home.z]}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onGrab(state, e.point);
        playSound("thud", 0.22);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        document.body.style.cursor = "grab";
      }}
      onPointerOut={() => {
        if (document.body.style.cursor === "grab") document.body.style.cursor = "";
      }}
    >
      {/* Inner useFrame mutates group.position directly each tick (see Scene). */}
      <LetterMeshes
        char={char}
        index={index}
        groupRef={groupRef}
        state={state}
        materialRefs={materialRefs}
      />
    </group>
  );
}

/** Split out so useFrame lives inside each letter — updates its own group. */
function LetterMeshes({
  char,
  index,
  groupRef,
  state,
  materialRefs,
}: {
  char: string;
  index: number;
  groupRef: React.RefObject<THREE.Group | null>;
  state: LetterState;
  materialRefs: React.MutableRefObject<Array<THREE.MeshPhysicalMaterial | null>>;
}) {
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.copy(state.pos);
    }
  });
  return (
    <Center>
      {/* OUTLINE pass — identical Text3D slightly scaled up with
          `side: BackSide`. Only the back faces render, which from the
          camera's view pokes out around the silhouette of the smaller
          foreground letter → creates a clean blue outline. */}
      <Text3D
        font="/fonts/helvetiker_bold.typeface.json"
        size={TUNING.letterSize * 1.04}
        height={TUNING.letterDepth * 1.04}
        curveSegments={8}
        bevelEnabled
        bevelSize={0.05}
        bevelThickness={0.06}
        bevelSegments={3}
      >
        {char}
        <meshBasicMaterial
          color="#5aa0ff"
          side={THREE.BackSide}
          toneMapped={false}
        />
      </Text3D>
      {/* FILL pass — dark interior with subtle emissive pulse (wave). */}
      <Text3D
        font="/fonts/helvetiker_bold.typeface.json"
        size={TUNING.letterSize}
        height={TUNING.letterDepth}
        curveSegments={10}
        bevelEnabled
        bevelSize={0.045}
        bevelThickness={0.055}
        bevelSegments={4}
      >
        {char}
        <meshPhysicalMaterial
          ref={(m) => {
            materialRefs.current[index] =
              (m as unknown as THREE.MeshPhysicalMaterial) ?? null;
          }}
          color="#020408"
          metalness={0.55}
          roughness={0.28}
          clearcoat={0.8}
          clearcoatRoughness={0.2}
          reflectivity={0.9}
          envMapIntensity={0.6}
          emissive="#1a3360"
          emissiveIntensity={TUNING.waveEmissiveBase * 0.55}
          toneMapped={false}
        />
      </Text3D>
    </Center>
  );
}

/** Decorative-but-draggable orb. Registers its state into stateRefs at
    index MAX_LETTERS + orbIndex so the shared LetterController can spring/
    collide it exactly like a letter. Each orb gets a distinct emissive
    color + shape + self-rotation so they feel like interactive trinkets. */
function Orb({
  orbIndex,
  stateRefs,
  onGrab,
}: {
  orbIndex: number;
  stateRefs: React.MutableRefObject<Array<LetterState | null>>;
  onGrab: (state: LetterState, eventPoint: THREE.Vector3) => void;
}) {
  const { home, shape, color, radius } = ORBS[orbIndex];
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const state = useMemo<LetterState>(() => {
    const h = new THREE.Vector3(home[0], home[1], home[2]);
    return {
      pos: h.clone(),
      vel: new THREE.Vector3(),
      home: h,
      index: MAX_LETTERS + orbIndex,
      grabbed: false,
      grabOffset: new THREE.Vector3(),
      radius,
      kind: "orb" as const,
      soundName: SHAPE_SOUNDS[shape],
    };
  }, [home, orbIndex, radius, shape]);

  useEffect(() => {
    stateRefs.current[MAX_LETTERS + orbIndex] = state;
    return () => {
      stateRefs.current[MAX_LETTERS + orbIndex] = null;
    };
  }, [stateRefs, orbIndex, state]);

  // Per-orb geometry.
  const geo = useMemo(() => {
    switch (shape) {
      case "sphere": return <sphereGeometry args={[radius, 22, 22]} />;
      case "cube":   return <boxGeometry args={[radius * 1.3, radius * 1.3, radius * 1.3]} />;
      case "octa":   return <octahedronGeometry args={[radius * 1.15, 0]} />;
      case "icosa":  return <icosahedronGeometry args={[radius * 1.1, 0]} />;
      case "torus":  return <torusGeometry args={[radius * 0.8, radius * 0.28, 14, 28]} />;
      case "dodec":  return <dodecahedronGeometry args={[radius * 1.05, 0]} />;
    }
  }, [shape, radius]);

  // Self-rotation + position sync with physics state.
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.position.copy(state.pos);
    }
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.35;
      meshRef.current.rotation.y += delta * 0.5;
    }
  });

  return (
    <group
      ref={groupRef}
      position={home}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onGrab(state, e.point);
        playSound("thud", 0.2);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        document.body.style.cursor = "grab";
      }}
      onPointerOut={() => {
        if (document.body.style.cursor === "grab") document.body.style.cursor = "";
      }}
    >
      <mesh ref={meshRef}>
        {geo}
        <meshPhysicalMaterial
          color={color}
          metalness={0.4}
          roughness={0.18}
          clearcoat={1}
          clearcoatRoughness={0.08}
          emissive={color}
          emissiveIntensity={1.1}
          toneMapped={false}
        />
      </mesh>
      {/* Soft halo — bigger additive-blended sphere for glow. */}
      <mesh scale={1.6}>
        <sphereGeometry args={[radius, 12, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** Master controller — runs spring/wave/drag across every letter each frame. */
function LetterController({
  stateRefs,
  materialRefs,
  dragRef,
  cursorVelRef,
}: {
  stateRefs: React.MutableRefObject<Array<LetterState | null>>;
  materialRefs: React.MutableRefObject<Array<THREE.MeshPhysicalMaterial | null>>;
  dragRef: React.MutableRefObject<DragHandle | null>;
  cursorVelRef: React.MutableRefObject<THREE.Vector3>;
}) {
  const { raycaster, pointer, camera } = useThree();
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const worldCursor = useRef(new THREE.Vector3());
  const prevCursor = useRef(new THREE.Vector3());
  const tmpForce = useRef(new THREE.Vector3());
  /** Per-pair cooldown for clack SFX. Keys like "i-j" (i<j). */
  const lastClackAt = useRef<Map<string, number>>(new Map());

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30);

    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(dragPlane.current, worldCursor.current);
    if (hit) {
      cursorVelRef.current
        .subVectors(worldCursor.current, prevCursor.current)
        .divideScalar(Math.max(delta, 0.016));
      prevCursor.current.copy(worldCursor.current);
    }

    const tSec = performance.now() * 0.001;
    const wavePhaseBase = tSec * TUNING.waveOmega;

    for (let i = 0; i < stateRefs.current.length; i++) {
      const s = stateRefs.current[i];
      if (!s) continue;

      const isGrabbed = !!dragRef.current && dragRef.current.state === s;
      const phase = wavePhaseBase - i * TUNING.wavePhasePerLetter;
      const wave = Math.sin(phase);

      // --- Emissive pulse (wave) — letters only; orbs pulse on their own. ---
      if (s.kind === "letter") {
        const mat = materialRefs.current[i];
        if (mat) {
          mat.emissiveIntensity =
            TUNING.waveEmissiveBase + wave * TUNING.waveEmissiveAmp;
        }
      }

      if (isGrabbed && hit) {
        // Drag spring: pull body toward (cursor - offset)
        const tgtX = worldCursor.current.x - s.grabOffset.x;
        const tgtY = worldCursor.current.y - s.grabOffset.y;
        const tgtZ = 0;
        const fx = (tgtX - s.pos.x) * TUNING.dragK - s.vel.x * TUNING.dragC;
        const fy = (tgtY - s.pos.y) * TUNING.dragK - s.vel.y * TUNING.dragC;
        const fz = (tgtZ - s.pos.z) * TUNING.dragK - s.vel.z * TUNING.dragC;
        s.vel.x += fx * delta;
        s.vel.y += fy * delta;
        s.vel.z += fz * delta;
      } else {
        // Home spring. Letters add a wave-driven Y bob on top. Orbs drift
        // with pure spring (their pulse comes from material, not motion).
        const waveY = s.kind === "letter" ? wave * TUNING.waveYAmp : 0;
        const tgtY = s.home.y + waveY;
        const fx = (s.home.x - s.pos.x) * TUNING.springK - s.vel.x * TUNING.springC;
        const fy = (tgtY - s.pos.y) * TUNING.springK - s.vel.y * TUNING.springC;
        const fz = (s.home.z - s.pos.z) * TUNING.springK - s.vel.z * TUNING.springC;
        tmpForce.current.set(fx, fy, fz);
        s.vel.x += tmpForce.current.x * delta;
        s.vel.y += tmpForce.current.y * delta;
        s.vel.z += tmpForce.current.z * delta;

        // Tiny idle jitter so things breathe. Not while something's grabbed.
        if (!dragRef.current) {
          s.vel.x += (Math.random() - 0.5) * TUNING.jitterVelAmp * delta * 2;
          s.vel.y += (Math.random() - 0.5) * TUNING.jitterVelAmp * delta * 2;
        }
      }

      // Integrate position from velocity.
      s.pos.x += s.vel.x * delta;
      s.pos.y += s.vel.y * delta;
      s.pos.z += s.vel.z * delta;

      // Global damping to keep things from oscillating forever.
      s.vel.multiplyScalar(1 - Math.min(1, 0.5 * delta));

      // --- BOUNDS: clamp + reflect velocity ---
      if (s.pos.x > TUNING.boundsX) {
        s.pos.x = TUNING.boundsX;
        s.vel.x = -Math.abs(s.vel.x) * TUNING.boundsBounce;
      } else if (s.pos.x < -TUNING.boundsX) {
        s.pos.x = -TUNING.boundsX;
        s.vel.x = Math.abs(s.vel.x) * TUNING.boundsBounce;
      }
      if (s.pos.y > TUNING.boundsYMax) {
        s.pos.y = TUNING.boundsYMax;
        s.vel.y = -Math.abs(s.vel.y) * TUNING.boundsBounce;
      } else if (s.pos.y < TUNING.boundsYMin) {
        s.pos.y = TUNING.boundsYMin;
        s.vel.y = Math.abs(s.vel.y) * TUNING.boundsBounce;
      }
      if (s.pos.z > TUNING.boundsZ) {
        s.pos.z = TUNING.boundsZ;
        s.vel.z = -Math.abs(s.vel.z) * TUNING.boundsBounce;
      } else if (s.pos.z < -TUNING.boundsZ) {
        s.pos.z = -TUNING.boundsZ;
        s.vel.z = Math.abs(s.vel.z) * TUNING.boundsBounce;
      }
    }

    // --- PAIRWISE COLLISIONS --- O(N²) but N ~= 14 (8 letters + 6 orbs) →
    // 91 pair checks, fine. Uses per-object radius so letters and orbs of
    // different sizes resolve together.
    for (let i = 0; i < stateRefs.current.length; i++) {
      const a = stateRefs.current[i];
      if (!a) continue;
      for (let j = i + 1; j < stateRefs.current.length; j++) {
        const b = stateRefs.current[j];
        if (!b) continue;
        const minDist = a.radius + b.radius;
        const minDistSq = minDist * minDist;
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dz = b.pos.z - a.pos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= minDistSq) continue;
        const dist = Math.sqrt(distSq) || 0.0001;
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        // Push apart. The grabbed letter takes a small share (via
        // grabbedCollisionShare) so the user can't plow it cleanly through
        // its neighbors — gets visible resistance at the edge.
        const aGrabbed = !!dragRef.current && dragRef.current.state === a;
        const bGrabbed = !!dragRef.current && dragRef.current.state === b;
        const aShare = bGrabbed
          ? 1 - TUNING.grabbedCollisionShare
          : aGrabbed
          ? TUNING.grabbedCollisionShare
          : 0.5;
        const bShare = 1 - aShare;
        a.pos.x -= nx * overlap * aShare;
        a.pos.y -= ny * overlap * aShare;
        a.pos.z -= nz * overlap * aShare;
        b.pos.x += nx * overlap * bShare;
        b.pos.y += ny * overlap * bShare;
        b.pos.z += nz * overlap * bShare;
        // Velocity along collision normal — equal-mass swap with damping.
        // Grabbed letter keeps its velocity (user drag always wins).
        const vaN = a.vel.x * nx + a.vel.y * ny + a.vel.z * nz;
        const vbN = b.vel.x * nx + b.vel.y * ny + b.vel.z * nz;
        const damp = TUNING.collisionDamping;
        if (!aGrabbed) {
          const newVaN = vbN * damp;
          a.vel.x += (newVaN - vaN) * nx;
          a.vel.y += (newVaN - vaN) * ny;
          a.vel.z += (newVaN - vaN) * nz;
        }
        if (!bGrabbed) {
          const newVbN = vaN * damp;
          b.vel.x += (newVbN - vbN) * nx;
          b.vel.y += (newVbN - vbN) * ny;
          b.vel.z += (newVbN - vbN) * nz;
        }
        // Impact sound — per-pair throttle + picks a shape-specific voice.
        // Priority: if either object is an orb, use that orb's soundName.
        // Letter-letter falls back to "clack". Orb-orb picks `a.soundName`.
        const closingSpeed = Math.abs(vaN - vbN);
        if (closingSpeed > TUNING.clackMinSpeed) {
          const key = `${i}-${j}`;
          const now = performance.now();
          const last = lastClackAt.current.get(key) ?? 0;
          if (now - last > TUNING.clackCooldownMs) {
            lastClackAt.current.set(key, now);
            const sound: SoundName =
              a.kind === "orb" ? a.soundName :
              b.kind === "orb" ? b.soundName :
              "clack";
            playSound(sound, Math.min(1, closingSpeed / 6));
          }
        }
      }
    }
  });
  return null;
}

/** Atmospheric shader backdrop — slow, deep-space color wash with a faint
    central swirl. Toned down from the earlier saturated rainbow so letters
    + stars remain the focus. */
function PsychedelicBackdrop() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
    }),
    [],
  );
  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });
  return (
    <mesh position={[0, 0, -16]}>
      <planeGeometry args={[80, 45]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uTime;
          varying vec2 vUv;

          void main() {
            vec2 uv = vUv - 0.5;
            float d = length(uv);

            float a = atan(uv.y, uv.x) + d * 1.8 + uTime * 0.12;
            vec2 w = vec2(cos(a), sin(a)) * d;

            // Cooler palette — blues & violets, low saturation.
            float b = sin(w.x * 3.5 + uTime * 0.32) * 0.5 + 0.5;
            float v = sin(w.y * 2.6 + uTime * 0.24 + 1.6) * 0.5 + 0.5;
            float c = sin((w.x + w.y) * 2.2 + uTime * 0.28 + 3.0) * 0.5 + 0.5;

            // Very dark base that only brightens slightly in the center.
            vec3 col = vec3(c * 0.06, v * 0.07, b * 0.14);
            float center = 1.0 - smoothstep(0.0, 0.55, d);
            col += vec3(0.025, 0.02, 0.05) * center;

            // Fade out entirely toward edges.
            col *= 1.0 - smoothstep(0.35, 0.85, d);
            // Pure deep-space floor.
            col += vec3(0.008, 0.01, 0.018);

            gl_FragColor = vec4(col, 1.0);
          }
        `}
        depthWrite={false}
      />
    </mesh>
  );
}

/** Black-hole-style vortex — particles spawn near the camera at large radii
    and spiral INWARD toward a bright distant singularity at the scene's
    center, gaining swirl as they approach. Gives a proper "being sucked
    in" accretion-disk vibe. Circular (no vertical squish). */
function VortexTunnel({ count = 320 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const halo1Ref = useRef<THREE.Mesh>(null);
  const halo2Ref = useRef<THREE.Mesh>(null);
  const params = useMemo(() => {
    const angles = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      angles[i] = Math.random() * Math.PI * 2;
      phases[i] = Math.random();
    }
    return { angles, phases };
  }, [count]);
  const positions = useMemo(() => new Float32Array(count * 3), [count]);

  /** Full cycle time (s) for a particle to spiral from edge → center. */
  const CYCLE = 9;
  /** Z depth at the start (near camera) vs end (deep center). */
  const NEAR_Z = 2;
  const FAR_Z = -28;
  const START_RADIUS = 8;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    const { angles, phases } = params;
    const attr = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const u = ((t / CYCLE) + phases[i]) % 1; // 0 = just spawned at edge; 1 = consumed at center
      const z = NEAR_Z + (FAR_Z - NEAR_Z) * u;
      const radius = START_RADIUS * Math.pow(1 - u, 2);
      const a = angles[i] + u * 5.5;
      arr[i * 3] = Math.cos(a) * radius;
      arr[i * 3 + 1] = Math.sin(a) * radius;
      arr[i * 3 + 2] = z;
    }
    attr.needsUpdate = true;

    // --- Singularity pulse ---
    // Core: subtle breathing + tiny fast flicker (0.95 – 1.15).
    const pulse = 1 + Math.sin(t * 1.4) * 0.08 + Math.sin(t * 7.2) * 0.04;
    const halo1 = 1 + Math.sin(t * 0.9 + 1.1) * 0.12;
    const halo2 = 1 + Math.sin(t * 0.6 + 2.4) * 0.18;
    if (coreRef.current) coreRef.current.scale.setScalar(pulse);
    if (halo1Ref.current) halo1Ref.current.scale.setScalar(halo1);
    if (halo2Ref.current) halo2Ref.current.scale.setScalar(halo2);
  });

  return (
    <group>
      {/* Particle stream */}
      <points ref={ref}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={count}
            array={positions}
            itemSize={3}
            args={[positions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.11}
          color="#c8d4ff"
          transparent
          opacity={0.85}
          sizeAttenuation
          depthWrite={false}
          toneMapped={false}
        />
      </points>

      {/* Singularity — no white-hot flash at the center. Real black holes
          appear BLACK at the event horizon. A pure-black core sphere sits
          in the middle (absorbs all incoming particles via depthWrite =
          true so they visibly get occluded as they reach the hole), with
          faint outer halos hinting at an accretion glow. */}
      <mesh ref={coreRef} position={[0, 0, FAR_Z + 1]}>
        <sphereGeometry args={[0.95, 24, 24]} />
        <meshBasicMaterial color="#000000" toneMapped={false} />
      </mesh>
      <mesh ref={halo1Ref} position={[0, 0, FAR_Z + 1]}>
        <sphereGeometry args={[2.1, 20, 20]} />
        <meshBasicMaterial
          color="#3060b8"
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={halo2Ref} position={[0, 0, FAR_Z + 1]}>
        <sphereGeometry args={[3.5, 20, 20]} />
        <meshBasicMaterial
          color="#1a2a80"
          transparent
          opacity={0.12}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0, FAR_Z + 1]}>
        <sphereGeometry args={[5.0, 20, 20]} />
        <meshBasicMaterial
          color="#101a50"
          transparent
          opacity={0.06}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** Drifting dust — subtle white specks floating around the letters to add
    a sense of volume + scale. Not on physics; purely decorative. */
function HeroDust({ count = 180 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 22;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 14;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 10 - 3;
    }
    return arr;
  }, [count]);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.012;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.035}
        color="#c8d4ff"
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

function Scene() {
  const stateRefs = useRef<Array<LetterState | null>>([]);
  const materialRefs = useRef<Array<THREE.MeshPhysicalMaterial | null>>([]);
  const dragRef = useRef<DragHandle | null>(null);
  const cursorVelRef = useRef(new THREE.Vector3());

  const handleGrab = (state: LetterState, eventPoint: THREE.Vector3) => {
    state.grabbed = true;
    state.grabOffset.set(
      eventPoint.x - state.pos.x,
      eventPoint.y - state.pos.y,
      0,
    );
    dragRef.current = { state };
    document.body.style.cursor = "grabbing";
  };

  useEffect(() => {
    const release = () => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.state.grabbed = false;
      // Throw with cursor velocity.
      const v = cursorVelRef.current;
      drag.state.vel.x += v.x * TUNING.releaseVelMul;
      drag.state.vel.y += v.y * TUNING.releaseVelMul;
      dragRef.current = null;
      document.body.style.cursor = "";
      playSound("whoosh", 0.25);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  return (
    <>
      {/* Darker-moodier ambient for contrast, so lights + reflections pop. */}
      <ambientLight intensity={0.28} />
      <hemisphereLight args={["#2a3a70", "#06070e", 0.55]} />
      {/* Magenta key from upper-right */}
      <directionalLight position={[6, 7, 4]} intensity={1.3} color="#ff80e0" />
      {/* Cyan rim from behind-left */}
      <directionalLight position={[-6, 3, -5]} intensity={1.1} color="#40d0ff" />
      {/* Warm under-glow */}
      <pointLight position={[0, 0.5, 3]} intensity={1.4} color="#ff6040" distance={10} />
      {/* Violet side accent */}
      <pointLight position={[-5, 2, 1]} intensity={0.9} color="#a040ff" distance={10} />
      {/* Soft fill at letter height */}
      <pointLight position={[0, 2, 3]} intensity={1.0} color="#7aa0ff" distance={7} />

      <fog attach="fog" args={["#060818", 12, 24]} />

      {/* Distant star field — thin backdrop. */}
      <Stars radius={80} depth={40} count={1200} factor={3} saturation={0} fade speed={0.3} />

      {/* Cool atmospheric color backdrop. */}
      <PsychedelicBackdrop />

      {/* Infinite vortex — particles fly from the distant center outward
          toward the camera, giving a wormhole / sinkhole depth illusion. */}
      <VortexTunnel count={260} />

      {/* Drifting dust motes around the letters. */}
      <HeroDust count={140} />

      {/* (No floor plane — removed so the scene reads as infinite space,
          no hard horizon split between top and bottom halves.) */}

      {LETTERS.map((char, i) => (
        <Letter
          key={`${char}-${i}`}
          char={char}
          index={i}
          total={LETTERS.length}
          stateRefs={stateRefs}
          materialRefs={materialRefs}
          onGrab={handleGrab}
        />
      ))}

      {/* Interactive orbs scattered around the letters — all draggable +
          collide with letters and each other. */}
      {ORBS.map((_, i) => (
        <Orb
          key={`orb-${i}`}
          orbIndex={i}
          stateRefs={stateRefs}
          onGrab={handleGrab}
        />
      ))}

      {/* Decorative orbiting rings far back — not physics, pure atmosphere. */}
      <OrbitingRing radius={8} tilt={Math.PI / 4}  color="#ff40a0" speed={0.08} />
      <OrbitingRing radius={10} tilt={-Math.PI / 5} color="#40ffe0" speed={-0.06} />
      <OrbitingRing radius={12} tilt={Math.PI / 6}  color="#a040ff" speed={0.04} />

      <LetterController
        stateRefs={stateRefs}
        materialRefs={materialRefs}
        dragRef={dragRef}
        cursorVelRef={cursorVelRef}
      />
    </>
  );
}

/** Slowly rotating ring floating in space behind the scene — decorative. */
function OrbitingRing({
  radius,
  tilt,
  color,
  speed,
}: {
  radius: number;
  tilt: number;
  color: string;
  speed: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * speed;
  });
  return (
    <mesh ref={ref} rotation={[tilt, 0, 0]} position={[0, 1, -5]}>
      <torusGeometry args={[radius, 0.04, 8, 96]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.22}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Subtle mouse-parallax on the camera — moves slightly with pointer for a
    sense of depth without breaking the framing. */
function CameraParallax() {
  const { camera, pointer } = useThree();
  const base = useRef<THREE.Vector3 | null>(null);
  /** Zoom-into-black-hole state. Snapshots the camera's current position
      at the moment the zoom starts so the dive is continuous from wherever
      parallax left the camera — no jump/reposition before the zoom. */
  const zoomRef = useRef<{
    active: boolean;
    startedAt: number;
    startPos: THREE.Vector3 | null;
  }>({
    active: false,
    startedAt: 0,
    startPos: null,
  });
  useEffect(() => {
    const onZoom = () => {
      zoomRef.current = {
        active: true,
        startedAt: performance.now(),
        startPos: camera.position.clone(),
      };
    };
    window.addEventListener("vortex-zoom", onZoom);
    return () => window.removeEventListener("vortex-zoom", onZoom);
  }, [camera]);
  useFrame((_, delta) => {
    if (!base.current) base.current = camera.position.clone();

    if (zoomRef.current.active && zoomRef.current.startPos) {
      // Camera dive into the singularity — 1.4s accelerating pull (cubic
      // ease-in). Position is lerped from the snapshotted start (wherever
      // parallax had the camera) directly to the singularity — no jump.
      const elapsed = (performance.now() - zoomRef.current.startedAt) / 1000;
      const t = Math.min(elapsed / 1.4, 1);
      const eased = t * t * t;
      const start = zoomRef.current.startPos;
      const endX = 0;
      const endY = 0.3;
      const endZ = -27;
      camera.position.x = THREE.MathUtils.lerp(start.x, endX, eased);
      camera.position.y = THREE.MathUtils.lerp(start.y, endY, eased);
      camera.position.z = THREE.MathUtils.lerp(start.z, endZ, eased);
      camera.lookAt(0, 0.3, -28);
      return;
    }

    const tx = base.current.x + pointer.x * 0.6;
    const ty = base.current.y + pointer.y * 0.35;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 2.5, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 2.5, delta);
    camera.lookAt(0, 1.4, 0);
  });
  return null;
}

export function HeroScene() {
  return (
    <Canvas
      dpr={HERO_DPR}
      camera={HERO_CAMERA}
      gl={HERO_GL}
      onCreated={HERO_ON_CREATED}
    >
      <Suspense fallback={null}>
        <color attach="background" args={HERO_BG_ARGS} />
        <Scene />
        <CameraParallax />
      </Suspense>
    </Canvas>
  );
}
