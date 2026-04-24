"use client";

/**
 * "Coal" route — space scene.
 *
 * Zoomed out, bounded tight so nothing escapes the viewport. Cursor is
 * PASSIVE (no force field pushing things around) — drag explicitly with
 * press-and-hold to move anything.
 *
 * Planets each have a distinct shape: striped gas giant, wireframe grid
 * planet, crystal cluster, volcano world, plasma core.
 *
 * Click a planet → CRACK OPEN: outer shell expands + fades while the inner
 * core grows brighter + bigger. Modal fades in simultaneously (its backdrop
 * is translucent so the crack is visible behind).
 */

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Stars, OrbitControls, Html, Text3D } from "@react-three/drei";
import { useRouter } from "next/navigation";
import {
  Physics,
  RigidBody,
  CuboidCollider,
  type RapierRigidBody,
} from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { playSound } from "@/lib/sound";
import type { Project } from "@/lib/projects";

const BODY_DYNAMIC = 0;
const BODY_KINEMATIC_POSITION = 2;

// Stable tuples — avoid per-render array allocations that fed prop-driven
// effect loops (see hero-scene.tsx notes).
const GRAVITY_ZERO: [number, number, number] = [0, 0, 0];

const TUNING = {
  // Arena bounds (keeps everything inside the camera frustum).
  bx: 6.8,
  by: 4.0,
  bz: 3.2,

  // Planets (spread across the view)
  planetArcRadius: 4.2,
  planetArcYaw: Math.PI * 0.58,
  planetY: 0.4,

  // Debris
  debrisCount: 22,
  debrisRadiusMin: 0.16,
  debrisRadiusMax: 0.38,
  debrisLinDamp: 0.35,
  debrisAngDamp: 0.2,

  // Focus animation
  focusDistance: 4.2,
  focusHeight: 0.2,
  focusLerpSpeed: 5.5,
  focusScale: 1.15,

  // Cursor — DRAG ONLY, no passive field. Low pull strength so throws are
  // gentler and debris doesn't rocket off on release.
  dragPullStrength: 28,
  dragVelocityDamping: 12,

  // Ambient drift for debris
  driftEveryMs: 3200,
  driftStrength: 0.18,

  // Shooting stars
  shootingStarEveryMs: 3800,
  shootingStarJitter: 3000,
} as const;

function jitter(i: number, axis: number) {
  const s = Math.sin((i + 1) * 9.17 + axis * 47.31) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

// -----------------------------------------------------------------------------
// SceneFadeIn — progressive mount animation
// -----------------------------------------------------------------------------

/**
 * Wraps children in a group whose descendant materials fade from 0 → 1
 * opacity on mount. Takes a delay + duration so we can stagger elements:
 * stars first, then nebulas, then planets, then debris. Collects the
 * materials once so we're only touching `opacity` each frame, not
 * traversing the tree.
 */
function SceneFadeIn({
  delay = 0,
  duration = 1000,
  children,
}: {
  delay?: number;
  duration?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const startTime = useRef(performance.now());
  const matsRef = useRef<Array<THREE.Material & { userData: { _initialOpacity?: number } }>>([]);
  const done = useRef(false);

  useEffect(() => {
    if (!ref.current) return;
    const mats: Array<THREE.Material & { userData: { _initialOpacity?: number } }> = [];
    ref.current.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.material) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        const mat = m as THREE.Material & { userData: { _initialOpacity?: number }; opacity?: number };
        const currentOpacity = (mat as { opacity?: number }).opacity ?? 1;
        // Skip materials that are intentionally invisible at mount — e.g.
        // shooting-star trail spheres. They manage their own opacity at
        // runtime and if we clamp them to 0 then ramp back to 0 we'd
        // never let their animation set opacity.
        if (currentOpacity <= 0) continue;
        if (!mat.userData) mat.userData = {};
        mat.userData._initialOpacity = currentOpacity;
        mat.transparent = true;
        (mat as { opacity: number }).opacity = 0;
        mats.push(mat);
      }
    });
    matsRef.current = mats;
    startTime.current = performance.now();
  }, []);

  useFrame(() => {
    if (done.current) return;
    const elapsed = performance.now() - startTime.current - delay;
    const t = Math.max(0, Math.min(1, elapsed / duration));
    const eased = t * t * (3 - 2 * t); // smoothstep
    for (const mat of matsRef.current) {
      const initial = mat.userData._initialOpacity ?? 1;
      (mat as { opacity: number }).opacity = initial * eased;
    }
    if (t >= 1) done.current = true; // stop stomping opacity forever
  });

  return <group ref={ref}>{children}</group>;
}

// -----------------------------------------------------------------------------
// Background: nebulas + dust + shooting stars
// -----------------------------------------------------------------------------

function DustField({ count = 300 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 40;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 25;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 30 - 6;
    }
    return arr;
  }, [count]);

  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.015;
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
        size={0.05}
        color="#c8d4ff"
        transparent
        opacity={0.6}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

/** Shooting star — bright head + a trail of shrinking, fading spheres that
    sit behind it along the direction of motion. Using a sphere chain instead
    of a rotated cylinder avoids orientation issues (the previous cylinder
    was vertical regardless of motion direction). */
const SHOOTING_TRAIL_COUNT = 10;

