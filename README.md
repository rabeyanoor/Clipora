# Clipora: AI Video Editor

**Create More. Edit Less.** A free, watermark-free video editor for Reels, Shorts and TikTok. All processing (including the AI) runs on the user's phone, so there are no server costs and videos never leave the device.

## Features

| Area | What it does |
|---|---|
| Editing | Import videos + photos, timeline with scroll-to-seek, split, trim, delete, duplicate, reorder, speed 0.25–4x, volume/mute, fit/fill, undo/redo |
| Canvas | 9:16, 1:1, 4:5, 16:9 · blurred / colour background |
| Look | 8 filters + brightness/contrast/saturation · fade transitions · Ken Burns zoom on photos |
| Text | Styled text, colours, background box, 5 animations, drag to move, timing |
| Captions | **AI auto-captions (Whisper, on device, Bangla/English/Hindi/…)**, script → timed captions, SRT import/export, 4 caption styles |
| Music | Music/voice track, volume, start offset, loop, mute original |
| AI Movie 🎬 | **Idea, poem or whole story → finished narrated movie.** AI writes the scenes, draws every shot (FLUX), narrates it with an AI voice (Bangla, English, Hindi, Arabic…), adds captions + transitions, and can animate shots into real video (LTX-Video). Six looks: cinematic, realistic, anime, 3D cartoon, watercolor, comic |
| AI Image 🖼 | Text → picture in any shape, used as a clip, background or photo to edit; **Save frame as photo (PNG)** turns the editor into a photo editor too |
| Smart AI ✨ | **AI chat**: natural-language commands in English/Bangla (“make it 9:16, remove pauses, add text Hello”), shows a plan before applying |
| Pro editor feel | Frame-accurate timecode (MM:SS\|FF), previous/next clip jump, audio waveform under clips, asset library, focus (big preview) view, cream theme |
| Novelty | **Script → Video** (a scene card per sentence, timed for reading, optionally over your photos) · **Scene Detect** (splits a long video at camera cuts) · **Remove pauses** (silence cut) · **Auto Shorts** (best moments of a long video) · **Beat Sync** (cuts on music beats) · **Text-based cut** (✂ a caption to remove that part) · **Quick styles** (Vlog / Podcast / Slideshow / Cinematic) |
| Export | **Fast export**: frames are decoded and encoded with the phone's hardware codecs (WebCodecs + mediabunny) instead of recording in real time, audio is mixed offline (pitch-preserving speed changes). 480p–4K, 24/30/60 fps MP4, no watermark. Falls back to real-time recording on old browsers |
| App | Animated opening, installable PWA, offline app shell, projects saved on the device |

Compared with CapCut and InShot, the main differences are: no watermark, no paywalled basics, no account needed, privacy (nothing uploaded), and Bangla-first support.

## Where the AI runs (zero server cost)

| Feature | Runs on | Cost |
|---|---|---|
| Captions (Whisper), voice-over (MMS-TTS), background removal | the user's phone (transformers.js) | free |
| Story writing | Pollinations text API, called from the phone | free, no key |
| Pictures | FLUX.1-schnell on a free Hugging Face ZeroGPU Space, Pollinations as backup | free, quota per user |
| Animate shots | LTX-Video on a free Hugging Face ZeroGPU Space | free, small daily quota per user |

Every request goes from the user's own device to the free service, so quotas are per user and there is no server to scale or pay for. Free quotas are small; for heavy use, a paid API (HF Inference Providers, fal) can be plugged into `js/cloud.js`.

Local testing note: Pollinations refuses requests whose `Origin` is `localhost`, so story writing falls back to the offline splitter on `http://localhost`. Deployed sites and the Android app are not affected.

## Run locally

```bash
python3 -m http.server 8080      # then open http://localhost:8080
npm test                         # 30 unit tests (no dependencies)
node tests/smoke.mjs             # browser test in headless Chrome (AI=1 also tests Whisper)
```

No build step and no npm packages: plain ES modules.

## Android APK

```bash
android/build.sh                 # → android/out/Clipora.apk (no Gradle/Android Studio needed)
```

The web app is bundled inside the APK and served from a secure origin, so it works offline. Keep `android/keystore/` safe: Play Store updates must be signed with the same key.

## Publish to the Play Store

1. **Host it on HTTPS.** Free option, a Hugging Face static Space:
   `HF_TOKEN=hf_xxx ./deploy-hf.sh` → `https://rabeya100x-clipora.static.hf.space`
   (GitHub Pages, Netlify and Cloudflare Pages work too.)
2. Open **https://www.pwabuilder.com**, paste the URL, choose **Android → Generate package**. This gives you a signed `.aab` (Trusted Web Activity) plus `assetlinks.json`.
3. Put `assetlinks.json` in `.well-known/` in this folder and redeploy, so the app opens full-screen without the browser bar.
4. Create a Google Play developer account ($25 one-time), upload the `.aab`, and fill in the store listing (icon: `icons/icon-512.png`), privacy policy and content rating.

## Roadmap ideas

- Multiple audio tracks + voice-over recording, stickers/emoji, keyframe animation, chroma key
- Translated captions, AI voice-over (text-to-speech), auto-reframe that follows faces
- Optional cloud account + paid "Pro" credits for heavy AI (only once there are real users)
# Clipora
# Clipora
