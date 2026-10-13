import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/state.js';
import { parseCommand, describe } from '../js/commands.js';
import { parseSrt, toSrt, captionsFromScript, fmt } from '../js/time.js';
import { rmsWindows, findSilences, keepRanges, findHighlights, WIN } from '../js/analysis.js';

const vid = (id, duration) => ({ id, type: 'video', duration });

function project() {
  let p = S.newProject('t');
  p = S.addClips(p, [vid('a', 10), vid('b', 6), { id: 'img', type: 'image' }]);
  return p;
}

test('durations and clipAt', () => {
  const p = project();
  assert.equal(S.totalDuration(p), 19);
  assert.deepEqual(S.clipStarts(p), [0, 10, 16]);
  const at = S.clipAt(p, 12);
  assert.equal(at.index, 1);
  assert.equal(at.local, 2);
  assert.equal(S.clipAt(p, 999).index, 2);
  assert.equal(S.clipAt(S.newProject(), 0), null);
});

test('speed changes timeline duration and source mapping', () => {
  let p = project();
  p = S.updateClip(p, p.clips[0].id, { speed: 2 });
  assert.equal(S.totalDuration(p), 14);
  assert.equal(S.clipAt(p, 4).local, 8);
  p = S.updateClip(p, p.clips[0].id, { speed: 99 });
  assert.equal(p.clips[0].speed, 4);
});

test('split, duplicate, move, delete keep immutability', () => {
  const p = project();
  const r = S.splitClip(p, 4);
  assert.ok(r.ok);
  assert.equal(p.clips.length, 3, 'original untouched');
  assert.equal(r.project.clips.length, 4);
  assert.equal(r.project.clips[0].out, 4);
  assert.equal(r.project.clips[1].in, 4);
  assert.equal(S.totalDuration(r.project), 19);
  assert.equal(S.splitClip(p, 0.01).ok, false, 'too close to edge');

  const d = S.duplicateClip(p, p.clips[1].id);
  assert.equal(d.project.clips.length, 4);
  assert.notEqual(d.newId, p.clips[1].id);

  const m = S.moveClip(p, p.clips[0].id, 1);
  assert.equal(m.clips[1].id, p.clips[0].id);
  assert.equal(S.moveClip(p, p.clips[0].id, -1), p);

  assert.equal(S.deleteClip(p, p.clips[0].id).clips.length, 2);
});

test('trim is clamped to the source', () => {
  let p = project();
  const id = p.clips[0].id;
  p = S.updateClip(p, id, { in: -5, out: 50 });
  assert.equal(p.clips[0].in, 0);
  assert.equal(p.clips[0].out, 10);
  p = S.updateClip(p, id, { in: 9.99 });
  assert.ok(p.clips[0].out - p.clips[0].in >= S.MIN_CLIP - 1e-9);
});

test('fade transitions dip to black at edges', () => {
  let p = project();
  p = S.applyAction(p, { type: 'transition', value: 'fade' });
  assert.equal(p.clips[0].transition, 'none');
  assert.equal(S.fadeAlpha(p, 10), 0);
  assert.ok(S.fadeAlpha(p, 9.8) < 1);
  assert.equal(S.fadeAlpha(p, 5), 1);
});

test('filterCss combines preset and adjustments', () => {
  assert.equal(S.filterCss({ preset: 'none' }), 'none');
  assert.match(S.filterCss({ preset: 'bw' }), /grayscale\(1\)/);
  assert.match(S.filterCss({ preset: 'none', brightness: 1.2 }), /brightness\(1\.200\)/);
});

test('history undo/redo', () => {
  const h = new S.History();
  h.push('a');
  h.push('b');
  assert.equal(h.undo('c'), 'b');
  assert.equal(h.redo('b'), 'c');
  h.undo('c');
  h.push('x');
  assert.equal(h.canRedo, false);
});

test('replaceWithRanges keeps first id', () => {
  const p = project();
  const id = p.clips[0].id;
  const q = S.replaceWithRanges(p, id, [{ start: 0, end: 2 }, { start: 4, end: 9 }]);
  assert.equal(q.clips.length, 4);
  assert.equal(q.clips[0].id, id);
  assert.equal(S.totalDuration(q), 7 + 6 + 3);
});