function ShootingStar({ index }: { index: number }) {
  const ref = useRef<THREE.Group>(null);
  const meshRefs = useRef<Array<THREE.Mesh | null>>([]);
  const state = useRef({
    active: false,
    nextAt: performance.now() + 2500 + index * 1400,
    dir: new THREE.Vector3(),
    dirNorm: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    life: 0,
    maxLife: 1.3,
  });

  useFrame((_, delta) => {
    const s = state.current;
    const now = performance.now();

    if (!s.active && now > s.nextAt) {
      const startAngle = Math.random() * Math.PI * 2;
      const startR = 22;
      s.pos.set(
        Math.cos(startAngle) * startR,
        3 + Math.random() * 5,
        -12 - Math.random() * 6,
      );
      s.dir.set(
        -Math.cos(startAngle) * 2.2,
        -0.25 + Math.random() * 0.5,
        Math.random() * 0.3,
      );
      s.dirNorm.copy(s.dir).normalize();
      s.life = 0;
      s.active = true;
    }

    const g = ref.current;
    if (g) g.visible = s.active;

    if (s.active) {
      s.life += delta;
      s.pos.addScaledVector(s.dir, delta * 9);
      if (g) g.position.copy(s.pos);

      // Fade envelope across lifetime.
      const t01 = s.life / s.maxLife;
      const fade = t01 < 0.15 ? t01 / 0.15 : t01 > 0.7 ? (1 - t01) / 0.3 : 1;

      // Position each trail sphere backwards along the motion direction.
      const SPACING = 0.25;
      for (let i = 0; i < meshRefs.current.length; i++) {
        const m = meshRefs.current[i];
        if (!m) continue;
        // i=0 is the bright head; higher i = further back + smaller + dimmer.
        m.position.set(
          -s.dirNorm.x * i * SPACING,
          -s.dirNorm.y * i * SPACING,
          -s.dirNorm.z * i * SPACING,
        );
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = fade * (1 - i / SHOOTING_TRAIL_COUNT) * (i === 0 ? 1 : 0.7);
      }

      if (s.life > s.maxLife) {
        s.active = false;
        s.nextAt =
          now +
          TUNING.shootingStarEveryMs +
          Math.random() * TUNING.shootingStarJitter;
      }
    }
  });

  return (
    <group ref={ref} visible={false}>
      {Array.from({ length: SHOOTING_TRAIL_COUNT }).map((_, i) => {
        const r = 0.09 * (1 - i / SHOOTING_TRAIL_COUNT);
        return (
          <mesh
            key={i}
            ref={(m) => {
              meshRefs.current[i] = m;
            }}
          >
            <sphereGeometry args={[r, 8, 8]} />
            <meshBasicMaterial
              color="#fff8d0"
              transparent
              opacity={0}
              toneMapped={false}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// -----------------------------------------------------------------------------
// Distant decorative planets + a tiny rocket easter egg (very far back).
// -----------------------------------------------------------------------------

/** Small planet that sits far behind the action and slowly rotates.
    Purely visual — no collision, no interaction. */
function DistantPlanet({
  position,
  scale,
  color,
  ringed = false,
}: {
  position: [number, number, number];
  scale: number;
  color: string;
  ringed?: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.05;
  });
  return (
    <group ref={ref} position={position} scale={scale}>
      {/* Planet body — self-lit so it reads against the starfield without
          depending on scene lights that don't reach that deep into -Z. */}
      <mesh>
        <sphereGeometry args={[1, 24, 24]} />
        <meshStandardMaterial
          color={color}
          roughness={0.5}
          metalness={0.2}
          emissive={color}
          emissiveIntensity={1.6}
          toneMapped={false}
        />
      </mesh>
      {/* Additive halo — reads as an atmospheric bloom at distance */}
      <mesh scale={1.55}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {ringed && (
        <mesh rotation={[Math.PI / 2.3, 0, 0.2]}>
          <ringGeometry args={[1.35, 1.9, 64]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

/** Tiny rocket drifting across the very-deep background. A little easter egg
    at the edge of view — cone body + fin triangles + a thruster flame. */
/** The FABRIQUE ship — clickable spaceship orbiting on a flattened ellipse.
    The outer group controls position + Y rotation; the inner group carries
    the model with its nose pre-aligned to outer's forward axis. Click →
    fullscreen warp → /about cockpit. */
function FabriqueShip() {
  const outerRef = useRef<THREE.Group>(null);
  const shipRef = useRef<THREE.Group>(null);
  const flameRef = useRef<THREE.Mesh>(null);
  const hoveredRef = useRef(false);
  const router = useRouter();

  useFrame(({ clock }) => {
    if (!outerRef.current) return;
    const t = clock.elapsedTime;
    /** Orbit around a point behind the scene in a flattened ellipse. */
    const angle = t * 0.18;
    const cx = 0;
    const cz = -16;
    const radiusX = 13;
    const radiusZ = 5;
    const x = cx + Math.cos(angle) * radiusX;
    const z = cz + Math.sin(angle) * radiusZ;
    const y = Math.sin(t * 0.55) * 0.5 + 0.3;
    outerRef.current.position.set(x, y, z);

    // Analytic tangent of the ellipse at this angle:
    //   tx = dx/dθ = -sin(angle) * radiusX
    //   tz = dz/dθ =  cos(angle) * radiusZ
    // Inner shipRef (-π/2 X rotation) puts the nose along outer's -Z. So we
    // need the Y rotation that aligns outer's local -Z with the tangent.
    // For a Y-axis rotation θ, -Z rotates to (-sin θ, 0, -cos θ). Setting
    // that equal to normalized tangent gives θ = atan2(-tx, -tz).
    // Replaces the prior lookAt() which was inheriting an intermittent
    // roll from up-vector resolution and visually flipping the ship on
    // parts of the orbit.
    const tx = -Math.sin(angle) * radiusX;
    const tz = Math.cos(angle) * radiusZ;
    outerRef.current.rotation.set(0, Math.atan2(-tx, -tz), 0);

    // Flame flicker (inside ship frame).
    if (flameRef.current) {
      const s =
        0.85 + Math.sin(clock.elapsedTime * 28) * 0.3 + Math.random() * 0.15;
      flameRef.current.scale.set(1, s, 1);
    }

    // Hover scale pop (applies to the ship group, not the orbit).
    if (shipRef.current) {
      const hoverScale = hoveredRef.current ? 1.18 : 1.0;
      shipRef.current.scale.lerp(
        new THREE.Vector3(hoverScale, hoverScale, hoverScale),
        0.1,
      );
    }
  });

  return (
    <group
      ref={outerRef}
      onPointerOver={(e) => {
        e.stopPropagation();
        hoveredRef.current = true;
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        hoveredRef.current = false;
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        e.stopPropagation();
        playSound("whoosh", 0.6);
        window.dispatchEvent(new CustomEvent("warp"));
        window.setTimeout(() => router.push("/about"), 550);
      }}
    >
    {/* Inner reorientation: cylinder (local +Y) → outer forward (-Z). */}
    <group ref={shipRef} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Nose cone */}
      <mesh position={[0, 1.0, 0]}>
        <coneGeometry args={[0.32, 0.9, 10]} />
        <meshStandardMaterial color="#eef0f5" metalness={0.7} roughness={0.22} />
      </mesh>
      {/* Body */}
      <mesh>
        <cylinderGeometry args={[0.32, 0.36, 1.6, 14]} />
        <meshStandardMaterial color="#d6d9e2" metalness={0.65} roughness={0.3} />
      </mesh>
      {/* FABRIQUE band — navy stripe with an accent line */}
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.325, 0.325, 0.18, 14]} />
        <meshStandardMaterial color="#0a1430" metalness={0.4} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.47, 0]}>
        <cylinderGeometry args={[0.326, 0.326, 0.02, 14]} />
        <meshBasicMaterial color="#5aa0ff" toneMapped={false} />
      </mesh>
      {/* Cockpit window — glowing blue dome */}
      <mesh position={[0, 0.25, 0.34]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 20]} />
        <meshBasicMaterial color="#80c8ff" toneMapped={false} />
      </mesh>
      {/* Three fins */}
      {[0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].map((a, i) => (
        <mesh key={i} rotation={[0, a, 0]} position={[0, -0.65, 0]}>
          <coneGeometry args={[0.3, 0.55, 3]} />
          <meshStandardMaterial color="#ff5a3a" metalness={0.55} roughness={0.45} />
        </mesh>
      ))}
      {/* Thruster ring */}
      <mesh position={[0, -0.92, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.1, 14]} />
        <meshStandardMaterial color="#2a2f3a" metalness={0.8} roughness={0.2} />
      </mesh>
      {/* Flame */}
      <mesh ref={flameRef} position={[0, -1.15, 0]}>
        <coneGeometry args={[0.22, 0.7, 12]} />
        <meshBasicMaterial color="#ffc040" toneMapped={false} />
      </mesh>
      <mesh position={[0, -1.05, 0]}>
        <coneGeometry args={[0.12, 0.4, 12]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      {/* Tail light so it reads against the nebula. */}
      <pointLight position={[0, -1.2, 0]} color="#ffb040" intensity={1.2} distance={3.5} />

      {/* "FABRIQUE" painted on BOTH sides of the fuselage so the livery is
          readable as the ship orbits. Each side is a vertical stack of
          letters; after the inner group's -90° X rotation, the stack runs
          horizontally along the ship's length like real rocket decals.
          Side text faces ±X so the meshBasicMaterial front face is visible
          from whichever side the camera is currently seeing. */}
      {([
        { xSign: 1, rot: Math.PI / 2 },   // right side (+X)
        { xSign: -1, rot: -Math.PI / 2 }, // left side (-X)
      ] as const).map((side, sideIdx) =>
        "FABRIQUE".split("").map((ch, i) => {
          const y = 0.56 - i * 0.14;
          return (
            <Text3D
              key={`fab-${sideIdx}-${i}`}
              font="/fonts/helvetiker_bold.typeface.json"
              size={0.09}
              height={0.015}
              bevelEnabled
              bevelSize={0.004}
              bevelThickness={0.004}
              bevelSegments={2}
              position={[side.xSign * 0.37, y, -0.04]}
              rotation={[0, side.rot, 0]}
            >
              {ch}
              <meshStandardMaterial
                color="#0a1830"
                emissive="#5aa0ff"
                emissiveIntensity={1.1}
                metalness={0.45}
                roughness={0.3}
                toneMapped={false}
              />
            </Text3D>
          );
        }),
      )}
    </group>
    {/* Floating HTML label — always faces camera, mounted OUTSIDE the inner
        reorientation group so the bank doesn't flip it. */}
    <Html
      position={[0, 0, 1.2]}
      center
      distanceFactor={8}
      wrapperClass="ship-label"
      pointerEvents="none"
      zIndexRange={[40, 50]}
    >
      <div className="ship-label-inner">
        <span className="ship-label-name">FABRIQUE</span>
        <span className="ship-label-hint">click to board</span>
      </div>
    </Html>
    </group>
  );
}

/** Point-cloud nebula — procedurally stitches together point positions in
    the Cat's Eye silhouette (central core + ellipsoidal eye + concentric
    halo rings + two tip filaments). Reads as a pixel-stippled nebula from
    far away; great for layering behind the image billboards. */
function PixelNebula({
  position,
  scale = 1,
  seed = 0,
  warm = "#ffb080",
  cool = "#8fb8ff",
  pointSize = 3,
  opacity = 0.95,
}: {
  position: [number, number, number];
  scale?: number;
  seed?: number;
  warm?: string;
  cool?: string;
  pointSize?: number;
  opacity?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const warmC = new THREE.Color(warm);
    const coolC = new THREE.Color(cool);
    const rand = (n: number) => {
      const x = Math.sin(seed + n * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    // Collected (x,y,z,r,g,b) rows — we pre-allocate a generous buffer.
    const rows: number[] = [];
    const push = (x: number, y: number, z: number, c: THREE.Color) =>
      rows.push(x, y, z, c.r, c.g, c.b);

    // Bright central core — warm saturated dots
    for (let i = 0; i < 60; i++) {
      const r = rand(i) * 0.12;
      const a = rand(i + 100) * Math.PI * 2;
      const c = warmC.clone().lerp(new THREE.Color("#ffffff"), rand(i + 200) * 0.6);
      push(Math.cos(a) * r, Math.sin(a) * r, (rand(i + 300) - 0.5) * 0.08, c);
    }
    // The "eye" — ellipsoidal inner shell (wider along X than Y)
    for (let i = 0; i < 340; i++) {
      const theta = rand(i + 400) * Math.PI * 2;
      const rr = 0.28 + rand(i + 500) * 0.2;
      const x = Math.cos(theta) * rr * 1.55;
      const y = Math.sin(theta) * rr * 0.95;
      const c = coolC.clone().lerp(warmC, Math.abs(Math.cos(theta)) * 0.45);
      push(x, y, (rand(i + 600) - 0.5) * 0.08, c);
    }
    // Concentric halo rings — the signature Cat's-Eye detail.
    // Boost baseline brightness since additive blend against near-black
    // sky needs strong source values to read as luminous at distance.
    for (let ring = 0; ring < 7; ring++) {
      const base = 0.7 + ring * 0.18;
      const count = 80 + ring * 14;
      for (let i = 0; i < count; i++) {
        const theta = (i / count) * Math.PI * 2;
        const wobble = (rand(i + ring * 1000) - 0.5) * 0.05;
        const rr = base + wobble;
        const x = Math.cos(theta) * rr * 1.55;
        const y = Math.sin(theta) * rr * 0.95;
        const atten = 1 - ring / 8;
        const c = coolC.clone().multiplyScalar(0.9 + atten * 0.5);
        push(x, y, (rand(i + ring * 1200) - 0.5) * 0.04, c);
      }
    }
    // Tip filaments — two orange streaks at ±X extremes
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 90; i++) {
        const t = rand(i + side * 2000);
        const x = side * (1.6 + t * 1.4);
        const y = (rand(i + side * 2100) - 0.5) * 0.15 + Math.sin(t * 4) * 0.08;
        const z = (rand(i + side * 2200) - 0.5) * 0.08;
        const c = warmC.clone().multiplyScalar(1.1 + rand(i + side * 2300) * 0.3);
        push(x, y, z, c);
      }
    }
    // Sparse background stars within the nebula area
    for (let i = 0; i < 140; i++) {
      const rr = rand(i + 3000) * 2.5;
      const a = rand(i + 3100) * Math.PI * 2;
      const c = new THREE.Color(1, 1, 0.9).multiplyScalar(
        0.3 + rand(i + 3200) * 0.7,
      );
      push(Math.cos(a) * rr, Math.sin(a) * rr * 0.6, (rand(i + 3300) - 0.5) * 0.2, c);
    }

    const n = rows.length / 6;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = rows[i * 6];
      positions[i * 3 + 1] = rows[i * 6 + 1];
      positions[i * 3 + 2] = rows[i * 6 + 2];
      colors[i * 3] = rows[i * 6 + 3];
      colors[i * 3 + 1] = rows[i * 6 + 4];
      colors[i * 3 + 2] = rows[i * 6 + 5];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [seed, warm, cool]);

  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * 0.008;
  });

  return (
    <points ref={ref} position={position} scale={scale}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={pointSize}
        vertexColors
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation={false}
        toneMapped={false}
      />
    </points>
  );
}

/** Slowly rotating satellite sitting very far back — box chassis + two solar
    panel wings + a small antenna dish with a blinking red light. Barely
    visible but it's there, catching the eye when you pan. */
function DistantSatellite({
  position,
}: {
  position: [number, number, number];
}) {
  const ref = useRef<THREE.Group>(null);
  const blinker = useRef<THREE.Mesh>(null);
  useFrame(({ clock }, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.08;
    if (blinker.current) {
      const on = Math.sin(clock.elapsedTime * 2.8) > 0.7 ? 1 : 0.05;
      (blinker.current.material as THREE.MeshBasicMaterial).opacity = on;
    }
  });
  return (
    <group ref={ref} position={position}>
      {/* Chassis */}
      <mesh>
        <boxGeometry args={[0.45, 0.35, 0.55]} />
        <meshStandardMaterial color="#c6ccd4" metalness={0.75} roughness={0.3} />
      </mesh>
      {/* Gold foil wrap */}
      <mesh position={[0, -0.18, 0]}>
        <boxGeometry args={[0.48, 0.05, 0.58]} />
        <meshStandardMaterial color="#d9a24a" metalness={0.9} roughness={0.2} emissive="#d9a24a" emissiveIntensity={0.3} />
      </mesh>
      {/* Solar panels L/R */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.9, 0, 0]}>
          <mesh>
            <boxGeometry args={[1.3, 0.55, 0.03]} />
            <meshStandardMaterial
              color="#1f3a72"
              metalness={0.55}
              roughness={0.3}
              emissive="#1a2550"
              emissiveIntensity={0.5}
            />
          </mesh>
          {/* Panel cell grid lines */}
          {Array.from({ length: 4 }).map((_, i) => (
            <mesh key={i} position={[-0.52 + i * 0.35, 0, 0.02]}>
              <boxGeometry args={[0.01, 0.5, 0.005]} />
              <meshBasicMaterial color="#0a1530" />
            </mesh>
          ))}
          {/* Arm connecting panel to body */}
          <mesh position={[-s * 0.6, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.3, 6]} />
            <meshStandardMaterial color="#9098a4" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}
      {/* Antenna dish */}
      <mesh position={[0, 0.28, 0.15]} rotation={[-Math.PI / 5, 0, 0]}>
        <cylinderGeometry args={[0.14, 0.2, 0.04, 18]} />
        <meshStandardMaterial color="#eaecf2" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.38, 0.22]}>
        <cylinderGeometry args={[0.015, 0.015, 0.2, 6]} />
        <meshStandardMaterial color="#c0c4cc" metalness={0.7} roughness={0.25} />
      </mesh>
      {/* Blinking red beacon */}
      <mesh ref={blinker} position={[0, 0.2, 0.3]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshBasicMaterial color="#ff3030" transparent opacity={1} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** UFO — classic flying saucer that cruises across the very-back once every
    18–36 seconds. Disc base + transparent dome + ring of blinking rim lights
    + a soft bottom underglow. Wobbles on its path like a bad sci-fi prop. */
function UFO() {
  const ref = useRef<THREE.Group>(null);
  const state = useRef({
    active: false,
    nextAt: performance.now() + 8000 + Math.random() * 6000,
    startX: 0,
    endX: 0,
    y: 0,
    z: 0,
    life: 0,
    maxLife: 9,
  });
  useFrame(({ clock }, delta) => {
    const s = state.current;
    const now = performance.now();
    if (!s.active && now > s.nextAt) {
      const dir = Math.random() > 0.5 ? 1 : -1;
      s.startX = -dir * 34;
      s.endX = dir * 34;
      s.y = 3 + Math.random() * 7;
      s.z = -28 - Math.random() * 12;
      s.life = 0;
      s.active = true;
    }
    const g = ref.current;
    if (g) g.visible = s.active;
    if (s.active && g) {
      s.life += delta;
      const t01 = s.life / s.maxLife;
      if (t01 >= 1) {
        s.active = false;
        s.nextAt = now + 18000 + Math.random() * 18000;
        return;
      }
      const ease = t01 < 0.5 ? t01 * 2 : 1 - (t01 - 0.5) * 0.1; // accel in, cruise out
      g.position.set(
        THREE.MathUtils.lerp(s.startX, s.endX, ease),
        s.y + Math.sin(clock.elapsedTime * 3) * 0.35,
        s.z,
      );
      g.rotation.y += delta * 3.5;
    }
  });
  return (
    <group ref={ref} visible={false}>
      {/* Lower saucer disc */}
      <mesh>
        <cylinderGeometry args={[0.55, 0.78, 0.12, 28]} />
        <meshStandardMaterial
          color="#7f8a9a"
          metalness={0.85}
          roughness={0.25}
          emissive="#303846"
          emissiveIntensity={0.3}
        />
      </mesh>
      {/* Thin bright ring (glowing seam) */}
      <mesh position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.79, 0.79, 0.02, 28]} />
        <meshBasicMaterial color="#80e0ff" toneMapped={false} />
      </mesh>
      {/* Dome */}
      <mesh position={[0, 0.08, 0]}>
        <sphereGeometry args={[0.35, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial
          color="#60f0ff"
          transparent
          opacity={0.75}
          metalness={0.3}
          roughness={0.15}
          emissive="#209fc8"
          emissiveIntensity={1.1}
          toneMapped={false}
        />
      </mesh>
      {/* Rim lights */}
      {Array.from({ length: 10 }).map((_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.66, -0.03, Math.sin(a) * 0.66]}>
            <sphereGeometry args={[0.035, 6, 6]} />
            <meshBasicMaterial
              color={i % 2 === 0 ? "#ffe080" : "#80c8ff"}
              toneMapped={false}
            />
          </mesh>
        );
      })}
      {/* Underglow cone */}
      <mesh position={[0, -0.4, 0]}>
        <coneGeometry args={[0.5, 0.65, 20, 1, true]} />
        <meshBasicMaterial
          color="#80e0ff"
          transparent
          opacity={0.18}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <pointLight position={[0, -0.3, 0]} color="#80e0ff" intensity={1.6} distance={4} />
    </group>
  );
}

