/**
 * FABRIQUE sound system.
 *
 * We synth short SFX via the Web Audio API — no asset files to ship, no
 * Howler needed for these tiny clack / whoosh / ding sounds. If we later
 * want music or longer samples, swap in Howler here and keep the API shape.
 *
 * API: `playSound(name, volume?)` — volume 0..1.
 *
 * All calls are no-ops on the server and before the first user gesture
 * (browsers require a user interaction before AudioContext can play).
 */

export type SoundName =
  | "clack"
  | "whoosh"
  | "ding"
  | "thud"
  // One per orb shape — each picks a distinct synth voice.
  | "orb-pop"     // sphere: soft rising-to-low sine pop
  | "orb-knock"   // cube: wooden-ish filtered noise + thump
  | "orb-ping"    // octa: high two-tone crystal ping
  | "orb-chime"   // icosa: three-tone bright bell stack
  | "orb-wobble"  // torus: vibrato sine wobble
  | "orb-thump"   // dodec: pitched-down triangle thud
  // Phone UX voices (legacy — harmless to keep).
  | "phone-key"   // DTMF-ish two-tone key press
  | "phone-dial"  // dial-tone hum
  | "phone-hang"  // hangup click
  | "alien"       // alien speech burst — filtered noise + warble
  // Contact-scene (retro CRT + Win98) voices
  | "crt-on"      // power-on zap — rising whine + click
  | "crt-off"     // collapse-to-dot descent
  | "type-key"    // keyboard tick
  | "win98-click" // OK button click
  | "win98-ding"  // 3-note success stinger
  | "flicker"     // short electrical crackle — fluorescent/CRT flicker
  | "phantom-whisper"; // cursor-through-hallucination whisper

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let unlocked = false;
// Shared reverb bus — convolver with a synthesized IR. Lazily built on
// first request via getReverbBus(). Routed: source → wetGain → convolver
// → masterGain. The convolver's wet output goes to master alongside the
// source's dry signal.
let reverbConvolver: ConvolverNode | null = null;
let reverbWetIn: GainNode | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.45;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

/**
 * Generate an impulse response: exponentially decaying stereo noise.
 * `seconds` controls the reverb tail length, `decay` shapes the curve.
 * Bigger seconds = longer linger; bigger decay = brighter early / dies
 * quicker.
 */
function buildImpulseResponse(c: AudioContext, seconds: number, decay = 2.5): AudioBuffer {
  const sampleRate = c.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * seconds));
  const buf = c.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      // Random noise * exponential decay envelope
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buf;
}

/** Returns the shared reverb input gain. Connect a source's wet send
 *  here; convolver output is already wired to masterGain. */
function getReverbBus(c: AudioContext, master: GainNode): GainNode | null {
  if (reverbWetIn) return reverbWetIn;
  reverbConvolver = c.createConvolver();
  reverbConvolver.buffer = buildImpulseResponse(c, 3.6, 2.2); // ~3.6s tail
  reverbWetIn = c.createGain();
  reverbWetIn.gain.value = 1;
  reverbWetIn.connect(reverbConvolver).connect(master);
  return reverbWetIn;
}

/** Call once after first user interaction to unlock audio. */
export function unlockAudio() {
  const c = ensureContext();
  if (!c || unlocked) return;
  if (c.state === "suspended") c.resume();
  unlocked = true;
}

// -----------------------------------------------------------------------------
// Asset-based samples — for sounds that are richer than what synthesis can
// produce (chimes, recorded foley, etc.). Drop files in /public/sounds/ and
// call `playSample("/sounds/your-file.mp3", volume)`.
//
// AudioBuffers are decoded once and cached. First play has fetch + decode
// latency (~10-50ms); subsequent plays are instant.
// -----------------------------------------------------------------------------

const sampleCache = new Map<string, AudioBuffer>();
const samplePending = new Map<string, Promise<AudioBuffer | null>>();

async function loadSample(url: string): Promise<AudioBuffer | null> {
  const c = ensureContext();
  if (!c) return null;
  const cached = sampleCache.get(url);
  if (cached) return cached;
  const inflight = samplePending.get(url);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      const buf = await c.decodeAudioData(arr);
      sampleCache.set(url, buf);
      return buf;
    } catch {
      return null;
    } finally {
      samplePending.delete(url);
    }
  })();
  samplePending.set(url, p);
  return p;
}

