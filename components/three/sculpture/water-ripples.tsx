"use client";

/**
 * <WaterRipples /> — animated visible ripple layer over the water plane.
 *
 * The previous approach piggy-backed displacement onto mirror-shard
 * positions, which only made waves visible WHERE the reflected
 * sculpture had geometry. The user wants ripples spread across the
 * ENTIRE water surface, so this is a dedicated shader plane.
 *
 * The shader output is mostly-transparent except where wave crests
 * are. Crests get a subtle brighter tint (catching the warm sun) and
 * troughs get a subtle darker tint (shadow). Output color tracks the
 * scene's bg so the layer is invisible at rest and only the moving
 * wave pattern reads.
 *
 * Two types of ripples are layered:
 *   1. Wind — two crossed traveling sine waves across the surface.
 *   2. Drops — concentric expanding rings sourced from `ripple-bus`.
 *      Each drop is a Gaussian-enveloped wave packet whose radius
 *      grows over its lifetime.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { TUNING } from "./tuning";
import type { SculpturePalette } from "./palette";
import { getDrops } from "./ripple-bus";

const MAX_DROPS = 10;

const VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vWorld;

uniform float u_time;
uniform vec3 u_bgColor;
uniform float u_baseAlpha;
uniform float u_crestAlpha;

uniform vec4 u_drops[10];
uniform vec3 u_dropProps[10]; // amp, speed, wavelength
uniform int u_dropCount;

/**
 * Concentric drop ripples — sin packets expanding from each impact
 * point. Empty-flat-water → wave = 0 → transparent → horizon invisible.
 */
void main() {
  vec2 world = vWorld.xz;

  float wave = 0.0;

  // ── Drop ripples ────────────────────────────────────────────────
  for (int i = 0; i < 10; i++) {
    if (i >= u_dropCount) break;
    vec4 drop = u_drops[i];
    vec3 props = u_dropProps[i];
    float age = u_time - drop.z;
    if (age < 0.0 || age > drop.w) continue;

    vec2 toPoint = world - drop.xy;
    float dist = length(toPoint);
    float ringR = age * props.y;
    float radialDelta = dist - ringR;
    float envWidth = props.z * 1.2;
    if (abs(radialDelta) > envWidth * 1.6) continue;

    float radialEnv = exp(-radialDelta * radialDelta / (envWidth * envWidth));
    float timeEnv = 1.0 - age / drop.w;
    float phase = radialDelta * 6.2831 / props.z;
    wave += sin(phase) * props.x * radialEnv * timeEnv;
  }

  // ── Shading ─────────────────────────────────────────────────────
  float ampRef = 0.18;
  float crest = clamp(wave / ampRef, 0.0, 1.0);
  float trough = clamp(-wave / ampRef, 0.0, 1.0);
  float waveMag = max(crest, trough);

  vec3 col = u_bgColor;
  col = mix(col, vec3(1.0), crest * 0.7);
  col = mix(col, u_bgColor * 0.6, trough * 0.5);

  float alpha = u_baseAlpha + waveMag * u_crestAlpha;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

export function WaterRipples({ palette }: { palette: SculpturePalette }) {
  // Build initial uniforms once.
  const uniforms = useMemo(() => {
    return {
      u_time: { value: 0 },
      u_bgColor: { value: new THREE.Color(palette.background) },
      u_baseAlpha: { value: 0.0 },
      u_crestAlpha: { value: 0.7 },
      u_drops: {
        value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4()),
      },
      u_dropProps: {
        value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector3()),
      },
      u_dropCount: { value: 0 },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track palette → bg color target that lerps each frame.
  const targetBg = useMemo(
    () => new THREE.Color(palette.background),
    [palette.background],
  );

  useFrame(({ clock }) => {
    uniforms.u_time.value = clock.elapsedTime;
    uniforms.u_bgColor.value.lerp(targetBg, TUNING.paletteLerp);

    // Push live drops into uniforms.
    const drops = getDrops();
    const n = Math.min(drops.length, MAX_DROPS);
    for (let i = 0; i < n; i++) {
      const d = drops[i];
      uniforms.u_drops.value[i].set(d.cx, d.cy, d.startT, d.lifeS);
      uniforms.u_dropProps.value[i].set(d.amp, d.speed, d.wavelength);
    }
    uniforms.u_dropCount.value = n;
  });

  // Construct the ShaderMaterial imperatively so Three.js builds its
  // internal uniformsList from this exact uniforms object. The previous
  // JSX `<shaderMaterial uniforms={x} />` route reassigned uniforms
  // after construction; the renderer kept uploading from a stale
  // uniformsList and our useFrame mutations never reached the GPU.
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    [uniforms],
  );

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, TUNING.floorY + 0.01, 0]}
    >
      <planeGeometry args={[2000, 2000]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
