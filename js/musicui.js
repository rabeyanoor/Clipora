// "Music library" dialog: search songs from around the world, preview, add to the video.

import { GENRES, PAGE, searchMusic, resolveTrack, downloadTrack, isNonCommercial } from './music.js';
import { fmt } from './time.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** deps: { toast, useTrack(file, track) } */
export function openMusicDialog(deps, { kind = 'music' } = {}) {
  const d = $('#studioDlg');
  const st = { q: '', page: 1, results: [], loading: false, error: '', playing: null, busy: null, more: false };
  const audio = new Audio();
  audio.preload = 'none';
  let ctl = null;

  const row = (t, i) => {
    const nc = isNonCommercial(t.license);
    return `<li class="track ${st.playing === i ? 'on' : ''}">
      <button class="play" data-play="${i}" type="button" aria-label="Preview">${st.playing === i ? '❚❚' : '▶'}</button>
      <div class="info"><b>${esc(t.title)}</b>
        <small>${esc(t.artist || 'Unknown artist')}${t.duration ? ` · ${fmt(t.duration)}` : ''} · ${esc(t.sourceName)}</small>
        <small class="lic ${nc ? 'nc' : ''}">${esc(t.license)}${nc ? ' · non-commercial only' : ''}</small></div>
      <button class="btn-primary sm" data-use="${i}" type="button" ${st.busy != null ? 'disabled' : ''}>${st.busy === i ? '…' : '＋ Use'}</button></li>`;
  };

  const draw = () => {
    const focus = document.activeElement?.id === 'musicQ';
    d.innerHTML = `<div class="studio-head"><span class="spark">🌍</span><div><h3>${kind === 'sfx' ? 'Sound effects' : 'Music library'}</h3>
      <p class="hint">Free songs from all over the world (Jamendo, Wikimedia, Internet Archive). Each one shows its license.</p></div></div>
      <form class="music-search" data-form><input id="musicQ" type="search" enterkeyhint="search" placeholder="${kind === 'sfx' ? 'e.g. whoosh, applause, rain' : 'Search a song, artist, genre or mood'}" value="${esc(st.q)}" autocomplete="off">
        <button class="btn-primary" type="submit">🔎</button></form>
      ${kind === 'sfx' ? '' : `<div class="row scroll genres">${GENRES.map(([label, q]) => `<button class="chip ${st.q === q ? 'on' : ''}" data-genre="${esc(q)}" type="button">${label}</button>`).join('')}</div>`}
      ${st.error ? `<p class="hint err">${esc(st.error)}</p>` : ''}
      ${st.loading && !st.results.length ? '<div class="progress"><i style="width:100%" class="indet"></i></div>' : ''}
      ${st.results.length ? `<ul class="music-list">${st.results.map(row).join('')}</ul>` : !st.loading && st.q && !st.error ? '<p class="hint">Nothing found. Try another word (English works best).</p>' : ''}
      ${st.more ? `<button class="btn-ghost more" data-more type="button" ${st.loading ? 'disabled' : ''}>${st.loading ? 'Loading…' : 'Show more'}</button>` : ''}
      <p class="hint small">Check the license before you post: "CC BY" needs a credit (Clipora copies it for you); "NC" songs can't be used in paid ads. Uploads of famous artists' songs may be wrongly labeled, and posting them can get your video muted.</p>
      <div class="row end"><button class="btn-ghost" data-close type="button">Close</button></div>`;
    if (focus) $('#musicQ')?.focus();
  };

  const search = async (q, more = false) => {
    ctl?.abort();
    ctl = new AbortController();
    if (!more) Object.assign(st, { q, page: 1, results: [], playing: null }), audio.pause();
    st.loading = true;
    st.error = '';
    draw();
    try {
      const got = await searchMusic(st.q, { page: st.page, kind, signal: ctl.signal });
      const seen = new Set(st.results.map((t) => t.id));
      st.results.push(...got.filter((t) => !seen.has(t.id)));
      st.more = got.length >= PAGE;
    } catch (e) {
      if (e.name === 'AbortError') return;
      st.error = e.message || 'Music search is not available right now.';
    }
    st.loading = false;
    draw();
  };

  d.onsubmit = (e) => {
    e.preventDefault();
    search($('#musicQ').value);
  };
  d.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b || b.type === 'submit') return;
    if (b.dataset.genre) return search(b.dataset.genre);
    if (b.hasAttribute('data-more')) return (st.page++, search(st.q, true));
    if (b.hasAttribute('data-close')) return d.close();
    if (b.dataset.play) {
      const i = +b.dataset.play;
      if (st.playing === i) {
        audio.pause();
        st.playing = null;
        return draw();
      }
      st.playing = i;
      draw();
      try {
        const t = await resolveTrack(st.results[i]);
        if (st.playing !== i) return;
        audio.src = t.url;
        await audio.play();
      } catch (err) {
        st.playing = null;
        deps.toast(err.name === 'NotAllowedError' ? 'Tap ▶ again to play' : err.message || 'Could not play this song');
        draw();
      }
      return;
    }
    if (b.dataset.use) {
      const i = +b.dataset.use;
      const t = st.results[i];
      st.busy = i;
      draw();
      try {
        const file = await downloadTrack(t, {
          onProgress: (f) => {
            const btn = d.querySelector(`[data-use="${i}"]`);
            if (btn) btn.textContent = `${Math.round(f * 100)}%`;
          },
        });
        audio.pause();
        d.close();
        await deps.useTrack(file, t);
      } catch (err) {
        deps.toast(err.message || 'Download failed', 4000);
        st.busy = null;
        draw();
      }
    }
  };
  d.onclose = () => {
    audio.pause();
    audio.removeAttribute('src');
    ctl?.abort();
    d.onclose = null;
  };
  audio.onended = () => ((st.playing = null), draw());
  draw();
  d.showModal();
  search(kind === 'sfx' ? 'whoosh' : 'pop');
}
