"use client";

/**
 * Tiny pub-sub for the custom cursor's hover state.
 *
 * R3F meshes can't be targeted by CSS :hover (everything lives inside a
 * single <canvas>), so 3D elements push their hover state through this
 * bus. <SculptureCursor /> subscribes and flips the ring into filled mode.
 *
 * A counter — not a boolean — so multiple meshes can claim hover
 * simultaneously (e.g. pointer glides from one card onto another and the
 * out-event fires after the new over-event).
 */

let count = 0;
const listeners = new Set<(hover: boolean) => void>();

function emit() {
  const hover = count > 0;
  for (const l of listeners) l(hover);
}

export function setCursorHover(hover: boolean): void {
  count = Math.max(0, count + (hover ? 1 : -1));
  emit();
}

/** Called on unmount paths where we're not sure the pair balanced out. */
export function resetCursorHover(): void {
  count = 0;
  emit();
}

export function onCursorHoverChange(cb: (hover: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
