// Fast export: renders frame by frame and encodes with the device's hardware
// encoder (WebCodecs, via mediabunny) instead of recording the canvas in real
// time. Video frames are decoded straight from the files, and the audio mix is
// rendered offline, so export runs as fast as the phone can decode + encode
// (usually 3-10x faster than playing the video).

import { clipAt, clipDuration } from './state.js';
import { gpuConverter, cpuConverter, BT709 } from './yuv.js';

// Bundled with the app (no download before the first export); CDN only as a backup.
const MB_LOCAL = new URL('./vendor/mediabunny.min.js', import.meta.url).href;
const MB_CDN = 'https://cdn.jsdelivr.net/npm/mediabunny@1.59.1/+esm';
const RATE = 48000;
const MAX_AUDIO_SECONDS = 30 * 60; // above this the offline mix would use too much memory

let mbPromise = null;
const loadMb = () => (mbPromise ??= import(MB_LOCAL).catch(() => import(MB_CDN)).catch((e) => ((mbPromise = null), Promise.reject(e))));

/** Starts downloading the encoder library early (e.g. when the export dialog opens). */
export function preloadFastExport() {
  if (fastExportSupported()) loadMb().catch(() => {});
}

export function fastExportSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof OfflineAudioContext !== 'undefined';
}

export function bitrateFor(shortSide, fps) {
  const base = shortSide >= 2160 ? 35e6 : shortSide >= 1440 ? 18e6 : shortSide >= 1080 ? 10e6 : shortSide >= 720 ? 5e6 : 2.5e6;
  return Math.round(base * (fps > 30 ? 1.5 : 1));
}

/** Frame timeline: for each output frame, which clip and source time it shows. */
export function framePlan(p, fps) {
  let total = 0;
  for (const c of p.clips) total += clipDuration(c);
  const n = Math.max(1, Math.round(total * fps));
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const at = clipAt(p, t);
    frames.push({ t, clipId: at?.clip.id, mediaId: at?.clip.mediaId, type: at?.clip.type, local: at?.local ?? 0 });
  }
  return { frames, total };
}

/**
 * Exports the project. Returns { blob, ext } or null when cancelled.
 * Throws if the device can't encode; the caller then falls back to real-time recording.
 */
