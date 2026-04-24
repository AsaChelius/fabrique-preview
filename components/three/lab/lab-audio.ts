/**
 * /lab prototype — dedicated Web Audio system.
 *
 * The hero's existing `lib/sound.ts` voices (clack/thud/orb-*) are tuned
 * for the old terrestrial-bouncy hero. /lab is submarine-adjacent: everything
 * is supposed to feel wet, low, and slightly dampened by water. So this
 * module supplies its own voice set built from scratch:
 *
 *   - playLetterThud(pitchIndex, vol)  — wet low resonant bonk, per-letter pitch
 *   - playBubbleDetach(vol)            — small high bloop (bubble popping off)
 *   - playBubbleMerge(vol)             — low bloop (bubble re-absorbing)
 *   - playArtifactHit(vol)             — thin metallic clink (distinguishable from letter)
 *   - startAmbient() / stopAmbient()   — low underwater drone bed
 *
 * Everything is gated behind unlockLabAudio(), which must be called inside
 * a user gesture (see LabScene's onPointerDown).
 *
 * Design notes:
 *  - Every output path passes through a gentle low-pass filter (the "under-
 *    water" EQ). That's the single biggest contributor to the submarine vibe.
 *  - A short programmatic convolution reverb (generated impulse) gives every
 *    hit a sense of enclosure without shipping any audio files.
 *  - Master volume is conservative — per brief, sound should support the
 *    image, not fight it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Ctx = {
  ac: AudioContext;
  master: GainNode;
  dry: GainNode;
  wet: GainNode;
  reverb: ConvolverNode;
  uwFilter: BiquadFilterNode;
};

let ctx: Ctx | null = null;
let unlocked = false;
let ambientHandle: { stop: () => void } | null = null;

// -----------------------------------------------------------------------------

function createImpulseResponse(ac: AudioContext): AudioBuffer {
  // Short damp underwater IR — 0.9s, exponential decay, mildly rough.
  const sampleRate = ac.sampleRate;
  const length = Math.floor(sampleRate * 0.9);
  const ir = ac.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Decaying noise with a mild ripple; low-freq emphasis handled by the
      // master uwFilter downstream.
      const decay = Math.pow(1 - t, 2.2);
      data[i] = (Math.random() * 2 - 1) * decay * 0.55;
    }
  }
  return ir;
}

function ensureCtx(): Ctx | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AC =
    (window as any).AudioContext ||
    (window as any).webkitAudioContext;
  if (!AC) return null;
  const ac: AudioContext = new AC();

  // Master chain:  src → [uwFilter lowpass] → dry+wet → master → destination.
  const master = ac.createGain();
  master.gain.value = 0.5; // conservative; /lab audio should never overpower.
  master.connect(ac.destination);

  const dry = ac.createGain();
  dry.gain.value = 0.78;
  dry.connect(master);

  const reverb = ac.createConvolver();
  reverb.buffer = createImpulseResponse(ac);
  const wet = ac.createGain();
  wet.gain.value = 0.22;
  reverb.connect(wet);
  wet.connect(master);

  // Everything feeds through the underwater EQ first.
  const uwFilter = ac.createBiquadFilter();
  uwFilter.type = "lowpass";
  uwFilter.frequency.value = 3200; // roll off the brittle highs
  uwFilter.Q.value = 0.5;
  uwFilter.connect(dry);
  uwFilter.connect(reverb);

  ctx = { ac, master, dry, wet, reverb, uwFilter };
  return ctx;
}

export function unlockLabAudio(): void {
  const c = ensureCtx();
  if (!c || unlocked) return;
  if (c.ac.state === "suspended") c.ac.resume();
  unlocked = true;
}

export function setMasterVolume(v: number): void {
  const c = ctx;
  if (!c) return;
  c.master.gain.value = Math.max(0, Math.min(1, v));
}

// -----------------------------------------------------------------------------
// Per-letter pitch table. Pentatonic-ish so collisions sound musical even if
// multiple fire at once. Values are base frequencies in Hz for the thud voice.
const LETTER_FREQS = [82, 98, 73, 110, 87, 65, 98, 73];

/** Low wet thud — two-oscillator body + filtered noise tap at the attack. */
export function playLetterThud(letterIndex: number, volume: number): void {
  const c = ctx;
  if (!c || !unlocked) return;
  const ac = c.ac;
  const now = ac.currentTime;
  const vol = Math.max(0, Math.min(1, volume));
  const baseFreq = LETTER_FREQS[letterIndex % LETTER_FREQS.length];

  // --- Body: sine at base + sub at base/2, with pitch envelope dropping a semitone.
  const body = ac.createGain();
  body.gain.setValueAtTime(0, now);
  body.gain.linearRampToValueAtTime(vol * 0.85, now + 0.005);
  body.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  body.connect(c.uwFilter);

  const sine = ac.createOscillator();
  sine.type = "sine";
  sine.frequency.setValueAtTime(baseFreq * 1.06, now);
  sine.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.2);
  sine.connect(body);
  sine.start(now);
  sine.stop(now + 0.6);

  const sub = ac.createOscillator();
  sub.type = "sine";
  sub.frequency.value = baseFreq * 0.5;
  const subGain = ac.createGain();
  subGain.gain.value = 0.55;
  sub.connect(subGain).connect(body);
  sub.start(now);
  sub.stop(now + 0.6);

  // --- Tap: 10ms filtered-noise burst at the attack — the "wet contact" chirp.
  const bufferLen = Math.floor(ac.sampleRate * 0.03);
  const nbuf = ac.createBuffer(1, bufferLen, ac.sampleRate);
  const nd = nbuf.getChannelData(0);
  for (let i = 0; i < bufferLen; i++) nd[i] = (Math.random() * 2 - 1);
  const noise = ac.createBufferSource();
  noise.buffer = nbuf;
  const nfilt = ac.createBiquadFilter();
  nfilt.type = "bandpass";
  nfilt.frequency.value = baseFreq * 7;
  nfilt.Q.value = 4;
  const nGain = ac.createGain();
  nGain.gain.setValueAtTime(vol * 0.55, now);
  nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
  noise.connect(nfilt).connect(nGain).connect(c.uwFilter);
  noise.start(now);
  noise.stop(now + 0.06);
}

