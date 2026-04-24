"use client";

/**
 * "Contact" route — dark room, single plinth, retro CRT.
 *
 * Arrive on page: the camera sits in darkness, a single warm spotlight
 * illuminates a tall plinth with an old beige-ish CRT monitor on top.
 * Everything outside the beam is pitch-black except for slow visual
 * hallucinations at the edges — floaters, phantom shapes, retinal noise,
 * the stuff your eyes invent when they're starved for light.
 *
 * Click the monitor → camera glides in until the CRT screen fills the
 * frame. The screen powers on with a Windows 98-style contact form
 * rendered as a drei <Html transform> attached to the screen plane.
 * Click the X to close → camera glides back out.
 *
 * All 3D. Fields still POST to /api/contact (backend lane unchanged).
 */

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { playSound, startLoop, setLoopVolume, stopLoop } from "@/lib/sound";
import type { ContactFormData, ContactFormResponse } from "@/types/contact";

type View = "overview" | "computer";
type ScreenState = "boot" | "loading" | "form";
const TABLE_TOP_Y = 2.25;
// Ground drops BELOW y=0 so the setup "hangs" higher in frame without
// moving the camera. Table legs stretch to reach this new floor; the
// spotlight beam extends down to it too.
const GROUND_Y = -1.4;

// -----------------------------------------------------------------------------
// Wooden table — visible structure (legs, apron, grain). Replaces the plinth.
// -----------------------------------------------------------------------------

/** Small procedural wood canvas texture — quick warm grain pattern so the
    top surface reads as a real wooden plank, not a flat brown mesh. */
function useWoodTexture(): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const w = 512;
    const h = 256;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    // Base warm brown
    ctx.fillStyle = "#5a3a20";
    ctx.fillRect(0, 0, w, h);
    // Vertical plank seams
    const planks = 4;
    for (let i = 1; i < planks; i++) {
      ctx.fillStyle = "#1e1008";
      ctx.fillRect((i * w) / planks - 1, 0, 2, h);
    }
    // Horizontal grain streaks — long dark bands with random curvature
    for (let i = 0; i < 120; i++) {
      const y = Math.random() * h;
      const amp = 3 + Math.random() * 6;
      const shade = 30 + Math.random() * 60;
      ctx.strokeStyle = `rgba(${shade}, ${shade * 0.55}, ${shade * 0.3}, ${0.35 + Math.random() * 0.4})`;
      ctx.lineWidth = 0.5 + Math.random() * 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < w; x += 4) {
        ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * amp);
      }
      ctx.stroke();
    }
    // Sparse knots
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 3 + Math.random() * 7;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, "rgba(20,8,0,0.8)");
      grd.addColorStop(1, "rgba(60,30,10,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1.2, 0.6);
    return tex;
  }, []);
}

function WoodenTable() {
  const wood = useWoodTexture();
  const TOP_W = 1.7;
  const TOP_D = 1.25;
  const TOP_THICK = 0.1;
  const TOP_Y = TABLE_TOP_Y;
  const LEG_W = 0.1;
  // Legs reach from the (now lower) ground up to the underside of the top.
  const LEG_H = TOP_Y - TOP_THICK - GROUND_Y;
  const LEG_CENTER_Y = GROUND_Y + LEG_H / 2;
  const APRON_H = 0.22;
  const legColor = "#3a2410";
  return (
    <group position={[0, 0, 0]}>
      {/* Tabletop */}
      <mesh position={[0, TOP_Y - TOP_THICK / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[TOP_W, TOP_THICK, TOP_D]} />
        <meshStandardMaterial
          map={wood ?? undefined}
          color={wood ? "#ffffff" : "#5a3a20"}
          metalness={0.05}
          roughness={0.78}
        />
      </mesh>
      {/* Front apron (skirt) — narrow horizontal board under the top */}
      <mesh
        position={[0, TOP_Y - TOP_THICK - APRON_H / 2, TOP_D / 2 - 0.08]}
        castShadow
      >
        <boxGeometry args={[TOP_W - 0.2, APRON_H, 0.05]} />
        <meshStandardMaterial color={legColor} metalness={0.08} roughness={0.7} />
      </mesh>
      {/* Side aprons */}
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * (TOP_W / 2 - 0.08), TOP_Y - TOP_THICK - APRON_H / 2, 0]}
          castShadow
        >
          <boxGeometry args={[0.05, APRON_H, TOP_D - 0.2]} />
          <meshStandardMaterial color={legColor} metalness={0.08} roughness={0.7} />
        </mesh>
      ))}
      {/* Back apron */}
      <mesh
        position={[0, TOP_Y - TOP_THICK - APRON_H / 2, -(TOP_D / 2 - 0.08)]}
        castShadow
      >
        <boxGeometry args={[TOP_W - 0.2, APRON_H, 0.05]} />
        <meshStandardMaterial color={legColor} metalness={0.08} roughness={0.7} />
      </mesh>
      {/* Four legs at the corners */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh
          key={i}
          position={[
            sx * (TOP_W / 2 - LEG_W / 2 - 0.02),
            LEG_CENTER_Y,
            sz * (TOP_D / 2 - LEG_W / 2 - 0.02),
          ]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[LEG_W, LEG_H, LEG_W]} />
          <meshStandardMaterial color={legColor} metalness={0.06} roughness={0.75} />
        </mesh>
      ))}
    </group>
  );
}