export async function exportFast(engine, { W, H, fps, shortSide, onProgress = () => {}, signal, yuv = 'auto' }) {
  const tStart = performance.now();
  const MB = await loadMb();
  const p = engine.project;
  const bitrate = bitrateFor(shortSide, fps);
  if (!(await MB.canEncodeVideo('avc', { width: W, height: H, bitrate }))) throw new Error('H.264 encoder not available');
  const { frames, total } = framePlan(p, fps);
  if (total > MAX_AUDIO_SECONDS) throw new Error('Too long for fast export');

  const stats = { setup: performance.now() - tStart, audio: 0, decode: 0, draw: 0, encode: 0, frames: frames.length };
  let t0 = performance.now();
  // 1. Audio mix renders offline on the audio thread *while* the video encodes.
  const mixDone = renderAudioMix(engine, total).then((m) => ((stats.audio = performance.now() - t0), m));
  mixDone.catch(() => {});

  // 2. Output file. Frames go to the encoder as standard BT.709 limited-range
  // YUV when the GPU can convert them quickly, so colors look the same in every
  // player (gallery, WhatsApp, Instagram). Otherwise the canvas is encoded directly.
  const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
  const cfg = { codec: 'avc', bitrate, keyFrameInterval: 2, latencyMode: 'quality' };
  // yuv: 'auto' (GPU if fast) | true (always convert, GPU or CPU) | false (canvas)
  const toYuv = yuv === true ? gpuConverter(W, H) || cpuConverter(W, H) : yuv ? fastGpuConverter(engine.canvas, W, H) : null;
  stats.yuv = !!toYuv;
  const video = toYuv ? new MB.VideoSampleSource(cfg) : new MB.CanvasSource(engine.canvas, cfg);
  const addFrame = toYuv
    ? async (t, d) => {
        const s = new MB.VideoSample(toYuv(engine.canvas), { format: 'I420', codedWidth: W, codedHeight: H, timestamp: t, duration: d, colorSpace: BT709 });
        try {
          await video.add(s);
        } finally {
          s.close();
        }
      }
    : (t, d) => video.add(t, d);
  output.addVideoTrack(video, { frameRate: fps });
  // Always add a sound track (silent if needed): social apps handle that best.
  const aac = await MB.canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: RATE, bitrate: 160e3 });
  const audio = new MB.AudioBufferSource(aac ? { codec: 'aac', bitrate: 160e3 } : { codec: 'opus', bitrate: 128e3 });
  output.addAudioTrack(audio);
  await output.start();

  // 3. Decoders: one CanvasSink per video file, fed the exact timestamps each clip needs.
  const inputs = new Map();
  const sinkFor = async (mediaId) => {
    if (!inputs.has(mediaId)) {
      inputs.set(mediaId, (async () => {
        const blob = engine.els.get(mediaId)?.blob;
        if (!blob) return null;
        const input = new MB.Input({ source: new MB.BlobSource(blob), formats: MB.ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) return null;
        // Decode at most ~1.5x the output size: faster and less memory on 4K sources.
        const longOut = Math.max(W, H) * 1.5;
        const dw = track.displayWidth;
        const dh = track.displayHeight;
        const s = Math.min(1, longOut / Math.max(dw, dh));
        return new MB.CanvasSink(track, { width: Math.round((dw * s) / 2) * 2, height: Math.round((dh * s) / 2) * 2, fit: 'fill' });
      })());
    }
    return inputs.get(mediaId);
  };

  // Group consecutive frames of the same clip so each clip's frames decode in one pass.
  const runs = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const last = runs[runs.length - 1];
    if (last && last.clipId === f.clipId) last.end = i + 1;
    else runs.push({ clipId: f.clipId, mediaId: f.mediaId, type: f.type, start: i, end: i + 1 });
  }

  const overlaySinks = new Map();
  const videoOverlays = (p.overlays || []).filter((o) => o.kind === 'media' && o.type === 'video');
  for (const o of videoOverlays) overlaySinks.set(o.id, await sinkFor(o.mediaId));

  engine._frames = new Map();
  engine._snapOf = null;
  engine._lastClip = null;
  const dur = 1 / fps;
  let cancelled = false;
  try {
    for (const run of runs) {
      let iter = null;
      if (run.type === 'video') {
        const sink = await sinkFor(run.mediaId);
        if (sink) iter = sink.canvasesAtTimestamps(frames.slice(run.start, run.end).map((f) => f.local))[Symbol.asyncIterator]();
      }
      for (let i = run.start; i < run.end; i++) {
        if (signal?.aborted) {
          cancelled = true;
          break;
        }
        const f = frames[i];
        t0 = performance.now();
        if (iter) {
          const { value } = await iter.next();
          if (value) engine._frames.set(`m:${run.mediaId}`, value.canvas);
        }
        for (const o of videoOverlays) {
          const sink = overlaySinks.get(o.id);
          if (!sink || f.t < o.start || f.t >= o.end) continue;
          const d = engine.els.get(o.mediaId)?.el?.duration || Infinity;
          const w = await sink.getCanvas((f.t - o.start) % d);
          if (w) engine._frames.set(`o:${o.id}`, w.canvas);
        }
        let t1 = performance.now();
        stats.decode += t1 - t0;
        engine.time = f.t;
        engine.draw();
        t0 = performance.now();
        stats.draw += t0 - t1;
        await addFrame(f.t, dur);
        stats.encode += performance.now() - t0;
        if (i % 4 === 0) onProgress(0.98 * (i / frames.length));
      }
      t0 = performance.now();
      await iter?.return?.();
      stats.closeIter = (stats.closeIter || 0) + performance.now() - t0;
      engine._frames.delete(`m:${run.mediaId}`);
      if (cancelled) break;
    }
    if (cancelled) {
      await output.cancel();
      return null;
    }
    t0 = performance.now();
    const mix = await mixDone;
    await audio.add(mix || new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, Math.round(total * RATE)), sampleRate: RATE }));
    await output.finalize();
    stats.finalize = performance.now() - t0;
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    engine._frames = null;
  }
  onProgress(1);
  stats.total = performance.now() - tStart;
  return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), ext: 'mp4', stats };
}

/** The GPU converter, but only if it is fast on this device (else colors via canvas). */
function fastGpuConverter(canvas, W, H) {
  if (W !== canvas.width || H !== canvas.height) return null;
  const conv = gpuConverter(W, H);
  if (!conv) return null;
  try {
    conv(canvas); // warm-up (shader compile)
    const t = performance.now();
    for (let i = 0; i < 3; i++) conv(canvas);
    return (performance.now() - t) / 3 < 20 ? conv : null;
  } catch {
    return null;
  }
}

// ---------- Audio ----------

const decoded = new Map();
async function decodeMedia(engine, mediaId) {
  if (!decoded.has(mediaId)) {
    decoded.set(mediaId, (async () => {
      const blob = engine.els.get(mediaId)?.blob;
      if (!blob) return null;
      const ctx = new OfflineAudioContext(2, 1, RATE);
      try {
        return await ctx.decodeAudioData(await blob.arrayBuffer());
      } catch {
        return null; // no audio track
      }
    })());
  }
  return decoded.get(mediaId);
}
export function forgetDecoded(mediaId) {
  if (mediaId) decoded.delete(mediaId);
  else decoded.clear();
}

// Same chain as live playback: denoise band-pass, voice presence, gain → master limiter.
function chain(ctx, item, dest) {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = item.denoise ? 110 : 10;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = item.denoise ? 7500 : 22000;
  const pk = ctx.createBiquadFilter();
  pk.type = 'peaking';
  pk.frequency.value = 3000;
  pk.Q.value = 0.9;
  pk.gain.value = item.voice ? 6 : 0;
  const g = ctx.createGain();
  hp.connect(lp).connect(pk).connect(g).connect(dest);
  return { input: hp, gain: g.gain };
}

