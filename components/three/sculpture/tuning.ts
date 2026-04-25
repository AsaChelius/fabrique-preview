/**
 * Tunables for the anamorphic FABRIQUE sculpture.
 *
 * Everything that affects feel lives here so iteration is tight.
 * Change values, reload, evaluate.
 */

export const TUNING = {
  // ---- Word composition -----------------------------------------------
  /** Single-row wordmark. Kept as an array so multi-row is still available
   *  later if we want it — the sampler flattens with spaces between rows. */
  wordRows: ["FABRIQUE"] as const,
  /** Font used for silhouette rasterization (system-safe, geometric sans). */
  fontFamily:
    '"Helvetica Neue", "Inter", "Arial", system-ui, sans-serif',
  fontWeight: 700,
  /** Leading (vertical gap) as a multiple of font size. Irrelevant at 1 row
   *  but kept for future multi-row. */
  lineHeight: 0.98,
  /** Horizontal letter-spacing as a fraction of font size. Slight negative
   *  tightens the word to read as one unit. */
  letterSpacing: -0.02,

  // ---- Sampling resolution --------------------------------------------
  /** Internal rasterization canvas size. Higher = crisper silhouette. */
  sampleWidth: 1800,
  sampleHeight: 800,
  /** Alpha threshold (0-255) to accept a pixel as "inside" the glyph. */
  alphaThreshold: 140,

  // ---- Sign frame (rectangular plaque around the letters) -------------
  /** Fraction of sample-canvas width that the plaque occupies. */
  frameWidthFrac: 0.92,
  /** Fraction of sample-canvas height that the plaque occupies. */
  frameHeightFrac: 0.72,
  /** How much extra padding (in pixels on the sample canvas) to knock out
   *  around each letter so the plaque doesn't kiss the glyph edges. A small
   *  breathing gap sells the "letters in front of a plaque" read. */
  letterKnockoutPadding: 6,

  // ---- Nos Projets button (shared with sampling for plaque knockout) ----
  /** World Y-center where the button sits (negative = below FABRIQUE,
   *  inside the plaque area). */
  buttonCenterY: -1.35,
  /** Button label half-width in world units. */
  buttonHalfWidth: 1.15,
  /** Button label half-height in world units. Derived from its own
   *  rasterization aspect, but we declare it explicitly so sampling.ts
   *  can knock out the correct region without importing projects-button. */
  buttonHalfHeight: 0.19,
  /** Extra padding (world units) around the button knockout rectangle
   *  so the plaque leaves a clean breathing gap around the label. */
  buttonKnockoutPadding: 0.14,

  // ---- Shard counts ---------------------------------------------------
  /** Shards forming the letters. Denser now for crisper silhouette edges. */
  letterShardCount: 5200,
  /** Shards forming the surrounding plaque. Dense enough that the plaque
   *  reads as a solid metallic sheet rather than implied geometry. */
  frameShardCount: 7000,

  // ---- Shard geometry (world units) -----------------------------------
  /** Long vertical dimension — these are hung vertically, long axis = Y. */
  shardHeight: 0.10,
  /** Short horizontal dimension. Wider so shards overlap more horizontally,
   *  filling in gaps between samples and giving crisper strokes. */
  shardWidth: 0.026,
  /** Thickness — very thin, like cut sheet metal. */
  shardThickness: 0.0022,

  // ---- World placement ------------------------------------------------
  /** Camera distance from origin (sweet-spot A). */
  cameraZ: 9,
  /** Vertical FOV in degrees. */
  fov: 28,
  /** Word half-width in world units. Wider now that FABRIQUE is 1 row. */
  wordHalfWidth: 5.4,
  /** Margin (world units) added around the cloud when fitting FOV to it.
   *  Bumped up so the sculpture sits with more breathing room — reads as
   *  if the camera pulled back a step. */
  fitMargin: 3.0,
  /** How deep the cloud extends along the viewing ray (+/- around z=0).
   *  Bigger = more obvious 3D when the camera moves off-axis. */
  cloudDepth: 3.0,
  /** Distribution of depth. 1 = uniform. >1 biases toward mid-plane. */
  depthBias: 1.1,

  // ---- Shard orientation ---------------------------------------------
  /** Random yaw around the vertical (Y) axis, radians. Tighter now so
   *  letter silhouettes read cleaner — more shards present their broad
   *  face directly to the sweet-spot, less edge-on scatter. */
  yawJitter: 0.32,
  /** Tiny pitch jitter (radians) so shards don't look robotically aligned. */
  tiltJitter: 0.06,

  // ---- Wires ---------------------------------------------------------
  /** Y world-coordinate of the (unseen) ceiling each wire attaches to.
   *  Set well above the visible frame top so wires cleanly exit the top
   *  of the viewport rather than dead-ending mid-air. */
  ceilingY: 7.5,
  /** Wire radius — near-invisible. */
  wireRadius: 0.0006,
  /** Wire color — light neutral. */
  wireColor: "#9aa0a8",
  /** Wire material opacity. */
  wireOpacity: 0.55,

  // ---- Materials ------------------------------------------------------
  /** Letter shard color — darker so letters pop against the lighter plaque. */
  letterShardColor: "#4a4d55",
  /** Plaque shard color — lighter, picks up more env reflection. */
  frameShardColor: "#b4b8be",
  metalness: 1.0,
  roughness: 0.3,
  iridescence: 0.0,
  iridescenceIOR: 1.3,
  envMapIntensity: 1.35,

  // ---- Background -----------------------------------------------------
  backgroundColor: "#faf8f3",

  // ---- Floor (polished reflector) -----------------------------------
  /** Y world-position of the floor plane. Just below the bottom of the
   *  plaque. */
  floorY: -2.05,
  /** Floor base color — a few shades darker than the background so the
   *  reflected sculpture sits on a cooler tone that makes the mirror
   *  image clearly visible without dominating the composition. */
  floorColor: "#d5d1c3",
  /** Mirror strength — 1.0 for maximum reflected light. */
  floorReflectStrength: 1.0,
  /** Reflection blur — tight so the reflection reads as mirror-sharp. */
  floorReflectBlur: 22,
  /** Mix of blurred vs sharp reflection. Near 0 = crisp mirror. */
  floorMixBlur: 0.08,
  /** Reflection mix strength — punched up so the reflected sculpture
   *  is clearly legible against the darker floor. */
  floorMixStrength: 3.2,
  /** Floor roughness — legacy, unused (we force roughness=1 in the mesh
   *  to kill the directional-light specular hotspot). */
  floorRoughness: 1.0,

  // ---- Physics / idle sway -------------------------------------------
  /** Minimum idle sway amplitude (world units) per shard. */
  swayAmpMin: 0.006,
  /** Maximum idle sway amplitude (world units) per shard. */
  swayAmpMax: 0.022,
  /** Minimum sway frequency (radians per second). Slower feels like air,
   *  faster feels like a breeze. */
  swayFreqMin: 0.35,
  swayFreqMax: 0.95,
  /** Tiny vertical sway component — real pendulums bob a little. */
  swayVerticalFactor: 0.15,

  // ---- Physics / cursor + spring ------------------------------------
  /** World-space radius of cursor influence (distance from cursor at
   *  which shards start getting pushed). */
  cursorRadius: 1.1,
  /** Peak impulse magnitude at the cursor's exact position. Falls off to
   *  zero at cursorRadius. */
  cursorStrength: 14,
  /** Pendulum-style stiffness: spring constant = pendulumGravity / wireLen.
   *  Longer wires feel more sluggish (correct pendulum behavior). Scaled
   *  up ~1.78× from the original 26 so the showcase morph lands ~33%
   *  faster — spring period ∝ 1/√k, so k × 1.78 → period × 0.75. */
  pendulumGravity: 46,
  /** Velocity damping, per second. Scaled with pendulumGravity (√1.78 ≈
   *  1.33) to preserve the same near-critical damping character. */
  physicsDamping: 6.65,
  /** Cap on dt to prevent integration blow-ups on slow frames. */
  physicsMaxDt: 1 / 30,

  // ---- Theme transition ----------------------------------------------
  /** Per-frame lerp factor used by materials (shards, dust, button,
   *  lights, scene background) to animate color when light↔dark mode
   *  toggles. ~0.06 = ~600ms to cover 90% of the gap. Lower = slower. */
  paletteLerp: 0.06,

  // ---- Overhead (ceiling beam, light cones, dust motes) --------------
  /** Subtle architectural beam just above the visible sculpture. Sells the
   *  "piece hangs from something" read. Placed within the camera frustum
   *  so it actually shows (the physics `ceilingY` is off-screen). */
  ceilingBeamY: 2.15,
  ceilingBeamWidth: 11,
  ceilingBeamThickness: 0.06,
  ceilingBeamDepth: 0.28,
  ceilingBeamColor: "#c9c6bc",

  /** Overhead light cones — warm cream tint on the white background, normal
   *  blending (additive is invisible on near-white). Tip sits at the top,
   *  base fans toward the sculpture. */
  lightConeTopY: 2.08,
  lightConeHeight: 4.0,
  lightConeRadius: 1.35,
  /** [x, z] per cone. Three evenly-spread sources over the wordmark. */
  lightConePositions: [
    [-2.6, 0],
    [0, 0.15],
    [2.6, 0],
  ],
  lightConeColor: "#fff1cf",
  lightConeOpacity: 0.16,

  /** Dust motes — slow-drifting particles in the upper gallery volume. */
  dustCount: 160,
  dustSize: 0.028,
  dustColor: "#b5b1a2",
  dustOpacity: 0.55,
  dustAreaWidth: 10,
  dustAreaHeight: 3.4,
  dustAreaDepth: 3.0,
  /** Y center of the dust volume. */
  dustAreaY: 0.6,
  /** Horizontal + depth drift speed (world units / sec). */
  dustDrift: 0.06,
  /** Gentle downward settling speed (world units / sec). */
  dustFall: 0.035,

  // ---- Idle mouse parallax -------------------------------------------
  /** Peak camera X offset (world units) when mouse is at the horizontal edge.
   *  Cranked past the original "preserve anamorphic illusion" limit —
   *  the card volumes have real Z depth now, so the 3D read benefits
   *  from a more pronounced parallax. FABRIQUE still resolves near
   *  the sweet-spot; the illusion just softens at the edges, which is
   *  worth it for the extra dimensionality on the cards. */
  tiltAmountX: 0.38,
  /** Peak camera Y offset (world units) when mouse is at the vertical edge. */
  tiltAmountY: 0.24,
  /** Per-frame lerp factor toward the target tilted position. Low = smooth
   *  follow, never a snap. */
  tiltLerp: 0.18,
  /** Subtle whole-sculpture inertia from pointer motion, even when the
   *  cursor is over empty space. Gives the parallax tilt a rubber-band
   *  feel because shards drag slightly behind mouse movement, then settle. */
  globalPointerDragStrength: 0.32,
  /** Cap per-frame whole-scene drag so fast mouse shakes stay controlled. */
  globalPointerDragMax: 0.016,
  /** Horizontal mouse motion also nudges depth a little so the response
   *  feels dimensional instead of a flat XY slide. */
  globalPointerDragZ: 0.1,

  // ---- Showcase (NOS PROJETS open state) ------------------------------
  /** Base HSL hue (0-1) per card, driving the chameleon color flow. Red,
   *  gold, cyan, royal-blue, magenta — picked so adjacent cards land far
   *  apart on the wheel. Each shard inside a card adds per-shard noise. */
  cardHues: [0.02, 0.13, 0.46, 0.62, 0.85] as const,
  /** Slow global hue drift (turns / sec). Low so the colors breathe. */
  hueDriftRate: 0.035,
  /** Wave amplitude applied to a card's hue (turns). Creates the flowing
   *  swirl across its shards. */
  hueFlowAmp: 0.14,
  /** Per-shard hue noise amplitude (turns). Gives individual shards a
   *  slightly different tint from their neighbours. */
  hueShardNoise: 0.06,
  /** Chameleon saturation + lightness (base values; each is modulated by
   *  a tiny per-shard sinusoid for the shimmer read). */
  chameleonSat: 0.82,
  chameleonLight: 0.58,
  /** Per-frame lerp for the chameleon fade-in when showcase activates and
   *  fade-out when it closes. ~0.08 ≈ 300ms to 90%. Should feel roughly
   *  in step with the shard physics morph. Also drives the wind
   *  fade-in below — one factor governs all showcase-specific effects. */
  showcaseColorLerp: 0.08,

  /** Idle wind pushing each shard around while inside a card. Each shard
   *  has its own phase per axis so the cloud reads as turbulent rather
   *  than a coordinated wave. Applied on top of the existing pendulum
   *  sway, scaled by the showcase morph so it fades in/out with the
   *  mode — no wind outside the cards. */
  windAmpX: 0.14,
  windAmpY: 0.11,
  windAmpZ: 0.13,
  /** Base angular frequency per axis (rad/sec). Prime-ish ratios so the
   *  composite XYZ motion never closes a short loop. */
  windFreqX: 1.7,
  windFreqY: 2.3,
  windFreqZ: 1.3,

  /** Extra physical response when the pointer shakes over a project card.
   *  Applied only to shards belonging to the hovered card. */
  cardImpulseStrength: 0.95,
  /** Cap for one pointer-move impulse so fast mouse movement feels lively
   *  without exploding the pendulum state. */
  cardImpulseMax: 0.08,
  /** Tiny depth kick from horizontal movement so the boxes feel 3D, not
   *  just like a flat XY ripple. */
  cardImpulseZ: 0.24,

  /** Snake-style flow along the card outlines. Each outline shard gets
   *  pushed along its edge direction by a traveling sine wave — same
   *  wave across a given edge so the displacement reads as a continuous
   *  ripple contouring the wireframe (not shards jittering in place). */
  snakeAmp: 0.028,
  /** How many full waves fit along one edge length. 2.5 gives a few
   *  visible "humps" traveling along each side at any moment. */
  snakeWaveCount: 2.5,
  /** Wave travel speed in cycles / sec. Slow = meandering snake. */
  snakeWaveSpeed: 0.45,

  /** Glow additions applied per-shard when the cursor is over the
   *  shard's own card. Mixed into the chameleon HSL — brighter and
   *  more saturated than the idle tone, reads as "this card lights
   *  up when you're on it". */
  glowSatBoost: 0.18,
  glowLightBoost: 0.27,

  /** One merged box used in "expanded" mode. Wider/taller/deeper than
   *  a single card — covers most of the plaque area. All shards
   *  (outline + interior) collapse into it. */
  expandedBoxW: 9.0,
  expandedBoxH: 2.5,
  expandedBoxD: 2.4,

  // ---- Reveal animation ----------------------------------------------
  /** Duration of the camera pan from overture pose to sweet-spot (ms). */
  revealDurationMs: 2800,
  /** Overture camera offset from sweet-spot. The camera starts at
   *  (sweet-spot + overtureOffset) and lerps to sweet-spot. Using a side
   *  angle (big x, small y) gives the best "letters realize as you move
   *  into position" read. */
  overtureOffset: { x: 7.5, y: 1.2, z: -2 },

  // ---- Legacy (kept to avoid breaking existing imports) --------------
  shardColor: "#8f939a",
  shardCount: 4500,
  shadowY: -2.7,
  shadowOpacity: 0.12,
  shadowBlur: 3.2,
  shadowScale: 7.5,
} as const;
