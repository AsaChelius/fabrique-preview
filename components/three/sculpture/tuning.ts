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
  /** Margin (world units) added around the cloud when fitting FOV to it. */
  fitMargin: 0.6,
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
  /** Floor base color — matches the background so the plane has no
   *  visible edge; only the reflection registers. */
  floorColor: "#faf8f3",
  /** Mirror strength — near 1 for a clear polished-floor reflection. */
  floorReflectStrength: 0.92,
  /** Reflection blur — low so the reflected sculpture stays legible. */
  floorReflectBlur: 80,
  /** Mix of blurred vs sharp reflection. 0 = all sharp. */
  floorMixBlur: 0.4,
  /** Floor roughness — low means sharp specular reflections (polished). */
  floorRoughness: 0.22,

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
   *  Longer wires feel more sluggish (correct pendulum behavior). */
  pendulumGravity: 26,
  /** Velocity damping, per second. Tuned for near-critical damping so the
   *  sculpture settles within ~1s of the cursor leaving — oscillation
   *  reads as "recovery" not "ringing". */
  physicsDamping: 5.0,
  /** Cap on dt to prevent integration blow-ups on slow frames. */
  physicsMaxDt: 1 / 30,

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
