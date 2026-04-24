"use client";

/**
 * FABRIQUE letters for the /lab prototype.
 *
 * 8 draggable letters, Rapier dynamic bodies in zero-G, soft-spring
 * pulled back toward their home positions. Each owns a MeshPhysicalMaterial
 * that cycles through 4 states (obsidian / glass / frosted / matte) on
 * hard impact.
 *
 * Drag: on pointerdown the body is switched to kinematicPositionBased,
 * tracked via a plane projection of the cursor at the body's Z; on
 * pointerup we switch back to dynamic and apply an impulse derived from
 * the cursor velocity over the last few frames.
 */

import { RigidBody, CuboidCollider, type RapierRigidBody } from "@react-three/rapier";
import { Text3D } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { playLetterThud } from "./lab-audio";
import { TUNING, LETTERS, homeXFor } from "./tuning";
import {
  applyCrossfade,
  applyPreset,
  MATERIAL_STATES,
  pickNextState,
  PRESETS,
  type MaterialState,
} from "./materials";
import type { EventQueue, LetterHandle } from "./shared";
import { makeShellMaterial, type ShellRippleHandle } from "./shell-material";

const FONT_URL = "/fonts/helvetiker_bold.typeface.json";
/** Rough per-letter pitch table so collisions are faintly musical.
 *  Index → cents offset for the "thud" synth voice pitch. */
const LETTER_PITCH_CENTS = [0, -200, 300, -500, 700, -300, 500, -100];

type LettersProps = {
  lettersRef: React.MutableRefObject<LetterHandle[]>;
  events: EventQueue;
};

export function Letters({ lettersRef, events }: LettersProps) {
  return (
    <group>
      {LETTERS.map((char, i) => (
        <LetterBody
          key={i}
          index={i}
          char={char}
          lettersRef={lettersRef}
          events={events}
        />
      ))}
    </group>
  );
}

// -----------------------------------------------------------------------------

type LetterBodyProps = {
  index: number;
  char: string;
  lettersRef: React.MutableRefObject<LetterHandle[]>;
  events: EventQueue;
};

