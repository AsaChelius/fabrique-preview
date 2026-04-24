"use client";

/**
 * Custom DOM cursor for the sculpture routes.
 *
 * - Small outline ring follows the pointer via transform (GPU, no layout).
 * - When the pointer is over a button / anchor / the R3F canvas, the ring
 *   grows and fills (see `.is-hover` in globals.css).
 * - Hides itself until the first mousemove so the ring doesn't flash at
 *   (0,0) on mount.
 * - Auto-hides if the window loses focus or the cursor leaves the viewport.
 *
 * Mounted by SculptureRoute + ProjectsRoute so it only lives on the
 * anamorphic pages.
 */

import { useEffect, useRef } from "react";
import { onCursorHoverChange } from "./cursor-bus";

/** DOM elements that should trigger hover. Canvas is excluded —
 *  3D meshes inside the canvas push hover state through cursor-bus
 *  instead, so only specific shards (not the whole viewport) light up. */
const INTERACTIVE_SELECTOR = "button, a, [role='button']";

export function SculptureCursor() {
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;

    let rafId = 0;
    let targetX = -100;
    let targetY = -100;
    let x = -100;
    let y = -100;
    let visible = false;
    // DOM-driven hover (button/anchor under the pointer) and 3D-driven
    // hover (set from R3F meshes via cursor-bus) are tracked separately
    // so one doesn't clear the other. Ring is filled if either is true.
    let domHover = false;
    let sceneHover = false;
    const applyHoverClass = () => {
      ring.classList.toggle("is-hover", domHover || sceneHover);
    };

    const onMove = (e: PointerEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!visible) {
        visible = true;
        ring.classList.add("is-visible");
        // Snap on first move so the ring doesn't ease in from 0,0.
        x = targetX;
        y = targetY;
      }

      // DOM hover — only counts non-canvas interactives; canvas meshes
      // talk to us through cursor-bus.
      const el = e.target as Element | null;
      domHover = !!el?.closest?.(INTERACTIVE_SELECTOR);
      applyHoverClass();
    };

    const unsubBus = onCursorHoverChange((hover) => {
      sceneHover = hover;
      applyHoverClass();
    });

    const onLeave = () => {
      visible = false;
      ring.classList.remove("is-visible");
      ring.classList.remove("is-hover");
    };

    const tick = () => {
      // Ease toward the target — tiny lag gives the ring a soft trailing
      // feel without feeling laggy.
      x += (targetX - x) * 0.35;
      y += (targetY - y) * 0.35;
      ring.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
      rafId = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    rafId = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      unsubBus();
      cancelAnimationFrame(rafId);
    };
  }, []);

  return <div ref={ringRef} className="sculpture-cursor" aria-hidden />;
}
