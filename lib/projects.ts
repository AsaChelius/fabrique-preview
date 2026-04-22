/**
 * FABRIQUE project data.
 *
 * Each entry becomes a glowing coal in the coal scene; click to open the
 * modal. Replace the placeholder rows with real work as it ships.
 */

export type Project = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  tech: string[];
  year?: string;
  link?: string;
  /** Optional accent color for the coal's inner glow. Hex string. */
  glowColor?: string;
};

export const PROJECTS: Project[] = [
  {
    id: "fabrique",
    title: "FABRIQUE",
    tagline: "You're on it.",
    description:
      "The studio site — R3F + Rapier physics hero, discrete 3D routes, synth audio, and a coal yard of clickable project embers.",
    tech: ["Next.js 16", "React Three Fiber", "Rapier", "TypeScript", "Tailwind v4"],
    year: "2026",
    glowColor: "#ffb454",
  },
  {
    id: "proj-2",
    title: "Project Two",
    tagline: "A short tagline for this one.",
    description:
      "Placeholder. Swap in the real work here once it's shipped — what it is, what it does, who it's for.",
    tech: ["TBD"],
    glowColor: "#ff7a3a",
  },
  {
    id: "proj-3",
    title: "Project Three",
    tagline: "Another one — short tagline.",
    description:
      "Placeholder. Swap in the real work here once it's shipped.",
    tech: ["TBD"],
    glowColor: "#ffd060",
  },
  {
    id: "proj-4",
    title: "Project Four",
    tagline: "Placeholder tagline.",
    description:
      "Placeholder. Swap in the real work here once it's shipped.",
    tech: ["TBD"],
    glowColor: "#ff5a24",
  },
  {
    id: "proj-5",
    title: "Project Five",
    tagline: "Placeholder tagline.",
    description:
      "Placeholder. Swap in the real work here once it's shipped.",
    tech: ["TBD"],
    glowColor: "#ffa040",
  },
];
