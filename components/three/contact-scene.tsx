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
// Table lowered so the CRT sits at camera look-at (y≈1.8) — the whole
// setup reads as centered on screen, not towering above frame-middle.
// Ground pulled up so the legs are a normal height (not stretched).
const TABLE_TOP_Y = 1.3;
const GROUND_Y = -0.3;

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
// CRT Monitor — chunky 90s beige-grey tower. Taper back case + rounded
// front bezel + recessed screen + top & side vents + front controls
// (power + degauss + LED) + branded nameplate + corner screws + cable.
// -----------------------------------------------------------------------------

/** Soft blue halo texture — radial gradient bright at center, fully
    transparent at the edge. Sold in front of the CRT screen as a glow
    plane so light from the phosphor appears to bleed onto the bezel. */
function useScreenGlowTexture(): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const size = 512;
    const cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const cx = size / 2;
    const grd = ctx.createRadialGradient(cx, cx, size * 0.18, cx, cx, cx * 0.95);
    grd.addColorStop(0,   "rgba(110, 175, 235, 0.65)");
    grd.addColorStop(0.4, "rgba(74, 144, 216, 0.25)");
    grd.addColorStop(0.75,"rgba(50, 110, 180, 0.08)");
    grd.addColorStop(1,   "rgba(50, 110, 180, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/** Brand nameplate texture — dark metal plate with the studio name
    etched in a dim warm-metal tint. Sits below the screen on the front
    bezel. */
function useBrandPlateTexture(): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const w = 512;
    const h = 96;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    // Brushed-metal dark background
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "#2a2620");
    grd.addColorStop(0.5, "#3a342c");
    grd.addColorStop(1, "#221e18");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    // Subtle horizontal streaks for brushed metal
    for (let i = 0; i < 80; i++) {
      const y = Math.random() * h;
      ctx.strokeStyle = `rgba(${90 + Math.random() * 40}, ${80 + Math.random() * 30}, ${60 + Math.random() * 20}, ${0.05 + Math.random() * 0.08})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Etched text
    ctx.fillStyle = "#a89c84";
    ctx.font = "700 52px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.letterSpacing = "4px";
    ctx.fillText("FABRIQUE", w / 2, h / 2 + 2);
    // Small model number line
    ctx.fillStyle = "#746a58";
    ctx.font = "500 18px Arial, sans-serif";
    ctx.fillText("MODEL CRT-420", w / 2, h - 14);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

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
  const brandTex = useBrandPlateTexture();
  const glowTex = useScreenGlowTexture();
  const W = 1.15;
  const H = 0.95;
  const D_FRONT = 0.85;
  const D_BACK = 0.55;
  // Shifted cooler/greyer — was warm beige #d8cdb4, now grey-beige
  // reminiscent of dusty IBM/Compaq 90s cases.
  const beige = "#c1b9ac";
  const beigeDark = "#988f82";
  const beigeLight = "#d3ccc0";
  const buttonDark = "#2a251e";
  const screwDark = "#181410";

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
      {/* Recessed screen area — slightly darker frame. Height multiplier
          bumped from 0.62→0.76 so the screen is closer to 4:3 and
          matches the DOM aspect (420×320 → 1.31). */}
      <mesh position={[0, 0.04, D_FRONT / 2 - 0.15]}>
        <boxGeometry args={[W * 0.82, H * 0.76, 0.05]} />
        <meshStandardMaterial color="#2a261c" metalness={0.2} roughness={0.6} />
      </mesh>
      {/* Screen surface — always emissive (Win98 is always booted). Acts
          as the click target when in overview state. The plane is sized
          to match the Win98 DOM aspect so the form can fill it. */}
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
        <planeGeometry args={[W * 0.76, H * 0.72]} />
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
          <planeGeometry args={[W * 0.79, H * 0.75]} />
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

      {/* Screen glow — blue phosphor halo bleeding onto the bezel. Plane
          is slightly larger than the screen so the soft edge of the
          gradient texture feathers across the bezel boundary. Additive
          blending keeps the underlying bezel color intact. */}
      <mesh position={[0, 0.04, D_FRONT / 2 - 0.113]}>
        <planeGeometry args={[W * 0.98, H * 0.94]} />
        <meshBasicMaterial
          map={glowTex ?? undefined}
          color={glowTex ? "#ffffff" : "#4a90d8"}
          transparent
          opacity={0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Win98 UI on the screen — drei Html in transform mode. drei's
          transform divides the scale prop by a factor derived from the
          camera/perspective setup (empirically ~40 at this camera
          distance), so the prop value here is the RAW value; a 420 px
          DOM element at scale 0.083 lands at ~0.87 world units wide,
          matching the screen plane W*0.76 = 0.874. */}
      <Html
        position={[0, 0.04, D_FRONT / 2 - 0.115]}
        transform
        scale={0.083}
        pointerEvents={view === "computer" ? "auto" : "none"}
        wrapperClass="crt-html"
        zIndexRange={[0, 10]}
      >
        <div className="crt-screen is-on">{screenNode}</div>
      </Html>

      {/* Vents on top — longer array of thin dark slits */}
      <group position={[0, H / 2, -0.05]}>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i} position={[(i - 3) * 0.12, 0.001, 0]}>
            <boxGeometry args={[0.09, 0.005, 0.28]} />
            <meshStandardMaterial color="#04040a" metalness={0.2} roughness={0.8} />
          </mesh>
        ))}
      </group>

      {/* Side vents — thin vertical slits on both sides of the rear case */}
      {[-1, 1].map((side) => (
        <group key={side} position={[side * (W * 0.45 - 0.01), 0, -0.08]}>
          {Array.from({ length: 4 }).map((_, i) => (
            <mesh key={i} position={[side * 0.001, (i - 1.5) * 0.1, -0.03 * i]}>
              <boxGeometry args={[0.01, 0.07, 0.18]} />
              <meshStandardMaterial color="#04040a" metalness={0.2} roughness={0.8} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Bottom accent stripe — thin lighter band across the bottom of
          the front bezel, separating the control area from the screen
          surround. Classic 90s monitor detail. */}
      <mesh position={[0, -H * 0.35, D_FRONT / 2 - 0.04]}>
        <boxGeometry args={[W * 0.86, 0.008, 0.015]} />
        <meshStandardMaterial color={beigeLight} metalness={0.2} roughness={0.5} />
      </mesh>

      {/* Branded nameplate — textured plate with "FABRIQUE" etched. Sits
          bottom-left of the front control bay. */}
      <mesh position={[-W * 0.22, -H * 0.42, D_FRONT / 2 - 0.035]}>
        <boxGeometry args={[0.34, 0.075, 0.008]} />
        <meshStandardMaterial
          map={brandTex ?? undefined}
          color={brandTex ? "#ffffff" : "#2a2620"}
          metalness={0.45}
          roughness={0.45}
        />
      </mesh>

      {/* Power button — chunky push-button (recessed ring + inner cap) */}
      <group position={[W * 0.28, -H * 0.42, D_FRONT / 2 - 0.03]}>
        {/* Recessed ring */}
        <mesh>
          <cylinderGeometry args={[0.028, 0.028, 0.01, 18]} />
          <meshStandardMaterial color={buttonDark} metalness={0.4} roughness={0.6} />
        </mesh>
        {/* Inner cap — slightly raised */}
        <mesh position={[0, 0.003, 0]}>
          <cylinderGeometry args={[0.02, 0.022, 0.012, 18]} />
          <meshStandardMaterial color={beigeDark} metalness={0.2} roughness={0.55} />
        </mesh>
        {/* Power icon — tiny black dot (symbolic) */}
        <mesh position={[0, 0.01, 0]}>
          <cylinderGeometry args={[0.006, 0.006, 0.001, 10]} />
          <meshStandardMaterial color="#110e0a" metalness={0.3} roughness={0.7} />
        </mesh>
      </group>

      {/* Degauss button — smaller, flatter */}
      <mesh position={[W * 0.38, -H * 0.42, D_FRONT / 2 - 0.03]}>
        <cylinderGeometry args={[0.016, 0.018, 0.01, 14]} />
        <meshStandardMaterial color={beigeDark} metalness={0.2} roughness={0.55} />
      </mesh>

      {/* Power LED — raised from its previous spot so it aligns with the
          button bay. */}
      <mesh ref={ledRef} position={[W * 0.45, -H * 0.42, D_FRONT / 2 - 0.03]}>
        <sphereGeometry args={[0.018, 12, 12]} />
        <meshBasicMaterial color="#40ff60" transparent opacity={0.9} toneMapped={false} />
      </mesh>
      {/* Tiny darker inset around the LED */}
      <mesh position={[W * 0.45, -H * 0.42, D_FRONT / 2 - 0.035]}>
        <cylinderGeometry args={[0.023, 0.023, 0.006, 14]} />
        <meshStandardMaterial color={buttonDark} metalness={0.3} roughness={0.7} />
      </mesh>

      {/* Corner screws — four small dark screws at the corners of the
          front bezel (where a real CRT's bezel panel would be fastened). */}
      {[
        [-1, 1],
        [1, 1],
        [-1, -1],
        [1, -1],
      ].map(([sx, sy], i) => (
        <mesh
          key={i}
          position={[
            sx * (W / 2 - 0.045),
            sy * (H / 2 - 0.045),
            D_FRONT / 2 - 0.028,
          ]}
        >
          <cylinderGeometry args={[0.014, 0.014, 0.006, 10]} />
          <meshStandardMaterial color={screwDark} metalness={0.7} roughness={0.35} />
        </mesh>
      ))}

      {/* Cable bundle at the back — short thick cable emerging from the
          center-back of the case and draping straight down off the rear. */}
      <mesh
        position={[-W * 0.25, -H / 2 + 0.02, -(D_BACK / 2 + 0.04)]}
        rotation={[0.2, 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[0.024, 0.024, 0.5, 10]} />
        <meshStandardMaterial color="#151210" metalness={0.2} roughness={0.7} />
      </mesh>

      {/* Small base/stand under the monitor */}
      <mesh position={[0, -H / 2 - 0.04, 0]} castShadow>
        <boxGeometry args={[W * 0.7, 0.08, D_FRONT * 0.7]} />
        <meshStandardMaterial color={beigeDark} metalness={0.15} roughness={0.6} />
      </mesh>

      {/* Base foot pads — four tiny dark rubber feet at the corners */}
      {[
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].map(([sx, sz], i) => (
        <mesh
          key={i}
          position={[
            sx * (W * 0.3),
            -H / 2 - 0.09,
            sz * (D_FRONT * 0.3),
          ]}
        >
          <cylinderGeometry args={[0.025, 0.025, 0.015, 10]} />
          <meshStandardMaterial color="#100d0a" metalness={0.1} roughness={0.9} />
        </mesh>
      ))}
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
    // contact-ambient (filtered pink-noise room tone) removed — even
    // heavily filtered it reads as white-noise hiss. Only the tonal CRT
    // hum runs now.
    startLoop("contact-crt-hum");
    return () => {
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
 *  pulses. Events are infrequent (15–45s between) with wide variance in
 *  both gap and duration so the rhythm never feels timed. The LightBeam
 *  and SpotlightFloor read spot.intensity each frame, so the *entire
 *  cone* goes dark with the light — not just the illumination on the
 *  table. */
function SpotlightFlicker() {
  const { scene } = useThree();
  const state = useRef({
    nextAt: performance.now() + 8000 + Math.random() * 10000,
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
      // Wide random spread for duration — some flickers are quick ticks,
      // others are half-second struggles.
      s.flickerUntil = now + 300 + Math.random() * 1200;
      // Less frequent, more random gap (15s..45s).
      s.nextAt = now + 15000 + Math.random() * 30000;
      s.isOff = true;
      s.nextSwitchAt = now + 60 + Math.random() * 140;
      playSound("flicker", 0.65);
    }
    if (now < s.flickerUntil) {
      if (now > s.nextSwitchAt) {
        s.isOff = !s.isOff;
        s.nextSwitchAt = now + (s.isOff ? 70 + Math.random() * 180 : 20 + Math.random() * 70);
      }
      spot.intensity = s.isOff ? 0 : NOMINAL;
    } else {
      spot.intensity = THREE.MathUtils.damp(spot.intensity, 180, 8, 0.016);
    }
  });
  return null;
}

/** Vertical alpha ramp for the beam — bright near the lamp, fading to
    near-zero at the floor so the cone doesn't read as a hard silhouette.
    Texture is 1×256 sampled along the cone's v axis (v=0 at apex). */
function useBeamAlphaTexture(): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const cv = document.createElement("canvas");
    cv.width = 4;
    cv.height = 256;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const grd = ctx.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0,   "rgba(255,255,255,1)");     // apex = full
    grd.addColorStop(0.25,"rgba(255,255,255,0.85)");
    grd.addColorStop(0.7, "rgba(255,255,255,0.35)");
    grd.addColorStop(1,   "rgba(255,255,255,0)");     // floor = nothing
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  }, []);
}

/** Visible beam — two nested additive cones (bright core + feathered
    outer halo) with a vertical alpha ramp on each so the top-of-beam
    bleeds brighter and the bottom fades into the floor pool without a
    visible edge. Both cones ride spot.intensity so the whole thing snaps
    dark during a flicker. */
function LightBeam() {
  const innerRef = useRef<THREE.MeshBasicMaterial>(null);
  const outerRef = useRef<THREE.MeshBasicMaterial>(null);
  const { scene } = useThree();
  const alphaTex = useBeamAlphaTexture();
  const SRC_Y = 8.6;
  const height = SRC_Y - GROUND_Y;
  const radius = 2.8 * (height / 8.6);
  const centerY = (SRC_Y + GROUND_Y) / 2;
  const INNER_MAX = 0.055;
  const OUTER_MAX = 0.028;
  const NOMINAL = 220;
  useFrame(() => {
    const spot = scene.getObjectByProperty("isSpotLight", true) as
      | THREE.SpotLight
      | undefined;
    const k = Math.min(1, (spot ? spot.intensity : NOMINAL) / NOMINAL);
    if (innerRef.current) innerRef.current.opacity = k * INNER_MAX;
    if (outerRef.current) outerRef.current.opacity = k * OUTER_MAX;
  });
  return (
    <group position={[0, centerY, 0.2]}>
      {/* Inner bright core */}
      <mesh>
        <coneGeometry args={[radius * 0.82, height, 64, 1, true]} />
        <meshBasicMaterial
          ref={innerRef}
          map={alphaTex ?? undefined}
          alphaMap={alphaTex ?? undefined}
          color="#ffd890"
          transparent
          opacity={INNER_MAX}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Outer feathered halo — wider, dimmer, hides the silhouette edge */}
      <mesh>
        <coneGeometry args={[radius * 1.25, height, 64, 1, true]} />
        <meshBasicMaterial
          ref={outerRef}
          map={alphaTex ?? undefined}
          alphaMap={alphaTex ?? undefined}
          color="#ffd890"
          transparent
          opacity={OUTER_MAX}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
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

/** Radial-gradient pool texture — bright center, invisible edge. Used
    as an alpha-map-ish tint texture on the floor pool so the light has
    a soft falloff instead of a hard circle edge. */
function useLightPoolTexture(): THREE.CanvasTexture | null {
  return useMemo(() => {
    if (typeof document === "undefined") return null;
    const size = 512;
    const cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const cx = size / 2;
    const grd = ctx.createRadialGradient(cx, cx, size * 0.05, cx, cx, cx);
    grd.addColorStop(0,    "rgba(255, 224, 170, 1)");
    grd.addColorStop(0.25, "rgba(255, 219, 160, 0.7)");
    grd.addColorStop(0.55, "rgba(255, 208, 140, 0.28)");
    grd.addColorStop(0.85, "rgba(255, 200, 128, 0.06)");
    grd.addColorStop(1,    "rgba(255, 200, 128, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

/** Warm pool disc — radial-gradient texture gives the spotlight a soft
    realistic falloff into darkness instead of a hard circle edge. Opacity
    tracks spot.intensity so the pool vanishes during flicker events. */
function SpotlightFloor() {
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const { scene } = useThree();
  const pool = useLightPoolTexture();
  const SRC_Y = 8.6;
  const radius = 3.3 * ((SRC_Y - GROUND_Y) / 8.6);
  const MAX_OPACITY = 0.85;
  const NOMINAL = 220;
  useFrame(() => {
    if (!matRef.current) return;
    const spot = scene.getObjectByProperty("isSpotLight", true) as
      | THREE.SpotLight
      | undefined;
    const i = spot ? spot.intensity : NOMINAL;
    matRef.current.opacity = Math.min(1, i / NOMINAL) * MAX_OPACITY;
  });
  return (
    <mesh position={[0, GROUND_Y + 0.01, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* Circle geometry (not plane) so there's no square silhouette past
          where the radial-gradient texture goes transparent. */}
      <circleGeometry args={[radius, 96]} />
      <meshBasicMaterial
        ref={matRef}
        map={pool ?? undefined}
        color={pool ? "#ffffff" : "#ffdba0"}
        transparent
        opacity={MAX_OPACITY}
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

/** Constellation net — 300 dim particles scattered across the whole
 *  scene volume that constantly drift wind-like. Every frame we rebuild
 *  a LineSegments geometry connecting any two particles within a small
 *  world distance; opacity of each segment fades with distance. The
 *  result is a slow-morphing web that re-threads itself as particles
 *  drift past each other — "the connecting crazy cool shit". */
function ConstellationNet() {
  const N = 300;
  const MAX_LINK_DIST = 1.25;
  const MAX_LINKS = 900;
  const pointsRef = useRef<THREE.Points>(null);
  const linesRef = useRef<THREE.LineSegments>(null);

  // Home positions + drift phases seeded per-particle so the motion is
  // not globally coherent.
  const { pointGeom, lineGeom, homes, phases, lineColors } = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const home = new Float32Array(N * 3);
    const ph = new Float32Array(N * 6); // fx,fy,fz, phx,phy,phz per particle
    const rnd = (n: number) => {
      const x = Math.sin(n * 78.233 + 7.19) * 43758.5;
      return x - Math.floor(x);
    };
    for (let i = 0; i < N; i++) {
      const x = (rnd(i * 3 + 1) - 0.5) * 22;
      const y = 0.2 + rnd(i * 3 + 2) * 7.5;
      const z = (rnd(i * 3 + 3) - 0.5) * 9 - 1.5;
      pos[i * 3] = home[i * 3] = x;
      pos[i * 3 + 1] = home[i * 3 + 1] = y;
      pos[i * 3 + 2] = home[i * 3 + 2] = z;
      ph[i * 6]     = 0.08 + rnd(i * 5 + 11) * 0.18; // fx
      ph[i * 6 + 1] = 0.06 + rnd(i * 5 + 13) * 0.18;
      ph[i * 6 + 2] = 0.04 + rnd(i * 5 + 17) * 0.10;
      ph[i * 6 + 3] = rnd(i * 5 + 19) * Math.PI * 2;
      ph[i * 6 + 4] = rnd(i * 5 + 23) * Math.PI * 2;
      ph[i * 6 + 5] = rnd(i * 5 + 29) * Math.PI * 2;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));

    const lPos = new Float32Array(MAX_LINKS * 6);
    const lCol = new Float32Array(MAX_LINKS * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(lPos, 3));
    lg.setAttribute("color", new THREE.BufferAttribute(lCol, 3));
    lg.setDrawRange(0, 0);

    return { pointGeom: pg, lineGeom: lg, homes: home, phases: ph, lineColors: lCol };
  }, []);

  const MAX_LINK_DIST2 = MAX_LINK_DIST * MAX_LINK_DIST;

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;
    const pAttr = pointGeom.attributes.position as THREE.BufferAttribute;
    const arr = pAttr.array as Float32Array;

    // Drift: each particle oscillates around its home with per-particle
    // frequencies/phases. No integration — pure sin/cos so the field
    // breathes without ever drifting off.
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const ph6 = i * 6;
      arr[i3]     = homes[i3]     + Math.sin(time * phases[ph6]     + phases[ph6 + 3]) * 0.55;
      arr[i3 + 1] = homes[i3 + 1] + Math.cos(time * phases[ph6 + 1] + phases[ph6 + 4]) * 0.38;
      arr[i3 + 2] = homes[i3 + 2] + Math.sin(time * phases[ph6 + 2] + phases[ph6 + 5]) * 0.22;
    }
    pAttr.needsUpdate = true;

    // Rebuild link geometry — for every pair within MAX_LINK_DIST add a
    // line segment with opacity ∝ (1 - d/MAX_LINK_DIST). O(N²) but N is
    // small enough to run every frame.
    const lAttr = lineGeom.attributes.position as THREE.BufferAttribute;
    const cAttr = lineGeom.attributes.color as THREE.BufferAttribute;
    const lArr = lAttr.array as Float32Array;
    let links = 0;
    for (let i = 0; i < N && links < MAX_LINKS; i++) {
      const ix = arr[i * 3];
      const iy = arr[i * 3 + 1];
      const iz = arr[i * 3 + 2];
      for (let j = i + 1; j < N; j++) {
        const dx = ix - arr[j * 3];
        const dy = iy - arr[j * 3 + 1];
        const dz = iz - arr[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < MAX_LINK_DIST2) {
          const off = links * 6;
          lArr[off]     = ix;
          lArr[off + 1] = iy;
          lArr[off + 2] = iz;
          lArr[off + 3] = arr[j * 3];
          lArr[off + 4] = arr[j * 3 + 1];
          lArr[off + 5] = arr[j * 3 + 2];
          const alpha = 1 - Math.sqrt(d2) / MAX_LINK_DIST;
          // Pale blue tint per endpoint; magnitude encodes falloff via
          // additive blending (dimmer color = weaker line).
          const c = alpha * 0.55;
          lineColors[off]     = c * 0.55;
          lineColors[off + 1] = c * 0.7;
          lineColors[off + 2] = c;
          lineColors[off + 3] = c * 0.55;
          lineColors[off + 4] = c * 0.7;
          lineColors[off + 5] = c;
          links++;
          if (links >= MAX_LINKS) break;
        }
      }
    }
    lAttr.needsUpdate = true;
    cAttr.needsUpdate = true;
    lineGeom.setDrawRange(0, links * 2);
  });

  return (
    <>
      <points ref={pointsRef}>
        <primitive object={pointGeom} attach="geometry" />
        <pointsMaterial
          size={1.6}
          color="#8ab4e0"
          transparent
          opacity={0.55}
          sizeAttenuation={false}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
      <lineSegments ref={linesRef}>
        <primitive object={lineGeom} attach="geometry" />
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </>
  );
}

/** Retinal noise — fine grain scattered in the frustum. Slow swirl. */
function RetinalNoise() {
  const ref = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const N = 1400; // dense scatter so the background has specks everywhere
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 28;
      pos[i * 3 + 1] = 0.1 + Math.random() * 12;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 16 - 4;
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

/** Phantom hallucination cloud.
 *
 * Constantly drifts on its own — the whole cloud traces a slow sinusoidal
 * path across the scene (wind feel), and each individual grain wanders
 * around its home with its own micro-phase so the cloud "breathes" even
 * when stationary. Cursor still displaces individual grains and they
 * settle back to their drifting targets. A subtle whisper SFX fires when
 * the cursor first crosses into the cloud's catchment area. */
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
  const N = 110;
  const { geometry, homes, targetHomes } = useMemo(() => {
    const pts = genPhantomShape(shape, N, seed);
    const h = new Float32Array(pts);
    const t = new Float32Array(pts);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    return { geometry: g, homes: h, targetHomes: t };
  }, [shape, seed]);
  // Kick off a shape-shift cycle — swap targetHomes to a fresh random
  // shape every 7–18 s so every cloud is perpetually morphing.
  useEffect(() => {
    const shapes: PhantomShape[] = ["figure", "eye", "hand", "scribble", "spiral", "crescent"];
    let timer: number;
    const cycle = () => {
      const next = shapes[Math.floor(Math.random() * shapes.length)];
      const fresh = genPhantomShape(next, N, seed + Math.floor(Math.random() * 9999));
      for (let i = 0; i < targetHomes.length; i++) targetHomes[i] = fresh[i];
      timer = window.setTimeout(cycle, 7000 + Math.random() * 11000);
    };
    timer = window.setTimeout(cycle, 2000 + Math.random() * 5000);
    return () => window.clearTimeout(timer);
  }, [seed, targetHomes]);
  const cursorWorld = useMemo(() => new THREE.Vector3(), []);
  const inside = useRef(false);
  // Unique drift phases derived from seed so no two clouds move in lockstep.
  const dp = useMemo(() => {
    const r = (n: number) => {
      const x = Math.sin(seed * 127.1 + n * 311.7) * 43758.5;
      return x - Math.floor(x);
    };
    return {
      fx: 0.08 + r(1) * 0.12, // 0.08..0.20 Hz — very slow drift
      fy: 0.06 + r(2) * 0.10,
      fz: 0.05 + r(3) * 0.06,
      ax: 0.35 + r(4) * 0.45, // world-unit amplitude
      ay: 0.22 + r(5) * 0.30,
      az: 0.12 + r(6) * 0.14,
      phx: r(7) * Math.PI * 2,
      phy: r(8) * Math.PI * 2,
      phz: r(9) * Math.PI * 2,
    };
  }, [seed]);
  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    const t = clock.elapsedTime;

    // Whole-cloud drift — slow, organic, wind-like
    const gx = Math.sin(t * dp.fx + dp.phx) * dp.ax;
    const gy = Math.cos(t * dp.fy + dp.phy) * dp.ay;
    const gz = Math.sin(t * dp.fz + dp.phz) * dp.az;
    ref.current.position.set(position[0] + gx, position[1] + gy, position[2] + gz);

    // Project cursor to world then into cloud-local space
    cursorWorld.set(pointer.x, pointer.y, 0.5).unproject(camera);
    const dir = cursorWorld.clone().sub(camera.position).normalize();
    if (Math.abs(dir.z) < 1e-4) return;
    const tToPlane = (position[2] + gz - camera.position.z) / dir.z;
    const px = camera.position.x + dir.x * tToPlane;
    const py = camera.position.y + dir.y * tToPlane;
    const lx = (px - (position[0] + gx)) / scale;
    const ly = (py - (position[1] + gy)) / scale;

    const attr = geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const R = 0.55 / scale;
    const R2 = R * R;
    const pushK = 6.5;
    const restoreLambda = 0.8;
    const morphLambda = 0.55; // how fast homes chase targetHomes
    let grainsNear = 0;
    for (let i = 0; i < arr.length; i += 3) {
      // Continuously morph each home toward its fresh target — this is
      // what makes the cloud shapeshift between figure/eye/hand/etc.
      homes[i]     = THREE.MathUtils.damp(homes[i],     targetHomes[i],     morphLambda, delta);
      homes[i + 1] = THREE.MathUtils.damp(homes[i + 1], targetHomes[i + 1], morphLambda, delta);
      homes[i + 2] = THREE.MathUtils.damp(homes[i + 2], targetHomes[i + 2], morphLambda, delta);

      // Per-grain swirl — each grain has its own phase so the cloud
      // shimmers/breathes constantly.
      const gi = i / 3;
      const phase = seed * 0.13 + gi * 0.37;
      const mx = Math.sin(t * 0.55 + phase) * 0.06;
      const my = Math.cos(t * 0.48 + phase * 1.3) * 0.06;
      const mz = Math.sin(t * 0.33 + phase * 0.7) * 0.03;

      const tx = homes[i] + mx;
      const ty = homes[i + 1] + my;
      const tz = homes[i + 2] + mz;

      // Cursor pass-through — shove individual grains
      const dx = arr[i] - lx;
      const dy = arr[i + 1] - ly;
      const d2 = dx * dx + dy * dy;
      if (d2 < R2) grainsNear++;
      if (d2 < R2 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const force = ((R - d) / R) * pushK * delta;
        arr[i] += (dx / d) * force;
        arr[i + 1] += (dy / d) * force;
      }

      // Damp each grain toward its MOVING target (home + micro-wander)
      arr[i] = THREE.MathUtils.damp(arr[i], tx, restoreLambda, delta);
      arr[i + 1] = THREE.MathUtils.damp(arr[i + 1], ty, restoreLambda, delta);
      arr[i + 2] = THREE.MathUtils.damp(arr[i + 2], tz, restoreLambda, delta);
    }
    attr.needsUpdate = true;

    // Pass-through SFX — fire once on enter, not every frame.
    const nowInside = grainsNear > 4;
    if (nowInside && !inside.current) {
      playSound("phantom-whisper", 0.22);
    }
    inside.current = nowInside;
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
        <ConstellationNet />
        {/* Phantom shapes — weird half-seen things the eye invents in
            the dark. Dim, low-saturation tints, irregular geometries
            (figures, eyes, hands, scribbles, spirals, crescents). Each
            cloud is SMALL and INDEPENDENTLY scatterable — the cursor
            passes through and shoves individual grains. More patches
            at smaller scales so they read as many half-glimpsed things
            rather than a few big blobs. All above ground. */}
        <PhantomCloud position={[-5.8, 2.8, 1.8]} tint="#4a5c80" seed={11}  scale={0.9}  shape="figure"   />
        <PhantomCloud position={[ 5.4, 3.2, 1.2]} tint="#5a4860" seed={29}  scale={0.7}  shape="eye"      />
        <PhantomCloud position={[-4.4, 4.9, 2.6]} tint="#4a6a50" seed={47}  scale={0.8}  shape="hand"     />
        <PhantomCloud position={[ 6.3, 5.0,-0.5]} tint="#60485a" seed={73}  scale={1.0}  shape="scribble" />
        <PhantomCloud position={[-7.3, 2.1, 0.4]} tint="#5a4a38" seed={101} scale={0.9}  shape="spiral"   />
        <PhantomCloud position={[ 4.1, 1.5, 2.0]} tint="#3a5060" seed={127} scale={0.7}  shape="crescent" />
        <PhantomCloud position={[ 0.2, 6.4,-2.2]} tint="#484058" seed={157} scale={0.9}  shape="figure"   />
        <PhantomCloud position={[-7.7, 5.8,-0.9]} tint="#3e4e60" seed={191} scale={0.8}  shape="eye"      />
        <PhantomCloud position={[ 7.4, 2.7, 2.4]} tint="#4a4062" seed={211} scale={0.6}  shape="scribble" />
        <PhantomCloud position={[-2.8, 7.1, 2.0]} tint="#405868" seed={233} scale={0.7}  shape="crescent" />
        <PhantomCloud position={[ 3.4, 6.0, 3.0]} tint="#584860" seed={263} scale={0.6}  shape="spiral"   />
        <PhantomCloud position={[-5.5, 1.1, 3.3]} tint="#554d3a" seed={307} scale={0.55} shape="hand"     />
        <PhantomCloud position={[ 5.9, 0.9, 3.6]} tint="#3d4a58" seed={331} scale={0.55} shape="figure"   />
        <PhantomCloud position={[-2.0, 4.4, 4.0]} tint="#4e3c4a" seed={373} scale={0.5}  shape="eye"      />
        <PhantomCloud position={[ 2.5, 3.3, 4.1]} tint="#3a4852" seed={409} scale={0.5}  shape="scribble" />
        <PhantomCloud position={[-0.4, 1.4,-3.2]} tint="#3c4660" seed={449} scale={0.8}  shape="spiral"   />
        {/* Second wave — denser field for the wind feel. Scattered across
            wider x/y range and z layers so drift paths pass through each
            other and produce parallax. */}
        <PhantomCloud position={[-9.2, 3.5, 1.1]} tint="#45557a" seed={503} scale={0.65} shape="crescent" />
        <PhantomCloud position={[ 9.0, 4.1, 0.5]} tint="#5e4868" seed={547} scale={0.7}  shape="eye"      />
        <PhantomCloud position={[-3.7, 0.6, 0.8]} tint="#4a5236" seed={577} scale={0.5}  shape="figure"   />
        <PhantomCloud position={[ 3.0, 0.5, 0.6]} tint="#523c4a" seed={607} scale={0.5}  shape="hand"     />
        <PhantomCloud position={[-6.6, 6.7, 1.5]} tint="#4b5270" seed={641} scale={0.75} shape="scribble" />
        <PhantomCloud position={[ 7.9, 6.5, 2.1]} tint="#3b4a56" seed={673} scale={0.7}  shape="spiral"   />
        <PhantomCloud position={[-1.1, 5.8, 3.6]} tint="#574860" seed={709} scale={0.55} shape="figure"   />
        <PhantomCloud position={[ 1.3, 7.8, 1.9]} tint="#3f4f68" seed={739} scale={0.85} shape="eye"      />
        <PhantomCloud position={[-8.6, 4.8, 3.0]} tint="#4c4466" seed={773} scale={0.6}  shape="hand"     />
        <PhantomCloud position={[ 8.4, 1.8, 3.2]} tint="#3d4c5c" seed={811} scale={0.6}  shape="crescent" />
        <PhantomCloud position={[-4.1, 2.5, 5.0]} tint="#4a425a" seed={853} scale={0.45} shape="spiral"   />
        <PhantomCloud position={[ 4.5, 5.1, 5.0]} tint="#3a4a56" seed={887} scale={0.45} shape="scribble" />
        <PhantomCloud position={[-0.8, 3.2,-4.0]} tint="#3e4864" seed={919} scale={0.7}  shape="figure"   />
        <PhantomCloud position={[ 6.2, 8.0, 0.2]} tint="#524260" seed={953} scale={0.5}  shape="eye"      />
        <PhantomCloud position={[-6.0, 7.8, 0.1]} tint="#3b5160" seed={991} scale={0.5}  shape="crescent" />
      </Suspense>
    </Canvas>
  );
}
