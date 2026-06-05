// Free cloud AI used by "AI Movie" and "AI Image". No API key and no server
// of our own: every request goes from the user's phone straight to free
// public services, so it scales with the number of users at zero cost.
//   • Story writing: Pollinations text API (OpenAI-compatible)
//   • Images: FLUX.1-schnell on a free Hugging Face GPU Space (Pollinations as backup)
//   • Animating a picture into a short clip: Lightricks LTX-Video on a free
//     Hugging Face ZeroGPU Space (optional; each user has a small daily quota)
// Free HF GPU quota is counted per visitor, so it grows with the user base.
// Everything has an offline fallback, so the feature never fully breaks.

import { scriptToScenes } from './storyboard.js';
import { gatewayChat, gatewayImage } from './gateway.js';

const TEXT_URL = 'https://text.pollinations.ai/openai';
const IMAGE_URL = 'https://image.pollinations.ai/prompt/';
const VIDEO_SPACE = 'Lightricks/ltx-video-distilled';

export const LOOKS = {
  cinematic: 'cinematic film still, dramatic lighting, shallow depth of field, 35mm, highly detailed',
  realistic: 'photorealistic, natural light, sharp focus, high detail',
  anime: 'anime style, studio ghibli inspired, vibrant colors, detailed background',
  cartoon3d: '3D animated movie style, pixar-like, soft lighting, expressive characters',
  watercolor: 'watercolor painting, soft edges, paper texture, storybook illustration',
  comic: 'comic book art, bold ink lines, halftone, dynamic composition',
};

async function withTimeout(promise, ms, ctl) {
  const t = setTimeout(() => ctl?.abort(), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(t);
  }
}

/** Pulls the first JSON object/array out of a model reply. */
export function parseJsonReply(text) {
  const s = String(text || '').replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('No JSON in reply');
  return JSON.parse(s.slice(a, b + 1));
}

/** Chat completion; returns the reply text. Fast gateway (Groq/Gemini) first, Pollinations as backup. */
export async function chat(messages, { signal, json = false, timeout = 60000 } = {}) {
  try {
    return await gatewayChat(messages, { json, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  return pollinationsChat(messages, { signal, json, timeout });
}

// The free tier answers one request per user every ~10-20 s (HTTP 402/429 otherwise): wait and retry.
async function pollinationsChat(messages, opts) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await pollinationsOnce(messages, opts);
    } catch (e) {
      if (!e.busy || attempt >= 2 || opts.signal?.aborted) throw e;
      await new Promise((r) => setTimeout(r, 12000));
    }
  }
}

async function pollinationsOnce(messages, { signal, json, timeout }) {
  const ctl = new AbortController();
  signal?.addEventListener('abort', () => ctl.abort());
  const res = await withTimeout(
    fetch(TEXT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages, ...(json ? { response_format: { type: 'json_object' } } : {}), seed: Math.floor(Math.random() * 1e6) }),
      signal: ctl.signal,
    }),
    timeout,
    ctl
  );
  if (!res.ok) throw Object.assign(new Error(`AI text service: HTTP ${res.status}`), { busy: res.status === 402 || res.status === 429 });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Prompt or full story → movie plan:
 * { title, scenes: [{ narration, visual, duration }], character }
 * `narration` is in the user's language; `visual` is an English image prompt.
 */
export async function writeMovie(idea, { scenes = 6, lang = 'auto', signal } = {}) {
  const isStory = idea.trim().split(/\s+/).length > 60;
  const sys = `You are a film director and screenwriter. You turn ideas or stories into short narrated movies made of still scenes.
Reply ONLY with JSON: {"title": string, "character": string, "scenes": [{"narration": string, "visual": string}]}.
- "character": one English sentence describing the main character's fixed look (age, face, hair, clothes) so every scene looks consistent, or "" if none.
- Exactly ${scenes} scenes${isStory ? ', following the given story in order without inventing a different plot' : ', with a clear beginning, conflict and satisfying ending'}.
- "narration": 1-2 short spoken sentences (max 30 words) in ${lang === 'auto' ? 'the same language as the user\'s text' : lang}.
- "visual": a vivid English image prompt for that moment: subject, action, setting, camera angle, mood. No text or letters in the image.`;
  const reply = await chat([{ role: 'system', content: sys }, { role: 'user', content: idea }], { signal, json: true, timeout: 90000 });
  const plan = parseJsonReply(reply);
  const list = (plan.scenes || []).filter((x) => x && (x.narration || x.visual)).slice(0, 24);
  if (!list.length) throw new Error('Empty movie plan');
  return {
    title: String(plan.title || '').slice(0, 60),
    character: String(plan.character || ''),
    scenes: list.map((x) => ({ narration: String(x.narration || '').trim(), visual: String(x.visual || x.narration || '').trim() })),
  };
}

