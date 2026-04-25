"use client";

/**
 * Shared route-fade for the title ↔ projects transition.
 *
 * Usage:
 *   1. Mount <RouteTransition /> inside each route component. On mount
 *      it fades a full-viewport overlay from opacity 1 → 0, so the
 *      scene "dissolves in" from the bg color.
 *   2. Call `navigateWithFade(url)` from a click handler. The active
 *      <RouteTransition /> fades the overlay back to 1, then (after
 *      the same duration) calls router.push(url). The next route's
 *      own <RouteTransition /> picks up at opacity 1 and fades out —
 *      a continuous cross-fade without the flicker of a hard route
 *      change.
 *
 * The fade color matches TUNING.backgroundColor so the overlay is
 * indistinguishable from "scene not yet loaded" while transitioning.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TUNING } from "./tuning";
import { SOUND_ASSETS, playSample } from "@/lib/sound";

type Listener = (url: string) => void;
const listeners = new Set<Listener>();

/** Trigger a fade-out + navigate from any client component. */
export function navigateWithFade(url: string): void {
  for (const fn of listeners) fn(url);
}

const DURATION_MS = 650;

export function RouteTransition() {
  const router = useRouter();
  const [opacity, setOpacity] = useState(1);
  const navigatingRef = useRef(false);

  useEffect(() => {
    // Fade in (overlay 1 → 0) on mount — reveals the scene.
    const raf = requestAnimationFrame(() => setOpacity(0));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const fn: Listener = (url) => {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      playSample(SOUND_ASSETS.routeSwell, 0.32, 0, undefined, {
        reverbSend: 0.18,
      });
      setOpacity(1);
      window.setTimeout(() => {
        router.push(url);
      }, DURATION_MS);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [router]);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        pointerEvents: "none",
        background: TUNING.backgroundColor,
        opacity,
        transition: `opacity ${DURATION_MS}ms ease`,
      }}
    />
  );
}
