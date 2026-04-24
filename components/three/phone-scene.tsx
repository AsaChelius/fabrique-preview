"use client";

/**
 * "Contact" route — interactive 3D phone.
 *
 * Old-school push-button phone on a dark desk, lit from above by a single
 * warm spotlight. Click the handset to pick it up, click the keypad to
 * dial. If the user dials the number on the post-it (`5553223` = 555-FAB3)
 * with the handset lifted, an alien voice plays through the earpiece.
 *
 * All text (keypad digits, LCD readout, post-it) uses drei <Text> so it
 * renders as real 3D geometry — no HTML overlay weirdness.
 */

import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
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
// Desk surface
// -----------------------------------------------------------------------------

function Desk() {
  return (
    <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#0a0b12" roughness={0.92} metalness={0.08} />
    </mesh>
  );
}

// -----------------------------------------------------------------------------
// Phone body — slab base + cradle humps + LCD + brand + speaker dots
// -----------------------------------------------------------------------------

function PhoneBody({ dialed }: { dialed: string }) {
  const bodyColor = "#181822";
  const plateColor = "#0d0d14";
  return (
    <group position={[0, 0, 0]}>
      {/* Base slab — wedge-ish */}
      <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.44, 3.6]} />
        <meshStandardMaterial color={bodyColor} metalness={0.35} roughness={0.45} />
      </mesh>
      {/* Top inset plate where the keypad sits */}
      <mesh position={[0, 0.451, 0.2]} castShadow>
        <boxGeometry args={[2.3, 0.02, 2.5]} />
        <meshStandardMaterial color={plateColor} metalness={0.4} roughness={0.4} />
      </mesh>

      {/* Cradle humps at the back */}
      <mesh position={[-0.88, 0.52, -1.3]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.18, 20]} />
        <meshStandardMaterial color={plateColor} metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0.88, 0.52, -1.3]} castShadow>
        <cylinderGeometry args={[0.22, 0.26, 0.18, 20]} />
        <meshStandardMaterial color={plateColor} metalness={0.5} roughness={0.35} />
      </mesh>

      {/* LCD strip */}
      <LCDDisplay dialed={dialed} />

      {/* Front face speaker grille dots */}
      <group position={[0, 0.22, 1.82]}>
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i} position={[(i - 3) * 0.16, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.02, 10]} />
            <meshStandardMaterial color="#04040a" metalness={0.2} roughness={0.9} />
          </mesh>
        ))}
      </group>

      {/* FABRIQUE brand on the front face, small and subtle */}
      <Text
        position={[0, 0.22, 1.815]}
        fontSize={0.08}
        color="#4a5568"
        letterSpacing={0.3}
        anchorX="center"
        anchorY="middle"
      >
        FABRIQUE
      </Text>
    </group>
  );
}

// -----------------------------------------------------------------------------
// LCD — green Courier readout above the keypad
// -----------------------------------------------------------------------------

function LCDDisplay({ dialed }: { dialed: string }) {
  return (
    <group position={[0, 0.462, -0.7]}>
      {/* Bezel */}
      <mesh>
        <boxGeometry args={[1.9, 0.03, 0.42]} />
        <meshStandardMaterial color="#04040a" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Glass */}
      <mesh position={[0, 0.016, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1.75, 0.3]} />
        <meshStandardMaterial
          color="#082208"
          emissive="#0a280a"
          emissiveIntensity={0.6}
          metalness={0.1}
          roughness={0.2}
        />
      </mesh>
      <Text
        position={[0, 0.018, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.16}
        color="#a0ffa0"
        letterSpacing={0.12}
        anchorX="center"
        anchorY="middle"
        font={undefined}
        outlineWidth={0}
      >
        {dialed || "— — — — — — —"}
      </Text>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Keypad — 4×3 clickable key grid. Each key dips on press.
// -----------------------------------------------------------------------------

function Keypad({ onKeyPress }: { onKeyPress: (d: string) => void }) {
  const COLS = 3;
  const ROWS = 4;
  const SPACING_X = 0.5;
  const SPACING_Z = 0.45;
  const originX = -((COLS - 1) * SPACING_X) / 2;
  const originZ = -((ROWS - 1) * SPACING_Z) / 2 + 0.35;
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
              0.48,
              originZ + row * SPACING_Z,
            ]}
            onPress={() => onKeyPress(k.digit)}
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
}: {
  digit: string;
  letters: string;
  position: [number, number, number];
  onPress: () => void;
}) {
  const ref = useRef<THREE.Group>(null);
  const pressed = useRef(0);
  const [hovered, setHovered] = useState(false);

  useFrame((_, delta) => {
    if (!ref.current) return;
    pressed.current = Math.max(0, pressed.current - delta * 5);
    const targetY = position[1] - pressed.current * 0.06;
    ref.current.position.y = THREE.MathUtils.damp(
      ref.current.position.y,
      targetY,
      20,
      delta,
    );
  });

  const handlePress = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    pressed.current = 1;
    onPress();
  };

  return (
    <group ref={ref} position={position}>
      {/* Cap */}
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
        <boxGeometry args={[0.38, 0.12, 0.34]} />
        <meshStandardMaterial
          color={hovered ? "#ffffff" : "#ececf2"}
          metalness={0.1}
          roughness={0.4}
          emissive={hovered ? "#6080a0" : "#000"}
          emissiveIntensity={hovered ? 0.35 : 0}
        />
      </mesh>
      {/* Digit — 3D text above the cap */}
      <Text
        position={[0, 0.064, -0.02]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.12}
        color="#111116"
        anchorX="center"
        anchorY="middle"
        fontWeight={700}
      >
        {digit}
      </Text>
      {/* Letters below digit */}
      {letters && (
        <Text
          position={[0, 0.064, 0.08]}
          rotation={[-Math.PI / 2, 0, 0]}
          fontSize={0.042}
          color="#4a4a54"
          letterSpacing={0.06}
          anchorX="center"
          anchorY="middle"
        >
          {letters}
        </Text>
      )}
    </group>
  );
}