// -----------------------------------------------------------------------------
// CRT Monitor — beige chunky 90s style. Rounded front bezel + recessed
// screen + ventilation slits on top + a power LED + brand label.
// -----------------------------------------------------------------------------

function CRTMonitor({
  view,
  onClickScreen,
  screenNode,
}: {
  view: View;
  onClickScreen: () => void;
  screenNode: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const ledRef = useRef<THREE.Mesh>(null);
  const screenMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const W = 1.15;
  const H = 0.95;
  const D_FRONT = 0.85;
  const D_BACK = 0.55;
  const beige = "#d8cdb4";
  const beigeDark = "#b5aa90";

  // Screen is ALWAYS on (Win98 booted by default). Slight flicker for life.
  useFrame(({ clock }) => {
    if (!screenMatRef.current) return;
    const target = 1.8 + Math.sin(clock.elapsedTime * 0.7) * 0.08;
    screenMatRef.current.emissiveIntensity = THREE.MathUtils.damp(
      screenMatRef.current.emissiveIntensity,
      target,
      3,
      0.016,
    );
    if (ledRef.current) {
      const mat = ledRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 1;
    }
  });

  // Sit the CRT on the tabletop — monitor center-y is at TOP + base + H/2.
  return (
    <group position={[0, TABLE_TOP_Y + 0.08 + H / 2, 0]}>
      {/* Main case — box tapering back (approximated as a trapezoid-ish
          shape using a box with a shifted back — we fake the taper with
          separate front bezel mesh). */}
      <mesh position={[0, 0, -0.05]} castShadow receiveShadow>
        <boxGeometry args={[W * 0.9, H * 0.88, D_BACK]} />
        <meshStandardMaterial color={beigeDark} metalness={0.1} roughness={0.7} />
      </mesh>
      {/* Front bezel — fatter, slightly glossier */}
      <mesh position={[0, 0, D_FRONT / 2 - 0.3]} castShadow>
        <boxGeometry args={[W, H, 0.3]} />
        <meshStandardMaterial color={beige} metalness={0.15} roughness={0.55} />
      </mesh>
      {/* Recessed screen area — slightly darker frame */}
      <mesh position={[0, 0.04, D_FRONT / 2 - 0.15]}>
        <boxGeometry args={[W * 0.82, H * 0.62, 0.05]} />
        <meshStandardMaterial color="#2a261c" metalness={0.2} roughness={0.6} />
      </mesh>
      {/* Screen surface — always emissive (Win98 is always booted). Acts
          as the click target when in overview state. */}
      <mesh
        position={[0, 0.04, D_FRONT / 2 - 0.12]}
        onClick={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          if (view === "overview") onClickScreen();
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = view === "overview" ? "pointer" : "default";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "";
        }}
      >
        <planeGeometry args={[W * 0.76, H * 0.58]} />
        <meshStandardMaterial
          ref={screenMatRef}
          color="#1a3d62"
          emissive="#1a3d62"
          emissiveIntensity={0}
          metalness={0.05}
          roughness={0.18}
          toneMapped={false}
        />
      </mesh>
      {/* Hover ring in overview state — gold glow on the bezel */}
      {hovered && view === "overview" && (
        <mesh position={[0, 0.04, D_FRONT / 2 - 0.118]}>
          <planeGeometry args={[W * 0.79, H * 0.61]} />
          <meshBasicMaterial
            color="#ffd080"
            transparent
            opacity={0.16}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Win98 UI on the screen — drei Html in transform mode. Explicit
          scale so the 680px DOM element maps to the ~0.87-unit screen
          plane (680 * 0.0013 ≈ 0.88). distanceFactor misbehaved in
          transform mode and rendered the DOM at 1 px = 1 scene unit,
          which filled the whole viewport with teal. */}
      <Html
        position={[0, 0.04, D_FRONT / 2 - 0.115]}
        transform
        scale={0.002}
        pointerEvents={view === "computer" ? "auto" : "none"}
        wrapperClass="crt-html"
        zIndexRange={[0, 10]}
      >
        <div className="crt-screen is-on">{screenNode}</div>
      </Html>

      {/* Vents on top — dark slits */}
      <group position={[0, H / 2, -0.05]}>
        {Array.from({ length: 5 }).map((_, i) => (
          <mesh key={i} position={[(i - 2) * 0.15, 0.001, 0]}>
            <boxGeometry args={[0.12, 0.005, 0.28]} />
            <meshStandardMaterial color="#04040a" metalness={0.2} roughness={0.8} />
          </mesh>
        ))}
      </group>

      {/* Brand label strip — bottom center */}
      <mesh position={[0, -H * 0.42, D_FRONT / 2 - 0.04]}>
        <boxGeometry args={[0.22, 0.05, 0.02]} />
        <meshStandardMaterial color="#8a8270" metalness={0.3} roughness={0.4} />
      </mesh>
      {/* Power LED */}
      <mesh ref={ledRef} position={[W / 2 - 0.09, -H * 0.42, D_FRONT / 2 - 0.04]}>
        <sphereGeometry args={[0.018, 10, 10]} />
        <meshBasicMaterial color="#40ff60" transparent opacity={0.85} toneMapped={false} />
      </mesh>

      {/* Small base/stand under the monitor */}
      <mesh position={[0, -H / 2 - 0.04, 0]} castShadow>
        <boxGeometry args={[W * 0.7, 0.08, D_FRONT * 0.7]} />
        <meshStandardMaterial color={beigeDark} metalness={0.15} roughness={0.6} />
      </mesh>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Camera controller — lerps between overview and close-up of screen
// -----------------------------------------------------------------------------

function CameraRig({ view }: { view: View }) {
  const { pointer } = useThree();
  const basePos = useRef(new THREE.Vector3(5.8, 3.3, 15.5));
  const baseLook = useRef(new THREE.Vector3(-0.2, 1.8, 0));
  const offset = useRef(new THREE.Vector3());
  useFrame(({ camera }, delta) => {
    if (view === "computer") {
      basePos.current.set(0, TABLE_TOP_Y + 0.55, 2.3);
      baseLook.current.set(0, TABLE_TOP_Y + 0.55, 0);
    } else {
      basePos.current.set(5.8, 3.3, 15.5);
      baseLook.current.set(-0.2, 1.8, 0);
    }
    // Mouse parallax tilt — translate the camera by a small amount
    // proportional to cursor position for a subtle 3D-tilt feel.
    // Stronger in overview than in form state (less distracting when
    // typing). Lerp offset so motion is smooth.
    const tiltScale = view === "overview" ? 1 : 0.2;
    offset.current.x = THREE.MathUtils.damp(
      offset.current.x,
      pointer.x * 0.7 * tiltScale,
      3,
      delta,
    );
    offset.current.y = THREE.MathUtils.damp(
      offset.current.y,
      pointer.y * 0.35 * tiltScale,
      3,
      delta,
    );
    const tx = basePos.current.x + offset.current.x;
    const ty = basePos.current.y + offset.current.y;
    camera.position.lerp(
      new THREE.Vector3(tx, ty, basePos.current.z),
      Math.min(1, delta * 2.4),
    );
    camera.lookAt(baseLook.current);
  });
  return null;
}

// -----------------------------------------------------------------------------
// Spotlight rig — single warm cone from above, clips the visible beam
// -----------------------------------------------------------------------------

function SpotlightRig() {
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current;
    }
  }, []);
  return (
    <>
      <ambientLight intensity={0.02} color="#303846" />
      <spotLight
        ref={spotRef}
        position={[0, 8.6, 1.4]}
        angle={0.42}
        penumbra={0.55}
        intensity={220}
        distance={18}
        decay={1.6}
        color="#ffdba0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <object3D ref={targetRef} position={[0, 0, 0.3]} />
      {/* Warm front fill — makes the beige front of the monitor readable
          against the dark (spotlight from directly above doesn't hit
          the front-facing normals at all). */}
      <pointLight position={[2.5, 3.0, 6.5]} color="#ffd8a0" intensity={1.6} distance={9} decay={1.6} />
    </>
  );
}

