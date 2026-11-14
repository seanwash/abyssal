/**
 * Fight sounds synthesised with Web Audio, so they add nothing to the download. Browsers only
 * start audio after a key press, so the context starts on the first one. M mutes.
 */

let ctx: AudioContext | null = null;
let master: GainNode;
let noise: AudioBuffer;
let muted = false;

addEventListener('keydown', (e) => {
  if (e.code === 'KeyM' && !e.repeat) {
    muted = !muted;
    if (ctx) master.gain.value = muted ? 0 : 0.5;
  }
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
});

function ready() {
  return ctx && ctx.state === 'running' && !muted ? ctx : null;
}

function envelope(c: AudioContext, gain: number, at: number, attack: number, dur: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(master);
  return g;
}

/** A pitched tone that glides from `from` to `to` hertz. */
function tone(type: OscillatorType, from: number, to: number, dur: number, gain: number, delay = 0, attack = 0.005) {
  const c = ready();
  if (!c) return;
  const at = c.currentTime + delay;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + dur);
  o.connect(envelope(c, gain, at, attack, dur));
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** Filtered noise: low `freq` for thumps and rumbles, high for hiss and crackle. */
function hiss(filter: BiquadFilterType, freq: number, dur: number, gain: number, delay = 0) {
  const c = ready();
  if (!c) return;
  const at = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  src.connect(f).connect(envelope(c, gain, at, 0.004, dur));
  src.start(at, Math.random() * 0.5);
  src.stop(at + dur + 0.05);
}

/** Gain for a sound `dist` metres from the listening diver: full nearby, silent past about 16 m. */
export function near(dist: number) {
  return Math.max(0, Math.min(1, 1.2 - dist / 14));
}

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14];

export const sound = {
  /** Something bit or shocked a diver; louder when it is you. */
  hurt(v = 1) {
    tone('sine', 150, 45, 0.22, 0.6 * v);
    hiss('lowpass', 700, 0.14, 0.35 * v);
  },
  harpoon(v = 1) {
    tone('triangle', 900, 260, 0.09, 0.25 * v);
    hiss('bandpass', 2400, 0.05, 0.25 * v);
    tone('square', 330, 300, 0.08, 0.08 * v, 0.05);
    hiss('highpass', 4000, 0.06, 0.12 * v, 0.05);
  },
  shock(v = 1) {
    tone('sawtooth', 240, 70, 0.35, 0.18 * v);
    hiss('highpass', 3500, 0.3, 0.2 * v);
  },
  /** One soft chime while calming, rising through the scale as the animal settles. */
  soothe(meter: number, v = 1) {
    const step = PENTATONIC[Math.min(PENTATONIC.length - 1, Math.floor(meter * PENTATONIC.length))];
    tone('sine', 392 * 2 ** (step / 12), 392 * 2 ** (step / 12), 0.9, 0.12 * v, 0, 0.04);
  },
  calmed(v = 1) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('sine', f, f, 1.6, 0.13 * v, i * 0.09, 0.03));
  },
  wrecked(v = 1) {
    tone('sawtooth', 320, 40, 0.8, 0.16 * v);
    hiss('lowpass', 900, 0.7, 0.4 * v);
  },
  down() {
    tone('sine', 440, 160, 0.7, 0.25);
  },
  revived() {
    tone('sine', 392, 392, 0.35, 0.18);
    tone('sine', 587.33, 587.33, 0.6, 0.18, 0.14);
  },
};
