// Browser smoke test: starts a static server + headless Chrome, drives the app
// through import → edit → smart commands → remove pauses → export.
// Usage: node tests/smoke.mjs   (needs google-chrome; no npm packages)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const body = await readFile(join(root, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;

const profile = await mkdtemp(join(tmpdir(), 'clipora-chrome-'));
const chrome = spawn('google-chrome', [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--autoplay-policy=no-user-gesture-required', '--window-size=420,860', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve) => {
  chrome.stderr.on('data', (d) => {
    const m = String(d).match(/ws:\/\/[^\s]+/);
    if (m) resolve(m[0]);
  });
});

const browser = new WebSocket(wsUrl);
await new Promise((r) => (browser.onopen = r));
let id = 0;
const pending = new Map();
const events = [];
browser.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else events.push(msg);
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
    browser.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const page = (m, p) => send(m, p, sessionId);
await page('Runtime.enable');
await page('Page.enable');
await page('Emulation.setDeviceMetricsOverride', { width: 412, height: 860, deviceScaleFactor: 1, mobile: true });
await page('Page.navigate', { url: `http://localhost:${port}/index.html` });
await new Promise((r) => setTimeout(r, 1500));

async function evaluate(expr) {
  const r = await page('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(root, 'tests', `${name}.png`), Buffer.from(data, 'base64'));
}

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
};

