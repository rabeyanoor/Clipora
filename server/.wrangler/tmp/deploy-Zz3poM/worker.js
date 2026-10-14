var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var JSON_HEADERS = { "content-type": "application/json" };
var MAX_AUDIO = 24 * 1024 * 1024;
var MAX_PROMPT = 8e3;
var worker_default = {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const reply = /* @__PURE__ */ __name((body, status = 200, headers = JSON_HEADERS) => new Response(typeof body === "string" || body instanceof ArrayBuffer || body instanceof ReadableStream ? body : JSON.stringify(body), { status, headers: { ...headers, ...cors } }), "reply");
    try {
      if (url.pathname === "/v1/health") return reply({ ok: true, chat: !!(env.GROQ_KEY || env.GEMINI_KEY), transcribe: !!env.GROQ_KEY, image: !!env.AI });
      if (req.method !== "POST") return reply({ error: "Not found" }, 404);
      const route = { "/v1/chat": chat, "/v1/transcribe": transcribe, "/v1/image": image }[url.pathname];
      if (!route) return reply({ error: "Not found" }, 404);
      if (!await allowed(req, env, url.pathname)) return reply({ error: "Too many requests. Wait a minute." }, 429);
      return await route(req, env, reply);
    } catch (e) {
      return reply({ error: String(e?.message || e).slice(0, 300) }, e?.status || 502);
    }
  }
};
function corsHeaders(req, env) {
  const origin = req.headers.get("origin") || "";
  const list = String(env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = list.includes("*") || list.includes(origin);
  return {
    "access-control-allow-origin": ok ? origin || "*" : list[0] || "null",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "origin"
  };
}
__name(corsHeaders, "corsHeaders");
async function allowed(req, env, route) {
  const limiter = { "/v1/chat": env.CHAT_LIMIT, "/v1/transcribe": env.STT_LIMIT, "/v1/image": env.IMAGE_LIMIT }[route];
  if (!limiter) return true;
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await limiter.limit({ key: `${route}:${ip}` });
  return success;
}
__name(allowed, "allowed");
var fail = /* @__PURE__ */ __name((msg, status = 502) => Object.assign(new Error(msg), { status }), "fail");
async function chat(req, env, reply) {
  const body = await req.json();
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-6).map((m) => ({ role: ["system", "user", "assistant"].includes(m.role) ? m.role : "user", content: String(m.content || "").slice(0, MAX_PROMPT) }));
  if (!messages.length) throw fail("No messages", 400);
  const json = !!body.json;
  const errors = [];
  for (const model of String(env.GROQ_MODELS || "llama-3.3-70b-versatile,llama-3.1-8b-instant").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (!env.GROQ_KEY) break;
    try {
      return reply({ text: await groqChat(env, model, messages, json), provider: `groq:${model}` });
    } catch (e) {
      errors.push(`groq ${model}: ${e.message}`);
    }
  }
  if (env.GEMINI_KEY) {
    try {
      return reply({ text: await geminiChat(env, messages, json), provider: "gemini" });
    } catch (e) {
      errors.push(`gemini: ${e.message}`);
    }
  }
  throw fail(errors.length ? errors.join(" | ") : "No AI key configured", 503);
}
__name(chat, "chat");
async function groqChat(env, model, messages, json) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${env.GROQ_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.9, max_tokens: 2048, ...json ? { response_format: { type: "json_object" } } : {} })
  });
  if (!r.ok) throw fail(`HTTP ${r.status}`, r.status);
  const d = await r.json();
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw fail("empty reply");
  return text;
}
__name(groqChat, "groqChat");
async function geminiChat(env, messages, json) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      ...system ? { systemInstruction: { parts: [{ text: system }] } } : {},
      contents,
      generationConfig: { temperature: 0.9, maxOutputTokens: 2048, ...json ? { responseMimeType: "application/json" } : {} }
    })
  });
  if (!r.ok) throw fail(`HTTP ${r.status}`, r.status);
  const d = await r.json();
  const text = d.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
  if (!text) throw fail("empty reply");
  return text;
}
__name(geminiChat, "geminiChat");
async function transcribe(req, env, reply) {
  if (!env.GROQ_KEY) throw fail("Transcription not configured", 503);
  const form = await req.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") throw fail("No audio file", 400);
  if (file.size > MAX_AUDIO) throw fail("Audio too large (max 24 MB per request)", 413);
  const out = new FormData();
  out.append("file", file, file.name || "audio.wav");
  out.append("model", env.WHISPER_MODEL || "whisper-large-v3-turbo");
  out.append("response_format", "verbose_json");
  const lang = String(form.get("language") || "");
  if (/^[a-z]{2}$/.test(lang)) out.append("language", lang);
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${env.GROQ_KEY}` }, body: out });
  if (!r.ok) throw fail(`Whisper HTTP ${r.status}`, r.status === 429 ? 429 : 502);
  const d = await r.json();
  return reply({ language: d.language, segments: (d.segments || []).map((s) => ({ start: s.start, end: s.end, text: String(s.text || "").trim() })) });
}
__name(transcribe, "transcribe");
async function image(req, env, reply) {
  if (!env.AI) throw fail("Images not configured", 503);
  const body = await req.json();
  const prompt = String(body.prompt || "").slice(0, 2e3);
  if (prompt.length < 3) throw fail("No prompt", 400);
  const out = await env.AI.run(env.IMAGE_MODEL || "@cf/black-forest-labs/flux-1-schnell", { prompt, steps: 4, seed: Math.abs(+body.seed || 0) % 2147483647 || void 0 });
  if (!out?.image) throw fail("No picture returned");
  const bin = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
  return reply(bin.buffer, 200, { "content-type": "image/jpeg" });
}
__name(image, "image");
export {
  corsHeaders,
  worker_default as default,
  geminiChat,
  groqChat
};
//# sourceMappingURL=worker.js.map