/**
 * Offline fallback. A story: one scene per sentence. A short idea: a simple
 * story arc (opening → wish → struggle → turning point → ending) around it.
 */
export function offlineMovie(idea, count = 6) {
  const parts = scriptToScenes(idea);
  if (parts.length >= Math.min(3, count)) return { title: '', character: '', scenes: parts.slice(0, 24).map((p) => ({ narration: p.text, visual: p.text })) };
  const topic = String(idea).trim().replace(/[.!?।]+$/, '');
  const bn = /[\u0980-\u09FF]/.test(topic);
  const arc = bn
    ? [['গল্পের শুরু।', 'establishing wide shot, opening scene'], ['একটি স্বপ্ন জন্ম নেয়।', 'close-up, hopeful expression'], ['পথ সহজ ছিল না।', 'dramatic struggle, moody light'], ['তবু হার মানেনি।', 'determined, action shot'], ['অবশেষে সব বদলে গেল।', 'turning point, golden light'], ['আর এভাবেই গল্পটা শেষ হলো।', 'happy ending, wide shot, sunset']]
    : [['It all began here.', 'establishing wide shot, opening scene'], ['A dream was born.', 'close-up, hopeful expression'], ['The road was not easy.', 'dramatic struggle, moody light'], ['But giving up was never an option.', 'determined, action shot'], ['Then everything changed.', 'turning point, golden light'], ['And that is how the story ends.', 'happy ending, wide shot, sunset']];
  const n = Math.max(3, Math.min(count, arc.length));
  const pick = Array.from({ length: n }, (_, i) => arc[Math.round((i * (arc.length - 1)) / (n - 1))]);
  return {
    title: topic.slice(0, 40),
    character: '',
    scenes: pick.map(([line, shot], i) => ({ narration: i === 0 ? `${topic}. ${line}` : line, visual: `${topic}, ${shot}` })),
  };
}

// ---------- Hugging Face Spaces (Gradio REST API, works from the browser) ----------

export const spaceUrl = (id) => `https://${id.toLowerCase().replace(/[/_.]/g, '-')}.hf.space/gradio_api`;