// -----------------------------------------------------------------------------
// Handset — earpiece + mouthpiece + handle. Toggles between cradle and lift.
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
  useFrame(({ clock }, delta) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    const targetY = lifted ? 1.05 : 0.58;
    const targetZ = lifted ? -0.7 : -1.3;
    const targetRx = lifted ? -0.4 + Math.sin(t * 1.6) * 0.015 : 0;
    const targetRz = lifted ? 0.18 : 0;
    groupRef.current.position.y = THREE.MathUtils.damp(
      groupRef.current.position.y,
      targetY + (lifted ? Math.sin(t * 1.3) * 0.015 : 0),
      5,
      delta,
    );
    groupRef.current.position.z = THREE.MathUtils.damp(
      groupRef.current.position.z,
      targetZ,
      5,
      delta,
    );
    groupRef.current.rotation.x = THREE.MathUtils.damp(
      groupRef.current.rotation.x,
      targetRx,
      5,
      delta,
    );
    groupRef.current.rotation.z = THREE.MathUtils.damp(
      groupRef.current.rotation.z,
      targetRz,
      5,
      delta,
    );
  });
  return (
    <group
      ref={groupRef}
      position={[0, 0.58, -1.3]}
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
      {/* Handle shaft */}
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.11, 0.11, 1.7, 18]} />
        <meshStandardMaterial
          color={hovered ? "#28283a" : "#16161e"}
          metalness={0.35}
          roughness={0.4}
          emissive={hovered ? "#0a0a18" : "#000"}
          emissiveIntensity={hovered ? 0.6 : 0}
        />
      </mesh>
      {/* Earpiece bell (left end) */}
      <group position={[-0.85, 0, 0]}>
        <mesh castShadow>
          <sphereGeometry
            args={[0.22, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]}
          />
          <meshStandardMaterial
            color={hovered ? "#20202e" : "#14141c"}
            metalness={0.3}
            roughness={0.45}
          />
        </mesh>
        <mesh position={[0, 0.115, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.14, 18]} />
          <meshStandardMaterial color="#04040a" metalness={0.2} roughness={0.9} />
        </mesh>
      </group>
      {/* Mouthpiece bell (right end) */}
      <group position={[0.85, 0, 0]} rotation={[0, 0, Math.PI]}>
        <mesh castShadow>
          <sphereGeometry
            args={[0.2, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.55]}
          />
          <meshStandardMaterial
            color={hovered ? "#20202e" : "#14141c"}
            metalness={0.3}
            roughness={0.45}
          />
        </mesh>
        <mesh position={[0, 0.105, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.12, 18]} />
          <meshStandardMaterial color="#04040a" metalness={0.2} roughness={0.9} />
        </mesh>
      </group>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Cable — coiled tube, endpoints track the handset state
// -----------------------------------------------------------------------------

