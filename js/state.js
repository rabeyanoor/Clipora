// Project model and edit operations. Pure functions: every edit returns a new
// project object so undo/redo is just a stack of snapshots.

export const uid = () =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const ASPECTS = { '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '16:9': [16, 9] };

export const FILTERS = {
  none: {},
  vivid: { saturate: 1.45, contrast: 1.1 },
  warm: { sepia: 0.25, saturate: 1.25 },
  cool: { hue: -15, saturate: 1.1, brightness: 1.03 },
  bw: { grayscale: 1, contrast: 1.12 },
  vintage: { sepia: 0.5, contrast: 0.9, brightness: 1.05 },
  matte: { contrast: 0.85, brightness: 1.1, saturate: 0.8 },
  drama: { contrast: 1.35, saturate: 0.9, brightness: 0.95 },
  clear: { contrast: 1.06, saturate: 1.12, gpu: { sharpen: 0.5, shadows: 0.15 } },
  fresh: { saturate: 1.2, brightness: 1.05, gpu: { temp: -0.25, tint: 0.15 } },
  golden: { saturate: 1.15, contrast: 1.05, gpu: { temp: 0.6, highlights: 0.1 } },
  film: { contrast: 1.1, saturate: 0.85, gpu: { grain: 0.35, vignette: 0.35, temp: 0.15 } },
  moody: { contrast: 1.2, saturate: 0.75, brightness: 0.92, gpu: { temp: -0.3, vignette: 0.4 } },
  pink: { saturate: 1.15, brightness: 1.06, gpu: { tint: -0.5, temp: 0.2 } },
  noir: { grayscale: 1, contrast: 1.4, gpu: { vignette: 0.55, grain: 0.2 } },
  retro: { sepia: 0.35, saturate: 1.3, contrast: 1.1, gpu: { grain: 0.25, vignette: 0.3 } },
};

// Adjust sliders (all neutral at 0) that run on the GPU.
export const ADJUST = {
  exposure: [-1, 1],
  temp: [-1, 1],
  tint: [-1, 1],
  highlights: [-1, 1],
  shadows: [-1, 1],
  sharpen: [0, 1],
  smoothSkin: [0, 1],
  vignette: [0, 1],
  grain: [0, 1],
};

export const TRANSITIONS = ['none', 'fade', 'dissolve', 'slide', 'push', 'wipe', 'zoom', 'flash', 'blur', 'spin'];
export const CLIP_ANIMS_IN = ['none', 'fadeIn', 'zoomIn', 'zoomOut', 'slideUp', 'slideLeft', 'spinIn', 'bounce'];
export const CLIP_ANIMS_OUT = ['none', 'fadeOut', 'zoomOut', 'slideDown', 'spinOut'];
export const EFFECTS = ['shake', 'zoomPulse', 'glitch', 'vhs', 'oldFilm', 'flash', 'blurIn', 'bwPop', 'mirror', 'invert', 'pixelate', 'heartbeat'];
export const STICKERS = ['😂', '😍', '🔥', '👍', '❤️', '✨', '🎉', '😎', '💯', '👀', '🙏', '😭', '⭐', '✅', '❌', '👉', '🎵', '📍', '💥', '🤯'];
export const FONTS = {
  bold: '800 {s}px "Noto Sans Bengali", system-ui, sans-serif',
  serif: '700 {s}px Georgia, "Times New Roman", serif',
  mono: '700 {s}px ui-monospace, Menlo, Consolas, monospace',
  hand: '700 {s}px "Comic Sans MS", "Segoe Print", cursive',
  impact: '900 {s}px Impact, "Arial Narrow", "Roboto Condensed", sans-serif',
  light: '300 {s}px system-ui, "Helvetica Neue", sans-serif',
};

/** GPU shader parameters for a clip (preset + adjust sliders + Enhance), or null if none apply. */
export function gpuParams(c) {
  const f = c.filter || {};
  const pre = FILTERS[f.preset]?.gpu || {};
  const out = {};
  let any = false;
  for (const k of Object.keys(ADJUST)) {
    const v = (pre[k] || 0) + (f[k] || 0);
    if (v) {
      out[k] = v;
      any = true;
    }
  }
  if (c.enhance) {
    out.sharpen = (out.sharpen || 0) + 0.55;
    out.smoothSkin = (out.smoothSkin || 0) + 0.25;
    out.shadows = (out.shadows || 0) + 0.2;
    out.vibrance = 0.25;
    any = true;
  }
  return any ? out : null;
}

export const CAPTION_STYLES = ['classic', 'box', 'pop', 'neon'];
export const TEXT_ANIMS = ['none', 'fade', 'pop', 'slide', 'typewriter'];

export const MIN_CLIP = 0.1;
export const FADE = 0.4;

export function filterCss(f = {}) {
  const p = FILTERS[f.preset] || {};
  const b = (p.brightness ?? 1) * (f.brightness ?? 1);
  const c = (p.contrast ?? 1) * (f.contrast ?? 1);
  const s = (p.saturate ?? 1) * (f.saturation ?? 1);
  const parts = [];
  if (b !== 1) parts.push(`brightness(${b.toFixed(3)})`);
  if (c !== 1) parts.push(`contrast(${c.toFixed(3)})`);
  if (s !== 1) parts.push(`saturate(${s.toFixed(3)})`);
  if (p.sepia) parts.push(`sepia(${p.sepia})`);
  if (p.grayscale) parts.push(`grayscale(${p.grayscale})`);
  if (p.hue) parts.push(`hue-rotate(${p.hue}deg)`);
  return parts.length ? parts.join(' ') : 'none';
}

export function newProject(name = 'Untitled') {
  const now = Date.now();
  return {
    id: uid(),
    name,
    aspect: '9:16',
    background: { mode: 'blur', color: '#000000' },
    clips: [],
    texts: [],
    captions: [],
    captionStyle: 'classic',
    music: null,
    overlays: [],
    effects: [],
    audios: [],
    progressBar: false,
    createdAt: now,
    updatedAt: now,
  };
}

// media: { id, type: 'video'|'image', duration }
export function makeClip(media) {
  const isImage = media.type === 'image';
  const srcDuration = isImage ? 600 : media.duration;
  return {
    id: uid(),
    mediaId: media.id,
    type: isImage ? 'image' : 'video',
    srcDuration,
    in: 0,
    out: isImage ? 3 : media.duration,
    speed: 1,
    volume: 1,
    muted: false,
    fit: 'fit',
    filter: { preset: 'none', brightness: 1, contrast: 1, saturation: 1 },
    transition: 'none',
  };
}

export const clipDuration = (c) => (c.out - c.in) / c.speed;
export const totalDuration = (p) => p.clips.reduce((t, c) => t + clipDuration(c), 0);

export function clipStarts(p) {
  let t = 0;
  return p.clips.map((c) => {
    const s = t;
    t += clipDuration(c);
    return s;
  });
}

// Which clip is visible at timeline time t, and the matching source time.
export function clipAt(p, t) {
  let start = 0;
  for (let i = 0; i < p.clips.length; i++) {
    const c = p.clips[i];
    const d = clipDuration(c);
    if (t < start + d || i === p.clips.length - 1) {
      const local = Math.min(c.out, Math.max(c.in, c.in + (t - start) * c.speed));
      return { clip: c, index: i, start, local, duration: d };
    }
    start += d;
  }
  return null;
}

// Opacity multiplier for "dip to black" transitions around clip edges.
export function fadeAlpha(p, t) {
  const at = clipAt(p, t);
  if (!at) return 1;
  const into = t - at.start;
  const left = at.start + at.duration - t;
  let a = 1;
  if (at.clip.transition === 'fade' && at.index > 0) a = Math.min(a, into / FADE);
  const next = p.clips[at.index + 1];
  if (next && next.transition === 'fade') a = Math.min(a, left / FADE);
  return Math.max(0, Math.min(1, a));
}

const clone = (p) => structuredClone(p);
const touch = (q) => ((q.updatedAt = Date.now()), q);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function targets(q, scope, selectedId) {
  if (scope === 'all') return q.clips;
  const c = q.clips.find((x) => x.id === selectedId) || q.clips[0];
  return c ? [c] : [];
}

export function addClips(p, medias, atIndex = p.clips.length) {
  const q = clone(p);
  q.clips.splice(atIndex, 0, ...medias.map(makeClip));
  return touch(q);
}

export function updateClip(p, id, patch) {
  const q = clone(p);
  const c = q.clips.find((x) => x.id === id);
  if (!c) return p;
  Object.assign(c, patch);
  if (patch.filter) c.filter = { ...p.clips.find((x) => x.id === id).filter, ...patch.filter };
  c.speed = clamp(c.speed, 0.25, 4);
  c.volume = clamp(c.volume, 0, 5);
  c.zoom = clamp(c.zoom ?? 1, 1, 4);
  c.in = clamp(c.in, 0, c.srcDuration - MIN_CLIP);
  c.out = clamp(c.out, c.in + MIN_CLIP, c.srcDuration);
  return touch(q);
}

export function splitClip(p, t) {
  const at = clipAt(p, t);
  if (!at) return { project: p, ok: false };
  const { clip, local } = at;
  if (local - clip.in < MIN_CLIP || clip.out - local < MIN_CLIP) return { project: p, ok: false };
  const q = clone(p);
  const a = q.clips[at.index];
  const b = { ...structuredClone(a), id: uid(), in: local, transition: 'none' };
  a.out = local;
  q.clips.splice(at.index + 1, 0, b);
  return { project: touch(q), ok: true, newId: b.id };
}

export function deleteClip(p, id) {
  const q = clone(p);
  q.clips = q.clips.filter((c) => c.id !== id);
  return touch(q);
}

export function duplicateClip(p, id) {
  const i = p.clips.findIndex((c) => c.id === id);
  if (i < 0) return { project: p };
  const q = clone(p);
  const copy = { ...structuredClone(q.clips[i]), id: uid() };
  q.clips.splice(i + 1, 0, copy);
  return { project: touch(q), newId: copy.id };
}

export function moveClip(p, id, dir) {
  const i = p.clips.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.clips.length) return p;
  const q = clone(p);
  [q.clips[i], q.clips[j]] = [q.clips[j], q.clips[i]];
  return touch(q);
}

