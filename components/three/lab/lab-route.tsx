"use client";

/**
 * Client wrapper for /lab — the physics+fluid title-page prototype.
 * Thin: just mounts the scene inside the canonical .scene-root container.
 * No overlay copy per spec ("no UI chrome on the title page").
 */

import { LabScene } from "@/components/three/lab/lab-scene";

export function LabRoute() {
  return (
    <main>
      <div className="scene-root">
        <LabScene />
      </div>
      <div className="scene-overlay">
        <div
          style={{
            position: "absolute",
            right: "2vw",
            bottom: "6vh",
            zIndex: 20,
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.68rem",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--fg-dim)",
            opacity: 0.7,
            display: "flex",
            flexDirection: "column",
            gap: "0.3rem",
            textAlign: "right",
            pointerEvents: "none",
          }}
        >
          <span>/lab · prototype</span>
          <span>drag · flick · wait</span>
        </div>
      </div>
    </main>
  );
}