function PhoneCable({ lifted }: { lifted: boolean }) {
  const curve = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const turns = 10;
    const segPerTurn = 16;
    const coilR = 0.1;
    const endY = lifted ? 1.05 : 0.58;
    const endZ = lifted ? -0.7 : -1.3;
    for (let i = 0; i <= turns * segPerTurn; i++) {
      const t = i / (turns * segPerTurn);
      const theta = t * turns * Math.PI * 2;
      // Bezier sag from base-right to handset end
      const bx = (1 - t) * (1 - t) * 1.35 + 2 * (1 - t) * t * 0.25 + t * t * -0.9;
      const by =
        (1 - t) * (1 - t) * 0.2 + 2 * (1 - t) * t * 0.02 + t * t * endY;
      const bz =
        (1 - t) * (1 - t) * 0.6 + 2 * (1 - t) * t * -0.3 + t * t * endZ;
      pts.push(
        new THREE.Vector3(
          bx + Math.cos(theta) * coilR,
          by + Math.sin(theta) * coilR * 0.6,
          bz + Math.sin(theta) * coilR,
        ),
      );
    }
    return new THREE.CatmullRomCurve3(pts);
  }, [lifted]);
  return (
    <mesh>
      <tubeGeometry args={[curve, 260, 0.028, 8, false]} />
      <meshStandardMaterial color="#0e0e14" metalness={0.25} roughness={0.55} />
    </mesh>
  );
}

// -----------------------------------------------------------------------------
// Post-it — yellow sticky with the secret number in a handwritten-ish font
// -----------------------------------------------------------------------------

function PostIt({ secret }: { secret: string }) {
  const formatted = `${secret.slice(0, 3)}-${secret.slice(3)}`;
  return (
    <group position={[2.0, 0.012, 1.0]} rotation={[-Math.PI / 2, 0, -0.18]}>
      {/* Paper */}
      <mesh receiveShadow>
        <planeGeometry args={[1.0, 1.0]} />
        <meshStandardMaterial
          color="#ffe066"
          roughness={0.95}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      <Text
        position={[0, 0.28, 0.003]}
        fontSize={0.1}
        color="#3a2a00"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.08}
      >
        CALL
      </Text>
      <Text
        position={[0, 0.02, 0.003]}
        fontSize={0.22}
        color="#2a1a00"
        fontWeight={700}
        anchorX="center"
        anchorY="middle"
      >
        {formatted}
      </Text>
      <Text
        position={[0, -0.26, 0.003]}
        fontSize={0.07}
        color="#5a3a00"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.2}
      >
        pick up handset
      </Text>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Lighting
// -----------------------------------------------------------------------------

function LightRig() {
  const spotRef = useRef<THREE.SpotLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  useEffect(() => {
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current;
    }
  }, []);
  return (
    <>
      <ambientLight intensity={0.06} color="#405068" />
      {/* Warm spotlight from above */}
      <spotLight
        ref={spotRef}
        position={[0, 5.5, 0.4]}
        angle={0.42}
        penumbra={0.55}
        intensity={90}
        distance={14}
        decay={2}
        color="#ffe8c0"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <object3D ref={targetRef} position={[0, 0, 0]} />
      {/* Cool rim light from the left behind the phone, for separation */}
      <pointLight position={[-3, 2.5, -2.5]} color="#4080ff" intensity={0.6} distance={9} />
      {/* Subtle warm accent on the post-it side */}
      <pointLight position={[2.5, 1.2, 1.5]} color="#ffd070" intensity={0.25} distance={4} />
    </>
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
        if (!/[0-9]/.test(d)) return prev;
        const next = (prev + d).slice(-10);
        if (next.endsWith(SECRET_NUMBER) && lifted) {
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
        playSound("phone-dial", 0.55);
      } else {
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
      // Pulled back + up for a desk-view angle that shows the whole phone
      // and its post-it, with room above for the spotlight beam.
      camera={{ position: [0.5, 4.8, 7.5], fov: 32 }}
      shadows
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%" }}
      onCreated={({ camera }) => camera.lookAt(0, 0.4, 0)}
    >
      <Suspense fallback={null}>
        <color attach="background" args={["#02030a"]} />
        <fog attach="fog" args={["#02030a", 9, 22]} />

        <LightRig />
        <Desk />
        <PhoneBody dialed={dialed} />
        <Keypad onKeyPress={onKeyPress} />
        <Handset lifted={lifted} onToggle={onToggleHandset} />
        <PhoneCable lifted={lifted} />
        <PostIt secret={SECRET_NUMBER} />
      </Suspense>
    </Canvas>
  );
}
