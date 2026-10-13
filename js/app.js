import * as S from './state.js';
import { parseCommand, describe } from './commands.js';
import { fmt, parseSrt, toSrt, captionsFromScript, timecode } from './time.js';
import { detectScenes } from './scenes.js';
import { scriptToScenes, renderScene } from './storyboard.js';
import { SFX, renderSfx } from './sfx.js';
import { speak, removeBackground } from './ai.js';
import { decodeLoudness, decodePcm16k, detectBeats, findSilences, keepRanges, findHighlights } from './analysis.js';
import * as DB from './storage.js';
import { Engine } from './engine.js';
import { preloadFastExport } from './fastexport.js';
import { openMovieDialog, openImageDialog } from './studio.js';
import { assembleMovie } from './movie.js';
import { transcribeMedia, toTimeline } from './transcribe.js';
import { t, getLang } from './i18n.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const ICON = {
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  undo: 'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  redo: 'M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  cut: 'M9.64 7.64c.23-.5.36-1.05.36-1.64 0-2.21-1.79-4-4-4S2 3.79 2 6s1.79 4 4 4c.59 0 1.14-.13 1.64-.36L10 12l-2.36 2.36C7.14 14.13 6.59 14 6 14c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4c0-.59-.13-1.14-.36-1.64L12 14l7 7h3v-1L9.64 7.64zM6 8c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zm0 12c-1.1 0-2-.89-2-2s.9-2 2-2 2 .89 2 2-.9 2-2 2zM19 3l-6 6 2 2 7-7V3z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  right: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  canvas: 'M19 12h-2v3h-3v2h5v-5zM7 9h3V7H5v5h2V9zm14-6H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16.01H3V4.99h18v14.02z',
  filter: 'M19.02 10v9H5V5h9V3H5.02c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-9h-2zM17 10l.94-2.06L20 7l-2.06-.94L17 4l-.94 2.06L14 7l2.06.94zm-3.75.75L12 8l-1.25 2.75L8 12l2.75 1.25L12 16l1.25-2.75L16 12z',
  text: 'M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z',
  captions: 'M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z',
  music: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  smart: 'M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z',
  vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  mute: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z',
  prev: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  rotate: 'M7.11 8.53 5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.59-1.01-2.47zm1.01 5.32c1.16.9 2.51 1.44 3.9 1.61V17.9c-.87-.15-1.71-.49-2.46-1.03L7.1 18.32zM13 4.07V1L8.45 5.55 13 10V6.09c2.84.48 5 2.94 5 5.91s-2.16 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93s-3.05-7.44-7-7.93z',
  mirror: 'M15 21h2v-2h-2v2zm4-12h2V7h-2v2zM3 5v14c0 1.1.9 2 2 2h4v-2H5V5h4V3H5c-1.1 0-2 .9-2 2zm16-2v2h2c0-1.1-.9-2-2-2zm-8 20h2V1h-2v22zm8-6h2v-2h-2v2zM15 5h2V3h-2v2zm4 8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2z',
  freeze: 'M22 11h-4.17l3.24-3.24-1.41-1.42L15 11h-2V9l4.66-4.66-1.42-1.41L13 6.17V2h-2v4.17L7.76 2.93 6.34 4.34 11 9v2H9L4.34 6.34 2.93 7.76 6.17 11H2v2h4.17l-3.24 3.24 1.41 1.42L9 13h2v2l-4.66 4.66 1.42 1.41L11 17.83V22h2v-4.17l3.24 3.24 1.42-1.41L13 15v-2h2l4.66 4.66 1.41-1.42L17.83 13H22z',
  enhance: 'M7.5 5.6 10 7 8.6 4.5 10 2 7.5 3.4 5 2l1.4 2.5L5 7zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14zM22 2l-2.5 1.4L17 2l1.4 2.5L17 7l2.5-1.4L22 7l-1.4-2.5zm-7.63 5.29a.996.996 0 0 0-1.41 0L1.29 18.96a.996.996 0 0 0 0 1.41l2.34 2.34c.39.39 1.02.39 1.41 0L16.7 11.05a.996.996 0 0 0 0-1.41l-2.33-2.35zm-1.03 5.49-2.12-2.12 2.44-2.44 2.12 2.12-2.44 2.44z',
  overlay: 'M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z',
  effects: 'M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3-6.2-4.5-6.2 4.5 2.4-7.3L2 9.2h7.6z',
  mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  extract: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  boost: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
  send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
  fit: 'M3 5v4h2V5h4V3H5c-1.1 0-2 .9-2 2zm2 10H3v4c0 1.1.9 2 2 2h4v-2H5v-4zm14 4h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5c0-1.1-.9-2-2-2z',
};
const icon = (n, s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path fill="currentColor" d="${ICON[n]}"/></svg>`;

const TABS = [
  ['edit', 'cut', 'edit'],
  ['music', 'music', 'audio'],
  ['text', 'text', 'text'],
  ['overlay', 'overlay', 'overlay'],
  ['effects', 'effects', 'effects'],
  ['filters', 'filter', 'filters'],
  ['captions', 'captions', 'captions'],
  ['canvas', 'canvas', 'canvas'],
  ['smart', 'smart', 'smart'],
];

// ---------- State ----------
const canvas = $('#preview');
const engine = new Engine(canvas);
const timeline = $('#timeline');
const tlInner = $('#tlInner');
const panel = $('#panel');

let project = null;
let history = new S.History();
let mediaMap = new Map();
let selClip = null;
let selText = null;
let tab = 'edit';
let pps = 40; // timeline pixels per second
let gestureBase = null;
let smartPlan = null;
let busy = false;
let saveTimer = 0;
let expectedScroll = 0;
let capLang = 'auto';
let selOverlay = null;
let selEffect = null;
let selAudio = null;
let recording = null; // voice-over recorder state
let chat = []; // Smart AI conversation: { role: 'user' | 'ai', text, plan?, status? }

// ---------- Utilities ----------
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function confirmDlg(msg) {
  const d = $('#confirmDlg');
  $('#confirmMsg').textContent = msg;
  d.showModal();
  return new Promise((resolve) => {
    const done = (v) => {
      d.close();
      d.querySelector('[data-ok]').onclick = d.querySelector('[data-close]').onclick = null;
      resolve(v);
    };
    d.querySelector('[data-ok]').onclick = () => done(true);
    d.querySelector('[data-close]').onclick = () => done(false);
    d.oncancel = () => done(false);
  });
}

function once(el, ev, ms = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    el.addEventListener(ev, () => (clearTimeout(timer), resolve()), { once: true });
    el.addEventListener('error', () => (clearTimeout(timer), reject(el.error || new Error('media error'))), { once: true });
  });
}

function thumbOf(src, w, h) {
  const c = document.createElement('canvas');
  c.height = 96;
  c.width = Math.max(1, Math.round((96 * w) / h));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

function kindOf(file) {
  const ty = file.type || '';
  if (ty.startsWith('image/')) return 'image';
  if (ty.startsWith('audio/')) return 'audio';
  if (ty.startsWith('video/')) return 'video';
  const ext = file.name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'avif'].includes(ext)) return 'image';
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac'].includes(ext)) return 'audio';
  return 'video';
}

async function probe(file, want) {
  let type = kindOf(file);
  const url = URL.createObjectURL(file);
  try {
    if (type === 'image') {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { type, duration: 0, width: img.naturalWidth, height: img.naturalHeight, thumb: thumbOf(img, img.naturalWidth, img.naturalHeight) };
    }
    const el = document.createElement(type === 'audio' || want === 'audio' ? 'audio' : 'video');
    el.muted = true;
    el.preload = 'auto';
    el.playsInline = true;
    el.src = url;
    await once(el, 'loadedmetadata');
    let duration = el.duration;
    if (!isFinite(duration)) {
      // Recorded WebM files report Infinity until the end is seeked.
      el.currentTime = 1e7;
      await once(el, 'seeked').catch(() => {});
      duration = el.duration;
    }
    if (!isFinite(duration) || duration <= 0) throw new Error('bad duration');
    if (want === 'audio' || type === 'audio' || !el.videoWidth) return { type: 'audio', duration };
    el.currentTime = Math.min(0.5, duration / 3);
    await once(el, 'seeked').catch(() => {});
    if (el.readyState < 2) await once(el, 'loadeddata', 4000).catch(() => {});
    return { type: 'video', duration, width: el.videoWidth, height: el.videoHeight, thumb: thumbOf(el, el.videoWidth, el.videoHeight) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function importFiles(files, want) {
  const out = [];
  for (const f of files) {
    try {
      const info = await probe(f, want);
      if (want !== 'audio' && info.type === 'audio') continue;
      const rec = { id: S.uid(), projectId: project.id, name: f.name, blob: f, ...info };
      await DB.putMedia(rec);
      mediaMap.set(rec.id, rec);
      await engine.addMedia(rec);
      out.push(rec);
    } catch (e) {
      console.warn('[Clipora] import failed', f.name, e);
      toast(`${t('unsupported')} (${f.name})`);
    }
  }
  return out;
}

// ---------- Commit / history ----------
function commit(next, { record = true, panel: rerenderPanel = true } = {}) {
  if (!next || next === project) return;
  if (record) history.push(project);
  project = next;
  engine.setProject(project);
  ensureSelection();
  renderTimeline();
  if (rerenderPanel) renderPanel();
  renderMeta();
  scheduleSave();
}

function live(next) {
  if (!gestureBase) gestureBase = project;
  commit(next, { record: false, panel: false });
}

function endGesture() {
  if (gestureBase && gestureBase !== project) history.push(gestureBase);
  gestureBase = null;
  renderMeta();
}

function undo() {
  const prev = history.undo(project);
  if (!prev) return;
  project = prev;
  afterHistory();
}
function redo() {
  const next = history.redo(project);
  if (!next) return;
  project = next;
  afterHistory();
}
function afterHistory() {
  engine.setProject(project);
  ensureSelection();
  renderTimeline();
  renderPanel();
  renderMeta();
  scheduleSave();
}

function ensureSelection() {
  if (!project.clips.some((c) => c.id === selClip)) selClip = clipAtPlayhead()?.id ?? null;
  if (!project.texts.some((x) => x.id === selText)) selText = null;
  engine.selectedTextId = selText;
}

const clipAtPlayhead = () => S.clipAt(project, engine.time)?.clip;
const curClip = () => project.clips.find((c) => c.id === selClip);
const curText = () => project.texts.find((x) => x.id === selText);
const curOverlay = () => (project.overlays || []).find((x) => x.id === selOverlay);
const curEffect = () => (project.effects || []).find((x) => x.id === selEffect);
const curAudio = () => (project.audios || []).find((x) => x.id === selAudio);

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 500);
}
async function save() {
  clearTimeout(saveTimer);
  if (!project) return;
  const first = project.clips[0] && mediaMap.get(project.clips[0].mediaId);
  project = { ...project, thumb: first?.thumb || '' };
  try {
    await DB.saveProject(project);
  } catch (e) {
    console.error(e);
    toast('Could not save – storage full?');
  }
}

// ---------- Rendering: editor chrome ----------
function renderMeta() {
  $('#undoBtn').disabled = !history.canUndo;
  $('#redoBtn').disabled = !history.canRedo;
  $('#timeTotal').textContent = fmt(engine.duration);
  $('#timeCur').textContent = timecode(engine.time);
  $('#emptyHint').classList.toggle('hidden', project.clips.length > 0);
  $('#exportBtn').disabled = !project.clips.length;
  if (document.activeElement !== $('#nameInput')) $('#nameInput').value = project.name;
}

function updatePlayBtn() {
  $('#playBtn').innerHTML = icon(engine.playing ? 'pause' : 'play', 26);
}

function setScroll(time) {
  timeline.scrollLeft = time * pps;
  expectedScroll = timeline.scrollLeft;
}

function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([id, ic, label]) => `<button class="tab ${tab === id ? 'on' : ''}" data-tab="${id}" type="button">${icon(ic)}<span>${t(label)}</span></button>`).join('');
}

function ruler(total) {
  const step = pps >= 60 ? 1 : pps >= 25 ? 2 : pps >= 12 ? 5 : pps >= 5 ? 10 : 30;
  let h = '';
  for (let s = 0; s <= total + 0.001; s += step) h += `<span style="left:${s * pps}px">${fmt(s).replace(/\.\d$/, '')}</span>`;
  return h;
}

function renderTimeline() {
  const total = S.totalDuration(project);
  const W = Math.max(total * pps, 1);
  const starts = S.clipStarts(project);
  let h = `<div class="ruler" style="width:${W}px">${ruler(total)}</div><div class="lane clips" style="width:${W}px">`;
  project.clips.forEach((c) => {
    const m = mediaMap.get(c.mediaId);
    const w = Math.max(4, S.clipDuration(c) * pps - 2);
    const marks = `${c.speed !== 1 ? ` · ${c.speed}x` : ''}${c.muted ? ' · 🔇' : ''}${c.filter.preset !== 'none' ? ' · ✨' : ''}`;
    h += `<button class="clip ${c.id === selClip ? 'sel' : ''}" data-clip="${c.id}" type="button" style="width:${w}px;background-image:url('${m?.thumb || ''}')"><span class="badge">${fmt(S.clipDuration(c))}${marks}</span></button>`;
  });
  project.clips.forEach((c, i) => {
    if (i > 0) h += `<button class="trans ${c.transition && c.transition !== 'none' ? 'on' : ''}" data-trans="${c.id}" type="button" style="left:${starts[i] * pps - 1}px" aria-label="Transition">◆</button>`;
  });
  h += '</div>';
  if (project.clips.some((c) => c.type === 'video' && !c.muted)) {
    h += `<div class="lane wave" style="width:${W}px">`;
    project.clips.forEach((c, i) => {
      const w = Math.max(4, S.clipDuration(c) * pps - 2);
      const img = c.type === 'video' && !c.muted ? waveImage(c, w) : '';
      h += `<span style="left:${starts[i] * pps}px;width:${w}px;${img ? `background-image:url('${img}')` : ''}"></span>`;
    });
    h += '</div>';
  }
  const lane = (cls, items, label) =>
    `<div class="lane" style="width:${W}px">${items
      .map((x) => `<button class="bar ${cls} ${x.id === selText && cls === 'text' ? 'sel' : ''}" data-${cls}="${x.id}" type="button" style="left:${x.start * pps}px;width:${Math.max(6, (Math.min(x.end, total) - x.start) * pps)}px">${esc(label(x))}</button>`)
      .join('')}</div>`;
  const bars = (cls, items, sel, label, end = (x) => x.end) =>
    items.length
      ? `<div class="lane" style="width:${W}px">${items
          .map((x) => `<button class="bar ${cls} ${x.id === sel ? 'sel' : ''}" data-${cls}="${x.id}" type="button" style="left:${x.start * pps}px;width:${Math.max(6, (Math.min(end(x), total) - x.start) * pps)}px">${esc(label(x))}</button>`)
          .join('')}</div>`
      : '';
  h += bars('ov', project.overlays || [], selOverlay, (x) => (x.kind === 'sticker' ? x.text : x.kind === 'blur' ? '▦ Blur' : `🖼 ${mediaMap.get(x.mediaId)?.name || ''}`));
  h += bars('fx', project.effects || [], selEffect, (x) => `${FX_ICON[x.type]} ${FX_NAME[x.type]}`);
  if (project.texts.length) h += lane('text', project.texts, (x) => x.text);
  if (project.captions.length) h += lane('cap', project.captions, (x) => x.text);
  if (project.music) {
    const m = mediaMap.get(project.music.mediaId);
    h += lane('music', [{ id: 'm', start: 0, end: total }], () => `♪ ${m?.name || 'Music'}`);
  }
  h += bars('aud', project.audios || [], selAudio, (x) => `${x.kind === 'voice' ? '🎙' : x.kind === 'sfx' ? '💥' : x.kind === 'tts' ? '🗣' : '🎵'} ${mediaMap.get(x.mediaId)?.name || ''}`, (x) => x.start + x.out - x.in);
  tlInner.innerHTML = h;
  setScroll(engine.time);
}

// Audio waveform under each video clip (decoded once per media file, in the background).
const waveData = new Map();
const waveImgs = new Map();
function waveImage(c, w) {
  const m = mediaMap.get(c.mediaId);
  if (!m) return '';
  if (!waveData.has(m.id)) {
    waveData.set(m.id, null);
    if (m.duration <= 900)
      decodeLoudness(m.id, m.blob).then(
        (an) => {
          let max = 1e-4;
          for (const v of an.rms) max = Math.max(max, v);
          waveData.set(m.id, { ...an, max });
          if (project) renderTimeline();
        },
        () => {},
      );
  }
  const an = waveData.get(m.id);
  if (!an) return '';
  const W = Math.min(4000, Math.round(w));
  const key = `${m.id}:${c.in}:${c.out}:${W}`;
  if (waveImgs.has(key)) return waveImgs.get(key);
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = 30;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#5fae4e';
  for (let x = 0; x < W; x += 2) {
    const t0 = c.in + ((c.out - c.in) * x) / W;
    const t1 = c.in + ((c.out - c.in) * (x + 2)) / W;
    let v = 0;
    for (let k = Math.floor(t0 / an.win); k <= Math.floor(t1 / an.win) && k < an.rms.length; k++) v = Math.max(v, an.rms[k] || 0);
    const hgt = Math.max(1, Math.sqrt(v / an.max) * 28);
    ctx.fillRect(x, 15 - hgt / 2, 1.5, hgt);
  }
  const url = cv.toDataURL('image/png');
  if (waveImgs.size > 300) waveImgs.clear();
  waveImgs.set(key, url);
  return url;
}

// ---------- Panels ----------
const field = (label, key, val, min, max, step, out, extra = '') =>
  `<label class="field"><span>${label}</span><input type="range" data-in="${key}" min="${min}" max="${max}" step="${step}" value="${val}" ${extra}><output>${out}</output></label>`;

// Asset library: every photo/video imported into this project, tap to add again.
function library() {
  const items = [...mediaMap.values()].filter((m) => m.type !== 'audio' && m.projectId === project.id);
  if (!items.length) return '';
  return `<div class="label">${t('library')} · ${items.length}</div><div class="row scroll lib">${items
    .map((m) => `<button class="lib-item" data-act="libAdd" data-id="${m.id}" type="button" style="background-image:url('${m.thumb || ''}')"><span>${m.type === 'video' ? fmt(m.duration).replace(/\.\d$/, '') : '🖼'}</span></button>`)
    .join('')}</div>`;
}

const pct = (v) => `${Math.round(v * 100)}%`;
const chips = (list, cur, act, label = (x) => x) =>
  list.map((v) => `<button class="chip ${cur === v ? 'on' : ''}" data-act="${act}" data-v="${v}" type="button">${esc(label(v))}</button>`).join('');
const NICE = { none: 'None', fade: 'Dip black', dissolve: 'Dissolve', slide: 'Slide', push: 'Push', wipe: 'Wipe', zoom: 'Zoom', flash: 'Flash', blur: 'Blur', spin: 'Spin',
  fadeIn: 'Fade in', zoomIn: 'Zoom in', zoomOut: 'Zoom out', slideUp: 'Slide up', slideLeft: 'Slide left', spinIn: 'Spin in', bounce: 'Bounce', fadeOut: 'Fade out', slideDown: 'Slide down', spinOut: 'Spin out' };
const nice = (v) => NICE[v] || v;

function panelEdit() {
  const c = curClip();
  if (!c) return `<p class="hint">${t(project.clips.length ? 'selectClip' : 'empty')}</p>${library()}`;
  const vid = c.type === 'video';
  const idx = project.clips.findIndex((x) => x.id === c.id);
  const tools = [
    ['split', 'cut', t('split')],
    ['del', 'trash', t('delete')],
    ['dup', 'copy', t('duplicate')],
    ['enhance', 'enhance', c.enhance ? 'Enhanced ✓' : 'Enhance HD'],
    ...(vid ? [['freeze', 'freeze', 'Freeze'], ['boostClip', 'boost', 'Boost vol'], ['extract', 'extract', 'Extract audio']] : []),
    ['rotate', 'rotate', 'Rotate'],
    ['mirror', 'mirror', 'Mirror'],
    ['fit', 'fit', c.fit === 'fill' ? t('fit') : t('fill')],
    ...(vid ? [['mute', c.muted ? 'vol' : 'mute', c.muted ? t('unmute') : t('mute')]] : []),
    ['left', 'left', t('moveLeft')],
    ['right', 'right', t('moveRight')],
  ];
  let h = `<div class="row scroll">${tools.map(([a, ic, l]) => `<button class="tool ${(a === 'enhance' && c.enhance) || (a === 'mirror' && c.flipH) ? 'on' : ''}" data-act="${a}" type="button">${icon(ic, 20)}<span>${l}</span></button>`).join('')}</div>`;
  if (vid) {
    h += field(t('trimStart'), 'clipIn', c.in, 0, c.srcDuration, 0.05, fmt(c.in));
    h += field(t('trimEnd'), 'clipOut', c.out, 0, c.srcDuration, 0.05, fmt(c.out));
    h += field(t('speed'), 'speed', c.speed, 0.25, 4, 0.05, `${c.speed}x`);
    h += `<div class="row">${[0.5, 1, 1.5, 2, 3].map((v) => `<button class="chip ${c.speed === v ? 'on' : ''}" data-act="speedChip" data-v="${v}" type="button">${v}x</button>`).join('')}</div>`;
    h += `<div class="label">Sound</div>`;
    h += field(t('volume'), 'volume', Math.round(c.volume * 100), 0, 500, 1, `${Math.round(c.volume * 100)}%`);
    h += `<div class="row"><button class="chip" data-act="boostClip" type="button">🔊 Auto boost</button>
      <button class="chip ${c.denoise ? 'on' : ''}" data-act="denoise" type="button">Reduce noise</button>
      <button class="chip ${c.voice ? 'on' : ''}" data-act="voice" type="button">Enhance voice</button></div>`;
  } else {
    h += field(t('duration'), 'imgDur', c.out - c.in, 0.5, 20, 0.1, `${(c.out - c.in).toFixed(1)}s`);
  }
  h += `<div class="label">Crop & zoom</div>`;
  h += field('Zoom', 'clipZoom', c.zoom || 1, 1, 4, 0.01, `${(c.zoom || 1).toFixed(2)}x`);
  if ((c.zoom || 1) > 1 || c.fit === 'fill') {
    h += field('Move X', 'panX', c.panX || 0, -1, 1, 0.01, (c.panX || 0).toFixed(2));
    h += field('Move Y', 'panY', c.panY || 0, -1, 1, 0.01, (c.panY || 0).toFixed(2));
  }
  h += `<div class="label">Animation in</div><div class="row scroll">${chips(S.CLIP_ANIMS_IN, c.animIn || 'none', 'animIn', nice)}</div>`;
  h += `<div class="label">Animation out</div><div class="row scroll">${chips(S.CLIP_ANIMS_OUT, c.animOut || 'none', 'animOut', nice)}</div>`;
  if (idx > 0) h += `<div class="label">Transition into this clip</div><div class="row scroll">${chips(S.TRANSITIONS, c.transition || 'none', 'transType', nice)}</div>
    <div class="row"><button class="chip" data-act="transAll" type="button">Apply transition to all</button></div>`;
  return h + library();
}

function panelCanvas() {
  const ratios = [['9:16', 'Reels · TikTok'], ['1:1', 'Square'], ['4:5', 'Instagram'], ['16:9', 'YouTube']];
  const bg = project.background;
  return `<div class="label">${t('ratio')}</div>
    <div class="row">${ratios.map(([r, l]) => `<button class="chip ${project.aspect === r ? 'on' : ''}" data-act="ratio" data-v="${r}" type="button">${r} <small>${l}</small></button>`).join('')}</div>
    <div class="label">${t('background')}</div>
    <div class="row">
      <button class="chip ${bg.mode === 'blur' ? 'on' : ''}" data-act="bg" data-v="blur" type="button">${t('blur')}</button>
      <button class="chip ${bg.mode === 'color' && bg.color === '#000000' ? 'on' : ''}" data-act="bg" data-v="#000000" type="button">${t('black')}</button>
      <button class="chip ${bg.mode === 'color' && bg.color === '#ffffff' ? 'on' : ''}" data-act="bg" data-v="#ffffff" type="button">${t('white')}</button>
      <label class="chip">${t('color')} <input type="color" data-in="bgColor" value="${bg.color}"></label>
    </div>`;
}

const ADJ_LABEL = { exposure: 'Exposure', temp: 'Temperature', tint: 'Tint', highlights: 'Highlights', shadows: 'Shadows', sharpen: 'Sharpen', smoothSkin: 'Smooth skin', vignette: 'Vignette', grain: 'Grain' };

function panelFilters() {
  const c = curClip();
  if (!c) return `<p class="hint">${t('selectClip')}</p>`;
  const thumb = mediaMap.get(c.mediaId)?.thumb || '';
  const f = c.filter;
  let h = `<div class="card enh"><div><h4>✨ Enhance HD</h4><p class="hint">Makes blurry, dark or noisy video clear: auto-brightens dark scenes, sharpens details, removes noise and boosts colour.</p></div>
    <button class="btn-primary sm" data-act="enhance" type="button">${c.enhance ? 'On ✓' : 'Make clear'}</button></div>`;
  h += `<div class="row scroll">${Object.keys(S.FILTERS)
    .map((name) => `<button class="swatch ${f.preset === name ? 'on' : ''}" data-act="preset" data-v="${name}" type="button"><img src="${thumb}" alt="" style="filter:${S.filterCss({ preset: name })}"><span>${name}</span></button>`)
    .join('')}</div>
    <div class="label">Adjust</div>
    ${field(t('brightness'), 'brightness', f.brightness, 0.5, 1.5, 0.01, f.brightness.toFixed(2))}
    ${field(t('contrast'), 'contrast', f.contrast, 0.5, 1.5, 0.01, f.contrast.toFixed(2))}
    ${field(t('saturation'), 'saturation', f.saturation, 0, 2, 0.01, f.saturation.toFixed(2))}`;
  for (const [k, [lo, hi]] of Object.entries(S.ADJUST)) h += field(ADJ_LABEL[k], `adj:${k}`, f[k] || 0, lo, hi, 0.01, (f[k] || 0).toFixed(2));
  h += `<div class="row"><button class="btn-ghost" data-act="filterAll" type="button">${t('applyAll')}</button>
    <button class="chip" data-act="adjReset" type="button">Reset</button></div>`;
  return h;
}

const COLORS = ['#ffffff', '#000000', '#FFE14D', '#FF5FA2', '#B553DE', '#22D3EE', '#4ADE80', '#FF7A45'];
const TEXT_TEMPLATES = {
  Title: { text: 'BIG TITLE', size: 0.11, color: '#ffffff', font: 'impact', bg: false, outline: '#000000', anim: 'zoom' },
  Subscribe: { text: '🔔 SUBSCRIBE', size: 0.07, color: '#ffffff', font: 'bold', bg: true, bgColor: '#e5252a', anim: 'bounce', y: 0.82 },
  Neon: { text: 'Neon vibes', size: 0.09, color: '#ff5fd2', font: 'hand', bg: false, outline: 'none', glow: true, anim: 'blink' },
  Quote: { text: '“Make it simple”', size: 0.065, color: '#fff8e7', font: 'serif', bg: true, bgColor: '#2b2118', anim: 'fade' },
  Tag: { text: '#trending', size: 0.06, color: '#2b2118', font: 'bold', bg: true, bgColor: '#ffd36b', anim: 'pop', y: 0.15 },
  Typewriter: { text: 'Once upon a time…', size: 0.06, color: '#ffffff', font: 'mono', bg: false, anim: 'typewriter' },
};

function panelText() {
  const x = curText();
  let h = `<div class="label">Templates</div><div class="row scroll">${Object.keys(TEXT_TEMPLATES).map((k) => `<button class="chip" data-act="textTpl" data-v="${k}" type="button">${k}</button>`).join('')}</div>
    <div class="row"><button class="btn-primary sm" data-act="addText" type="button">+ ${t('addText')}</button>
    ${project.texts.map((it) => `<button class="chip ${it.id === selText ? 'on' : ''}" data-act="selText" data-id="${it.id}" type="button">${esc(it.text.slice(0, 14) || '…')}</button>`).join('')}</div>`;
  if (!x) return h;
  const total = Math.max(engine.duration, 0.1);
  h += `<textarea data-in="textBody" rows="2" placeholder="${esc(t('textPlaceholder'))}">${esc(x.text)}</textarea>
    <p class="hint">${t('dragHint')}</p>
    ${field(t('size'), 'textSize', x.size, 0.03, 0.18, 0.005, Math.round(x.size * 100))}
    <div class="label">Font</div><div class="row scroll">${Object.keys(S.FONTS).map((k) => `<button class="chip font-${k} ${(x.font || 'bold') === k ? 'on' : ''}" data-act="textFont" data-v="${k}" type="button">${k}</button>`).join('')}</div>
    <div class="row">${COLORS.map((c) => `<button class="dot ${x.color.toLowerCase() === c.toLowerCase() ? 'on' : ''}" data-act="textColor" data-v="${c}" type="button" style="background:${c}" aria-label="${c}"></button>`).join('')}
      <input type="color" data-in="textColor" value="${x.color}">
      <button class="chip ${x.bg ? 'on' : ''}" data-act="textBg" type="button">${t('textBg')}</button>
      <button class="chip ${x.outline === 'none' ? '' : 'on'}" data-act="textOutline" type="button">Outline</button>
      <button class="chip ${x.glow ? 'on' : ''}" data-act="textGlow" type="button">Glow</button></div>
    <div class="label">${t('animation')}</div>
    <div class="row">${[...S.TEXT_ANIMS, 'bounce', 'zoom', 'blink'].map((a) => `<button class="chip ${x.anim === a ? 'on' : ''}" data-act="textAnim" data-v="${a}" type="button">${a}</button>`).join('')}</div>
    ${field(t('start'), 'textStart', x.start, 0, total, 0.05, fmt(x.start))}
    ${field(t('end'), 'textEnd', x.end, 0, total, 0.05, fmt(x.end))}
    <div class="row"><button class="chip" data-act="textStartHere" type="button">${t('start')} = ▶ ${t('setToPlayhead')}</button>
      <button class="chip" data-act="textEndHere" type="button">${t('end')} = ▶ ${t('setToPlayhead')}</button>
      <button class="btn-danger" data-act="delText" type="button">${t('delete')}</button></div>`;
  return h;
}

const CAP_LANGS = [['auto', 'autoDetect'], ['english', 'English'], ['bengali', 'Bengali'], ['hindi', 'Hindi'], ['arabic', 'Arabic'], ['spanish', 'Spanish'], ['urdu', 'Urdu']];

function panelCaptions() {
  return `<div class="card"><h4>🤖 ${t('aiCaptions')}</h4><p class="hint">${t('aiCaptionsDesc')}</p>
      <div class="row">${CAP_LANGS.map(([v, l]) => `<button class="chip ${capLang === v ? 'on' : ''}" data-act="capLang" data-v="${v}" type="button">${v === 'auto' ? t(l) : l}</button>`).join('')}</div>
      <button class="btn-primary sm" data-act="autoCaps" type="button">✨ ${t('aiCaptions')}</button></div>
    <div class="label">${t('captionStyle')}</div>
    <div class="row">${S.CAPTION_STYLES.map((s) => `<button class="chip ${project.captionStyle === s ? 'on' : ''}" data-act="capStyle" data-v="${s}" type="button">${s}</button>`).join('')}</div>
    <textarea id="scriptBox" rows="3" placeholder="${esc(t('scriptPlaceholder'))}"></textarea>
    <div class="row" style="margin-top:8px">
      <button class="btn-primary sm" data-act="genCaps" type="button">${t('generate')}</button>
      <button class="chip" data-act="addCap" type="button">+ ${t('addCaption')}</button>
      <button class="chip" data-act="importSrt" type="button">${t('importSrt')}</button>
      <button class="chip" data-act="exportSrt" type="button" ${project.captions.length ? '' : 'disabled'}>${t('exportSrt')}</button>
      ${project.captions.length ? `<button class="chip" data-act="clearCaps" type="button">${t('clearAll')}</button>` : ''}
    </div>
    ${project.captions.length
      ? project.captions
          .map((c) => `<div class="cap-row"><button class="t" data-act="capSeek" data-id="${c.id}" type="button">${fmt(c.start)}<br>${fmt(c.end)}</button>
          <input class="txt" data-in="capText" data-id="${c.id}" value="${esc(c.text)}">
          <button class="icon-btn sm" data-act="cutCap" data-id="${c.id}" type="button" title="${esc(t('cutPart'))}" aria-label="${esc(t('cutPart'))}">✂</button>
          <button class="icon-btn sm" data-act="delCap" data-id="${c.id}" type="button" aria-label="${t('delete')}">${icon('trash', 18)}</button></div>`)
          .join('')
      : `<p class="hint">${t('noCaptions')}</p>`}`;
}

function audioRows() {
  const list = project.audios || [];
  if (!list.length) return '';
  return `<div class="label">Audio tracks · ${list.length}</div>${list
    .map((a) => {
      const m = mediaMap.get(a.mediaId);
      const on = a.id === selAudio;
      let h = `<div class="track ${on ? 'on' : ''}"><button class="t" data-act="selAudio" data-id="${a.id}" type="button">${a.kind === 'voice' ? '🎙' : a.kind === 'sfx' ? '💥' : a.kind === 'tts' ? '🗣' : '🎵'} ${esc(m?.name || 'Audio')} <small>@ ${fmt(a.start)}</small></button>
        <button class="icon-btn sm" data-act="delAudio" data-id="${a.id}" type="button" aria-label="Delete">${icon('trash', 18)}</button></div>`;
      if (on) {
        h += field(t('volume'), 'audVol', Math.round((a.volume ?? 1) * 100), 0, 500, 1, `${Math.round((a.volume ?? 1) * 100)}%`);
        h += `<div class="row"><button class="chip" data-act="audHere" type="button">Move to ▶ playhead</button>
          <button class="chip ${a.fadeIn ? 'on' : ''}" data-act="audFadeIn" type="button">Fade in</button>
          <button class="chip ${a.fadeOut ? 'on' : ''}" data-act="audFadeOut" type="button">Fade out</button>
          <button class="chip ${a.denoise ? 'on' : ''}" data-act="audDenoise" type="button">Reduce noise</button></div>`;
      }
      return h;
    })
    .join('')}`;
}

function panelMusic() {
  const m = project.music;
  const muteAll = `<button class="chip ${project.clips.length && project.clips.every((c) => c.muted) ? 'on' : ''}" data-act="muteOriginal" type="button">${t('muteOriginal')}</button>`;
  let h = `<div class="row scroll tools-row">
    <button class="tool" data-act="addMusic" type="button">${icon('music', 20)}<span>${m ? t('replace') : t('addMusic')}</span></button>
    <button class="tool ${recording ? 'rec' : ''}" data-act="record" type="button">${icon('mic', 20)}<span>${recording ? '■ Stop' : 'Voiceover'}</span></button>
    <button class="tool" data-act="boostAll" type="button">${icon('boost', 20)}<span>Boost all</span></button>
    <button class="tool" data-act="denoiseAll" type="button">${icon('mute', 20)}<span>Reduce noise</span></button>
    <button class="tool" data-act="extract" type="button">${icon('extract', 20)}<span>Extract audio</span></button></div>`;
  if (m) {
    const rec = mediaMap.get(m.mediaId);
    h += `<div class="row"><b>♪ ${esc(rec?.name || 'Music')}</b></div>
    ${field(t('volume'), 'musicVol', Math.round((m.volume ?? 1) * 100), 0, 300, 1, `${Math.round((m.volume ?? 1) * 100)}%`)}
    ${field(t('startAt'), 'musicOffset', m.offset || 0, 0, Math.max(0, (rec?.duration || 1) - 0.5), 0.1, fmt(m.offset || 0))}
    <div class="row"><button class="chip ${m.loop ? 'on' : ''}" data-act="musicLoop" type="button">${t('loop')}</button>
      <button class="chip ${m.fadeIn ? 'on' : ''}" data-act="musicFadeIn" type="button">Fade in</button>
      <button class="chip ${m.fadeOut ? 'on' : ''}" data-act="musicFadeOut" type="button">Fade out</button>${muteAll}
      <button class="btn-danger" data-act="removeMusic" type="button">${t('remove')}</button></div>
    <div class="card"><h4>🥁 ${t('beatSync')}</h4><p class="hint">${t('beatSyncDesc')}</p>
      <div class="row">${[1, 2, 4].map((n) => `<button class="chip" data-act="beats" data-v="${n}" type="button">${t('everyBeats')(n)}</button>`).join('')}</div></div>`;
  } else h += `<div class="row">${muteAll}</div>`;
  h += `<div class="label">Sound effects · tap to add at playhead</div>
    <div class="row sfx">${Object.keys(SFX).map((k) => `<button class="chip" data-act="sfx" data-v="${k}" type="button">${k}</button>`).join('')}</div>
    <div class="card"><h4>🗣 AI Voice (text to speech)</h4><p class="hint">Type a script and an AI voice reads it as a voice-over, on your phone. First use downloads the voice model (~30 MB).</p>
      <textarea id="ttsBox" rows="2" placeholder="Type what the voice should say…"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn-primary sm" data-act="tts" type="button">Create voice</button></div></div>`;
  return h + audioRows();
}

