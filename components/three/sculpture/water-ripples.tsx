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
import { getDrops, wind as rippleWind } from "./ripple-bus";

const MAX_DROPS = 6;

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
uniform vec3 u_crestColor;
uniform vec3 u_troughColor;
uniform float u_baseAlpha;
uniform float u_crestAlpha;

uniform vec2 u_windDir1;
uniform float u_windK1;
uniform float u_windOmega1;
uniform float u_windAmp1;
uniform vec2 u_windDir2;
uniform float u_windK2;
uniform float u_windOmega2;
uniform float u_windAmp2;

// Drop uniforms: arrays of size MAX_DROPS. Each slot has:
//   x: cx, y: cy, z: startT, w: lifeS
// And a parallel array for amp/speed/wavelength.
uniform vec4 u_drops[6];
uniform vec3 u_dropProps[6]; // amp, speed, wavelength
uniform int u_dropCount;

void main() {
  vec2 world = vWorld.xz; // floor plane lies on XZ; world.x and world.z map to the visible XY of the water.

  // Wind crossed sine waves are intentionally OFF — their bright crest
  // streaks read as glimmers / sun-glints across the water and the
  // user wanted those gone entirely. Only DROP ripples (point splashes)
  // remain visible. Keep the uniforms wired so we can re-enable later
  // without restructuring the shader.
  float wave = 0.0;

  // Drop ripples — concentric circles.
  for (int i = 0; i < 6; i++) {
    if (i >= u_dropCount) break;
    vec4 drop = u_drops[i];
    vec3 props = u_dropProps[i];
    float age = u_time - drop.z;
    if (age < 0.0 || age > drop.w) continue;
    float dist = distance(world, drop.xy);
    float ringR = age * props.y;
    float radialDelta = dist - ringR;
    float ringWidth = props.z * 1.5;
    if (abs(radialDelta) > ringWidth * 1.8) continue;
    float radialEnv = exp(-radialDelta * radialDelta / (ringWidth * ringWidth));
    float timeEnv = 1.0 - age / drop.w;
    wave += sin(radialDelta * 6.2831 / props.z) * props.x * radialEnv * timeEnv;
  }

  // Drops are normalized against a fixed reference amp (the typical
  // peak drop amplitude) instead of the wind amp — wind no longer
  // contributes to wave, so dividing by it would NaN.
  float crest = clamp(wave / 0.18, 0.0, 1.0);
  // Only the concentric drop ripples brighten now. With wind zeroed
  // there are no streak glimmers left across the water — just point
  // splashes that pulse outward and fade.
  vec3 col = mix(u_bgColor, u_crestColor, crest * 0.5);
  float alpha = u_baseAlpha + crest * u_crestAlpha;
  gl_FragColor = vec4(col, alpha);
}
`;

export function WaterRipples({ palette }: { palette: SculpturePalette }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  // Build initial uniforms once.
  const uniforms = useMemo(() => {
    return {
      u_time: { value: 0 },
      u_bgColor: { value: new THREE.Color(palette.background) },
      u_crestColor: { value: new THREE.Color("#ffffff") },
      u_troughColor: { value: new THREE.Color("#000000") },
      u_baseAlpha: { value: 0.0 },
      /** Higher so crests are clearly visible without being garish. */
      u_crestAlpha: { value: 0.42 },
      u_windDir1: {
        value: new THREE.Vector2(rippleWind.dirX, rippleWind.dirY).normalize(),
      },
      u_windK1: { value: rippleWind.k },
      u_windOmega1: { value: rippleWind.omega },
      u_windAmp1: { value: rippleWind.amp },
      u_windDir2: {
        value: new THREE.Vector2(rippleWind.dir2X, rippleWind.dir2Y).normalize(),
      },
      u_windK2: { value: rippleWind.k2 },
      u_windOmega2: { value: rippleWind.omega2 },
      u_windAmp2: { value: rippleWind.amp2 },
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

  // Track palette → bg/crest/trough color targets that lerp each frame.
  const targetBg = useMemo(
    () => new THREE.Color(palette.background),
    [palette.background],
  );

  useFrame(({ clock }) => {
    uniforms.u_time.value = clock.elapsedTime;
    // Lerp bg color toward palette so mode toggles animate.
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

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, TUNING.floorY + 0.01, 0]}
    >
      <planeGeometry args={[2000, 2000]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}