// Replace one clip with several clips that cover only the given source ranges.
export function replaceWithRanges(p, id, ranges) {
  const i = p.clips.findIndex((c) => c.id === id);
  if (i < 0 || !ranges.length) return p;
  const q = clone(p);
  const base = q.clips[i];
  const parts = ranges.map((r, k) => ({
    ...structuredClone(base),
    id: k === 0 ? base.id : uid(),
    in: r.start,
    out: r.end,
    transition: k === 0 ? base.transition : 'none',
  }));
  q.clips.splice(i, 1, ...parts);
  return touch(q);
}

export function addText(p, text, start, end) {
  const q = clone(p);
  const total = totalDuration(q) || 3;
  const s = clamp(start ?? 0, 0, Math.max(0, total - 0.1));
  const item = {
    id: uid(),
    text: text || 'Text',
    start: s,
    end: clamp(end ?? s + 3, s + 0.1, Math.max(total, s + 0.1)),
    x: 0.5,
    y: 0.3,
    size: 0.07,
    color: '#ffffff',
    bg: false,
    anim: 'pop',
  };
  q.texts.push(item);
  return { project: touch(q), id: item.id };
}

export function updateItem(p, list, id, patch) {
  const q = clone(p);
  const it = q[list].find((x) => x.id === id);
  if (!it) return p;
  Object.assign(it, patch);
  if (it.end < it.start + 0.1) it.end = it.start + 0.1;
  return touch(q);
}

