"use client";

/**
 * Showcase mode — module-level state + subscribe.
 *
 * Toggled by the NOS PROJETS button. When active, the letter shards
 * rearrange into five card-shaped outlines and an HTML overlay fades
 * in with project details. Subscribers (SuspendedCloud for physics,
 * SculptureRoute for the overlay) react to the boolean.
 *
 * Bus pattern (rather than React context) keeps the Canvas tree free of
 * provider wrappers and lets the ProjectsButton — which lives deep in
 * the R3F tree — flip the flag with a single function call.
 */

type Listener = (active: boolean) => void;

let _active = false;
const _listeners = new Set<Listener>();

export function isShowcaseActive(): boolean {
  return _active;
}

export function setShowcase(active: boolean): void {
  if (_active === active) return;
  _active = active;
  _listeners.forEach((l) => l(active));
}

export function toggleShowcase(): void {
  setShowcase(!_active);
}

export function onShowcaseChange(cb: Listener): () => void {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __toggleShowcase?: () => void }).__toggleShowcase =
    toggleShowcase;
}
