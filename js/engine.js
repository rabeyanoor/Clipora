// Playback + rendering engine. One <canvas> is used for both preview and
// export: export simply renders at a higher resolution while recording the
// canvas stream and the mixed Web Audio output.

import { clipAt, totalDuration, fadeAlpha, filterCss, gpuParams, ASPECTS, FONTS } from './state.js';
import { Gfx, hexToRgb } from './gfx.js';
import { exportFast, fastExportSupported, bitrateFor } from './fastexport.js';

const FONT = '"Noto Sans Bengali", "Hind Siliguri", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const PREVIEW_LONG_SIDE = 640;

const easeOutBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

export function canvasSize(aspect, longSide = null, shortSide = null) {
  const [aw, ah] = ASPECTS[aspect] || ASPECTS['9:16'];
  let w, h;
  if (shortSide) {
    const s = shortSide / Math.min(aw, ah);
    w = aw * s;
    h = ah * s;
  } else {
    const s = longSide / Math.max(aw, ah);
    w = aw * s;
    h = ah * s;
  }
  return [Math.round(w / 2) * 2, Math.round(h / 2) * 2];
}

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = [
    'video/mp4;codecs="avc1.640028,mp4a.40.2"',
    'video/mp4;codecs="avc1.42E028,mp4a.40.2"',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return list.find((m) => MediaRecorder.isTypeSupported(m)) || null;
}

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.project = null;
    this.time = 0;
    this.playing = false;
    this.els = new Map();
    this.audio = null;
    this.activeClipId = null;
    this.hits = [];
    this.selectedTextId = null;
    this.onTime = () => {};
    this.onEnd = () => {};
    this.blur = document.createElement('canvas');
    this.bctx = this.blur.getContext('2d');
    this.snap = document.createElement('canvas'); // last frame of the previous clip, for transitions
    this.tmp = document.createElement('canvas'); // scratch canvas (blur regions)
    this.gfx = new Gfx();
    this.tracks = new Map(); // extra media elements: audio tracks + video overlays
    this.selectedOverlayId = null;
    this._gain = { id: null, v: 1, n: 0 };
    this._tick = this._tick.bind(this);
  }

  setProject(p) {
    const aspectChanged = !this.project || this.project.aspect !== p.aspect;
    this.project = p;
    if (aspectChanged && !this.exporting) this.resizePreview();
    const total = totalDuration(p);
    if (this.time > total) this.time = total;
    if (this.playing) this._enterClip(true);
    else this.seek(this.time);
  }

  resizePreview() {
    const [w, h] = canvasSize(this.project.aspect, PREVIEW_LONG_SIDE);
    this.canvas.width = w;
    this.canvas.height = h;
  }

  get duration() {
    return this.project ? totalDuration(this.project) : 0;
  }

  async addMedia(rec) {
    if (this.els.has(rec.id)) return this.els.get(rec.id);
    const url = URL.createObjectURL(rec.blob);
    let e;
    if (rec.type === 'image') {
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      e = { el: img, type: 'image', url, blob: rec.blob };
    } else {
      const el = document.createElement(rec.type === 'audio' ? 'audio' : 'video');
      el.src = url;
      el.preload = 'auto';
      el.playsInline = true;
      el.setAttribute('playsinline', '');
      el.addEventListener('seeked', () => !this.playing && this.draw());
      el.addEventListener('loadeddata', () => !this.playing && this.draw());
      await new Promise((res) => {
        if (el.readyState >= 1) return res();
        el.addEventListener('loadedmetadata', res, { once: true });
        el.addEventListener('error', res, { once: true });
        setTimeout(res, 8000);
      });
      e = { el, type: rec.type, url, blob: rec.blob };
    }
    this.els.set(rec.id, e);
    if (this.audio && e.type !== 'image') this._route(e);
    return e;
  }

  ensureAudio() {
    if (this.audio) {
      if (this.audio.ctx.state === 'suspended') this.audio.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const master = ctx.createGain();
    // Limiter: lets users boost quiet audio up to 500% without harsh clipping.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 4;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    master.connect(limiter);
    const dest = ctx.createMediaStreamDestination();
    const out = ctx.createGain();
    limiter.connect(out);
    out.connect(ctx.destination);
    out.connect(dest);
    this.audio = { ctx, master, out, dest, speakers: true };
    for (const e of this.els.values()) if (e.type !== 'image') this._route(e);
    for (const e of this.tracks.values()) if (e.type === 'audio') this._route(e);
  }

  _route(e) {
    if (e.gain) return;
    try {
      const ac = this.audio.ctx;
      const src = ac.createMediaElementSource(e.el);
      // Noise reduction = band-limit to the voice range; Enhance voice = presence boost.
      e.hp = ac.createBiquadFilter();
      e.hp.type = 'highpass';
      e.hp.frequency.value = 10;
      e.lp = ac.createBiquadFilter();
      e.lp.type = 'lowpass';
      e.lp.frequency.value = 22000;
      e.peak = ac.createBiquadFilter();
      e.peak.type = 'peaking';
      e.peak.frequency.value = 3000;
      e.peak.Q.value = 0.9;
      e.peak.gain.value = 0;
      e.gain = ac.createGain();
      src.connect(e.hp);
      e.hp.connect(e.lp);
      e.lp.connect(e.peak);
      e.peak.connect(e.gain);
      e.gain.connect(this.audio.master);
    } catch (err) {
      console.warn('[Clipora] audio routing failed', err);
    }
  }

  _setVolume(e, v) {
    if (e.gain) {
      e.gain.gain.value = v;
      e.el.volume = 1;
    } else e.el.volume = Math.min(1, v);
  }

  _setFx(e, item) {
    if (!e.hp) return;
    e.hp.frequency.value = item.denoise ? 110 : 10;
    e.lp.frequency.value = item.denoise ? 7500 : 22000;
    e.peak.gain.value = item.voice ? 6 : 0;
  }

  setSpeakers(on) {
    if (!this.audio || this.audio.speakers === on) return;
    const { ctx, out } = this.audio;
    if (on) out.connect(ctx.destination);
    else out.disconnect(ctx.destination);
    this.audio.speakers = on;
  }

  play() {
    if (!this.project?.clips.length) return;
    this.ensureAudio();
    if (this.time >= this.duration - 0.05) this.time = 0;
    this.playing = true;
    this._last = performance.now();
    this._enterClip(true);
    this._syncMusic(true);
    this._syncTracks(true);
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(this._tick);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this._raf);
    for (const e of this.els.values()) if (e.type !== 'image') e.el.pause();
    for (const e of this.tracks.values()) e.el.pause();
  }

  toggle() {
    this.playing ? this.pause() : this.play();
  }

  seek(t) {
    if (!this.project) return;
    this.time = Math.max(0, Math.min(t, this.duration));
    if (this.playing) {
      this._enterClip(true);
      this._syncMusic(true);
      this._syncTracks(true);
      return;
    }
    this._syncTracks(true);
    const at = clipAt(this.project, this.time);
    if (at && at.clip.type === 'video') {
      const e = this.els.get(at.clip.mediaId);
      if (e && Math.abs(e.el.currentTime - at.local) > 0.01) e.el.currentTime = at.local;
    }
    this.draw();
    this.onTime(this.time);
  }

  _enterClip(force) {
    const at = clipAt(this.project, this.time);
    if (!at) return;
    if (!force && at.clip.id === this.activeClipId) return;
    this.activeClipId = at.clip.id;
    const cur = this.els.get(at.clip.mediaId);
    for (const e of this.els.values()) if (e !== cur && e.type === 'video') e.el.pause();
    if (cur && at.clip.type === 'video') {
      const v = cur.el;
      v.playbackRate = at.clip.speed;
      this._setVolume(cur, at.clip.muted ? 0 : at.clip.volume);
      this._setFx(cur, at.clip);
      if (Math.abs(v.currentTime - at.local) > 0.05) v.currentTime = at.local;
      if (this.playing) v.play().catch(() => {});
    }
  }

  _syncMusic(force) {
    const m = this.project.music;
    const e = m && this.els.get(m.mediaId);
    for (const x of this.els.values()) if (x.type === 'audio' && x !== e) x.el.pause();
    if (!e) return;
    if (!this.playing) return e.el.pause();
    const d = e.el.duration || Infinity;
    let target = (m.offset || 0) + this.time;
    if (target >= d) {
      if (!m.loop) return e.el.pause();
      target %= d;
    }
    let vol = m.volume ?? 1;
    if (m.fadeIn) vol *= clamp01(this.time / m.fadeIn);
    if (m.fadeOut) vol *= clamp01((this.duration - this.time) / m.fadeOut);
    this._setVolume(e, vol);
    this._setFx(e, m);
    if (force || Math.abs(e.el.currentTime - target) > 0.3) e.el.currentTime = target;
    if (e.el.paused) e.el.play().catch(() => {});
  }

  _tick(now) {
    if (!this.playing) return;
    const dt = Math.min(0.5, (now - this._last) / 1000);
    this._last = now;
    const p = this.project;
    const total = this.duration;
    const prev = this.time;
    const at = clipAt(p, this.time);
    const e = at && this.els.get(at.clip.mediaId);
    if (at && at.clip.type === 'video' && e) {
      const v = e.el;
      if (!v.seeking && v.readyState >= 2) {
        if (v.paused && !v.ended) v.play().catch(() => {});
        const t = at.start + (v.currentTime - at.clip.in) / at.clip.speed;
        this.time = Math.max(this.time, Math.min(t, at.start + at.duration));
        if (v.currentTime >= at.clip.out - 0.03 || v.ended) this.time = at.start + at.duration + 1e-4;
      }
    } else {
      this.time += dt;
    }
    // While exporting, pause the recorder whenever playback is waiting on a
    // seek/decode so the output has no frozen frames and the right length.
    const rec = this._rec;
    if (rec) {
      const advanced = this.time > prev;
      if (!advanced && rec.state === 'recording') rec.pause();
      else if (advanced && rec.state === 'paused') rec.resume();
    }
    if (this.time >= total) {
      this.time = total;
      this.pause();
      this.draw();
      this.onTime(this.time);
      this.onEnd();
      return;
    }
    this._enterClip(false);
    this._syncMusic(false);
    this._syncTracks(false);
    this.draw();
    this.onTime(this.time);
    this._raf = requestAnimationFrame(this._tick);
  }

  // Extra elements for audio tracks and video overlays (one per item, so the
  // same file can be used several times).
  _trackEl(key, mediaId, kind) {
    let t = this.tracks.get(key);
    if (t && t.mediaId !== mediaId) {
      t.el.pause();
      this.tracks.delete(key);
      t = null;
    }
    if (t) return t;
    const base = this.els.get(mediaId);
    if (!base) return null;
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    el.src = base.url;
    el.preload = 'auto';
    el.playsInline = true;
    el.muted = kind === 'video';
    el.addEventListener('seeked', () => !this.playing && this.draw());
    el.addEventListener('loadeddata', () => !this.playing && this.draw());
    t = { el, type: kind, mediaId };
    this.tracks.set(key, t);
    if (this.audio && kind === 'audio') this._route(t);
    return t;
  }

  _syncTracks(force) {
    const p = this.project;
    if (!p) return;
    const used = new Set();
    for (const a of p.audios || []) {
      const t = this._trackEl(`a:${a.id}`, a.mediaId, 'audio');
      if (!t) continue;
      used.add(t);
      const len = a.out - a.in;
      const local = this.time - a.start;
      if (!this.playing || local < 0 || local >= len) {
        if (!t.el.paused) t.el.pause();
        continue;
      }
      let vol = a.volume ?? 1;
      if (a.fadeIn) vol *= clamp01(local / a.fadeIn);
      if (a.fadeOut) vol *= clamp01((len - local) / a.fadeOut);
      this._setVolume(t, vol);
      this._setFx(t, a);
      const target = a.in + local;
      if (force || Math.abs(t.el.currentTime - target) > 0.25) t.el.currentTime = target;
      if (t.el.paused) t.el.play().catch(() => {});
    }
    for (const o of p.overlays || []) {
      if (o.kind !== 'media' || o.type !== 'video') continue;
      const t = this._trackEl(`o:${o.id}`, o.mediaId, 'video');
      if (!t) continue;
      used.add(t);
      const local = this.time - o.start;
      const inRange = local >= 0 && local < o.end - o.start;
      const d = t.el.duration || Infinity;
      const target = local % d;
      if (!this.playing || !inRange) {
        if (!t.el.paused) t.el.pause();
        if (inRange && Math.abs(t.el.currentTime - target) > 0.05) t.el.currentTime = target;
        continue;
      }
      if (force || Math.abs(t.el.currentTime - target) > 0.3) t.el.currentTime = target;
      if (t.el.paused) t.el.play().catch(() => {});
    }
    for (const [k, t] of this.tracks) {
      if (!used.has(t)) {
        t.el.pause();
        if (!(p.audios || []).some((a) => `a:${a.id}` === k) && !(p.overlays || []).some((o) => `o:${o.id}` === k)) this.tracks.delete(k);
      }
    }
  }

  // ---------- Rendering ----------

  draw() {
    const p = this.project;
    if (!p) return;
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const at = clipAt(p, this.time);

    // Keep the previous clip's last frame for snapshot transitions.
    if (at && at.clip.id !== this._lastClip) {
      if (this._lastClip && at.index > 0 && p.clips[at.index - 1].id === this._lastClip && !['none', 'fade', undefined].includes(at.clip.transition)) {
        if (this.snap.width !== W || this.snap.height !== H) {
          this.snap.width = W;
          this.snap.height = H;
        }
        const sc = this.snap.getContext('2d');
        sc.clearRect(0, 0, W, H);
        sc.drawImage(canvas, 0, 0);
        this._snapOf = this._lastClip;
      }
      this._lastClip = at.clip.id;
    }

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = p.background.mode === 'color' ? p.background.color : '#000';
    ctx.fillRect(0, 0, W, H);

    if (at) {
      const tr = this._transition(p, at);
      const e = tr ? easeOut(tr.k) : 0;
      ctx.save();
      if (tr && (tr.type === 'slide' || tr.type === 'push')) ctx.translate((1 - e) * W, 0);
      this._drawClip(p, at, W, H);
      ctx.restore();
      if (tr) this._drawSnap(tr.type, tr.k, e, W, H);
      const a = fadeAlpha(p, this.time);
      if (a < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - a})`;
        ctx.fillRect(0, 0, W, H);
      }
    }

    this.hits = [];
    const base = Math.min(W, H);
    for (const o of p.overlays || []) if (this.time >= o.start && this.time < o.end) this._drawOverlay(o, base, W, H);
    this._applyEffects(p, W, H);
    for (const t of p.texts) if (this.time >= t.start && this.time < t.end) this._drawText(t, base, W, H);
    const cap = p.captions.find((c) => this.time >= c.start && this.time < c.end);
    if (cap) this._drawCaption(cap, p.captionStyle, base, W, H);
    if (p.progressBar && this.duration) {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, '#b553de');
      g.addColorStop(1, '#f2527a');
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.fillRect(0, 0, W, Math.max(4, H * 0.007));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, (W * this.time) / this.duration, Math.max(4, H * 0.007));
    }
    ctx.restore();
  }

  _transition(p, at) {
    const type = at.clip.transition;
    if (at.index === 0 || !type || type === 'none' || type === 'fade') return null;
    const td = Math.min(0.5, at.duration / 2);
    const k = (this.time - at.start) / td;
    if (k >= 1 || k < 0 || this._snapOf !== p.clips[at.index - 1].id) return null;
    return { type, k };
  }

  _drawSnap(type, k, e, W, H) {
    const { ctx, snap } = this;
    ctx.save();
    switch (type) {
      case 'dissolve':
        ctx.globalAlpha = 1 - k;
        ctx.drawImage(snap, 0, 0);
        break;
      case 'slide':
        ctx.beginPath();
        ctx.rect(0, 0, (1 - e) * W, H);
        ctx.clip();
        ctx.drawImage(snap, 0, 0);
        break;
      case 'push':
        ctx.drawImage(snap, -e * W, 0);
        break;
      case 'wipe':
        ctx.beginPath();
        ctx.rect(e * W, 0, W - e * W, H);
        ctx.clip();
        ctx.drawImage(snap, 0, 0);
        break;
      case 'zoom':
        ctx.globalAlpha = 1 - e;
        ctx.translate(W / 2, H / 2);
        ctx.scale(1 + e * 0.6, 1 + e * 0.6);
        ctx.drawImage(snap, -W / 2, -H / 2);
        break;
      case 'flash':
        if (k < 0.5) ctx.drawImage(snap, 0, 0);
        ctx.fillStyle = `rgba(255,255,255,${1 - Math.abs(2 * k - 1)})`;
        ctx.fillRect(0, 0, W, H);
        break;
      case 'blur':
        ctx.globalAlpha = 1 - k;
        ctx.filter = `blur(${Math.round(e * 24)}px)`;
        ctx.drawImage(snap, 0, 0);
        break;
      case 'spin':
        ctx.globalAlpha = 1 - e;
        ctx.translate(W / 2, H / 2);
        ctx.rotate((e * Math.PI) / 2);
        ctx.scale(1 - e * 0.7, 1 - e * 0.7);
        ctx.drawImage(snap, -W / 2, -H / 2);
        break;
    }
    ctx.restore();
  }

  _drawClip(p, at, W, H) {
    const { ctx } = this;
    const c = at.clip;
    const e = this.els.get(c.mediaId);
    const f = this._source(e, `m:${c.mediaId}`);
    if (!f) return;
    const { src, w: sw0, h: sh0 } = f;
    const rot = ((c.rotate || 0) % 360 + 360) % 360;
    const swap = rot === 90 || rot === 270;
    const sw = swap ? sh0 : sw0;
    const sh = swap ? sw0 : sh0;
    if (p.background.mode === 'blur') this._drawBlur(src, sw0, sh0, W, H);
    let s = c.fit === 'fill' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
    s *= c.zoom || 1;
    if (c.type === 'image' && (!c.animIn || c.animIn === 'none')) s *= 1 + 0.08 * clamp01((this.time - at.start) / at.duration); // gentle Ken Burns

    // Clip in/out animations.
    const local = this.time - at.start;
    const left = at.duration - local;
    const AD = Math.min(0.6, at.duration / 2);
    let alpha = 1;
    let sc = 1;
    let dx = 0;
    let dy = 0;
    let rr = 0;
    if (c.animIn && c.animIn !== 'none' && local < AD) {
      const k = easeOut(local / AD);
      if (c.animIn === 'fadeIn') alpha = k;
      else if (c.animIn === 'zoomIn') sc = 0.6 + 0.4 * k;
      else if (c.animIn === 'zoomOut') sc = 1.5 - 0.5 * k;
      else if (c.animIn === 'slideUp') dy = (1 - k) * H;
      else if (c.animIn === 'slideLeft') dx = (1 - k) * W;
      else if (c.animIn === 'spinIn') (rr = (1 - k) * -Math.PI), (sc = k);
      else if (c.animIn === 'bounce') sc = Math.max(0.01, easeOutBack(local / AD));
    }
    if (c.animOut && c.animOut !== 'none' && left < AD) {
      const k = easeOut(1 - left / AD);
      if (c.animOut === 'fadeOut') alpha *= 1 - k;
      else if (c.animOut === 'zoomOut') sc *= 1 - 0.4 * k;
      else if (c.animOut === 'slideDown') dy += k * H;
      else if (c.animOut === 'spinOut') (rr += k * Math.PI), (sc *= 1 - k);
    }

    const dw = sw0 * s;
    const dh = sh0 * s;
    const ew = swap ? dh : dw;
    const eh = swap ? dw : dh;
    const px = (c.panX || 0) * Math.max(0, (ew - W) / 2);
    const py = (c.panY || 0) * Math.max(0, (eh - H) / 2);
    let img = src;
    const gp = this.gfx.ok ? gpuParams(c) : null;
    if (gp) {
      const ow = Math.min(dw, 2560, Math.max(sw0, W * 1.5));
      gp.gain = c.enhance ? this._autoGain(src, c.id) : 1;
      img = this.gfx.process(src, ow, (ow * sh0) / sw0, gp, this.time);
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2 + px + dx, H / 2 + py + dy);
    ctx.rotate((rot * Math.PI) / 180 + rr);
    ctx.scale((c.flipH ? -1 : 1) * sc, (c.flipV ? -1 : 1) * sc);
    ctx.filter = filterCss(c.filter);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  // What to draw for a clip/overlay: a decoded frame during fast export,
  // otherwise the <img>/<video> element once it has data.
  _source(e, key) {
    const fr = this._frames?.get(key);
    if (fr) return { src: fr, w: fr.width, h: fr.height };
    const el = e?.el;
    if (!el) return null;
    if (el.tagName === 'IMG') return el.complete && el.naturalWidth ? { src: el, w: el.naturalWidth, h: el.naturalHeight } : null;
    return el.readyState >= 2 && el.videoWidth ? { src: el, w: el.videoWidth, h: el.videoHeight } : null;
  }

  // Enhance: measures how dark the video is and brightens it smoothly.
  _autoGain(src, id) {
    const g = this._gain;
    if (g.id !== id) {
      g.id = id;
      g.n = 0;
      g.v = 1;
    }
    if (g.n++ % 8 === 0) {
      if (!this._meter) {
        this._meter = document.createElement('canvas');
        this._meter.width = this._meter.height = 12;
        this._mctx = this._meter.getContext('2d', { willReadFrequently: true });
      }
      try {
        this._mctx.drawImage(src, 0, 0, 12, 12);
        const d = this._mctx.getImageData(0, 0, 12, 12).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        const mean = sum / (d.length / 4) / 255;
        const target = Math.max(1, Math.min(2.2, 0.45 / Math.max(mean, 0.05)));
        g.v = g.n === 1 ? target : g.v + (target - g.v) * 0.35;
      } catch {}
    }
    return g.v;
  }

  _drawOverlay(o, base, W, H) {
    const { ctx } = this;
    const age = this.time - o.start;
    const left = o.end - this.time;
    let alpha = o.opacity ?? 1;
    let sc = 1;
    if (o.anim === 'pop') sc = age < 0.3 ? Math.max(0.01, easeOutBack(age / 0.3)) : 1;
    if (o.anim === 'fade' || o.anim === 'pop') alpha *= clamp01(Math.min(age, left) / 0.25);
    if (o.anim === 'float') sc = 1 + 0.04 * Math.sin(age * 3);
    const cx = o.x * W;
    const cy = o.y * H;
    let w = o.scale * W;
    let h = w;

    if (o.kind === 'blur') {
      h = w * (o.ratio || 0.6);
      const x = Math.round(cx - w / 2);
      const y = Math.round(cy - h / 2);
      const bw = Math.max(1, Math.round(w));
      const bh = Math.max(1, Math.round(h));
      const pix = Math.max(6, Math.round(base * 0.025));
      this.tmp.width = Math.max(1, Math.round(bw / pix));
      this.tmp.height = Math.max(1, Math.round(bh / pix));
      const t = this.tmp.getContext('2d');
      t.drawImage(this.canvas, x, y, bw, bh, 0, 0, this.tmp.width, this.tmp.height);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.beginPath();
      roundRect(ctx, x, y, bw, bh, Math.min(bw, bh) * 0.2);
      ctx.clip();
      ctx.drawImage(this.tmp, x, y, bw, bh);
      ctx.restore();
    } else if (o.kind === 'sticker') {
      const size = o.scale * base;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
      ctx.scale(sc, sc);
      ctx.font = `${size}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.text, 0, 0);
      ctx.restore();
      w = h = size * 1.15;
    } else {
      const e = o.type === 'video' ? this.tracks.get(`o:${o.id}`) : this.els.get(o.mediaId);
      const f = this._source(e, `o:${o.id}`);
      if (!f) return;
      const { src, w: sw, h: sh } = f;
      h = (w * sh) / sw;
      let img = src;
      if (o.chroma > 0 && this.gfx.ok) img = this.gfx.process(src, Math.min(sw, w * 1.5), Math.min(sw, w * 1.5) * (sh / sw), { keyStrength: o.chroma, keyColor: hexToRgb(o.keyColor || '#00ff00') }, this.time);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(cx, cy);
      ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
      ctx.scale((o.flipH ? -1 : 1) * sc, sc);
      if (o.shape === 'circle') {
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.min(w, h) / 2, Math.min(w, h) / 2, 0, 0, Math.PI * 2);
        ctx.clip();
      } else if (o.shape === 'round') {
        roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.12);
        ctx.clip();
      }
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      if (o.border) {
        ctx.lineWidth = base * 0.012;
        ctx.strokeStyle = '#fff';
        if (o.shape === 'circle') {
          ctx.beginPath();
          ctx.ellipse(0, 0, Math.min(w, h) / 2, Math.min(w, h) / 2, 0, 0, Math.PI * 2);
        } else roundRect(ctx, -w / 2, -h / 2, w, h, o.shape === 'round' ? Math.min(w, h) * 0.12 : 1);
        ctx.stroke();
      }
      ctx.restore();
      if (o.shape === 'circle') w = h = Math.min(w, h);
    }
    this.hits.push({ id: o.id, kind: 'overlay', x: cx - w / 2, y: cy - h / 2, w, h });
    if (o.id === this.selectedOverlayId && !this.exporting) {
      ctx.save();
      ctx.strokeStyle = '#ff5fa2';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      ctx.restore();
    }
  }

  // Full-frame effects (shake, glitch, VHS …) for the time ranges in p.effects.
  _applyEffects(p, W, H) {
    const act = (p.effects || []).filter((f) => this.time >= f.start && this.time < f.end);
    if (!act.length) return;
    const P = {};
    let zoom = 1;
    let blur = 0;
    for (const f of act) {
      const lt = this.time - f.start;
      const k = lt / Math.max(0.01, f.end - f.start);
      const I = f.intensity ?? 1;
      const pulse = Math.pow(Math.abs(Math.sin(lt * Math.PI * 2)), 4);
      switch (f.type) {
        case 'shake':
          P.shift = [Math.sin(lt * 47) * 0.012 * I, Math.cos(lt * 39) * 0.012 * I];
          zoom *= 1 + 0.04 * I;
          break;
        case 'zoomPulse':
          zoom *= 1 + 0.1 * I * pulse;
          break;
        case 'heartbeat':
          zoom *= 1 + 0.06 * I * pulse;
          P.vignette = 0.6 * I * pulse;
          break;
        case 'glitch': {
          const on = Math.sin(lt * 31) > 0.55 || Math.sin(lt * 17 + 1) > 0.85;
          P.rgb = (on ? 0.014 : 0.003) * I;
          P.shift = [on ? Math.sin(lt * 91) * 0.02 * I : 0, 0];
          P.scan = 0.25 * I;
          break;
        }
        case 'vhs':
          P.scan = 0.8 * I;
          P.rgb = 0.004 * I;
          P.grain = 0.5 * I;
          P.vibrance = -0.25 * I;
          break;
        case 'oldFilm':
          P.bw = 0.8 * I;
          P.grain = 0.7 * I;
          P.vignette = 0.6 * I;
          P.flash = Math.sin(lt * 23) > 0.93 ? 0.08 : 0;
          break;
        case 'flash':
          P.flash = Math.max(0, 1 - k * 4) * I;
          break;
        case 'blurIn':
          blur = Math.max(0, 1 - k * 2) * 24 * I;
          break;
        case 'bwPop':
          P.bw = I;
          break;
        case 'mirror':
          P.mirror = 1;
          break;
        case 'invert':
          P.invert = I;
          break;
        case 'pixelate':
          P.pixelate = 4 + 16 * I * (1 - Math.min(1, k * 1.5));
          break;
      }
    }
    P.zoom = zoom;
    const { ctx } = this;
    if (!this.gfx.ok) {
      if (!blur && zoom === 1) return;
      this.tmp.width = W;
      this.tmp.height = H;
      this.tmp.getContext('2d').drawImage(this.canvas, 0, 0);
      ctx.save();
      if (blur) ctx.filter = `blur(${blur}px)`;
      ctx.translate(W / 2, H / 2);
      ctx.scale(zoom, zoom);
      ctx.drawImage(this.tmp, -W / 2, -H / 2);
      ctx.restore();
      return;
    }
    const out = this.gfx.process(this.canvas, W, H, P, this.time);
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    if (blur) ctx.filter = `blur(${blur.toFixed(1)}px)`;
    ctx.drawImage(out, 0, 0, W, H);
    ctx.restore();
  }

  _drawBlur(src, sw, sh, W, H) {
    const bw = 48;
    const bh = Math.max(1, Math.round((48 * H) / W));
    if (this.blur.width !== bw || this.blur.height !== bh) {
      this.blur.width = bw;
      this.blur.height = bh;
    }
    const b = this.bctx;
    const s = Math.max(bw / sw, bh / sh) * 1.15;
    b.filter = 'blur(2px)';
    b.drawImage(src, (bw - sw * s) / 2, (bh - sh * s) / 2, sw * s, sh * s);
    b.filter = 'none';
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(this.blur, 0, 0, W, H);
    this.ctx.fillStyle = 'rgba(0,0,0,0.3)';
    this.ctx.fillRect(0, 0, W, H);
  }

  _wrap(text, maxW) {
    const ctx = this.ctx;
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      lines.push(line);
    }
    return lines;
  }

  _drawLines(lines, cx, cy, size, opts) {
    const ctx = this.ctx;
    const lh = size * 1.22;
    const widths = lines.map((l) => ctx.measureText(l).width);
    const maxW = Math.max(...widths, 1);
    const h = lh * lines.length;
    let y = cy - h / 2 + lh / 2;
    if (opts.box) {
      const pad = size * 0.35;
      ctx.fillStyle = opts.box;
      roundRect(ctx, cx - maxW / 2 - pad, cy - h / 2 - pad * 0.6, maxW + pad * 2, h + pad * 1.2, size * 0.3);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of lines) {
      if (opts.glow) {
        ctx.shadowColor = opts.glow;
        ctx.shadowBlur = size * 0.6;
      }
      if (opts.stroke) {
        ctx.lineWidth = size * 0.16;
        ctx.strokeStyle = opts.stroke;
        ctx.strokeText(l, cx, y);
      }
      ctx.fillStyle = opts.color;
      ctx.fillText(l, cx, y);
      ctx.shadowBlur = 0;
      y += lh;
    }
    return { x: cx - maxW / 2, y: cy - h / 2, w: maxW, h };
  }

  _drawText(t, base, W, H) {
    const ctx = this.ctx;
    const age = this.time - t.start;
    const left = t.end - this.time;
    let alpha = 1;
    let scale = 1;
    let dy = 0;
    let text = t.text;
    switch (t.anim) {
      case 'fade':
        alpha = clamp01(Math.min(age, left) / 0.3);
        break;
      case 'pop':
        scale = age < 0.3 ? Math.max(0.01, easeOutBack(age / 0.3)) : 1;
        alpha = clamp01(left / 0.2);
        break;
      case 'slide':
        dy = (1 - easeOut(clamp01(age / 0.4))) * 0.08 * H;
        alpha = clamp01(age / 0.4) * clamp01(left / 0.2);
        break;
      case 'typewriter':
        text = [...t.text].slice(0, Math.floor(age * 22)).join('');
        break;
      case 'bounce':
        dy = -Math.abs(Math.sin(age * 5)) * 0.03 * H * Math.max(0, 1 - age / 2);
        break;
      case 'zoom':
        scale = age < 0.35 ? 2 - easeOut(age / 0.35) : 1;
        alpha = clamp01(age / 0.2) * clamp01(left / 0.2);
        break;
      case 'blink':
        alpha = Math.sin(age * 8) > -0.3 ? 1 : 0.15;
        break;
    }
    const size = t.size * base;
    ctx.save();
    ctx.globalAlpha = alpha;
    const font = (FONTS[t.font] || FONTS.bold).replace('{s}', size.toFixed(1));
    ctx.font = font;
    const cx = t.x * W;
    const cy = t.y * H + dy;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    const lines = this._wrap(text, W * 0.86);
    const fullLines = this._wrap(t.text, W * 0.86);
    const opts = { color: t.color };
    if (t.bg) opts.box = t.bgColor ? `${t.bgColor}d9` : 'rgba(0,0,0,0.55)';
    else if (t.outline !== 'none') opts.stroke = t.outline || 'rgba(0,0,0,0.85)';
    if (t.glow) opts.glow = t.color;
    const r = this._drawLines(lines, 0, 0, size, opts);
    ctx.restore();
    const fw = Math.max(r.w, ...fullLines.map((l) => ((ctx.font = font), ctx.measureText(l).width)));
    const pad = size * 0.4;
    this.hits.push({ id: t.id, x: cx - fw / 2 - pad, y: cy - r.h / 2 - pad, w: fw + pad * 2, h: r.h + pad * 2 });
    if (t.id === this.selectedTextId && !this.exporting) {
      const hit = this.hits.at(-1);
      ctx.save();
      ctx.strokeStyle = '#ff5fa2';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeRect(hit.x, hit.y, hit.w, hit.h);
      ctx.restore();
    }
  }

  _drawCaption(c, style, base, W, H) {
    const ctx = this.ctx;
    const size = base * 0.062;
    const upper = style === 'pop';
    ctx.save();
    ctx.font = `${style === 'classic' ? 700 : 900} ${size}px ${FONT}`;
    const text = upper ? c.text.toUpperCase() : c.text;
    const lines = this._wrap(text, W * 0.84);
    const y = H * 0.8;
    const opts = {
      classic: { color: '#fff', stroke: 'rgba(0,0,0,0.9)' },
      box: { color: '#fff', box: 'rgba(0,0,0,0.72)' },
      pop: { color: '#FFE14D', stroke: '#000' },
      neon: { color: '#fff', glow: '#ff3fa4', stroke: 'rgba(120,0,80,0.6)' },
    }[style] || { color: '#fff', stroke: '#000' };
    this._drawLines(lines, W / 2, y, size, opts);
    ctx.restore();
  }

  /** Topmost draggable item (text or overlay) at canvas point x,y: { id, kind } or null. */
  hitAt(x, y) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return { id: h.id, kind: h.kind || 'text' };
    }
    return null;
  }

  textAt(x, y) {
    const h = this.hitAt(x, y);
    return h && h.kind === 'text' ? h.id : null;
  }

  // ---------- Export ----------

  async export(opts = {}) {
    if (fastExportSupported() && !opts.realtime) {
      try {
        return await this._exportFast(opts);
      } catch (e) {
        if (opts.signal?.aborted) return null;
        console.warn('[Clipora] fast export unavailable, recording in real time instead', e);
      }
    }
    return this._exportRealtime(opts);
  }

  async _exportFast({ shortSide = 720, fps = 30, onProgress = () => {}, signal, yuv } = {}) {
    this.pause();
    const p = this.project;
    if (!this.duration) throw new Error('Nothing to export');
    // Multiples of 8: what video encoders and the GPU color conversion like best.
    const [W, H] = canvasSize(p.aspect, null, shortSide).map((v) => Math.round(v / 8) * 8);
    this.exporting = true;
    this.canvas.width = W;
    this.canvas.height = H;
    try {
      return await exportFast(this, { W, H, fps, shortSide, onProgress, signal, yuv });
    } finally {
      this.exporting = false;
      this.resizePreview();
      this.seek(0);
    }
  }

  async _exportRealtime({ shortSide = 720, fps = 30, onProgress = () => {}, signal } = {}) {
    const mime = pickMime();
    if (!mime || !this.canvas.captureStream) throw new Error('This browser cannot export video (MediaRecorder missing).');
    this.pause();
    this.ensureAudio();
    const p = this.project;
    const total = this.duration;
    if (!total) throw new Error('Nothing to export');

    const [W, H] = canvasSize(p.aspect, null, shortSide);
    this.exporting = true;
    this.canvas.width = W;
    this.canvas.height = H;
    this.setSpeakers(false);
    let wake = null;
    try {
      wake = await navigator.wakeLock?.request('screen');
    } catch {}

    const stream = this.canvas.captureStream(fps);
    this.audio.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: bitrateFor(shortSide, fps),
      audioBitsPerSecond: 160_000,
    });
    const chunks = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    const stopped = new Promise((r) => (rec.onstop = r));

    const oldTime = this.onTime;
    const oldEnd = this.onEnd;
    let cancelled = false;
    try {
      // Make sure the first frame is ready before recording starts.
      this.seek(0);
      await this._waitFrame();
      this.draw();
      rec.start(500);
      rec.pause();
      this._rec = rec;
      await new Promise((resolve) => {
        this.onTime = (t) => onProgress(Math.min(1, t / total));
        this.onEnd = resolve;
        signal?.addEventListener('abort', () => {
          cancelled = true;
          this.pause();
          resolve();
        });
        this.play();
      });
      // Let the recorder grab the final frame.
      this._rec = null;
      if (rec.state === 'paused') rec.resume();
      await new Promise((r) => setTimeout(r, 120));
      rec.stop();
      await stopped;
    } finally {
      this._rec = null;
      stream.getVideoTracks().forEach((t) => t.stop());
      this.onTime = oldTime;
      this.onEnd = oldEnd;
      this.exporting = false;
      this.setSpeakers(true);
      wake?.release?.().catch(() => {});
      this.resizePreview();
      this.seek(0);
    }
    if (cancelled) return null;
    const type = mime.split(';')[0];
    return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
  }

  /** The current frame as a PNG at export resolution (photo editing). */
  async snapshot(shortSide = 1080) {
    if (!this.project?.clips.length) return null;
    this.pause();
    const t = this.time;
    const [W, H] = canvasSize(this.project.aspect, null, shortSide);
    this.exporting = true;
    this.canvas.width = W;
    this.canvas.height = H;
    try {
      this.seek(t);
      await this._waitFrame();
      this.draw();
      return await new Promise((r) => this.canvas.toBlob(r, 'image/png'));
    } finally {
      this.exporting = false;
      this.resizePreview();
      this.seek(t);
    }
  }

  async _waitFrame() {
    const at = clipAt(this.project, this.time);
    if (!at || at.clip.type !== 'video') return;
    const v = this.els.get(at.clip.mediaId)?.el;
    if (!v) return;
    const t0 = performance.now();
    while ((v.seeking || v.readyState < 2) && performance.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 30));
  }

  dispose() {
    this.pause();
    for (const e of this.els.values()) {
      URL.revokeObjectURL(e.url);
      if (e.type !== 'image') e.el.removeAttribute('src');
    }
    for (const t of this.tracks.values()) t.el.removeAttribute('src');
    this.tracks.clear();
    this.els.clear();
    this.audio?.ctx.close().catch(() => {});
    this.audio = null;
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
