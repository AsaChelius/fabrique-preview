"use client";

/**
 * "Contact" route — interactive 3D phone.
 *
 * An old-school push-button phone sits on a dark desk, lit from above by a
 * single spotlight. The user can click the 12 keypad buttons to dial; if
 * they dial the secret number on the post-it note (`555-FAB3` → 5553223)
 * an alien voice comes through the earpiece. The contact form lives as a
 * 2D overlay on the left side of the page — this canvas is only the right
 * half.
 *
 * Geometry is intentionally built from primitives (no external models) so
 * we stay fast and can tune it inline. The handset is tethered to the base
 * by a coiled cable (TubeGeometry along a spring curve).
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

const SECRET_NUMBER = "5553223"; // 555-FAB3 on the keypad

// Keypad layout (rows of 3). Letters shown under digits like a real phone.
const KEYS: { digit: string; letters: string }[] = [
  { digit: "1", letters: "" },
  { digit: "2", letters: "ABC" },
  { digit: "3", letters: "DEF" },
  { digit: "4", letters: "GHI" },
  { digit: "5", letters: "JKL" },
  { digit: "6", letters: "MNO" },
  { digit: "7", letters: "PQRS" },
  { digit: "8", letters: "TUV" },
  { digit: "9", letters: "WXYZ" },
  { digit: "*", letters: "" },
  { digit: "0", letters: "+" },
  { digit: "#", letters: "" },
];

// -----------------------------------------------------------------------------
// Desk surface — matte black with subtle noise, grounds the phone.
// -----------------------------------------------------------------------------

function Desk() {
  return (
    <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#0a0a10" roughness={0.95} metalness={0.05} />
    </mesh>
  );
}

// -----------------------------------------------------------------------------
// Phone base — rectangular body + cradle for the handset + keypad + display.
// -----------------------------------------------------------------------------

function PhoneBody({
  onKeyPress,
  dialed,
}: {
  onKeyPress: (d: string) => void;
  dialed: string;
}) {
  const bodyColor = "#18181c";
  const plateColor = "#0d0d10";
  const keyColor = "#e8e8ec";
  const keyTopColor = "#f4f4f8";
  return (
    <group position={[0, 0, 0]}>
      {/* Base — slightly wedge-shaped, wider at the back */}
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.5, 3.6]} />
        <meshStandardMaterial color={bodyColor} metalness={0.35} roughness={0.45} />
      </mesh>
      {/* Top bevel */}
      <mesh position={[0, 0.51, 0]} castShadow>
        <boxGeometry args={[2.5, 0.03, 3.5]} />
        <meshStandardMaterial color={plateColor} metalness={0.4} roughness={0.35} />
      </mesh>

      {/* Handset cradle at the back — two raised humps */}
      <mesh position={[-0.75, 0.58, -1.3]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.16, 18]} />
        <meshStandardMaterial color={plateColor} metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0.75, 0.58, -1.3]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.16, 18]} />
        <meshStandardMaterial color={plateColor} metalness={0.5} roughness={0.35} />
      </mesh>

      {/* LCD readout strip above the keypad */}
      <LCDDisplay dialed={dialed} position={[0, 0.525, -0.35]} />

      {/* Keypad grid */}
      <Keypad onKeyPress={onKeyPress} keyColor={keyColor} topColor={keyTopColor} />

      {/* Speaker grille dots on the front face */}
      <group position={[0, 0.25, 1.82]}>
        {Array.from({ length: 6 }).map((_, i) => (
          <mesh key={i} position={[(i - 2.5) * 0.18, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.02, 10]} />
            <meshStandardMaterial color="#05050a" metalness={0.2} roughness={0.9} />
          </mesh>
        ))}
      </group>

      {/* Brand plate — "FABRIQUE" embossed on the front */}
      <Html
        position={[0, 0.25, 1.81]}
        center
        distanceFactor={6}
        transform
        occlude="blending"
        wrapperClass="phone-brand-plate"
      >
        <div className="phone-brand">FABRIQUE</div>
      </Html>
    </group>
  );
}

// -----------------------------------------------------------------------------
// LCD display — green-on-black panel, shows the dialed digits.
// -----------------------------------------------------------------------------

