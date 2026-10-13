// Audio analysis for "Remove pauses" and "Auto Shorts". The math here is pure;
// the decode* functions are the only ones that need a browser.

export const WIN = 0.05; // seconds per loudness window

export function rmsWindows(samples, sampleRate, win = WIN) {
  const size = Math.max(1, Math.round(sampleRate * win));
  const n = Math.floor(samples.length / size);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const o = i * size;
    for (let j = 0; j < size; j++) sum += samples[o + j] * samples[o + j];
    out[i] = Math.sqrt(sum / size);
  }
  return out;
}

function percentile(arr, q) {
  if (!arr.length) return 0;
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

// Adaptive threshold: a bit above the noise floor, relative to loud speech.
export function silenceThreshold(rms) {
  const floor = percentile(rms, 0.1);
  const peak = percentile(rms, 0.95);
  return Math.max(0.005, floor + (peak - floor) * 0.12);
}

export function findSilences(rms, win = WIN, { threshold, minDur = 0.6 } = {}) {
  const th = threshold ?? silenceThreshold(rms);
  const out = [];
  let start = -1;
  for (let i = 0; i <= rms.length; i++) {
    const quiet = i < rms.length && rms[i] < th;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      if ((i - start) * win >= minDur) out.push({ start: +(start * win).toFixed(3), end: +(i * win).toFixed(3) });
      start = -1;
    }
  }
  return out;
}

// Parts of [inT, outT] that are not silent. A little padding is kept around
// speech so words are not clipped.
export function keepRanges(silences, inT, outT, { pad = 0.1, minKeep = 0.25 } = {}) {
  const keep = [];
  let cur = inT;
  for (const s of silences) {
    const a = Math.max(inT, s.start + pad);
    const b = Math.min(outT, s.end - pad);
    if (b <= a) continue;
    if (a > cur) keep.push({ start: cur, end: a });
    cur = Math.max(cur, b);
  }
  if (outT > cur) keep.push({ start: cur, end: outT });
  return keep
    .filter((r) => r.end - r.start >= minKeep)
    .map((r) => ({ start: +r.start.toFixed(3), end: +r.end.toFixed(3) }));
}

// Pick the `count` non-overlapping windows of `length` seconds with the most
// sustained energy (speech, music, action). Returned in timeline order.
export function findHighlights(rms, win = WIN, { length = 30, count = 3, inT = 0, outT } = {}) {
  const end = outT ?? rms.length * win;
  const span = Math.round(length / win);
  const lo = Math.floor(inT / win);
  const hi = Math.min(rms.length, Math.floor(end / win));
  if (hi - lo <= span) return [{ start: inT, end, score: 1 }];
  const th = silenceThreshold(rms);
  // Score = average loudness + bonus for the share of non-silent windows.
  const val = (i) => rms[i] + (rms[i] > th ? th : 0);
  let sum = 0;
  for (let i = lo; i < lo + span; i++) sum += val(i);
  const scores = [];
  const step = Math.max(1, Math.round(1 / win)); // evaluate every second
  for (let i = lo; i + span <= hi; i++) {
    if (i > lo) sum += val(i + span - 1) - val(i - 1);
    if ((i - lo) % step === 0) scores.push({ i, score: sum / span });
  }
  scores.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const s of scores) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.abs(p.i - s.i) >= span)) picked.push(s);
  }
  const max = picked[0]?.score || 1;
  return picked
    .sort((a, b) => a.i - b.i)
    .map((p) => ({ start: +(p.i * win).toFixed(3), end: +((p.i + span) * win).toFixed(3), score: +(p.score / max).toFixed(2) }));
}

// Beat / onset detection: positive changes of short-window energy, peak-picked
// against a moving average, at least `minGap` seconds apart.
export function detectBeats(pcm, sampleRate, { minGap = 0.3 } = {}) {
  const hop = 0.01;
  const env = rmsWindows(pcm, sampleRate, hop);
  const flux = new Float32Array(env.length);
  for (let i = 1; i < env.length; i++) flux[i] = Math.max(0, env[i] - env[i - 1]);
  const W = 50; // 0.5 s moving window
  const beats = [];
  let sum = 0;
  for (let i = 0; i < flux.length; i++) {
    sum += flux[i] - (i >= W ? flux[i - W] : 0);
    const mean = sum / Math.min(i + 1, W);
    const isPeak = flux[i] > mean * 1.8 && flux[i] > 0.01 && flux[i] >= (flux[i - 1] ?? 0) && flux[i] >= (flux[i + 1] ?? 0);
    const t = i * hop;
    if (isPeak && (!beats.length || t - beats.at(-1) >= minGap)) beats.push(+t.toFixed(3));
  }
  return beats;
}

const pcmCache = new Map();
const loudCache = new Map();

// Decode a media blob to 16 kHz mono PCM (the format Whisper expects too).
export async function decodePcm16k(id, blob) {
  if (pcmCache.has(id)) return pcmCache.get(id);
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(1, 1, 16000);
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
  const pcm = audio.getChannelData(0);
  pcmCache.clear(); // keep memory low: only the latest file
  pcmCache.set(id, pcm);
  return pcm;
}

export async function decodeLoudness(id, blob) {
  if (loudCache.has(id)) return loudCache.get(id);
  const pcm = await decodePcm16k(id, blob);
  const res = { rms: rmsWindows(pcm, 16000), win: WIN, duration: pcm.length / 16000 };
  loudCache.set(id, res);
  return res;
}