test('applyAction covers common commands', () => {
  let p = project();
  const sel = p.clips[1].id;
  p = S.applyAction(p, { type: 'aspect', value: '16:9' });
  assert.equal(p.aspect, '16:9');
  p = S.applyAction(p, { type: 'speed', value: 2, scope: 'selected' }, sel);
  assert.equal(p.clips[1].speed, 2);
  assert.equal(p.clips[0].speed, 1);
  p = S.applyAction(p, { type: 'mute', value: true, scope: 'all' });
  assert.ok(p.clips.every((c) => c.muted));
  p = S.applyAction(p, { type: 'trimStart', value: 3, scope: 'selected' }, p.clips[0].id);
  assert.equal(p.clips[0].in, 3);
  p = S.applyAction(p, { type: 'addText', value: 'Hi', start: 1 });
  assert.equal(p.texts[0].text, 'Hi');
  assert.equal(S.applyAction(p, { type: 'removePauses' }), null);
});

test('parseCommand english', () => {
  const r = parseCommand('make it 9:16, speed 1.5x, remove first 5 seconds and add text Hello and welcome');
  const types = r.actions.map((a) => a.type);
  assert.deepEqual(types, ['aspect', 'speed', 'trimStart', 'addText']);
  assert.equal(r.actions[1].value, 1.5);
  assert.equal(r.actions[2].value, 5);
  assert.equal(r.actions[3].value, 'Hello and welcome');
});

test('parseCommand misc', () => {
  const t = (s) => parseCommand(s).actions.map((a) => `${a.type}:${JSON.stringify(a.value ?? '')}`);
  assert.deepEqual(t('black and white filter for all'), ['filter:"bw"']);
  assert.deepEqual(t('remove pauses'), ['removePauses:""']);
  assert.deepEqual(t('find 15 second highlights'), ['autoShorts:15']);
  assert.deepEqual(t('youtube shorts'), ['aspect:"9:16"']);
  assert.deepEqual(t('mute'), ['mute:true']);
  assert.deepEqual(t('volume 50%'), ['volume:0.5']);
  assert.deepEqual(t('blur background'), ['background:{"mode":"blur"}']);
  assert.deepEqual(t('add fade transitions'), ['transition:"fade"']);
  assert.deepEqual(t('delete clip'), ['deleteClip:""']);
  assert.deepEqual(t('cut last 2 seconds'), ['trimEnd:2']);
  assert.deepEqual(t('max 5 slow motion'), ['speed:0.5']);
  assert.equal(parseCommand('blah blah').unknown.length, 1);
  assert.equal(parseCommand('mute all').actions[0].scope, 'all');
});

test('parseCommand bangla', () => {
  const t = (s) => parseCommand(s).actions.map((a) => a.type);
  assert.deepEqual(t('ভিডিও স্লো করো'), ['speed']);
  assert.deepEqual(t('নীরব অংশ বাদ দাও'), ['removePauses']);
  assert.deepEqual(t('শুরুর ৩ সেকেন্ড কেটে দাও'), ['trimStart']);
  assert.equal(parseCommand('শুরুর ৩ সেকেন্ড কেটে দাও').actions[0].value, 3);
  assert.deepEqual(t('সাদাকালো ফিল্টার'), ['filter']);
  assert.deepEqual(t('মিউট করো এবং ঝাপসা ব্যাকগ্রাউন্ড'), ['mute', 'background']);
  assert.deepEqual(t('লেখা যোগ করো স্বাগতম'), ['addText']);
  assert.match(describe({ type: 'speed', value: 2 }), /2x/i);
});

test('srt roundtrip and script captions', () => {
  const caps = [{ start: 1.5, end: 3.25, text: 'Hello' }, { start: 0, end: 1, text: 'First\nline' }];
  const srt = toSrt(caps);
  assert.match(srt, /00:00:01,500 --> 00:00:03,250/);
  const back = parseSrt(srt);
  assert.equal(back.length, 2);
  assert.equal(back[0].text, 'First\nline');
  assert.equal(back[1].end, 3.25);
  const sc = captionsFromScript('one two three. four five six seven eight nine ten', 10, 4);
  assert.equal(sc.length, 3);
  assert.equal(sc[0].start, 0);
  assert.ok(Math.abs(sc.at(-1).end - 10) < 0.01);
  assert.equal(fmt(65.25), '1:05.3');
});

