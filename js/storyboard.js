// Script → Video: turns a written script into a storyboard of animated
// title-card scenes (one per sentence), timed by reading speed. Works fully
// offline; the user's own photos can be used as scene backgrounds.

const PALETTES = [
  ['#b553de', '#f2527a'],
  ['#ff9a5a', '#f2527a'],
  ['#2bb3a3', '#3d7bd9'],
  ['#f6c453', '#ef7b45'],
  ['#5b4bdb', '#b553de'],
  ['#e8577e', '#ffb36b'],
];

/** Splits a script into scenes with durations (≈2.6 words per second, 2–7 s). */
export function scriptToScenes(script, { wps = 2.6 } = {}) {
  const parts = String(script || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?।؟])\s+|\n+/)
    .flatMap((s) => {
      // Very long sentences become several scenes of ≤14 words.
      const w = s.trim().split(' ').filter(Boolean);
      const out = [];
      for (let i = 0; i < w.length; i += 14) out.push(w.slice(i, i + 14).join(' '));
      return out;
    })
    .filter(Boolean);
  return parts.map((text) => {
    const words = text.split(' ').length;
    return { text, duration: Math.min(7, Math.max(2, +(words / wps + 0.6).toFixed(1))) };
  });
}

function wrap(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const tryLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(tryLine).width > maxW && line) {
      lines.push(line);
      line = word;
    } else line = tryLine;
  }
  if (line) lines.push(line);
  return lines;
}

/** Renders one scene card to a PNG File. `photo` (optional) is an ImageBitmap/HTMLImageElement. */
export async function renderScene(text, index, { width = 1080, height = 1920, photo = null, total = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  const [a, b] = PALETTES[index % PALETTES.length];
  if (photo) {
    const s = Math.max(width / photo.width, height / photo.height);
    ctx.drawImage(photo, (width - photo.width * s) / 2, (height - photo.height * s) / 2, photo.width * s, photo.height * s);
    const shade = ctx.createLinearGradient(0, 0, 0, height);
    shade.addColorStop(0, 'rgba(20,12,6,.15)');
    shade.addColorStop(1, 'rgba(20,12,6,.7)');
    ctx.fillStyle = shade;
  } else {
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, width, height);
  if (!photo) {
    // Soft decorative circles.
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(width * [0.15, 0.9, 0.6][k], height * [0.12, 0.35, 0.92][k], width * [0.35, 0.25, 0.45][k], 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const short = Math.min(width, height);
  let size = Math.round(short * (text.length < 40 ? 0.095 : text.length < 90 ? 0.075 : 0.06));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  let lines;
  do {
    ctx.font = `800 ${size}px system-ui, "Noto Sans Bengali", sans-serif`;
    lines = wrap(ctx, text, width * 0.8);
    size -= 4;
  } while (lines.length * size * 1.3 > height * 0.6 && size > 20);
  const lh = size * 1.3;
  const y0 = (photo ? height * 0.7 : height / 2) - ((lines.length - 1) * lh) / 2;
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = size * 0.4;
  lines.forEach((l, i) => ctx.fillText(l, width / 2, y0 + i * lh));
  ctx.shadowBlur = 0;
  // Scene counter, like a storyboard.
  ctx.font = `700 ${Math.round(short * 0.03)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.fillText(`${index + 1} / ${total}`, width / 2, height - short * 0.08);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new File([blob], `scene-${index + 1}.png`, { type: 'image/png' });
}