function LCDDisplay({
  dialed,
  position,
}: {
  dialed: string;
  position: [number, number, number];
}) {
  return (
    <group position={position}>
      {/* Bezel */}
      <mesh>
        <boxGeometry args={[1.9, 0.02, 0.4]} />
        <meshStandardMaterial color="#05050a" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Glass */}
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.75, 0.3]} />
        <meshBasicMaterial color="#0a2a0e" toneMapped={false} />
      </mesh>
      {/* Dialed digits — drei Html for crisp text that scales with distance */}
      <Html
        position={[0, 0.014, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        transform
        occlude="blending"
        distanceFactor={2.2}
        wrapperClass="phone-lcd"
        pointerEvents="none"
      >
        <div className="phone-lcd-text">{dialed || "——————"}</div>
      </Html>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Keypad — 4x3 grid of clickable keys. Each key has its own small press
// animation (Y dip) when clicked.
// -----------------------------------------------------------------------------

function Keypad({
  onKeyPress,
  keyColor,
  topColor,
}: {
  onKeyPress: (d: string) => void;
  keyColor: string;
  topColor: string;
}) {
  const COLS = 3;
  const ROWS = 4;
  const SPACING_X = 0.55;
  const SPACING_Z = 0.55;
  const originX = -((COLS - 1) * SPACING_X) / 2;
  const originZ = -((ROWS - 1) * SPACING_Z) / 2 + 0.3;
  return (
    <group>
      {KEYS.map((k, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        return (
          <Key
            key={k.digit}
            digit={k.digit}
            letters={k.letters}
            position={[
              originX + col * SPACING_X,
              0.53,
              originZ + row * SPACING_Z,
            ]}
            onPress={() => onKeyPress(k.digit)}
            baseColor={keyColor}
            topColor={topColor}
          />
        );
      })}
    </group>
  );
}

function Key({
  digit,
  letters,
  position,
  onPress,
  baseColor,
  topColor,
}: {
  digit: string;
  letters: string;
  position: [number, number, number];
  onPress: () => void;
  baseColor: string;
  topColor: string;
}) {
  const ref = useRef<THREE.Group>(null);
  const pressed = useRef(0);
  const [hovered, setHovered] = useState(false);

  useFrame((_, delta) => {
    if (!ref.current) return;
    pressed.current = Math.max(0, pressed.current - delta * 5);
    const targetY = position[1] - pressed.current * 0.08;
    ref.current.position.y = THREE.MathUtils.damp(ref.current.position.y, targetY, 18, delta);
  });

  const handlePress = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    pressed.current = 1;
    onPress();
  };

  return (
    <group ref={ref} position={position}>
      {/* Clickable cap */}
      <mesh
        castShadow
        onPointerDown={handlePress}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[0.42, 0.15, 0.42]} />
        <meshStandardMaterial
          color={hovered ? topColor : baseColor}
          metalness={0.15}
          roughness={0.4}
          emissive={hovered ? "#303040" : "#000000"}
          emissiveIntensity={hovered ? 0.3 : 0}
        />
      </mesh>
      {/* Digit label etched on top */}
      <Html
        position={[0, 0.082, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        transform
        occlude="blending"
        distanceFactor={2.2}
        wrapperClass="phone-key-label"
        pointerEvents="none"
      >
        <div className="phone-key-digit">{digit}</div>
        {letters && <div className="phone-key-letters">{letters}</div>}
      </Html>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Handset — earpiece + mouthpiece cylinder, connected to the base by a
// coiled cable. It sits "cradled" on the base by default, wiggling slightly.
// -----------------------------------------------------------------------------

function Handset({
  lifted,
  onToggle,
}: {
  lifted: boolean;
  onToggle: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  // Cradle position vs lifted position. When lifted, it hovers higher and
  // rotates slightly as if held in hand.
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    const targetY = lifted ? 0.95 : 0.62;
    const targetRx = lifted ? -0.5 + Math.sin(t * 2) * 0.02 : 0;
    const targetRz = lifted ? 0.1 : 0;
    const targetZ = lifted ? -1.05 : -1.3;
    groupRef.current.position.y = THREE.MathUtils.damp(
      groupRef.current.position.y,
      targetY + Math.sin(t * 1.4) * (lifted ? 0.02 : 0),
      4,
      0.016,
    );
    groupRef.current.position.z = THREE.MathUtils.damp(
      groupRef.current.position.z,
      targetZ,
      4,
      0.016,
    );
    groupRef.current.rotation.x = THREE.MathUtils.damp(
      groupRef.current.rotation.x,
      targetRx,
      4,
      0.016,
    );
    groupRef.current.rotation.z = THREE.MathUtils.damp(
      groupRef.current.rotation.z,
      targetRz,
      4,
      0.016,
    );
  });
  return (
    <group
      ref={groupRef}
      position={[0, 0.62, -1.3]}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "";
      }}
    >
      {/* Handle bar — cylinder between the two cradle humps */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.14, 0.14, 1.7, 16]} />
        <meshStandardMaterial
          color={hovered ? "#2a2a32" : "#18181c"}
          metalness={0.4}
          roughness={0.35}
          emissive={hovered ? "#101018" : "#000"}
          emissiveIntensity={hovered ? 0.4 : 0}
        />
      </mesh>
      {/* Earpiece bell (left) */}
      <mesh position={[-0.85, 0, 0]} castShadow>
        <sphereGeometry args={[0.24, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#18181c" metalness={0.3} roughness={0.45} />
      </mesh>
      {/* Earpiece grille */}
      <mesh position={[-0.85, 0.17, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.16, 18]} />
        <meshStandardMaterial color="#05050a" metalness={0.2} roughness={0.9} />
      </mesh>
      {/* Mouthpiece bell (right) */}
      <mesh position={[0.85, 0, 0]} rotation={[0, 0, Math.PI]} castShadow>
        <sphereGeometry args={[0.22, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#18181c" metalness={0.3} roughness={0.45} />
      </mesh>
      {/* Mouthpiece grille */}
      <mesh position={[0.85, -0.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.14, 18]} />
        <meshStandardMaterial color="#05050a" metalness={0.2} roughness={0.9} />
      </mesh>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Cable — coiled tube between base and handset. Simple helical curve.
// -----------------------------------------------------------------------------

function PhoneCable({ lifted }: { lifted: boolean }) {
  const curve = useMemo(() => {
    // Helix from base-right-side (0.9, 0.3, -0.4) down-sag to floor and up
    // to the handset mouthpiece. Lifted/cradled positions slightly change
    // the endpoint so the cable doesn't pass through the handset.
    const pts: THREE.Vector3[] = [];
    const turns = 8;
    const segPerTurn = 14;
    const coilRadius = 0.13;
    for (let i = 0; i <= turns * segPerTurn; i++) {
      const t = i / (turns * segPerTurn);
      const theta = t * turns * Math.PI * 2;
      // Follow a sag curve from base anchor (1.2, 0.3, 0.5) to handset end
      // (-0.85, 0.6, -1.3). Sag midpoint dips to (0.2, 0.05, -0.4).
      const bezier = (a: number, b: number, c: number) =>
        (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
      const endY = lifted ? 0.95 : 0.62;
      const endZ = lifted ? -1.05 : -1.3;
      const cx = bezier(1.2, 0.2, -0.85);
      const cy = bezier(0.3, 0.05, endY);
      const cz = bezier(0.5, -0.4, endZ);
      pts.push(
        new THREE.Vector3(
          cx + Math.cos(theta) * coilRadius,
          cy + Math.sin(theta) * coilRadius * 0.5,
          cz + Math.sin(theta) * coilRadius,
        ),
      );
    }
    return new THREE.CatmullRomCurve3(pts);
  }, [lifted]);
  return (
    <mesh>
      <tubeGeometry args={[curve, 220, 0.03, 6, false]} />
      <meshStandardMaterial color="#0e0e12" metalness={0.25} roughness={0.6} />
    </mesh>
  );
}

// -----------------------------------------------------------------------------
// Post-it note — stuck to the right side of the phone base with the secret
// number scrawled on it. Slightly tilted for charm.
// -----------------------------------------------------------------------------

function PostIt({ secret }: { secret: string }) {
  return (
    <group position={[1.5, 0.02, 0.9]} rotation={[-Math.PI / 2, 0, -0.12]}>
      <mesh>
        <planeGeometry args={[0.9, 0.9]} />
        <meshStandardMaterial color="#ffe066" roughness={0.95} metalness={0} />
      </mesh>
      <Html
        position={[0, 0, 0.005]}
        transform
        occlude="blending"
        distanceFactor={2.2}
        wrapperClass="phone-postit"
        pointerEvents="none"
      >
        <div className="phone-postit-inner">
          <div className="phone-postit-label">CALL</div>
          <div className="phone-postit-num">{secret}</div>
        </div>
      </Html>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Spotlight rig — single cone of warm light from above the phone, plus a
// very dim ambient fill so the rest of the desk isn't pitch black.
// -----------------------------------------------------------------------------

function LightRig() {
  const spot = useRef<THREE.SpotLight>(null);
  useEffect(() => {
    if (spot.current) {
      spot.current.target.position.set(0, 0, 0);
      spot.current.target.updateMatrixWorld();
    }
  }, []);
  return (
    <>
      <ambientLight intensity={0.08} color="#405068" />
      <spotLight
        ref={spot}
        position={[0, 6, 0.5]}
        angle={0.45}
        penumbra={0.7}
        intensity={80}
        distance={14}
        decay={2}
        color="#fff0d8"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      {/* Edge rim light from behind so the handset reads against the dark */}
      <pointLight position={[-2, 2, -3]} color="#4080ff" intensity={0.5} distance={8} />
    </>
  );
}

// -----------------------------------------------------------------------------
// Visible cone-of-light — a translucent cone mesh that shows the spotlight
// beam descending through the air. Dust motes optional.
// -----------------------------------------------------------------------------

function VisibleLightCone() {
  return (
    <mesh position={[0, 3, 0.5]} rotation={[Math.PI, 0, 0]}>
      <coneGeometry args={[2.4, 6, 28, 1, true]} />
      <meshBasicMaterial
        color="#fff0d0"
        transparent
        opacity={0.04}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// -----------------------------------------------------------------------------
// Main scene
// -----------------------------------------------------------------------------

export function PhoneScene() {
  const [dialed, setDialed] = useState("");
  const [lifted, setLifted] = useState(false);
  const alienTimer = useRef<number | null>(null);

  const onKeyPress = useCallback(
    (d: string) => {
      playSound("phone-key", 0.7);
      setDialed((prev) => {
        // Only digits register on the "dialed" display. Cap at 10 chars.
        if (!/[0-9]/.test(d)) return prev;
        const next = (prev + d).slice(-10);
        // Check for secret match on this keystroke.
        if (next.endsWith(SECRET_NUMBER) && lifted) {
          // Trigger alien response after a short pause.
          if (alienTimer.current) window.clearTimeout(alienTimer.current);
          alienTimer.current = window.setTimeout(() => {
            playSound("alien", 1);
          }, 700);
        }
        return next;
      });
    },
    [lifted],
  );

  const onToggleHandset = useCallback(() => {
    setLifted((v) => {
      if (!v) {
        // Picking up → dial tone.
        playSound("phone-dial", 0.5);
      } else {
        // Hanging up → click + clear dialed display.
        playSound("phone-hang", 0.6);
        setDialed("");
      }
      return !v;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (alienTimer.current) window.clearTimeout(alienTimer.current);
    };
  }, []);

  return (
    <Canvas
      camera={{ position: [0, 2.4, 5.2], fov: 40 }}
      shadows
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={["#02030a"]} />
        <fog attach="fog" args={["#02030a", 6, 18]} />

        <LightRig />
        <VisibleLightCone />
        <Desk />

        <PhoneBody onKeyPress={onKeyPress} dialed={dialed} />
        <Handset lifted={lifted} onToggle={onToggleHandset} />
        <PhoneCable lifted={lifted} />
        <PostIt secret={SECRET_NUMBER} />
      </Suspense>
    </Canvas>
  );
}