function LetterBody({ index, char, lettersRef, events }: LetterBodyProps) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const visualRef = useRef<THREE.Group>(null);
  const { camera, gl } = useThree();

  // Home position — the letter's drift target.
  const home = useMemo(
    () => new THREE.Vector3(homeXFor(index), TUNING.homeY, 0),
    [index],
  );

  // Per-letter material state machine.
  // Initial state: spread the 4 states across the 8 letters.
  const initialState = MATERIAL_STATES[index % MATERIAL_STATES.length];
  const matStateRef = useRef<{
    from: MaterialState;
    to: MaterialState;
    /** time (s) when crossfade started, or null if not crossfading. */
    fadeStartSec: number | null;
    /** time (s) of last flip, for cooldown. */
    lastFlipSec: number;
  }>({ from: initialState, to: initialState, fadeStartSec: null, lastFlipSec: -999 });

  // Soft-impact sound debounce (per-letter).
  const lastSoftSoundRef = useRef(0);

  // Letter collider half-extents — approximate, tuned against Text3D output.
  const halfSize = useMemo(
    () =>
      new THREE.Vector3(
        TUNING.letterSize * 0.42,
        TUNING.letterSize * 0.58,
        TUNING.letterDepth * 0.5,
      ),
    [],
  );

  // Ref for the inner Text3D mesh so we can read its geometry once the
  // font resolves (to build the inflated water shell).
  const textMeshRef = useRef<THREE.Mesh>(null);
  const geometryReady = useRef(false);
  // The shell mesh — lives beside the letter, rigidly attached to the body.
  // Built on first frame after Text3D's geometry is populated. Stored as
  // React state so the mesh re-renders when it becomes available.
  const [shellGeometry, setShellGeometry] = useState<THREE.BufferGeometry | null>(null);
  // Shell material with ripple support — created once per letter.
  const shellHandle = useMemo<ShellRippleHandle>(() => makeShellMaterial(), []);

  // Drag state.
  const [grabbed, setGrabbed] = useState(false);
  const dragPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const dragOffset = useRef(new THREE.Vector3());
  const lastCursorWorld = useRef(new THREE.Vector3());
  const cursorVel = useRef(new THREE.Vector3());
  const lastCursorTime = useRef(0);
  const grabbedPointerId = useRef<number | null>(null);

  // Register this letter in the shared registry on mount.
  useEffect(() => {
    // Ensure the array slot exists.
    while (lettersRef.current.length <= index) lettersRef.current.push(null!);
    lettersRef.current[index] = {
      index,
      char,
      home,
      body: bodyRef.current,
      halfSize,
      grabbed: false,
      // Legacy sample fields — kept for API stability but no longer used
      // by <Fluid/>. Empty arrays are safe for any consumer iterating them.
      localSamples: [],
      worldSamples: [],
      mesh: textMeshRef.current,
    };
    // Apply initial material preset synchronously after first render.
    if (materialRef.current) {
      applyPreset(materialRef.current, initialState);
    }
    return () => {
      // Null out the slot (don't splice — indices matter).
      if (lettersRef.current[index]) lettersRef.current[index] = null!;
    };
  }, [index, char, home, halfSize, lettersRef, initialState]);

  useFrame((_, dtRaw) => {
    const entry = lettersRef.current[index];
    if (!entry) return;
    const body = bodyRef.current;
    const mesh = textMeshRef.current;
    const mat = materialRef.current;
    const ms = matStateRef.current;

    entry.body = body;
    entry.mesh = mesh;
    entry.grabbed = grabbed;

    const dt = Math.min(dtRaw, 1 / 30);

    // --- 1. Build the water shell once the Text3D geometry is available.
    // We clone the letter's mesh geometry, center it, compute vertex
    // normals, and displace every vertex along its normal by
    // TUNING.shellNormalOffset. The result is a slightly inflated copy
    // of the letter that traces its surface at constant distance — the
    // "thin water film." Rendered as a sibling mesh inside the same
    // RigidBody so it moves rigidly with the letter.
    if (!geometryReady.current && mesh?.geometry?.attributes.position) {
      const pos = mesh.geometry.attributes.position;
      if (pos.count > 0) {
        // Center the original geometry so both letter + shell align to (0,0,0)
        // in body-local space (we removed drei's <Center> wrapper).
        mesh.geometry.center();
        const shell = inflateGeometryAlongNormals(
          mesh.geometry,
          TUNING.shellNormalOffset,
        );
        setShellGeometry(shell);
        geometryReady.current = true;
      }
    }

    // --- 2. Physics springs (skip when kinematic-grabbed).
    if (body && !grabbed) {
      // 2a. Position spring to home + soft bounds.
      const p = body.translation();
      const v = body.linvel();
      const fx = -TUNING.homeSpringK * (p.x - home.x) - TUNING.homeDamping * v.x;
      const fy = -TUNING.homeSpringK * (p.y - home.y) - TUNING.homeDamping * v.y;
      const fz = -TUNING.homeSpringK * (p.z - home.z) - TUNING.homeDamping * v.z;
      const dist = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      let bx = 0, by = 0, bz = 0;
      if (dist > TUNING.boundsRadius) {
        const over = dist - TUNING.boundsRadius;
        const inv = 1 / Math.max(dist, 1e-4);
        bx = -p.x * inv * over * 6;
        by = -p.y * inv * over * 6;
        bz = -p.z * inv * over * 6;
      }
      const scale = 1 / 60;
      body.applyImpulse(
        { x: (fx + bx) * scale, y: (fy + by) * scale, z: (fz + bz) * scale },
        true,
      );

      // 2b. Rotation spring toward identity quaternion (letters right themselves).
      // For unit quaternion q, the small-angle error vector ≈ q.xyz when q.w >= 0.
      // If q.w < 0, flip the sign of q (double-cover) to take the shortest arc.
      const q = body.rotation();
      let qx = q.x, qy = q.y, qz = q.z;
      const qw = q.w;
      if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; }
      const av = body.angvel();
      body.applyTorqueImpulse(
        {
          x: (-TUNING.rotSpringK * qx - TUNING.rotDamping * av.x) * scale,
          y: (-TUNING.rotSpringK * qy - TUNING.rotDamping * av.y) * scale,
          z: (-TUNING.rotSpringK * qz - TUNING.rotDamping * av.z) * scale,
        },
        true,
      );
    }

    // --- 3. Material crossfade tick (runs always; drag shouldn't stall it).
    if (mat && ms.fadeStartSec !== null) {
      const nowSec = performance.now() / 1000;
      const t = Math.min(
        1,
        (nowSec - ms.fadeStartSec) / (TUNING.materialCrossfadeMs / 1000),
      );
      applyCrossfade(mat, ms.from, ms.to, t);
      if (t >= 1) {
        ms.from = ms.to;
        ms.fadeStartSec = null;
      }
    }

    // --- 4. Per-letter emissive "breath" so nothing ever feels frozen.
    if (mat) {
      const now = performance.now() / 1000;
      const phase = index * 0.81;
      let baseBright: number;
      if (ms.fadeStartSec !== null) {
        const fadeT = Math.min(
          1,
          (now - ms.fadeStartSec) / (TUNING.materialCrossfadeMs / 1000),
        );
        baseBright =
          PRESETS[ms.from].emissiveIntensity +
          (PRESETS[ms.to].emissiveIntensity - PRESETS[ms.from].emissiveIntensity) * fadeT;
      } else {
        baseBright = PRESETS[ms.to].emissiveIntensity;
      }
      mat.emissiveIntensity = baseBright + Math.sin(now * 0.9 + phase) * 0.08;
    }

    // --- 5. Advance the shell material's uTime so live ripples animate.
    shellHandle.tick(performance.now() / 1000);
    void dt;
  });

  // --- Drag handlers -----------------------------------------------------

  const projectCursor = (e: ThreeEvent<PointerEvent>, out: THREE.Vector3) => {
    // Plane at the body's current Z so dragging feels locked to the letter's depth.
    const body = bodyRef.current;
    const z = body ? body.translation().z : 0;
    dragPlane.constant = -z; // plane z = z
    const ndc = new THREE.Vector2(
      (e.clientX / gl.domElement.clientWidth) * 2 - 1,
      -(e.clientY / gl.domElement.clientHeight) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    raycaster.ray.intersectPlane(dragPlane, out);
  };

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const body = bodyRef.current;
    if (!body) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    grabbedPointerId.current = e.pointerId;

    const cursorWorld = new THREE.Vector3();
    projectCursor(e, cursorWorld);
    const p = body.translation();
    dragOffset.current.set(cursorWorld.x - p.x, cursorWorld.y - p.y, cursorWorld.z - p.z);
    lastCursorWorld.current.copy(cursorWorld);
    lastCursorTime.current = performance.now();
    cursorVel.current.set(0, 0, 0);

    body.setBodyType(2, true); // 2 = KinematicPositionBased in Rapier
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    setGrabbed(true);
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!grabbed || grabbedPointerId.current !== e.pointerId) return;
    const body = bodyRef.current;
    if (!body) return;
    const cursorWorld = new THREE.Vector3();
    projectCursor(e, cursorWorld);
    const target = {
      x: cursorWorld.x - dragOffset.current.x,
      y: cursorWorld.y - dragOffset.current.y,
      z: cursorWorld.z - dragOffset.current.z,
    };
    body.setNextKinematicTranslation(target);

    // Track cursor velocity for release impulse.
    const now = performance.now();
    const dt = Math.max(1e-3, (now - lastCursorTime.current) / 1000);
    cursorVel.current.set(
      (cursorWorld.x - lastCursorWorld.current.x) / dt,
      (cursorWorld.y - lastCursorWorld.current.y) / dt,
      (cursorWorld.z - lastCursorWorld.current.z) / dt,
    );
    lastCursorWorld.current.copy(cursorWorld);
    lastCursorTime.current = now;
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (grabbedPointerId.current !== e.pointerId) return;
    grabbedPointerId.current = null;
    const body = bodyRef.current;
    setGrabbed(false);
    if (!body) return;

    body.setBodyType(0, true); // 0 = Dynamic
    const m = TUNING.releaseImpulseMul;
    const cap = TUNING.maxReleaseImpulse;
    const ix = THREE.MathUtils.clamp(cursorVel.current.x * m, -cap, cap);
    const iy = THREE.MathUtils.clamp(cursorVel.current.y * m, -cap, cap);
    const iz = THREE.MathUtils.clamp(cursorVel.current.z * m, -cap, cap);
    body.applyImpulse({ x: ix, y: iy, z: iz }, true);

    // Drag-release always spawns a water droplet trail — user gesture
    // visibly "sheds" water. Strength is proportional to release velocity.
    const speed = Math.sqrt(ix * ix + iy * iy + iz * iz);
    if (speed > 0.3) {
      const p = body.translation();
      const dir = speed > 0 ? [ix / speed, iy / speed, iz / speed] : [0, 1, 0];
      events.push({
        kind: "drag-release",
        position: new THREE.Vector3(p.x, p.y, p.z),
        // Negate the release direction — droplet flies OPPOSITE to the throw
        // (it's what's "left behind" on the letter's previous position).
        normal: new THREE.Vector3(-dir[0], -dir[1], -dir[2]),
        force: speed,
        letterIndex: index,
      });
    }
  };

  // --- Contact → sound + material flip + ripple + droplet -------------
  // Rapier's ContactForcePayload carries `manifold` (world-space contact
  // points via solverContactPoint(i)) and `maxForceDirection`. We use these
  // for everything downstream instead of the letter centroid, so bubbles
  // spawn WHERE letters actually touched and ripples originate there.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onContactForce = (payload: any) => {
    const force: number = payload.totalForceMagnitude;
    const body = bodyRef.current;
    if (!body) return;
    const now = performance.now();

    // Contact point in world space — fall back to body center if manifold missing.
    const worldContact = new THREE.Vector3();
    try {
      const mf = payload.manifold;
      const c = mf?.solverContactPoint?.(0);
      if (c) {
        worldContact.set(c.x, c.y, c.z);
      } else {
        const p = body.translation();
        worldContact.set(p.x, p.y, p.z);
      }
    } catch {
      const p = body.translation();
      worldContact.set(p.x, p.y, p.z);
    }

    // Direction the bubble should travel — Rapier's maxForceDirection points
    // along the primary contact normal. We spawn the droplet slightly away
    // from the letter in that direction.
    const mf = payload.maxForceDirection;
    const contactNormal = new THREE.Vector3();
    if (mf) {
      contactNormal.set(mf.x, mf.y, mf.z).normalize();
      // If it happens to point inward, flip it so the droplet escapes outward.
      const p = body.translation();
      const outward = new THREE.Vector3(worldContact.x - p.x, worldContact.y - p.y, worldContact.z - p.z);
      if (outward.lengthSq() > 1e-6) {
        outward.normalize();
        if (contactNormal.dot(outward) < 0) contactNormal.multiplyScalar(-1);
      }
    } else {
      contactNormal.set(0, 1, 0);
    }

    if (force >= TUNING.softImpactForce && now - lastSoftSoundRef.current > TUNING.impactSoundCooldownMs) {
      lastSoftSoundRef.current = now;
      const vol = Math.min(0.7, 0.2 + force / 70);
      playLetterThud(index, vol);

      // Trigger a ripple on this letter's water shell — amplitude scales
      // with force. Convert world contact → local space of the body, which
      // since the shell mesh sits at body origin with body's rotation, is:
      //   local = bodyInverseTransform * worldContact
      const bp = body.translation();
      const br = body.rotation();
      const local = new THREE.Vector3(worldContact.x - bp.x, worldContact.y - bp.y, worldContact.z - bp.z);
      // Inverse rotate by body quaternion.
      const q = new THREE.Quaternion(br.x, br.y, br.z, br.w).invert();
      local.applyQuaternion(q);
      const ampMul = THREE.MathUtils.clamp(force / 30, 0.35, 1.6);
      shellHandle.triggerRipple(local, ampMul);
    }

    if (force >= TUNING.hardImpactForce) {
      const nowSec = now / 1000;
      const ms = matStateRef.current;
      if (nowSec - ms.lastFlipSec >= TUNING.materialCooldownMs / 1000) {
        ms.lastFlipSec = nowSec;
        ms.fadeStartSec = nowSec;
        ms.from = ms.to;
        ms.to = pickNextState(ms.from);
      }
      // Push a hard-impact event for the fluid system — use CONTACT POINT
      // and contact normal so droplets emerge from the collision surface.
      events.push({
        kind: "hard",
        position: worldContact.clone(),
        normal: contactNormal.clone(),
        force,
        letterIndex: index,
      });
    }
  };

  return (
    <RigidBody
      ref={bodyRef}
      position={[home.x, home.y, home.z]}
      colliders={false}
      linearDamping={1.6}
      angularDamping={TUNING.bodyAngularDamping}
      gravityScale={0}
      enabledRotations={[true, true, true]}
      onContactForce={onContactForce}
    >
      <CuboidCollider args={[halfSize.x, halfSize.y, halfSize.z]} restitution={0.35} friction={0.6} />
      <group
        ref={visualRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Letter itself. We skip drei's <Center> wrapper because we re-center
            the geometry manually once it loads (see useFrame step 1). This
            lets the water shell mesh below align perfectly to the same
            vertices without a wrapping group's transform shifting it. */}
        <Text3D
          ref={textMeshRef}
          font={FONT_URL}
          size={TUNING.letterSize}
          height={TUNING.letterDepth}
          curveSegments={8}
          bevelEnabled
          bevelThickness={0.025}
          bevelSize={0.02}
          bevelSegments={3}
        >
          {char}
          <meshPhysicalMaterial
            ref={materialRef}
            color="#888888"
            metalness={0.8}
            roughness={0.25}
          />
        </Text3D>

        {/* Water shell — cloned Text3D geometry displaced along vertex normals.
            This is the "thin film" clinging to the letter. Inflated shell sits
            just outside the letter surface everywhere, including inside the
            concave holes of A / B / Q / R (inner wall normals displace inward).
            Rendered with the refractive water material. */}
        {shellGeometry && (
          <mesh material={shellHandle.material}>
            <primitive object={shellGeometry} attach="geometry" />
          </mesh>
        )}
      </group>
    </RigidBody>
  );
}