function panelOverlay() {
  const o = curOverlay();
  const list = project.overlays || [];
  let h = `<div class="row scroll tools-row">
    <button class="tool" data-act="addOverlay" type="button">${icon('overlay', 20)}<span>Picture / video</span></button>
    <button class="tool" data-act="addBlur" type="button">${icon('filter', 20)}<span>Blur area</span></button>
    <button class="tool ${project.progressBar ? 'on' : ''}" data-act="progressBar" type="button">${icon('right', 20)}<span>Progress bar</span></button></div>
    <div class="label">Stickers</div><div class="row stickers">${S.STICKERS.map((e) => `<button class="sticker" data-act="sticker" data-v="${e}" type="button">${e}</button>`).join('')}</div>`;
  if (list.length)
    h += `<div class="row scroll">${list.map((x) => `<button class="chip ${x.id === selOverlay ? 'on' : ''}" data-act="selOverlay" data-id="${x.id}" type="button">${x.kind === 'sticker' ? x.text : x.kind === 'blur' ? '▦ Blur' : x.type === 'video' ? '🎞 Video' : '🖼 Picture'}</button>`).join('')}</div>`;
  if (!o) return h + `<p class="hint">Add pictures, logos, videos (picture-in-picture), stickers or a blur box over faces and number plates. Drag them on the preview.</p>`;
  const total = Math.max(engine.duration, 0.1);
  h += `<p class="hint">${t('dragHint').replace('text', 'item')}</p>`;
  h += field('Size', 'ovScale', o.scale, 0.05, 1.2, 0.01, pct(o.scale));
  if (o.kind !== 'blur') h += field('Rotate', 'ovRot', o.rotation || 0, -180, 180, 1, `${o.rotation || 0}°`);
  else h += field('Height', 'ovRatio', o.ratio || 0.6, 0.2, 2, 0.01, (o.ratio || 0.6).toFixed(2));
  if (o.kind !== 'blur') h += field('Opacity', 'ovOpacity', o.opacity ?? 1, 0.1, 1, 0.01, pct(o.opacity ?? 1));
  if (o.kind === 'media') {
    h += `<div class="row">${chips(['rect', 'round', 'circle'], o.shape || 'rect', 'ovShape')}
      <button class="chip ${o.border ? 'on' : ''}" data-act="ovBorder" type="button">Border</button>
      <button class="chip ${o.flipH ? 'on' : ''}" data-act="ovFlip" type="button">Mirror</button></div>
    <div class="card"><h4>🟩 Chroma key (green screen)</h4>
      <div class="row"><button class="chip ${o.chroma ? 'on' : ''}" data-act="ovChroma" type="button">${o.chroma ? 'On' : 'Off'}</button>
      <label class="chip">Key colour <input type="color" data-in="ovKey" value="${o.keyColor || '#00ff00'}"></label></div>
      ${o.chroma ? field('Strength', 'ovChromaS', o.chroma, 0.05, 1, 0.01, pct(o.chroma)) : ''}</div>`;
    if (o.type === 'image') h += `<div class="card"><h4>✂️ Remove background (AI)</h4><p class="hint">Cuts the person or object out of the picture. First use downloads the AI model (~7 MB).</p>
      <button class="btn-primary sm" data-act="cutout" type="button">Remove background</button></div>`;
  }
  if (o.kind !== 'blur') h += `<div class="label">${t('animation')}</div><div class="row">${chips(['none', 'pop', 'fade', 'float'], o.anim || 'none', 'ovAnim')}</div>`;
  h += field(t('start'), 'ovStart', o.start, 0, total, 0.05, fmt(o.start));
  h += field(t('end'), 'ovEnd', o.end, 0, total, 0.05, fmt(o.end));
  h += `<div class="row"><button class="chip" data-act="ovFull" type="button">Whole video</button>
    <button class="chip" data-act="ovDup" type="button">${t('duplicate')}</button>
    <button class="btn-danger" data-act="delOverlay" type="button">${t('delete')}</button></div>`;
  return h;
}

