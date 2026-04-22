"use client";

/**
 * Client wrapper for /coal.
 *
 * Owns the `active` (currently-cracked-open project) state so it can drive
 * both the 3D scene (for the crack-open animation) and the modal overlay.
 * The server page stays thin — just metadata + this component.
 */

import { useState } from "react";
import { CoalScene } from "@/components/three/coal-scene";
import { ProjectModal } from "@/components/ui/project-modal";
import { ContactCTA } from "@/components/ui/contact-cta";
import { PROJECTS, type Project } from "@/lib/projects";

export function CoalRoute() {
  const [active, setActive] = useState<Project | null>(null);

  return (
    <main>
      <div className="scene-root">
        <CoalScene
          projects={PROJECTS}
          activeId={active?.id ?? null}
          onSelect={setActive}
        />
      </div>
      <div className="scene-overlay">
        <div className="hero-copy">
          <p className="eyebrow">FABRIQUE · Work</p>
          <h1>The void.</h1>
          <p>
            Each planet is a project — click one to open it. Debris floats
            around in zero-G; grab and throw anything.
          </p>
          <ContactCTA />
        </div>
      </div>
      {active && (
        <ProjectModal project={active} onClose={() => setActive(null)} />
      )}
    </main>
  );
}