/** Slow-rotating spiral galaxy in the VERY deep background. Build it once
    with logarithmic spiral arms seeded by position; rotate lazily on its
    own axis. A point-cloud of ~1500 stars across 3 arms. */
function GalaxySpiral({
  position,
  scale = 1,
  tint = "#b8c8ff",
}: {
  position: [number, number, number];
  scale?: number;
  tint?: string;
}) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const N = 1500;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const coreC = new THREE.Color("#fff0cc");
    const armC = new THREE.Color(tint);
    const arms = 3;
    for (let i = 0; i < N; i++) {
      const armIdx = i % arms;
      const t = Math.random();
      const r = t * 3;
      // Logarithmic spiral
      const theta = r * 1.6 + (armIdx / arms) * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * (0.25 + 0.1 * r);
      const x = Math.cos(theta) * r + jitter;
      const y = Math.sin(theta) * r + jitter;
      const z = (Math.random() - 0.5) * 0.25;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      // Color: core bright, arms tinted
      const c = coreC.clone().lerp(armC, Math.min(1, r / 2.2));
      c.multiplyScalar(0.45 + (1 - t) * 0.7);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return geo;
  }, [tint]);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * 0.02;
  });
  return (
    <points ref={ref} position={position} scale={scale} rotation={[0.6, 0, 0]}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={2.5}
        vertexColors
        transparent
        opacity={0.95}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation={false}
        toneMapped={false}
      />
    </points>
  );
}

// -----------------------------------------------------------------------------
// Procedural nebula library — each function builds a point-cloud geometry
// modelled on a real nebula morphology. Reused in <MajorNebulas /> below.
// -----------------------------------------------------------------------------

/** Tiny seeded PRNG used across nebula generators. Stateful via closure. */
function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** Utility: push (pos,color) into parallel arrays, return a BufferGeometry. */
function buildPointsGeometry(rows: number[]): THREE.BufferGeometry {
  const n = rows.length / 6;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rows[i * 6];
    pos[i * 3 + 1] = rows[i * 6 + 1];
    pos[i * 3 + 2] = rows[i * 6 + 2];
    col[i * 3] = rows[i * 6 + 3];
    col[i * 3 + 1] = rows[i * 6 + 4];
    col[i * 3 + 2] = rows[i * 6 + 5];
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

/** EmissionPillar — dense vertical dust columns with embedded stars, à la
    Hubble's Pillars of Creation (M16 Eagle Nebula). Three warm-brown
    columns of varying height with hot young stars scattered inside + at
    the peaks, against a hazy green-teal emission background. */
function EmissionPillar({
  position,
  scale = 1,
  seed = 17,
  spin = 0.001,
}: {
  position: [number, number, number];
  scale?: number;
  seed?: number;
  spin?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const r = seededRand(seed);
    const rows: number[] = [];
    const push = (x: number, y: number, z: number, c: THREE.Color) =>
      rows.push(x, y, z, c.r, c.g, c.b);
    const dustColor = new THREE.Color("#b8602c");
    const dustColorLight = new THREE.Color("#e09060");
    const starC = new THREE.Color("#ffffe0");
    const bgC = new THREE.Color("#3d5a70");
    // Three pillars at fixed offsets along X, varying height + taper
    const pillars = [
      { x: -1.6, h: 4.2, w: 0.55 },
      { x: 0, h: 5.5, w: 0.7 },
      { x: 1.5, h: 3.6, w: 0.5 },
    ];
    for (const p of pillars) {
      const count = Math.floor(p.h * 140);
      for (let i = 0; i < count; i++) {
        // Vertical position along pillar, biased to be denser at the base
        const t = r() ** 1.15;
        const yLocal = -p.h / 2 + t * p.h;
        // Radius tapers to thinner at top + noisy edge
        const taper = 1 - (1 - t) * 0.15 - t * 0.5;
        const radius = p.w * taper * (0.5 + r() * 0.8);
        const theta = r() * Math.PI * 2;
        const x = p.x + Math.cos(theta) * radius;
        const z = Math.sin(theta) * radius;
        const cMix = dustColor.clone().lerp(dustColorLight, r() * 0.8);
        cMix.multiplyScalar(0.6 + r() * 0.6);
        push(x, yLocal, z, cMix);
      }
    }
    // Hot young stars inside the pillars + at the tips
    for (let i = 0; i < 70; i++) {
      const p = pillars[Math.floor(r() * pillars.length)];
      const t = r();
      const x = p.x + (r() - 0.5) * p.w * 0.5;
      const y = -p.h / 2 + t * p.h;
      const z = (r() - 0.5) * p.w * 0.3;
      const c = starC.clone().multiplyScalar(1.1 + r() * 0.6);
      push(x, y, z, c);
    }
    // Background emission haze — teal/green O-III
    for (let i = 0; i < 400; i++) {
      const x = (r() - 0.5) * 8;
      const y = (r() - 0.5) * 8;
      const z = -1 - r() * 1.5;
      const c = bgC.clone().multiplyScalar(0.5 + r() * 0.5);
      push(x, y, z, c);
    }
    return buildPointsGeometry(rows);
  }, [seed]);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * spin;
  });
  return (
    <points ref={ref} position={position} scale={scale}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={3.2}
        vertexColors
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation={false}
        toneMapped={false}
      />
    </points>
  );
}

