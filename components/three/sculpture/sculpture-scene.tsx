"use client";

/**
 * Anamorphic FABRIQUE — Phase 1.
 *
 * White gallery scene. One camera pose (sweet-spot A). Studio HDRI for
 * reflections on the shards. Contact shadow on the floor sells the
 * "suspended in air" read.
 *
 * No interaction, no camera animation, no dual silhouette — all of that
 * comes later. Phase 1's job is to prove the shard cloud looks beautiful
 * from the correct angle.
 */

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { Center, Environment, Text3D } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PerspectiveCamera as PerspectiveCameraImpl } from "three";
import { SuspendedCloud } from "./suspended-cloud";
import { ProjectsButton } from "./projects-button";
import { AboutUsMetalButton } from "./about-us-metal-button";
import { useSculpturePalette, type SculpturePalette } from "./palette";
import { TUNING } from "./tuning";
import { onReveal } from "./reveal-bus";
import { setCursorHover, resetCursorHover } from "./cursor-bus";
import { pruneDrops } from "./ripple-bus";
import { startFall, isFalling, isFallen } from "./fall-bus";
import { getSharedClouds } from "./suspended-cloud";
import { WaterRipples } from "./water-ripples";
import {
  SOUND_ASSETS,
  playSample,
  preloadSample,
  unlockAudio,
} from "@/lib/sound";

/** Generated gallery accents used for project-card hover/select. */
const CARD_SELECT_URL = SOUND_ASSETS.cardSelect;
const HOVER_TICK_URL = SOUND_ASSETS.galleryHover;
import { SHOWCASE_LAYOUT } from "./showcase-targets";
import {
  expandCard,
  getMode,
  onModeChange,
  pushCardImpulse,
  setHoveredCard,
  setMode as setShowcaseMode,
  type ShowcaseMode,
} from "./showcase-bus";

export function SculptureScene() {
  const palette = useSculpturePalette();
  useEffect(() => {
    preloadSample(CARD_SELECT_URL);
    preloadSample(HOVER_TICK_URL);
  }, []);
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{
        // Mount at the overture pose so the reveal animation has a smooth
        // starting frame. RevealCamera lerps from here to the sweet-spot.
        position: [
          TUNING.overtureOffset.x,
          TUNING.overtureOffset.y,
          TUNING.cameraZ + TUNING.overtureOffset.z,
        ],
        fov: TUNING.fov,
        near: 0.1,
        far: 40,
      }}
      gl={{ antialias: true, alpha: false }}
    >
      <Suspense fallback={null}>
        {/* "warehouse" gives shards contrasty darker bays to reflect, so
            metal reads as metal against white. "studio" is pure soft white
            which makes chrome look like paper. */}
        <Environment preset="warehouse" background={false} environmentIntensity={TUNING.envMapIntensity} />

        <AnimatedSceneColors palette={palette} />
        {/* Faint ambient so back-facing shards never crush to black. */}
        <ambientLight intensity={0.10} />

        <ResponsiveCamera />
        <RevealCamera />
        <RippleScheduler />
        <FallScheduler />
        <SuspendedCloud />
        <ProjectsButton />
        <CardHitboxes />
        <AboutUsMetalButton />
        <AboutPanelCopy />

        {/* Manual mirror. When palette.floorReflective is false we
            don't use drei's MeshReflectorMaterial (which can't produce
            a clean reflection on a near-black base). Instead a flipped
            copy of the sculpture sits below the floor; ReflectiveFloor
            renders a semi-transparent dark plane on top. The camera
            sees the mirror through the tinted pane — a real reflection
            at a known cost (one extra SuspendedCloud's worth of work).
            Kept mounted in BOTH modes (hidden under the opaque
            MeshReflectorMaterial floor in light mode) so toggling dark
            doesn't remount the cloud and replay the showcase-morph
            animation mid-project-view. */}
        <MirrorBelow floorY={TUNING.floorY}>
          <SuspendedCloud interactive={false} />
        </MirrorBelow>

        <ReflectiveFloor palette={palette} />
      </Suspense>
    </Canvas>
  );
}