function synth(pattern) {
  // pattern: array of [seconds, loud?]
  const sr = 8000;
  const out = [];
  for (const [sec, loud] of pattern) for (let i = 0; i < sec * sr; i++) out.push(loud ? Math.sin(i / 3) * 0.5 : (Math.random() - 0.5) * 0.002);
  return { samples: Float32Array.from(out), sr };
}

test('silence detection and keep ranges', () => {
  const { samples, sr } = synth([[2, 1], [1.5, 0], [2, 1], [0.3, 0], [1, 1]]);
  const rms = rmsWindows(samples, sr);
  const sil = findSilences(rms, WIN);
  assert.equal(sil.length, 1, 'short 0.3s gap is not a pause');
  assert.ok(Math.abs(sil[0].start - 2) < 0.06 && Math.abs(sil[0].end - 3.5) < 0.06);
  const keep = keepRanges(sil, 0, 6.8);
  assert.equal(keep.length, 2);
  assert.ok(keep[0].end > 2 && keep[0].end < 2.2);
  assert.ok(keep[1].start > 3.3 && keep[1].start < 3.5);
});

test('highlights pick loud, non-overlapping windows', () => {
  const { samples, sr } = synth([[10, 0], [5, 1], [10, 0], [5, 1], [10, 0]]);
  const rms = rmsWindows(samples, sr);
  const h = findHighlights(rms, WIN, { length: 5, count: 2 });
  assert.equal(h.length, 2);
  assert.ok(Math.abs(h[0].start - 10) <= 1);
  assert.ok(Math.abs(h[1].start - 25) <= 1);
  assert.ok(h[0].start < h[1].start);
});

test('transcript chunks map onto the edited timeline', async () => {
  const { toTimeline } = await import('../js/transcribe.js');
  const clips = [
    { mediaId: 'a', in: 2, out: 6, speed: 1 },
    { mediaId: 'a', in: 10, out: 14, speed: 2 },
  ];
  const tr = new Map([['a', [{ start: 0, end: 3, text: 'hello there' }, { start: 11, end: 13, text: 'second part' }]]]);
  const caps = toTimeline(clips, [0, 4], tr);
  assert.equal(caps.length, 2);
  assert.deepEqual([caps[0].start, caps[0].end], [0, 1]);
  assert.deepEqual([caps[1].start, caps[1].end], [4.5, 5.5]);
  assert.deepEqual(parseCommand('auto captions').actions.map((a) => a.type), ['autoCaptions']);
  assert.deepEqual(parseCommand('pop captions').actions.map((a) => a.type), ['captionStyle']);
});

test('cutRange removes a timeline span and shifts overlays', () => {
  let p = project(); // 10 + 6 + 3
  p = S.addText(p, 'late', 12, 14).project;
  p = S.setCaptions(p, [{ start: 4.5, end: 5.5, text: 'inside' }, { start: 7, end: 8, text: 'after' }]);
  const q = S.cutRange(p, 4, 6);
  assert.equal(S.totalDuration(q), 17);
  assert.deepEqual(q.clips.slice(0, 2).map((c) => [c.in, c.out]), [[0, 4], [6, 10]]);
  assert.equal(q.captions.length, 1);
  assert.deepEqual([q.captions[0].start, q.captions[0].end], [5, 6]);
  assert.deepEqual([q.texts[0].start, q.texts[0].end], [10, 12]);
  const across = S.cutRange(p, 9, 11); // spans two clips
  assert.equal(S.totalDuration(across), 17);
  assert.equal(across.clips[0].out, 9);
  assert.equal(across.clips[1].in, 1);
});

test('syncToBeats retimes clips onto beats', () => {
  let p = S.newProject();
  p = S.addClips(p, [{ id: 'i1', type: 'image' }, { id: 'i2', type: 'image' }, { id: 'v', type: 'video', duration: 10 }]);
  const beats = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  const r = S.syncToBeats(p, beats, 2);
  assert.equal(r.synced, 3);
  assert.deepEqual(r.project.clips.map((c) => +S.clipDuration(c).toFixed(2)), [1, 1, 1]);
});