/** SupernovaRemnant — expanding spherical shell with filamentary structure,
    modelled on the Crab Nebula / Cassiopeia A. Blue synchrotron core +
    red-orange filaments on the shell + hot central pulsar. */
function SupernovaRemnant({
  position,
  scale = 1,
  seed = 29,
  spin = 0.004,
}: {
  position: [number, number, number];
  scale?: number;
  seed?: number;
  spin?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const r = seededRand(seed);
    const rows: number[] = [];
    const push = (x: number, y: number, z: number, c: THREE.Color) =>
      rows.push(x, y, z, c.r, c.g, c.b);
    const blueC = new THREE.Color("#80c8ff");
    const redC = new THREE.Color("#ff6040");
    const whiteC = new THREE.Color("#ffffff");
    // Filamentary shell — pick random great-circle arcs and trace them
    // in points. Simulates the stringy web of a real SNR.
    for (let f = 0; f < 36; f++) {
      const axis = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
      const ortho = new THREE.Vector3()
        .crossVectors(axis, new THREE.Vector3(1, 0, 0))
        .normalize();
      if (ortho.lengthSq() < 0.01) ortho.set(0, 1, 0);
      const ortho2 = new THREE.Vector3().crossVectors(axis, ortho).normalize();
      const arcLen = 0.6 + r() * 1.3;
      const arcSteps = 45;
      const phase = r() * Math.PI * 2;
      const R = 1.5 + r() * 0.4;
      const colA = redC.clone().lerp(blueC, r() * 0.35);
      for (let i = 0; i < arcSteps; i++) {
        const theta = phase + (i / arcSteps) * arcLen;
        const x = (Math.cos(theta) * ortho.x + Math.sin(theta) * ortho2.x) * R;
        const y = (Math.cos(theta) * ortho.y + Math.sin(theta) * ortho2.y) * R;
        const z = (Math.cos(theta) * ortho.z + Math.sin(theta) * ortho2.z) * R;
        const jitter = 0.08;
        const c = colA.clone().multiplyScalar(0.75 + r() * 0.5);
        push(
          x + (r() - 0.5) * jitter,
          y + (r() - 0.5) * jitter,
          z + (r() - 0.5) * jitter,
          c,
        );
      }
    }
    // Inner blue synchrotron glow — dense ball of blue points
    for (let i = 0; i < 600; i++) {
      const u = r() * 2 - 1;
      const phi = r() * Math.PI * 2;
      const rad = 0.1 + r() * 0.9;
      const sr = Math.sqrt(1 - u * u);
      const c = blueC.clone().multiplyScalar(0.6 + r() * 0.6);
      push(
        Math.cos(phi) * sr * rad,
        Math.sin(phi) * sr * rad,
        u * rad,
        c,
      );
    }
    // Central pulsar point
    for (let i = 0; i < 12; i++) {
      const c = whiteC.clone().multiplyScalar(1.5 + r() * 0.5);
      push((r() - 0.5) * 0.08, (r() - 0.5) * 0.08, (r() - 0.5) * 0.08, c);
    }
    return buildPointsGeometry(rows);
  }, [seed]);
  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.x += delta * spin;
      ref.current.rotation.y += delta * spin * 0.7;
    }
  });
  return (
    <points ref={ref} position={position} scale={scale}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={2.6}
        vertexColors
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation={false}
        toneMapped={false}
      />
    </points>
  );
}

/** RingNebula — toroidal gas shell with bright central core, modelled on
    M57 Ring Nebula / Helix Nebula. Viewed slightly off-axis so it reads
    as an ellipse. */
function RingNebula({
  position,
  scale = 1,
  seed = 51,
  tiltX = 0.8,
  spin = 0.012,
  inner = "#ff70c8",
  outer = "#60d8ff",
}: {
  position: [number, number, number];
  scale?: number;
  seed?: number;
  tiltX?: number;
  spin?: number;
  inner?: string;
  outer?: string;
}) {
  const ref = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const r = seededRand(seed);
    const rows: number[] = [];
    const push = (x: number, y: number, z: number, c: THREE.Color) =>
      rows.push(x, y, z, c.r, c.g, c.b);
    const innerC = new THREE.Color(inner);
    const outerC = new THREE.Color(outer);
    // Torus surface
    const R = 1;
    const T = 0.35;
    for (let i = 0; i < 2200; i++) {
      const u = r() * Math.PI * 2;
      const v = r() * Math.PI * 2;
      const jitter = 1 + (r() - 0.5) * 0.25;
      const cr = T * jitter;
      const x = (R + cr * Math.cos(v)) * Math.cos(u);
      const y = (R + cr * Math.cos(v)) * Math.sin(u);
      const z = cr * Math.sin(v) * 0.6;
      // Radial color blend — inner points pinker, outer points bluer
      const radial = cr / T; // 0 = center of tube, 1 = outside
      const c = innerC.clone().lerp(outerC, (Math.cos(v) + 1) * 0.5);
      c.multiplyScalar(0.8 + r() * 0.5);
      // Fade outer strand
      const fade = 1 - Math.max(0, radial - 0.8) * 2;
      c.multiplyScalar(fade);
      push(x, y, z, c);
    }
    // Central white-dwarf glow
    for (let i = 0; i < 80; i++) {
      const c = new THREE.Color("#e0f8ff").multiplyScalar(1.2 + r() * 0.4);
      push(
        (r() - 0.5) * 0.25,
        (r() - 0.5) * 0.25,
        (r() - 0.5) * 0.1,
        c,
      );
    }
    // Sparse outer halo — wisps extending past the ring
    for (let i = 0; i < 350; i++) {
      const u = r() * Math.PI * 2;
      const hr = R + T + r() * 0.5;
      const c = outerC.clone().multiplyScalar(0.3 + r() * 0.5);
      push(
        Math.cos(u) * hr,
        Math.sin(u) * hr,
        (r() - 0.5) * 0.15,
        c,
      );
    }
    return buildPointsGeometry(rows);
  }, [seed, inner, outer]);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * spin;
  });
  return (
    <points ref={ref} position={position} scale={scale} rotation={[tiltX, 0, 0]}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={3}
        vertexColors
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation={false}
        toneMapped={false}
      />
    </points>
  );
}

/** BipolarNebula — two teardrop-shaped lobes extending from a pinch point,
    modelled on NGC 6302 Butterfly Nebula / Ant Nebula. Hot white core at
    the center, blue-to-pink gradient lobes, flared tips. */
function BipolarNebula({
  position,
  scale = 1,
  seed = 83,
  spin = 0.006,
}: {
  position: [number, number, number];
  scale?: number;
  seed?: number;
  spin?: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const r = seededRand(seed);
    const rows: number[] = [];
    const push = (x: number, y: number, z: number, c: THREE.Color) =>
      rows.push(x, y, z, c.r, c.g, c.b);
    const hotC = new THREE.Color("#ffeed8");
    const pinkC = new THREE.Color("#ff80c0");
    const blueC = new THREE.Color("#6090ff");
    // Two cone/lobe clouds along ±X axis
    for (const side of [-1, 1]) {
      for (let i = 0; i < 1100; i++) {
        const t = r(); // 0 = at center, 1 = tip
        // Length along axis biased toward tip cluster
        const along = side * t * 2.2;
        // Cone radius grows to middle then tapers toward tip
        const bulge = Math.sin(t * Math.PI) ** 0.8;
        const radius = 0.05 + bulge * 0.9;
        const theta = r() * Math.PI * 2;
        const crossY = Math.cos(theta) * radius;
        const crossZ = Math.sin(theta) * radius * 0.5; // flatter Z
        const c = blueC.clone().lerp(pinkC, t);
        c.multiplyScalar(0.6 + (1 - t) * 0.5 + r() * 0.3);
        push(along, crossY, crossZ, c);
      }
    }
    // Bright hot pinch at origin
    for (let i = 0; i < 80; i++) {
      const c = hotC.clone().multiplyScalar(1.4 + r() * 0.5);
      push(
        (r() - 0.5) * 0.25,
        (r() - 0.5) * 0.15,
        (r() - 0.5) * 0.1,
        c,
      );
    }
    return buildPointsGeometry(rows);
  }, [seed]);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * spin;
  });
  return (
    <points ref={ref} position={position} scale={scale}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={2.8}
        vertexColors
        transparent
        opacity={1}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation={false}
        toneMapped={false}
      />
    </points>
  );
}

/** ReflectionCloud — big diffuse multi-colored cloud, no central structure,
    modelled on Rho Ophiuchi cloud complex / Carina regions. Multiple color
    clumps layered together. */
