// Built-in sound effects, synthesized with Web Audio (no downloads, no
// licensing issues). Each one renders offline to a WAV file.
import { encodeWav } from './ai.js';

const R = 44100;

function noise(ctx, dur) {
  const b = ctx.createBuffer(1, Math.ceil(R * dur), R);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource();
  s.buffer = b;
  return s;
}
function env(ctx, g, t0, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
}
function tone(ctx, out, type, f0, f1, t0, dur, peak = 0.6) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  env(ctx, g, t0, 0.005, peak, dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}
function swept(ctx, out, dur, f0, f1, peak = 0.7, q = 1.5) {
  const n = noise(ctx, dur);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, 0);
  f.frequency.exponentialRampToValueAtTime(f1, dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.exponentialRampToValueAtTime(peak, dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, dur);
  n.connect(f).connect(g).connect(out);
  n.start();
}

export const SFX = {
  whoosh: { dur: 0.7, make: (c, o) => swept(c, o, 0.7, 300, 3000) },
  swipe: { dur: 0.35, make: (c, o) => swept(c, o, 0.35, 2500, 600, 0.6, 2) },
  pop: { dur: 0.15, make: (c, o) => tone(c, o, 'sine', 900, 180, 0, 0.12, 0.9) },
  ding: { dur: 1.2, make: (c, o) => (tone(c, o, 'sine', 1318, 1318, 0, 1.1, 0.5), tone(c, o, 'sine', 2637, 2637, 0, 0.6, 0.15)) },
  click: { dur: 0.06, make: (c, o) => tone(c, o, 'square', 2000, 800, 0, 0.03, 0.4) },
  boom: { dur: 1.4, make: (c, o) => (tone(c, o, 'sine', 120, 35, 0, 1.3, 1), swept(c, o, 0.5, 200, 60, 0.6, 0.7)) },
  rise: { dur: 1.5, make: (c, o) => (tone(c, o, 'sawtooth', 200, 1600, 0, 1.4, 0.18), swept(c, o, 1.5, 400, 6000, 0.3)) },
  laser: { dur: 0.4, make: (c, o) => tone(c, o, 'square', 1800, 120, 0, 0.35, 0.3) },
  coin: { dur: 0.5, make: (c, o) => (tone(c, o, 'square', 988, 988, 0, 0.08, 0.25), tone(c, o, 'square', 1319, 1319, 0.08, 0.35, 0.25)) },
  notify: { dur: 0.6, make: (c, o) => (tone(c, o, 'sine', 880, 880, 0, 0.18, 0.5), tone(c, o, 'sine', 1175, 1175, 0.15, 0.4, 0.5)) },
  error: { dur: 0.5, make: (c, o) => (tone(c, o, 'square', 220, 220, 0, 0.18, 0.3), tone(c, o, 'square', 185, 185, 0.2, 0.25, 0.3)) },
  camera: { dur: 0.3, make: (c, o) => (swept(c, o, 0.08, 3000, 2000, 0.8, 0.8), tone(c, o, 'square', 1200, 400, 0.1, 0.05, 0.3), swept(c, o, 0.25, 2500, 1500, 0.5, 0.8)) },
  applause: {
    dur: 2.5,
    make: (c, o) => {
      for (let i = 0; i < 90; i++) {
        const t0 = Math.random() * 2.2;
        const n = noise(c, 0.05);
        const f = c.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1000 + Math.random() * 2000;
        const g = c.createGain();
        env(c, g, t0, 0.002, 0.25 + Math.random() * 0.3, 0.04);
        n.connect(f).connect(g).connect(o);
        n.start(t0);
      }
    },
  },
  drum: { dur: 0.5, make: (c, o) => (tone(c, o, 'sine', 160, 45, 0, 0.45, 1), swept(c, o, 0.08, 3000, 1500, 0.3)) },
};

export async function renderSfx(name) {
  const fx = SFX[name];
  const ctx = new OfflineAudioContext(1, Math.ceil(R * fx.dur), R);
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(ctx.destination);
  fx.make(ctx, out);
  const buf = await ctx.startRendering();
  return new File([encodeWav(buf.getChannelData(0), R)], `${name}.wav`, { type: 'audio/wav' });
}
