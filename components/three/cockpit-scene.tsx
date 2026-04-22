"use client";

/**
 * Cockpit scene for /about.
 *
 * You're inside the FABRIQUE ship looking out a cockpit window. Stars +
 * nebula wash outside. Two stylized pilots (Edouard + Asa) sit at the
 * console with subtle idle motion. The 2D overlay on the route carries
 * the about-us copy — this scene is the cinematic environment behind it.
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { Stars, Html } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

// -----------------------------------------------------------------------------
// Nebula billboard with shader-based radial fade (same trick as coal scene).
// -----------------------------------------------------------------------------

function CockpitNebula({
  url,
  position,
  scale,
  opacity = 0.7,
  tint = "#ffffff",
  spinSpeed = 0.003,
}: {
  url: string;
  position: [number, number, number];
  scale: number;
  opacity?: number;
  tint?: string;
  spinSpeed?: number;
}) {
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
      },
      undefined,
      () => {
        if (cancelled) return;
        setTexture(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.z += delta * spinSpeed;
  });

  const uniforms = useMemo(
    () => ({
      uMap: { value: null as THREE.Texture | null },
      uTint: { value: new THREE.Color(tint) },
      uOpacity: { value: opacity },
    }),
    [tint, opacity],
  );
  useEffect(() => {
    uniforms.uMap.value = texture;
  }, [texture, uniforms]);

  if (!texture) return null;
  return (
    <mesh ref={ref} position={position}>
      <planeGeometry args={[scale, scale]} />
      <shaderMaterial
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform sampler2D uMap;
          uniform vec3 uTint;
          uniform float uOpacity;
          varying vec2 vUv;
          void main() {
            vec4 tex = texture2D(uMap, vUv);
            vec2 fc = vUv - 0.5;
            float dist = length(fc);
            float fade = 1.0 - smoothstep(0.22, 0.5, dist);
            float luma = max(max(tex.r, tex.g), tex.b);
            float crush = smoothstep(0.05, 0.2, luma);
            gl_FragColor = vec4(tex.rgb * uTint * fade * crush * uOpacity, 1.0);
          }
        `}
      />
    </mesh>
  );
}

// -----------------------------------------------------------------------------
// Astronaut — stylized pilot with arms posed toward the console + idle bob.
// -----------------------------------------------------------------------------

function Astronaut({
  position,
  suit,
  accent,
  name,
  phaseOffset = 0,
  line,
}: {
  position: [number, number, number];
  suit: string;
  accent: string;
  name: string;
  phaseOffset?: number;
  /** Current dialogue bubble — null = no bubble shown. */
  line: string | null;
}) {
  const ref = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime + phaseOffset;
    ref.current.position.y = position[1] + Math.sin(t * 1.2) * 0.02;
    // Slight head turn — they glance around. Turns toward interlocutor when
    // they're speaking so the conversation reads visually.
    if (headRef.current) {
      const baseY = Math.sin(t * 0.4) * 0.18;
      const talkTurn = line ? 0.35 : 0;
      headRef.current.rotation.y = baseY + talkTurn * (position[0] > 0 ? -1 : 1);
      headRef.current.rotation.x = Math.sin(t * 0.3 + 1.2) * 0.05;
    }
  });
  return (
    <group ref={ref} position={position}>
      {/* Torso — rounded cylinder */}
      <mesh position={[0, -0.15, 0]}>
        <capsuleGeometry args={[0.3, 0.55, 8, 16]} />
        <meshStandardMaterial color={suit} metalness={0.15} roughness={0.65} />
      </mesh>
      {/* Chest panel — glowing accent */}
      <mesh position={[0, -0.05, 0.23]}>
        <boxGeometry args={[0.26, 0.2, 0.05]} />
        <meshStandardMaterial
          color="#0a0e1a"
          metalness={0.4}
          roughness={0.4}
          emissive={accent}
          emissiveIntensity={0.8}
          toneMapped={false}
        />
      </mesh>
      {/* Belt */}
      <mesh position={[0, -0.4, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 0.08, 16]} />
        <meshStandardMaterial color="#1a1f2e" metalness={0.5} roughness={0.45} />
      </mesh>

      {/* Shoulders */}
      <mesh position={[-0.34, 0.05, 0]}>
        <sphereGeometry args={[0.14, 14, 14]} />
        <meshStandardMaterial color={suit} metalness={0.2} roughness={0.65} />
      </mesh>
      <mesh position={[0.34, 0.05, 0]}>
        <sphereGeometry args={[0.14, 14, 14]} />
        <meshStandardMaterial color={suit} metalness={0.2} roughness={0.65} />
      </mesh>

      {/* Arms — pointing forward toward console */}
      <mesh position={[-0.35, -0.2, 0.18]} rotation={[-0.8, 0, 0.15]}>
        <capsuleGeometry args={[0.09, 0.38, 6, 12]} />
        <meshStandardMaterial color={suit} metalness={0.15} roughness={0.7} />
      </mesh>
      <mesh position={[0.35, -0.2, 0.18]} rotation={[-0.8, 0, -0.15]}>
        <capsuleGeometry args={[0.09, 0.38, 6, 12]} />
        <meshStandardMaterial color={suit} metalness={0.15} roughness={0.7} />
      </mesh>
      {/* Gloved hands at console */}
      <mesh position={[-0.35, -0.5, 0.48]}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial color="#e0e4ec" metalness={0.2} roughness={0.55} />
      </mesh>
      <mesh position={[0.35, -0.5, 0.48]}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial color="#e0e4ec" metalness={0.2} roughness={0.55} />
      </mesh>

      {/* Helmet (head + visor) */}
      <mesh ref={headRef} position={[0, 0.35, 0]}>
        <sphereGeometry args={[0.24, 24, 24]} />
        <meshPhysicalMaterial
          color="#06090f"
          metalness={0.35}
          roughness={0.1}
          clearcoat={1}
          clearcoatRoughness={0.04}
          reflectivity={0.95}
        />
      </mesh>
      {/* Visor tint — slight blue gradient */}
      <mesh position={[0, 0.33, 0.18]}>
        <sphereGeometry args={[0.2, 18, 18, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshBasicMaterial color="#4a80ff" transparent opacity={0.22} toneMapped={false} />
      </mesh>
      {/* Visor highlight streaks */}
      <mesh position={[-0.05, 0.4, 0.21]} rotation={[0, 0, -0.35]}>
        <planeGeometry args={[0.14, 0.04]} />
        <meshBasicMaterial color="#c0deff" transparent opacity={0.75} toneMapped={false} />
      </mesh>
      <mesh position={[0.08, 0.33, 0.21]} rotation={[0, 0, -0.45]}>
        <planeGeometry args={[0.05, 0.02]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.6} toneMapped={false} />
      </mesh>
      {/* Small backpack / life support on the back */}
      <mesh position={[0, -0.05, -0.28]}>
        <boxGeometry args={[0.35, 0.4, 0.1]} />
        <meshStandardMaterial color="#14182a" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[-0.1, 0.05, -0.34]}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      <mesh position={[0.1, 0.05, -0.34]}>
        <sphereGeometry args={[0.04, 10, 10]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>

      {/* Floating name label below the astronaut */}
      <Html
        position={[0, -0.95, 0]}
        center
        distanceFactor={5}
        pointerEvents="none"
        zIndexRange={[30, 35]}
      >
        <div className="pilot-label" style={{ borderColor: `${accent}aa`, boxShadow: `0 0 14px ${accent}55` }}>
          {name}
        </div>
      </Html>
      {/* Speech bubble — anchored to the pilot's head in 3D but rendered at
          native screen size (no distanceFactor) so the bubble always reads
          big + clean regardless of camera distance. */}
      <Html
        position={[0, 1.5, 0]}
        center
        pointerEvents="none"
        zIndexRange={[36, 40]}
      >
        <div
          className={`pilot-chat-bubble${line ? " is-visible" : ""}`}
          style={{
            borderColor: `${accent}dd`,
            boxShadow: `0 6px 28px ${accent}55`,
          }}
        >
          {line ?? ""}
        </div>
      </Html>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Interior chrome — back wall, side panels, and two pilot seats
// -----------------------------------------------------------------------------

/** Steel back wall + side panels behind the pilots, so the cockpit feels
    like an enclosed room, not a pair of guys floating in a frame. */
function CockpitInterior() {
  return (
    <group>
      {/* Back wall — big steel panel with horizontal seams. */}
      <mesh position={[0, 0.1, 1.8]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[9, 5]} />
        <meshStandardMaterial
          color="#141822"
          metalness={0.75}
          roughness={0.35}
          emissive="#0a1a34"
          emissiveIntensity={0.15}
        />
      </mesh>
      {/* Horizontal seams on the wall */}
      {[-1.4, -0.6, 0.2, 1, 1.8].map((y, i) => (
        <mesh key={`seam-${i}`} position={[0, y, 1.79]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[8.8, 0.015]} />
          <meshBasicMaterial color="#3a4866" transparent opacity={0.7} toneMapped={false} />
        </mesh>
      ))}
      {/* A few back-wall rivets */}
      {[-3.2, -1.2, 1.2, 3.2].flatMap((x) =>
        [-1.2, 0.1, 1.4].map((y, i) => (
          <mesh key={`rivet-${x}-${i}`} position={[x, y, 1.78]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color="#6a758c" metalness={0.85} roughness={0.28} />
          </mesh>
        )),
      )}

      {/* Left side panel — glowing status strip */}
      <mesh position={[-4, 0, 0.6]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[2.2, 3.5]} />
        <meshStandardMaterial
          color="#14182a"
          metalness={0.8}
          roughness={0.35}
          emissive="#081430"
          emissiveIntensity={0.2}
        />
      </mesh>
      {/* Glowing light strips on the left side */}
      {[0.8, 0.2, -0.4, -1.0].map((y, i) => (
        <mesh
          key={`lstrip-${i}`}
          position={[-3.99, y, 0.6]}
          rotation={[0, Math.PI / 2, 0]}
        >
          <planeGeometry args={[0.08, 0.9]} />
          <meshBasicMaterial color={i % 2 ? "#4ea8ff" : "#80ffd0"} toneMapped={false} />
        </mesh>
      ))}

      {/* Right side panel — mirror */}
      <mesh position={[4, 0, 0.6]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[2.2, 3.5]} />
        <meshStandardMaterial
          color="#14182a"
          metalness={0.8}
          roughness={0.35}
          emissive="#081430"
          emissiveIntensity={0.2}
        />
      </mesh>
      {[0.8, 0.2, -0.4, -1.0].map((y, i) => (
        <mesh
          key={`rstrip-${i}`}
          position={[3.99, y, 0.6]}
          rotation={[0, -Math.PI / 2, 0]}
        >
          <planeGeometry args={[0.08, 0.9]} />
          <meshBasicMaterial color={i % 2 ? "#ff80c0" : "#ffd040"} toneMapped={false} />
        </mesh>
      ))}

      {/* Two pilot seats — captain's chairs */}
      {[-1.4, 1.4].map((x, i) => (
        <group key={`seat-${i}`} position={[x, -0.9, 1.2]}>
          {/* Seat base */}
          <mesh>
            <boxGeometry args={[0.85, 0.2, 0.9]} />
            <meshStandardMaterial color="#1a1f2e" metalness={0.4} roughness={0.55} />
          </mesh>
          {/* Seat back */}
          <mesh position={[0, 0.6, -0.35]}>
            <boxGeometry args={[0.85, 1.4, 0.18]} />
            <meshStandardMaterial color="#1a1f2e" metalness={0.4} roughness={0.55} />
          </mesh>
          {/* Headrest */}
          <mesh position={[0, 1.35, -0.3]}>
            <boxGeometry args={[0.55, 0.35, 0.2]} />
            <meshStandardMaterial color="#2a3348" metalness={0.4} roughness={0.55} />
          </mesh>
          {/* Armrests */}
          <mesh position={[-0.42, 0.25, 0.1]}>
            <boxGeometry args={[0.08, 0.15, 0.7]} />
            <meshStandardMaterial color="#2a3348" metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[0.42, 0.25, 0.1]}>
            <boxGeometry args={[0.08, 0.15, 0.7]} />
            <meshStandardMaterial color="#2a3348" metalness={0.4} roughness={0.5} />
          </mesh>
          {/* Seat side trim — glowing accent */}
          <mesh position={[0, 0.3, 0.46]}>
            <boxGeometry args={[0.87, 0.02, 0.02]} />
            <meshBasicMaterial color="#5aa0ff" toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* Ceiling frame strip with small dim lights */}
      <mesh position={[0, 2.3, 0]}>
        <boxGeometry args={[7.5, 0.15, 0.4]} />
        <meshStandardMaterial color="#14182a" metalness={0.7} roughness={0.35} />
      </mesh>
      {[-3, -1.5, 0, 1.5, 3].map((x, i) => (
        <mesh key={`cl-${i}`} position={[x, 2.23, 0.15]}>
          <sphereGeometry args={[0.06, 10, 10]} />
          <meshStandardMaterial
            color="#c0d8ff"
            emissive="#80b8ff"
            emissiveIntensity={1.4}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Hull ribs — vertical arch beams on either side of the window for
          that "we're inside a real ship" structural feel. */}
      {[-4, -3.2, 3.2, 4].map((x, i) => (
        <mesh key={`rib-${i}`} position={[x, 0.2, 0.3]}>
          <boxGeometry args={[0.18, 4.8, 0.3]} />
          <meshStandardMaterial color="#1a1f2e" metalness={0.75} roughness={0.3} />
        </mesh>
      ))}

      {/* Central raised console between the pilots — houses the radar +
          yoke. Sits just behind the dashboard bar. */}
      <mesh position={[0, -1.1, 1]}>
        <boxGeometry args={[1.7, 0.5, 1.2]} />
        <meshStandardMaterial color="#10131e" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, -0.85, 1.1]}>
        <boxGeometry args={[1.5, 0.04, 1]} />
        <meshStandardMaterial color="#2a3350" metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Holographic radar — glowing disc with rotating sweep arm + blips. */}
      <HoloRadar position={[0, -0.75, 1.1]} />

      {/* Control yoke / joystick between the pilots */}
      <group position={[0, -0.75, 1.65]}>
        <mesh>
          <cylinderGeometry args={[0.05, 0.07, 0.45, 10]} />
          <meshStandardMaterial color="#2a3348" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.28, 0]}>
          <sphereGeometry args={[0.1, 14, 14]} />
          <meshStandardMaterial
            color="#3d4860"
            metalness={0.5}
            roughness={0.4}
            emissive="#5aa0ff"
            emissiveIntensity={0.2}
          />
        </mesh>
        {/* Trigger button */}
        <mesh position={[0, 0.28, 0.1]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshStandardMaterial color="#ff5060" emissive="#ff5060" emissiveIntensity={1.4} toneMapped={false} />
        </mesh>
      </group>

      {/* Small button clusters flanking the central console */}
      {[-0.65, 0.65].map((x, i) => (
        <group key={`cluster-${i}`} position={[x, -0.85, 1.25]}>
          {[
            [-0.08, 0, 0, "#40ffa0"],
            [0, 0, 0, "#4ea8ff"],
            [0.08, 0, 0, "#ff5aa0"],
            [-0.04, 0, 0.08, "#ffd040"],
            [0.04, 0, 0.08, "#a040ff"],
          ].map(([bx, by, bz, c], j) => (
            <mesh key={j} position={[bx as number, by as number, bz as number]}>
              <cylinderGeometry args={[0.018, 0.018, 0.025, 8]} />
              <meshStandardMaterial
                color={c as string}
                emissive={c as string}
                emissiveIntensity={0.9}
                toneMapped={false}
              />
            </mesh>
          ))}
        </group>
      ))}

      {/* Overhead HUD panel — small rectangular readout with scrolling
          indicator lights */}
      <group position={[0, 1.65, 0.4]}>
        <mesh>
          <boxGeometry args={[2.4, 0.5, 0.12]} />
          <meshStandardMaterial color="#0c0f1a" metalness={0.7} roughness={0.35} />
        </mesh>
        <HudStrip />
      </group>
    </group>
  );
}

/** Circular radar display: rotating sweep arm + a few blip dots. */
function HoloRadar({ position }: { position: [number, number, number] }) {
  const armRef = useRef<THREE.Mesh>(null);
  const blipsRef = useRef<Array<THREE.Mesh | null>>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (armRef.current) armRef.current.rotation.y = t * 1.5;
    blipsRef.current.forEach((m, i) => {
      if (!m) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 1.2 + Math.sin(t * 3 + i * 1.7) * 0.8;
    });
  });
  return (
    <group position={position}>
      {/* Base disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.38, 48]} />
        <meshBasicMaterial color="#0a1830" transparent opacity={0.8} toneMapped={false} />
      </mesh>
      {/* Concentric rings */}
      {[0.12, 0.24, 0.36].map((r, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
          <ringGeometry args={[r - 0.005, r, 64]} />
          <meshBasicMaterial color="#4eb0ff" transparent opacity={0.55} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* Sweep arm — a ring wedge that rotates */}
      <mesh ref={armRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[0, 0.38, 24, 1, 0, Math.PI * 0.25]} />
        <meshBasicMaterial color="#4ea8ff" transparent opacity={0.35} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {/* Blip dots — static positions, animated emissive */}
      {[
        [0.14, 0, 0.08],
        [-0.1, 0, 0.22],
        [0.22, 0, -0.14],
        [-0.24, 0, -0.06],
      ].map((p, i) => (
        <mesh
          key={i}
          position={[p[0], 0.004, p[2]]}
          ref={(m) => {
            blipsRef.current[i] = m;
          }}
        >
          <sphereGeometry args={[0.02, 10, 10]} />
          <meshStandardMaterial
            color="#80ffd0"
            emissive="#80ffd0"
            emissiveIntensity={1.4}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Overhead HUD — row of small indicator bars that pulse/fill like a status readout. */
function HudStrip() {
  const bars = 16;
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const scale = 0.3 + Math.abs(Math.sin(t * 2 + i * 0.4)) * 0.7;
      m.scale.y = scale;
    });
  });
  return (
    <group position={[0, 0, 0.065]}>
      {Array.from({ length: bars }).map((_, i) => {
        const x = -1.05 + (i / (bars - 1)) * 2.1;
        return (
          <mesh
            key={i}
            position={[x, 0, 0]}
            ref={(m) => {
              refs.current[i] = m;
            }}
          >
            <boxGeometry args={[0.06, 0.3, 0.01]} />
            <meshStandardMaterial
              color={i % 3 === 0 ? "#ff80c0" : i % 3 === 1 ? "#4ea8ff" : "#80ffd0"}
              emissive={i % 3 === 0 ? "#ff80c0" : i % 3 === 1 ? "#4ea8ff" : "#80ffd0"}
              emissiveIntensity={1.1}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// -----------------------------------------------------------------------------
// Cockpit frame — chunkier, more detailed bezel
// -----------------------------------------------------------------------------

function CockpitFrame() {
  const shape = useMemo(() => {
    const w = 5.4;
    const h = 3.0;
    const r = 1.0;
    const s = new THREE.Shape();
    s.moveTo(-w + r, -h);
    s.lineTo(w - r, -h);
    s.quadraticCurveTo(w, -h, w, -h + r);
    s.lineTo(w, h - r);
    s.quadraticCurveTo(w, h, w - r, h);
    s.lineTo(-w + r, h);
    s.quadraticCurveTo(-w, h, -w, h - r);
    s.lineTo(-w, -h + r);
    s.quadraticCurveTo(-w, -h, -w + r, -h);
    const hole = new THREE.Path();
    const iw = w - 0.9;
    const ih = h - 0.7;
    const ir = 0.7;
    hole.moveTo(-iw + ir, -ih);
    hole.lineTo(iw - ir, -ih);
    hole.quadraticCurveTo(iw, -ih, iw, -ih + ir);
    hole.lineTo(iw, ih - ir);
    hole.quadraticCurveTo(iw, ih, iw - ir, ih);
    hole.lineTo(-iw + ir, ih);
    hole.quadraticCurveTo(-iw, ih, -iw, ih - ir);
    hole.lineTo(-iw, -ih + ir);
    hole.quadraticCurveTo(-iw, -ih, -iw + ir, -ih);
    s.holes.push(hole);
    return s;
  }, []);

  return (
    <group position={[0, 0.2, 1]}>
      {/* Main frame */}
      <mesh>
        <extrudeGeometry
          args={[
            shape,
            {
              depth: 0.4,
              bevelEnabled: true,
              bevelSize: 0.08,
              bevelThickness: 0.08,
              bevelSegments: 3,
            },
          ]}
        />
        <meshStandardMaterial
          color="#181d2a"
          metalness={0.75}
          roughness={0.28}
          emissive="#0a1830"
          emissiveIntensity={0.25}
        />
      </mesh>
      {/* Inner rim with a soft glow seam */}
      <mesh position={[0, 0, 0.42]}>
        <torusGeometry args={[3.6, 0.025, 6, 64]} />
        <meshBasicMaterial color="#4ea8ff" transparent opacity={0.65} toneMapped={false} />
      </mesh>
      {/* Corner rivets */}
      {[
        [-4.8, 2.6],
        [4.8, 2.6],
        [-4.8, -2.6],
        [4.8, -2.6],
      ].map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.25]}>
          <sphereGeometry args={[0.08, 10, 10]} />
          <meshStandardMaterial color="#6a758c" metalness={0.8} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

// -----------------------------------------------------------------------------
// Dashboard — with the glowing buttons + two curved screens.
// -----------------------------------------------------------------------------

function Dashboard() {
  const buttons: Array<[number, string]> = [
    [-2.4, "#5aa0ff"],
    [-1.6, "#80ffd0"],
    [-0.8, "#ffa040"],
    [0, "#ff5aa0"],
    [0.8, "#a040ff"],
    [1.6, "#40ffa0"],
    [2.4, "#ffd040"],
  ];
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const screenLRef = useRef<THREE.Mesh>(null);
  const screenRRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    refs.current.forEach((m, i) => {
      if (!m) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + Math.sin(t * 2 + i * 0.8) * 0.5;
    });
    // Pulse the side screens.
    [screenLRef.current, screenRRef.current].forEach((m, i) => {
      if (!m) return;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.45 + Math.sin(t * 1.3 + i * 2.1) * 0.18;
    });
  });
  return (
    <group position={[0, -1.6, -0.2]}>
      {/* Console bar */}
      <mesh>
        <boxGeometry args={[6, 0.45, 0.35]} />
        <meshStandardMaterial color="#0c1020" metalness={0.65} roughness={0.35} />
      </mesh>
      {/* Beveled top edge */}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[5.9, 0.05, 0.4]} />
        <meshStandardMaterial color="#2a3150" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Buttons */}
      {buttons.map(([x, c], i) => (
        <mesh
          key={i}
          position={[x, 0.1, 0.22]}
          ref={(m) => {
            refs.current[i] = m;
          }}
        >
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshStandardMaterial
            color={c}
            emissive={c}
            emissiveIntensity={0.9}
            toneMapped={false}
          />
        </mesh>
      ))}
      {/* Side screens */}
      <mesh ref={screenLRef} position={[-2.7, 0.15, 0.24]} rotation={[0, 0.2, 0]}>
        <planeGeometry args={[0.9, 0.3]} />
        <meshBasicMaterial color="#4ea8ff" transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <mesh ref={screenRRef} position={[2.7, 0.15, 0.24]} rotation={[0, -0.2, 0]}>
        <planeGeometry args={[0.9, 0.3]} />
        <meshBasicMaterial color="#ff80c0" transparent opacity={0.5} toneMapped={false} />
      </mesh>
    </group>
  );
}

// -----------------------------------------------------------------------------
// Camera idle bob — we're in a ship, it sways subtly
// -----------------------------------------------------------------------------

function CameraBob() {
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime;
    camera.position.x = Math.sin(t * 0.35) * 0.18;
    camera.position.y = Math.sin(t * 0.27 + 1.2) * 0.12;
    camera.lookAt(0, 0.1, 0);
  });
  return null;
}

// -----------------------------------------------------------------------------
// Cockpit dialogue — randomized back-and-forth between Edouard + Asa
// -----------------------------------------------------------------------------

/** Scripted 2-3 turn conversations between Edouard and Asa. Each array
    plays in order; both speakers' latest lines stay on screen until the
    conversation ends, then both bubbles clear together. */
type DialogueTurn = { who: "edouard" | "asa"; text: string };
type Conversation = DialogueTurn[];

const CONVERSATIONS: Conversation[] = [
  [
    { who: "edouard", text: "morning. coffee?" },
    { who: "asa", text: "please. two sugars." },
    { who: "edouard", text: "on it." },
  ],
  [
    { who: "asa", text: "backend's green across the board." },
    { who: "edouard", text: "nice. I'll push the frontend after lunch." },
  ],
  [
    { who: "edouard", text: "that shader took all weekend." },
    { who: "asa", text: "tell me about it. the API took mine." },
    { who: "edouard", text: "at least we're shipping." },
  ],
  [
    { who: "asa", text: "want me to deploy the preview?" },
    { who: "edouard", text: "yeah, let's ship it." },
    { who: "asa", text: "pushing now." },
  ],
  [
    { who: "edouard", text: "what's the plan for thursday?" },
    { who: "asa", text: "copy pass, then deploy, then chill." },
  ],
  [
    { who: "asa", text: "caught the schema bug this morning." },
    { who: "edouard", text: "you're a legend." },
  ],
  [
    { who: "edouard", text: "thinking about the about page next." },
    { who: "asa", text: "good call. I'll handle the endpoint." },
    { who: "edouard", text: "team." },
  ],
  [
    { who: "asa", text: "quick standup?" },
    { who: "edouard", text: "I pushed physics + cockpit. you?" },
    { who: "asa", text: "email template + rate limit. done." },
  ],
  [
    { who: "edouard", text: "the black hole is holding up nicely." },
    { who: "asa", text: "love it. super cinematic now." },
  ],
  [
    { who: "asa", text: "got a call tomorrow — the new client." },
    { who: "edouard", text: "sweet. I'll put a demo together tonight." },
    { who: "asa", text: "you're the best." },
  ],
  [
    { who: "edouard", text: "nebulas finally look real." },
    { who: "asa", text: "JWST images are wild, huh?" },
    { who: "edouard", text: "free + gorgeous. win-win." },
  ],
  [
    { who: "asa", text: "we should write the changelog soon." },
    { who: "edouard", text: "monday. promise." },
  ],
];

/** Hook that drives a randomized loop over CONVERSATIONS. Exposes BOTH
    speakers' current bubble state so both stay visible during a convo. */
export function useCockpitDialogue() {
  const [edouard, setEdouard] = useState<string | null>(null);
  const [asa, setAsa] = useState<string | null>(null);
  const lastConvIdx = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    /** How long EACH message stays up before the next one appears.
        The last speaker's line stays up for this whole span. */
    const TURN_MS = 5200;
    /** Gap between conversations (after both bubbles clear). */
    const GAP_MS = 3400;

    const wait = (ms: number) =>
      new Promise<void>((r) => setTimeout(() => r(), ms));

    const pickConv = () => {
      if (CONVERSATIONS.length <= 1) return 0;
      let idx = Math.floor(Math.random() * CONVERSATIONS.length);
      if (idx === lastConvIdx.current) {
        idx = (idx + 1) % CONVERSATIONS.length;
      }
      lastConvIdx.current = idx;
      return idx;
    };

    const runConversation = async (conv: Conversation) => {
      // Track the latest line per speaker as the convo progresses.
      let eLine: string | null = null;
      let aLine: string | null = null;
      for (const turn of conv) {
        if (cancelled) return;
        if (turn.who === "edouard") eLine = turn.text;
        else aLine = turn.text;
        setEdouard(eLine);
        setAsa(aLine);
        await wait(TURN_MS);
      }
      if (cancelled) return;
      // Both clear together when the convo ends.
      setEdouard(null);
      setAsa(null);
    };

    const loop = async () => {
      // Small settle delay on mount.
      await wait(1400);
      while (!cancelled) {
        const idx = pickConv();
        await runConversation(CONVERSATIONS[idx]);
        if (cancelled) break;
        await wait(GAP_MS);
      }
    };
    loop();
    return () => {
      cancelled = true;
    };
  }, []);

  return { edouardLine: edouard, asaLine: asa };
}

// -----------------------------------------------------------------------------
// Main scene
// -----------------------------------------------------------------------------

export function CockpitScene({
  edouardLine,
  asaLine,
}: {
  edouardLine: string | null;
  asaLine: string | null;
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 7.5], fov: 50 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", stencil: false }}
    >
      <Suspense fallback={null}>
        <color attach="background" args={["#02030a"]} />

        <ambientLight intensity={0.5} />
        <hemisphereLight args={["#2a3a70", "#050810", 0.6]} />
        <directionalLight position={[4, 4, 3]} intensity={1.0} color="#c0d8ff" />
        {/* Warm fill from the dashboard glow. */}
        <pointLight position={[0, -1.2, 2]} intensity={0.9} color="#ff80c0" distance={6} />
        {/* Cool rim from the window */}
        <pointLight position={[0, 1.5, -3]} intensity={1.1} color="#4ea8ff" distance={8} />

        {/* Through the window — stars + nebula. */}
        <Stars radius={60} depth={40} count={3000} factor={3} saturation={0} fade speed={0.5} />
        <CockpitNebula
          url="/nebulas/carina.jpg"
          position={[0, 0.5, -10]}
          scale={16}
          opacity={0.9}
          spinSpeed={0.003}
        />
        <CockpitNebula
          url="/nebulas/carina.jpg"
          position={[-4, -1, -14]}
          scale={14}
          opacity={0.55}
          tint="#c0a0ff"
          spinSpeed={-0.002}
        />

        {/* Cockpit frame w/ window cutout. */}
        <CockpitFrame />

        {/* Interior chrome — seats, back wall, side panels, ceiling lights. */}
        <CockpitInterior />

        {/* Pilots at the console — now with dialogue. */}
        <Astronaut
          position={[-1.4, -0.6, 1.4]}
          suit="#2a5ac8"
          accent="#80c8ff"
          name="Edouard"
          phaseOffset={0}
          line={edouardLine}
        />
        <Astronaut
          position={[1.4, -0.6, 1.4]}
          suit="#c23a3a"
          accent="#ffa070"
          name="Asa"
          phaseOffset={1.7}
          line={asaLine}
        />

        {/* Dashboard. */}
        <Dashboard />

        <CameraBob />
      </Suspense>
    </Canvas>
  );
}
