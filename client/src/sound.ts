/**
 * Fight sounds synthesised with Web Audio, so they add nothing to the download. Browsers only
 * start audio after a key press, so the context starts on the first one. M mutes.
 */

let ctx: AudioContext | null = null;
let master: GainNode;
let noise: AudioBuffer;
let muted = false;

export const toggleMute = () => {
  muted = !muted;
  if (ctx) {
    master.gain.value = muted ? 0 : 0.5;
  }
};

addEventListener("keydown", (e) => {
  if (e.code === "KeyM" && !e.repeat) {
    toggleMute();
  }
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) {
      d[i] = Math.random() * 2 - 1;
    }
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
});

export const isMuted = () => muted;

const ready = () => (ctx && ctx.state === "running" && !muted ? ctx : null);

const envelope = (
  c: AudioContext,
  gain: number,
  at: number,
  attack: number,
  dur: number
) => {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(master);
  return g;
};

/** A pitched tone that glides from `from` to `to` hertz. */
export const tone = (
  type: OscillatorType,
  from: number,
  to: number,
  dur: number,
  gain: number,
  delay = 0,
  attack = 0.005
) => {
  const c = ready();
  if (!c) {
    return;
  }
  const at = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + dur);
  o.connect(envelope(c, gain, at, attack, dur));
  o.start(at);
  o.stop(at + dur + 0.05);
};

/** Filtered noise: low `freq` for thumps and rumbles, high for hiss and crackle. */
export const hiss = (
  filter: BiquadFilterType,
  freq: number,
  dur: number,
  gain: number,
  delay = 0
) => {
  const c = ready();
  if (!c) {
    return;
  }
  const at = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  src.connect(f).connect(envelope(c, gain, at, 0.004, dur));
  src.start(at, Math.random() * 0.5);
  src.stop(at + dur + 0.05);
};

/** Gain for a sound `dist` metres from the listening diver: full nearby, silent past about 16 m. */
export const near = (dist: number) => Math.max(0, Math.min(1, 1.2 - dist / 14));

/** How loud a sound at a point is for the listening diver: by distance, or full when it has no place. */
export type Loudness = (p?: ArrayLike<number>) => number;

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14];

export const sound = {
  /** Something bit or shocked a diver; louder when it is you. */
  hurt(v = 1) {
    tone("sine", 150, 45, 0.22, 0.6 * v);
    hiss("lowpass", 700, 0.14, 0.35 * v);
  },
  harpoon(v = 1) {
    tone("triangle", 900, 260, 0.09, 0.25 * v);
    hiss("bandpass", 2400, 0.05, 0.25 * v);
    tone("square", 330, 300, 0.08, 0.08 * v, 0.05);
    hiss("highpass", 4000, 0.06, 0.12 * v, 0.05);
  },
  shock(v = 1) {
    tone("sawtooth", 240, 70, 0.35, 0.18 * v);
    hiss("highpass", 3500, 0.3, 0.2 * v);
  },
  /** One soft chime while calming, rising through the scale as the animal settles. */
  soothe(meter: number, v = 1) {
    const step =
      PENTATONIC[
        Math.min(PENTATONIC.length - 1, Math.floor(meter * PENTATONIC.length))
      ];
    tone(
      "sine",
      392 * 2 ** (step / 12),
      392 * 2 ** (step / 12),
      0.9,
      0.12 * v,
      0,
      0.04
    );
  },
  calmed(v = 1) {
    for (const [i, f] of [523.25, 659.25, 783.99, 1046.5].entries()) {
      tone("sine", f, f, 1.6, 0.13 * v, i * 0.09, 0.03);
    }
  },
  wrecked(v = 1) {
    tone("sawtooth", 320, 40, 0.8, 0.16 * v);
    hiss("lowpass", 900, 0.7, 0.4 * v);
  },
  down() {
    tone("sine", 440, 160, 0.7, 0.25);
  },
  revived() {
    tone("sine", 392, 392, 0.35, 0.18);
    tone("sine", 587.33, 587.33, 0.6, 0.18, 0.14);
  },
  /** A find goes into the bag: a pluck and a clink, with a rising run for fossils and evidence. */
  bagged(v = 1, rare = false) {
    tone("triangle", 660, 990, 0.07, 0.2 * v);
    tone("sine", 1318.5, 1318.5, 0.4, 0.12 * v, 0.06);
    if (rare) {
      for (const [i, f] of [783.99, 987.77, 1174.66, 1567.98].entries()) {
        tone("sine", f, f, 1.4, 0.1 * v, 0.12 + i * 0.07, 0.02);
      }
    }
  },
  /** Stone grinding while two divers work a fossil loose. */
  scrape(v = 1) {
    hiss("bandpass", 380 + Math.random() * 220, 0.25, 0.25 * v);
    tone("sawtooth", 72, 55, 0.2, 0.04 * v);
  },
  /** A fossil cracks free of the rock. */
  pried(v = 1) {
    hiss("lowpass", 1400, 0.25, 0.5 * v);
    tone("sine", 120, 55, 0.3, 0.3 * v);
    for (const [i, f] of [523.25, 659.25, 783.99, 1046.5, 1318.5].entries()) {
      tone("sine", f, f, 1.8, 0.1 * v, 0.2 + i * 0.08, 0.02);
    }
  },
  /** Something falls from a wreck to the floor. */
  dropped(v = 1) {
    tone("sine", 190, 60, 0.4, 0.3 * v);
    hiss("lowpass", 500, 0.3, 0.3 * v);
  },
  /** A bag's unlogged finds are lost. */
  returned() {
    for (const [i, f] of [523.25, 466.16, 392].entries()) {
      tone("sine", f, f, 0.6, 0.14, i * 0.16, 0.02);
    }
  },
  /** Climbing out at the station: a splash and the station's bell. */
  aboard() {
    hiss("bandpass", 900, 0.5, 0.35);
    hiss("lowpass", 300, 0.7, 0.3, 0.05);
    tone("sine", 880, 880, 2.2, 0.16, 0.3, 0.003);
    tone("sine", 2217, 2217, 1.1, 0.05, 0.3, 0.003);
  },
  /** One find written into the log: a pen stroke and a chime. */
  logged(rare = false) {
    hiss("highpass", 3000, 0.12, 0.12);
    tone(
      "sine",
      rare ? 1046.5 : 783.99,
      rare ? 1046.5 : 783.99,
      0.7,
      0.1,
      0.08,
      0.01
    );
  },
  /** Going back in the water. */
  dived() {
    hiss("bandpass", 700, 0.6, 0.35);
    tone("sine", 300, 120, 0.5, 0.1);
  },
};