/** Returned by playSample for callers that want to fade/stop their sound. */
export type SampleHandle = {
  /** Fade out + stop. Safe to call multiple times. */
  stop: (fadeMs?: number) => void;
  /** Smoothly ramp the playback gain to `target` over `fadeMs`. Use this
   *  to duck older overlapping samples without truncating them. */
  setVolume: (target: number, fadeMs?: number) => void;
};

/**
 * Play a sample file from /public. Fire-and-forget by default.
 *
 * @param url          File URL.
 * @param volume       0..1.
 * @param offset       Seconds to skip at the start.
 * @param duration     Optional max seconds to play.
 * @param reverbSend   0..1, amount sent to the shared reverb bus. >0 makes
 *                     the sample linger with a ~3.6s tail. Stack across
 *                     multiple plays for a wash.
 */
export function playSample(
  url: string,
  volume = 1,
  offset = 0,
  duration?: number,
  reverbSend = 0,
): SampleHandle {
  const c = ensureContext();
  // Even if context isn't ready, return a no-op handle so callers don't
  // have to null-check.
  const noop: SampleHandle = { stop: () => {}, setVolume: () => {} };
  if (!c || !masterGain) return noop;

  let stopped = false;
  let src: AudioBufferSourceNode | null = null;
  let g: GainNode | null = null;

  loadSample(url).then((buf) => {
    if (stopped || !buf || !c || !masterGain) return;
    src = c.createBufferSource();
    src.buffer = buf;
    g = c.createGain();
    g.gain.value = volume;
    src.connect(g).connect(masterGain);
    // Reverb send: parallel branch through the shared convolver bus.
    if (reverbSend > 0) {
      const bus = getReverbBus(c, masterGain);
      if (bus) {
        const send = c.createGain();
        send.gain.value = reverbSend * volume;
        g.connect(send).connect(bus);
      }
    }
    const safeOffset = Math.max(0, Math.min(offset, buf.duration - 0.01));
    src.start(0, safeOffset);
    if (duration && duration > 0) {
      // Schedule a short fade + stop at offset+duration so the cut
      // doesn't click. 60ms tail blends naturally into silence.
      const now = c.currentTime;
      const tailStart = now + duration;
      const tailEnd = tailStart + 0.06;
      g.gain.setValueAtTime(volume, tailStart);
      g.gain.linearRampToValueAtTime(0.0001, tailEnd);
      try {
        src.stop(tailEnd + 0.02);
      } catch {
        // Already scheduled — ignore.
      }
    }
  });

  return {
    stop: (fadeMs = 60) => {
      stopped = true;
      if (!c || !src || !g) return;
      const now = c.currentTime;
      const end = now + fadeMs / 1000;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0.0001, end);
        src.stop(end + 0.02);
      } catch {
        // Already stopped — ignore.
      }
    },
    setVolume: (target: number, fadeMs = 200) => {
      if (!c || !g) return;
      const now = c.currentTime;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + fadeMs / 1000);
      } catch {
        // Buffer not ready yet — the loadSample().then(...) above will
        // pick up the volume when it materializes. Best-effort here.
      }
    },
  };
}

/** Optional: warm the cache so the first playback has no fetch latency. */
export function preloadSample(url: string): void {
  loadSample(url);
}

/**
 * Play a sample on infinite loop. Returns a handle with `stop(fadeMs)`.
 * Used for ambient beds — the loop will gracefully fade out instead of
 * cutting off when stopped.
 *
 * @param url
 * @param volume
 * @param tameTransients  When true, inserts a DynamicsCompressorNode in
 *                        the chain that aggressively ducks loud peaks
 *                        relative to the bed (e.g. the bells baked into
 *                        ambiencesound.mp3). Bed level stays normal,
 *                        peaks get compressed down ~12dB.
 */
export function playSampleLoop(
  url: string,
  volume = 1,
  tameTransients = false,
): SampleHandle {
  const c = ensureContext();
  const noop: SampleHandle = { stop: () => {} };
  if (!c || !masterGain) return noop;

  let stopped = false;
  let src: AudioBufferSourceNode | null = null;
  let g: GainNode | null = null;

  loadSample(url).then((buf) => {
    if (stopped || !buf || !c || !masterGain) return;
    src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    g = c.createGain();
    // Fade in over 600ms so entering the route doesn't slam in.
    const now = c.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(volume, now + 0.6);

    let tail: AudioNode = g;
    if (tameTransients) {
      // Compressor: anything louder than -28dB gets squished hard.
      // The quiet bed sits below threshold and passes through clean.
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -28;
      comp.knee.value = 6;
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.18;
      g.connect(comp);
      tail = comp;
    }
    tail.connect(masterGain);
    src.connect(g);
    src.start();
  });

  return {
    stop: (fadeMs = 500) => {
      stopped = true;
      if (!c || !src || !g) return;
      const now = c.currentTime;
      const end = now + fadeMs / 1000;
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0.0001, end);
        src.stop(end + 0.05);
      } catch {
        // Already stopped.
      }
    },
  };
}

