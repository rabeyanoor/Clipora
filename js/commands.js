// Smart edit commands: turn a sentence (English, Bangla or Banglish) into a
// list of edit actions the user can preview before applying. Pure, no DOM.

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const toAscii = (s) => s.replace(/[০-৯]/g, (d) => BN_DIGITS.indexOf(d));

const num = (s) => {
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
};

const FILTER_WORDS = [
  [/\b(bw|black ?& ?white|monochrome|grayscale|greyscale)\b|সাদাকালো|সাদা-কালো/, 'bw'],
  [/\bvintage\b|\bretro\b|ভিনটেজ/, 'vintage'],
  [/\bwarm\b|উষ্ণ/, 'warm'],
  [/\bcool\b|\bcold\b|ঠান্ডা/, 'cool'],
  [/\bvivid\b|\bcolorful\b|\bbright colou?rs?\b|রঙিন/, 'vivid'],
  [/\bmatte\b/, 'matte'],
  [/\bdrama(tic)?\b|\bcinematic\b|সিনেমাটিক/, 'drama'],
  [/\b(no|remove|clear) filter\b|ফিল্টার সরাও|ফিল্টার বাদ/, 'none'],
];

function detect(piece) {
  const s = piece;
  const acts = [];
  const all = /\b(all|every|whole|entire)\b|সব|পুরো/.test(s);
  const scope = all ? 'all' : 'selected';

  // Trimming has to be checked before generic "remove"/"delete" wording.
  const trimVerb = /\b(remove|cut|trim|delete|skip|drop)\b|বাদ|কাট|কেটে/.test(s);
  const first = /\b(first|start|beginning|intro)\b|প্রথম|শুরু/.test(s);
  const last = /\b(last|end|ending|outro)\b|শেষ/.test(s);
  const n = num(s);
  let trimmed = false;
  if (trimVerb && n !== null && (first || last) && !/pause|silence|নীরব/.test(s)) {
    acts.push({ type: first ? 'trimStart' : 'trimEnd', value: n, scope });
    trimmed = true;
  }

  if (/\b(pause|pauses|silence|silences|silent|dead ?air|gaps?)\b|নীরব|বিরতি|পজ|চুপ/.test(s))
    acts.push({ type: 'removePauses', scope });
  else if (/\b(highlights?|auto ?shorts?|best (part|moment)s?|viral|clips? from)\b|হাইলাইট|সেরা অংশ/.test(s))
    acts.push({ type: 'autoShorts', value: n && n >= 5 && n <= 90 ? n : 30 });

  if (/\b(beat ?sync|sync to (the )?(music|beats?)|on (the )?beats?|beats?)\b|বিট/.test(s))
    acts.push({ type: 'beatSync', value: n && [1, 2, 4].includes(n) ? n : 1 });

  if (/\bundo\b|আনডু|আগের মত/.test(s)) acts.push({ type: 'undo' });
  if (/\bredo\b|রিডু/.test(s)) acts.push({ type: 'redo' });

  if (!trimmed && /\b(delete|remove)\b.*\bclip\b|ক্লিপ (মুছ|ডিলিট|বাদ)/.test(s)) acts.push({ type: 'deleteClip' });
  if (/\b(duplicate|copy clip)\b|ডুপ্লিকেট|কপি/.test(s)) acts.push({ type: 'duplicateClip' });
  if (/\b(scenes?|shots?|scene ?(cut|detect|split)s?)\b|দৃশ্য|সিন ভাগ|শট ভাগ/.test(s)) acts.push({ type: 'sceneSplit' });
  else if (/\bsplit\b|ভাগ কর|দুই ভাগ/.test(s)) acts.push({ type: 'split' });

  // Aspect ratio (shorts/reels first so "youtube shorts" is vertical).
  if (/9\s*[:x/]\s*16|\b(portrait|vertical|reels?|shorts|tiktok|story|stories)\b|পোর্ট্রেট|ভার্টিক্যাল|রিলস/.test(s))
    acts.push({ type: 'aspect', value: '9:16' });
  else if (/16\s*[:x/]\s*9|\b(landscape|horizontal|youtube|widescreen|wide)\b|ল্যান্ডস্কেপ|ইউটিউব/.test(s))
    acts.push({ type: 'aspect', value: '16:9' });
  else if (/4\s*[:x/]\s*5|\b(instagram post|feed post)\b/.test(s)) acts.push({ type: 'aspect', value: '4:5' });
  else if (/1\s*[:x/]\s*1|\bsquare\b|স্কয়ার|বর্গ/.test(s)) acts.push({ type: 'aspect', value: '1:1' });

  // Speed.
  const xMatch = s.match(/(\d+(?:\.\d+)?)\s*x\b/);
  const speedWord = /\bspeed\b|স্পিড|গতি/.test(s);
  if (xMatch) acts.push({ type: 'speed', value: parseFloat(xMatch[1]), scope });
  else if (speedWord && n !== null && !trimmed) acts.push({ type: 'speed', value: n, scope });
  else if (/\bslow(-| )?(mo|motion|down)?\b|\bslower\b|ধীর|স্লো/.test(s)) acts.push({ type: 'speed', value: 0.5, scope });
  else if (/\b(fast|faster|speed up|quick)\b|দ্রুত|ফাস্ট|তাড়াতাড়ি/.test(s)) acts.push({ type: 'speed', value: 2, scope });
  else if (/\bnormal speed\b|স্বাভাবিক/.test(s)) acts.push({ type: 'speed', value: 1, scope });

  // Audio.
  if (/\bunmute\b|আনমিউট|সাউন্ড চালু/.test(s)) acts.push({ type: 'mute', value: false, scope });
  else if (/\bmute\b|\bno (sound|audio)\b|মিউট|সাউন্ড বন্ধ|শব্দ বন্ধ/.test(s)) acts.push({ type: 'mute', value: true, scope });
  const vol = s.match(/(?:volume|ভলিউম|সাউন্ড)\D*(\d+)/);
  if (vol) acts.push({ type: 'volume', value: Math.min(500, +vol[1]) / 100, scope });
  else if (/\b(boost|louder|loud|increase (the )?(volume|sound|audio)|sound up|volume up|normali[sz]e)\b|সাউন্ড বাড়াও|আওয়াজ বাড়াও|জোরে/.test(s)) acts.push({ type: 'boost', scope });

  if (/\b(enhance|hd|sharpen|sharp|blurry|unclear|clear(er)?|quality|upscale)\b|পরিষ্কার|ক্লিয়ার|ঝাপসা ভিডিও/.test(s) && !/\bclear (filters?|captions?|subtitles?|all|text)\b/.test(s))
    acts.push({ type: 'enhance', scope });
  if (/\b(noise|denoise|background noise|hiss)\b|নয়েজ|শব্দ কমাও/.test(s)) acts.push({ type: 'denoise', scope });
  if (/\brotate\b|ঘোরাও/.test(s)) acts.push({ type: 'rotate', value: /\b180\b/.test(s) ? 180 : 90, scope });
  if (/\b(mirror|flip)\b|উল্টাও/.test(s)) acts.push({ type: 'mirror', scope });
  if (/\bprogress ?bar\b/.test(s)) acts.push({ type: 'progressBar', value: !/\b(remove|hide|no)\b/.test(s) });

  // Look.
  for (const [re, name] of FILTER_WORDS) {
    if (re.test(s)) {
      acts.push({ type: 'filter', value: name, scope });
      break;
    }
  }
  if (/\bblur(red)?\b|ঝাপসা|ব্লার/.test(s)) acts.push({ type: 'background', value: { mode: 'blur' } });
  else if (/\b(black) (background|bg)\b|কালো ব্যাকগ্রাউন্ড/.test(s))
    acts.push({ type: 'background', value: { mode: 'color', color: '#000000' } });
  else if (/\b(white) (background|bg)\b|সাদা ব্যাকগ্রাউন্ড/.test(s))
    acts.push({ type: 'background', value: { mode: 'color', color: '#ffffff' } });
  if (/\b(fill|zoom(ed)? in|crop to fill|full ?screen)\b|ফুল স্ক্রিন|ফিল(?!্টার)/.test(s)) acts.push({ type: 'fit', value: 'fill', scope });
  else if (/\b(fit|zoom(ed)? out|no crop)\b|ফিট/.test(s)) acts.push({ type: 'fit', value: 'fit', scope });
  if (/\b(fade|transitions?|crossfade)\b|ট্রানজিশন|ফেড/.test(s)) acts.push({ type: 'transition', value: 'fade' });

  const cap = s.match(/\b(classic|box|pop|neon)\b.*\b(captions?|subtitles?)\b|(captions?|subtitles?).*\b(classic|box|pop|neon)\b/);
  if (cap) acts.push({ type: 'captionStyle', value: cap[1] || cap[4] });
  else if (/\b(auto ?captions?|subtitles?|transcribe|captions?)\b|সাবটাইটেল|ক্যাপশন/.test(s)) acts.push({ type: 'autoCaptions' });

  return acts;
}

