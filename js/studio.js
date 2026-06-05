// AI Studio dialogs: "AI Movie" (idea/story → narrated movie) and
// "AI Image" (text → picture). The pipelines live in movie.js / cloud.js;
// this file is only the UI.

import { makeMovie } from './movie.js';
import { generateImage, LOOKS } from './cloud.js';
import { MOVIE_SIZES } from './movie.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const LOOK_NAMES = { cinematic: '🎬 Cinematic', realistic: '📷 Realistic', anime: '🌸 Anime', cartoon3d: '🧸 3D Cartoon', watercolor: '🎨 Watercolor', comic: '💥 Comic' };
const EXAMPLES = [
  'A street cat in Dhaka dreams of becoming a famous chef',
  'A little village girl dreams of flying to the moon',
  'A lonely robot finds a flower growing on Mars',
  'The history of the Sundarbans tiger in 60 seconds',
];

let busy = false;

/** deps: { toast, buildMovieProject(state, opts), useImage(file, opts) } */
export function openMovieDialog(deps, preset = {}) {
  const d = $('#studioDlg');
  const o = { idea: preset.idea || '', scenes: 6, look: 'cinematic', aspect: '9:16', voice: true, animate: false };
  const form = () => {
    d.innerHTML = `<div class="studio-head"><span class="spark">✨</span><div><h3>AI Movie</h3><p class="hint">Write an idea, a poem or a whole story. AI writes the scenes, draws every shot, narrates it and edits the movie.</p></div></div>
      <textarea id="movieIdea" rows="5" maxlength="6000" placeholder="e.g. ${esc(EXAMPLES[0])}">${esc(o.idea)}</textarea>
      <div class="row scroll">${EXAMPLES.map((x, i) => `<button class="chip" data-ex="${i}" type="button">${esc(x.length > 34 ? `${x.slice(0, 32)}…` : x)}</button>`).join('')}</div>
      <div class="label">Look</div>
      <div class="row scroll">${Object.keys(LOOKS).map((k) => `<button class="chip ${o.look === k ? 'on' : ''}" data-look="${k}" type="button">${LOOK_NAMES[k]}</button>`).join('')}</div>
      <div class="label">Scenes · Shape</div>
      <div class="row">${[4, 6, 8, 12].map((n) => `<button class="chip ${o.scenes === n ? 'on' : ''}" data-n="${n}" type="button">${n}</button>`).join('')}
        <span class="sep"></span>${Object.keys(MOVIE_SIZES).map((a) => `<button class="chip ${o.aspect === a ? 'on' : ''}" data-aspect="${a}" type="button">${a}</button>`).join('')}</div>
      <label class="switch"><input type="checkbox" id="movieVoice" ${o.voice ? 'checked' : ''}><span>🗣 AI narration voice <small>(Bangla, English, Hindi… on your phone)</small></span></label>
      <label class="switch"><input type="checkbox" id="movieAnimate" ${o.animate ? 'checked' : ''}><span>🎞 Animate scenes into video <small>(free AI GPU, slower, limited per day)</small></span></label>
      <div class="row end"><button class="btn-ghost" data-close type="button">Cancel</button><button class="btn-primary" data-make type="button">✨ Make movie</button></div>`;
  };
  form();
  let ctl = null;
  d.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    o.idea = $('#movieIdea')?.value ?? o.idea;
    o.voice = $('#movieVoice')?.checked ?? o.voice;
    o.animate = $('#movieAnimate')?.checked ?? o.animate;
    if (b.dataset.ex) (o.idea = EXAMPLES[+b.dataset.ex]), form();
    else if (b.dataset.look) (o.look = b.dataset.look), form();
    else if (b.dataset.n) (o.scenes = +b.dataset.n), form();
    else if (b.dataset.aspect) (o.aspect = b.dataset.aspect), form();
    else if (b.hasAttribute('data-close')) d.close();
    else if (b.hasAttribute('data-stop')) ctl?.abort();
    else if (b.hasAttribute('data-make')) {
      if (busy) return;
      if (o.idea.trim().length < 3) return deps.toast('Write an idea or a story first');
      busy = true;
      ctl = new AbortController();
      try {
        const st = await makeMovie(o, { signal: ctl.signal, onUpdate: (s) => progress(d, s) });
        if (!st.scenes.some((s) => s.image)) throw new Error('The free AI image service did not answer. Check the internet and try again.');
        d.innerHTML = `<div class="studio-head"><span class="spark">🎬</span><div><h3>Editing your movie…</h3><p class="hint">Putting scenes, voice and captions on the timeline.</p></div></div><div class="progress"><i style="width:100%" class="indet"></i></div>`;
        await deps.buildMovieProject(st, o);
        d.close();
        const notes = st.notes;
        deps.toast(notes.includes('animateFailed') ? '🎬 Movie ready! (free AI video quota used up: some scenes are still pictures)' : notes.includes('voiceFailed') ? '🎬 Movie ready! (voice could not load: captions only)' : '🎬 Your AI movie is ready! Tap ▶ to watch.', 6000);
      } catch (err) {
        if (ctl.signal.aborted) d.close();
        else {
          console.error(err);
          d.innerHTML = `<h3>Could not make the movie</h3><p class="hint">${esc(err.message)}</p><div class="row end"><button class="btn-ghost" data-close type="button">Close</button></div>`;
        }
      } finally {
        busy = false;
        ctl = null;
      }
    }
  };
  d.oncancel = (e) => busy && e.preventDefault();
  d.showModal();
}