// -----------------------------------------------------------------------------

/**
 * Clone a BufferGeometry and displace every vertex outward along its smooth
 * vertex normal by `offset`. Result traces the input's surface at a constant
 * offset distance — for a letter glyph, that's a thin water film hugging the
 * entire shape including concave holes.
 *
 * Important: we first merge shared vertices so a sharp-edged extruded glyph
 * has continuous per-vertex normals (otherwise each face offsets independently
 * and the shell splits open at edges). Three.js provides mergeVertices via
 * BufferGeometryUtils, but to avoid the extra import we deduplicate manually.
 */
function inflateGeometryAlongNormals(
  src: THREE.BufferGeometry,
  offset: number,
): THREE.BufferGeometry {
  const merged = mergeDuplicateVertices(src);
  merged.computeVertexNormals();
  const pos = merged.attributes.position;
  const nml = merged.attributes.normal;
  const n = pos.count;
  for (let i = 0; i < n; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + nml.getX(i) * offset,
      pos.getY(i) + nml.getY(i) * offset,
      pos.getZ(i) + nml.getZ(i) * offset,
    );
  }
  pos.needsUpdate = true;
  merged.computeVertexNormals();
  return merged;
}

/**
 * Deduplicate coincident vertices of a non-indexed BufferGeometry so that
 * computeVertexNormals() produces smooth shared normals. Returns a new
 * indexed BufferGeometry. We bucket by rounded position with tolerance.
 */
function mergeDuplicateVertices(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const position = src.attributes.position;
  if (!position) return src.clone();
  const tol = 1e-4;
  const map = new Map<string, number>();
  const keptX: number[] = [];
  const keptY: number[] = [];
  const keptZ: number[] = [];
  const indices: number[] = [];
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x / tol)}|${Math.round(y / tol)}|${Math.round(z / tol)}`;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const k = key(x, y, z);
    let idx = map.get(k);
    if (idx === undefined) {
      idx = keptX.length;
      map.set(k, idx);
      keptX.push(x);
      keptY.push(y);
      keptZ.push(z);
    }
    indices.push(idx);
  }
  const out = new THREE.BufferGeometry();
  const arr = new Float32Array(keptX.length * 3);
  for (let i = 0; i < keptX.length; i++) {
    arr[i * 3] = keptX[i];
    arr[i * 3 + 1] = keptY[i];
    arr[i * 3 + 2] = keptZ[i];
  }
  out.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  // Reuse index type sized appropriately.
  const IndexArray = keptX.length > 65535 ? Uint32Array : Uint16Array;
  out.setIndex(new THREE.BufferAttribute(new IndexArray(indices), 1));
  return out;
}