const TEXT_CMD = /(?:^|\s)(?:add (?:a )?(?:text|title|caption)|write|text|title|লেখা যোগ করো?|টেক্সট যোগ করো?|লিখো|লেখো)\s*[:\-]?\s+(.+)$/i;

export function parseCommand(input) {
  let s = toAscii(String(input || '').trim());
  let text = null;
  const tm = s.match(TEXT_CMD);
  if (tm) {
    text = tm[1].replace(/^["“']|["”']$/g, '').trim();
    s = s.slice(0, tm.index);
  }
  s = s.toLowerCase().replace(/black\s*(and|&)\s*white/g, 'bw');
  const pieces = s.split(/\s*(?:,|;|\.(?!\d)|\bthen\b|\band\b|\balso\b)\s*|\s+(?:এবং|তারপর|আর)\s+/).filter((x) => x.trim());
  const actions = [];
  const unknown = [];
  for (const piece of pieces) {
    const found = detect(piece);
    if (found.length) actions.push(...found);
    else unknown.push(piece.trim());
  }
  if (text) actions.push({ type: 'addText', value: text });
  // The same instruction repeated in one sentence ("blurry, enhance it") counts once.
  const seen = new Set();
  const unique = actions.filter((a) => {
    const k = JSON.stringify(a);
    return seen.has(k) ? false : seen.add(k);
  });
  return { actions: unique, unknown };
}

const EN = {
  aspect: (a) => `Change canvas to ${a.value}`,
  speed: (a) => `Set speed to ${a.value}x`,
  trimStart: (a) => `Cut the first ${a.value}s`,
  trimEnd: (a) => `Cut the last ${a.value}s`,
  mute: (a) => (a.value ? 'Mute audio' : 'Unmute audio'),
  volume: (a) => `Set volume to ${Math.round(a.value * 100)}%`,
  filter: (a) => (a.value === 'none' ? 'Remove filter' : `Apply ${a.value} filter`),
  fit: (a) => (a.value === 'fill' ? 'Fill the frame (crop)' : 'Fit the whole video'),
  background: (a) => (a.value.mode === 'blur' ? 'Blurred background' : `Background ${a.value.color}`),
  transition: () => 'Add fade transitions between clips',
  captionStyle: (a) => `Caption style: ${a.value}`,
  addText: (a) => `Add text “${a.value}”`,
  autoCaptions: () => 'AI auto-captions from speech',
  beatSync: (a) => `Cut clips on the music beat (every ${a.value})`,
  sceneSplit: () => 'Detect scene changes and split the video into shots',
  boost: (a) => `Auto boost the sound${a.scope === 'all' ? ' of all clips' : ''}`,
  enhance: (a) => `Enhance HD: make ${a.scope === 'all' ? 'all clips' : 'the video'} clear and sharp`,
  denoise: () => 'Reduce background noise',
  rotate: (a) => `Rotate ${a.value}°`,
  mirror: () => 'Mirror the video',
  progressBar: (a) => (a.value ? 'Show a progress bar' : 'Hide the progress bar'),
  removePauses: () => 'Detect and remove pauses / silence',
  autoShorts: (a) => `Find the best ${a.value}s highlights`,
  deleteClip: () => 'Delete selected clip',
  duplicateClip: () => 'Duplicate selected clip',
  split: () => 'Split at playhead',
  undo: () => 'Undo',
  redo: () => 'Redo',
};

export function describe(action) {
  const f = EN[action.type];
  const label = f ? f(action) : action.type;
  return action.scope === 'all' ? `${label} (all clips)` : label;
}
