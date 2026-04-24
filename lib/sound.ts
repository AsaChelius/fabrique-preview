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
  // Phone UX voices (contact route).
  | "phone-key"   // DTMF-ish two-tone key press
  | "phone-dial"  // dial-tone hum
  | "phone-hang"  // hangup click
  | "alien";      // alien speech burst — filtered noise + warble

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let unlocked = false;

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

/** Call once after first user interaction to unlock audio. */
export function unlockAudio() {
  const c = ensureContext();
  if (!c || unlocked) return;
  if (c.state === "suspended") c.resume();
  unlocked = true;
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