const FX_ICON = { shake: '📳', zoomPulse: '💓', glitch: '⚡', vhs: '📼', oldFilm: '🎞', flash: '⚪', blurIn: '🌫', bwPop: '⚫', mirror: '🪞', invert: '🔄', pixelate: '👾', heartbeat: '❤️' };
const FX_NAME = { shake: 'Shake', zoomPulse: 'Zoom pulse', glitch: 'Glitch', vhs: 'VHS', oldFilm: 'Old film', flash: 'Flash', blurIn: 'Blur in', bwPop: 'B&W', mirror: 'Mirror', invert: 'Invert', pixelate: 'Pixelate', heartbeat: 'Heartbeat' };

function panelEffects() {
  const f = curEffect();
  const list = project.effects || [];
  let h = `<p class="hint">Tap an effect to add it at the playhead (2 s). Effects are shown in the timeline.</p>
    <div class="fx-grid">${S.EFFECTS.map((k) => `<button class="fx" data-act="addFx" data-v="${k}" type="button"><span>${FX_ICON[k]}</span>${FX_NAME[k]}</button>`).join('')}</div>`;
  if (list.length) h += `<div class="row scroll">${list.map((x) => `<button class="chip ${x.id === selEffect ? 'on' : ''}" data-act="selFx" data-id="${x.id}" type="button">${FX_ICON[x.type]} ${FX_NAME[x.type]}</button>`).join('')}</div>`;
  if (!f) return h;
  const total = Math.max(engine.duration, 0.1);
  h += field('Intensity', 'fxInt', f.intensity ?? 1, 0.1, 1.5, 0.01, pct(f.intensity ?? 1));
  h += field(t('start'), 'fxStart', f.start, 0, total, 0.05, fmt(f.start));
  h += field(t('end'), 'fxEnd', f.end, 0, total, 0.05, fmt(f.end));
  h += `<div class="row"><button class="chip" data-act="fxClip" type="button">Fit to clip</button><button class="chip" data-act="fxFull" type="button">Whole video</button>
    <button class="btn-danger" data-act="delFx" type="button">${t('delete')}</button></div>`;
  return h;
}

