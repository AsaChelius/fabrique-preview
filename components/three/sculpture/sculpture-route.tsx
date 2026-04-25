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
import { WindchimeMotion } from "./windchime-motion";
import { triggerReveal } from "./reveal-bus";
import { RouteTransition } from "./route-transition";
import { setShowcase } from "./showcase-bus";
import { attachSculptureAmbient } from "./sculpture-ambient";
import { SOUND_ASSETS, playSample, unlockAudio } from "@/lib/sound";

const LIGHT_SWITCH_URL = SOUND_ASSETS.lightToggle;

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
    const detachAmbient = attachSculptureAmbient();
    return () => {
      document.body.classList.remove("sculpture-mode");
      document.body.classList.remove("sculpture-dark");
      setShowcase(false);
      detachAmbient();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sculpture-dark", dark);
  }, [dark]);

  useEffect(() => {
    const forceDark = () => {
      unlockAudio();
      playSample(LIGHT_SWITCH_URL, 0.38, 0, undefined, {
        reverbSend: 0.06,
      });
      setDark(true);
    };
    window.addEventListener("sculpture-force-dark", forceDark);
    return () => window.removeEventListener("sculpture-force-dark", forceDark);
  }, []);

  return (
    <main>
      <div className="sculpture-root">
        <SculptureScene />
      </div>
      <button
        type="button"
        onClick={() => {
          unlockAudio();
          playSample(SOUND_ASSETS.routeSwell, 0.28, 0, undefined, {
            reverbSend: 0.18,
          });
          triggerReveal();
        }}
        aria-label="Replay reveal animation"
        style={{ ...pillStyle, bottom: "2rem", left: "50%", transform: "translateX(-50%)" }}
      >
        Replay
      </button>
      <button
        type="button"
        onClick={() => {
          unlockAudio();
          // Relay-style click for the gallery lighting change.
          playSample(LIGHT_SWITCH_URL, 0.56, 0, undefined, {
            reverbSend: 0.08,
          });
          setDark((d) => !d);
        }}
        aria-label="Toggle dark mode"
        style={{ ...pillStyle, top: "2rem", right: "2rem" }}
      >
        {dark ? "Light" : "Dark"}
      </button>
      <RouteTransition />
      <SculptureCursor />
      <WindchimeMotion />
    </main>
  );
}
