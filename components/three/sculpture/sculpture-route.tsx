"use client";

/**
 * Route wrapper for the anamorphic sculpture title page.
 *
 * Responsibilities:
 *   - Toggle `body.sculpture-mode` so globals.css hides the dark-theme
 *     chrome (site backdrop, brand text, route nav) for this route only.
 *   - Mount the R3F canvas inside a full-viewport white container.
 *   - Provide a small "Replay" button that re-kicks the reveal animation.
 */

import { useEffect, useState } from "react";
import { SculptureScene } from "./sculpture-scene";
import { SculptureCursor } from "./sculpture-cursor";
import { triggerReveal } from "./reveal-bus";
import { RouteTransition } from "./route-transition";
import { setShowcase } from "./showcase-bus";

const pillStyle = {
  position: "fixed" as const,
  zIndex: 20,
  background: "transparent",
  border: "1px solid #6b6e76",
  color: "#2c2e33",
  padding: "0.55rem 1.4rem",
  fontSize: "0.72rem",
  letterSpacing: "0.22em",
  textTransform: "uppercase" as const,
  cursor: "pointer",
  fontFamily: "inherit",
};

export function SculptureRoute() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    document.body.classList.add("sculpture-mode");
    return () => {
      document.body.classList.remove("sculpture-mode");
      document.body.classList.remove("sculpture-dark");
      setShowcase(false);
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sculpture-dark", dark);
  }, [dark]);

  return (
    <main>
      <div className="sculpture-root">
        <SculptureScene />
      </div>
      <button
        type="button"
        onClick={() => triggerReveal()}
        aria-label="Replay reveal animation"
        style={{ ...pillStyle, bottom: "2rem", left: "50%", transform: "translateX(-50%)" }}
      >
        Replay
      </button>
      <button
        type="button"
        onClick={() => setDark((d) => !d)}
        aria-label="Toggle dark mode"
        style={{ ...pillStyle, top: "2rem", right: "2rem" }}
      >
        {dark ? "Light" : "Dark"}
      </button>
      <RouteTransition />
      <SculptureCursor />
    </main>
  );
}