try {
  await shot('shot-home');
  check('home renders', await evaluate(`!!document.querySelector('#home h1').textContent`));

  const info = await evaluate(`(async () => {
    const b = await (await fetch('tests/fixtures/sample.mp4')).blob();
    const f = new File([b], 'sample.mp4', { type: 'video/mp4' });
    const img = await (await fetch('icons/icon-512.png')).blob();
    await __clipora.newProjectFrom([f, new File([img], 'logo.png', { type: 'image/png' })]);
    const p = __clipora.project;
    return { clips: p.clips.length, dur: __clipora.engine.duration, types: p.clips.map(c => c.type) };
  })()`);
  check('import video + image', info.clips === 2 && info.types.join() === 'video,image', JSON.stringify(info));
  check('duration = 6s video + 3s image', Math.abs(info.dur - 9) < 0.2, info.dur.toFixed(2));
  await new Promise((r) => setTimeout(r, 500));
  await shot('shot-editor');

  const play = await evaluate(`(async () => {
    const e = __clipora.engine; e.play();
    await new Promise(r => setTimeout(r, 1500));
    const t = e.time; e.pause(); return t;
  })()`);
  check('playback advances', play > 0.8, `t=${play.toFixed(2)}`);

  const smart = await evaluate(`(async () => {
    await __clipora.runActions([{ type: 'addText', value: 'Hello Clipora' }, { type: 'filter', value: 'vivid', scope: 'all' }, { type: 'transition', value: 'fade' }]);
    const p = __clipora.project;
    return { texts: p.texts.length, filter: p.clips[0].filter.preset, trans: p.clips[1].transition };
  })()`);
  check('smart actions apply', smart.texts === 1 && smart.filter === 'vivid' && smart.trans === 'fade', JSON.stringify(smart));

  const pauses = await evaluate(`(async () => {
    __clipora.engine.seek(0.5);
    await __clipora.runActions([{ type: 'removePauses', scope: 'selected' }]);
    const p = __clipora.project;
    return { clips: p.clips.length, dur: __clipora.engine.duration, ranges: p.clips.filter(c => c.type === 'video').map(c => [c.in.toFixed(2), c.out.toFixed(2)]) };
  })()`);
  check('remove pauses cuts the 1.5s silent gap', pauses.clips === 3 && pauses.dur < 8, JSON.stringify(pauses));

  const undo = await evaluate(`(async () => {
    document.querySelector('#undoBtn').click();
    return __clipora.project.clips.length;
  })()`);
  check('undo restores', undo === 2, `clips=${undo}`);

  const beat = await evaluate(`(async () => {
    const C = __clipora;
    const b = await (await fetch('tests/fixtures/beats.m4a')).blob();
    const [m] = await C.importFiles([new File([b], 'beats.m4a', { type: 'audio/mp4' })], 'audio');
    C.commit(C.S.setProject(C.project, { music: { mediaId: m.id, volume: 0.8, offset: 0, loop: true } }));
    await C.runActions([{ type: 'beatSync', value: 2 }]);
    return C.project.clips.map(c => +C.S.clipDuration(c).toFixed(2));
  })()`);
  check('beat sync cuts clips on 0.5s beats (every 2 = 1s)', beat.every((d) => Math.abs(d - 1) < 0.08), JSON.stringify(beat));

  const cut = await evaluate(`(async () => {
    const C = __clipora;
    C.commit(C.S.setCaptions(C.project, [{ start: 0.2, end: 0.7, text: 'cut me' }]));
    document.querySelector('[data-tab=captions]').click();
    const before = C.engine.duration;
    document.querySelector('[data-act=cutCap]').click();
    return { before, after: C.engine.duration, caps: C.project.captions.length };
  })()`);
  check('text-based cut removes caption span', Math.abs(cut.before - cut.after - 0.5) < 0.01 && cut.caps === 0, JSON.stringify(cut));
  await evaluate(`(async () => { document.querySelector('#undoBtn').click(); document.querySelector('#undoBtn').click(); document.querySelector('#undoBtn').click(); document.querySelector('#undoBtn').click(); return __clipora.project.clips.length; })()`);

  const scenes = await evaluate(`(async () => {
    const C = __clipora;
    const b = await (await fetch('tests/fixtures/scenes.mp4')).blob();
    const [m] = await C.importFiles([new File([b], 'scenes.mp4', { type: 'video/mp4' })]);
    const before = C.project.clips.length;
    C.commit(C.S.addClips(C.project, [m]));
    await C.runActions([{ type: 'sceneSplit', scope: 'all' }]);
    const parts = C.project.clips.filter((c) => c.mediaId === m.id).map((c) => [+c.in.toFixed(2), +c.out.toFixed(2)]);
    document.querySelector('#undoBtn').click(); document.querySelector('#undoBtn').click();
    return { parts, restored: C.project.clips.length === before };
  })()`);
  check('scene detect splits red|pattern|blue into 3 shots', scenes.parts.length === 3 && Math.abs(scenes.parts[1][0] - 2) < 0.3 && Math.abs(scenes.parts[2][0] - 4) < 0.3 && scenes.restored, JSON.stringify(scenes));

  const story = await evaluate(`(async () => {
    const C = __clipora;
    document.querySelector('[data-tab=smart]').click();
    document.querySelector('#storyBox').value = 'Welcome to Clipora. Edit videos in seconds! আমাদের অ্যাপ ব্যবহার করুন।';
    const before = C.project.clips.length;
    await window.__clipora.ACT.storyboard();
    const added = C.project.clips.slice(before);
    const out = { added: added.length, types: added.map((c) => c.type), durs: added.map((c) => C.S.clipDuration(c)), fades: added.slice(1).every((c) => c.transition === 'fade') };
    document.querySelector('#undoBtn').click();
    return out;
  })()`);
  check('script → video makes one scene per sentence', story.added === 3 && story.types.every((x) => x === 'image') && story.durs.every((d) => d >= 2) && story.fades, JSON.stringify(story));

  const chat = await evaluate(`(async () => {
    document.querySelector('[data-tab=smart]').click();
    document.querySelector('#smartBox').value = 'add text Hi chat';
    document.querySelector('[data-act=smartGo]').click();
    const pending = document.querySelectorAll('.chat .msg').length;
    document.querySelector('[data-act=smartApply]').click();
    await new Promise((r) => setTimeout(r, 300));
    const ok = /Hi chat/.test(JSON.stringify(__clipora.project.texts));
    document.querySelector('#undoBtn').click();
    return { pending, ok, done: !!document.querySelector('.chat .ok') };
  })()`);
  await shot('shot-chat');
  check('AI chat: message → plan → apply', chat.pending === 2 && chat.ok && chat.done, JSON.stringify(chat));

  const ui = await evaluate(`(async () => {
    await new Promise((r) => setTimeout(r, 800));
    __clipora.engine.seek(1.5);
    const tc = document.querySelector('#timeCur').textContent;
    document.querySelector('#nextBtn').click();
    const next = __clipora.engine.time;
    document.querySelector('[data-tab=edit]').click();
    return { tc, next, wave: !!document.querySelector('.lane.wave span[style*=background-image]'), lib: document.querySelectorAll('.lib-item').length, bg: getComputedStyle(document.body).backgroundColor };
  })()`);
  check('timecode, next-clip, waveform, library, cream theme', ui.tc === '00:01|15' && Math.abs(ui.next - 6) < 0.05 && ui.wave && ui.lib >= 2 && ui.bg === 'rgb(251, 245, 233)', JSON.stringify(ui));
  await shot('shot-smart');

  if (process.env.AI) {
    const ai = await evaluate(`(async () => {
      const C = __clipora;
      const b = await (await fetch('tests/fixtures/speech.mp4')).blob();
      const [m] = await C.importFiles([new File([b], 'speech.mp4', { type: 'video/mp4' })]);
      C.commit(C.S.addClips(C.project, [m]));
      const t0 = performance.now();
      await C.runActions([{ type: 'autoCaptions' }]);
      return { secs: ((performance.now() - t0) / 1000).toFixed(1), caps: C.project.captions.map(c => [c.start.toFixed(1), c.text]) };
    })()`);
    check('AI captions (Whisper) transcribe speech', ai.caps.length > 0 && /country/i.test(ai.caps.map((c) => c[1]).join(' ')), JSON.stringify(ai).slice(0, 400));
    await evaluate(`(async () => { document.querySelector('#undoBtn').click(); document.querySelector('#undoBtn').click(); })()`);
  }

  const english = await evaluate(`(async () => {
    const txt = document.body.innerText;
    return { langBtn: !!document.querySelector('#langBtn'), bangla: /[ঀ-৿]/.test(txt), tabs: [...document.querySelectorAll('#tabs .tab span')].map((s) => s.textContent) };
  })()`);
  check('English-only UI, no language button', !english.langBtn && !english.bangla && english.tabs.length === 9, JSON.stringify(english));

  const pro = await evaluate(`(async () => {
    const C = __clipora, E = C.engine;
    const out = { gpu: E.gfx.ok };
    document.querySelector('[data-clip]').click();
    const px = () => E.ctx.getImageData(0, 0, E.canvas.width, E.canvas.height).data.slice();
    E.seek(1); await E._waitFrame(); await new Promise((r) => setTimeout(r, 200)); E.draw();
    const before = px();
    C.ACT.enhance(); E.draw();
    out.enhanced = C.project.clips[0].enhance === true;
    { const after = px(); let d = 0; for (let i = 0; i < after.length; i++) d += Math.abs(after[i] - before[i]); out.pixelDiff = +(d / after.length).toFixed(2); }
    await C.ACT.boostClip();
    out.volume = C.project.clips[0].volume;
    C.ACT.rotate(); C.ACT.mirror(); C.ACT.animIn({ dataset: { v: 'zoomIn' } }); E.draw();
    out.rot = C.project.clips[0].rotate; out.flip = C.project.clips[0].flipH;
    C.ACT.rotate(); C.ACT.rotate(); C.ACT.rotate(); C.ACT.mirror();
    C.commit(C.S.updateClip(C.project, C.project.clips[1].id, { transition: 'dissolve' }));
    E.seek(5.7); E.play(); await new Promise((r) => setTimeout(r, 700)); E.pause();
    out.snap = E._snapOf === C.project.clips[0].id;
    return out;
  })()`);
  check('Enhance HD (GPU) brightens + sharpens, auto volume boost, rotate/mirror, dissolve transition',
    pro.gpu && pro.enhanced && pro.pixelDiff > 0.3 && pro.volume !== 1 && pro.volume <= 5 && pro.rot === 90 && pro.flip && pro.snap, JSON.stringify(pro));

  const ov = await evaluate(`(async () => {
    const C = __clipora, E = C.engine;
    E.seek(1);
    const img = await (await fetch('icons/icon-512.png')).blob();
    await C.addOverlayFiles([new File([img], 'pic.png', { type: 'image/png' })]);
    const o = C.project.overlays[0];
    E.draw();
    const hit = E.hitAt(o.x * E.canvas.width, o.y * E.canvas.height);
    C.ACT.ovChroma(); E.draw();
    C.ACT.sticker({ dataset: { v: '🔥' } });
    C.ACT.addBlur();
    C.ACT.addFx({ dataset: { v: 'glitch' } });
    E.seek(1.4); E.draw();
    await C.ACT.sfx({ dataset: { v: 'whoosh' } });
    const p = C.project;
    return { overlays: p.overlays.map((x) => x.kind), hit, chroma: p.overlays[0].chroma, fx: p.effects.length, audios: p.audios.length, sfxLen: +(p.audios[0].out - p.audios[0].in).toFixed(2), lanes: document.querySelectorAll('.bar.ov, .bar.fx, .bar.aud').length };
  })()`);
  check('picture overlay + drag hit + chroma, sticker, blur area, effect, sound effect',
    ov.overlays.join() === 'media,sticker,blur' && ov.hit?.kind === 'overlay' && ov.chroma > 0 && ov.fx === 1 && ov.audios === 1 && Math.abs(ov.sfxLen - 0.7) < 0.05 && ov.lanes === 5, JSON.stringify(ov));

  const freeze = await evaluate(`(async () => {
    const C = __clipora, E = C.engine;
    E.seek(1.5); await new Promise((r) => setTimeout(r, 300));
    document.querySelector('[data-clip]').click();
    const before = C.project.clips.length;
    await C.ACT.freeze();
    const p = C.project;
    const out = { added: p.clips.length - before, mid: p.clips[1].type, dur: +C.S.clipDuration(p.clips[1]).toFixed(2), total: +E.duration.toFixed(2) };
    document.querySelector('#undoBtn').click();
    document.querySelector('[data-clip]').click();
    C.ACT.extract();
    out.extracted = C.project.audios.length === 2 && C.project.clips[0].muted;
    document.querySelector('#undoBtn').click();
    out.after = +E.duration.toFixed(2);
    return out;
  })()`);
  check('freeze frame inserts 2s still, extract audio to track', freeze.added === 2 && freeze.mid === 'image' && freeze.dur === 2 && freeze.total === 11 && freeze.extracted && freeze.after === 9, JSON.stringify(freeze));

  // Click through every tab to be sure each panel renders without errors.
  const tabs = await evaluate(`(async () => {
    const out = [];
    for (const b of document.querySelectorAll('#tabs .tab')) { b.click(); await new Promise(r => setTimeout(r, 80)); out.push(document.querySelector('#panel').children.length > 0); }
    document.querySelector('[data-tab=text]').click();
    return out;
  })()`);
  check('all tool panels render', tabs.every(Boolean), tabs.join());
  await shot('shot-text');

  const exp = await evaluate(`(async () => {
    window.__t0 = performance.now();
    __clipora.openExport();
    document.querySelector('[data-q="720"]').click();
    document.querySelector('[data-go]').click();
    const t0 = performance.now();
    while (!document.querySelector('#exportDlg video') && !/failed/i.test(document.querySelector('#exportDlg').textContent) && performance.now() - t0 < 180000) await new Promise(r => setTimeout(r, 250));
    const v = document.querySelector('#exportDlg video');
    if (!v) return { ok: false, text: document.querySelector('#exportDlg').textContent };
    await new Promise(r => v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true }));
    let d = v.duration;
    if (!isFinite(d)) { v.currentTime = 1e7; await new Promise(r => v.addEventListener('seeked', r, { once: true })); d = v.duration; }
    return { ok: true, wall: ((performance.now() - __t0) / 1000).toFixed(2), w: v.videoWidth, h: v.videoHeight, d, text: document.querySelector('#exportDlg .hint').textContent };
  })()`);
  await shot('shot-pro');
  check('export produces a 720x1280 video', exp.ok && exp.w === 720 && exp.h === 1280, JSON.stringify(exp));
  check('exported length ≈ timeline', exp.ok && Math.abs(exp.d - 9) < 0.6, exp.d?.toFixed?.(2));
  await shot('shot-export');
  const b64 = await evaluate(`(async () => {
    const a = document.querySelector('#exportDlg a[download]');
    const buf = await (await fetch(a.href)).arrayBuffer();
    let s = ''; const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  await writeFile(join(root, 'tests', 'export-output.mp4'), Buffer.from(b64, 'base64'));

  const persisted = await evaluate(`(async () => {
    document.querySelector('#exportDlg').close();
    history.back();
    await new Promise(r => setTimeout(r, 800));
    return document.querySelectorAll('#projects .project').length;
  })()`);
  check('project saved and listed on home', persisted === 1, `projects=${persisted}`);

  const errors = events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails.exception?.description);
  check('no uncaught page errors', errors.length === 0, errors.join(' | ').slice(0, 300));
} catch (e) {
  check('smoke run', false, e.message);
} finally {
  chrome.kill();
  server.close();
  browser.close();
  // /tmp is often RAM-backed (tmpfs): never leave the Chrome profile behind.
  await new Promise((r) => setTimeout(r, 300));
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
