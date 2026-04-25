"use client";

/**
 * Windchime motion layer — plays generated shard chimes in soft
 * overlapping bursts as the cursor sweeps through the metal shards.
 *
 * Gating:
 *   - A flag `overShards` is flipped on/off by the Shards mesh's R3F
 *     pointerOver/Out events (dispatched as `sculpt-shard-hover` window
 *     events). The chime only fires while this flag is true.
 *   - Velocity must exceed VELOCITY_THRESHOLD — slow drifts inside the
 *     shards stay near-silent.
 *   - Cooldown enforces no stacking; new triggers fade the prior instance.
 *
 * Mounted at the route level (not inside <Canvas>) so it's pure DOM event
 * handling.
 */

import { useEffect } from "react";
import {
  SOUND_ASSETS,
  playSample,
  preloadSample,
  type SampleHandle,
} from "@/lib/sound";

/**
 * Pool of generated chime samples. Random selection per hit.
 */
const CHIME_CLIPS = SOUND_ASSETS.shardChimes;

// Min ms between chime triggers. Clips are ~1s max, so a short cooldown
// keeps the shimmer responsive without stacking — the layer-ducking
// fader handles overlap when triggers do collide.
const COOLDOWN_MS = 60;

// Min pointer speed (px/ms) to fire. Dropped to 0.05 so even slow drifts
// through the shards register immediately — the previous 0.18 caused
// 5–10s lulls when the user wasn't sweeping aggressively.
const VELOCITY_THRESHOLD = 0.05;

// Pointer speed at which we hit max volume.
const VELOCITY_FOR_MAX_VOL = 3.0;

const MAX_VOLUME = 0.34;

export function WindchimeMotion() {
  useEffect(() => {
    // Warm the chime samples so the first random pick is instant.
    for (const url of CHIME_CLIPS) preloadSample(url);

    let lastX = -1;
    let lastY = -1;
    let lastT = 0;
    let lastFireT = 0;
    // Flag flipped by Shards mesh hover events. Listener runs always;
    // we just early-return when not over shards.
    let overShards = false;
    // Index of the last clip played, to avoid back-to-back repeats.
    let lastClipIdx = -1;
    // Most recent N chimes — newest plays at full volume, each older one
    // is ducked progressively. Cap raised + duck factor relaxed so the
    // shimmer stacks into a richer layered wash instead of flattening
    // out after 2-3 hits.
    const MAX_LAYERS = 8;
    // Multiplier applied to each older layer when a new chime fires.
    // 0.78 → previous 78%, two-ago 61%, three-ago 47%, etc.
    const DUCK_FACTOR = 0.78;
    const layers: SampleHandle[] = [];

    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      const x = e.clientX;
      const y = e.clientY;

      // Always update last-position so velocity is fresh when we DO enter.
      const hadPrev = lastX >= 0;
      const dt = Math.max(1, now - lastT);
      const dx = hadPrev ? x - lastX : 0;
      const dy = hadPrev ? y - lastY : 0;
      const speed = hadPrev ? Math.sqrt(dx * dx + dy * dy) / dt : 0;
      lastX = x;
      lastY = y;
      lastT = now;

      if (!overShards) return;
      if (!hadPrev) return;
      if (speed < VELOCITY_THRESHOLD) return;
      if (now - lastFireT < COOLDOWN_MS) return;

      const t = Math.min(1, speed / VELOCITY_FOR_MAX_VOL);
      const vol = MAX_VOLUME * t;
      // Duck each previously-active chime by DUCK_FACTOR^(distance+1) so
      // the layered tail thins out — newest plays normal, older fade
      // progressively. Then push the new chime onto the stack at full
      // requested volume.
      let factor = DUCK_FACTOR;
      for (let i = layers.length - 1; i >= 0; i--) {
        layers[i].setVolume(vol * factor, 220);
        factor *= DUCK_FACTOR;
      }
      // Random clip per hit so the chime varies pitch/timbre. Pick from
      // the (n-1) clips that aren't the last-played to avoid repeats.
      let idx = Math.floor(Math.random() * (CHIME_CLIPS.length - 1));
      if (idx >= lastClipIdx) idx++;
      lastClipIdx = idx;
      // reverbSend = 0.48 sends a healthy parallel signal to the shared
      // convolver bus → ~3.6s reverb tail per hit. Stacks across rapid
      // strikes into a continuous shimmer wash.
      const fresh = playSample(CHIME_CLIPS[idx], vol, 0, undefined, {
        reverbSend: 0.48,
      });
      layers.push(fresh);
      // Drop the oldest if we've exceeded the cap so the array doesn't
      // grow unbounded; let it tail out naturally rather than stop().
      if (layers.length > MAX_LAYERS) layers.shift();
      lastFireT = now;
    };

    const onShardEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ over: boolean }>).detail;
      overShards = !!detail?.over;
      // No longer cut the active chime when leaving the shards — its
      // natural decay tail is part of the sound. Stopping it caused the
      // "0.1s and then silence" bug when crossing between shards / empty
      // pixels rapidly.
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("sculpt-shard-hover", onShardEvent);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("sculpt-shard-hover", onShardEvent);
      // Fade-stop any still-ringing layers so leaving the route doesn't
      // leave chimes hanging.
      for (const l of layers) l.stop(220);
      layers.length = 0;
    };
  }, []);

  return null;
}