test('detectBeats finds regular clicks', async () => {
  const { detectBeats } = await import('../js/analysis.js');
  const sr = 8000;
  const pcm = new Float32Array(sr * 4);
  for (let b = 0; b < 8; b++) for (let i = 0; i < 400; i++) pcm[Math.round((0.25 + b * 0.5) * sr) + i] = Math.sin(i / 2) * 0.8 * (1 - i / 400);
  const beats = detectBeats(pcm, sr);
  assert.equal(beats.length, 8);
  assert.ok(Math.abs(beats[0] - 0.25) < 0.03);
  assert.ok(Math.abs(beats[1] - beats[0] - 0.5) < 0.03);
});

test('timecode shows MM:SS|frames', async () => {
  const { timecode } = await import('../js/time.js');
  assert.equal(timecode(0), '00:00|00');
  assert.equal(timecode(23.5), '00:23|15');
  assert.equal(timecode(3725.1), '01:02:05|03');
});

test('scene cuts are picked where the picture jumps', async () => {
  const { pickCuts, frameDiff } = await import('../js/scenes.js');
  const diffs = Array.from({ length: 40 }, (_, i) => (i === 10 || i === 25 ? 0.6 : 0.02 + (i % 3) * 0.005));
  const times = diffs.map((_, i) => i * 0.25);
  assert.deepEqual(pickCuts(diffs, times), [2.5, 6.25]);
  assert.deepEqual(pickCuts(diffs.map(() => 0.03), times), []);
  const red = new Uint8ClampedArray(64).fill(0).map((_, i) => (i % 4 === 0 || i % 4 === 3 ? 255 : 0));
  const blue = red.map((_, i) => (i % 4 === 2 || i % 4 === 3 ? 255 : 0));
  assert.equal(frameDiff(red, red), 0);
  assert.ok(frameDiff(red, blue) > 0.3);
});

test('script → scenes with reading-time durations', async () => {
  const { scriptToScenes } = await import('../js/storyboard.js');
  const sc = scriptToScenes('Hello world. This is Clipora! আমি বাংলায় লিখি। ' + 'word '.repeat(20));
  assert.equal(sc.length, 5);
  assert.equal(sc[0].text, 'Hello world.');
  assert.equal(sc[0].duration, 2);
  assert.equal(sc[2].text, 'আমি বাংলায় লিখি।');
  assert.ok(sc.every((s) => s.duration >= 2 && s.duration <= 7));
});

test('scene split command (EN + BN), cinema is not a scene', () => {
  assert.equal(parseCommand('split into scenes').actions[0].type, 'sceneSplit');
  assert.equal(parseCommand('দৃশ্য ভাগ করো').actions[0].type, 'sceneSplit');
  assert.equal(parseCommand('split').actions[0].type, 'split');
  assert.ok(!parseCommand('সিনেমাটিক লুক').actions.some((a) => a.type === 'sceneSplit'));
});

test('CapCut-style commands: enhance, boost, noise, rotate', () => {
  const t = (s) => parseCommand(s).actions.map((a) => a.type);
  assert.deepEqual(t('make the video clear'), ['enhance']);
  assert.deepEqual(t('video is blurry, enhance it'), ['enhance']);
  assert.deepEqual(t('boost the sound'), ['boost']);
  assert.deepEqual(t('reduce noise'), ['denoise']);
  assert.deepEqual(t('volume 300%'), ['volume']);
  assert.equal(parseCommand('volume 300%').actions[0].value, 3);
  assert.deepEqual(t('clear filter'), ['filter']);
  assert.deepEqual(t('rotate'), ['rotate']);
  assert.deepEqual(t('blur background'), ['background']);
});

test('state: enhance gpu params, volume up to 500%, overlays shift on cut', () => {
  let p = project();
  const id = p.clips[0].id;
  assert.equal(S.gpuParams(p.clips[0]), null);
  p = S.updateClip(p, id, { enhance: true, volume: 9 });
  assert.equal(p.clips[0].volume, 5);
  const g = S.gpuParams(p.clips[0]);
  assert.ok(g.sharpen > 0 && g.shadows > 0);
  assert.ok(S.gpuParams({ filter: { preset: 'film' } }).grain > 0);
  const o = S.addOverlay(p, { ...S.overlayDefaults('sticker', { text: '🔥' }), start: 12, end: 14 });
  const e = S.addEffect(o.project, { type: 'shake', start: 1, end: 3 });
  const cut = S.cutRange(e.project, 4, 6);
  assert.deepEqual([cut.overlays[0].start, cut.overlays[0].end], [10, 12]);
  assert.deepEqual([cut.effects[0].start, cut.effects[0].end], [1, 3]);
  const m = S.migrate({ id: 'x', clips: [], texts: [], captions: [] });
  assert.deepEqual([m.overlays, m.effects, m.audios], [[], [], []]);
});