function AboutPanelCopy() {
  const [mode, setMode] = useState<ShowcaseMode>(() => getMode());
  const opacityRef = useRef(0);
  const material = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#f6f3ea",
        metalness: 1,
        roughness: 0.18,
        transparent: true,
        opacity: 0,
        emissive: new THREE.Color("#d8d2c4"),
        emissiveIntensity: 0.18,
        envMapIntensity: TUNING.envMapIntensity * 1.25,
      }),
    [],
  );
  const shadowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#15171b",
        transparent: true,
        opacity: 0,
      }),
    [],
  );

  useEffect(() => onModeChange((m) => setMode(m)), []);
  useFrame(() => {
    const target = mode === "about" ? 1 : 0;
    opacityRef.current += (target - opacityRef.current) * 0.045;
    material.opacity = opacityRef.current;
    shadowMaterial.opacity = opacityRef.current * 0.32;
  });

  return (
    <group position={[0, 0.44, 1.05]} rotation={[-0.025, 0, 0]}>
      <MetalTextLine
        material={shadowMaterial}
        position={[0.035, 1.745, -0.035]}
        size={0.36}
        text="FABRIQUE"
      />
      <MetalTextLine
        material={material}
        position={[0, 1.78, 0]}
        size={0.36}
        text="FABRIQUE"
      />
      <MetalTextLine
        material={material}
        position={[0, 1.37, 0.02]}
        size={0.105}
        text="TWO PILOTS  /  ONE WORKSHOP  /  SITES THAT MOVE"
      />
      <MetalTextLine
        material={material}
        position={[0, 0.98, 0.04]}
        size={0.078}
        text="EDOUARD BUILDS THE FRONTEND"
      />
      <MetalTextLine
        material={material}
        position={[0, 0.78, 0.045]}
        size={0.078}
        text="ASA BUILDS THE BACKEND"
      />
      <MetalTextLine
        material={material}
        position={[0, 0.55, 0.05]}
        size={0.071}
        text="PHYSICS-DRIVEN INTERFACES + INTERACTIVE 3D"
      />
      <MetalTextLine
        material={material}
        position={[0, 0.34, 0.055]}
        size={0.069}
        text="THIS SHIP IS FABRIQUE"
      />
      <MetalTextLine
        material={material}
        position={[-1.86, -1.3, 0.1]}
        size={0.105}
        text="EDOUARD"
      />
      <MetalTextLine
        material={material}
        position={[1.86, -1.3, 0.1]}
        size={0.105}
        text="ASA"
      />
    </group>
  );
}

function MetalTextLine({
  material,
  position,
  size,
  text,
}: {
  material: THREE.Material;
  position: [number, number, number];
  size: number;
  text: string;
}) {
  return (
    <Center position={position}>
      <Text3D
        bevelEnabled
        bevelSegments={1}
        bevelSize={size * 0.018}
        bevelThickness={size * 0.012}
        curveSegments={3}
        font="/fonts/helvetiker_bold.typeface.json"
        height={size * 0.065}
        letterSpacing={0.02}
        material={material}
        size={size}
      >
        {text}
      </Text3D>
    </Center>
  );
}

/**
 * Wraps children in a scale=[1,-1,1] group positioned below the floor
 * so they render as a geometric mirror of the upright content. Raycast
 * is disabled on the group so duplicate hit-planes / buttons inside
 * the mirror don't fire double click events.
 */
function MirrorBelow({
  floorY,
  children,
}: {
  floorY: number;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  // Three.js's Raycaster descends into children regardless of the
  // parent group's `raycast`. To fully disable pointer events on the
  // mirrored subtree (so hover/click never fire twice), traverse after
  // mount and no-op every descendant's raycast method.
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.traverse((obj) => {
      (obj as THREE.Object3D).raycast = () => {};
    });
  });
  return (
    <group
      ref={groupRef}
      position={[0, 2 * floorY, 0]}
      scale={[1, -1, 1]}
    >
      {children}
    </group>
  );
}

