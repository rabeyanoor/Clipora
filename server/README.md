# Clipora AI gateway (free)

A small Cloudflare Worker that makes the app's AI fast and reliable for thousands of users,
using only free tiers. It keeps the API keys secret (they never go into the app) and limits
every user per minute so nobody can use up the shared free quota.

| What | Provider (free tier) | Speed |
|---|---|---|
| AI Movie story writing | Groq gpt-oss-120b → gpt-oss-20b → Qwen → Gemini Flash-Lite | ~2 s |
| Auto-captions | Groq Whisper large-v3-turbo | a few seconds per video |
| Pictures (backup) | Workers AI FLUX.1-schnell | 2–4 s |

Without the gateway the app still works with the public free services (slower, less reliable under load).

Rough capacity for ~5,000 users/day: Workers 100,000 requests/day · Groq ~300 stories per model and ~2,000 Whisper
requests/day · Workers AI ~230 pictures/day (pictures mainly come from the free Hugging Face FLUX Space and
Pollinations, whose quotas are per user). Check the live limits in each provider's console.

## Set up (10 minutes, no credit card)

1. **Groq key**: sign up at https://console.groq.com → API Keys → Create. Copy the key.
2. **Gemini key** (optional backup): https://aistudio.google.com/apikey → Create API key.
3. **Cloudflare account**: sign up at https://dash.cloudflare.com (free plan).
4. Deploy from this folder (run these yourself; type the keys when asked, never put them in files):

   ```bash
   cd server
   npx wrangler login
   npx wrangler secret put GROQ_KEY
   npx wrangler secret put GEMINI_KEY      # optional
   npx wrangler deploy
   ```

   Wrangler prints the URL, e.g. `https://clipora-ai.<you>.workers.dev`.
5. Put that URL in `js/config.js` (`AI_GATEWAY`), and add your web app's address (if any) to
   `ALLOWED_ORIGINS` in `wrangler.toml`, then `npx wrangler deploy` again. The Android app's origin
   (`https://appassets.androidplatform.net`) is already allowed.
6. Check it: open `https://clipora-ai.<you>.workers.dev/v1/health`. It should show `"chat":true`.

## Tests

`npm test` (in the project root) runs the gateway tests with mocked providers; no keys needed.