function ReflectionCloud({
  position,
  scale = 1,
  seed = 101,
  tints = ["#6080ff", "#ff80a0", "#ffa060", "#a0ff80"],
}: {
  position: [number, number, number];
  scale?: number;
  seed?: number;
  tints?: string[];
}) {
  const ref = useRef<THREE.Group>(null);
  const geometry = useMemo(() => {
    const r = seededRand(seed);
    const rows: number[] = [];
    const push = (x: number, y: number, z: number, c: THREE.Color) =>
      rows.push(x, y, z, c.r, c.g, c.b);
    const colors = tints.map((t) => new THREE.Color(t));
    // 5 color clumps, each a gaussian-ish blob centered somewhere
    for (let k = 0; k < 7; k++) {
      const cx = (r() - 0.5) * 4;
      const cy = (r() - 0.5) * 3;
      const cz = (r() - 0.5) * 1.5;
      const baseC = colors[k % colors.length];
      const N = 400 + Math.floor(r() * 200);
      const spread = 0.8 + r() * 1.0;
      for (let i = 0; i < N; i++) {
        // Box-Muller-ish distribution for a rounded clump
        const u1 = r();
        const u2 = r();
        const g1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const g2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
        const g3 = (r() - 0.5) * 2;
        const c = baseC.clone().multiplyScalar(0.6 + r() * 0.7);
        push(cx + g1 * spread, cy + g2 * spread, cz + g3 * spread * 0.4, c);
      }
    }
    return buildPointsGeometry(rows);
  }, [seed, tints]);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * 0.0015;
  });
  return (
    <points ref={ref} position={position} scale={scale}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={3}
        vertexColors
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation={false}
        toneMapped={false}
      />
    </points>
  );
}

/** MajorNebulas — the screenwide stage-2 layer. Each instance is placed at
    a depth that puts it well behind the planets and at a scale large enough
    to fill a meaningful fraction of the frustum. */
function MajorNebulas() {
  return (
    <>
      {/* Pillars of Creation — huge, center-left, warm+teal */}
      <EmissionPillar
        position={[-14, 2, -42]}
        scale={4.5}
        seed={17}
        spin={0.0008}
      />
      {/* Supernova remnant — right of center, bright shell */}
      <SupernovaRemnant
        position={[16, 6, -48]}
        scale={6}
        seed={29}
        spin={0.003}
      />
      {/* Ring nebula — top-right, pink/cyan */}
      <RingNebula
        position={[20, 10, -52]}
        scale={5}
        seed={51}
        tiltX={0.9}
        spin={0.01}
        inner="#ff70c8"
        outer="#60d8ff"
      />
      {/* Second ring nebula — very far back, centered, huge, green/violet */}
      <RingNebula
        position={[-4, -2, -66]}
        scale={9}
        seed={67}
        tiltX={0.5}
        spin={-0.008}
        inner="#80ffb0"
        outer="#b080ff"
      />
      {/* Butterfly / bipolar — mid-distance, lower-left */}
      <BipolarNebula
        position={[-18, -6, -40]}
        scale={4.5}
        seed={83}
        spin={0.004}
      />
      {/* Reflection cloud — screen-filling backdrop, multi-color */}
      <ReflectionCloud
        position={[0, 0, -58]}
        scale={8}
        seed={101}
        tints={["#6080ff", "#ff80a0", "#ffc060", "#80ffe0"]}
      />
      {/* Second reflection cloud — offset, cooler palette */}
      <ReflectionCloud
        position={[-12, 10, -56]}
        scale={5}
        seed={137}
        tints={["#4060c0", "#7040a0", "#80a0ff"]}
      />
      {/* Cat's-Eye pixel nebula (reusing the existing generator) — far left,
          adds detail variety alongside the new morphologies. */}
      <PixelNebula
        position={[24, -12, -46]}
        scale={2.6}
        seed={7}
        warm="#ff9068"
        cool="#88b8ff"
        pointSize={3}
        opacity={1}
      />
      <PixelNebula
        position={[-26, 4, -54]}
        scale={3.2}
        seed={23}
        warm="#ffb080"
        cool="#b0a0ff"
        pointSize={2.8}
        opacity={0.95}
      />
    </>
  );
}

/** Wrapper for the distant background garnish. */
function DistantBackground() {
  return (
    <>
      {/* Distant planets — varied sizes + ringed variants */}
      <DistantPlanet position={[-16, 5, -28]} scale={1.8} color="#3d5ac2" />
      <DistantPlanet position={[19, 4, -32]} scale={2.4} color="#c23d9e" ringed />
      <DistantPlanet position={[-8, -9, -35]} scale={1.2} color="#d6a040" />
      <DistantPlanet position={[14, -7, -38]} scale={2} color="#40c28a" />
      <DistantPlanet position={[6, 8, -42]} scale={0.9} color="#a240ff" />
      <DistantPlanet position={[-22, -3, -44]} scale={1.6} color="#5098ff" ringed />
      <DistantPlanet position={[24, 10, -46]} scale={1.1} color="#ff8060" />
      <DistantPlanet position={[-4, 12, -50]} scale={0.7} color="#e0e0ff" />
      <DistantPlanet position={[10, -12, -48]} scale={1.3} color="#70ff80" ringed />

      {/* Spiral galaxies — more of them now, varied sizes/tints/tilts */}
      <GalaxySpiral position={[-28, -2, -58]} scale={1.3} tint="#a8c8ff" />
      <GalaxySpiral position={[26, 14, -62]} scale={0.9} tint="#ffc0d8" />
      <GalaxySpiral position={[8, -16, -64]} scale={1.1} tint="#c0a8ff" />
      <GalaxySpiral position={[-18, 16, -68]} scale={0.75} tint="#ffd8a0" />
      <GalaxySpiral position={[22, -4, -70]} scale={1.5} tint="#a0ffd8" />

      {/* Satellite — drift-rotating, way back */}
      <DistantSatellite position={[-25, 9, -52]} />
      <DistantSatellite position={[22, -10, -55]} />

      {/* UFO — flies across rarely */}
      <UFO />

      <FabriqueShip />
    </>
  );
}

// -----------------------------------------------------------------------------
// Arena — tight walls so nothing escapes the visible frustum
// -----------------------------------------------------------------------------

function Arena() {
  const { bx, by, bz } = TUNING;
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[bx, by, 0.3]} position={[0, 0, -bz]} />
      <CuboidCollider args={[bx, by, 0.3]} position={[0, 0, bz]} />
      <CuboidCollider args={[0.3, by, bz]} position={[-bx, 0, 0]} />
      <CuboidCollider args={[0.3, by, bz]} position={[bx, 0, 0]} />
      <CuboidCollider args={[bx, 0.3, bz]} position={[0, -by, 0]} />
      <CuboidCollider args={[bx, 0.3, bz]} position={[0, by, 0]} />
    </RigidBody>
  );
}

// -----------------------------------------------------------------------------
// Debris — draggable only (no passive knock)
// -----------------------------------------------------------------------------

function Debris({
  index,
  bodyRefs,
  onGrab,
}: {
  index: number;
  bodyRefs: React.MutableRefObject<Array<RapierRigidBody | null>>;
  onGrab: (body: RapierRigidBody, eventPoint: THREE.Vector3) => void;
}) {
  const rb = useRef<RapierRigidBody>(null);

  useEffect(() => {
    bodyRefs.current[index] = rb.current;
    return () => {
      bodyRefs.current[index] = null;
    };
  }, [bodyRefs, index]);

  const r =
    TUNING.debrisRadiusMin +
    ((jitter(index, 0) + 1) / 2) *
      (TUNING.debrisRadiusMax - TUNING.debrisRadiusMin);
  const spawnX = jitter(index, 1) * 5.5;
  const spawnY = jitter(index, 2) * 3;
  const spawnZ = jitter(index, 3) * 2;
  // Brighter palette — debris were near-invisible before. Cool slate-blue
  // tint so they read against the warm/purple nebulas.
  const tint = 48 + Math.floor(((jitter(index, 4) + 1) / 2) * 40);
  const color = `#${tint.toString(16).padStart(2, "0")}${(tint + 8).toString(16).padStart(2, "0")}${(tint + 22).toString(16).padStart(2, "0")}`;

  const spawnPos = useMemo<[number, number, number]>(
    () => [spawnX, spawnY, spawnZ],
    [spawnX, spawnY, spawnZ],
  );
  const spawnRot = useMemo<[number, number, number]>(
    () => [jitter(index, 5), jitter(index, 6), jitter(index, 7)],
    [index],
  );

  useEffect(() => {
    const body = rb.current;
    if (!body) return;
    body.setLinvel(
      {
        x: jitter(index, 10) * 0.4,
        y: jitter(index, 11) * 0.3,
        z: jitter(index, 12) * 0.3,
      },
      true,
    );
    body.setAngvel(
      {
        x: jitter(index, 13) * 0.3,
        y: jitter(index, 14) * 0.3,
        z: jitter(index, 15) * 0.3,
      },
      true,
    );
  }, [index]);

  return (
    <RigidBody
      ref={rb}
      position={spawnPos}
      rotation={spawnRot}
      colliders="hull"
      mass={0.3}
      restitution={0.45}
      friction={0.2}
      linearDamping={TUNING.debrisLinDamp}
      angularDamping={TUNING.debrisAngDamp}
      gravityScale={0}
      onCollisionEnter={() => {
        const body = rb.current;
        if (!body) return;
        const v = body.linvel();
        if (Math.hypot(v.x, v.y, v.z) > 1.5) playSound("thud", 0.15);
      }}
    >
      <group
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const body = rb.current;
          if (!body) return;
          onGrab(body, e.point);
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
        <mesh>
          <dodecahedronGeometry args={[r, 0]} />
          <meshStandardMaterial
            color={color}
            metalness={0.45}
            roughness={0.55}
            emissive="#2a3a60"
            emissiveIntensity={0.35}
          />
        </mesh>
      </group>
    </RigidBody>
  );
}

// -----------------------------------------------------------------------------
// Project planets — 5 distinct shapes
// -----------------------------------------------------------------------------