function chatMsg(m, i) {
  if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
  let h = `<div class="msg ai"><b>✨ Clipora AI</b>`;
  if (m.text) h += `<p>${esc(m.text)}</p>`;
  if (m.plan) {
    h += `<ul class="plan">${m.plan.actions.map((a) => `<li>${esc(describe(a))}</li>`).join('')}
      ${m.plan.unknown.map((u) => `<li class="bad">${t('notUnderstood')}: “${esc(u)}”</li>`).join('')}</ul>`;
    if (m.status === 'pending' && i === chat.length - 1)
      h += `<div class="row end"><button class="btn-ghost" data-act="smartCancel" type="button">${t('cancel')}</button>
        <button class="btn-primary sm" data-act="smartApply" type="button" ${m.plan.actions.length ? '' : 'disabled'}>${t('apply')}</button></div>`;
    else if (m.status === 'done') h += `<small class="ok">✓ ${t('applied')}</small>`;
    else if (m.status === 'cancelled') h += `<small class="dim">${t('cancelled')}</small>`;
  }
  return `${h}</div>`;
}

function panelSmart() {
  let h = `<div class="chat">${chat.length ? chat.slice(-8).map((m, k) => chatMsg(m, chat.length - Math.min(8, chat.length) + k)).join('') : `<div class="msg ai"><b>✨ Clipora AI</b><p>${t('chatHello')}</p></div>`}</div>`;
  h += `<div class="smart-input"><input id="smartBox" class="txt" placeholder="${esc(t('smartPlaceholder'))}" enterkeyhint="send">
    <button class="btn-primary sm send" data-act="smartGo" type="button" aria-label="${t('go')}">${icon('send', 18)}</button></div>`;
  if (!chat.length || chat[chat.length - 1].status !== 'pending')
    h += `<div class="row scroll">${t('suggestions').map((x) => `<button class="chip" data-act="smartChip" data-v="${esc(x)}" type="button">${esc(x)}</button>`).join('')}</div>`;
  const st = t('styles');
  h += `<div class="label">${t('quickStyles')}</div><div class="row">${Object.keys(STYLES).map((k) => `<button class="chip" data-act="style" data-v="${k}" type="button">${esc(st[k])}</button>`).join('')}</div>`;
  h += `<div class="card studio-mini"><h4>✨ AI Studio</h4><p class="hint">Make a full movie from an idea or story, or create a picture with AI.</p>
      <div class="row"><button class="btn-primary sm" data-act="aiMovie" type="button">✨ AI Movie</button><button class="chip" data-act="aiImage" type="button">🖼 AI Image</button></div></div>`;
  h += `<div class="card"><h4>🎬 ${t('scriptVideo')}</h4><p class="hint">${t('scriptVideoDesc')}</p>
      <textarea id="storyBox" rows="3" placeholder="${esc(t('scriptVideoPh'))}"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn-primary sm" data-act="storyboard" type="button">${t('makeVideo')}</button>
      <button class="chip ${storyPhotos ? 'on' : ''}" data-act="storyPhotos" type="button">${t('usePhotos')}</button></div></div>
    <div class="card"><h4>🎞️ ${t('sceneSplit')}</h4><p class="hint">${t('sceneSplitDesc')}</p>
      <div class="row"><button class="btn-primary sm" data-act="scenes" data-v="selected" type="button">${t('selectedClip')}</button>
      <button class="chip" data-act="scenes" data-v="all" type="button">${t('allClips')}</button></div></div>
    <div class="card"><h4>✂️ ${t('removePauses')}</h4><p class="hint">${t('removePausesDesc')}</p>
      <div class="row"><button class="btn-primary sm" data-act="pauses" data-v="selected" type="button">${t('selectedClip')}</button>
      <button class="chip" data-act="pauses" data-v="all" type="button">${t('allClips')}</button></div></div>
    <div class="card"><h4>⚡ ${t('autoShorts')}</h4><p class="hint">${t('autoShortsDesc')}</p>
      <div class="row">${[15, 30, 60].map((x) => `<button class="chip" data-act="shorts" data-v="${x}" type="button">${x}s</button>`).join('')}</div></div>`;
  return h;
}

let storyPhotos = false;

const STYLES = {
  vlog: [{ type: 'aspect', value: '9:16' }, { type: 'background', value: { mode: 'blur' } }, { type: 'filter', value: 'warm', scope: 'all' }, { type: 'transition', value: 'fade' }, { type: 'captionStyle', value: 'pop' }],
  podcast: [{ type: 'removePauses', scope: 'all' }, { type: 'aspect', value: '9:16' }, { type: 'fit', value: 'fill', scope: 'all' }, { type: 'captionStyle', value: 'box' }],
  slideshow: [{ type: 'aspect', value: '9:16' }, { type: 'filter', value: 'vivid', scope: 'all' }, { type: 'transition', value: 'fade' }, { type: 'beatSync', value: 2 }],
  cinematic: [{ type: 'aspect', value: '16:9' }, { type: 'background', value: { mode: 'color', color: '#000000' } }, { type: 'filter', value: 'drama', scope: 'all' }, { type: 'transition', value: 'fade' }],
};

const PANELS = { edit: panelEdit, canvas: panelCanvas, filters: panelFilters, text: panelText, captions: panelCaptions, music: panelMusic, overlay: panelOverlay, effects: panelEffects, smart: panelSmart };

function renderPanel() {
  const keep = $('#smartBox')?.value;
  const story = $('#storyBox')?.value;
  panel.innerHTML = PANELS[tab]();
  if (keep && $('#smartBox')) $('#smartBox').value = keep;
  if (story && $('#storyBox')) $('#storyBox').value = story;
  $('.chat')?.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
}

function setTab(id) {
  tab = id;
  renderTabs();
  renderPanel();
}

// ---------- Smart actions ----------
function targetVideoClips(p, scope) {
  if (scope === 'all') return p.clips.filter((c) => c.type === 'video');
  const c = p.clips.find((x) => x.id === selClip && x.type === 'video') || p.clips.find((x) => x.type === 'video');
  return c ? [c] : [];
}

async function loudnessFor(clip) {
  const m = mediaMap.get(clip.mediaId);
  try {
    return await decodeLoudness(m.id, m.blob);
  } catch (e) {
    console.warn('[Clipora] decode failed', e);
    return null;
  }
}

async function removePauses(p, scope) {
  let removed = 0;
  let saved = 0;
  for (const c of targetVideoClips(p, scope)) {
    const an = await loudnessFor(c);
    if (!an) {
      toast(t('noAudio'));
      continue;
    }
    const sil = findSilences(an.rms, an.win);
    const keep = keepRanges(sil, c.in, c.out);
    const after = keep.reduce((s, r) => s + r.end - r.start, 0);
    if (keep.length && after < c.out - c.in - 0.2) {
      removed += sil.filter((s) => s.end > c.in && s.start < c.out).length;
      saved += (c.out - c.in - after) / c.speed;
      p = S.replaceWithRanges(p, c.id, keep);
    }
  }
  toast(removed ? t('pausesRemoved')(removed, saved.toFixed(1)) : t('noPauses'));
  return p;
}

async function autoShorts(p, length) {
  const vids = targetVideoClips(p, 'selected');
  const c = vids[0];
  if (!c) return p;
  if (S.clipDuration(c) <= length + 1) {
    toast(t('nothing'));
    return p;
  }
  const an = await loudnessFor(c);
  if (!an) {
    toast(t('noAudio'));
    return p;
  }
  const parts = findHighlights(an.rms, an.win, { length: length / 3, count: 3, inT: c.in, outT: c.out });
  p = S.replaceWithRanges(p, c.id, parts.map((r) => ({ start: r.start, end: r.end })));
  // Fade between the highlight parts (they directly follow the original clip id).
  const i = p.clips.findIndex((x) => x.id === c.id);
  p = S.setProject(p, {
    aspect: '9:16',
    clips: p.clips.map((x, k) => (k > i && k < i + parts.length ? { ...x, transition: 'fade' } : x)),
  });
  toast(t('shortsMade')(parts.length));
  return p;
}