// -----------------------------------------------------------------------------

/** High quick pop — a bubble separating from the main mass. */
export function playBubbleDetach(volume: number): void {
  const c = ctx;
  if (!c || !unlocked) return;
  const ac = c.ac;
  const now = ac.currentTime;
  const vol = Math.max(0, Math.min(1, volume));

  // Pitch-sweep sine (high → low) with fast decay = classic bubble pop flavour.
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(620 + Math.random() * 180, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.18);

  const g = ac.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(vol * 0.45, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

  osc.connect(g).connect(c.uwFilter);
  osc.start(now);
  osc.stop(now + 0.3);
}

// -----------------------------------------------------------------------------

/** Soft low bloop — a bubble re-merging with the main body. */
export function playBubbleMerge(volume: number): void {
  const c = ctx;
  if (!c || !unlocked) return;
  const ac = c.ac;
  const now = ac.currentTime;
  const vol = Math.max(0, Math.min(1, volume));

  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(72, now + 0.35);

  const g = ac.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(vol * 0.32, now + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);

  osc.connect(g).connect(c.uwFilter);
  osc.start(now);
  osc.stop(now + 0.55);
}

// -----------------------------------------------------------------------------

/** Thin metallic clink for artifacts — sits in a different freq band than letters. */
export function playArtifactHit(volume: number): void {
  const c = ctx;
  if (!c || !unlocked) return;
  const ac = c.ac;
  const now = ac.currentTime;
  const vol = Math.max(0, Math.min(1, volume));

  // Two triangle partials that decay quickly — hollow metal underwater.
  const freqs = [480, 820];
  for (let i = 0; i < freqs.length; i++) {
    const osc = ac.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freqs[i] * (0.96 + Math.random() * 0.08);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol * (i === 0 ? 0.35 : 0.18), now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35 - i * 0.1);
    osc.connect(g).connect(c.uwFilter);
    osc.start(now);
    osc.stop(now + 0.4);
  }
}

// -----------------------------------------------------------------------------
// Ambient bed — low drone + slow filter sweep + occasional far-off bubble hint.

