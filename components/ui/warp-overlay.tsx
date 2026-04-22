"use client";

/**
 * Fullscreen hyperspace-warp overlay. Listens for a `warp` CustomEvent on
 * the window; when dispatched, plays a ~1.4s warp animation (dark fade +
 * radial streak burst + flash) that covers the page while a route change
 * happens underneath. Mounted once in RootLayout so it persists across
 * route transitions.
 *
 * Usage:
 *   window.dispatchEvent(new CustomEvent("warp"));
 *   setTimeout(() => router.push("/somewhere"), 550);
 */

import { useEffect, useState } from "react";

export function WarpOverlay() {
  const [active, setActive] = useState(false);
  const [cycleId, setCycleId] = useState(0);

  useEffect(() => {
    const onWarp = () => {
      setCycleId((n) => n + 1);
      setActive(true);
      window.setTimeout(() => setActive(false), 1400);
    };
    window.addEventListener("warp", onWarp as EventListener);
    return () => window.removeEventListener("warp", onWarp as EventListener);
  }, []);

  if (!active) return null;

  // Precompute 32 streak lines at varied angles + delays.
  const streaks = Array.from({ length: 36 }, (_, i) => ({
    angle: (i / 36) * 360 + (i % 2 === 0 ? 0 : 5),
    delay: (i * 7) % 200, // ms
    hue: 200 + ((i * 13) % 60),
  }));

  return (
    <div className="warp-overlay" data-cycle={cycleId}>
      {/* Central flash */}
      <div className="warp-flash" />
      {/* Streaks */}
      <div className="warp-streaks">
        {streaks.map((s, i) => (
          <span
            key={i}
            className="warp-streak"
            style={{
              transform: `rotate(${s.angle}deg)`,
              animationDelay: `${s.delay}ms`,
              background: `linear-gradient(90deg, transparent, hsl(${s.hue} 100% 85% / 0.95), transparent)`,
            }}
          />
        ))}
      </div>
      {/* Dark radial vignette that iris-closes then iris-opens. */}
      <div className="warp-vignette" />
    </div>
  );
}
