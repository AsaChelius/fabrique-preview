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

import { useEffect } from "react";
import { SculptureScene } from "./sculpture-scene";
import { triggerReveal } from "./reveal-bus";

export function SculptureRoute() {
  useEffect(() => {
    document.body.classList.add("sculpture-mode");
    return () => {
      document.body.classList.remove("sculpture-mode");
    };
  }, []);

  return (
    <main>
      <div className="sculpture-root">
        <SculptureScene />
      </div>
      <button
        type="button"
        onClick={() => triggerReveal()}
        aria-label="Replay reveal animation"
        style={{
          position: "fixed",
          bottom: "2rem",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          background: "transparent",
          border: "1px solid #6b6e76",
          color: "#2c2e33",
          padding: "0.55rem 1.4rem",
          fontSize: "0.72rem",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Replay
      </button>
    </main>
  );
}