const STAGES = { plan: '✍️ Writing the story…', images: '🎨 Drawing the scenes…', voice: '🗣 Recording the narration…', animate: '🎞 Animating scenes with AI video…', done: '✅ Done' };
const urls = new WeakMap();
const urlOf = (f) => {
  if (!urls.has(f)) urls.set(f, URL.createObjectURL(f));
  return urls.get(f);
};

function progress(d, st) {
  const n = st.scenes.length || 1;
  const drawn = st.scenes.filter((s) => s.image || s.status === 'failed').length;
  const voiced = st.scenes.filter((s) => s.voice).length;
  const pct = st.stage === 'plan' ? 6 : st.stage === 'images' ? 10 + (60 * drawn) / n : st.stage === 'voice' ? 70 + (20 * voiced) / n : st.stage === 'animate' ? 90 : 100;
  d.innerHTML = `<div class="studio-head"><span class="spark pulse">✨</span><div><h3>${esc(st.title || 'AI Movie')}</h3><p class="hint">${STAGES[st.stage]}${st.voiceDownload != null ? ` (voice model ${Math.round(st.voiceDownload * 100)}%, first time only)` : ''}</p></div></div>
    <div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="scene-grid">${st.scenes
      .map((s, i) => `<figure class="scene ${s.status}">${s.image ? `<img src="${urlOf(s.image)}" alt="">` : `<div class="ph">${s.status === 'failed' ? '⚠️' : '🎨'}</div>`}
        <figcaption><b>${i + 1}</b> ${esc(s.narration)}${s.voice ? ' 🗣' : ''}${s.clip ? ' 🎞' : ''}</figcaption></figure>`)
      .join('')}</div>
    <div class="row end"><button class="btn-ghost" data-stop type="button">Stop</button></div>`;
}

/** deps.useImage(file, { aspect, mode: 'new'|'add' }) */
export function openImageDialog(deps, { inEditor = false } = {}) {
  const d = $('#studioDlg');
  const o = { prompt: '', look: 'realistic', aspect: '9:16', results: [] };
  const draw = () => {
    d.innerHTML = `<div class="studio-head"><span class="spark">🖼</span><div><h3>AI Image</h3><p class="hint">Describe a picture. Use it as a clip, a background or a photo to edit.</p></div></div>
      <textarea id="imgPrompt" rows="3" maxlength="900" placeholder="e.g. a neon-lit rainy street in Dhaka at night, rickshaws, reflections">${esc(o.prompt)}</textarea>
      <div class="row scroll">${Object.keys(LOOKS).map((k) => `<button class="chip ${o.look === k ? 'on' : ''}" data-look="${k}" type="button">${LOOK_NAMES[k]}</button>`).join('')}</div>
      <div class="row">${Object.keys(MOVIE_SIZES).map((a) => `<button class="chip ${o.aspect === a ? 'on' : ''}" data-aspect="${a}" type="button">${a}</button>`).join('')}</div>
      ${o.results.length ? `<div class="scene-grid pick">${o.results.map((f, i) => `<button class="scene" data-use="${i}" type="button"><img src="${urlOf(f)}" alt="AI picture ${i + 1}"></button>`).join('')}</div><p class="hint">Tap a picture to use it.</p>` : ''}
      <div class="row end"><button class="btn-ghost" data-close type="button">Close</button><button class="btn-primary" data-gen type="button">${o.results.length ? '↻ More' : '✨ Generate'}</button></div>`;
  };
  draw();
  d.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    o.prompt = $('#imgPrompt')?.value ?? o.prompt;
    if (b.dataset.look) (o.look = b.dataset.look), draw();
    else if (b.dataset.aspect) (o.aspect = b.dataset.aspect), draw();
    else if (b.hasAttribute('data-close')) d.close();
    else if (b.dataset.use) {
      d.close();
      await deps.useImage(o.results[+b.dataset.use], { aspect: o.aspect, mode: inEditor ? 'add' : 'new' });
    } else if (b.hasAttribute('data-gen')) {
      if (busy) return;
      if (o.prompt.trim().length < 3) return deps.toast('Describe the picture first');
      busy = true;
      b.disabled = true;
      b.textContent = '🎨 Drawing…';
      const [width, height] = MOVIE_SIZES[o.aspect];
      try {
        const prompt = `${o.prompt}. ${LOOKS[o.look]}`;
        const got = await Promise.allSettled([0, 1].map(() => generateImage(prompt, { width, height })));
        const files = got.filter((g) => g.status === 'fulfilled').map((g) => g.value);
        if (!files.length) throw got[0].reason;
        o.results = [...files, ...o.results].slice(0, 6);
      } catch (err) {
        deps.toast(err.message, 5000);
      } finally {
        busy = false;
        draw();
      }
    }
  };
  d.oncancel = (e) => busy && e.preventDefault();
  d.showModal();
}
