// More on-device AI from the Hugging Face Hub (transformers.js, no API key):
// text-to-speech voice-overs and background removal for pictures.

const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
export const TTS_MODEL = 'Xenova/mms-tts-eng';
// Meta MMS voices per language. Full precision (~114 MB, downloaded once per language): in the browser it
// speaks 2-3x faster than the 38 MB quantized version.
export const TTS_MODELS = {
  en: { model: TTS_MODEL, dtype: 'fp32' },
  bn: { model: 'PRAMSSS/mms-tts-bengali-webgpu', dtype: 'fp32' },
  hi: { model: 'Xenova/mms-tts-hin', dtype: 'fp32' },
  ar: { model: 'Xenova/mms-tts-ara', dtype: 'fp32' },
  es: { model: 'Xenova/mms-tts-spa', dtype: 'fp32' },
  fr: { model: 'Xenova/mms-tts-fra', dtype: 'fp32' },
  de: { model: 'Xenova/mms-tts-deu', dtype: 'fp32' },
  pt: { model: 'Xenova/mms-tts-por', dtype: 'fp32' },
  ru: { model: 'Xenova/mms-tts-rus', dtype: 'fp32' },
  ko: { model: 'Xenova/mms-tts-kor', dtype: 'fp32' },
  vi: { model: 'Xenova/mms-tts-vie', dtype: 'fp32' },
};

/** Guesses the language of a text from its script (Latin text → English). */
export function detectLang(text) {
  const s = String(text);
  const count = (re) => (s.match(re) || []).length;
  const scores = { bn: count(/[\u0980-\u09FF]/g), hi: count(/[\u0900-\u097F]/g), ar: count(/[\u0600-\u06FF]/g), ru: count(/[\u0400-\u04FF]/g), ko: count(/[\uAC00-\uD7AF]/g) };
  const [best, n] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : 'en';
}
export const CUTOUT_MODEL = 'Xenova/modnet';

const pipes = new Map();
function progress(onProgress) {
  const files = new Map();
  return (e) => {
    if (e.status !== 'progress' || !e.total) return;
    files.set(e.file, [e.loaded, e.total]);
    let a = 0;
    let b = 0;
    for (const [l, t] of files.values()) (a += l), (b += t);
    onProgress?.(a / b);
  };
}

async function getPipe(task, model, onProgress, dtype = 'q8') {
  const key = `${task}:${model}`;
  if (!pipes.has(key)) {
    pipes.set(key, (async () => {
      const { pipeline, env } = await import(TF_URL);
      env.allowLocalModels = false;
      return pipeline(task, model, { device: 'wasm', dtype, progress_callback: progress(onProgress) });
    })());
  }
  try {
    return await pipes.get(key);
  } catch (e) {
    pipes.delete(key);
    throw e;
  }
}

/** Starts downloading a voice in the background (e.g. while the story is being written). */
export function preloadVoice(lang, onProgress) {
  const { model, dtype } = TTS_MODELS[lang] || TTS_MODELS.en;
  return getPipe('text-to-speech', model, onProgress, dtype).then(() => true, () => false);
}

/** Text → spoken audio as a WAV File. `lang` defaults to the text's script. */
export async function speak(text, { onProgress, lang } = {}) {
  const { model, dtype } = TTS_MODELS[lang || detectLang(text)] || TTS_MODELS.en;
  const tts = await getPipe('text-to-speech', model, onProgress, dtype);
  // Long texts: one sentence at a time (MMS works best on short inputs), joined with short pauses.
  const parts = String(text).split(/(?<=[.!?।؟])\s+/).map((x) => x.trim()).filter(Boolean);
  const chunks = [];
  let rate = 16000;
  for (const part of parts.length ? parts : [text]) {
    const out = await tts(part);
    rate = out.sampling_rate;
    chunks.push(out.audio, new Float32Array(Math.round(rate * 0.25)));
  }
  const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) all.set(c, (o += c.length) - c.length);
  return new File([encodeWav(all, rate)], `voice-${Date.now()}.wav`, { type: 'audio/wav' });
}

/** Removes the background of a picture; returns a transparent PNG File. */
export async function removeBackground(blob, { onProgress } = {}) {
  const seg = await getPipe('background-removal', CUTOUT_MODEL, onProgress);
  const url = URL.createObjectURL(blob);
  try {
    const [img] = await seg(url);
    const png = await img.toBlob('image/png');
    return new File([png], `cutout-${Date.now()}.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 16-bit mono PCM WAV. */
export function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return buf;
}