// -----------------------------------------------------------------------------
// Ambient bed — 5 detuned oscillators (A1 root + fifths + octaves) into a
// low-pass filter whose cutoff sweeps slowly, plus a volume-breath LFO, plus
// occasional pentatonic bell chimes fired on a timer. Creates constant slow
// movement instead of one flat tone.
// -----------------------------------------------------------------------------

type AmbientHandle = {
  stop: () => void;
};
let ambient: AmbientHandle | null = null;
// When set, startAmbient() becomes a no-op. Routes that own their own
// ambient (e.g. /title using a sample loop) suspend the synth bed so a
// later RouteNav unlock can't re-start it underneath them.
let ambientSuspended = false;

function centsToFreqMul(cents: number) {
  return Math.pow(2, cents / 1200);
}

/** Short bell-like chime — sine with fast exponential decay. Played on top
    of the drone at pentatonic intervals for sparkle. */
function spawnChime(c: AudioContext, dest: AudioNode, freq: number, volume: number) {
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(volume, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
  osc.connect(g).connect(dest);
  osc.start(now);
  osc.stop(now + 2.6);
}

export function startAmbient() {
  const c = ensureContext();
  if (!c || !masterGain || ambient) return;
  if (c.state === "suspended") return;
  if (ambientSuspended) return;

  // --- Main bed gain + fade-in ---
  const bed = c.createGain();
  bed.gain.value = 0;

  // --- Low-pass filter with slow cutoff sweep ---
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 650;
  filter.Q.value = 0.8;

  // Filter sweep LFO — modulates cutoff between ~400 and ~1200 Hz.
  const filterLfo = c.createOscillator();
  filterLfo.type = "sine";
  filterLfo.frequency.value = 0.045; // ~22s period
  const filterLfoGain = c.createGain();
  filterLfoGain.gain.value = 400;
  filterLfo.connect(filterLfoGain).connect(filter.frequency);

  // --- 5 detuned oscillators so the harmonics beat against each other. ---
  const osc1 = c.createOscillator();
  osc1.type = "sine";
  osc1.frequency.value = 55; // A1
  const osc2 = c.createOscillator();
  osc2.type = "sine";
  osc2.frequency.value = 55 * centsToFreqMul(-7); // slight detune → beating
  const osc3 = c.createOscillator();
  osc3.type = "triangle";
  osc3.frequency.value = 82.4; // E2
  const osc4 = c.createOscillator();
  osc4.type = "sine";
  osc4.frequency.value = 110 * centsToFreqMul(5); // A2 +5c
  const osc5 = c.createOscillator();
  osc5.type = "sine";
  osc5.frequency.value = 164.8; // E3 (quieter)

  // Individual per-osc gains so we can balance them.
  const mk = (level: number) => {
    const g = c.createGain();
    g.gain.value = level;
    return g;
  };
  const g1 = mk(0.25);
  const g2 = mk(0.18);
  const g3 = mk(0.16);
  const g4 = mk(0.12);
  const g5 = mk(0.06);

  osc1.connect(g1).connect(filter);
  osc2.connect(g2).connect(filter);
  osc3.connect(g3).connect(filter);
  osc4.connect(g4).connect(filter);
  osc5.connect(g5).connect(filter);

  filter.connect(bed).connect(masterGain);

  // Volume-breath LFO on the bed (0.07 Hz, ±0.025).
  const breathLfo = c.createOscillator();
  breathLfo.type = "sine";
  breathLfo.frequency.value = 0.07;
  const breathLfoGain = c.createGain();
  breathLfoGain.gain.value = 0.025;
  breathLfo.connect(breathLfoGain).connect(bed.gain);

  [osc1, osc2, osc3, osc4, osc5, filterLfo, breathLfo].forEach((n) => n.start());

  // Fade in smoothly.
  const now0 = c.currentTime;
  bed.gain.setValueAtTime(0, now0);
  bed.gain.linearRampToValueAtTime(0.065, now0 + 2.0);

  // --- Occasional chimes — A minor pentatonic (A, C, D, E, G) at octaves 5–6.
  const CHIME_BASE_FREQS = [
    440,      // A4
    523.25,   // C5
    587.33,   // D5
    659.25,   // E5
    783.99,   // G5
    880,      // A5
    1046.5,   // C6
  ];
  const chimeBus = c.createGain();
  chimeBus.gain.value = 0.045;
  chimeBus.connect(masterGain);
  let chimeTimer: number | null = null;
  const scheduleChime = () => {
    const wait = 9000 + Math.random() * 8000; // 9–17s
    chimeTimer = window.setTimeout(() => {
      const f = CHIME_BASE_FREQS[Math.floor(Math.random() * CHIME_BASE_FREQS.length)];
      const detune = 1 + (Math.random() - 0.5) * 0.002;
      spawnChime(c, chimeBus, f * detune, 0.8);
      scheduleChime();
    }, wait);
  };
  scheduleChime();

  ambient = {
    stop: () => {
      const now = c.currentTime;
      bed.gain.cancelScheduledValues(now);
      bed.gain.linearRampToValueAtTime(0, now + 0.6);
      if (chimeTimer !== null) window.clearTimeout(chimeTimer);
      // Hard-mute the chime bus immediately so any in-flight chime
      // (already-spawned, fade-tail still ringing) is silenced. Without
      // this the elevator-music ding could still leak through after
      // suspendAmbient was called.
      try {
        chimeBus.gain.cancelScheduledValues(now);
        chimeBus.gain.setValueAtTime(0, now);
        chimeBus.disconnect();
      } catch {
        // Already disconnected — ignore.
      }
      window.setTimeout(() => {
        try {
          [osc1, osc2, osc3, osc4, osc5, filterLfo, breathLfo].forEach((n) => n.stop());
        } catch {
          // already stopped
        }
      }, 700);
    },
  };
}

export function stopAmbient() {
  if (!ambient) return;
  ambient.stop();
  ambient = null;
}

/** Hard-suspend the synth ambient bed: stops it if running, AND blocks
 *  future startAmbient() calls until resumeAmbient() is called. Used by
 *  routes with their own ambient bed. */
export function suspendAmbient() {
  ambientSuspended = true;
  stopAmbient();
}

/** Lift the suspend so other routes can run the synth ambient again. */
export function resumeAmbient() {
  ambientSuspended = false;
}

// -----------------------------------------------------------------------------
// Looped voices — keep nodes around so we can retune volume every frame
// -----------------------------------------------------------------------------

type LoopHandle = {
  gain: GainNode;
  stop: () => void;
};
const loops: Record<string, LoopHandle | null> = {};

/** Start (or return existing) CRT hum loop. Call once; use setLoopVolume
    to modulate gain based on camera distance. Idempotent. */
export function startLoop(name: "contact-crt-hum"): LoopHandle | null {
  const c = ensureContext();
  if (!c || !masterGain) return null;
  if (loops[name]) return loops[name];
  if (name === "contact-crt-hum") {
    // Electrical BUZZ — sawtooth at 120 Hz (rectified mains harmonic)
    // through a narrow bandpass in the 400–800 Hz zone to focus the
    // buzz register. AM tremolo at 60 Hz gives it the classic
    // transformer/fluorescent-ballast "bzzzzzt" character instead of
    // the cinematic drone feel.
    const bus = c.createGain();
    bus.gain.value = 0;
    bus.connect(masterGain);
    // Main sawtooth buzz
    const saw = c.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.value = 120;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 2.5;
    const sg = c.createGain();
    sg.gain.value = 0.35;
    saw.connect(bp).connect(sg).connect(bus);
    saw.start();
    // AM tremolo — LFO modulating the sawtooth's gain so it "buzzes"
    const trem = c.createOscillator();
    trem.type = "sine";
    trem.frequency.value = 60;
    const tremGain = c.createGain();
    tremGain.gain.value = 0.4; // depth
    trem.connect(tremGain).connect(sg.gain);
    trem.start();
    // Small 60 Hz body — just to give it some pitched weight, no sub
    const body = c.createOscillator();
    body.type = "sine";
    body.frequency.value = 60;
    const bodyG = c.createGain();
    bodyG.gain.value = 0.12;
    body.connect(bodyG).connect(bus);
    body.start();
    const handle: LoopHandle = {
      gain: bus,
      stop: () => {
        try { saw.stop(); trem.stop(); body.stop(); } catch {}
      },
    };
    loops[name] = handle;
    return handle;
  }
  return null;
}

export function setLoopVolume(
  name: "contact-crt-hum",
  v: number,
) {
  const h = loops[name];
  if (!h) return;
  h.gain.gain.value = Math.max(0, Math.min(1, v));
}

export function stopLoop(name: "contact-crt-hum") {
  const h = loops[name];
  if (!h) return;
  h.stop();
  loops[name] = null;
}

/** Fire-and-forget play. Safe to call in render/effect hot paths. */
export function playSound(name: SoundName, volume = 1) {
  const c = ensureContext();
  if (!c || !masterGain) return;
  if (c.state === "suspended") return; // Audio locked — need user gesture first.

  const now = c.currentTime;
  const v = Math.max(0, Math.min(1, volume));

  switch (name) {
    case "clack": {
      // Hard obsidian clack — short noise burst + low thonk.
      const dur = 0.08;
      const noise = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const src = c.createBufferSource();
      src.buffer = noise;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800 + Math.random() * 800;
      bp.Q.value = 2.4;
      const g = c.createGain();
      g.gain.setValueAtTime(v * 0.9, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(bp).connect(g).connect(masterGain);
      src.start(now);
      src.stop(now + dur);

      // Sub-thonk body
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(120 + Math.random() * 40, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
      const og = c.createGain();
      og.gain.setValueAtTime(v * 0.35, now);
      og.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      osc.connect(og).connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.14);
      break;
    }
    case "whoosh": {
      // Filtered noise sweep — cursor click "push".
      const dur = 0.28;
      const noise = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = noise;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(400, now);
      bp.frequency.exponentialRampToValueAtTime(1600, now + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(v * 0.4, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(bp).connect(g).connect(masterGain);
      src.start(now);
      src.stop(now + dur);
      break;
    }
    case "ding": {
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      const g = c.createGain();
      g.gain.setValueAtTime(v * 0.25, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      osc.connect(g).connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.5);
      break;
    }
    case "thud": {
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(90, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);
      const g = c.createGain();
      g.gain.setValueAtTime(v * 0.6, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(g).connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.24);
      break;
    }

    // --- Orb-specific impact sounds (one per shape) ---

    case "orb-pop": {
      // Sphere — short bouncy pop. Sine pitched down quickly.
      const dur = 0.14;
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(460, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(v * 0.55, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g).connect(masterGain);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      break;
    }

    case "orb-knock": {
      // Cube — wooden knock (band-passed noise + low thump body).
      const dur = 0.1;
      const noise = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      }
      const src = c.createBufferSource();
      src.buffer = noise;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 280;
      bp.Q.value = 5;
      const g = c.createGain();
      g.gain.setValueAtTime(v * 0.8, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.connect(bp).connect(g).connect(masterGain);
      src.start(now);
      src.stop(now + dur + 0.01);
      // Low body thump
      const body = c.createOscillator();
      body.type = "sine";
      body.frequency.setValueAtTime(160, now);
      body.frequency.exponentialRampToValueAtTime(80, now + 0.08);
      const bg = c.createGain();
      bg.gain.setValueAtTime(v * 0.4, now);
      bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      body.connect(bg).connect(masterGain);
      body.start(now);
      body.stop(now + 0.12);
      break;
    }

    case "orb-ping": {
      // Octahedron — high crystal ping (two sines, harmonic).
      const dur = 0.35;
      const freqs: Array<[number, number]> = [
        [1250, 0.35],
        [1875, 0.18],
      ];
      for (const [f, amp] of freqs) {
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(v * amp, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(g).connect(masterGain);
        osc.start(now);
        osc.stop(now + dur + 0.02);
      }
      break;
    }

    case "orb-chime": {
      // Icosahedron — bright three-tone bell (fundamental + 3rd + 5th).
      const dur = 0.55;
      const freqs: Array<[number, number]> = [
        [880, 0.4],
        [1320, 0.26],
        [1760, 0.14],
      ];
      for (const [f, amp] of freqs) {
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(v * amp, now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        osc.connect(g).connect(masterGain);
        osc.start(now);
        osc.stop(now + dur + 0.02);
      }
      break;
    }

    case "orb-wobble": {
      // Torus — vibrato wobble (sine with fast LFO on frequency).
      const dur = 0.32;
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, now);
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 13;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 35;
      lfo.connect(lfoGain).connect(osc.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(v * 0.42, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g).connect(masterGain);
      osc.start(now);
      lfo.start(now);
      osc.stop(now + dur + 0.02);
      lfo.stop(now + dur + 0.02);
      break;
    }

    case "orb-thump": {
      // Dodecahedron — dense pitched-down thump (triangle + noise click).
      const dur = 0.2;
      const osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(115, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.15);
      const g = c.createGain();
      g.gain.setValueAtTime(v * 0.7, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g).connect(masterGain);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      // Noise transient at front
      const nb = c.createBuffer(1, c.sampleRate * 0.02, c.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = c.createBufferSource();
      ns.buffer = nb;
      const ng = c.createGain();
      ng.gain.setValueAtTime(v * 0.22, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
      ns.connect(ng).connect(masterGain);
      ns.start(now);
      ns.stop(now + 0.03);
      break;
    }
    case "phone-key": {
      // DTMF-like tone pair — two sines summed with a quick envelope.
      const dur = 0.14;
      const low = 770 + Math.random() * 60;
      const high = 1336 + Math.random() * 60;
      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      o1.type = "sine";
      o2.type = "sine";
      o1.frequency.value = low;
      o2.frequency.value = high;
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(v * 0.5, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o1.connect(g);
      o2.connect(g);
      g.connect(masterGain);
      o1.start(now); o2.start(now);
      o1.stop(now + dur + 0.02); o2.stop(now + dur + 0.02);
      break;
    }
    case "phone-dial": {
      // Continuous dial tone — 350 Hz + 440 Hz, 1-second loop.
      const dur = 1.0;
      const o1 = c.createOscillator();
      const o2 = c.createOscillator();
      o1.type = "sine"; o2.type = "sine";
      o1.frequency.value = 350;
      o2.frequency.value = 440;
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(v * 0.25, now + 0.05);
      g.gain.linearRampToValueAtTime(0, now + dur);
      o1.connect(g); o2.connect(g);
      g.connect(masterGain);
      o1.start(now); o2.start(now);
      o1.stop(now + dur); o2.stop(now + dur);
      break;
    }
    case "phone-hang": {
      // Short click.
      const dur = 0.06;
      const nb = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
      const ns = c.createBufferSource();
      ns.buffer = nb;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 2200;
      bp.Q.value = 4;
      const g = c.createGain();
      g.gain.value = v * 0.6;
      ns.connect(bp).connect(g).connect(masterGain);
      ns.start(now);
      ns.stop(now + dur);
      break;
    }
    case "crt-on": {
      // Power-on: high whine that descends quickly + a soft click at start.
      const dur = 0.55;
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(6000, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + dur * 0.6);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1500;
      bp.Q.value = 3;
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(v * 0.3, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(bp).connect(g).connect(masterGain);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      // Soft click transient
      const nb = c.createBuffer(1, c.sampleRate * 0.02, c.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = c.createBufferSource();
      ns.buffer = nb;
      const ng = c.createGain();
      ng.gain.value = v * 0.35;
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
      ns.connect(ng).connect(masterGain);
      ns.start(now);
      ns.stop(now + 0.03);
      break;
    }
    case "crt-off": {
      // Collapse-to-dot: descending pitch + noise hiss fading.
      const dur = 0.35;
      const osc = c.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(900, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(v * 0.25, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(g).connect(masterGain);
      osc.start(now);
      osc.stop(now + dur + 0.02);
      break;
    }
    case "type-key": {
      // Short, slightly-varied keyboard tick — bandpass noise burst.
      const dur = 0.035;
      const nb = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
      const ns = c.createBufferSource();
      ns.buffer = nb;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 3200 + Math.random() * 800;
      bp.Q.value = 3;
      const g = c.createGain();
      g.gain.value = v * 0.4;
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      ns.connect(bp).connect(g).connect(masterGain);
      ns.start(now);
      ns.stop(now + dur + 0.01);
      break;
    }
    case "win98-click": {
      // Short filtered click — UI button press.
      const dur = 0.05;
      const nb = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
      const ns = c.createBufferSource();
      ns.buffer = nb;
      const bp = c.createBiquadFilter();
      bp.type = "highpass";
      bp.frequency.value = 2500;
      const g = c.createGain();
      g.gain.value = v * 0.5;
      ns.connect(bp).connect(g).connect(masterGain);
      ns.start(now);
      ns.stop(now + dur);
      break;
    }
    case "phantom-whisper": {
      // Soft airy whisper — filtered noise with a fast-in slow-out envelope
      // and a quick pitch wobble on the bandpass. Randomized tone so each
      // cloud sounds slightly different when the cursor brushes it.
      const dur = 0.45;
      const nb = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      const ns = c.createBufferSource();
      ns.buffer = nb;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      const center = 900 + Math.random() * 1800;
      bp.frequency.setValueAtTime(center, now);
      bp.frequency.exponentialRampToValueAtTime(
        center * (0.6 + Math.random() * 0.6),
        now + dur,
      );
      bp.Q.value = 4 + Math.random() * 3;
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(v * 0.28, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      ns.connect(bp).connect(g).connect(masterGain);
      ns.start(now);
      ns.stop(now + dur + 0.02);
      break;
    }
    case "flicker": {
      // Light-switch flicker — pure mechanical click sequence, no fizz,
      // no buzz. Just the sound of a relay/contact making and breaking
      // at uneven intervals, like a light being flipped rapidly off and
      // on. Clicks vary in brightness and timing so no flicker sounds
      // the same.
      const mg = masterGain;
      const click = (at: number, level: number, bright: number) => {
        const d = 0.022;
        const nb = c.createBuffer(1, c.sampleRate * d, c.sampleRate);
        const nd = nb.getChannelData(0);
        for (let i = 0; i < nd.length; i++) {
          nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
        }
        const ns = c.createBufferSource();
        ns.buffer = nb;
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = bright;
        bp.Q.value = 2.5;
        const g = c.createGain();
        g.gain.value = v * level;
        ns.connect(bp).connect(g).connect(mg);
        ns.start(now + at);
        ns.stop(now + at + d + 0.005);
      };
      // Random click count + offsets so no two flickers sound identical.
      const n = 3 + Math.floor(Math.random() * 4); // 3..6 clicks
      let at = 0;
      for (let i = 0; i < n; i++) {
        const level = 0.45 + Math.random() * 0.35;
        const bright = 2200 + Math.random() * 1000;
        click(at, level, bright);
        at += 0.07 + Math.random() * 0.22;
      }
      break;
    }
    case "win98-ding": {
      // Three-note success stinger — pure sines, ascending major triad.
      const freqs = [523.25, 659.25, 783.99]; // C5 E5 G5
      freqs.forEach((f, i) => {
        const start = now + i * 0.1;
        const osc = c.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(v * 0.35, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
        osc.connect(g).connect(masterGain!);
        osc.start(start);
        osc.stop(start + 0.4);
      });
      break;
    }
    case "alien": {
      // Alien speech burst — filtered white noise warbling through a ring-
      // modulator-ish detuned sine, plus a wobble LFO on filter cutoff.
      // Sounds garbled-organic.
      const dur = 4.0;
      const nb = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const nd = nb.getChannelData(0);
      for (let i = 0; i < nd.length; i++) {
        // Bursty envelope — silence between syllables, so it sounds
        // like speech rather than a continuous buzz.
        const t = i / c.sampleRate;
        const syllable = Math.max(0, Math.sin(t * 7 + Math.sin(t * 2.3) * 2));
        nd[i] = (Math.random() * 2 - 1) * syllable;
      }
      const ns = c.createBufferSource();
      ns.buffer = nb;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 800;
      bp.Q.value = 8;
      // LFO sweeping the bandpass frequency — that's what makes it warble
      // and sound like alien vowel-forming.
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 4.5;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 600;
      lfo.connect(lfoGain).connect(bp.frequency);
      // Ring-mod-ish detune partner
      const ring = c.createOscillator();
      ring.type = "sine";
      ring.frequency.value = 180;
      const ringGain = c.createGain();
      ringGain.gain.value = 0.4;
      const g = c.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(v * 0.55, now + 0.2);
      g.gain.setValueAtTime(v * 0.55, now + dur - 0.3);
      g.gain.linearRampToValueAtTime(0, now + dur);
      ns.connect(bp).connect(g).connect(masterGain);
      ring.connect(ringGain).connect(g);
      ns.start(now);
      lfo.start(now);
      ring.start(now);
      ns.stop(now + dur);
      lfo.stop(now + dur);
      ring.stop(now + dur);
      break;
    }
  }
}