/**
 * Invisible planes that capture pointer events for the 5 showcase
 * cards (or the one merged box in expanded mode). Publishes hover +
 * click events through the showcase bus. Mounted only while the
 * showcase is active; Shards reads the bus to paint the glow / morph.
 */
function CardHitboxes() {
  const [mode, setMode] = useState<ShowcaseMode>(() => getMode());

  useEffect(() => {
    setMode(getMode());
    return onModeChange((m) => {
      setMode(m);
      // Planes unmount on mode transitions. `onPointerOut` won't fire
      // on the plane that disappears, so clear hover state centrally
      // to avoid a stuck highlighted card / stuck pointer cursor.
      setHoveredCard(null);
      if (typeof document !== "undefined") document.body.style.cursor = "";
      resetCursorHover();
    });
  }, []);

  useEffect(() => {
    if (mode !== "about") return;
    const goBack = () => {
      unlockAudio();
      playSample(SOUND_ASSETS.cardSelect, 0.18, 0, 0.24, {
        reverbSend: 0.04,
      });
      setShowcaseMode("showcase");
    };
    window.addEventListener("pointerdown", goBack);
    return () => window.removeEventListener("pointerdown", goBack);
  }, [mode]);

  if (mode === "off") return null;

  if (mode === "about") {
    return null;
  }

  // Expanded mode: a single big hit-plane covering the merged box.
  // It keeps hover/cursor behavior on the project surface, but clicks
  // should not close the project. The arrow button is the explicit back
  // control for expanded → showcase.
  if (mode === "expanded") {
    const w = TUNING.expandedBoxW;
    const h = TUNING.expandedBoxH;
    return (
      <mesh
        position={[0, SHOWCASE_LAYOUT.centerY, SHOWCASE_LAYOUT.centerZ]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setCursorHover(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setCursorHover(false);
        }}
        onClick={(e) => e.stopPropagation()}
        visible={false}
      >
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    );
  }

  // Showcase mode: one plane per card.
  const { cardW, cardH, xCenters, centerY, centerZ } = SHOWCASE_LAYOUT;
  return (
    <>
      {xCenters.map((cx, i) => (
        <CardHitPlane
          key={i}
          idx={i}
          position={[cx, centerY, centerZ]}
          width={cardW}
          height={cardH}
        />
      ))}
    </>
  );
}