// -----------------------------------------------------------------------------
// Flicker — occasional dim of the spotlight + flicker sound
// -----------------------------------------------------------------------------

/** Audio driver — starts the ambient drone + CRT hum on first render,
    updates the CRT hum volume based on camera distance to the monitor.
    Closer camera = louder hum. Also handles cleanup on unmount. */
function ContactAudio() {
  const { camera } = useThree();
  const monitorPos = useMemo(() => new THREE.Vector3(0, TABLE_TOP_Y + 0.55, 0), []);
  useEffect(() => {
    startLoop("contact-ambient");
    startLoop("contact-crt-hum");
    setLoopVolume("contact-ambient", 0.6);
    return () => {
      stopLoop("contact-ambient");
      stopLoop("contact-crt-hum");
    };
  }, []);
  useFrame(() => {
    const d = camera.position.distanceTo(monitorPos);
    // Steep cubic falloff — silent in overview (d > ~10), rises decisively
    // only when the camera has zoomed to the screen. No audible floor at
    // distance — the buzz should feel like a property of being NEXT to
    // the monitor, not a constant background tone.
    const near = 2.0;
    const far = 10.5;
    const t = Math.max(0, Math.min(1, (far - d) / (far - near)));
    setLoopVolume("contact-crt-hum", t * t * t * 0.95);
  });
  return null;
}

