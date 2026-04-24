"use client";

/**
 * Showcase mode — module-level state + subscribe.
 *
 * Three modes:
 *   "off"      — FABRIQUE wordmark, no cards.
 *   "showcase" — 5 cards in a row, each its own chameleon hue.
 *   "expanded" — one big merged box, adopting the clicked card's hue.
 *                All shards (outline + interior) collapse into it.
 *
 * Also tracks which card the cursor is currently over so the hit-planes
 * in sculpture-scene.tsx can drive per-card glow without needing React
 * context (the Canvas tree and the route wrapper are separate trees).
 *
 * Bus pattern (rather than React context) keeps the Canvas tree free of
 * provider wrappers and lets hit-planes deep in the R3F tree flip state
 * with a single function call.
 */

export type ShowcaseMode = "off" | "showcase" | "expanded";

type ModeListener = (mode: ShowcaseMode, expandedCard: number | null) => void;
type HoverListener = (hoveredCard: number | null) => void;
// Legacy: fired with a boolean (active = mode !== "off") so existing
// consumers (suspended-cloud, projects-button) keep working.
type LegacyActiveListener = (active: boolean) => void;

let _mode: ShowcaseMode = "off";
let _expandedCard: number | null = null;
let _hoveredCard: number | null = null;

const _modeListeners = new Set<ModeListener>();
const _hoverListeners = new Set<HoverListener>();
const _legacyListeners = new Set<LegacyActiveListener>();

function isActive(mode: ShowcaseMode): boolean {
  return mode !== "off";
}

function notifyMode(): void {
  _modeListeners.forEach((l) => l(_mode, _expandedCard));
  _legacyListeners.forEach((l) => l(isActive(_mode)));
}

function notifyHover(): void {
  _hoverListeners.forEach((l) => l(_hoveredCard));
}

// ---- Getters -----------------------------------------------------------

export function getMode(): ShowcaseMode {
  return _mode;
}

export function getExpandedCard(): number | null {
  return _expandedCard;
}

export function getHoveredCard(): number | null {
  return _hoveredCard;
}

// ---- Mode transitions -------------------------------------------------

export function setMode(mode: "off" | "showcase"): void {
  if (_mode === mode) return;
  _mode = mode;
  _expandedCard = null;
  notifyMode();
}

export function expandCard(cardIdx: number): void {
  if (_mode === "expanded" && _expandedCard === cardIdx) return;
  _mode = "expanded";
  _expandedCard = cardIdx;
  notifyMode();
}

export function collapseExpanded(): void {
  if (_mode !== "expanded") return;
  _mode = "showcase";
  _expandedCard = null;
  notifyMode();
}

// ---- Hover ------------------------------------------------------------

export function setHoveredCard(idx: number | null): void {
  if (_hoveredCard === idx) return;
  _hoveredCard = idx;
  notifyHover();
}

// ---- Legacy API (kept so projects-button / suspended-cloud don't need
//                  simultaneous migration). ----

export function isShowcaseActive(): boolean {
  return isActive(_mode);
}

export function setShowcase(active: boolean): void {
  setMode(active ? "showcase" : "off");
}

export function toggleShowcase(): void {
  // Acts as a "back one step" button (the arrow shard button uses it):
  //   expanded  → showcase  (back to the 5 projects view)
  //   showcase  → off       (back to FABRIQUE wordmark)
  //   off       → showcase  (open the projects view)
  if (_mode === "expanded") {
    collapseExpanded();
  } else {
    setMode(_mode === "showcase" ? "off" : "showcase");
  }
}

// ---- Subscribe ---------------------------------------------------------

export function onModeChange(cb: ModeListener): () => void {
  _modeListeners.add(cb);
  return () => {
    _modeListeners.delete(cb);
  };
}

export function onHoveredChange(cb: HoverListener): () => void {
  _hoverListeners.add(cb);
  return () => {
    _hoverListeners.delete(cb);
  };
}

export function onShowcaseChange(cb: LegacyActiveListener): () => void {
  _legacyListeners.add(cb);
  return () => {
    _legacyListeners.delete(cb);
  };
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  const w = window as unknown as {
    __toggleShowcase?: () => void;
    __expandCard?: (i: number) => void;
    __collapseExpanded?: () => void;
  };
  w.__toggleShowcase = toggleShowcase;
  w.__expandCard = expandCard;
  w.__collapseExpanded = collapseExpanded;
}