test('sfx library renders every sound', async () => {
  const { SFX } = await import('../js/sfx.js');
  assert.ok(Object.keys(SFX).length >= 12);
  const { encodeWav } = await import('../js/ai.js');
  const wav = new Uint8Array(encodeWav(new Float32Array([0, 0.5, -0.5]), 8000));
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(wav.length, 44 + 6);
});

test('fast export frame plan follows the edited timeline', async () => {
  const { framePlan } = await import('../js/fastexport.js');
  let p = project();
  p = { ...p, clips: p.clips.map((c, i) => (i === 1 ? { ...c, speed: 2 } : c)) };
  const { frames, total } = framePlan(p, 30);
  assert.equal(total, 16);
  assert.equal(frames.length, 480);
  assert.equal(frames[0].mediaId, 'a');
  assert.equal(frames[300].mediaId, 'b'); // t = 10s
  assert.equal(frames[330].local, 2); // 1s into a 2x clip = 2s of source
  assert.equal(frames.at(-1).mediaId, 'img');
  // Source times inside one clip only move forward (needed for sequential decoding).
  const b = frames.filter((f) => f.mediaId === 'b').map((f) => f.local);
  assert.ok(b.every((v, i) => i === 0 || v >= b[i - 1]));
});

test('pitch-preserving stretch has the right length and keeps the tone', async () => {
  const { stretch } = await import('../js/fastexport.js');
  const rate = 48000;
  const mk = (ch, len) => {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (c) => data[c] };
  };
  const ctx = { createBuffer: (ch, len) => mk(ch, len) };
  const src = mk(1, rate * 2);
  const d = src.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5;
  const out = stretch(ctx, src, 0, 2, 2);
  assert.equal(out.length, rate);
  // Count zero crossings in the middle: still ~440 Hz, not 880 Hz.
  const o = out.getChannelData(0);
  let z = 0;
  for (let i = rate * 0.25; i < rate * 0.75; i++) if (o[i - 1] < 0 !== o[i] < 0) z++;
  assert.ok(Math.abs(z - 440) < 30, `zero crossings ${z}`);
});

test('AI movie: scenes become timed clips, captions and voice tracks', async () => {
  const { assembleMovie } = await import('../js/movie.js');
  const scenes = [{ narration: 'Once upon a time there was a cat.' }, { narration: 'It wanted to cook.' }, { narration: '' }];
  const recs = [
    { visual: { id: 'i1', type: 'image' }, voice: { id: 'v1', duration: 3 } },
    { visual: { id: 'c2', type: 'video', duration: 2.5 }, voice: { id: 'v2', duration: 4.5 } },
    { visual: { id: 'i3', type: 'image' }, voice: null },
  ];
  const { clipPatches, captions, audios } = assembleMovie(scenes, recs);
  assert.equal(clipPatches.length, 3);
  assert.equal(clipPatches[0].out, 3.5); // voice + 0.5 s
  assert.equal(clipPatches[1].speed, 0.5); // 2.5 s AI clip slowed to fill 5 s of narration
  assert.equal(clipPatches[1].muted, true);
  assert.equal(clipPatches[2].out, 3); // no narration → minimum length
  assert.deepEqual(audios.map((a) => [a.mediaId, a.start]), [['v1', 0.15], ['v2', 3.65]]);
  assert.ok(captions.length >= 2 && captions.every((c) => c.end > c.start));
  assert.ok(captions.at(-1).end <= 3.5 + 5);
});

test('AI replies: JSON is extracted even inside code fences; offline plan splits sentences', async () => {
  const { parseJsonReply, offlineMovie } = await import('../js/cloud.js');
  assert.deepEqual(parseJsonReply('Sure!\n```json\n{"title":"X","scenes":[]}\n```'), { title: 'X', scenes: [] });
  assert.throws(() => parseJsonReply('no json'));
  const m = offlineMovie('A cat lived in Dhaka. It loved fish! আমি ভাত খাই।');
  assert.equal(m.scenes.length, 3);
  assert.equal(m.scenes[2].visual, 'আমি ভাত খাই।');
});
