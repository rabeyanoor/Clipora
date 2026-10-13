// AI Movie: an idea or a whole story → a finished, narrated movie.
//   1. A screenwriter model splits it into scenes (narration + picture prompt)
//   2. Every scene gets an AI picture in the chosen look (3 at a time)
//   3. Narration is spoken by an on-device AI voice (Bangla, English, Hindi…)
//   4. Optionally each picture is animated into a short AI video clip
// The result is a normal Clipora project, so everything stays editable.

import { writeMovie, offlineMovie, generateImage, animateImage, LOOKS } from './cloud.js';
import { speak, detectLang } from './ai.js';
import { captionsFromScript } from './time.js';

export const MOVIE_SIZES = { '9:16': [768, 1344], '16:9': [1344, 768], '1:1': [1024, 1024], '4:5': [896, 1120] };
const TRANSITIONS = ['dissolve', 'zoom', 'fade', 'slide', 'blur', 'dissolve', 'push', 'flash'];
const ANIMS = ['zoomOut', 'none', 'fadeIn', 'none', 'zoomIn', 'none'];

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    })
  );
}

/**
 * Runs the whole pipeline. `onUpdate(state)` is called whenever something
 * finishes so the UI can show live progress. Returns the state.
 */
export async function makeMovie(opts, { onUpdate = () => {}, signal } = {}) {
  const { idea, scenes: count = 6, look = 'cinematic', aspect = '9:16', voice = true, animate = false } = opts;
  const lang = opts.lang && opts.lang !== 'auto' ? opts.lang : detectLang(idea);
  const st = { stage: 'plan', title: '', scenes: [], notes: [] };
  const emit = () => onUpdate(st);
  emit();

  let plan;
  try {
    plan = await writeMovie(idea, { scenes: count, lang: lang === 'bn' ? 'Bangla (Bengali script)' : lang === 'en' ? 'English' : 'auto', signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn('[Clipora] story AI unavailable, using offline split', e);
    plan = offlineMovie(idea);
    st.notes.push('offlinePlan');
  }
  st.title = plan.title;
  st.scenes = plan.scenes.map((s) => ({ ...s, image: null, clip: null, voice: null, status: 'waiting' }));
  st.stage = 'images';
  emit();

  const [width, height] = MOVIE_SIZES[aspect] || MOVIE_SIZES['9:16'];
  const seed = Math.floor(Math.random() * 1e8); // shared seed = more consistent look between scenes
  const style = LOOKS[look] || LOOKS.cinematic;
  await pool(st.scenes, 3, async (s, i) => {
    if (signal?.aborted) return;
    s.status = 'drawing';
    emit();
    const prompt = [s.visual, plan.character, style].filter(Boolean).join('. ');
    try {
      s.image = await generateImage(prompt, { width, height, seed: seed + i, signal, name: `scene-${i + 1}` });
      s.status = 'drawn';
    } catch (e) {
      if (signal?.aborted) return;
      console.warn('[Clipora] scene image failed', e);
      s.status = 'failed';
    }
    emit();
  });
  if (signal?.aborted) throw new Error('cancelled');

  if (voice) {
    st.stage = 'voice';
    emit();
    for (const s of st.scenes) {
      if (signal?.aborted) throw new Error('cancelled');
      if (!s.narration) continue;
      try {
        // First use downloads the voice model; never let a stalled download freeze the movie.
        const limit = st.voiceReady ? 90000 : 240000;
        s.voice = await Promise.race([
          speak(s.narration, { lang, onProgress: (f) => ((st.voiceDownload = f), emit()) }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('voice timed out')), limit)),
        ]);
        st.voiceReady = true;
      } catch (e) {
        console.warn('[Clipora] narration failed', e);
        st.notes.push('voiceFailed');
        break;
      }
      st.voiceDownload = null;
      emit();
    }
  }

  if (animate) {
    st.stage = 'animate';
    emit();
    for (const s of st.scenes) {
      if (signal?.aborted) throw new Error('cancelled');
      if (!s.image) continue;
      s.status = 'animating';
      emit();
      try {
        s.clip = await animateImage(s.image, s.visual, { width: aspect === '16:9' ? 704 : 512, height: aspect === '16:9' ? 512 : aspect === '1:1' ? 512 : 704, signal });
        s.status = 'animated';
      } catch (e) {
        console.warn('[Clipora] animation failed (free GPU quota?)', e);
        s.status = 'drawn';
        st.notes.push('animateFailed');
        break; // quota is per user per day: don't keep hammering
      }
      emit();
    }
  }
  st.stage = 'done';
  emit();
  return st;
}

/**
 * Turns finished scenes into project edits. `recs` are the imported media
 * records per scene: { visual: {id,type,duration}, voice: {id,duration}|null }.
 * Returns { clipPatches, captions, audios } for the caller to apply.
 */
export function assembleMovie(scenes, recs) {
  const clipPatches = [];
  const captions = [];
  const audios = [];
  let t = 0;
  scenes.forEach((s, i) => {
    const r = recs[i];
    if (!r?.visual) return;
    const words = (s.narration || '').split(/\s+/).filter(Boolean).length;
    const spoken = r.voice ? r.voice.duration + 0.5 : Math.min(7, Math.max(3, words / 2.6 + 0.8));
    const dur = +Math.max(2.5, spoken).toFixed(2);
    const patch = { fit: 'fill', transition: i ? TRANSITIONS[i % TRANSITIONS.length] : 'none', animIn: i ? 'none' : 'fadeIn' };
    if (r.visual.type === 'video') {
      // Stretch short AI clips to the narration length (slow motion, max 4x).
      const len = r.visual.duration;
      patch.out = len;
      patch.speed = Math.max(0.25, Math.min(1, len / dur));
      patch.muted = true;
    } else {
      patch.out = dur;
      patch.animIn = i ? ANIMS[i % ANIMS.length] : 'fadeIn';
    }
    const real = r.visual.type === 'video' ? patch.out / patch.speed : dur;
    clipPatches.push(patch);
    if (s.narration) for (const c of captionsFromScript(s.narration, real - 0.3, 6)) captions.push({ start: +(t + c.start).toFixed(3), end: +(t + c.end).toFixed(3), text: c.text });
    if (r.voice) audios.push({ mediaId: r.voice.id, kind: 'tts', start: +(t + 0.15).toFixed(3), in: 0, out: r.voice.duration, volume: 1 });
    t += real;
  });
  return { clipPatches, captions, audios };
}
