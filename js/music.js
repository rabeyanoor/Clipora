// Music library: search free, legally reusable music from all over the world.
//   • Openverse (by WordPress): Jamendo's ~650k songs, Wikimedia and Freesound,
//     all Creative Commons / public domain. No API key; ~200 searches/day per user.
//   • Internet Archive: netlabels and music collections with an explicit license.
// Both answer straight to the browser (CORS), so no server of our own is needed.

const OPENVERSE = 'https://api.openverse.org/v1/audio/';
const ARCHIVE = 'https://archive.org';
const MAX_MB = 40; // longer files (DJ mixes, albums in one file) are skipped
export const PAGE = 20;

export const GENRES = [
  ['🔥 Trending', 'pop'], ['🇧🇩 Bangla', 'bangla'], ['🎬 Bollywood', 'bollywood'], ['☕ Lo-fi', 'lofi'], ['🎤 Hip hop', 'hip hop'],
  ['⚡ EDM', 'electronic dance'], ['🎸 Rock', 'rock'], ['🎷 Jazz', 'jazz'], ['🎻 Classical', 'classical'], ['🎹 Piano', 'piano'],
  ['🕌 Arabic', 'arabic'], ['🇰🇷 K-pop', 'korean pop'], ['🌍 Afrobeat', 'afrobeat'], ['💃 Latin', 'latin'], ['🪕 Folk', 'folk'],
  ['🎞 Cinematic', 'cinematic'], ['😊 Happy', 'happy upbeat'], ['😢 Sad', 'sad emotional'], ['❤️ Romantic', 'romantic love'], ['🌙 Chill', 'chill ambient'],
  ['🏋️ Workout', 'energetic workout'], ['🎉 Party', 'party dance'], ['🙏 Devotional', 'devotional'], ['👶 Kids', 'children'],
];

const LICENSES = { by: 'CC BY', 'by-sa': 'CC BY-SA', 'by-nd': 'CC BY-ND', 'by-nc': 'CC BY-NC', 'by-nc-sa': 'CC BY-NC-SA', 'by-nc-nd': 'CC BY-NC-ND', cc0: 'CC0', pdm: 'Public domain', publicdomain: 'Public domain', zero: 'CC0', mark: 'Public domain' };

/** Human label for an Openverse license code or a creativecommons.org URL. */
export function licenseLabel(code, version) {
  let c = String(code || '').toLowerCase();
  const m = c.match(/creativecommons\.org\/(?:licenses|publicdomain)\/([a-z-]+)\/?([\d.]*)/);
  if (m) [c, version] = [m[1], m[2] || version];
  const name = LICENSES[c] || (c ? c.toUpperCase() : 'See source');
  return /^CC (BY|BY-)/.test(name) && version ? `${name} ${version}` : name;
}
export const isNonCommercial = (label) => /NC/.test(label);
export const credit = (t) => `"${t.title}" by ${t.artist || 'Unknown'} (${t.license}) via ${t.sourceName}`;

/** Jamendo's default link has no CORS; the mp3l host serves the same file with CORS. */
export function fixUrl(url) {
  try {
    const u = new URL(url);
    if (/jamendo\.com$/.test(u.hostname) && u.searchParams.get('trackid')) return `https://mp3l.jamendo.com/?trackid=${u.searchParams.get('trackid')}&format=mp31`;
  } catch {}
  return url;
}

async function getJson(url, signal) {
  const r = await fetch(url, { signal });
  if (r.status === 429) throw new Error('Too many searches for now. Wait a minute and try again.');
  if (!r.ok) throw new Error(`Music search: HTTP ${r.status}`);
  return r.json();
}

export function mapOpenverse(r) {
  const license = licenseLabel(r.license, r.license_version);
  return {
    id: `ov:${r.id}`,
    title: r.title || 'Untitled',
    artist: r.creator || '',
    duration: r.duration ? r.duration / 1000 : null,
    license,
    licenseUrl: r.license_url,
    page: r.foreign_landing_url,
    sourceName: { jamendo: 'Jamendo', wikimedia_audio: 'Wikimedia', freesound: 'Freesound', ccmixter: 'ccMixter' }[r.source] || r.source,
    url: fixUrl(r.url),
    tags: (r.tags || []).slice(0, 4).map((x) => x.name),
  };
}