function CardHitPlane({
  idx,
  position,
  width,
  height,
}: {
  idx: number;
  position: [number, number, number];
  width: number;
  height: number;
}) {
  const lastPointRef = useRef<THREE.Vector3 | null>(null);
  const lastMoveAtRef = useRef(0);

  const updateImpulsePoint = (e: ThreeEvent<PointerEvent>) => {
    const last = lastPointRef.current;
    const now = performance.now();
    if (last) {
      const dx = e.point.x - last.x;
      const dy = e.point.y - last.y;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(1, now - lastMoveAtRef.current);
      if (dist > 0.002) {
        pushCardImpulse({
          cardIdx: idx,
          dx,
          dy,
          speed: dist / dt,
        });
      }
      last.copy(e.point);
    } else {
      lastPointRef.current = e.point.clone();
    }
    lastMoveAtRef.current = now;
  };

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    lastPointRef.current = e.point.clone();
    lastMoveAtRef.current = performance.now();
    setHoveredCard(idx);
    document.body.style.cursor = "pointer";
    setCursorHover(true);
    playSample(HOVER_TICK_URL, 0.12, 0, undefined, { reverbSend: 0.03 });
    // Warm the select-hit cache on first hover so the click sound fires
    // instantly with no fetch/decode delay.
    preloadSample(CARD_SELECT_URL);
  };
  const onOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoveredCard(null);
    document.body.style.cursor = "";
    setCursorHover(false);
    lastPointRef.current = null;
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    unlockAudio();
    playSample(CARD_SELECT_URL, 0.36, 0, 0.38, { reverbSend: 0.04 });
    expandCard(idx);
  };
  return (
    <mesh
      position={position}
      onPointerOver={onOver}
      onPointerMove={(e) => {
        e.stopPropagation();
        updateImpulsePoint(e);
      }}
      onPointerOut={onOut}
      onClick={onClick}
      visible={false}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/**
 * Lerps the scene background and 3 directional-light colors toward the
 * current palette targets. Replaces the instant prop-swap path so the
 * light↔dark toggle animates instead of snapping.
 */
function AnimatedSceneColors({ palette }: { palette: SculpturePalette }) {
  const { scene } = useThree();
  const keyRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const rimRef = useRef<THREE.DirectionalLight>(null);

  const targetBg = useMemo(
    () => new THREE.Color(palette.background),
    [palette.background],
  );
  const targetKey = useMemo(
    () => new THREE.Color(palette.keyLight),
    [palette.keyLight],
  );
  const targetFill = useMemo(
    () => new THREE.Color(palette.fillLight),
    [palette.fillLight],
  );
  const targetRim = useMemo(
    () => new THREE.Color(palette.rimLight),
    [palette.rimLight],
  );

  // Ensure scene.background is a stable THREE.Color instance we can lerp.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!(scene.background instanceof THREE.Color)) {
      scene.background = targetBg.clone();
    }
  }, []);

  useFrame(() => {
    const lerp = TUNING.paletteLerp;
    if (scene.background instanceof THREE.Color) {
      scene.background.lerp(targetBg, lerp);
    }
    if (keyRef.current) keyRef.current.color.lerp(targetKey, lerp);
    if (fillRef.current) fillRef.current.color.lerp(targetFill, lerp);
    if (rimRef.current) rimRef.current.color.lerp(targetRim, lerp);
  });

  return (
    <>
      {/* Strong directional KEY ("the sun"). Pushed to the upper-right
          and brightened so it clearly reads as light coming from a
          specific direction. Shadow casting disabled — the projected
          shadow on the water was distracting. The sense of direction
          comes purely from how the shards catch the light. */}
      <directionalLight
        ref={keyRef}
        position={[10, 9, 4]}
        intensity={3.6}
      />
      {/* Cool fill from the opposite side — dimmer now so the
          shadow side reads darker and the directionality is obvious. */}
      <directionalLight ref={fillRef} position={[-5, 2, 3]} intensity={0.22} />
      {/* Back rim — keeps the silhouette from going totally flat. */}
      <directionalLight ref={rimRef} position={[0, 2, -6]} intensity={0.45} />
    </>
  );
}

/**
 * Keeps the full FABRIQUE silhouette visible regardless of window aspect.
 *
 * Why FOV and not camera z: the shards are placed on viewing rays from a
 * fixed camera pose. Moving the camera changes which rays converge on
 * which pixels, breaking the illusion. FOV only changes how much of the
 * view frustum is captured — the rays themselves stay put.
 *
 * We solve for the vertical FOV that makes both the horizontal and
 * vertical bounds of the cloud fit, with a small margin. On wide windows
 * this means a small FOV (cloud looks smaller in a big frame); on tall
 * phone windows this means a wider FOV (we zoom out to fit both rows).
 */