type PlanetShape = "striped" | "grid" | "crystalCluster" | "volcano" | "plasma";
const SHAPE_BY_INDEX: PlanetShape[] = [
  "striped",
  "grid",
  "crystalCluster",
  "volcano",
  "plasma",
];

function planetHome(index: number, total: number): [number, number, number] {
  const t = total === 1 ? 0.5 : index / (total - 1);
  const angle = -TUNING.planetArcYaw / 2 + t * TUNING.planetArcYaw;
  const x = Math.sin(angle) * TUNING.planetArcRadius;
  const z = Math.cos(angle) * TUNING.planetArcRadius - 1.8;
  const y = TUNING.planetY + jitter(index, 0) * 0.6;
  return [x, y, z];
}

// --- Shape sub-components ---

/** Horizontal band texture generated once for the gas giant. */
function useStripedTexture(colors: string[]) {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const band = 256 / colors.length;
    colors.forEach((col, i) => {
      const grad = ctx.createLinearGradient(0, i * band, 0, (i + 1) * band);
      grad.addColorStop(0, col);
      grad.addColorStop(1, colors[(i + 1) % colors.length]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, i * band, 4, band);
    });
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }, [colors]);
}

function StripedPlanet({
  glow,
  shellRef,
  coreRef,
}: {
  glow: string;
  shellRef: React.MutableRefObject<THREE.Mesh | null>;
  coreRef: React.MutableRefObject<THREE.Mesh | null>;
}) {
  const tex = useStripedTexture(["#d85030", "#f09050", "#a02820", "#f4c070", "#7a1818"]);
  const bandRef = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (bandRef.current && tex) tex.offset.y += delta * 0.05;
  });
  return (
    <group>
      <mesh ref={shellRef}>
        <sphereGeometry args={[0.85, 48, 32]} />
        <meshPhysicalMaterial
          map={tex ?? undefined}
          metalness={0.1}
          roughness={0.55}
          clearcoat={0.35}
          emissive={glow}
          emissiveIntensity={0.3}
        />
      </mesh>
      {/* Faint equatorial highlight band. */}
      <mesh ref={bandRef} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 1]}>
        <torusGeometry args={[0.9, 0.015, 8, 64]} />
        <meshBasicMaterial color="#ffe0a0" transparent opacity={0.45} toneMapped={false} />
      </mesh>
      <mesh ref={coreRef} scale={[0.3, 0.3, 0.3]}>
        <sphereGeometry args={[0.7, 16, 16]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
    </group>
  );
}