function fades(param, vol, t0, len, fadeIn, fadeOut) {
  param.setValueAtTime(fadeIn ? 0 : vol, t0);
  if (fadeIn) param.linearRampToValueAtTime(vol, t0 + Math.min(fadeIn, len));
  if (fadeOut) {
    param.setValueAtTime(vol, Math.max(t0, t0 + len - fadeOut));
    param.linearRampToValueAtTime(0, t0 + len);
  }
}

/** Mixes clip audio, music and extra audio tracks into one stereo AudioBuffer (or null if silent). */
export async function renderAudioMix(engine, total, onProgress = () => {}) {
  const p = engine.project;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * RATE)), RATE);
  const master = ctx.createGain();
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3;
  lim.knee.value = 4;
  lim.ratio.value = 20;
  lim.attack.value = 0.002;
  lim.release.value = 0.2;
  master.connect(lim).connect(ctx.destination);
  let any = false;

  // Clips
  let start = 0;
  const n = p.clips.length + 2;
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i];
    const d = clipDuration(c);
    if (c.type === 'video' && !c.muted && (c.volume ?? 1) > 0) {
      const buf = await decodeMedia(engine, c.mediaId);
      if (buf) {
        const src = ctx.createBufferSource();
        src.buffer = c.speed === 1 ? buf : stretch(ctx, buf, c.in, c.out, c.speed);
        const ch = chain(ctx, c, master);
        ch.gain.value = c.volume ?? 1;
        src.connect(ch.input);
        if (c.speed === 1) src.start(start, c.in, d);
        else src.start(start, 0, d);
        any = true;
      }
    }
    start += d;
    onProgress((i + 1) / n);
  }

  // Music (with offset, loop, fades)
  const m = p.music;
  if (m && (m.volume ?? 1) > 0) {
    const buf = await decodeMedia(engine, m.mediaId);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const ch = chain(ctx, m, master);
      fades(ch.gain, m.volume ?? 1, 0, total, m.fadeIn, m.fadeOut);
      src.connect(ch.input);
      const off = m.offset || 0;
      if (m.loop) {
        src.loop = true;
        src.start(0, off % buf.duration);
      } else if (off < buf.duration) src.start(0, off, Math.min(total, buf.duration - off));
      any = true;
    }
  }
  onProgress((n - 1) / n);

  // Extra tracks: voice-over, TTS, sound effects…
  for (const a of p.audios || []) {
    if ((a.volume ?? 1) <= 0 || a.start >= total) continue;
    const buf = await decodeMedia(engine, a.mediaId);
    if (!buf) continue;
    const len = Math.min(a.out - a.in, total - a.start);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const ch = chain(ctx, a, master);
    fades(ch.gain, a.volume ?? 1, a.start, len, a.fadeIn, a.fadeOut);
    src.connect(ch.input);
    src.start(a.start, a.in, len);
    any = true;
  }
  if (!any) return null;
  const out = await ctx.startRendering();
  onProgress(1);
  return out;
}

/**
 * Speed change that keeps the pitch (like <video>.preservesPitch), using
 * WSOLA: overlap-add short windows, each aligned to the best-matching spot.
 */
export function stretch(ctx, buf, t0, t1, speed) {
  const rate = buf.sampleRate;
  const a = Math.max(0, Math.floor(t0 * rate));
  const b = Math.min(buf.length, Math.ceil(t1 * rate));
  const inLen = b - a;
  const outLen = Math.max(1, Math.floor(inLen / speed));
  const N = 1024;
  const H = N / 2;
  const tol = 256;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).subarray(a, b));
  const mono = chans.length > 1 ? chans[0].map((v, i) => (v + chans[1][i]) / 2) : chans[0];
  const out = ctx.createBuffer(buf.numberOfChannels, outLen, rate);
  const outs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) outs.push(out.getChannelData(c));
  const norm = new Float32Array(outLen);
  let prev = 0; // input position of the previous window
  for (let o = 0; o < outLen; o += H) {
    const ideal = Math.round(o * speed);
    let best = Math.min(Math.max(0, ideal), Math.max(0, inLen - N));
    if (o > 0) {
      // Best continuation of the previous window's natural next segment.
      const nat = prev + H;
      let bestScore = -Infinity;
      const lo = Math.max(0, ideal - tol);
      const hi = Math.min(inLen - N, ideal + tol);
      for (let k = lo; k <= hi; k += 4) {
        let s = 0;
        for (let j = 0; j < N; j += 8) s += mono[k + j] * (mono[nat + j] || 0);
        if (s > bestScore) (bestScore = s), (best = k);
      }
    }
    prev = best;
    for (let j = 0; j < N && o + j < outLen; j++) {
      const w = win[j];
      for (let c = 0; c < outs.length; c++) outs[c][o + j] += (chans[c][best + j] || 0) * w;
      norm[o + j] += w;
    }
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) for (let c = 0; c < outs.length; c++) outs[c][i] /= norm[i];
  return out;
}
