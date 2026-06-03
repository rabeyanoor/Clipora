// Scene (shot) detection: samples small frames of a video and finds the
// moments where the picture changes abruptly, i.e. camera cuts.

const W = 48;
const H = 27;

/** Difference between two frames: mean absolute luma change + colour histogram distance (0..1). */
export function frameDiff(a, b) {
  let d = 0;
  const ha = new Float32Array(48);
  const hb = new Float32Array(48);
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    d += Math.abs(a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11 - (b[i] * 0.3 + b[i + 1] * 0.59 + b[i + 2] * 0.11));
    for (let c = 0; c < 3; c++) {
      ha[c * 16 + (a[i + c] >> 4)]++;
      hb[c * 16 + (b[i + c] >> 4)]++;
    }
  }
  let h = 0;
  for (let k = 0; k < 48; k++) h += Math.abs(ha[k] - hb[k]);
  return 0.5 * (d / n / 255) + 0.5 * (h / (n * 6));
}

/**
 * Picks cut times from a series of frame differences. A cut is a difference
 * that clearly stands out from its neighbourhood (and from a floor value).
 */
export function pickCuts(diffs, times, { minGap = 1, floor = 0.12 } = {}) {
  const cuts = [];
  for (let i = 0; i < diffs.length; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, i - 8); k <= Math.min(diffs.length - 1, i + 8); k++) {
      if (k !== i) {
        sum += diffs[k];
        cnt++;
      }
    }
    const local = cnt ? sum / cnt : 0;
    if (diffs[i] > floor && diffs[i] > local * 2.5 + 0.03 && (!cuts.length || times[i] - cuts[cuts.length - 1] >= minGap)) cuts.push(times[i]);
  }
  return cuts;
}

const seekTo = (v, t) =>
  new Promise((resolve) => {
    const done = () => {
      v.removeEventListener('seeked', done);
      resolve();
    };
    v.addEventListener('seeked', done);
    v.currentTime = t;
    setTimeout(done, 1500);
  });

const cache = new Map();

/** Returns cut times (in source seconds) between inT and outT. */
export async function detectScenes(media, inT, outT, { onProgress } = {}) {
  const key = `${media.id}:${inT}:${outT}`;
  if (cache.has(key)) return cache.get(key);
  const url = URL.createObjectURL(media.blob);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise((res, rej) => {
      v.onloadeddata = res;
      v.onerror = () => rej(new Error('video decode failed'));
    });
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const span = outT - inT;
    const step = Math.max(0.2, span / 900); // at most ~900 samples
    const diffs = [];
    const times = [];
    let prev = null;
    for (let t = inT; t < outT; t += step) {
      await seekTo(v, t);
      ctx.drawImage(v, 0, 0, W, H);
      const px = ctx.getImageData(0, 0, W, H).data;
      if (prev) {
        diffs.push(frameDiff(prev, px));
        times.push(t);
      }
      prev = px;
      onProgress?.((t - inT) / span);
    }
    const cuts = pickCuts(diffs, times).filter((t) => t - inT > 0.5 && outT - t > 0.5);
    cache.set(key, cuts);
    return cuts;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