async function autoCaptions(p) {
  const ids = [...new Set(p.clips.filter((c) => c.type === 'video').map((c) => c.mediaId))];
  if (!ids.length) {
    toast(t('noAudio'));
    return p;
  }
  const map = new Map();
  for (const id of ids) {
    try {
      map.set(id, await transcribeMedia(mediaMap.get(id), {
        language: capLang,
        onProgress: (e) => toast(e.stage === 'download' ? `${t('downloadingModel')} ${Math.round(e.value * 100)}%` : t('listening'), 600000),
      }));
    } catch (e) {
      console.warn('[Clipora] transcription failed', e);
      toast(`${t('aiFailed')}: ${e.message}`, 6000);
      return p;
    }
  }
  const caps = toTimeline(p.clips, S.clipStarts(p), map);
  toast(caps.length ? t('capsMade')(caps.length) : t('noSpeech'), 4000);
  return caps.length ? S.setCaptions(p, caps) : p;
}

const beatCache = new Map();
async function beatSync(p, every) {
  const m = p.music && mediaMap.get(p.music.mediaId);
  if (!m) {
    toast(t('needMusic'));
    return p;
  }
  try {
    if (!beatCache.has(m.id)) beatCache.set(m.id, detectBeats(await decodePcm16k(m.id, m.blob), 16000));
  } catch (e) {
    console.warn('[Clipora] beat detection failed', e);
    toast(t('noAudio'));
    return p;
  }
  const beats = beatCache.get(m.id);
  const r = S.syncToBeats(p, beats, every, p.music.offset || 0);
  toast(r.synced ? t('beatsSynced')(r.synced, beats.length) : t('nothing'));
  return r.synced ? r.project : p;
}

async function sceneSplit(p, scope) {
  let cuts = 0;
  for (const c of targetVideoClips(p, scope)) {
    let found;
    try {
      found = await detectScenes(mediaMap.get(c.mediaId), c.in, c.out, {
        onProgress: (f) => toast(`${t('findingScenes')} ${Math.round(f * 100)}%`, 60000),
      });
    } catch (e) {
      console.warn('[Clipora] scene detection failed', e);
      continue;
    }
    if (!found.length) continue;
    const edges = [c.in, ...found, c.out];
    p = S.replaceWithRanges(p, c.id, edges.slice(1).map((e, k) => ({ start: edges[k], end: e })));
    cuts += found.length;
  }
  toast(cuts ? t('scenesFound')(cuts + 1) : t('noScenes'), 4000);
  return p;
}

const ASYNC = ['removePauses', 'autoShorts', 'autoCaptions', 'beatSync', 'sceneSplit', 'boost'];

async function runActions(actions) {
  if (busy) return;
  if (actions.some((a) => a.type === 'undo')) return undo();
  if (actions.some((a) => a.type === 'redo')) return redo();
  busy = true;
  panel.classList.add('busy');
  if (actions.some((a) => a.type === 'removePauses' || a.type === 'autoShorts')) toast(t('analyzing'), 60000);
  try {
    let p = project;
    for (const a of actions) {
      if (a.type === 'removePauses') p = await removePauses(p, a.scope);
      else if (a.type === 'autoShorts') p = await autoShorts(p, a.value);
      else if (a.type === 'autoCaptions') p = await autoCaptions(p);
      else if (a.type === 'beatSync') p = await beatSync(p, a.value);
      else if (a.type === 'sceneSplit') p = await sceneSplit(p, a.scope || 'selected');
      else if (a.type === 'boost') p = await boostClips(p, a.scope === 'all' ? p.clips.map((c) => c.id) : targetVideoClips(p, 'selected').map((c) => c.id));
      else if (a.type === 'split') {
        const r = S.splitClip(p, engine.time);
        if (r.ok) p = r.project;
      } else if (a.type === 'deleteClip') p = S.deleteClip(p, selClip ?? p.clips[0]?.id);
      else if (a.type === 'duplicateClip') p = S.duplicateClip(p, selClip ?? p.clips[0]?.id).project;
      else {
        const q = S.applyAction(p, a.type === 'addText' ? { ...a, start: engine.time } : a, selClip);
        if (q) p = q;
      }
    }
    if (p !== project) {
      const added = p.texts.find((x) => !project.texts.some((y) => y.id === x.id));
      commit(p);
      if (added) selectText(added.id);
    } else if (!actions.some((a) => ASYNC.includes(a.type))) toast(t('nothing'));
  } finally {
    busy = false;
    panel.classList.remove('busy');
  }
}

function selectText(id) {
  selText = id;
  engine.selectedTextId = id;
  const x = curText();
  if (x && (engine.time < x.start || engine.time >= x.end)) engine.seek(x.start + 0.01);
  else engine.draw();
  if (tab !== 'text') setTab('text');
  else renderPanel();
  renderTimeline();
}

function selectOverlay(id) {
  selOverlay = id;
  engine.selectedOverlayId = id;
  const o = curOverlay();
  if (o && (engine.time < o.start || engine.time >= o.end)) engine.seek(o.start + 0.01);
  else engine.draw();
  if (tab !== 'overlay') setTab('overlay');
  else renderPanel();
  renderTimeline();
}

// Auto boost: measures how loud each clip is and sets its volume so quiet
// videos reach a good level (the limiter in the engine prevents clipping).
async function boostClips(p, ids) {
  let done = 0;
  let maxGain = 0;
  for (const id of ids) {
    const c = p.clips.find((x) => x.id === id);
    if (!c || c.type !== 'video') continue;
    const an = await loudnessFor(c);
    if (!an) continue;
    const win = an.rms.slice(Math.floor(c.in / an.win), Math.ceil(c.out / an.win));
    const sorted = [...win].sort((a, b) => b - a);
    const loud = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.3)));
    const level = loud.reduce((a, b) => a + b, 0) / loud.length;
    if (!(level > 0.0005)) continue;
    const vol = clamp(+(0.2 / level).toFixed(2), 0.5, 5);
    p = S.updateClip(p, c.id, { volume: vol, muted: false });
    maxGain = Math.max(maxGain, vol);
    done++;
  }
  toast(done ? `🔊 Volume set to ${Math.round(maxGain * 100)}% (auto level)` : t('noAudio'));
  return p;
}

async function addAudioFile(file, kind, extra = {}) {
  const [m] = await importFiles([file], 'audio');
  if (!m) return null;
  const r = S.addAudio(project, { mediaId: m.id, kind, start: engine.time, in: 0, out: m.duration, volume: 1, ...extra });
  selAudio = r.id;
  commit(r.project);
  return r.id;
}

async function addOverlayFiles(files) {
  const recs = await importFiles(files);
  if (!recs.length) return;
  let p = project;
  let last = null;
  const total = Math.max(engine.duration, 1);
  recs.forEach((m, i) => {
    const start = Math.min(engine.time, Math.max(0, total - 0.5));
    const len = m.type === 'video' ? m.duration : 4;
    const r = S.addOverlay(p, { ...S.overlayDefaults('media', { mediaId: m.id, type: m.type, x: 0.5 + i * 0.05, y: 0.35 + i * 0.05 }), start, end: Math.min(total, start + len) });
    p = r.project;
    last = r.id;
  });
  commit(p);
  selectOverlay(last);
}

function progressToast(label) {
  return (f) => toast(`${label} ${Math.round(f * 100)}%`, 600000);
}

