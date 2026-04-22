"use client";

/**
 * Vortex-fade overlay — distinct from the ship's warp overlay. Used when
 * clicking Work from Studio: the hero camera flies into the black hole,
 * this overlay fades the screen to pure black in sync, holds black while
 * the route swaps, then fades out revealing /coal underneath (which does
 * its own smooth spawn-in via template.tsx).
 *
 * Fires on the `vortex-zoom` CustomEvent dispatched by RouteNav.
 */

import { useEffect, useState } from "react";

export function VortexFadeOverlay() {
  const [active, setActive] = useState(false);
  const [cycleId, setCycleId] = useState(0);

  useEffect(() => {
    const onZoom = () => {
      setCycleId((n) => n + 1);
      setActive(true);
      // Total animation length — matches the CSS keyframes.
      window.setTimeout(() => setActive(false), 2400);
    };
    window.addEventListener("vortex-zoom", onZoom as EventListener);
    return () =>
      window.removeEventListener("vortex-zoom", onZoom as EventListener);
  }, []);

  if (!active) return null;
  return (
    <div
      key={cycleId}
      className="vortex-fade-overlay"
      aria-hidden
    />
  );
}
