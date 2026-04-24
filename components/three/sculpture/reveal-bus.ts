/**
 * Tiny event bus so UI buttons outside the <Canvas /> tree can trigger the
 * camera reveal animation that lives inside R3F. One file, no framework,
 * no Context dance.
 */

type Listener = () => void;

const listeners: Set<Listener> = new Set();

/** Call to kick off (or restart) the reveal animation. */
export function triggerReveal(): void {
  for (const fn of listeners) fn();
}

/** Subscribe to reveal requests. Returns an unsubscribe function. */
export function onReveal(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