function ResponsiveCamera() {
  const { camera, size } = useThree();
  const [mode, setMode] = useState<ShowcaseMode>(() => getMode());

  useEffect(() => onModeChange((m) => setMode(m)), []);

  useFrame(() => {
    const cam = camera as PerspectiveCameraImpl;
    const viewportAspect = size.width / Math.max(size.height, 1);
    const camZ = TUNING.cameraZ;
    const aboutActive = mode === "about";
    const halfW = aboutActive ? 4.25 : TUNING.wordHalfWidth + TUNING.fitMargin;
    const canvasAspect = TUNING.sampleWidth / TUNING.sampleHeight;
    const halfH = aboutActive
      ? 4.25
      : TUNING.wordHalfWidth / canvasAspect + TUNING.fitMargin;

    // vfov needed so horizontal extent fits:
    //   halfW = camZ * tan(halfHFov) = camZ * tan(halfVFov) * viewportAspect
    //   => halfVFov = atan(halfW / (camZ * viewportAspect))
    const halfVFovByW = Math.atan(halfW / (camZ * viewportAspect));
    // vfov needed so vertical extent fits:
    const halfVFovByH = Math.atan(halfH / camZ);
    const halfVFov = Math.max(halfVFovByW, halfVFovByH);
    const targetFov = (halfVFov * 2 * 180) / Math.PI;

    cam.fov += (targetFov - cam.fov) * (aboutActive ? 0.04 : 0.2);
    cam.updateProjectionMatrix();
  });
  return null;
}

/**
 * Reveal-animation handshake. Set true by RevealCamera while the
 * overture-to-sweet-spot pan is running; nothing else moves the camera
 * once the camera-drag (OrbitControl) was retired.
 */
const _orbit = {
  revealInProgress: false,
};

/**
 * Camera pan from an overture pose to the sweet-spot. While the pan runs,
 * shards appear as a scattered cloud; at t=1 the camera sits exactly at
 * (0, 0, cameraZ), the rays converge, and FABRIQUE resolves — the reveal.
 *
 * Runs once on mount and again on every `triggerReveal()` from the UI.
 * ResponsiveCamera keeps managing FOV concurrently; position and FOV are
 * orthogonal so they don't fight.
 */
function RevealCamera() {
  const { camera } = useThree();
  const startRef = useRef<number | null>(null);
  const endPos = useRef(new THREE.Vector3(0, 0, TUNING.cameraZ));
  const startPos = useRef(
    new THREE.Vector3(
      TUNING.overtureOffset.x,
      TUNING.overtureOffset.y,
      TUNING.cameraZ + TUNING.overtureOffset.z,
    ),
  );

  useEffect(() => {
    startRef.current = performance.now();
    _orbit.revealInProgress = true;
    return onReveal(() => {
      startRef.current = performance.now();
      _orbit.revealInProgress = true;
    });
  }, []);

  useFrame(() => {
    const started = startRef.current;
    if (started == null) return; // OrbitControl owns the camera when idle.

    const cam = camera as PerspectiveCameraImpl;
    const elapsed = performance.now() - started;
    const t = Math.min(1, elapsed / TUNING.revealDurationMs);
    const eased = 1 - Math.pow(1 - t, 3);

    cam.position.lerpVectors(startPos.current, endPos.current, eased);
    cam.lookAt(0, 0, 0);

    if (t >= 1) {
      startRef.current = null;
      _orbit.revealInProgress = false;
    }
  });

  return null;
}

/**
 * Drop ripples are now sourced exclusively from falling shards (see
 * FallScheduler). This component just prunes expired drops each frame
 * so the bus stays clean.
 */
function RippleScheduler() {
  useFrame(({ clock }) => {
    pruneDrops(clock.elapsedTime);
  });
  return null;
}

/**
 * Periodically picks a random shard from the FABRIQUE sculpture and
 * makes it fall into the water. The shard's free-fall trajectory is
 * computed in shards.tsx; when it hits the floor plane a drop ripple
 * is spawned at the impact point and the shard is hidden.
 *
 * Shards are picked from the upper portion of the sculpture so the
 * fall reads as "a piece detaching from the sign" rather than
 * "something materialized at the water level." The fall takes
 * ~1.0–1.5s under gentle gravity (g = 5.0 in shards.tsx), enough for
 * the eye to track.
 */