export function removeItem(p, list, id) {
  const q = clone(p);
  q[list] = q[list].filter((x) => x.id !== id);
  return touch(q);
}

/** Fills in fields added in later versions so old projects open cleanly. */
export function migrate(p) {
  return { overlays: [], effects: [], audios: [], progressBar: false, ...p };
}

const pushItem = (list) => (p, item) => {
  const q = clone(p);
  const it = { id: uid(), ...item };
  q[list] = [...(q[list] || []), it];
  return { project: touch(q), id: it.id };
};
/** Picture/video overlay, sticker or blur region on top of the video. */
export const addOverlay = pushItem('overlays');
/** Time-ranged full-frame effect. */
export const addEffect = pushItem('effects');
/** Extra audio track (voice-over, sound effect, extracted audio). */
export const addAudio = pushItem('audios');

export function overlayDefaults(kind, extra = {}) {
  return { kind, x: 0.5, y: 0.4, scale: kind === 'sticker' ? 0.18 : 0.42, rotation: 0, opacity: 1, anim: 'pop', chroma: 0, keyColor: '#00ff00', ...extra };
}

/** Inserts a media item as a new clip at `index` (e.g. a freeze frame). */
export function insertClip(p, index, media, duration) {
  const q = clone(p);
  const c = makeClip(media);
  if (duration) c.out = c.in + duration;
  q.clips.splice(index, 0, c);
  return { project: touch(q), id: c.id };
}

export function setCaptions(p, caps) {
  const q = clone(p);
  q.captions = caps.map((c) => ({ id: uid(), start: c.start, end: c.end, text: c.text }));
  return touch(q);
}

export function setProject(p, patch) {
  return touch({ ...clone(p), ...patch });
}