/** Light flicker — the spotlight physically toggles ON/OFF in discrete
 *  pulses (not random jitter). Off periods are longer than on flashes so
 *  the beam reads as a lamp struggling to stay lit, not a rave strobe.
 *  The last pulse of every flicker event is OFF, so the light "snaps
 *  back on" at the end — the sound layer sells the electrical character. */
function SpotlightFlicker() {
  const { scene } = useThree();
  const state = useRef({
    nextAt: performance.now() + 4000,
    flickerUntil: 0,
    isOff: false,
    nextSwitchAt: 0,
  });
  const NOMINAL = 220;
  useFrame(() => {
    const s = state.current;
    const now = performance.now();
    const spot = scene.getObjectByProperty("isSpotLight", true) as
      | THREE.SpotLight
      | undefined;
    if (!spot) return;
    if (now > s.nextAt) {
      s.flickerUntil = now + 700 + Math.random() * 500;
      s.nextAt = now + 7000 + Math.random() * 8000;
      s.isOff = true;
      s.nextSwitchAt = now + 70 + Math.random() * 100;
      playSound("flicker", 0.65);
    }
    if (now < s.flickerUntil) {
      if (now > s.nextSwitchAt) {
        s.isOff = !s.isOff;
        // Off pulses last longer than on pulses — dying light, not strobe.
        s.nextSwitchAt = now + (s.isOff ? 70 + Math.random() * 160 : 25 + Math.random() * 60);
      }
      spot.intensity = s.isOff ? 0 : NOMINAL;
    } else {
      spot.intensity = THREE.MathUtils.damp(spot.intensity, 180, 8, 0.016);
    }
  });
  return null;
}

/** Visible beam — additive cone from the spotlight source (y=8.6) down
    to the (lowered) floor at GROUND_Y. Base radius scales with height so
    the cone spread still matches the spotlight angle. */
