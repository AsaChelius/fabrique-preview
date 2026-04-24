"use client";

/**
 * Water-shell material with ripple propagation.
 *
 * Each letter owns one of these. On a collision, we call `triggerRipple`
 * with the contact point in the letter's LOCAL frame. A radial wavefront
 * ripples out from that point across the shell surface, displacing vertices
 * along their normals. Because the shell uses transmission/refraction, a
 * moving bump automatically produces the wave-refraction the spec calls for
 * (light bends differently through the distorted surface each frame).
 *
 * Implementation: MeshPhysicalMaterial extended via `onBeforeCompile`.
 * We keep up to MAX_RIPPLES concurrent ripples per material — as a ring
 * buffer, so a new ripple overwrites the oldest slot.
 *
 * Wave model:
 *   r       = distance(vertex, rippleOrigin)
 *   elapsed = uTime - rippleStartTime
 *   front   = waveSpeed * elapsed              (expanding wavefront radius)
 *   env     = exp(-decay * elapsed)            (overall dissipation)
 *           * exp(-5 * (r - front)^2 / width^2) (traveling gaussian band)
 *   disp    = amp * env * sin(k * (r - front))
 * Applied as displacement along the vertex normal.
 *
 * Sources:
 *   - three.js onBeforeCompile pattern (discourse.threejs.org forum)
 *   - Traveling wave model (standard physics ripple equation)
 */

import * as THREE from "three";

const MAX_RIPPLES = 4;

export type ShellRippleHandle = {
  material: THREE.MeshPhysicalMaterial;
  /** Fire a new ripple at a point in the material's local coordinate space.
   *  Typical source: collision contact point transformed into letter-local
   *  space via body.inverseTransform(worldContact). */
  triggerRipple: (localPoint: THREE.Vector3, amplitudeMul?: number) => void;
  /** Advance time (called by useFrame). */
  tick: (elapsedSec: number) => void;
};

export function makeShellMaterial(): ShellRippleHandle {
  // Base appearance — unchanged from what the letters had before.
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#dcebf6"),
    metalness: 0,
    roughness: 0.04,
    transmission: 1,
    thickness: 0.15,
    ior: 1.33,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    attenuationColor: new THREE.Color("#5a7aa0"),
    attenuationDistance: 6,
    reflectivity: 0.4,
    specularIntensity: 0.6,
    side: THREE.DoubleSide,
  });

  // Uniforms wired into the compiled shader.
  const uTime = { value: 0 };
  // Pack origins (vec3) + startTimes (float) into fixed-size uniform arrays.
  const uRippleOrigins = {
    value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector3(0, 0, 0)),
  };
  const uRippleStart = { value: new Float32Array(MAX_RIPPLES) };
  const uRippleAmp = { value: new Float32Array(MAX_RIPPLES) };

  // Wave constants — tuned by feel.
  const WAVE_SPEED = 2.4;   // world units / sec that the wavefront expands
  const WAVE_DECAY = 2.0;   // 1/sec — ripple quiets down this fast
  const WAVE_K = 9.0;       // angular wavenumber (crest spacing)
  const WAVE_BAND = 0.45;   // gaussian band width around the wavefront
  const WAVE_AMP = 0.055;   // default ripple amplitude (world units)

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uRippleOrigins = uRippleOrigins;
    shader.uniforms.uRippleStart = uRippleStart;
    shader.uniforms.uRippleAmp = uRippleAmp;

    // Extra uniform declarations + the ripple displacement helper.
    const headerInject = /* glsl */ `
      uniform float uTime;
      uniform vec3  uRippleOrigins[${MAX_RIPPLES}];
      uniform float uRippleStart[${MAX_RIPPLES}];
      uniform float uRippleAmp[${MAX_RIPPLES}];
      // Compute summed ripple displacement at a local-space point.
      float labRippleDisp(vec3 localPos) {
        float total = 0.0;
        for (int i = 0; i < ${MAX_RIPPLES}; i++) {
          float amp = uRippleAmp[i];
          if (amp <= 0.0) continue;
          float elapsed = uTime - uRippleStart[i];
          if (elapsed < 0.0) continue;
          float r = distance(localPos, uRippleOrigins[i]);
          float front = ${WAVE_SPEED.toFixed(3)} * elapsed;
          float decay = exp(-${WAVE_DECAY.toFixed(3)} * elapsed);
          float band = exp(-5.0 * (r - front) * (r - front) / (${WAVE_BAND.toFixed(3)} * ${WAVE_BAND.toFixed(3)}));
          total += amp * decay * band * sin(${WAVE_K.toFixed(3)} * (r - front));
        }
        return total;
      }
    `;

    // Declare uniforms + helper before main(): prepend to the vertex shader.
    shader.vertexShader = shader.vertexShader.replace(
      "void main() {",
      headerInject + "\nvoid main() {",
    );

    // Displace vertex along object-space normal by the ripple function.
    // `transformed` is the to-be-transformed local-space position; `objectNormal`
    // is the local-space normal. Both are Three.js built-in vertex-shader vars.
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      /* glsl */ `
        #include <begin_vertex>
        float _labDisp = labRippleDisp(transformed);
        transformed += normalize(objectNormal) * _labDisp;
      `,
    );
  };

  // ---------------- Ripple ring buffer ----------------------------------
  let head = 0; // next slot to overwrite

  const triggerRipple = (localPoint: THREE.Vector3, amplitudeMul = 1) => {
    const slot = head;
    head = (head + 1) % MAX_RIPPLES;
    uRippleOrigins.value[slot].copy(localPoint);
    uRippleStart.value[slot] = uTime.value;
    uRippleAmp.value[slot] = WAVE_AMP * amplitudeMul;
  };

  const tick = (elapsedSec: number) => {
    uTime.value = elapsedSec;
    // Auto-cull ripples whose energy has decayed below a threshold — prevents
    // ancient ripples from sitting in the uniform array forever.
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const start = uRippleStart.value[i];
      if (uRippleAmp.value[i] <= 0) continue;
      const elapsed = elapsedSec - start;
      // After ~3s, the decay envelope is exp(-6) ≈ 0.0025, effectively silent.
      if (elapsed > 3) {
        uRippleAmp.value[i] = 0;
      }
    }
  };

  return { material, triggerRipple, tick };
}