function GridPlanet({
  glow,
  shellRef,
  coreRef,
}: {
  glow: string;
  shellRef: React.MutableRefObject<THREE.Mesh | null>;
  coreRef: React.MutableRefObject<THREE.Mesh | null>;
}) {
  return (
    <group>
      <mesh ref={shellRef}>
        <sphereGeometry args={[0.8, 40, 24]} />
        <meshPhysicalMaterial
          color="#0a0e1a"
          metalness={0.6}
          roughness={0.2}
          clearcoat={0.8}
          emissive={glow}
          emissiveIntensity={0.35}
        />
      </mesh>
      {/* Wireframe overlay — sharp square grid lines across the surface. */}
      <mesh scale={1.006}>
        <sphereGeometry args={[0.8, 20, 12]} />
        <meshBasicMaterial color={glow} wireframe transparent opacity={0.7} toneMapped={false} />
      </mesh>
      {/* Orbital hoop */}
      <mesh rotation={[Math.PI / 2.6, 0, 0.3]}>
        <torusGeometry args={[1.15, 0.015, 8, 64]} />
        <meshBasicMaterial color={glow} transparent opacity={0.6} toneMapped={false} />
      </mesh>
      <mesh ref={coreRef} scale={[0.3, 0.3, 0.3]}>
        <icosahedronGeometry args={[0.6, 0]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

function CrystalClusterPlanet({
  glow,
  shellRef,
  coreRef,
}: {
  glow: string;
  shellRef: React.MutableRefObject<THREE.Mesh | null>;
  coreRef: React.MutableRefObject<THREE.Mesh | null>;
}) {
  const shardProps: Array<{
    pos: [number, number, number];
    rot: [number, number, number];
    scale: number;
  }> = [
    { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 },
    { pos: [0.45, 0.3, 0.2], rot: [0.5, 0.3, 0.4], scale: 0.55 },
    { pos: [-0.4, -0.25, 0.35], rot: [-0.3, 0.6, 0.2], scale: 0.5 },
    { pos: [0.1, 0.45, -0.4], rot: [0.7, 0.1, -0.3], scale: 0.45 },
    { pos: [-0.35, 0.3, -0.3], rot: [0.2, -0.5, 0.5], scale: 0.4 },
  ];

  return (
    <group>
      {shardProps.map((s, i) => (
        <mesh
          key={i}
          position={s.pos}
          rotation={s.rot}
          scale={[s.scale * 0.95, s.scale * 1.3, s.scale * 0.95]}
          ref={i === 0 ? shellRef : undefined}
        >
          <octahedronGeometry args={[0.6, 0]} />
          <meshPhysicalMaterial
            color={glow}
            transmission={0.55}
            thickness={0.6}
            ior={1.45}
            roughness={0.08}
            clearcoat={1}
            emissive={glow}
            emissiveIntensity={1.1}
            transparent
            opacity={0.9}
          />
        </mesh>
      ))}
      <mesh ref={coreRef} scale={[0.35, 0.45, 0.35]}>
        <octahedronGeometry args={[0.5, 0]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={3} toneMapped={false} />
      </mesh>
    </group>
  );
}

function VolcanoPlanet({
  glow,
  shellRef,
  coreRef,
}: {
  glow: string;
  shellRef: React.MutableRefObject<THREE.Mesh | null>;
  coreRef: React.MutableRefObject<THREE.Mesh | null>;
}) {
  // Lava lines criss-crossing the surface.
  const lavaLines: Array<{ start: [number, number, number]; end: [number, number, number] }> = useMemo(
    () => [
      { start: [0, 0.8, 0], end: [0.5, 0.4, 0.5] },
      { start: [0, 0.8, 0], end: [-0.4, 0.5, 0.6] },
      { start: [0, 0.8, 0], end: [0.6, 0.1, -0.5] },
      { start: [0.5, 0.4, 0.5], end: [0.7, -0.2, 0.3] },
      { start: [-0.4, 0.5, 0.6], end: [-0.6, 0, 0.5] },
      { start: [0.6, 0.1, -0.5], end: [0.3, -0.4, -0.7] },
    ],
    [],
  );

  return (
    <group>
      {/* Rocky dark planet body */}
      <mesh ref={shellRef}>
        <icosahedronGeometry args={[0.85, 2]} />
        <meshStandardMaterial
          color="#2a1a12"
          metalness={0.15}
          roughness={0.95}
          flatShading
          emissive="#ff3010"
          emissiveIntensity={0.05}
        />
      </mesh>
      {/* Lava cracks — thin emissive cylinders routed along the surface */}
      {lavaLines.map((l, i) => {
        const mid: [number, number, number] = [
          (l.start[0] + l.end[0]) / 2,
          (l.start[1] + l.end[1]) / 2,
          (l.start[2] + l.end[2]) / 2,
        ];
        const dx = l.end[0] - l.start[0];
        const dy = l.end[1] - l.start[1];
        const dz = l.end[2] - l.start[2];
        const len = Math.hypot(dx, dy, dz);
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(dx, dy, dz).normalize(),
        );
        const euler = new THREE.Euler().setFromQuaternion(quat);
        return (
          <mesh
            key={i}
            position={mid}
            rotation={[euler.x, euler.y, euler.z]}
          >
            <cylinderGeometry args={[0.02, 0.02, len, 6]} />
            <meshBasicMaterial color={glow} toneMapped={false} />
          </mesh>
        );
      })}
      {/* Crater at top (a raised ring) */}
      <mesh position={[0, 0.8, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.04, 8, 24]} />
        <meshStandardMaterial
          color="#4a2420"
          metalness={0.2}
          roughness={0.9}
          emissive={glow}
          emissiveIntensity={0.9}
        />
      </mesh>
      {/* Lava pool inside the crater */}
      <mesh position={[0, 0.82, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.2, 20]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
      {/* Volcano glow light — also PULSES for added drama. */}
      <VolcanoLight glow={glow} />
      {/* Smoke rising above the crater */}
      <VolcanoSmoke />
      {/* Erupting lava droplets — arc up and fall back, continuously. */}
      <VolcanoLava glow={glow} />
      {/* Core (initially hidden inside planet — reveals on crack) */}
      <mesh ref={coreRef} scale={[0.35, 0.35, 0.35]}>
        <sphereGeometry args={[0.55, 20, 16]} />
        <meshStandardMaterial color={glow} emissive={glow} emissiveIntensity={2.8} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Pulsing point light that sits in the crater. */
function VolcanoLight({ glow }: { glow: string }) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;
    ref.current.intensity = 1.4 + Math.sin(t * 2.3) * 0.4 + (Math.random() - 0.5) * 0.2;
  });
  return <pointLight ref={ref} position={[0, 1.0, 0]} color={glow} intensity={1.8} distance={2.4} />;
}

/** Lava droplet eruption — N particles that arc up from the crater, gravity
    pulls them down, respawn at the crater when they fall below surface. */
function VolcanoLava({ glow }: { glow: string }) {
  const count = 10;
  const ref = useRef<THREE.Group>(null);
  const partsRef = useRef<Array<{ pos: THREE.Vector3; vel: THREE.Vector3; life: number }>>(
    Array.from({ length: count }, (_, i) => ({
      pos: new THREE.Vector3(0, 0.82, 0),
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 0.6,
        0.8 + Math.random() * 0.9,
        (Math.random() - 0.5) * 0.6,
      ),
      life: i * 0.12, // stagger spawn
    })),
  );

  useFrame((_, delta) => {
    const parts = partsRef.current;
    for (const p of parts) {
      p.life += delta;
      p.vel.y -= 3.5 * delta; // "gravity" toward the planet
      p.pos.addScaledVector(p.vel, delta);
      // Respawn when dropped back below the crater.
      if (p.pos.y < 0.78 && p.vel.y < 0) {
        p.pos.set(0, 0.82, 0);
        p.vel.set(
          (Math.random() - 0.5) * 0.8,
          0.8 + Math.random() * 1.0,
          (Math.random() - 0.5) * 0.8,
        );
        p.life = 0;
      }
    }
    if (ref.current) {
      ref.current.children.forEach((c, i) => {
        const p = parts[i];
        if (!p) return;
        c.position.copy(p.pos);
      });
    }
  });

  return (
    <group ref={ref}>
      {Array.from({ length: count }).map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshStandardMaterial
            color={glow}
            emissive={glow}
            emissiveIntensity={3}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

function VolcanoSmoke() {
  const group = useRef<THREE.Group>(null);
  const puffCount = 5;
  const puffsRef = useRef<Array<{ y: number; alpha: number; scale: number }>>(
    Array.from({ length: puffCount }, (_, i) => ({
      y: i * 0.25,
      alpha: 1 - i / puffCount,
      scale: 0.15 + i * 0.06,
    })),
  );
  useFrame((_, delta) => {
    const puffs = puffsRef.current;
    for (const puff of puffs) {
      puff.y += delta * 0.35;
      puff.alpha -= delta * 0.5;
      puff.scale += delta * 0.12;
      if (puff.alpha <= 0) {
        puff.y = 0.9;
        puff.alpha = 0.85;
        puff.scale = 0.15;
      }
    }
    if (group.current) {
      group.current.children.forEach((c, i) => {
        const p = puffs[i];
        c.position.y = p.y;
        c.position.x = Math.sin(p.y * 2) * 0.05;
        c.scale.setScalar(p.scale);
        const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial;
        m.opacity = Math.max(0, p.alpha) * 0.5;
      });
    }
  });
  return (
    <group ref={group}>
      {Array.from({ length: puffCount }).map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 10, 10]} />
          <meshBasicMaterial color="#4a4a52" transparent opacity={0.4} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function PlasmaPlanet({
  glow,
  shellRef,
  coreRef,
}: {
  glow: string;
  shellRef: React.MutableRefObject<THREE.Mesh | null>;
  coreRef: React.MutableRefObject<THREE.Mesh | null>;
}) {
  const arcsRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!arcsRef.current) return;
    const t = clock.elapsedTime;
    arcsRef.current.children.forEach((c, i) => {
      c.rotation.y = t * (1.2 + i * 0.3) + i;
      c.rotation.x = Math.sin(t * 2 + i) * 0.6;
      const scaleY = 1 + Math.sin(t * 8 + i * 1.3) * 0.25;
      c.scale.set(1, scaleY, 1);
    });
  });
  return (
    <group>
      {/* Outer halo (shell-role) */}
      <mesh ref={shellRef} scale={[1.7, 1.7, 1.7]}>
        <sphereGeometry args={[0.55, 24, 24]} />
        <meshBasicMaterial
          color={glow}
          transparent
          opacity={0.15}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh scale={[1.3, 1.3, 1.3]}>
        <sphereGeometry args={[0.55, 24, 24]} />
        <meshBasicMaterial
          color={glow}
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Electric arcs */}
      <group ref={arcsRef}>
        {Array.from({ length: 6 }).map((_, i) => {
          const angle = (i / 6) * Math.PI * 2;
          return (
            <mesh
              key={i}
              rotation={[0, angle, 0]}
              position={[0, 0, 0]}
            >
              <cylinderGeometry args={[0.015, 0.005, 1.4, 4]} />
              <meshBasicMaterial color="#e0f6ff" toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      {/* Bright core */}
      <mesh ref={coreRef} scale={[0.55, 0.55, 0.55]}>
        <sphereGeometry args={[0.55, 20, 20]} />
        <meshStandardMaterial color="#ffffff" emissive={glow} emissiveIntensity={4.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

function PlanetShapeMesh({
  shape,
  glow,
  shellRef,
  coreRef,
}: {
  shape: PlanetShape;
  glow: string;
  shellRef: React.MutableRefObject<THREE.Mesh | null>;
  coreRef: React.MutableRefObject<THREE.Mesh | null>;
}) {
  switch (shape) {
    case "striped":         return <StripedPlanet glow={glow} shellRef={shellRef} coreRef={coreRef} />;
    case "grid":            return <GridPlanet glow={glow} shellRef={shellRef} coreRef={coreRef} />;
    case "crystalCluster":  return <CrystalClusterPlanet glow={glow} shellRef={shellRef} coreRef={coreRef} />;
    case "volcano":         return <VolcanoPlanet glow={glow} shellRef={shellRef} coreRef={coreRef} />;
    case "plasma":          return <PlasmaPlanet glow={glow} shellRef={shellRef} coreRef={coreRef} />;
  }
}

function Planet({
  project,
  index,
  total,
  isActive,
  onSelect,
  onGrab,
}: {
  project: Project;
  index: number;
  total: number;
  isActive: boolean;
  onSelect: (p: Project) => void;
  onGrab: (body: RapierRigidBody, eventPoint: THREE.Vector3) => void;
}) {
  const rb = useRef<RapierRigidBody>(null);
  const group = useRef<THREE.Group>(null);
  const shellRef = useRef<THREE.Mesh | null>(null);
  const coreRef = useRef<THREE.Mesh | null>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const focusIntensity = useRef(0);
  const { camera } = useThree();

  const shape = SHAPE_BY_INDEX[index % SHAPE_BY_INDEX.length];
  const glow = project.glowColor ?? "#ffa040";
  const homePos = useMemo(() => planetHome(index, total), [index, total]);
  const homePosTuple = useMemo<[number, number, number]>(
    () => [homePos[0], homePos[1], homePos[2]],
    [homePos],
  );

  // Only fire the open SFX on transition — no body-type switching.
  // Body is permanently KINEMATIC_POSITION (via <RigidBody type> below), so
  // the useFrame lerp fully controls where it lives at any given moment.
  useEffect(() => {
    if (isActive) playSound("ding", 0.7);
  }, [isActive]);

  const target = useRef(new THREE.Vector3());
  const forward = useRef(new THREE.Vector3());

  useFrame(({ clock }, delta) => {
    const body = rb.current;
    if (!body) return;
    const t = clock.elapsedTime;

    focusIntensity.current = THREE.MathUtils.damp(
      focusIntensity.current,
      isActive ? 1 : 0,
      5,
      delta,
    );
    const fi = focusIntensity.current;

    // --- CRACK OPEN: shell expands outward + fades as focus grows ---
    const shell = shellRef.current;
    if (shell) {
      const shellScale = 1 + fi * 1.2;
      shell.scale.set(
        (shell.userData.baseScale?.x ?? 1) * shellScale,
        (shell.userData.baseScale?.y ?? 1) * shellScale,
        (shell.userData.baseScale?.z ?? 1) * shellScale,
      );
      const mat = shell.material as THREE.Material & { opacity?: number; transparent?: boolean };
      if ("opacity" in mat) {
        mat.transparent = true;
        mat.opacity = Math.max(0, 1 - fi * 0.95);
      }
    }

    // --- Core grows + brightens on focus ---
    const core = coreRef.current;
    if (core) {
      const pulse = 1 + Math.sin(t * 2 + index) * 0.1;
      const mat = core.material as THREE.MeshStandardMaterial;
      if ("emissiveIntensity" in mat) {
        const base = core.userData.baseEmit ?? 2.5;
        mat.emissiveIntensity = base * pulse + fi * 5;
      }
      const base = core.userData.baseScale as THREE.Vector3 | undefined;
      const mul = pulse * (1 + fi * 2.2);
      if (base) {
        core.scale.set(base.x * mul, base.y * mul, base.z * mul);
      }
    }
    if (lightRef.current) {
      lightRef.current.intensity = 0.9 + fi * 6;
    }

    const g = group.current;
    if (g) {
      g.rotation.y += (0.2 + fi * 0.9) * delta;
      // Group scale eases with fi too (tied to the crack progress).
      const gs = 1 + fi * (TUNING.focusScale - 1);
      g.scale.lerp(new THREE.Vector3(gs, gs, gs), delta * 6);
    }

    // --- Position: single lerp from home → presentation, weighted by fi.
    // When fi = 0 (idle): position = home exactly. When fi = 1 (active):
    // position = camera-front. In between: smooth interpolation. This
    // removes the old "teleport to weird spot" bug on modal close. ---
    camera.getWorldDirection(forward.current);
    target.current
      .copy(camera.position)
      .addScaledVector(forward.current, TUNING.focusDistance);
    target.current.y = TUNING.focusHeight;

    const px = THREE.MathUtils.lerp(homePos[0], target.current.x, fi);
    const py = THREE.MathUtils.lerp(homePos[1], target.current.y, fi);
    const pz = THREE.MathUtils.lerp(homePos[2], target.current.z, fi);
    body.setNextKinematicTranslation({ x: px, y: py, z: pz });
  });

  // Record base scale/emit so the focus animation multiplies against them.
  useEffect(() => {
    if (coreRef.current) {
      coreRef.current.userData.baseScale = coreRef.current.scale.clone();
      const m = coreRef.current.material as THREE.MeshStandardMaterial;
      coreRef.current.userData.baseEmit = m.emissiveIntensity ?? 2.5;
    }
    if (shellRef.current) {
      shellRef.current.userData.baseScale = shellRef.current.scale.clone();
    }
  }, []);

  return (
    <RigidBody
      ref={rb}
      position={homePosTuple}
      type="kinematicPosition"
      colliders="hull"
    >
      <group
        ref={group}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (isActive) return;
          onSelect(project);
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <PlanetShapeMesh shape={shape} glow={glow} shellRef={shellRef} coreRef={coreRef} />
        <pointLight ref={lightRef} color={glow} intensity={1} distance={4} decay={2} />
      </group>
    </RigidBody>
  );
}

// -----------------------------------------------------------------------------
// Drag-only cursor (no passive knock)
// -----------------------------------------------------------------------------

type DragState = {
  body: RapierRigidBody;
  offset: THREE.Vector3;
  /** Body's Z at the moment of grab — the drag plane + target use this so
      clicking a piece of debris that's currently at z ≠ 0 doesn't yank it
      across the scene toward z=0 as soon as you grab it. */
  depthZ: number;
  /** Until the first useFrame after grab, we don't know where the cursor
      sits on the drag plane (we only know where the raycast hit the mesh
      surface — a different z). Flag tells DragSystem to initialize offset
      on its next frame from cursor-on-plane minus body-center, so the
      first impulse is zero and the rock doesn't teleport. */
  needsOffsetInit: boolean;
};

function DragSystem({
  dragRef,
  bodies,
  cursorVelRef,
}: {
  dragRef: React.MutableRefObject<DragState | null>;
  bodies: React.MutableRefObject<Array<RapierRigidBody | null>>;
  cursorVelRef: React.MutableRefObject<THREE.Vector3>;
}) {
  const { raycaster, pointer, camera } = useThree();
  // Idle plane (z=0) — used for cursor-velocity tracking when nothing is
  // grabbed. When a grab starts, a second plane is positioned at the
  // body's depth so the cursor maps to that layer.
  const idlePlane = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const idleWorldCursor = useRef(new THREE.Vector3());
  const dragWorldCursor = useRef(new THREE.Vector3());
  const prevCursor = useRef(new THREE.Vector3());
  const lastDrift = useRef(0);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 1 / 30);

    raycaster.setFromCamera(pointer, camera);

    // Idle cursor (always against z=0) — drives cursorVelRef for throws.
    const idleHit = raycaster.ray.intersectPlane(
      idlePlane.current,
      idleWorldCursor.current,
    );
    if (idleHit) {
      cursorVelRef.current
        .subVectors(idleWorldCursor.current, prevCursor.current)
        .divideScalar(Math.max(delta, 0.016));
      prevCursor.current.copy(idleWorldCursor.current);
    }

    // DRAG (explicit only) — plane follows the body's snapshotted Z so we
    // don't yank it toward z=0 when grabbing something at a different depth.
    if (dragRef.current) {
      const drag = dragRef.current;
      const { body, depthZ } = drag;
      // Position the drag plane at the body's grab depth.
      dragPlane.current.constant = -depthZ;
      const dragHit = raycaster.ray.intersectPlane(
        dragPlane.current,
        dragWorldCursor.current,
      );
      if (!dragHit) return;
      const t = body.translation();
      // First frame after grab: compute offset from cursor-on-plane minus
      // body center — guarantees zero initial error so no teleport. Skip
      // the impulse this frame; next frame uses the real offset.
      if (drag.needsOffsetInit) {
        drag.offset.set(
          dragWorldCursor.current.x - t.x,
          dragWorldCursor.current.y - t.y,
          0,
        );
        drag.needsOffsetInit = false;
        return;
      }
      const { offset } = drag;
      const targetX = dragWorldCursor.current.x - offset.x;
      const targetY = dragWorldCursor.current.y - offset.y;
      const targetZ = depthZ;
      // Clamp per-axis error so a big initial offset can't produce a
      // massive impulse spike (the "teleport" bug).
      const MAX_ERR = 2.5;
      const clamp = (e: number) => Math.max(-MAX_ERR, Math.min(MAX_ERR, e));
      const ex = clamp(targetX - t.x);
      const ey = clamp(targetY - t.y);
      const ez = clamp(targetZ - t.z);
      const v = body.linvel();
      const fx = ex * TUNING.dragPullStrength - v.x * TUNING.dragVelocityDamping;
      const fy = ey * TUNING.dragPullStrength - v.y * TUNING.dragVelocityDamping;
      const fz = ez * TUNING.dragPullStrength - v.z * TUNING.dragVelocityDamping;
      body.applyImpulse({ x: fx * delta, y: fy * delta, z: fz * delta }, true);
    }

    // Ambient drift — occasional tiny random nudge so the field breathes.
    const now = performance.now();
    if (now - lastDrift.current > TUNING.driftEveryMs) {
      lastDrift.current = now;
      const live = bodies.current.filter((b): b is RapierRigidBody => !!b);
      for (let k = 0; k < 2; k++) {
        const pick = live[Math.floor(Math.random() * live.length)];
        if (!pick) continue;
        pick.applyImpulse(
          {
            x: (Math.random() - 0.5) * TUNING.driftStrength,
            y: (Math.random() - 0.5) * TUNING.driftStrength,
            z: (Math.random() - 0.5) * TUNING.driftStrength,
          },
          true,
        );
      }
    }
  });
  return null;
}

/** Soft mouse parallax on the camera. */
function CameraParallax() {
  const { camera, pointer } = useThree();
  const base = useRef<THREE.Vector3 | null>(null);
  useFrame((_, delta) => {
    if (!base.current) base.current = camera.position.clone();
    const tx = base.current.x + pointer.x * 0.7;
    const ty = base.current.y + pointer.y * 0.4;
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 3, delta);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 3, delta);
    camera.lookAt(0, 0, 0);
  });
  return null;
}

// -----------------------------------------------------------------------------
// Main scene
// -----------------------------------------------------------------------------

export function CoalScene({
  projects,
  activeId,
  onSelect,
}: {
  projects: Project[];
  activeId: string | null;
  onSelect: (p: Project) => void;
}) {
  const debrisBodies = useRef<Array<RapierRigidBody | null>>([]);
  const dragRef = useRef<DragState | null>(null);
  const cursorVelRef = useRef(new THREE.Vector3());
  // Ref-based OrbitControls toggle — we mutate .enabled directly instead of
  // flipping a React state prop. Avoids a re-render cascade on every grab/
  // release (was contributing to the "Maximum update depth" warnings).
  const orbitRef = useRef<OrbitControlsImpl | null>(null);

  const debrisIndices = useMemo(
    () => Array.from({ length: TUNING.debrisCount }, (_, i) => i),
    [],
  );

  const handleGrab = (body: RapierRigidBody, _eventPoint: THREE.Vector3) => {
    const t = body.translation();
    dragRef.current = {
      body,
      offset: new THREE.Vector3(0, 0, 0), // filled in on first useFrame
      depthZ: t.z,
      needsOffsetInit: true,
    };
    // Kill velocity on grab — avoids the body carrying its pre-grab
    // momentum into the drag controller and flinging itself.
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    body.setLinearDamping(6);
    body.setAngularDamping(4);
    document.body.style.cursor = "grabbing";
    if (orbitRef.current) orbitRef.current.enabled = false;
  };

  useEffect(() => {
    const release = () => {
      const drag = dragRef.current;
      if (drag) {
        drag.body.setLinearDamping(TUNING.debrisLinDamp);
        drag.body.setAngularDamping(TUNING.debrisAngDamp);
        const v = cursorVelRef.current;
        drag.body.applyImpulse({ x: v.x * 0.15, y: v.y * 0.1, z: 0 }, true);
        dragRef.current = null;
        document.body.style.cursor = "";
        playSound("whoosh", 0.25);
      }
      if (orbitRef.current) orbitRef.current.enabled = true;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 13], fov: 52 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", stencil: false }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <Suspense fallback={null}>
        <color attach="background" args={["#02030a"]} />

        <ambientLight intensity={0.3} />
        <hemisphereLight args={["#2030a0", "#020204", 0.4]} />
        <directionalLight position={[8, 4, 6]} intensity={0.7} color="#e0e6ff" />
        <pointLight position={[0, 0, 4]} intensity={1.0} color="#aa80ff" distance={14} />
        <fog attach="fog" args={["#02030a", 16, 38]} />

        {/* === STAGED SPAWN-IN on mount (for seamless Studio→Work arrival) ===
            Each layer fades in at its own delay so stars appear first,
            nebulas second, deep background third, then planets + debris
            last. Total spawn window ~2.2s. */}

        {/* Stage 1 — stars fade in fast and early. */}
        <SceneFadeIn delay={0} duration={900}>
          <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={0.5} />
        </SceneFadeIn>

        {/* Stage 2 — screenwide procedural nebulas. All 3D point-cloud
            structures modelled on real nebula morphologies. */}
        <SceneFadeIn delay={400} duration={1400}>
          <MajorNebulas />
        </SceneFadeIn>

        {/* Stage 3 — dust + distant bg + shooting stars. */}
        <SceneFadeIn delay={700} duration={1100}>
          <DustField count={280} />
          <DistantBackground />
        </SceneFadeIn>

        {/* Shooting stars live OUTSIDE SceneFadeIn — their meshes start at
            opacity 0 on purpose (invisible until active) so the fade-in
            wrapper would mistake that as "final" and never let them shine. */}
        <ShootingStar index={0} />
        <ShootingStar index={1} />
        <ShootingStar index={2} />
        <ShootingStar index={3} />
        <ShootingStar index={4} />

        <Physics gravity={GRAVITY_ZERO}>
          <Arena />
          {/* Stage 4 — foreground interactive: planets appear, then debris. */}
          <SceneFadeIn delay={1000} duration={1100}>
            {projects.map((p, i) => (
              <Planet
                key={p.id}
                project={p}
                index={i}
                total={projects.length}
                isActive={activeId === p.id}
                onSelect={onSelect}
                onGrab={handleGrab}
              />
            ))}
          </SceneFadeIn>
          <SceneFadeIn delay={1350} duration={1000}>
            {debrisIndices.map((i) => (
              <Debris
                key={`debris-${i}`}
                index={i}
                bodyRefs={debrisBodies}
                onGrab={handleGrab}
              />
            ))}
          </SceneFadeIn>
          <DragSystem
            dragRef={dragRef}
            bodies={debrisBodies}
            cursorVelRef={cursorVelRef}
          />
        </Physics>

        {/* Grab-air to rotate the scene. `.enabled` gets flipped directly on
            the ref during grab/release so we don't cascade React re-renders. */}
        <OrbitControls
          ref={orbitRef}
          enableZoom={false}
          enablePan={false}
          rotateSpeed={0.45}
          dampingFactor={0.08}
          enableDamping
          minPolarAngle={Math.PI / 2 - 0.35}
          maxPolarAngle={Math.PI / 2 + 0.35}
          minAzimuthAngle={-0.55}
          maxAzimuthAngle={0.55}
        />
      </Suspense>
    </Canvas>
  );
}