function LightBeam() {
  const SRC_Y = 8.6;
  const height = SRC_Y - GROUND_Y;
  const radius = 2.8 * (height / 8.6);
  const centerY = (SRC_Y + GROUND_Y) / 2;
  return (
    <mesh position={[0, centerY, 0.2]}>
      <coneGeometry args={[radius, height, 48, 1, true]} />
      <meshBasicMaterial
        color="#ffd890"
        transparent
        opacity={0.05}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Ground — full dark plank floor. Sits below y=0 so the table + CRT
    visibly "hang" above a deeper floor, giving the scene more vertical
    real estate without pulling the camera in. */
function Ground() {
  const wood = useWoodTexture();
  return (
    <mesh
      position={[0, GROUND_Y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial
        map={wood ?? undefined}
        color={wood ? "#4a3020" : "#2a1c10"}
        metalness={0.05}
        roughness={0.9}
      />
    </mesh>
  );
}

/** Warm pool disc — slightly above the ground so the spotlight has a
    readable bright catch on the rough wood. Radius scales with the
    deeper cone. */
function SpotlightFloor() {
  const SRC_Y = 8.6;
  const radius = 2.9 * ((SRC_Y - GROUND_Y) / 8.6);
  return (
    <mesh position={[0, GROUND_Y + 0.01, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 48]} />
      <meshBasicMaterial
        color="#ffdba0"
        transparent
        opacity={0.12}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// -----------------------------------------------------------------------------
// Dark illusions — what the eye invents in the void
// -----------------------------------------------------------------------------

/** Floaters — tiny translucent dots drifting slowly, as if in the viewer's
    own eye. Random walks, occasionally reset. */
function Floaters() {
  const ref = useRef<THREE.Points>(null);
  const { pointer, camera } = useThree();
  const { geometry, vels, homes } = useMemo(() => {
    const N = 50;
    const pos = new Float32Array(N * 3);
    const home = new Float32Array(N * 3);
    const vs = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 18;
      // Constrained to y > 0 so floaters don't show below the ground plane
      const y = 0.4 + Math.random() * 7.5;
      const z = (Math.random() - 0.5) * 4 - 1;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      home[i * 3] = x; home[i * 3 + 1] = y; home[i * 3 + 2] = z;
      vs[i * 3] = (Math.random() - 0.5) * 0.08;
      vs[i * 3 + 1] = (Math.random() - 0.5) * 0.06;
      vs[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geometry: g, vels: vs, homes: home };
  }, []);
  const cursorWorld = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const attr = geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    // Project cursor to a plane at z=0 for the repulsion calc
    cursorWorld.set(pointer.x, pointer.y, 0.5).unproject(camera);
    const dir = cursorWorld.clone().sub(camera.position).normalize();
    const tToZ0 = -camera.position.z / dir.z;
    const cx = camera.position.x + dir.x * tToZ0;
    const cy = camera.position.y + dir.y * tToZ0;
    for (let i = 0; i < arr.length; i += 3) {
      // Slow idle drift + recenter toward home position
      arr[i] += vels[i] * delta;
      arr[i + 1] += vels[i + 1] * delta;
      const toHomeX = homes[i] - arr[i];
      const toHomeY = homes[i + 1] - arr[i + 1];
      arr[i] += toHomeX * 0.6 * delta;
      arr[i + 1] += toHomeY * 0.6 * delta;
      // Mouse repulsion — floaters get pushed by the cursor passing near.
      const dx = arr[i] - cx;
      const dy = arr[i + 1] - cy;
      const d2 = dx * dx + dy * dy;
      const R = 2.5;
      if (d2 < R * R && d2 > 0.001) {
        const d = Math.sqrt(d2);
        const force = ((R - d) / R) * 3 * delta;
        arr[i] += (dx / d) * force;
        arr[i + 1] += (dy / d) * force;
      }
    }
    attr.needsUpdate = true;
  });
  return (
    <points ref={ref}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={4}
        color="#a0b8e0"
        transparent
        opacity={0.7}
        sizeAttenuation={false}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

/** Retinal noise — fine grain scattered in the frustum. Slow swirl. */
function RetinalNoise() {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const N = 600;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = 0.3 + Math.random() * 12; // above ground only
      pos[i * 3 + 2] = (Math.random() - 0.5) * 14 - 5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.01;
  });
  return (
    <points ref={ref}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={1.8}
        color="#6a80a8"
        transparent
        opacity={0.75}
        sizeAttenuation={false}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

/** Phantom cloud — a dim blob of points that slowly breathes. A couple of
    these at the periphery make it feel like clouds looming in the dark. */
type PhantomShape = "figure" | "eye" | "hand" | "scribble" | "spiral" | "crescent";

/** Generate a "weird shape" point cloud — five shape variants dialed to
    read as half-seen somethings in the dark, not uniform blobs. Each
    returns N (x,y,z) triplets in a 1-ish-unit footprint. */
function genPhantomShape(shape: PhantomShape, N: number, seed: number) {
  const rng = (n: number) => {
    const x = Math.sin(seed + n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  let k = 0;
  const r = () => rng(k++);
  const pts = new Float32Array(N * 3);
  const set = (i: number, x: number, y: number, z: number) => {
    pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z;
  };
  if (shape === "figure") {
    // Tall humanoid silhouette — head, torso, suggestion of arms
    const headN = Math.floor(N * 0.22);
    const bodyN = Math.floor(N * 0.55);
    const armN = N - headN - bodyN;
    for (let i = 0; i < headN; i++) {
      const theta = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * 0.3;
      set(i, Math.cos(theta) * rr, 1.1 + Math.sin(theta) * rr, (r() - 0.5) * 0.15);
    }
    for (let i = 0; i < bodyN; i++) {
      const t = r();
      const w = 0.45 * (1 - t * 0.3);
      set(headN + i, (r() - 0.5) * w * 2, 0.7 - t * 1.5, (r() - 0.5) * 0.2);
    }
    for (let i = 0; i < armN; i++) {
      const side = r() > 0.5 ? 1 : -1;
      const t = r();
      set(
        headN + bodyN + i,
        side * (0.5 + t * 0.9),
        0.55 - t * 1.4 + (r() - 0.5) * 0.25,
        (r() - 0.5) * 0.2,
      );
    }
  } else if (shape === "eye") {
    // Almond eye shape — outline + iris + pupil
    for (let i = 0; i < N * 0.6; i++) {
      // Outline — ellipse with some edge noise, biased toward lids
      const t = r();
      const theta = t * Math.PI * 2;
      const rr = 1 + (r() - 0.5) * 0.1;
      const x = Math.cos(theta) * rr;
      const y = Math.sin(theta) * rr * 0.45;
      set(i, x, y, (r() - 0.5) * 0.1);
    }
    // Iris ring
    for (let i = N * 0.6; i < N * 0.88; i++) {
      const theta = r() * Math.PI * 2;
      const rr = 0.32 + r() * 0.06;
      set(i, Math.cos(theta) * rr, Math.sin(theta) * rr * 0.9, (r() - 0.5) * 0.08);
    }
    // Pupil (dense center)
    for (let i = N * 0.88; i < N; i++) {
      set(i, (r() - 0.5) * 0.14, (r() - 0.5) * 0.14, (r() - 0.5) * 0.05);
    }
  } else if (shape === "hand") {
    // 5-finger hand — palm cluster + 5 elongated fingers
    for (let i = 0; i < N * 0.3; i++) {
      // Palm
      set(i, (r() - 0.5) * 0.7, -0.3 + (r() - 0.5) * 0.5, (r() - 0.5) * 0.2);
    }
    const perFinger = Math.floor((N * 0.7) / 5);
    const fingerAngles = [-0.5, -0.25, 0, 0.25, 0.5];
    for (let f = 0; f < 5; f++) {
      const baseX = fingerAngles[f] * 0.7;
      for (let j = 0; j < perFinger; j++) {
        const t = r();
        const dx = (r() - 0.5) * 0.08;
        set(
          N * 0.3 + f * perFinger + j,
          baseX + dx + fingerAngles[f] * t * 0.3,
          0.0 + t * 1.0,
          (r() - 0.5) * 0.15,
        );
      }
    }
  } else if (shape === "scribble") {
    // Chaotic wandering path — random-walk points connected by proximity
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < N; i++) {
      x += (r() - 0.5) * 0.35;
      y += (r() - 0.5) * 0.35;
      z += (r() - 0.5) * 0.15;
      // Pull back toward origin so it stays contained
      x *= 0.98; y *= 0.98; z *= 0.95;
      set(i, x, y, z);
    }
  } else if (shape === "spiral") {
    // Outward logarithmic spiral
    for (let i = 0; i < N; i++) {
      const t = i / N;
      const theta = t * Math.PI * 6;
      const rr = t * 1.3;
      const jitter = (r() - 0.5) * 0.08;
      set(i, Math.cos(theta) * rr + jitter, Math.sin(theta) * rr + jitter, (r() - 0.5) * 0.15);
    }
  } else {
    // Crescent — partial thick arc
    for (let i = 0; i < N; i++) {
      const theta = (r() * 0.9 - 0.45) * Math.PI + Math.PI / 2;
      const rr = 1 + (r() - 0.5) * 0.3;
      set(i, Math.cos(theta) * rr, Math.sin(theta) * rr, (r() - 0.5) * 0.15);
    }
  }
  return pts;
}

/** Sand-like hallucination cloud.
 *
 * The cursor passes *through* these patches. Each grain is tracked and
 * pushed individually when the cursor's projected world-position gets
 * close; grains slowly settle back toward their home positions. The
 * group itself never moves — the whole effect comes from per-point
 * buffer-attribute updates. */
function PhantomCloud({
  position,
  tint,
  seed = 0,
  scale = 1,
  shape = "figure",
}: {
  position: [number, number, number];
  tint: string;
  seed?: number;
  scale?: number;
  shape?: PhantomShape;
}) {
  const ref = useRef<THREE.Points>(null);
  const { pointer, camera } = useThree();
  const { geometry, homes } = useMemo(() => {
    const N = 110;
    const pts = genPhantomShape(shape, N, seed);
    const h = new Float32Array(pts);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    return { geometry: g, homes: h };
  }, [shape, seed]);
  const cursorWorld = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    if (!ref.current) return;
    // Project cursor to world then into cloud-local space (points live in
    // local coords; the group's scale maps them to world size).
    cursorWorld.set(pointer.x, pointer.y, 0.5).unproject(camera);
    const dir = cursorWorld.clone().sub(camera.position).normalize();
    if (Math.abs(dir.z) < 1e-4) return;
    const tToPlane = (position[2] - camera.position.z) / dir.z;
    const px = camera.position.x + dir.x * tToPlane;
    const py = camera.position.y + dir.y * tToPlane;
    const lx = (px - position[0]) / scale;
    const ly = (py - position[1]) / scale;

    const attr = geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const R = 0.55 / scale;        // local-space push radius
    const R2 = R * R;
    const pushK = 6.5;              // how hard the cursor shoves a grain
    const restoreLambda = 0.55;     // damp rate — lower = slower settle
    for (let i = 0; i < arr.length; i += 3) {
      const dx = arr[i] - lx;
      const dy = arr[i + 1] - ly;
      const d2 = dx * dx + dy * dy;
      if (d2 < R2 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const force = ((R - d) / R) * pushK * delta;
        arr[i] += (dx / d) * force;
        arr[i + 1] += (dy / d) * force;
      }
      arr[i] = THREE.MathUtils.damp(arr[i], homes[i], restoreLambda, delta);
      arr[i + 1] = THREE.MathUtils.damp(arr[i + 1], homes[i + 1], restoreLambda, delta);
      arr[i + 2] = THREE.MathUtils.damp(arr[i + 2], homes[i + 2], restoreLambda, delta);
    }
    attr.needsUpdate = true;
  });
  return (
    <points ref={ref} position={position} scale={scale}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={2.0}
        color={tint}
        transparent
        opacity={0.42}
        sizeAttenuation={false}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

// -----------------------------------------------------------------------------
// Windows 98 screen states — boot desktop, loading dialog, form
// -----------------------------------------------------------------------------

/** Boot state: teal Win98 desktop with the logo front-and-center. Purely
    decorative in the overview — clicking the CRT (not the desktop) is
    what kicks off the load sequence. A dotted prompt at the bottom
    hints that the CRT is clickable. */
function Win98Boot() {
  return (
    <div className="win98-desktop">
      <div className="win98-watermark">
        <div className="win98-flag big">
          <span className="win98-flag-q1" />
          <span className="win98-flag-q2" />
          <span className="win98-flag-q3" />
          <span className="win98-flag-q4" />
        </div>
        <div className="win98-watermark-text">Windows 98</div>
        <div className="win98-prompt">Click to open Contact.exe</div>
      </div>
      <div className="win98-taskbar">
        <div className="win98-start">
          <div className="win98-flag tiny">
            <span className="win98-flag-q1" />
            <span className="win98-flag-q2" />
            <span className="win98-flag-q3" />
            <span className="win98-flag-q4" />
          </div>
          <span>Start</span>
        </div>
        <div className="win98-tray">
          <span>3:14 AM</span>
        </div>
      </div>
    </div>
  );
}

/** Loading state: a classic Win98 progress window. Runs for ~3 seconds
    before the form appears. The progress bar fills with the striped-blue
    chunk animation. */
function Win98Loading() {
  return (
    <div className="win98-desktop">
      <div className="win98-window win98-loading">
        <div className="win98-titlebar">
          <span>Loading…</span>
        </div>
        <div className="win98-loading-body">
          <p>Initializing Contact.exe…</p>
          <p className="win98-loading-sub">Please wait while the form loads.</p>
          <div className="win98-progress-outer">
            <div className="win98-progress-inner" />
          </div>
        </div>
      </div>
      <div className="win98-taskbar">
        <div className="win98-start">
          <div className="win98-flag tiny">
            <span className="win98-flag-q1" />
            <span className="win98-flag-q2" />
            <span className="win98-flag-q3" />
            <span className="win98-flag-q4" />
          </div>
          <span>Start</span>
        </div>
      </div>
    </div>
  );
}

type Status = "idle" | "sending" | "ok" | "error";

function Win98Form({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    playSound("win98-click", 0.6);
    setStatus("sending");
    setError(null);
    const f = new FormData(e.currentTarget);
    const payload: ContactFormData = {
      name: String(f.get("name") ?? "").trim(),
      email: String(f.get("email") ?? "").trim(),
      message: String(f.get("message") ?? "").trim(),
      website: String(f.get("website") ?? ""),
    };
    if (!payload.name || !payload.email || !payload.message) {
      setStatus("error");
      setError("All fields are required.");
      return;
    }
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: ContactFormResponse = await res.json();
      if (data.ok) {
        setStatus("ok");
        playSound("win98-ding", 0.8);
        (e.target as HTMLFormElement).reset();
      } else {
        setStatus("error");
        setError(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setError("Network error.");
    }
  };
  return (
    <div className="win98-window">
      <div className="win98-titlebar">
        <span>Contact — FABRIQUE.exe</span>
        <button
          className="win98-x"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            playSound("crt-off", 0.7);
            onClose();
          }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <form className="win98-body" onSubmit={onSubmit}>
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          style={{ position: "absolute", left: "-9999px" }}
        />
        <label>
          <span>Name:</span>
          <input
            name="name"
            type="text"
            required
            autoComplete="name"
            onKeyDown={() => playSound("type-key", 0.15)}
          />
        </label>
        <label>
          <span>Email:</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            onKeyDown={() => playSound("type-key", 0.15)}
          />
        </label>
        <label className="win98-msg-label">
          <span>Message:</span>
          <textarea
            name="message"
            rows={5}
            required
            onKeyDown={() => playSound("type-key", 0.15)}
          />
        </label>
        <div className="win98-actions">
          <button type="submit" className="win98-btn" disabled={status === "sending"}>
            {status === "sending" ? "Sending…" : "Send"}
          </button>
          <button
            type="button"
            className="win98-btn"
            onClick={(e) => {
              e.stopPropagation();
              playSound("crt-off", 0.7);
              onClose();
            }}
          >
            Cancel
          </button>
        </div>
        {status === "ok" && <p className="win98-msg ok">Message sent successfully.</p>}
        {status === "error" && <p className="win98-msg err">Error: {error}</p>}
      </form>
      <div className="win98-statusbar">Ready.</div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main scene
// -----------------------------------------------------------------------------

export function ContactScene() {
  const [view, setView] = useState<View>("overview");
  const [screen, setScreen] = useState<ScreenState>("boot");
  const loadTimer = useRef<number | null>(null);

  // Click the CRT from overview → zoom in AND kick off the fake OS load.
  // After 3 seconds the form appears (old-school app launch feel).
  const onClickScreen = useCallback(() => {
    playSound("crt-on", 0.8);
    setView("computer");
    // Tiny delay so the click sound reads first, then loading starts.
    window.setTimeout(() => {
      playSound("win98-click", 0.6);
      setScreen("loading");
    }, 250);
    if (loadTimer.current) window.clearTimeout(loadTimer.current);
    loadTimer.current = window.setTimeout(() => {
      playSound("win98-ding", 0.6);
      setScreen("form");
    }, 3250);
  }, []);

  const onClose = useCallback(() => {
    playSound("crt-off", 0.7);
    setView("overview");
    // Small delay so the closing sound plays before the boot screen returns.
    window.setTimeout(() => setScreen("boot"), 450);
  }, []);

  useEffect(() => {
    return () => {
      if (loadTimer.current) window.clearTimeout(loadTimer.current);
    };
  }, []);

  const screenNode =
    screen === "boot" ? (
      <Win98Boot />
    ) : screen === "loading" ? (
      <Win98Loading />
    ) : (
      <Win98Form onClose={onClose} />
    );

  return (
    <Canvas
      camera={{ position: [5.8, 3.3, 15.5], fov: 34 }}
      shadows
      gl={{ antialias: true, alpha: false }}
      style={{ width: "100%", height: "100%" }}
      onPointerMissed={() => {
        // Click anywhere off the monitor/form → back out to overview.
        // R3F only fires this when no mesh was hit; clicks on the form
        // (HTML) never reach the canvas so they're safe.
        if (view === "computer") onClose();
      }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={["#020205"]} />
        <fog attach="fog" args={["#020205", 18, 40]} />

        <Ground />
        <SpotlightRig />
        <SpotlightFlicker />
        <SpotlightFloor />
        <LightBeam />
        <WoodenTable />
        <ContactAudio />
        <CRTMonitor
          view={view}
          onClickScreen={onClickScreen}
          screenNode={screenNode}
        />
        <CameraRig view={view} />

        {/* The hallucination layer — everything the eye invents in
            darkness. Positioned CLOSE to the camera path so they're
            actually visible against the dark backdrop. */}
        <RetinalNoise />
        <Floaters />
        {/* Phantom shapes — weird half-seen things the eye invents in
            the dark. Dim, low-saturation tints, irregular geometries
            (figures, eyes, hands, scribbles, spirals, crescents). Each
            cloud is SMALL and INDEPENDENTLY scatterable — the cursor
            passes through and shoves individual grains. More patches
            at smaller scales so they read as many half-glimpsed things
            rather than a few big blobs. All above ground. */}
        <PhantomCloud position={[-5.8, 2.8, 1.8]} tint="#4a5c80" seed={11}  scale={0.9} shape="figure"   />
        <PhantomCloud position={[ 5.4, 3.2, 1.2]} tint="#5a4860" seed={29}  scale={0.7} shape="eye"      />
        <PhantomCloud position={[-4.4, 4.9, 2.6]} tint="#4a6a50" seed={47}  scale={0.8} shape="hand"     />
        <PhantomCloud position={[ 6.3, 5.0,-0.5]} tint="#60485a" seed={73}  scale={1.0} shape="scribble" />
        <PhantomCloud position={[-7.3, 2.1, 0.4]} tint="#5a4a38" seed={101} scale={0.9} shape="spiral"   />
        <PhantomCloud position={[ 4.1, 1.5, 2.0]} tint="#3a5060" seed={127} scale={0.7} shape="crescent" />
        <PhantomCloud position={[ 0.2, 6.4,-2.2]} tint="#484058" seed={157} scale={0.9} shape="figure"   />
        <PhantomCloud position={[-7.7, 5.8,-0.9]} tint="#3e4e60" seed={191} scale={0.8} shape="eye"      />
        <PhantomCloud position={[ 7.4, 2.7, 2.4]} tint="#4a4062" seed={211} scale={0.6} shape="scribble" />
        <PhantomCloud position={[-2.8, 7.1, 2.0]} tint="#405868" seed={233} scale={0.7} shape="crescent" />
        <PhantomCloud position={[ 3.4, 6.0, 3.0]} tint="#584860" seed={263} scale={0.6} shape="spiral"   />
        <PhantomCloud position={[-5.5, 1.1, 3.3]} tint="#554d3a" seed={307} scale={0.55} shape="hand"    />
        <PhantomCloud position={[ 5.9, 0.9, 3.6]} tint="#3d4a58" seed={331} scale={0.55} shape="figure"  />
        <PhantomCloud position={[-2.0, 4.4, 4.0]} tint="#4e3c4a" seed={373} scale={0.5}  shape="eye"     />
        <PhantomCloud position={[ 2.5, 3.3, 4.1]} tint="#3a4852" seed={409} scale={0.5}  shape="scribble"/>
        <PhantomCloud position={[-0.4, 1.4,-3.2]} tint="#3c4660" seed={449} scale={0.8}  shape="spiral"  />
      </Suspense>
    </Canvas>
  );
}
