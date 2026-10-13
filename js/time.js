// Time formatting and subtitle (SRT) helpers. Pure functions, no DOM.

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function fmt(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

export function srtTime(s) {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor(ms / 60000) % 60;
  const sec = Math.floor(ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(ms % 1000, 3)}`;
}

function parseSrtTime(str) {
  const m = str.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!m) return NaN;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0').slice(0, 3) / 1000;
}

export function parseSrt(text) {
  const out = [];
  const blocks = String(text).replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = parseSrtTime(a);
    const end = parseSrtTime(b);
    const body = lines.slice(i + 1).join('\n').trim();
    if (!isNaN(start) && !isNaN(end) && end > start && body) out.push({ start, end, text: body });
  }
  return out.sort((x, y) => x.start - y.start);
}

export function toSrt(captions) {
  return [...captions]
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

// Split a script into short caption chunks and spread them over `total` seconds,
// giving each chunk time proportional to its word count.
export function captionsFromScript(script, total, maxWords = 6) {
  const words = String(script).replace(/\s+/g, ' ').trim();
  if (!words || !(total > 0)) return [];
  const chunks = [];
  for (const sentence of words.split(/(?<=[.!?।])\s+/)) {
    const w = sentence.split(' ').filter(Boolean);
    for (let i = 0; i < w.length; i += maxWords) chunks.push(w.slice(i, i + maxWords));
  }
  const count = chunks.reduce((n, c) => n + c.length, 0);
  let t = 0;
  return chunks.map((c) => {
    const d = (c.length / count) * total;
    const cap = { start: +t.toFixed(3), end: +(t + d).toFixed(3), text: c.join(' ') };
    t += d;
    return cap;
  });
}

/** Editor timecode "MM:SS|FF" (frames at 30 fps), with hours when needed. */
export function timecode(t, fps = 30) {
  t = Math.max(0, t || 0);
  const f = Math.floor((t % 1) * fps + 1e-6);
  const s = Math.floor(t) % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const p = (n) => String(n).padStart(2, '0');
  return `${h ? `${p(h)}:` : ''}${p(m)}:${p(s)}|${p(f)}`;
}
