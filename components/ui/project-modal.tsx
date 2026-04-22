"use client";

import { useEffect } from "react";
import type { Project } from "@/lib/projects";

/**
 * Project modal — HTML overlay shown when a coal is "cracked open".
 *
 * Fades in over the 3D scene. Closes on: [Esc], backdrop click, X button.
 * The scene separately reads `activeId` to play the crack-open animation,
 * so we don't need to coordinate timing here.
 */
export function ProjectModal({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const glow = project.glowColor ?? "#ffa040";

  return (
    <div
      className="project-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-modal-title"
      onClick={onClose}
    >
      <div
        className="project-modal-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ borderColor: `${glow}55`, boxShadow: `0 0 60px ${glow}22` }}
      >
        <button
          type="button"
          className="project-modal-close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
        <p className="project-modal-tag" style={{ color: glow }}>
          {project.tagline}
        </p>
        <h2 id="project-modal-title" className="project-modal-title">
          {project.title}
        </h2>
        <p className="project-modal-desc">{project.description}</p>
        <div className="project-modal-tech">
          {project.tech.map((t) => (
            <span key={t} className="project-modal-chip">
              {t}
            </span>
          ))}
        </div>
        {project.link && (
          <a
            href={project.link}
            target="_blank"
            rel="noreferrer"
            className="project-modal-link"
          >
            Visit →
          </a>
        )}
      </div>
    </div>
  );
}
