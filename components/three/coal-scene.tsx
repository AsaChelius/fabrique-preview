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
import {
  EffectComposer,
  Bloom,
  Outline,
  Selection,
  Select,
} from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
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

  useEffect(() => {
    if (!ref.current) return;
    const mats: Array<THREE.Material & { userData: { _initialOpacity?: number } }> = [];
    ref.current.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.material) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        const mat = m as THREE.Material & { userData: { _initialOpacity?: number }; opacity?: number };
        if (!mat.userData) mat.userData = {};
        mat.userData._initialOpacity = (mat as { opacity?: number }).opacity ?? 1;
        mat.transparent = true;
        (mat as { opacity: number }).opacity = 0;
        mats.push(mat);
      }
    });
    matsRef.current = mats;
    startTime.current = performance.now();
  }, []);

  useFrame(() => {
    const elapsed = performance.now() - startTime.current - delay;
    const t = Math.max(0, Math.min(1, elapsed / duration));
    const eased = t * t * (3 - 2 * t); // smoothstep
    for (const mat of matsRef.current) {
      const initial = mat.userData._initialOpacity ?? 1;
      (mat as { opacity: number }).opacity = initial * eased;
    }
  });

  return <group ref={ref}>{children}</group>;
}

// -----------------------------------------------------------------------------
// Background: nebulas + dust + shooting stars
// -----------------------------------------------------------------------------

/**
 * Image-textured nebula billboard — the only realistic way to hit JWST-
 * quality visuals is to use actual JWST / Hubble / ESA imagery. They're all
 * public-domain and hosted at stsci-opo.org, esawebb.org, webb.nasa.gov.
 *
 * Usage: drop a .jpg/.png into `/public/nebulas/` and pass its path (e.g.
 * `/nebulas/carina.jpg`). Falls back gracefully — if the file is missing
 * the Suspense stays pending and nothing renders for that nebula.
 *
 * Recommended sources (right-click → save):
 *   • https://esawebb.org/images/weic2205b/      (Carina — orange/rust)
 *   • https://esawebb.org/images/weic2208c/      (Tarantula — blue/teal)
 *   • https://esawebb.org/images/weic2316a/      (Ring Nebula)
 *   • https://esawebb.org/images/weic2310a/      (Pillars of Creation)
 *   • https://esawebb.org/images/weic2417a/      (NGC 604)
 */