// ---------- Panel event handlers ----------
const ACT = {
  split() {
    const r = S.splitClip(project, engine.time);
    if (r.ok) commit(r.project);
  },
  del() {
    if (selClip) commit(S.deleteClip(project, selClip));
  },
  dup() {
    const r = S.duplicateClip(project, selClip);
    selClip = r.newId;
    commit(r.project);
  },
  left: () => commit(S.moveClip(project, selClip, -1)),
  right: () => commit(S.moveClip(project, selClip, 1)),
  fit: () => commit(S.updateClip(project, selClip, { fit: curClip().fit === 'fill' ? 'fit' : 'fill' })),
  mute: () => commit(S.updateClip(project, selClip, { muted: !curClip().muted })),
  speedChip: (el) => commit(S.updateClip(project, selClip, { speed: +el.dataset.v })),
  ratio: (el) => commit(S.setProject(project, { aspect: el.dataset.v })),
  bg: (el) => commit(S.setProject(project, { background: el.dataset.v === 'blur' ? { ...project.background, mode: 'blur' } : { mode: 'color', color: el.dataset.v } })),
  preset: (el) => commit(S.updateClip(project, selClip, { filter: { preset: el.dataset.v } })),
  filterAll() {
    const f = curClip().filter;
    commit(S.setProject(project, { clips: project.clips.map((c) => ({ ...c, filter: { ...f } })) }));
  },
  addText() {
    const r = S.addText(project, 'Your text', engine.time);
    commit(r.project);
    selectText(r.id);
  },
  selText: (el) => selectText(el.dataset.id),
  textColor: (el) => commit(S.updateItem(project, 'texts', selText, { color: el.dataset.v })),
  textBg: () => commit(S.updateItem(project, 'texts', selText, { bg: !curText().bg })),
  textAnim: (el) => commit(S.updateItem(project, 'texts', selText, { anim: el.dataset.v })),
  textStartHere: () => commit(S.updateItem(project, 'texts', selText, { start: engine.time, end: Math.max(curText().end, engine.time + 0.5) })),
  textEndHere: () => commit(S.updateItem(project, 'texts', selText, { end: Math.max(engine.time, curText().start + 0.1) })),
  delText: () => commit(S.removeItem(project, 'texts', selText)),
  capLang(el) {
    capLang = el.dataset.v;
    renderPanel();
  },
  autoCaps: () => runActions([{ type: 'autoCaptions' }]),
  capStyle: (el) => commit(S.setProject(project, { captionStyle: el.dataset.v })),
  genCaps() {
    const caps = captionsFromScript($('#scriptBox').value, engine.duration);
    if (caps.length) commit(S.setCaptions(project, caps));
    else toast(t('nothing'));
  },
  addCap() {
    const s = engine.time;
    const caps = [...project.captions, { start: s, end: Math.min(s + 2, Math.max(engine.duration, s + 0.5)), text: '…' }].sort((a, b) => a.start - b.start);
    commit(S.setCaptions(project, caps));
  },
  importSrt: () => $('#srtInput').click(),
  exportSrt() {
    const blob = new Blob([toSrt(project.captions)], { type: 'text/plain' });
    downloadBlob(blob, `${project.name}.srt`);
  },
  clearCaps: () => commit(S.setCaptions(project, [])),
  capSeek: (el) => engine.seek(project.captions.find((c) => c.id === el.dataset.id).start + 0.01),
  cutCap(el) {
    const c = project.captions.find((x) => x.id === el.dataset.id);
    commit(S.cutRange(project, c.start, c.end));
    engine.seek(c.start);
  },
  beats: (el) => runActions([{ type: 'beatSync', value: +el.dataset.v }]),
  style: (el) => runActions(STYLES[el.dataset.v]),
  delCap: (el) => commit(S.removeItem(project, 'captions', el.dataset.id)),
  addMusic: () => $('#musicInput').click(),
  removeMusic: () => commit(S.setProject(project, { music: null })),
  musicLoop: () => commit(S.setProject(project, { music: { ...project.music, loop: !project.music.loop } })),
  muteOriginal() {
    const all = project.clips.every((c) => c.muted);
    commit(S.setProject(project, { clips: project.clips.map((c) => ({ ...c, muted: !all })) }));
  },
  smartGo() {
    const text = $('#smartBox').value.trim();
    if (!text) return;
    $('#smartBox').value = '';
    const last = chat[chat.length - 1];
    if (last?.status === 'pending') last.status = 'cancelled';
    const plan = parseCommand(text);
    chat.push({ role: 'user', text });
    chat.push(plan.actions.length ? { role: 'ai', text: t('chatPlan'), plan, status: 'pending' } : { role: 'ai', text: t('chatUnknown') });
    renderPanel();
  },
  smartChip(el) {
    $('#smartBox').value = el.dataset.v;
    ACT.smartGo();
  },
  smartCancel() {
    const last = chat[chat.length - 1];
    if (last?.status === 'pending') last.status = 'cancelled';
    renderPanel();
  },
  async smartApply() {
    const last = chat[chat.length - 1];
    if (last?.status !== 'pending') return;
    last.status = 'done';
    await runActions(last.plan.actions);
    // Stay in the conversation even if an action (like adding text) opened another tab.
    if (tab !== 'smart') setTab('smart');
    else renderPanel();
  },
  libAdd(el) {
    const m = mediaMap.get(el.dataset.id);
    if (!m) return;
    const p = S.addClips(project, [m]);
    selClip = p.clips[p.clips.length - 1].id;
    commit(p);
    engine.seek(S.clipStarts(p)[p.clips.length - 1] + 0.01);
    toast(t('addedToEnd'));
  },
  scenes: (el) => runActions([{ type: 'sceneSplit', scope: el.dataset.v }]),
  aiMovie() {
    openMovieDialog(studioDeps, { idea: $('#storyBox')?.value.trim() });
  },
  aiImage() {
    openImageDialog(studioDeps, { inEditor: true });
  },
  storyPhotos() {
    storyPhotos = !storyPhotos;
    renderPanel();
  },
  async storyboard() {
    const scenes = scriptToScenes($('#storyBox').value);
    if (!scenes.length) return toast(t('scriptVideoPh'));
    if (busy) return;
    busy = true;
    panel.classList.add('busy');
    try {
      const [cw, ch] = S.ASPECTS[project.aspect] || [9, 16];
      const width = cw >= ch ? 1920 : Math.round((1920 * cw) / ch);
      const height = cw >= ch ? Math.round((1920 * ch) / cw) : 1920;
      const photos = [];
      if (storyPhotos) {
        for (const m of mediaMap.values()) {
          if (m.type !== 'image' || m.projectId !== project.id || /^scene-\d+\.png$/.test(m.name)) continue;
          try {
            photos.push(await createImageBitmap(m.blob));
          } catch {}
        }
      }
      const files = [];
      for (let i = 0; i < scenes.length; i++) {
        toast(`${t('makingScenes')} ${i + 1}/${scenes.length}`, 60000);
        files.push(await renderScene(scenes[i].text, i, { width, height, total: scenes.length, photo: photos.length ? photos[i % photos.length] : null }));
      }
      const recs = await importFiles(files);
      let p = S.addClips(project, recs);
      const first = p.clips.length - recs.length;
      p = S.setProject(p, {
        clips: p.clips.map((c, k) => (k >= first ? { ...c, out: scenes[k - first].duration, transition: k > 0 ? 'fade' : c.transition } : c)),
      });
      commit(p);
      engine.seek(S.clipStarts(p)[first] + 0.01);
      toast(t('scenesMade')(recs.length), 4000);
    } finally {
      busy = false;
      panel.classList.remove('busy');
    }
  },
  pauses: (el) => runActions([{ type: 'removePauses', scope: el.dataset.v }]),
  enhance() {
    const c = curClip();
    commit(S.updateClip(project, selClip, { enhance: !c.enhance }));
    toast(c.enhance ? 'Enhance off' : '✨ Enhance HD on: brighter, sharper, cleaner');
  },
  rotate: () => commit(S.updateClip(project, selClip, { rotate: ((curClip().rotate || 0) + 90) % 360 })),
  mirror: () => commit(S.updateClip(project, selClip, { flipH: !curClip().flipH })),
  denoise: () => commit(S.updateClip(project, selClip, { denoise: !curClip().denoise })),
  voice: () => commit(S.updateClip(project, selClip, { voice: !curClip().voice })),
  animIn: (el) => commit(S.updateClip(project, selClip, { animIn: el.dataset.v })),
  animOut: (el) => commit(S.updateClip(project, selClip, { animOut: el.dataset.v })),
  transType: (el) => commit(S.updateClip(project, selClip, { transition: el.dataset.v })),
  transAll() {
    const tr = curClip().transition || 'dissolve';
    commit(S.setProject(project, { clips: project.clips.map((c, i) => ({ ...c, transition: i === 0 ? 'none' : tr })) }));
  },
  adjReset: () => commit(S.updateClip(project, selClip, { filter: { preset: 'none', brightness: 1, contrast: 1, saturation: 1, ...Object.fromEntries(Object.keys(S.ADJUST).map((k) => [k, 0])) }, enhance: false })),
  async boostClip() {
    if (busy) return;
    busy = true;
    try {
      commit(await boostClips(project, [selClip]));
    } finally {
      busy = false;
    }
  },
  async boostAll() {
    if (busy) return;
    busy = true;
    toast(t('analyzing'), 60000);
    try {
      commit(await boostClips(project, project.clips.map((c) => c.id)));
    } finally {
      busy = false;
    }
  },
  denoiseAll() {
    const on = !project.clips.every((c) => c.type !== 'video' || c.denoise);
    commit(S.setProject(project, { clips: project.clips.map((c) => (c.type === 'video' ? { ...c, denoise: on, voice: on } : c)) }));
    toast(on ? 'Noise reduction + voice enhance on for all clips' : 'Noise reduction off');
  },
  async freeze() {
    const at = S.clipAt(project, engine.time);
    if (!at || at.clip.type !== 'video') return toast('Pick a video clip to freeze a frame');
    const el = engine.els.get(at.clip.mediaId)?.el;
    if (!el?.videoWidth) return;
    const cv = document.createElement('canvas');
    cv.width = el.videoWidth;
    cv.height = el.videoHeight;
    cv.getContext('2d').drawImage(el, 0, 0);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
    const [rec] = await importFiles([new File([blob], `freeze-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
    if (!rec) return;
    let p = project;
    const sp = S.splitClip(p, engine.time);
    let idx = at.index + 1;
    if (sp.ok) p = sp.project;
    else if (engine.time - at.start < at.duration / 2) idx = at.index;
    const r = S.insertClip(p, idx, rec, 2);
    const src = at.clip;
    p = S.updateClip(r.project, r.id, { filter: { ...src.filter }, fit: src.fit, rotate: src.rotate, flipH: src.flipH, enhance: src.enhance, animIn: 'zoomIn' });
    selClip = r.id;
    commit(p);
    toast('❄️ Freeze frame added (2 s)');
  },
  extract() {
    const c = curClip();
    if (!c || c.type !== 'video') return toast('Select a video clip first');
    const start = S.clipStarts(project)[project.clips.indexOf(c)];
    const r = S.addAudio(project, { mediaId: c.mediaId, kind: 'extract', start, in: c.in, out: c.out, volume: c.volume });
    selAudio = r.id;
    commit(S.updateClip(r.project, c.id, { muted: true }));
    toast('🎵 Audio extracted to its own track; the clip is muted');
  },
  musicFadeIn: () => commit(S.setProject(project, { music: { ...project.music, fadeIn: project.music.fadeIn ? 0 : 2 } })),
  musicFadeOut: () => commit(S.setProject(project, { music: { ...project.music, fadeOut: project.music.fadeOut ? 0 : 2 } })),
  async record() {
    if (recording) {
      recording.rec.stop();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return toast('Microphone permission is needed for voice-over');
    }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
    const chunks = [];
    const start = engine.time;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((tr) => tr.stop());
      engine.pause();
      updatePlayBtn();
      recording = null;
      const type = (rec.mimeType || 'audio/webm').split(';')[0];
      const file = new File([new Blob(chunks, { type })], `voiceover-${Date.now()}.${type.includes('mp4') ? 'm4a' : 'webm'}`, { type });
      await addAudioFile(file, 'voice', { start });
      renderPanel();
      toast('🎙 Voice-over added');
    };
    recording = { rec };
    rec.start(250);
    // Play the video while recording so the voice matches the picture.
    if (project.clips.length && !engine.playing) {
      engine.play();
      updatePlayBtn();
    }
    renderPanel();
    toast('🎙 Recording… tap Stop when done');
  },
  async sfx(el) {
    const file = await renderSfx(el.dataset.v);
    await addAudioFile(file, 'sfx');
    toast(`💥 ${el.dataset.v} added at ${fmt(engine.time)}`);
  },
  async tts() {
    const text = $('#ttsBox')?.value.trim();
    if (!text) return toast('Type something for the voice to say');
    if (busy) return;
    busy = true;
    panel.classList.add('busy');
    try {
      toast('🗣 Preparing AI voice…', 600000);
      const file = await speak(text, { onProgress: progressToast('Downloading voice model…') });
      await addAudioFile(file, 'tts');
      toast('🗣 AI voice-over added');
    } catch (e) {
      console.warn('[Clipora] tts failed', e);
      toast(`AI voice failed: ${e.message}`, 6000);
    } finally {
      busy = false;
      panel.classList.remove('busy');
    }
  },
  selAudio(el) {
    selAudio = selAudio === el.dataset.id ? null : el.dataset.id;
    renderPanel();
    renderTimeline();
  },
  delAudio(el) {
    if (selAudio === el.dataset.id) selAudio = null;
    commit(S.removeItem(project, 'audios', el.dataset.id));
  },
  audHere: () => commit(S.updateItem(project, 'audios', selAudio, { start: engine.time })),
  audFadeIn: () => commit(S.updateItem(project, 'audios', selAudio, { fadeIn: curAudio().fadeIn ? 0 : 1 })),
  audFadeOut: () => commit(S.updateItem(project, 'audios', selAudio, { fadeOut: curAudio().fadeOut ? 0 : 1 })),
  audDenoise: () => commit(S.updateItem(project, 'audios', selAudio, { denoise: !curAudio().denoise, voice: !curAudio().denoise })),
  addOverlay: () => $('#overlayInput').click(),
  addBlur() {
    const total = Math.max(engine.duration, 1);
    const r = S.addOverlay(project, { ...S.overlayDefaults('blur', { scale: 0.35, ratio: 0.5, y: 0.35 }), start: 0, end: total });
    commit(r.project);
    selectOverlay(r.id);
  },
  progressBar: () => commit(S.setProject(project, { progressBar: !project.progressBar })),
  sticker(el) {
    const total = Math.max(engine.duration, 1);
    const start = Math.min(engine.time, Math.max(0, total - 0.5));
    const r = S.addOverlay(project, { ...S.overlayDefaults('sticker', { text: el.dataset.v, x: 0.5 + (Math.random() - 0.5) * 0.3, y: 0.3 + Math.random() * 0.3 }), start, end: Math.min(total, start + 3) });
    commit(r.project);
    selectOverlay(r.id);
  },
  selOverlay: (el) => selectOverlay(el.dataset.id),
  ovShape: (el) => commit(S.updateItem(project, 'overlays', selOverlay, { shape: el.dataset.v })),
  ovBorder: () => commit(S.updateItem(project, 'overlays', selOverlay, { border: !curOverlay().border })),
  ovFlip: () => commit(S.updateItem(project, 'overlays', selOverlay, { flipH: !curOverlay().flipH })),
  ovChroma: () => commit(S.updateItem(project, 'overlays', selOverlay, { chroma: curOverlay().chroma ? 0 : 0.4 })),
  ovAnim: (el) => commit(S.updateItem(project, 'overlays', selOverlay, { anim: el.dataset.v })),
  ovFull: () => commit(S.updateItem(project, 'overlays', selOverlay, { start: 0, end: Math.max(engine.duration, 0.1) })),
  ovDup() {
    const { id, ...o } = curOverlay();
    const r = S.addOverlay(project, { ...o, x: Math.min(0.9, o.x + 0.06), y: Math.min(0.9, o.y + 0.06) });
    commit(r.project);
    selectOverlay(r.id);
  },
  delOverlay() {
    const id = selOverlay;
    selOverlay = null;
    engine.selectedOverlayId = null;
    commit(S.removeItem(project, 'overlays', id));
  },
  async cutout() {
    const o = curOverlay();
    const m = o && mediaMap.get(o.mediaId);
    if (!m || busy) return;
    busy = true;
    panel.classList.add('busy');
    try {
      toast('✂️ Removing background…', 600000);
      const file = await removeBackground(m.blob, { onProgress: progressToast('Downloading AI model…') });
      const [rec] = await importFiles([file]);
      if (rec) commit(S.updateItem(project, 'overlays', o.id, { mediaId: rec.id }));
      toast('✂️ Background removed');
    } catch (e) {
      console.warn('[Clipora] cutout failed', e);
      toast(`Background removal failed: ${e.message}`, 6000);
    } finally {
      busy = false;
      panel.classList.remove('busy');
    }
  },
  addFx(el) {
    const total = Math.max(engine.duration, 0.5);
    const start = Math.min(engine.time, Math.max(0, total - 0.3));
    const r = S.addEffect(project, { type: el.dataset.v, start, end: Math.min(total, start + 2), intensity: 1 });
    selEffect = r.id;
    commit(r.project);
    if (!engine.playing) engine.seek(start + 0.3);
  },
  selFx(el) {
    selEffect = el.dataset.id;
    engine.seek(curEffect().start + 0.01);
    renderPanel();
    renderTimeline();
  },
  fxFull: () => commit(S.updateItem(project, 'effects', selEffect, { start: 0, end: Math.max(engine.duration, 0.1) })),
  fxClip() {
    const at = S.clipAt(project, curEffect().start);
    if (at) commit(S.updateItem(project, 'effects', selEffect, { start: at.start, end: at.start + at.duration }));
  },
  delFx() {
    const id = selEffect;
    selEffect = null;
    commit(S.removeItem(project, 'effects', id));
  },
  textFont: (el) => commit(S.updateItem(project, 'texts', selText, { font: el.dataset.v })),
  textOutline: () => commit(S.updateItem(project, 'texts', selText, { outline: curText().outline === 'none' ? undefined : 'none' })),
  textGlow: () => commit(S.updateItem(project, 'texts', selText, { glow: !curText().glow })),
  textTpl(el) {
    const { text, ...rest } = TEXT_TEMPLATES[el.dataset.v];
    const r = S.addText(project, text, engine.time);
    commit(S.updateItem(r.project, 'texts', r.id, rest));
    selectText(r.id);
  },
  shorts: (el) => runActions([{ type: 'autoShorts', value: +el.dataset.v }]),
};

const INPUT = {
  clipIn(el) {
    const c = curClip();
    live(S.updateClip(project, selClip, { in: Math.min(+el.value, c.out - S.MIN_CLIP) }));
    engine.seek(S.clipStarts(project)[project.clips.findIndex((x) => x.id === selClip)]);
    return fmt(curClip().in);
  },
  clipOut(el) {
    const c = curClip();
    live(S.updateClip(project, selClip, { out: Math.max(+el.value, c.in + S.MIN_CLIP) }));
    const i = project.clips.findIndex((x) => x.id === selClip);
    engine.seek(S.clipStarts(project)[i] + S.clipDuration(curClip()) - 0.04);
    return fmt(curClip().out);
  },
  imgDur(el) {
    const c = curClip();
    live(S.updateClip(project, selClip, { out: c.in + +el.value }));
    return `${(+el.value).toFixed(1)}s`;
  },
  speed(el) {
    live(S.updateClip(project, selClip, { speed: +el.value }));
    return `${(+el.value).toFixed(2)}x`;
  },
  volume(el) {
    live(S.updateClip(project, selClip, { volume: +el.value / 100, muted: false }));
    return `${el.value}%`;
  },
  bgColor(el) {
    live(S.setProject(project, { background: { mode: 'color', color: el.value } }));
  },
  brightness: (el) => (live(S.updateClip(project, selClip, { filter: { brightness: +el.value } })), (+el.value).toFixed(2)),
  contrast: (el) => (live(S.updateClip(project, selClip, { filter: { contrast: +el.value } })), (+el.value).toFixed(2)),
  saturation: (el) => (live(S.updateClip(project, selClip, { filter: { saturation: +el.value } })), (+el.value).toFixed(2)),
  textBody(el) {
    live(S.updateItem(project, 'texts', selText, { text: el.value }));
  },
  textSize: (el) => (live(S.updateItem(project, 'texts', selText, { size: +el.value })), Math.round(el.value * 100)),
  textColor(el) {
    live(S.updateItem(project, 'texts', selText, { color: el.value }));
  },
  textStart(el) {
    live(S.updateItem(project, 'texts', selText, { start: Math.min(+el.value, curText().end - 0.1) }));
    engine.seek(curText().start + 0.01);
    return fmt(curText().start);
  },
  textEnd(el) {
    live(S.updateItem(project, 'texts', selText, { end: Math.max(+el.value, curText().start + 0.1) }));
    engine.seek(curText().end - 0.02);
    return fmt(curText().end);
  },
  capText(el) {
    live(S.updateItem(project, 'captions', el.dataset.id, { text: el.value }));
  },
  clipZoom: (el) => (live(S.updateClip(project, selClip, { zoom: +el.value })), `${(+el.value).toFixed(2)}x`),
  panX: (el) => (live(S.updateClip(project, selClip, { panX: +el.value })), (+el.value).toFixed(2)),
  panY: (el) => (live(S.updateClip(project, selClip, { panY: +el.value })), (+el.value).toFixed(2)),
  adj: (el, k) => (live(S.updateClip(project, selClip, { filter: { [k]: +el.value } })), (+el.value).toFixed(2)),
  audVol: (el) => (live(S.updateItem(project, 'audios', selAudio, { volume: +el.value / 100 })), `${el.value}%`),
  ovScale: (el) => (live(S.updateItem(project, 'overlays', selOverlay, { scale: +el.value })), pct(+el.value)),
  ovRot: (el) => (live(S.updateItem(project, 'overlays', selOverlay, { rotation: +el.value })), `${el.value}°`),
  ovRatio: (el) => (live(S.updateItem(project, 'overlays', selOverlay, { ratio: +el.value })), (+el.value).toFixed(2)),
  ovOpacity: (el) => (live(S.updateItem(project, 'overlays', selOverlay, { opacity: +el.value })), pct(+el.value)),
  ovChromaS: (el) => (live(S.updateItem(project, 'overlays', selOverlay, { chroma: +el.value })), pct(+el.value)),
  ovKey(el) {
    live(S.updateItem(project, 'overlays', selOverlay, { keyColor: el.value, chroma: curOverlay().chroma || 0.4 }));
  },
  ovStart(el) {
    live(S.updateItem(project, 'overlays', selOverlay, { start: Math.min(+el.value, curOverlay().end - 0.1) }));
    engine.seek(curOverlay().start + 0.01);
    return fmt(curOverlay().start);
  },
  ovEnd(el) {
    live(S.updateItem(project, 'overlays', selOverlay, { end: Math.max(+el.value, curOverlay().start + 0.1) }));
    engine.seek(curOverlay().end - 0.02);
    return fmt(curOverlay().end);
  },
  fxInt: (el) => (live(S.updateItem(project, 'effects', selEffect, { intensity: +el.value })), pct(+el.value)),
  fxStart(el) {
    live(S.updateItem(project, 'effects', selEffect, { start: Math.min(+el.value, curEffect().end - 0.1) }));
    engine.seek(curEffect().start + 0.01);
    return fmt(curEffect().start);
  },
  fxEnd(el) {
    live(S.updateItem(project, 'effects', selEffect, { end: Math.max(+el.value, curEffect().start + 0.1) }));
    engine.seek(curEffect().end - 0.02);
    return fmt(curEffect().end);
  },
  musicVol: (el) => (live(S.setProject(project, { music: { ...project.music, volume: +el.value / 100 } })), `${el.value}%`),
  musicOffset: (el) => (live(S.setProject(project, { music: { ...project.music, offset: +el.value } })), fmt(+el.value)),
};

panel.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled && ACT[el.dataset.act]) ACT[el.dataset.act](el);
});
panel.addEventListener('input', (e) => {
  const el = e.target.closest('[data-in]');
  const [key, arg] = (el?.dataset.in || '').split(':');
  if (!el || !INPUT[key] || !project) return;
  const out = INPUT[key](el, arg);
  const o = el.parentElement.querySelector('output');
  if (o && out !== undefined) o.textContent = out;
});
panel.addEventListener('change', (e) => {
  if (e.target.closest('[data-in]')) {
    endGesture();
    if (e.target.type !== 'text' && e.target.tagName !== 'TEXTAREA') renderPanel();
  }
});
panel.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'smartBox') ACT.smartGo();
});

// ---------- Timeline events ----------
tlInner.addEventListener('click', (e) => {
  const clip = e.target.closest('[data-clip]');
  const tr = e.target.closest('[data-trans]');
  const tx = e.target.closest('[data-text]');
  const cap = e.target.closest('[data-cap]');
  const mus = e.target.closest('[data-music]');
  const ov = e.target.closest('[data-ov]');
  const fx = e.target.closest('[data-fx]');
  const aud = e.target.closest('[data-aud]');
  if (ov) return selectOverlay(ov.dataset.ov);
  if (fx) {
    selEffect = fx.dataset.fx;
    engine.seek(curEffect().start + 0.01);
    setTab('effects');
    return renderTimeline();
  }
  if (aud) {
    selAudio = aud.dataset.aud;
    setTab('music');
    return renderTimeline();
  }
  if (tr) {
    selClip = tr.dataset.trans;
    const c = curClip();
    commit(S.updateClip(project, c.id, { transition: c.transition && c.transition !== 'none' ? 'none' : 'dissolve' }));
    setTab('edit');
  } else if (clip) {
    selClip = clip.dataset.clip;
    renderTimeline();
    if (!['edit', 'filters', 'smart'].includes(tab)) setTab('edit');
    else renderPanel();
  } else if (tx) selectText(tx.dataset.text);
  else if (cap) {
    setTab('captions');
    engine.seek(project.captions.find((c) => c.id === cap.dataset.cap).start + 0.01);
  } else if (mus) setTab('music');
});

timeline.addEventListener('scroll', () => {
  if (Math.abs(timeline.scrollLeft - expectedScroll) < 2) return;
  if (engine.playing) {
    engine.pause();
    updatePlayBtn();
  }
  expectedScroll = timeline.scrollLeft;
  engine.seek(timeline.scrollLeft / pps);
});

timeline.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoom(e.deltaY < 0 ? 1.25 : 0.8);
}, { passive: false });

function zoom(f) {
  pps = clamp(pps * f, 4, 240);
  renderTimeline();
}

// ---------- Preview interactions (drag text, tap to play) ----------
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!project) return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) * canvas.width) / r.width;
  const y = ((e.clientY - r.top) * canvas.height) / r.height;
  const hit = engine.playing ? null : engine.hitAt(x, y);
  const id = hit?.id || null;
  const list = hit?.kind === 'overlay' ? 'overlays' : 'texts';
  drag = { id, list, x, y, moved: false };
  if (id) {
    const it = project[list].find((q) => q.id === id);
    drag.ox = it.x;
    drag.oy = it.y;
    if (list === 'texts' && selText !== id) selectText(id);
    if (list === 'overlays' && selOverlay !== id) selectOverlay(id);
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag?.id) return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) * canvas.width) / r.width;
  const y = ((e.clientY - r.top) * canvas.height) / r.height;
  if (Math.hypot(x - drag.x, y - drag.y) > 4) drag.moved = true;
  if (!drag.moved) return;
  live(S.updateItem(project, drag.list, drag.id, {
    x: clamp(drag.ox + (x - drag.x) / canvas.width, 0.02, 0.98),
    y: clamp(drag.oy + (y - drag.y) / canvas.height, 0.02, 0.98),
  }));
});
canvas.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.id) endGesture();
  else togglePlay();
  drag = null;
});

function togglePlay() {
  if (!project?.clips.length) return;
  engine.toggle();
  updatePlayBtn();
}

// ---------- Export ----------
// Inside the Android app (WebView) blob downloads and Web Share don't exist, so
// the file is streamed to the native side, which saves it to the gallery.
const Native = window.CliporaNative;
async function saveNative(blob, name, share) {
  const id = Native.begin();
  const CHUNK = 3 << 20;
  for (let i = 0; i < blob.size; i += CHUNK) {
    const url = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob.slice(i, i + CHUNK));
    });
    Native.append(id, url.slice(url.indexOf(',') + 1));
  }
  const err = Native.finish(id, name, blob.type || 'application/octet-stream', !!share);
  if (err) throw new Error(err);
}

function downloadBlob(blob, name) {
  name = name.replace(/[\\/:*?"<>|]+/g, '_');
  if (Native) {
    saveNative(blob, name, false).then(() => toast(t('saved')), (e) => toast(e.message));
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

let exportCtl = null;
function openExport() {
  if (!project.clips.length) return toast(t('empty'));
  preloadFastExport();
  engine.pause();
  updatePlayBtn();
  const d = $('#exportDlg');
  let q = 1080;
  let fps = 30;
  const QL = { 480: '480p', 720: '720p', 1080: '1080p HD', 1440: '2K', 2160: '4K' };
  const draw = () => {
    d.innerHTML = `<h3>${t('exportTitle')}</h3>
      <div class="label">${t('quality')}</div>
      <div class="row">${[480, 720, 1080, 1440, 2160].map((v) => `<button class="chip ${q === v ? 'on' : ''}" data-q="${v}" type="button">${QL[v]}</button>`).join('')}</div>
      <div class="label">Frame rate</div>
      <div class="row">${[24, 30, 60].map((v) => `<button class="chip ${fps === v ? 'on' : ''}" data-fps="${v}" type="button">${v} fps</button>`).join('')}</div>
      ${q >= 1440 ? '<p class="hint">2K/4K needs a powerful phone; use 1080p if export stutters.</p>' : ''}
      <p class="hint">${t('keepOpen')} · ${fmt(engine.duration)}</p>
      <button class="chip photo-save" data-photo type="button">📷 Save this frame as a photo (PNG)</button>
      <div class="row end"><button class="btn-ghost" data-x type="button">${t('cancel')}</button>
      <button class="btn-primary" data-go type="button">${t('startExport')}</button></div>`;
  };
  draw();
  d.onclick = async (e) => {
    if (e.target.closest('[data-q]')) {
      q = +e.target.closest('[data-q]').dataset.q;
      draw();
    } else if (e.target.closest('[data-fps]')) {
      fps = +e.target.closest('[data-fps]').dataset.fps;
      draw();
    } else if (e.target.closest('[data-x]')) {
      if (exportCtl) exportCtl.abort();
      else d.close();
    } else if (e.target.closest('[data-go]')) runExport(q, fps);
    else if (e.target.closest('[data-close]')) d.close();
    else if (e.target.closest('[data-photo]')) {
      const png = await engine.snapshot(q);
      if (png) downloadBlob(png, `${project.name || 'Clipora'}.png`);
    } else if (e.target.closest('[data-share]')) shareResult();
    else if (e.target.closest('[data-save]')) downloadBlob(lastExport.blob, lastExport.name);
  };
  d.oncancel = (e) => {
    if (exportCtl) e.preventDefault();
  };
  d.showModal();
}

let lastExport = null;
async function runExport(q, fps = 30) {
  const d = $('#exportDlg');
  d.innerHTML = `<h3>${t('exporting')}</h3><div class="progress"><i id="prog"></i></div>
    <p class="hint"><span id="progPct">0%</span> · ${t('keepOpen')}</p>
    <div class="row end"><button class="btn-ghost" data-x type="button">${t('cancel')}</button></div>`;
  exportCtl = new AbortController();
  Native?.keepAwake(true);
  try {
    const res = await engine.export({
      shortSide: q,
      fps,
      signal: exportCtl.signal,
      onProgress: (f) => {
        $('#prog').style.width = `${(f * 100).toFixed(1)}%`;
        $('#progPct').textContent = `${Math.round(f * 100)}%`;
      },
    });
    exportCtl = null;
    Native?.keepAwake(false);
    if (!res) return d.close();
    if (lastExport) URL.revokeObjectURL(lastExport.url);
    const name = `${project.name || 'Clipora'}.${res.ext}`.replace(/[\\/:*?"<>|]+/g, '_');
    lastExport = { ...res, name, url: URL.createObjectURL(res.blob) };
    const canShare = !!Native || navigator.canShare?.({ files: [new File([res.blob], name, { type: res.blob.type })] });
    d.innerHTML = `<h3>🎉 ${t('done')}</h3><video src="${lastExport.url}" controls playsinline></video>
      <p class="hint">${(res.blob.size / 1048576).toFixed(1)} MB · ${res.ext.toUpperCase()}${res.stats ? ` · ⚡ ${(engine.duration / (res.stats.total / 1000)).toFixed(1)}× ${t('fasterThanRealtime')}` : ''}</p>
      <div class="row end"><button class="btn-ghost" data-close type="button">${t('close')}</button>
      ${canShare ? `<button class="btn-ghost" data-share type="button">${t('share')}</button>` : ''}
      ${Native ? `<button class="btn-primary" data-save type="button">${t('download')}</button>` : `<a class="btn-primary" href="${lastExport.url}" download="${esc(name)}">${t('download')}</a>`}</div>`;
  } catch (e) {
    exportCtl = null;
    Native?.keepAwake(false);
    console.error(e);
    d.innerHTML = `<h3>${t('exportFailed')}</h3><p class="hint">${esc(e.message)}</p><div class="row end"><button class="btn-ghost" data-close type="button">${t('close')}</button></div>`;
  }
}

async function shareResult() {
  if (!lastExport) return;
  if (Native) return saveNative(lastExport.blob, lastExport.name, true).catch((e) => toast(e.message));
  try {
    await navigator.share({ files: [new File([lastExport.blob], lastExport.name, { type: lastExport.blob.type })], title: lastExport.name });
  } catch {}
}

// ---------- AI Studio ----------
const studioDeps = {
  toast,
  buildMovieProject,
  async useImage(file, { aspect, mode }) {
    if (mode === 'add' && project) {
      const medias = await importFiles([file]);
      if (!medias.length) return;
      const at = selClip ? project.clips.findIndex((c) => c.id === selClip) + 1 : project.clips.length;
      commit(S.addClips(project, medias, at));
      toast('🖼 AI picture added to the timeline');
      return;
    }
    await newProjectFrom([file]);
    if (project) commit(S.setProject(project, { aspect, name: 'AI picture' }), { record: false });
  },
};

async function buildMovieProject(st, o) {
  if (project) await closeEditor();
  const p0 = S.newProject(st.title || o.idea.trim().slice(0, 40) || 'AI Movie');
  p0.aspect = o.aspect;
  p0.captionStyle = 'pop';
  p0.background = { mode: 'color', color: '#000000' };
  startEditor(p0);
  showEditor();
  panel.classList.add('busy');
  try {
    const scenes = [];
    const recs = [];
    for (const sc of st.scenes) {
      const file = sc.clip || sc.image;
      if (!file) continue;
      const [visual] = await importFiles([file]);
      if (!visual) continue;
      const voice = sc.voice ? (await importFiles([sc.voice], 'audio'))[0] || null : null;
      scenes.push(sc);
      recs.push({ visual, voice });
    }
    if (!recs.length) throw new Error('No scenes could be imported');
    let p = S.addClips(project, recs.map((r) => r.visual));
    const { clipPatches, captions, audios } = assembleMovie(scenes, recs);
    p = S.setProject(p, { clips: p.clips.map((c, i) => ({ ...c, ...clipPatches[i] })) });
    p = S.setCaptions(p, captions);
    for (const a of audios) p = S.addAudio(p, a).project;
    project = p;
    selClip = project.clips[0].id;
    engine.setProject(project);
    renderTimeline();
    renderPanel();
    renderMeta();
    await save();
  } finally {
    panel.classList.remove('busy');
  }
}

// ---------- Screens ----------
async function renderHome() {
  const list = await DB.listProjects().catch(() => []);
  $('#projects').innerHTML = list.length
    ? list
        .map((p) => `<div class="project" data-open="${p.id}" role="button" tabindex="0">
        <span class="thumb" style="background-image:url('${p.thumb || ''}')"></span>
        <div class="meta"><b>${esc(p.name)}</b><small>${fmt(S.totalDuration(p))} · ${new Date(p.updatedAt).toLocaleDateString()}</small></div>
        <button class="del" data-del="${p.id}" type="button" aria-label="${t('delete')}">${icon('trash', 18)}</button></div>`)
        .join('')
    : `<div class="empty">${t('noProjects')}</div>`;
}

function showEditor() {
  $('#home').classList.add('hidden');
  $('#editor').classList.remove('hidden');
  if (!window.history.state?.editor) window.history.pushState({ editor: 1 }, '');
}

async function closeEditor() {
  if (!project) return;
  engine.pause();
  await save();
  engine.dispose();
  project = null;
  mediaMap = new Map();
  $('#editor').classList.add('hidden');
  $('#home').classList.remove('hidden');
  renderHome();
}

function startEditor(p) {
  project = p;
  history = new S.History();
  selClip = p.clips[0]?.id ?? null;
  selText = null;
  selOverlay = selEffect = selAudio = null;
  engine.selectedOverlayId = null;
  smartPlan = null;
  engine.time = 0;
  engine.project = null;
  engine.setProject(project);
  engine.onTime = (time) => {
    $('#timeCur').textContent = timecode(time);
    setScroll(time);
  };
  engine.onEnd = updatePlayBtn;
  tab = 'edit';
  renderTabs();
  renderTimeline();
  renderPanel();
  renderMeta();
  updatePlayBtn();
}

async function newProjectFrom(files) {
  if (!files.length) return;
  const date = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const p = S.newProject(`${t('untitled')} ${date}`);
  startEditor(p);
  showEditor();
  panel.classList.add('busy');
  const medias = await importFiles(files);
  panel.classList.remove('busy');
  if (!medias.length) return;
  project = S.addClips(project, medias);
  selClip = project.clips[0].id;
  engine.setProject(project);
  renderTimeline();
  renderPanel();
  renderMeta();
  await save();
}

async function openProject(id) {
  const p = await DB.getProject(id);
  if (!p) return renderHome();
  const media = await DB.mediaForProject(id);
  mediaMap = new Map(media.map((m) => [m.id, m]));
  await Promise.all(media.map((m) => engine.addMedia(m)));
  startEditor(S.migrate(p));
  showEditor();
}

function applyI18n() {
  document.documentElement.lang = getLang();
  document.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t)));
  $('#undoBtn').title = t('undo');
  $('#redoBtn').title = t('redo');
  if (project) {
    renderTabs();
    renderPanel();
  }
  renderHome();
}

// Fit the preview canvas inside the stage while keeping its aspect ratio.
function fitCanvas() {
  const st = $('#stage');
  const aw = st.clientWidth - 16;
  const ah = st.clientHeight - 16;
  if (aw <= 0 || ah <= 0) return;
  const s = Math.min(aw / canvas.width, ah / canvas.height);
  canvas.style.width = `${Math.floor(canvas.width * s)}px`;
  canvas.style.height = `${Math.floor(canvas.height * s)}px`;
}
new ResizeObserver(fitCanvas).observe($('#stage'));
new MutationObserver(fitCanvas).observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });

// ---------- Wiring ----------
$('#backBtn').innerHTML = icon('back');
$('#undoBtn').innerHTML = icon('undo');
$('#redoBtn').innerHTML = icon('redo');
$('#backBtn').onclick = () => window.history.back();
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#playBtn').onclick = togglePlay;
$('#zoomIn').onclick = () => zoom(1.4);
$('#prevBtn').onclick = () => jumpClip(-1);
$('#nextBtn').onclick = () => jumpClip(1);
$('#focusBtn').onclick = () => {
  $('#editor').classList.toggle('focus');
  fitCanvas();
};
// Jump the playhead to the previous/next clip boundary.
function jumpClip(dir) {
  if (!project?.clips.length) return;
  const edges = [...S.clipStarts(project), engine.duration];
  const now = engine.time;
  const target = dir > 0 ? edges.find((e) => e > now + 0.05) ?? engine.duration : [...edges].reverse().find((e) => e < now - 0.05) ?? 0;
  engine.seek(Math.min(target, Math.max(0, engine.duration - 0.01)));
  setScroll(engine.time);
}
$('#zoomOut').onclick = () => zoom(1 / 1.4);
$('#exportBtn').onclick = openExport;
$('#tabs').onclick = (e) => {
  const b = e.target.closest('[data-tab]');
  if (b) setTab(b.dataset.tab);
};
$('#nameInput').onchange = (e) => commit(S.setProject(project, { name: e.target.value.trim() || t('untitled') }));

$('#aiMovieBtn').onclick = () => openMovieDialog(studioDeps);
$('#aiImageBtn').onclick = () => openImageDialog(studioDeps);
$('#newInput').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  await newProjectFrom(files);
};
$('#addInput').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!project) return;
  panel.classList.add('busy');
  const medias = await importFiles(files);
  panel.classList.remove('busy');
  if (medias.length) {
    const at = selClip ? project.clips.findIndex((c) => c.id === selClip) + 1 : project.clips.length;
    commit(S.addClips(project, medias, at));
  }
};
$('#overlayInput').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length) await addOverlayFiles(files);
};
$('#musicInput').onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length || !project) return;
  const [m] = await importFiles(files.slice(0, 1), 'audio');
  if (m) commit(S.setProject(project, { music: { mediaId: m.id, volume: 0.8, offset: 0, loop: true } }));
};
$('#srtInput').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const caps = parseSrt(await f.text());
  if (caps.length) commit(S.setCaptions(project, caps));
  else toast(t('nothing'));
};

$('#projects').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.stopPropagation();
    if (await confirmDlg(t('confirmDelete'))) {
      await DB.deleteProject(del.dataset.del);
      renderHome();
    }
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) openProject(open.dataset.open);
});

window.addEventListener('popstate', () => {
  if (project) closeEditor();
});

// Android back button: close an open dialog first, then leave the editor.
// Returns false when there is nothing to go back to (the app then exits).
window.__cliporaBack = () => {
  const dlg = document.querySelector('dialog[open]');
  if (dlg) {
    if (!exportCtl) dlg.close();
    return true;
  }
  if (project && !$('#editor').classList.contains('hidden')) {
    history.back();
    return true;
  }
  return false;
};

document.addEventListener('keydown', (e) => {
  if (!project || $('#editor').classList.contains('hidden')) return;
  if (e.target.closest('input, textarea') || document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  } else if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if (e.key === 's' && !mod) ACT.split();
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selClip) ACT.del();
  else if (e.key === 'ArrowLeft') engine.seek(engine.time - (e.shiftKey ? 1 : 1 / 30));
  else if (e.key === 'ArrowRight') engine.seek(engine.time + (e.shiftKey ? 1 : 1 / 30));
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && project) {
    if (!engine.exporting) {
      engine.pause();
      updatePlayBtn();
    }
    save();
  }
});

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !Native) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[Clipora] SW', e));
}
DB.requestPersistence();
applyI18n();

// Let the opening animation finish (~1.5 s after start), then fade it out.
const splash = $('#splash');
if (splash) {
  const hide = () => {
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 600);
  };
  setTimeout(hide, Math.max(0, 1500 - performance.now()));
  splash.onclick = hide;
}

// Exposed for automated smoke tests.
window.__clipora = { get project() { return project; }, engine, buildMovieProject, studioDeps, newProjectFrom, runActions, openExport, importFiles, commit, S, ACT, addOverlayFiles, selectOverlay };
