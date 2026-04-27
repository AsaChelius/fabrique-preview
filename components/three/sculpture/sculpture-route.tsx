"use client";

/**
 * Route wrapper for the anamorphic sculpture title page.
 *
 * Responsibilities:
 *   - Toggle `body.sculpture-mode` so globals.css hides the dark-theme
 *     chrome (site backdrop, brand text, route nav) for this route only.
 *   - Mount the R3F canvas inside a full-viewport container.
 *   - Provide a small "Replay" button that re-kicks the reveal animation.
 *   - Provide a 3-button background-mode picker: Light / Grey / Dark.
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

type ModeChoice = "light" | "sunset" | "dark";

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

const segmentBaseStyle = {
  background: "transparent",
  border: "1px solid #6b6e76",
  color: "#2c2e33",
  padding: "0.45rem 0.95rem",
  fontSize: "0.66rem",
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  cursor: "pointer",
  fontFamily: "inherit",
} as const;

const segmentActiveStyle = {
  ...segmentBaseStyle,
  background: "#1d1f24",
  color: "#f4f1e7",
  border: "1px solid #1d1f24",
};

export function SculptureRoute() {
  const [mode, setMode] = useState<ModeChoice>("light");

  useEffect(() => {
    document.body.classList.add("sculpture-mode");
    const detachAmbient = attachSculptureAmbient();
    return () => {
      document.body.classList.remove("sculpture-mode");
      document.body.classList.remove("sculpture-dark");
      document.body.classList.remove("sculpture-sunset");
      setShowcase(false);
      detachAmbient();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sculpture-dark", mode === "dark");
    document.body.classList.toggle("sculpture-sunset", mode === "sunset");
  }, [mode]);

  useEffect(() => {
    const forceDark = () => {
      unlockAudio();
      playSample(LIGHT_SWITCH_URL, 0.38, 0, undefined, {
        reverbSend: 0.06,
      });
      setMode("dark");
    };
    const forceLight = () => {
      unlockAudio();
      playSample(LIGHT_SWITCH_URL, 0.32, 0, undefined, {
        reverbSend: 0.05,
      });
      setMode("light");
    };
    window.addEventListener("sculpture-force-dark", forceDark);
    window.addEventListener("sculpture-force-light", forceLight);
    return () => {
      window.removeEventListener("sculpture-force-dark", forceDark);
      window.removeEventListener("sculpture-force-light", forceLight);
    };
  }, []);

  const choose = (next: ModeChoice) => {
    if (next === mode) return;
    unlockAudio();
    playSample(LIGHT_SWITCH_URL, 0.5, 0, undefined, {
      reverbSend: 0.07,
    });
    setMode(next);
  };

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
        style={{
          ...pillStyle,
          bottom: "2rem",
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        Replay
      </button>
      {/* "Old" button — links to /old, the original FABRIQUE physics-
          letter hero we replaced with this anamorphic sculpture. Lets
          visitors compare the two versions of the title page. */}
      <a
        href="/old"
        aria-label="View the original FABRIQUE hero"
        style={{
          ...pillStyle,
          bottom: "2rem",
          left: "2rem",
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        Old
      </a>
      {/* Background-mode picker — three explicit buttons in a row. The
          active mode reads as a filled pill, inactive ones as outline. */}
      <div
        style={{
          position: "fixed",
          zIndex: 20,
          top: "2rem",
          right: "2rem",
          display: "flex",
          gap: "0.4rem",
        }}
      >
        <button
          type="button"
          onClick={() => choose("light")}
          aria-label="Light background"
          aria-pressed={mode === "light"}
          style={mode === "light" ? segmentActiveStyle : segmentBaseStyle}
        >
          White
        </button>
        <button
          type="button"
          onClick={() => choose("sunset")}
          aria-label="Sunset background"
          aria-pressed={mode === "sunset"}
          style={mode === "sunset" ? segmentActiveStyle : segmentBaseStyle}
        >
          Sunset
        </button>
        <button
          type="button"
          onClick={() => choose("dark")}
          aria-label="Dark background"
          aria-pressed={mode === "dark"}
          style={mode === "dark" ? segmentActiveStyle : segmentBaseStyle}
        >
          Dark
        </button>
      </div>
      <RouteTransition />
      <SculptureCursor />
      <WindchimeMotion />
    </main>
  );
}
