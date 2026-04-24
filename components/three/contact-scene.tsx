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
import { playSound } from "@/lib/sound";
import type { ContactFormData, ContactFormResponse } from "@/types/contact";

type View = "overview" | "computer";
type ScreenState = "boot" | "loading" | "form";
const TABLE_TOP_Y = 1.6;

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
  const TOP_W = 2.6;
  const TOP_D = 1.7;
  const TOP_THICK = 0.12;
  const TOP_Y = 1.6; // top surface height
  const LEG_W = 0.12;
  const LEG_H = TOP_Y - TOP_THICK;
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
            LEG_H / 2,
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
        scale={0.0013}
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
  const targetPos = useRef(new THREE.Vector3(3.8, 2.6, 7.2));
  const targetLook = useRef(new THREE.Vector3(0, 2.0, 0));
  useFrame(({ camera }, delta) => {
    if (view === "computer") {
      // Head-on, close to the screen
      targetPos.current.set(0, TABLE_TOP_Y + 0.55, 2.3);
      targetLook.current.set(0, TABLE_TOP_Y + 0.55, 0);
    } else {
      // 3/4 view pushed back — table sits deeper in the void
      targetPos.current.set(5.2, 3.2, 10.5);
      targetLook.current.set(0, 1.4, 0);
    }
    camera.position.lerp(targetPos.current, Math.min(1, delta * 2.2));
    camera.lookAt(targetLook.current);
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
        position={[0, 7.4, 0.1]}
        angle={0.44}
        penumbra={0.55}
        intensity={180}
        distance={16}
        decay={1.8}
        color="#ffdba0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <object3D ref={targetRef} position={[0, 0, 0]} />
    </>
  );
}

/** Visible beam — additive cone from the spotlight source all the way
    to the floor. Apex up (default coneGeometry orientation), base down.
    Height 7.4, centered at y=3.7 → apex y=7.4, base y=0 (the floor). */
function LightBeam() {
  return (
    <mesh position={[0, 3.7, 0.1]}>
      <coneGeometry args={[2.4, 7.4, 48, 1, true]} />
      <meshBasicMaterial
        color="#ffd890"
        transparent
        opacity={0.055}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Ground disc — subtle warm pool where the spotlight hits the floor, so
    the beam has something to land on (not just pure void). */
function SpotlightFloor() {
  return (
    <mesh position={[0, 0.002, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[2.3, 48]} />
      <meshBasicMaterial
        color="#3a2c1a"
        transparent
        opacity={0.9}
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
  const { geometry, vels } = useMemo(() => {
    const N = 40;
    const pos = new Float32Array(N * 3);
    const vs = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 4 - 2;
      vs[i * 3] = (Math.random() - 0.5) * 0.08;
      vs[i * 3 + 1] = (Math.random() - 0.5) * 0.06;
      vs[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return { geometry: g, vels: vs };
  }, []);
  useFrame((_, delta) => {
    const attr = geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += vels[i] * delta;
      arr[i + 1] += vels[i + 1] * delta;
      arr[i + 2] += vels[i + 2] * delta;
      // Gentle recenter drift so they stay in viewport
      arr[i] *= 0.9995;
      arr[i + 1] *= 0.9995;
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
      pos[i * 3 + 1] = (Math.random() - 0.5) * 14;
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
function PhantomCloud({
  position,
  tint,
  seed = 0,
  scale = 1,
}: {
  position: [number, number, number];
  tint: string;
  seed?: number;
  scale?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const N = 420;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u1 = Math.random() || 0.001;
      const u2 = Math.random();
      const g1 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const g2 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
      const g3 = (Math.random() - 0.5) * 2;
      pos[i * 3] = g1 * 1.6;
      pos[i * 3 + 1] = g2 * 1.1;
      pos[i * 3 + 2] = g3 * 0.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);
  const baseScale = useRef(scale);
  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    ref.current.rotation.z += delta * 0.02;
    const breathe = 1 + Math.sin(clock.elapsedTime * 0.3 + seed) * 0.08;
    ref.current.scale.setScalar(baseScale.current * breathe);
  });
  return (
    <points ref={ref} position={position} scale={scale}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={4.5}
        color={tint}
        transparent
        opacity={0.55}
        sizeAttenuation={false}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

/** Afterimage blob — a dim glow that fades in and out at random points
    in the periphery, like what your retina invents after a flash. */
function AfterimageBlob() {
  const ref = useRef<THREE.Mesh>(null);
  const state = useRef({
    nextAt: performance.now() + 3000,
    active: false,
    pos: new THREE.Vector3(),
    life: 0,
    maxLife: 2.5,
  });
  useFrame((_, delta) => {
    const s = state.current;
    const now = performance.now();
    if (!s.active && now > s.nextAt) {
      s.active = true;
      s.life = 0;
      const r = 4 + Math.random() * 3;
      const a = Math.random() * Math.PI * 2;
      s.pos.set(Math.cos(a) * r, Math.sin(a) * r * 0.6 + 2, -1 - Math.random() * 2);
    }
    if (s.active && ref.current) {
      s.life += delta;
      const t = s.life / s.maxLife;
      const fade = t < 0.3 ? t / 0.3 : t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      ref.current.position.copy(s.pos);
      (ref.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.25;
      if (t >= 1) {
        s.active = false;
        s.nextAt = now + 3500 + Math.random() * 4000;
      }
    } else if (ref.current) {
      (ref.current.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1.2, 16, 16]} />
      <meshBasicMaterial
        color="#8a70c0"
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
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
      camera={{ position: [5.2, 3.2, 10.5], fov: 36 }}
      shadows
      gl={{ antialias: true, alpha: false }}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={["#020205"]} />
        <fog attach="fog" args={["#020205", 14, 34]} />

        <SpotlightRig />
        <SpotlightFloor />
        <LightBeam />
        <WoodenTable />
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
        <AfterimageBlob />
        <PhantomCloud position={[-5, 3, 2]} tint="#6090ff" seed={11} scale={1.6} />
        <PhantomCloud position={[5, 1, 1]} tint="#ff80c0" seed={29} scale={1.4} />
        <PhantomCloud position={[-4, -2, 3]} tint="#80c060" seed={47} scale={1.2} />
        <PhantomCloud position={[6, 4, -1]} tint="#c080ff" seed={73} scale={1.8} />
        <PhantomCloud position={[-7, 0, 0]} tint="#ffb060" seed={101} scale={1.5} />
        <PhantomCloud position={[4, -3, 2]} tint="#60ffc0" seed={127} scale={1.3} />
      </Suspense>
    </Canvas>
  );
}