function FallScheduler() {
  const nextAtRef = useRef(0.8); // first fall shortly after mount
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (t < nextAtRef.current) return;

    const clouds = getSharedClouds();
    if (!clouds) return;
    const home = clouds.physics.home;
    const total = home.length / 3;
    if (total === 0) return;

    // Pick from the FRONT of the sculpture — the shards closest to
    // the camera (largest world Z). Camera sits at z = 9 looking at
    // origin, so high-Z shards are the front-facing ones the user
    // sees most prominently. Sample ~50 random candidates and keep
    // the one with the highest Z that isn't already falling/fallen.
    let best = -1;
    let bestZ = -Infinity;
    let bestY = 0;
    for (let attempt = 0; attempt < 50; attempt++) {
      const idx = Math.floor(Math.random() * total);
      if (isFallen(idx) || isFalling(idx)) continue;
      const z = home[idx * 3 + 2];
      if (z > bestZ) {
        bestZ = z;
        bestY = home[idx * 3 + 1];
        best = idx;
      }
    }
    if (best < 0) return;

    startFall({
      shardIndex: best,
      startT: t,
      startY: bestY,
    });

    // Next fall in ~0.5s — a piece detaches roughly twice per second,
    // so the surface is constantly being disturbed by drops.
    nextAtRef.current = t + 0.5;
  });
  return null;
}

/**
 * Floor as a literal mirror.
 *
 * The actual mirror is the flipped <SuspendedCloud /> mounted by
 * SculptureScene below the floor plane (`<MirrorBelow />`). The
 * floor plane sits over the mirror as a tinted pane.
 *
 * Pixel sampling proved the visible "horizon line" was caused by the
 * transparent floor plane alpha-blending with the WIDE LATERAL
 * EXTENT of the mirror copy — even at canvas X far from the central
 * letters, the inverted PLAQUE shards bleed through, tinting the
 * bottom half a few units off bg. The cleaner fix lives downstream:
 * the mirror copy's <Shards /> render uses an alpha fade that goes
 * to zero AT the floor plane (mirror tops invisible) and ramps to
 * full visibility deeper. So the boundary at the camera horizon has
 * no abrupt geometric edge — mirror tops dissolve into bg.
 *
 * Floor color matches bg in every palette so what little the floor
 * plane covers (alpha < 1 over no-mirror water) blends invisibly.
 */
function ReflectiveFloor({ palette }: { palette: SculpturePalette }) {
  const matRef = useRef<THREE.Material & { color: THREE.Color }>(null);
  const targetColor = useMemo(
    () => new THREE.Color(palette.floor),
    [palette.floor],
  );
  const initialColor = palette.floor;
  useFrame(() => {
    if (matRef.current) matRef.current.color.lerp(targetColor, TUNING.paletteLerp);
  });
  const matKey = `mirror-${palette.floor}-${palette.floorOpacity.toFixed(3)}`;
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, TUNING.floorY, 0]}
      >
        <planeGeometry args={[2000, 2000]} />
        <meshBasicMaterial
          key={matKey}
          ref={(m) => {
            matRef.current =
              (m as THREE.Material & { color: THREE.Color }) ?? null;
          }}
          color={initialColor}
          transparent
          opacity={palette.floorOpacity}
          depthWrite={false}
          // CRITICAL: scene.background bypasses tonemapping but
          // material colors don't. With toneMapped=true (default) the
          // floor's bg-hex color renders 5–20 units off the actual
          // bg pixel value — verified by setting floor=#ff0000 and
          // measuring (250,16,20) instead of pure red. This is what
          // produced the visible seam at the camera horizon (the
          // line between bg pixels above and floor-plane-tinted
          // pixels below). toneMapped=false makes the floor's hex
          // color match the bg's hex color one-to-one.
          toneMapped={false}
        />
      </mesh>
      {/* Animated water-surface ripples — large transparent plane
          rendered ABOVE the floor that adds visible directional
          wind ripples and concentric drop ripples across the entire
          water surface. The shader output is a near-bg-color tint
          with subtle alpha modulation, so it's invisible where the
          ripple is at rest and reads as a soft tone shift where
          waves crest. */}
      <WaterRipples palette={palette} />
    </>
  );
}