async function searchOpenverse(q, page, kind, signal) {
  const p = new URLSearchParams({ q, page, page_size: PAGE, category: kind === 'sfx' ? 'sound_effect' : 'music' });
  if (kind !== 'sfx') p.set('length', 'short,medium,long'); // not the hour-long recordings
  const d = await getJson(`${OPENVERSE}?${p}`, signal);
  return (d.results || []).map(mapOpenverse).filter((t) => t.url);
}

async function searchArchive(q, page, signal) {
  // Music only (no talks, sermons, radio or audiobooks), and only items that state a license.
  const query = `(${q}) AND mediatype:audio AND licenseurl:* AND (subject:(music OR song OR songs OR album OR band OR folk OR "lo-fi" OR lofi OR hiphop OR "hip hop" OR rock OR pop OR jazz OR electronic) OR collection:(netlabels OR audio_music OR 78rpm OR georgeblood)) AND NOT subject:(speech OR sermon OR lecture OR quran OR islam OR waz OR tafsir OR podcast OR audiobook OR talk OR news OR radio)`;
  const p = new URLSearchParams({ q: query, rows: PAGE, page, output: 'json', 'sort[]': 'downloads desc' });
  for (const f of ['identifier', 'title', 'creator', 'licenseurl']) p.append('fl[]', f);
  const d = await getJson(`${ARCHIVE}/advancedsearch.php?${p}`, signal);
  return (d.response?.docs || []).map((x) => ({
    id: `ia:${x.identifier}`,
    title: String(x.title || x.identifier).slice(0, 120),
    artist: [].concat(x.creator || '')[0],
    duration: null,
    license: licenseLabel(x.licenseurl),
    licenseUrl: x.licenseurl,
    page: `${ARCHIVE}/details/${x.identifier}`,
    sourceName: 'Internet Archive',
    url: null, // resolved on demand (first MP3 of the item)
    ia: x.identifier,
    tags: [],
  }));
}

/** Search both catalogs; results are interleaved so both sources show up. */
export async function searchMusic(q, { page = 1, kind = 'music', signal } = {}) {
  q = q.trim() || 'music';
  const jobs = [searchOpenverse(q, page, kind, signal)];
  if (kind !== 'sfx') jobs.push(searchArchive(q, page, signal));
  const got = await Promise.allSettled(jobs);
  if (got.every((g) => g.status === 'rejected')) throw got[0].reason;
  const lists = got.map((g) => (g.status === 'fulfilled' ? g.value : []));
  const out = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

/** Fills in `url` (and duration) for Internet Archive items. */
export async function resolveTrack(t, signal) {
  if (t.url) return t;
  const d = await getJson(`${ARCHIVE}/metadata/${encodeURIComponent(t.ia)}`, signal);
  const secs = (v) => (String(v || '').includes(':') ? String(v).split(':').reduce((a, b) => a * 60 + +b, 0) : +v || null);
  const mp3 = (d.files || []).filter((f) => /\.mp3$/i.test(f.name) && (!f.size || +f.size < MAX_MB * 1048576));
  if (!mp3.length) throw new Error('This item has no playable MP3. Try another song.');
  const f = mp3.find((x) => x.source === 'original') || mp3[0];
  t.url = `${ARCHIVE}/download/${encodeURIComponent(t.ia)}/${f.name.split('/').map(encodeURIComponent).join('/')}`;
  t.duration = secs(f.length);
  if (f.title) t.title = `${f.title}${t.title && t.title !== f.title ? ` · ${t.title}` : ''}`.slice(0, 120);
  return t;
}

/** Downloads the song as a File ready to import. */
export async function downloadTrack(t, { signal, onProgress } = {}) {
  await resolveTrack(t, signal);
  const r = await fetch(t.url, { signal });
  if (!r.ok) throw new Error(`Download failed (HTTP ${r.status})`);
  const total = +r.headers.get('content-length') || 0;
  if (total > MAX_MB * 1048576) throw new Error('This file is too long. Pick a single song.');
  const chunks = [];
  let got = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (got > MAX_MB * 1048576) throw new Error('This file is too long. Pick a single song.');
    if (total) onProgress?.(got / total);
  }
  const type = r.headers.get('content-type')?.startsWith('audio/') ? r.headers.get('content-type') : 'audio/mpeg';
  const safe = `${t.title}`.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
  return new File(chunks, `${safe}.mp3`, { type });
}
