// Client for the Clipora AI gateway (server/worker.js). Every call throws when
// the gateway isn't configured or fails, so callers fall back to free services.

import { AI_GATEWAY } from './config.js';

const base = AI_GATEWAY.replace(/\/+$/, '');
export const hasGateway = () => !!base;

// A service that just failed is skipped for a while instead of slowing every call.
const downUntil = new Map();
const isDown = (k) => (downUntil.get(k) || 0) > Date.now();

async function call(path, init, { signal, timeout = 60000 } = {}) {
  if (!base) throw new Error('No AI gateway configured');
  if (isDown(path)) throw new Error('AI gateway temporarily skipped');
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(base + path, { ...init, signal: ctl.signal });
    if (!r.ok) {
      const msg = (await r.json().catch(() => null))?.error || `HTTP ${r.status}`;
      if (r.status >= 500 || r.status === 429) downUntil.set(path, Date.now() + (r.status === 429 ? 60000 : 120000));
      throw new Error(`AI gateway: ${msg}`);
    }
    return r;
  } catch (e) {
    if (!signal?.aborted && e.name === 'AbortError') downUntil.set(path, Date.now() + 120000);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Chat completion → reply text (Groq / Gemini behind the gateway). */
export async function gatewayChat(messages, { json = false, signal, timeout = 45000 } = {}) {
  const r = await call('/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages, json }) }, { signal, timeout });
  return (await r.json()).text;
}

/** Audio File/Blob → [{start, end, text}] (Groq Whisper behind the gateway). */
export async function gatewayTranscribe(audio, { language, signal, timeout = 120000 } = {}) {
  const fd = new FormData();
  fd.append('file', audio, audio.name || 'audio.wav');
  if (language) fd.append('language', language);
  const r = await call('/v1/transcribe', { method: 'POST', body: fd }, { signal, timeout });
  return (await r.json()).segments || [];
}

/** Prompt → picture File (Workers AI FLUX behind the gateway). */
export async function gatewayImage(prompt, { seed, signal, name = 'ai-image', timeout = 45000 } = {}) {
  const r = await call('/v1/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, seed }) }, { signal, timeout });
  const blob = await r.blob();
  if (blob.size < 2000) throw new Error('AI gateway: bad picture');
  return new File([blob], `${name}-${Date.now()}.jpg`, { type: 'image/jpeg' });
}
