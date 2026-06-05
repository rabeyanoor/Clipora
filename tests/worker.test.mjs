// AI gateway (server/worker.js) with mocked Groq / Gemini / Workers AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.js';

const ORIGIN = 'https://appassets.androidplatform.net';
const env0 = { ALLOWED_ORIGINS: ORIGIN, GROQ_MODELS: 'big,small' };
const post = (path, body, headers = {}) =>
  new Request(`https://gw.test${path}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: body instanceof FormData ? body : JSON.stringify(body) });

function mockFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { calls, restore: () => (globalThis.fetch = orig) };
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

test('gateway: health and CORS', async () => {
  const r = await worker.fetch(new Request('https://gw.test/v1/health', { headers: { origin: ORIGIN } }), { ...env0, GROQ_KEY: 'k' });
  assert.deepEqual(await r.json(), { ok: true, chat: true, transcribe: true, image: false });
  assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  const bad = await worker.fetch(new Request('https://gw.test/v1/health', { headers: { origin: 'https://evil.example' } }), env0);
  assert.notEqual(bad.headers.get('access-control-allow-origin'), 'https://evil.example');
  const pre = await worker.fetch(new Request('https://gw.test/v1/chat', { method: 'OPTIONS', headers: { origin: ORIGIN } }), env0);
  assert.equal(pre.status, 204);
});

test('gateway: chat falls back Groq big → Groq small → Gemini', async () => {
  const m = mockFetch((url) => {
    if (url.includes('groq')) return json({ error: 'busy' }, 429);
    return json({ candidates: [{ content: { parts: [{ text: '{"title":"Cat"}' }] } }] });
  });
  try {
    const r = await worker.fetch(post('/v1/chat', { messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'cat' }], json: true }), { ...env0, GROQ_KEY: 'g', GEMINI_KEY: 'm' });
    const d = await r.json();
    assert.equal(r.status, 200);
    assert.equal(d.text, '{"title":"Cat"}');
    assert.equal(d.provider, 'gemini');
    assert.equal(m.calls.length, 3);
    assert.equal(JSON.parse(m.calls[0].init.body).model, 'big');
    assert.equal(JSON.parse(m.calls[1].init.body).model, 'small');
    const g = JSON.parse(m.calls[2].init.body);
    assert.equal(g.systemInstruction.parts[0].text, 'be brief');
    assert.equal(g.generationConfig.responseMimeType, 'application/json');
    assert.equal(m.calls[2].init.headers['x-goog-api-key'], 'm');
  } finally {
    m.restore();
  }
});

test('gateway: Groq answer is returned directly; no keys → 503', async () => {
  const m = mockFetch(() => json({ choices: [{ message: { content: 'hello' } }] }));
  try {
    const d = await (await worker.fetch(post('/v1/chat', { messages: [{ role: 'user', content: 'hi' }] }), { ...env0, GROQ_KEY: 'g' })).json();
    assert.deepEqual(d, { text: 'hello', provider: 'groq:big' });
    const none = await worker.fetch(post('/v1/chat', { messages: [{ role: 'user', content: 'hi' }] }), env0);
    assert.equal(none.status, 503);
  } finally {
    m.restore();
  }
});

test('gateway: per-IP rate limit → 429', async () => {
  const seen = [];
  const env = { ...env0, GROQ_KEY: 'g', CHAT_LIMIT: { limit: async ({ key }) => (seen.push(key), { success: seen.length < 2 }) } };
  const m = mockFetch(() => json({ choices: [{ message: { content: 'ok' } }] }));
  try {
    const req = () => post('/v1/chat', { messages: [{ role: 'user', content: 'hi' }] }, { 'cf-connecting-ip': '1.2.3.4' });
    assert.equal((await worker.fetch(req(), env)).status, 200);
    assert.equal((await worker.fetch(req(), env)).status, 429);
    assert.equal(seen[0], '/v1/chat:1.2.3.4');
  } finally {
    m.restore();
  }
});

test('gateway: transcribe forwards audio to Whisper and returns segments', async () => {
  const m = mockFetch(() => json({ language: 'bengali', segments: [{ start: 0, end: 1.5, text: ' আমি ' }, { start: 1.5, end: 3, text: 'ভালো' }] }));
  try {
    const fd = new FormData();
    fd.append('file', new Blob([new Uint8Array(100)], { type: 'audio/wav' }), 'a.wav');
    fd.append('language', 'bn');
    const r = await worker.fetch(new Request('https://gw.test/v1/transcribe', { method: 'POST', headers: { origin: ORIGIN }, body: fd }), { ...env0, GROQ_KEY: 'g' });
    const d = await r.json();
    assert.deepEqual(d.segments, [{ start: 0, end: 1.5, text: 'আমি' }, { start: 1.5, end: 3, text: 'ভালো' }]);
    const sent = m.calls[0].init.body;
    assert.equal(sent.get('model'), 'whisper-large-v3-turbo');
    assert.equal(sent.get('language'), 'bn');
    assert.equal(sent.get('response_format'), 'verbose_json');
  } finally {
    m.restore();
  }
});

test('gateway: image uses Workers AI FLUX and returns a JPEG', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
  let args;
  const env = { ...env0, AI: { run: async (model, a) => ((args = [model, a]), { image: jpeg }) } };
  const r = await worker.fetch(post('/v1/image', { prompt: 'a cat chef', seed: 42 }), env);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())].slice(0, 3), [0xff, 0xd8, 0xff]);
  assert.equal(args[0], '@cf/black-forest-labs/flux-1-schnell');
  assert.equal(args[1].seed, 42);
  assert.equal((await worker.fetch(post('/v1/image', { prompt: 'x' }), env)).status, 400);
});
