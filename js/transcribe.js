// AI auto-captions with OpenAI Whisper running fully on the device through
// Hugging Face transformers.js. The model (~80 MB) downloads once from the
// Hugging Face Hub and is cached by the browser; no API key is needed.

import { decodePcm16k } from './analysis.js';
import { captionsFromScript } from './time.js';
import { hasGateway, gatewayTranscribe } from './gateway.js';
import { encodeWav } from './ai.js';

// Whisper language names (used on device) → ISO codes (used by the cloud API).
const ISO = { english: 'en', bengali: 'bn', hindi: 'hi', arabic: 'ar', spanish: 'es', urdu: 'ur' };
const CLOUD_CHUNK_S = 600; // 10 min of 16 kHz 16-bit WAV ≈ 19 MB, under the 24 MB request limit

const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
export const MODEL = 'onnx-community/whisper-base';
export const MAX_MINUTES = 20;

let pipePromise = null;
const transcripts = new Map();

async function getPipe(onProgress) {
  pipePromise ??= (async () => {
    const { pipeline, env } = await import(TF_URL);
    env.allowLocalModels = false;
    const files = new Map();
    return pipeline('automatic-speech-recognition', MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (e) => {
        if (e.status !== 'progress' || !e.total) return;
        files.set(e.file, [e.loaded, e.total]);
        let a = 0;
        let b = 0;
        for (const [l, t] of files.values()) (a += l), (b += t);
        onProgress?.({ stage: 'download', value: a / b });
      },
    });
  })();
  try {
    return await pipePromise;
  } catch (e) {
    pipePromise = null;
    throw e;
  }
}

// Returns [{start, end, text}] in source-media seconds.
// Fast path: Groq Whisper through the AI gateway (a few seconds), else on device.
export async function transcribeMedia(media, { language = 'auto', onProgress } = {}) {
  const key = `${media.id}:${language}`;
  if (transcripts.has(key)) return transcripts.get(key);
  if (hasGateway()) {
    try {
      onProgress?.({ stage: 'listen', value: 0 });
      const pcm = await decodePcm16k(media.id, media.blob);
      if (pcm.length / 16000 > MAX_MINUTES * 60) throw new Error(`Video longer than ${MAX_MINUTES} minutes`);
      const chunks = await cloudTranscribe(pcm, ISO[language], onProgress);
      transcripts.set(key, chunks);
      return chunks;
    } catch (e) {
      console.warn('[Clipora] cloud captions unavailable, using on-device Whisper', e);
    }
  }
  const pipe = await getPipe(onProgress);
  onProgress?.({ stage: 'listen', value: 0 });
  const pcm = await decodePcm16k(media.id, media.blob);
  const seconds = pcm.length / 16000;
  if (seconds > MAX_MINUTES * 60) throw new Error(`Video longer than ${MAX_MINUTES} minutes`);
  const opts = { task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 };
  if (language !== 'auto') opts.language = language;
  const out = await pipe(pcm, opts);
  const chunks = (out.chunks || [])
    .map((c) => ({ start: c.timestamp[0] ?? 0, end: c.timestamp[1] ?? Math.min(seconds, (c.timestamp[0] ?? 0) + 3), text: c.text.trim() }))
    .filter((c) => c.text && c.end > c.start && !/^[([♪].*[)\]♪]$/.test(c.text)); // drop "(music)", "[applause]" etc.
  transcripts.set(key, chunks);
  return chunks;
}

async function cloudTranscribe(pcm, language, onProgress) {
  const out = [];
  const step = CLOUD_CHUNK_S * 16000;
  for (let i = 0; i < pcm.length; i += step) {
    const part = pcm.subarray(i, Math.min(pcm.length, i + step));
    const segs = await gatewayTranscribe(new File([encodeWav(part, 16000)], 'audio.wav', { type: 'audio/wav' }), { language });
    const off = i / 16000;
    for (const s of segs) out.push({ start: off + s.start, end: off + s.end, text: s.text });
    onProgress?.({ stage: 'listen', value: Math.min(1, (i + step) / pcm.length) });
  }
  return out.filter((c) => c.text && c.end > c.start && !/^[([♪].*[)\]♪]$/.test(c.text));
}

// Map source-time transcript chunks of each clip onto the edited timeline.
export function toTimeline(clips, starts, transcriptsByMedia) {
  const caps = [];
  clips.forEach((c, i) => {
    for (const ch of transcriptsByMedia.get(c.mediaId) || []) {
      const a = Math.max(ch.start, c.in);
      const b = Math.min(ch.end, c.out);
      if (b - a < 0.15) continue;
      const t0 = starts[i] + (a - c.in) / c.speed;
      for (const part of captionsFromScript(ch.text, (b - a) / c.speed, 7))
        caps.push({ start: +(t0 + part.start).toFixed(3), end: +(t0 + part.end).toFixed(3), text: part.text });
    }
  });
  return caps;
}