export function startAmbient(): void {
  const c = ensureCtx();
  if (!c || !unlocked || ambientHandle) return;
  const ac = c.ac;
  const now = ac.currentTime;

  // === Deep drone bed ========================================================
  // Three low oscillators tuned to produce slow beating + a sub-bass thrum.
  // These push the "alien submarine" weight that the spec calls for.
  const root = 48; // G1
  const a = ac.createOscillator();
  a.type = "sine";
  a.frequency.value = root;
  const b = ac.createOscillator();
  b.type = "sine";
  b.frequency.value = root * 1.498; // a fifth above, detuned slightly for beating
  const c1 = ac.createOscillator();
  c1.type = "triangle";
  c1.frequency.value = root * 2; // octave partial for body
  const c2 = ac.createOscillator();
  c2.type = "sine";
  c2.frequency.value = root * 0.5; // sub — felt more than heard

  // Very slow LFO pitch wobble on the fifth — alive, not static.
  const pitchLfo = ac.createOscillator();
  pitchLfo.type = "sine";
  pitchLfo.frequency.value = 0.04;
  const pitchDepth = ac.createGain();
  pitchDepth.gain.value = 0.6;
  pitchLfo.connect(pitchDepth).connect(b.frequency);

  // Lowpass sweeping 350–1400 Hz — the "breathing" filter.
  const swept = ac.createBiquadFilter();
  swept.type = "lowpass";
  swept.frequency.value = 700;
  swept.Q.value = 1.1;
  const sweepLfo = ac.createOscillator();
  sweepLfo.type = "sine";
  sweepLfo.frequency.value = 0.055;
  const sweepDepth = ac.createGain();
  sweepDepth.gain.value = 450;
  sweepLfo.connect(sweepDepth).connect(swept.frequency);

  // Amplitude LFO (breath).
  const ampLfo = ac.createOscillator();
  ampLfo.type = "sine";
  ampLfo.frequency.value = 0.09;
  const ampDepth = ac.createGain();
  ampDepth.gain.value = 0.06;
  const amp = ac.createGain();
  amp.gain.value = 0.22; // meaningfully louder than before — still well under hits
  ampLfo.connect(ampDepth).connect(amp.gain);

  a.connect(swept);
  b.connect(swept);
  c1.connect(swept);
  c2.connect(amp); // sub bypasses the sweep filter, stays deep
  swept.connect(amp).connect(c.master);

  // === Noise wash — very faint "water pressure" hiss =========================
  // Pink-ish noise gated through a narrow bandpass sweeping around 250 Hz.
  // Gives the bed a wet texture without being audibly hissy.
  const noiseLen = Math.floor(ac.sampleRate * 3);
  const nbuf = ac.createBuffer(1, noiseLen, ac.sampleRate);
  const nd = nbuf.getChannelData(0);
  // Cheap pink-ish: sum a few octaves of noise with decay.
  let prev = 0;
  for (let i = 0; i < noiseLen; i++) {
    const white = Math.random() * 2 - 1;
    prev = prev * 0.96 + white * 0.04; // low-frequency-biased
    nd[i] = prev * 2.5;
  }
  const noise = ac.createBufferSource();
  noise.buffer = nbuf;
  noise.loop = true;
  const noiseFilt = ac.createBiquadFilter();
  noiseFilt.type = "bandpass";
  noiseFilt.frequency.value = 260;
  noiseFilt.Q.value = 1.4;
  const noiseFiltLfo = ac.createOscillator();
  noiseFiltLfo.type = "sine";
  noiseFiltLfo.frequency.value = 0.11;
  const noiseFiltDepth = ac.createGain();
  noiseFiltDepth.gain.value = 120;
  noiseFiltLfo.connect(noiseFiltDepth).connect(noiseFilt.frequency);
  const noiseGain = ac.createGain();
  noiseGain.gain.value = 0.09;
  noise.connect(noiseFilt).connect(noiseGain).connect(c.master);

  a.start(now);
  b.start(now);
  c1.start(now);
  c2.start(now);
  pitchLfo.start(now);
  sweepLfo.start(now);
  ampLfo.start(now);
  noise.start(now);
  noiseFiltLfo.start(now);

  // === Occasional distant bubble + sub thump =================================
  // Every 4–10s, fire either a faint detach bubble or a low thump.
  let bubbleTimer: number | null = null;
  const scheduleBubble = () => {
    const delay = 4000 + Math.random() * 6000;
    bubbleTimer = window.setTimeout(() => {
      if (Math.random() < 0.6) {
        playBubbleDetach(0.05 + Math.random() * 0.05);
      } else {
        // Low thump — a far-off "something big moved" suggestion.
        const t = ac.currentTime;
        const osc = ac.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(42, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.5);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        osc.connect(g).connect(c.uwFilter);
        osc.start(t);
        osc.stop(t + 1);
      }
      scheduleBubble();
    }, delay);
  };
  scheduleBubble();

  ambientHandle = {
    stop: () => {
      try {
        a.stop(); b.stop(); c1.stop(); c2.stop();
        pitchLfo.stop(); sweepLfo.stop(); ampLfo.stop();
        noise.stop(); noiseFiltLfo.stop();
      } catch {
        /* already stopped */
      }
      if (bubbleTimer !== null) window.clearTimeout(bubbleTimer);
      ambientHandle = null;
    },
  };
}

export function stopAmbient(): void {
  ambientHandle?.stop();
}