function NebulaImage({
  url,
  position,
  scale,
  opacity = 0.75,
  tint = "#ffffff",
  spinSpeed = 0.005,
  initialRotation = 0,
  flipX = false,
}: {
  url: string;
  position: [number, number, number];
  scale: number | [number, number];
  opacity?: number;
  tint?: string;
  spinSpeed?: number;
  /** Static Z rotation applied once on mount — lets the same texture appear
      different when reused. Combined with `flipX`, gives four "looks" per file. */
  initialRotation?: number;
  /** Mirror horizontally so the same nebula reads differently on reuse. */
  flipX?: boolean;
}) {
  // Manual TextureLoader — render the glow even on 404 so the scene always
  // has nebula color, and log load outcome so we can tell from the console
  // whether the file is the problem or the shader is.
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    let cancelled = false;
    loader.load(
      url,
      (tex) => {
        if (cancelled) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        setTexture(tex);
        console.info("[nebula] loaded", url, tex.image?.width, "x", tex.image?.height);
      },
      undefined,
      (err) => {
        if (cancelled) return;
        console.warn("[nebula] FAILED to load", url, err);
        setTexture(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    if (ref.current) ref.current.rotation.z = initialRotation;
  }, [initialRotation]);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * spinSpeed;
  });

  const [w, h] = typeof scale === "number" ? [scale, scale] : scale;
  // Fallback glow scale — a hair smaller than the image plane so when both
  // render they layer naturally instead of the sphere poking through edges.
  const glowR = Math.max(w, h) * 0.42;
  return (
    <group ref={ref} position={position}>
      {/* Ambient glow sphere — renders regardless of texture state so the
          scene has colored nebula presence even if the PNG 404's or the
          GPU hates the shader. Additive meshBasicMaterial, no custom
          pipeline, no shaderMaterial weirdness. */}
      <mesh>
        <sphereGeometry args={[glowR, 24, 24]} />
        <meshBasicMaterial
          color={tint}
          transparent
          opacity={opacity * 0.45}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Textured billboard — only mounts once the PNG has loaded. Uses
          Three's built-in unlit textured material (known-working path) with
          the tint applied via `color` (multiplies with texture RGB) and
          additive blend so the square plane edges go invisible where the
          PNG's space-black background sits. DoubleSide so flipX (scale.x
          = -1) doesn't get back-face culled. */}
      {texture && (
        <mesh scale={[flipX ? -1 : 1, 1, 1]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial
            map={texture}
            color={tint}
            transparent
            opacity={opacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  );
}

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
      <mesh>
        <sphereGeometry args={[1, 20, 20]} />
        <meshStandardMaterial
          color={color}
          roughness={0.6}
          metalness={0.2}
          emissive={color}
          emissiveIntensity={0.25}
        />
      </mesh>
      {ringed && (
        <mesh rotation={[Math.PI / 2.3, 0, 0.2]}>
          <ringGeometry args={[1.35, 1.8, 48]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.35}
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

/** Wrapper for the distant background garnish. */
function DistantBackground() {
  return (
    <>
      <DistantPlanet position={[-16, 5, -28]} scale={1.8} color="#3d5ac2" />
      <DistantPlanet position={[19, 4, -32]} scale={2.4} color="#c23d9e" ringed />
      <DistantPlanet position={[-8, -9, -35]} scale={1.2} color="#d6a040" />
      <DistantPlanet position={[14, -7, -38]} scale={2} color="#40c28a" />
      <DistantPlanet position={[6, 8, -42]} scale={0.9} color="#a240ff" />
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
      <Select enabled>
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
      </Select>
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

        {/* Stage 2 — nebulas layer in next.
            All five are the same cat's-eye texture, heavily disguised via
            per-instance rotation + flipX + tint + scale. Real astrophotography
            (even reused) beats any procedural gradient. */}
        <SceneFadeIn delay={400} duration={1400}>
          <NebulaImage
            url="/nebulas/cats-eye.png"
            position={[-12, 4, -24]}
            scale={24}
            opacity={0.92}
            tint="#a8c8ff"
            spinSpeed={0.003}
            initialRotation={0.4}
          />
          <NebulaImage
            url="/nebulas/cats-eye.png"
            position={[16, -3, -30]}
            scale={30}
            opacity={0.68}
            tint="#ffb0d4"
            spinSpeed={-0.002}
            initialRotation={2.1}
            flipX
          />
          <NebulaImage
            url="/nebulas/cats-eye.png"
            position={[-18, -7, -22]}
            scale={18}
            opacity={0.55}
            tint="#ffc080"
            spinSpeed={0.0018}
            initialRotation={5.0}
          />
          <NebulaImage
            url="/nebulas/cats-eye.png"
            position={[18, 9, -27]}
            scale={16}
            opacity={0.6}
            tint="#8be0ff"
            spinSpeed={-0.0025}
            initialRotation={3.7}
            flipX
          />
          <NebulaImage
            url="/nebulas/cats-eye.png"
            position={[-2, -4, -36]}
            scale={34}
            opacity={0.42}
            tint="#c8a8ff"
            spinSpeed={0.0012}
            initialRotation={1.45}
          />
        </SceneFadeIn>

        {/* Stage 3 — dust + distant bg + shooting stars. */}
        <SceneFadeIn delay={700} duration={1100}>
          <DustField count={280} />
          <DistantBackground />
          <ShootingStar index={0} />
          <ShootingStar index={1} />
          <ShootingStar index={2} />
        </SceneFadeIn>

        <Selection>
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

          <EffectComposer multisampling={0}>
            <Outline
              visibleEdgeColor={0xffffff}
              hiddenEdgeColor={0x88aaff}
              edgeStrength={8}
              pulseSpeed={0.45}
              blur={false}
              xRay={false}
            />
            <Bloom
              intensity={0.75}
              luminanceThreshold={0.4}
              luminanceSmoothing={0.22}
              mipmapBlur
            />
          </EffectComposer>
        </Selection>

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