/** Calls a Gradio endpoint and returns its output list. */
export async function gradioCall(space, endpoint, data, { signal, timeout = 180000 } = {}) {
  const base = spaceUrl(space);
  const ctl = new AbortController();
  signal?.addEventListener('abort', () => ctl.abort());
  return withTimeout(
    (async () => {
      const r = await fetch(`${base}/call/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }), signal: ctl.signal });
      if (!r.ok) throw new Error(`${space}: HTTP ${r.status}`);
      const { event_id: id } = await r.json();
      const text = await (await fetch(`${base}/call/${endpoint}/${id}`, { signal: ctl.signal })).text();
      return parseGradioStream(text, space);
    })(),
    timeout,
    ctl
  );
}

/** Reads the final result out of a Gradio server-sent-events reply. */
export function parseGradioStream(text, space = 'space') {
  const blocks = text.split(/\n\n+/).map((b) => ({ ev: /^event: *(.*)$/m.exec(b)?.[1], data: /^data: *(.*)$/m.exec(b)?.[1] }));
  const done = blocks.find((b) => b.ev === 'complete');
  if (done) return JSON.parse(done.data);
  const err = blocks.find((b) => b.ev === 'error');
  let msg = err?.data;
  try {
    msg = JSON.parse(msg)?.message || msg;
  } catch {}
  throw new Error(`${space}: ${msg && msg !== 'null' ? msg : 'busy or out of free GPU quota'}`);
}

async function gradioUpload(space, file, signal) {
  const fd = new FormData();
  fd.append('files', file, file.name || 'file');
  const r = await fetch(`${spaceUrl(space)}/upload`, { method: 'POST', body: fd, signal });
  if (!r.ok) throw new Error(`${space}: upload HTTP ${r.status}`);
  const [path] = await r.json();
  return { path, orig_name: file.name, meta: { _type: 'gradio.FileData' } };
}

async function fetchFile(url, name, type, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  const blob = await r.blob();
  return new File([blob], name, { type: blob.type && blob.type !== 'application/octet-stream' ? blob.type : type });
}

// ---------- Images ----------

const IMAGE_SPACE = 'black-forest-labs/FLUX.1-schnell';
const snap = (v) => Math.max(256, Math.round(v / 32) * 32);

/** FLUX.1-schnell on a free HF GPU Space: best quality, ~3 s per picture. */
async function fluxImage(prompt, { width, height, seed, signal, name }) {
  const [img] = await gradioCall(IMAGE_SPACE, 'infer', [prompt.slice(0, 1500), seed % 2147483647, false, snap(width), snap(height), 4], { signal, timeout: 90000 });
  if (!img?.url) throw new Error('FLUX returned no picture');
  return fetchFile(img.url, `${name}-${Date.now()}.webp`, 'image/webp', signal);
}

// Pollinations' free tier allows one picture at a time per user at ≤576×1024,
// so requests are queued and spaced out.
let pollQueue = Promise.resolve();
const POLL_GAP = 1200; // the free tier serves one picture at a time per user
export function imageUrl(prompt, { width = 576, height = 1024, seed = 1 } = {}) {
  const s = Math.min(1, 1024 / Math.max(width, height));
  const q = new URLSearchParams({ width: Math.round(width * s), height: Math.round(height * s), seed });
  return `${IMAGE_URL}${encodeURIComponent(prompt.slice(0, 700))}?${q}`;
}
function pollinationsImage(prompt, { width, height, seed, signal, name }) {
  const job = pollQueue.then(async () => {
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw new Error('cancelled');
      const ctl = new AbortController();
      signal?.addEventListener('abort', () => ctl.abort());
      try {
        const res = await withTimeout(fetch(imageUrl(prompt, { width, height, seed: seed + attempt }), { signal: ctl.signal }), 45000, ctl);
        if (res.status === 402 || res.status === 429) throw Object.assign(new Error(`busy (HTTP ${res.status})`), { wait: true });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob.type.startsWith('image/') || blob.size < 2000) throw new Error('bad picture');
        return new File([blob], `${name}-${Date.now()}.jpg`, { type: blob.type });
      } catch (e) {
        if (signal?.aborted) throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, (e.wait ? 5000 : 1500) * (attempt + 1)));
      }
    }
    throw lastErr;
  });
  pollQueue = job.catch(() => {}).then(() => new Promise((r) => setTimeout(r, POLL_GAP)));
  return job;
}

let fluxDown = 0; // time until which FLUX is skipped (after quota / errors)

/** Text → picture File. FLUX on Hugging Face first, then the AI gateway, then Pollinations. */
export async function generateImage(prompt, { width = 768, height = 1344, seed = Math.floor(Math.random() * 1e9), signal, name = 'ai-image' } = {}) {
  const o = { width, height, seed, signal, name };
  if (Date.now() > fluxDown) {
    try {
      return await fluxImage(prompt, o);
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('[Clipora] FLUX Space unavailable, using backup', e);
      fluxDown = Date.now() + 5 * 60000;
    }
  }
  try {
    return await gatewayImage(prompt, { seed, signal, name });
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  try {
    return await pollinationsImage(prompt, o);
  } catch (e) {
    throw new Error(`AI picture services are busy (${e.message}). Try again in a minute.`);
  }
}

// ---------- Picture → video ----------

/** Picture → ~2-3 s video clip (MP4 File) with LTX-Video on a free HF GPU Space. */
export async function animateImage(imageFile, prompt, { width = 512, height = 704, seconds = 2.5, signal } = {}) {
  const img = await gradioUpload(VIDEO_SPACE, imageFile, signal);
  const out = await gradioCall(
    VIDEO_SPACE,
    'image_to_video',
    [`${prompt}, smooth natural motion, cinematic camera movement`, 'worst quality, inconsistent motion, blurry, jittery, distorted, text, watermark', img, null, height, width, 'image-to-video', seconds, 9, 42, true, 1, true],
    { signal, timeout: 240000 }
  );
  const url = out?.[0]?.video?.url || out?.[0]?.url;
  if (!url) throw new Error('No video returned');
  return fetchFile(url, `ai-clip-${Date.now()}.mp4`, 'video/mp4', signal);
}