// Apply a parsed smart-command action (see commands.js). Returns null if the
// action needs async work (handled by the app) or is unknown.
export function applyAction(p, a, selectedId) {
  const q = clone(p);
  const list = targets(q, a.scope, selectedId);
  switch (a.type) {
    case 'aspect':
      q.aspect = a.value;
      break;
    case 'speed':
      list.forEach((c) => (c.speed = clamp(a.value, 0.25, 4)));
      break;
    case 'trimStart':
      list.forEach((c) => (c.in = clamp(c.in + a.value * c.speed, 0, c.out - MIN_CLIP)));
      break;
    case 'trimEnd':
      list.forEach((c) => (c.out = clamp(c.out - a.value * c.speed, c.in + MIN_CLIP, c.srcDuration)));
      break;
    case 'mute':
      list.forEach((c) => (c.muted = a.value));
      break;
    case 'volume':
      list.forEach((c) => ((c.volume = clamp(a.value, 0, 5)), (c.muted = false)));
      break;
    case 'enhance':
      list.forEach((c) => (c.enhance = a.value !== false));
      break;
    case 'denoise':
      list.forEach((c) => (c.denoise = a.value !== false));
      break;
    case 'rotate':
      list.forEach((c) => (c.rotate = ((c.rotate || 0) + (a.value || 90)) % 360));
      break;
    case 'mirror':
      list.forEach((c) => (c.flipH = !c.flipH));
      break;
    case 'progressBar':
      q.progressBar = a.value !== false;
      break;
    case 'filter':
      list.forEach((c) => (c.filter = { ...c.filter, preset: a.value }));
      break;
    case 'fit':
      list.forEach((c) => (c.fit = a.value));
      break;
    case 'background':
      q.background = { ...q.background, ...a.value };
      break;
    case 'transition':
      q.clips.forEach((c, i) => (c.transition = i === 0 ? 'none' : a.value));
      break;
    case 'captionStyle':
      q.captionStyle = a.value;
      break;
    case 'addText':
      return addText(q, a.value, a.start).project;
    default:
      return null;
  }
  return touch(q);
}

export class History {
  constructor(limit = 80) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }
  push(prev) {
    this.past.push(prev);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

// Remove the timeline range [a, b) from the video, Descript-style. Clips are
// split as needed; texts and captions after the cut move left.
export function cutRange(p, a, b) {
  if (!(b > a)) return p;
  const q = clone(p);
  const out = [];
  let start = 0;
  for (const c of q.clips) {
    const d = clipDuration(c);
    const s = start;
    const e = start + d;
    start = e;
    if (b <= s || a >= e) {
      out.push(c);
      continue;
    }
    const cutIn = c.in + (Math.max(a, s) - s) * c.speed;
    const cutOut = c.in + (Math.min(b, e) - s) * c.speed;
    if (cutIn - c.in >= MIN_CLIP) out.push({ ...c, out: cutIn });
    if (c.out - cutOut >= MIN_CLIP) out.push({ ...c, id: cutIn - c.in >= MIN_CLIP ? uid() : c.id, in: cutOut, transition: 'none' });
  }
  q.clips = out;
  const len = b - a;
  const shift = (items) =>
    items
      .filter((x) => !(x.start >= a && x.end <= b))
      .map((x) => {
        const ns = x.start >= b ? x.start - len : x.start > a ? a : x.start;
        const ne = x.end >= b ? x.end - len : x.end > a ? a : x.end;
        return { ...x, start: ns, end: Math.max(ne, ns + 0.1) };
      });
  q.texts = shift(q.texts);
  q.captions = shift(q.captions);
  q.overlays = shift(q.overlays || []);
  q.effects = shift(q.effects || []);
  q.audios = (q.audios || []).filter((x) => !(x.start >= a && x.start + (x.out - x.in) <= b)).map((x) => ({ ...x, start: x.start >= b ? x.start - len : x.start > a ? a : x.start }));
  return touch(q);
}

// Retime clips so each cut lands on a music beat. Every clip gets the length
// of `every` beats (images freely, videos only as far as their source allows).
export function syncToBeats(p, beats, every = 1, offset = 0) {
  const marks = beats.filter((t) => t >= offset).map((t) => t - offset);
  if (marks[0] > 0.05) marks.unshift(0);
  const q = clone(p);
  let k = 0;
  let synced = 0;
  for (const c of q.clips) {
    const from = marks[k];
    const to = marks[k + every];
    if (from === undefined || to === undefined) break;
    const want = (to - from) * c.speed;
    if (c.type === 'image' || c.in + want <= c.srcDuration) {
      c.out = c.in + want;
      synced++;
      k += every;
    } else {
      // Video too short: keep its length and continue from the nearest beat.
      const end = from + clipDuration(c);
      while (marks[k] !== undefined && marks[k] < end - 0.05) k++;
    }
  }
  return { project: touch(q), synced };
}
