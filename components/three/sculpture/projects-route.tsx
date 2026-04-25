"use client";

/**
 * /projects — the second perspective of the sculpture. Three hollow
 * circles made of the same suspended metal language as the FABRIQUE
 * title page. Placeholder silhouettes; will be swapped for per-project
 * marks later.
 *
 * Reuses `sculpture-mode` so the dark-theme chrome stays hidden.
 *
 * Ships the same bottom-center "Replay" button as /title — here it
 * routes back to /title. Because <RevealCamera /> fires its pan on mount,
 * arriving at /title from this route automatically plays the reveal.
 */

import { useEffect } from "react";
import { ProjectsScene } from "./projects-scene";
import { SculptureCursor } from "./sculpture-cursor";
import { RouteTransition, navigateWithFade } from "./route-transition";
import { attachSculptureAmbient } from "./sculpture-ambient";
import { unlockAudio } from "@/lib/sound";

export function ProjectsRoute() {
  useEffect(() => {
    document.body.classList.add("sculpture-mode");
    const detachAmbient = attachSculptureAmbient();
    return () => {
      document.body.classList.remove("sculpture-mode");
      detachAmbient();
    };
  }, []);

  return (
    <main>
      <div className="sculpture-root">
        <ProjectsScene />
      </div>
      <button
        type="button"
        onClick={() => {
          unlockAudio();
          navigateWithFade("/title");
        }}
        aria-label="Back to title with reveal animation"
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
      <RouteTransition />
      <SculptureCursor />
    </main>
  );
}
