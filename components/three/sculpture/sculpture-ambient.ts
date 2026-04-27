"use client";

/**
 * Shared ambient bed for the sculpture routes (/title + /projects).
 *
 * Plays /sounds/ambiencesound.mp3 on loop while either sculpture route is
 * mounted. Uses a refcount + short stop-delay so navigating between /title
 * and /projects doesn't fade out + back in — the loop carries through.
 *
 * Also pauses the synth-based site ambient (`startAmbient` from lib/sound)
 * while sculpture ambient is active so the two beds don't fight.
 */

import {
  SOUND_ASSETS,
  playSampleLoop,
  suspendAmbient,
  resumeAmbient,
  unlockAudio,
  type SampleHandle,
} from "@/lib/sound";

const AMBIENT_URL = "/sounds/ambiencesoundnew.mp3";
const ALARM_URL = "/sounds/alarmtest.mp3";
const GALLERY_IDLE_URL = SOUND_ASSETS.galleryIdle;

// Bed level (the new ambiencesoundnew.mp3) — sits underneath everything.
const AMBIENT_VOLUME = 0.14;
// Alarm layered on top.
const ALARM_VOLUME = 0.075;
// Sparse metal creaks/ticks behind the bed. Kept low so it reads as room
// tone, not another foreground interaction layer.
const GALLERY_IDLE_VOLUME = 0.06;

// Tiny grace window: if a sculpture route unmounts and another mounts
// within this many ms (i.e. /title → /projects), we don't actually stop
// the loop — we just hand off.
const HANDOFF_GRACE_MS = 350;

let active: SampleHandle | null = null;
let alarm: SampleHandle | null = null;
let galleryIdle: SampleHandle | null = null;
let refcount = 0;
let pendingStopId: number | null = null;

/**
 * Try to start the ambient loop now. If the audio context is still
 * suspended (no user gesture yet on this page load), wire up one-shot
 * listeners for any plausible gesture so the loop kicks in the instant
 * the user does anything — moves the mouse onto a button, scrolls,
 * presses a key, taps the screen. They never have to deliberately
 * "click to enable audio."
 */
function startWithAutoUnlock() {
  unlockAudio();
  active = playSampleLoop(AMBIENT_URL, AMBIENT_VOLUME, true);
  alarm = playSampleLoop(ALARM_URL, ALARM_VOLUME);
  galleryIdle = playSampleLoop(GALLERY_IDLE_URL, GALLERY_IDLE_VOLUME);

  // If audio is still suspended (autoplay-blocked), arm one-shot
  // listeners that resume the context the moment the user does
  // anything that browsers actually count as a "user gesture."
  //
  // CRITICAL: only events that browsers treat as real gestures unlock
  // an AudioContext — `click`, `pointerdown`, `keydown`, `touchstart`.
  // Including non-gesture events here (e.g. `pointermove`, `scroll`,
  // `wheel`) is a footgun: the first one fires, runs `cleanup()` which
  // removes ALL listeners, but the audio context stays suspended — so
  // a subsequent real click has nothing armed to unlock it. Result:
  // the user has to click, hear nothing, then click again. Don't.
  if (typeof window === "undefined") return;
  let armed = true;
  const handler = () => {
    if (!armed) return;
    armed = false;
    unlockAudio();
    cleanup();
  };
  const events: (keyof WindowEventMap)[] = [
    "pointerdown",
    "keydown",
    "touchstart",
  ];
  const cleanup = () => {
    for (const ev of events) {
      window.removeEventListener(ev, handler);
    }
  };
  for (const ev of events) {
    window.addEventListener(ev, handler, { passive: true, once: true });
  }
}

export function attachSculptureAmbient(): () => void {
  refcount++;

  if (pendingStopId != null) {
    clearTimeout(pendingStopId);
    pendingStopId = null;
  }

  if (!active && !alarm && !galleryIdle) {
    // Hard-suspend the synth ambient. This both stops it if currently
    // running AND blocks future startAmbient() calls (e.g. RouteNav's
    // delayed kick on first user interaction) so the hum can't sneak
    // back in while we're on a sculpture route.
    suspendAmbient();
    startWithAutoUnlock();
  }

  return () => {
    refcount = Math.max(0, refcount - 1);
    if (refcount > 0) return;

    // Defer stop slightly so a route handoff doesn't trigger fade-out.
    pendingStopId = window.setTimeout(() => {
      pendingStopId = null;
      if (refcount > 0) return;
      active?.stop(700);
      active = null;
      alarm?.stop(700);
      alarm = null;
      galleryIdle?.stop(900);
      galleryIdle = null;
      // Lift the suspend so other routes CAN call startAmbient if they
      // want to, but don't auto-restart it ourselves — the synth's
      // pentatonic chime timer was bleeding through as elevator-music
      // dings.
      resumeAmbient();
    }, HANDOFF_GRACE_MS);
  };
}
