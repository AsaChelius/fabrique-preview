/**
 * Cross-component shared state for the /lab prototype.
 *
 * Runtime data (letter positions, impact events, droplets) flows between
 * Letters → Fluid via mutable refs, not React state. We do NOT want
 * every frame to trigger re-renders.
 */

import type { RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";

/** A single letter's live handle — updated by <Letters/>, read by <Fluid/>. */
export type LetterHandle = {
  index: number;
  char: string;
  home: THREE.Vector3;
  body: RapierRigidBody | null;
  halfSize: THREE.Vector3;
  grabbed: boolean;
  /** Sample points on the Text3D glyph surface in mesh LOCAL space.
   *  Populated once after the font/geometry loads; empty until then. */
  localSamples: THREE.Vector3[];
  /** World-space sample positions, lerped toward targets each frame —
   *  creates the "water trails behind moving letters" effect. Same
   *  length as localSamples. */
  worldSamples: THREE.Vector3[];
  /** Ref to the Text3D mesh so Fluid (or anyone) can read its world matrix. */
  mesh: THREE.Mesh | null;
};

/** Event pushed by <Letters/> when something worth reacting to happens. */
export type ImpactEvent = {
  kind: "soft" | "hard" | "drag-release";
  /** World-space position where the contact happened. */
  position: THREE.Vector3;
  /** World-space outward normal (direction to spawn a droplet in, etc). */
  normal: THREE.Vector3;
  /** Force magnitude (Rapier contact force; for drag-release, cursor speed). */
  force: number;
  /** Optional index of the letter involved (for per-letter audio pitch etc). */
  letterIndex?: number;
};

/** Event queue — pushed by producers, drained each frame by consumers. */
export class EventQueue {
  private events: ImpactEvent[] = [];
  push(e: ImpactEvent) {
    this.events.push(e);
  }
  drain(): ImpactEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }
}
