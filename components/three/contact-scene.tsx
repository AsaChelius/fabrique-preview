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

// -----------------------------------------------------------------------------
// Plinth — tall dark stone column the computer sits on
// -----------------------------------------------------------------------------

function Plinth() {
  return (
    <group position={[0, 0, 0]}>
      {/* Shaft */}
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.75, 1.7, 0.75]} />
        <meshStandardMaterial color="#16161a" metalness={0.2} roughness={0.75} />
      </mesh>
      {/* Top cap — slightly wider, lighter edge */}
      <mesh position={[0, 1.74, 0]} castShadow>
        <boxGeometry args={[0.95, 0.06, 0.95]} />
        <meshStandardMaterial color="#1e1e24" metalness={0.3} roughness={0.55} />
      </mesh>
      {/* Bottom cap */}
      <mesh position={[0, 0.03, 0]} castShadow>
        <boxGeometry args={[0.95, 0.06, 0.95]} />
        <meshStandardMaterial color="#1e1e24" metalness={0.3} roughness={0.55} />
      </mesh>
      {/* Faint vertical seam lines for texture */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.376, 0.85, 0]}>
          <boxGeometry args={[0.005, 1.66, 0.76]} />
          <meshStandardMaterial color="#050508" metalness={0.5} roughness={0.4} />
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
  formNode,
}: {
  view: View;
  onClickScreen: () => void;
  formNode: React.ReactNode;
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

  // Power the screen on when zoomed. Soft pulse intensity for glow.
  useFrame(({ clock }) => {
    if (!screenMatRef.current) return;
    const on = view === "computer";
    const target = on ? 1.6 : 0.0;
    screenMatRef.current.emissiveIntensity = THREE.MathUtils.damp(
      screenMatRef.current.emissiveIntensity,
      target + (on ? Math.sin(clock.elapsedTime * 0.7) * 0.08 : 0),
      3,
      0.016,
    );
    if (ledRef.current) {
      const mat = ledRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = on ? 1 : 0.85;
    }
  });

  return (
    <group position={[0, 1.77 + H / 2, 0]}>
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
      {/* Screen surface — emissive plane with the canvas texture underneath
          glow when powered. Click target. */}
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
          color={view === "computer" ? "#3a5f8a" : "#0a0a10"}
          emissive={view === "computer" ? "#3a5f8a" : "#050508"}
          emissiveIntensity={0}
          metalness={0.05}
          roughness={0.18}
          toneMapped={false}
        />
      </mesh>
      {/* Subtle hover hint — outer ring brightens when in overview */}
      {hovered && view === "overview" && (
        <mesh position={[0, 0.04, D_FRONT / 2 - 0.118]}>
          <planeGeometry args={[W * 0.79, H * 0.61]} />
          <meshBasicMaterial
            color="#ffd080"
            transparent
            opacity={0.12}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      )}

      {/* Win98 form — mounted as HTML on the screen. Only interactive when
          zoomed in, otherwise pointer-events off so the user can click
          through to the mesh below. */}
      <Html
        position={[0, 0.04, D_FRONT / 2 - 0.115]}
        transform
        occlude="blending"
        distanceFactor={780}
        pointerEvents={view === "computer" ? "auto" : "none"}
        wrapperClass="crt-html"
      >
        <div
          className={`crt-screen ${view === "computer" ? "is-on" : ""}`}
          aria-hidden={view !== "computer"}
        >
          {view === "computer" ? formNode : null}
        </div>
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
  const targetPos = useRef(new THREE.Vector3(0, 2.1, 5.2));
  const targetLook = useRef(new THREE.Vector3(0, 2.1, 0));
  const lookTmp = useRef(new THREE.Vector3());
  useFrame(({ camera }, delta) => {
    if (view === "computer") {
      targetPos.current.set(0, 2.3, 2.15);
      targetLook.current.set(0, 2.3, 0);
    } else {
      targetPos.current.set(0, 2.1, 5.4);
      targetLook.current.set(0, 2.1, 0);
    }
    camera.position.lerp(targetPos.current, Math.min(1, delta * 2.5));
    lookTmp.current.copy(camera.position).sub(targetLook.current);
    // Face the target smoothly — direct lookAt each frame keeps it stable.
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
        position={[0, 7, 0.2]}
        angle={0.32}
        penumbra={0.55}
        intensity={120}
        distance={14}
        decay={2}
        color="#ffdba0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <object3D ref={targetRef} position={[0, 1.9, 0]} />
    </>
  );
}

/** Visible beam — thin additive cone so the spotlight is visible as a
    triangle of light descending through the air, matching the drawing. */
function LightBeam() {
  const ref = useRef<THREE.Mesh>(null);
  return (
    <mesh ref={ref} position={[0, 4, 0.2]} rotation={[Math.PI, 0, 0]}>
      <coneGeometry args={[1.8, 6.5, 32, 1, true]} />
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
        size={2.5}
        color="#8a9dbf"
        transparent
        opacity={0.35}
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
        size={1.2}
        color="#3a4a6a"
        transparent
        opacity={0.5}
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
}: {
  position: [number, number, number];
  tint: string;
  seed?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const N = 360;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // Gaussian-ish distribution
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
  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    ref.current.rotation.z += delta * 0.02;
    const breathe = 1 + Math.sin(clock.elapsedTime * 0.3 + seed) * 0.08;
    ref.current.scale.setScalar(breathe);
  });
  return (
    <points ref={ref} position={position}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        size={3.5}
        color={tint}
        transparent
        opacity={0.22}
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
// Windows 98 form — rendered as HTML on the CRT screen via drei <Html>
// -----------------------------------------------------------------------------

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
  const onOpen = useCallback(() => {
    playSound("crt-on", 0.8);
    setView("computer");
  }, []);
  const onClose = useCallback(() => {
    setView("overview");
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 2.1, 5.4], fov: 35 }}
      shadows
      gl={{ antialias: true, alpha: false }}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={["#020205"]} />
        <fog attach="fog" args={["#020205", 6, 20]} />

        <SpotlightRig />
        <LightBeam />
        <Plinth />
        <CRTMonitor
          view={view}
          onClickScreen={onOpen}
          formNode={<Win98Form onClose={onClose} />}
        />
        <CameraRig view={view} />

        {/* The hallucination layer — everything the eye invents in darkness */}
        <RetinalNoise />
        <Floaters />
        <AfterimageBlob />
        <PhantomCloud position={[-6, 2, -2]} tint="#6090ff" seed={11} />
        <PhantomCloud position={[6, -1, -3]} tint="#ff80c0" seed={29} />
        <PhantomCloud position={[-4, -3, -1]} tint="#80c060" seed={47} />
        <PhantomCloud position={[5, 4, -4]} tint="#c080ff" seed={73} />
      </Suspense>
    </Canvas>
  );
}
