// Generates composition/index.html. Scene timing is derived from the narration
// clips (assets/vo) and their word timestamps (words.json from `hyperframes transcribe`).
// Usage: node build.mjs <words.json>
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const comp = path.join(here, 'composition');
const words = JSON.parse(fs.readFileSync(process.argv[2] || path.join(here, 'words.json'), 'utf8'));
const dur = f => +execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${path.join(comp, f)}"`).toString().trim();
const r2 = n => Math.round(n * 100) / 100;

// ---------- timing ----------
const N = 11, LEAD = 0.2, TAIL = 0.2, LEAD1 = 0.5, HOLD_END = 2.4, XF = 0.5;
const vo = [], S = [];
let t = 0;
for (let i = 1; i <= N; i++) {
  const id = String(i).padStart(2, '0');
  S.push(t);
  const start = t + (i === 1 ? LEAD1 : LEAD);
  const d = dur(`assets/vo/vo-${id}.wav`);
  vo.push({ id, start: r2(start), d: r2(d) });
  t = start + d + (i === N ? HOLD_END : TAIL);
}
const TOTAL = r2(t);
S.push(TOTAL);
// absolute time of the k-th occurrence of a word (prefix match, case-insensitive) in clip i (1-based)
function W(i, word, k = 1) {
  const list = words[String(i).padStart(2, '0')];
  let n = 0;
  for (const [w, s] of list) if (w.toLowerCase().replace(/[^a-z0-9%,]/g, '').startsWith(word.toLowerCase()) && ++n === k) return r2(vo[i - 1].start + s);
  throw new Error(`word ${word} not in clip ${i}`);
}
// scene-local version
const L = (i, word, k) => r2(W(i, word, k) - S[i - 1]);

// beat lock: nearest strong cue within 0.15s
const cues = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.claude/skills/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json'), 'utf8'));
const strong = cues.strongCues.map(c => c.time ?? c);
const beatList = cues.beats.map(b => ({ t: b.time, s: b.intensity }));
function lock(target) {
  let best = null;
  for (const c of strong) if (Math.abs(c - target) <= 0.15 && (best === null || Math.abs(c - target) < Math.abs(best - target))) best = c;
  if (best !== null) return { t: r2(best), locked: 'strongCue' };
  // no strong cue in reach: take the strongest beat-grid hit within 0.15s
  const near = beatList.filter(b => Math.abs(b.t - target) <= 0.15).sort((a, b) => b.s - a.s)[0];
  return near ? { t: r2(near.t), locked: 'beat', intensity: r2(near.s) } : { t: target, locked: false };
}

// ---------- audio-reactive data (music RMS + bass, 15fps) ----------
const ad = JSON.parse(fs.readFileSync(path.join(here, 'music-audio.json'), 'utf8'));
const react = [];
for (let f = 0; f / ad.fps < TOTAL; f += 2) {
  const fr = ad.frames[f] || ad.frames[ad.frames.length - 1];
  react.push([r2(fr.rms), r2(fr.bands[0])]);
}

// ---------- SFX ----------
const sfx = [];
const addSfx = (file, at, vol) => sfx.push({ file, at: r2(at), vol, d: r2(dur(file)) });

// ---------- helpers ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const browser = (url, img, w, bodyH, extra = '', id = '') => `
  <div class="browser" ${id ? `id="${id}"` : ''} style="width:${w}px">
    <div class="bar"><i></i><i></i><i></i><span class="url">${esc(url)}</span></div>
    <div class="body" style="height:${bodyH}px"><div class="cam"><img src="${img}" style="width:${w}px" alt="">${extra}</div></div>
  </div>`;
const brandMark = size => `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><defs><linearGradient id="g${size}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#13909d"/><stop offset="1" stop-color="#0a5f69"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#g${size})"/><rect x="7" y="16" width="4.5" height="10" rx="1.5" fill="#fff" opacity=".75"/><rect x="13.75" y="7" width="4.5" height="19" rx="1.5" fill="#fff"/><rect x="20.5" y="12" width="4.5" height="14" rx="1.5" fill="#fff" opacity=".88"/></svg>`;
const check = `<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const docIc = `<svg viewBox="0 0 24 24" width="26" height="26"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5M9 13h6M9 17h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const sheetIc = `<svg viewBox="0 0 24 24" width="28" height="28"><rect x="4" y="3" width="16" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 9h16M4 15h16M10 3v18" stroke="currentColor" stroke-width="1.8"/></svg>`;

// ---------- scene 2 data: real first rows of the CSV ----------
const csvRows = [
  ['transaction_id', 'date', 'store_id', 'store_city', 'category', 'product_name', 'units_sold', 'unit_price', 'revenue', 'discount_pct'],
  ['TXN000001', '2026-01-01', 'S01', 'Vijayawada', 'Electronics', 'Smart TV', '2', '3075.46', '5843.37', '5'],
  ['TXN000002', '2026-01-01', 'S01', 'Vijayawada', 'Electronics', 'Laptop', '1', '11598.06', '11598.06', '0'],
  ['TXN000003', '2026-01-01', 'S01', 'Vijayawada', 'Electronics', 'Tablet', '3', '5738.37', '15493.6', '10'],
  ['TXN000004', '2026-01-01', 'S01', 'Vijayawada', 'Electronics', 'Smart TV', '3', '3281.28', '9351.65', '5'],
  ['TXN000005', '2026-01-01', 'S01', 'Vijayawada', 'Apparel', 'Jeans', '1', '1917.14', '1917.14', '0'],
  ['TXN000006', '2026-01-01', 'S01', 'Vijayawada', 'Apparel', 'Formal Shirt', '2', '936.28', '1498.05', '20'],
  ['TXN000007', '2026-01-01', 'S01', 'Vijayawada', 'Apparel', 'T-Shirt', '2', '1005.41', '1910.28', '5'],
  ['TXN000008', '2026-01-01', 'S01', 'Vijayawada', 'Apparel', 'Kurta', '3', '2728.18', '8184.54', '0'],
  ['TXN000009', '2026-01-01', 'S01', 'Vijayawada', 'Apparel', 'T-Shirt', '2', '1388.8', '2777.6', '0'],
  ['TXN000010', '2026-01-01', 'S01', 'Vijayawada', 'Apparel', 'Jeans', '2', '3363.08', '6053.54', '10'],
  ['TXN000011', '2026-01-01', 'S01', 'Vijayawada', 'Apparel', 'Kurta', '4', '596.79', '2387.16', '0'],
  ['TXN000012', '2026-01-01', 'S01', 'Vijayawada', 'Apparel', 'Saree', '2', '3011.98', '5722.76', '5'],
  ['TXN000013', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Rice (5kg)', '3', '451.35', '1083.24', '20'],
  ['TXN000014', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Rice (5kg)', '2', '585.21', '1053.38', '10'],
  ['TXN000015', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Rice (5kg)', '6', '353.62', '1909.55', '10'],
  ['TXN000016', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Sugar (1kg)', '1', '155.76', '155.76', '0'],
  ['TXN000017', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Rice (5kg)', '2', '413.69', '786.01', '5'],
  ['TXN000018', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Rice (5kg)', '3', '520.42', '1561.26', '0'],
  ['TXN000019', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Atta (5kg)', '2', '202.89', '365.2', '10'],
  ['TXN000020', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Dal (1kg)', '3', '253.6', '722.76', '5'],
  ['TXN000021', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Oil (1L)', '4', '436.0', '1744.0', '0'],
  ['TXN000022', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Sugar (1kg)', '1', '399.24', '319.39', '20'],
  ['TXN000023', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Dal (1kg)', '3', '139.87', '377.65', '10'],
  ['TXN000024', '2026-01-01', 'S01', 'Vijayawada', 'Grocery', 'Oil (1L)', '2', '594.24', '950.78', '20'],
];

// ---------- scene 7 data ----------
const cats = [
  ['Electronics', 3.7, 49.3], ['Home & Kitchen', 7.8, 17.8], ['Apparel', 14.2, 15.1], ['Grocery', 50.2, 9.2], ['Personal Care', 24.1, 8.6],
];
const PX_PER_PCT = 19; // 50% -> 950px

// ---------- scene 8 chart ----------
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const series = {
  total: [8.48, 7.38, 8.07, 7.57, 7.56, 6.93],
  elec: [4.57, 3.90, 4.08, 3.71, 3.42, 2.97],
  app: [1.00, 0.95, 1.15, 1.17, 1.32, 1.35],
};
const CW = 1040, CH = 520, PADL = 90, PADB = 50, PADT = 20, PADR = 30, YMAX = 9;
const cx = i => PADL + i * ((CW - PADL - PADR) / 5);
const cy = v => PADT + (1 - v / YMAX) * (CH - PADT - PADB);
const pathOf = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${r2(cx(i))},${r2(cy(v))}`).join(' ');
const lenOf = arr => { let s = 0; for (let i = 1; i < arr.length; i++) s += Math.hypot(cx(i) - cx(i - 1), cy(arr[i]) - cy(arr[i - 1])); return Math.ceil(s) + 2; };
const grid = [0, 3, 6, 9].map(v => `<line x1="${PADL}" x2="${CW - PADR}" y1="${r2(cy(v))}" y2="${r2(cy(v))}" class="gl"/><text x="${PADL - 16}" y="${r2(cy(v) + 8)}" text-anchor="end" class="ax">₹${v} Cr</text>`).join('')
  + months.map((m, i) => `<text x="${r2(cx(i))}" y="${CH - 10}" text-anchor="middle" class="ax">${m}</text>`).join('');
const dots = (arr, cls) => arr.map((v, i) => `<circle cx="${r2(cx(i))}" cy="${r2(cy(v))}" r="7" class="dot ${cls}"/>`).join('');

// ---------- scene 9 data ----------
const cities = [['Vijayawada', 10.1], ['Guntur', 9.46], ['Tirupati', 8.36], ['Rajahmundry', 7.01], ['Nellore', 5.57], ['Kakinada', 5.48]];
const days = [['Mon', 11.7], ['Tue', 12.3], ['Wed', 12.0], ['Thu', 12.7], ['Fri', 14.9], ['Sat', 19.2], ['Sun', 17.1]];

// ---------- timings used by the timeline ----------
const T = {
  S, TOTAL, XF,
  // scene 1
  s1Sub: 0.7 + 0.5, s1Cities: W(1, 'six', 2) - 0.1, s1Rows: W(1, 'rows'), s1Q: W(1, 'question'),
  // scene 2
  s2Not: W(2, 'doesn'),
  // scene 3
  s3Logo: lock(S[2] + 0.2), s3Tag: W(3, 'drop'), s3Shot: W(3, 'writes'),
  // scene 4
  s4Chip: S[3] + 0.35, s4Card: W(4, 'browser'), s4Local: W(4, 'browser') + 0.5,
  s4Steps: [W(4, 'file'), W(4, 'quality'), W(4, 'means'), r2(W(4, 'means') + 0.45)],
  // scene 5
  s5Roles: [W(5, 'transaction'), W(5, 'revenue'), W(5, 'store'), W(5, 'date')],
  // scene 6
  s6Push: W(6, 'writes'), s6Tx: W(6, '107'), s6Rev: W(6, '46'), s6Take: W(6, 'takeaways'),
  // scene 7
  s7Bars: S[6] + 0.5, s7Elec: W(7, 'electronics'), s7Half: W(7, 'half'), s7Groc: W(7, 'grocery'), s7Nine: W(7, '9%'),
  // scene 8
  s8Total: S[7] + 0.4, s8Pct: W(8, '18%'), s8Elec: W(8, 'electronics'), s8Q: W(8, 'quarter'), s8App: W(8, 'apparel'),
  // scene 9
  s9Cards: [W(9, 'vijayawada'), W(9, 'saturday'), W(9, '15')],
  // scene 10
  s10Recs: S[9] + 0.3, s10Exp: W(10, 'exports'),
  // scene 11
  s11Logo: lock(S[10] + 0.2), s11Tag: W(11, 'turn'), s11Url: W(11, 'act'),
  vo,
};
T.s3LogoT = T.s3Logo.t; T.s11LogoT = T.s11Logo.t;
T.s8Len = { total: lenOf(series.total), elec: lenOf(series.elec), app: lenOf(series.app) };

// SFX schedule
addSfx('assets/sfx/ui/click2.ogg', 2.2, 0.35);
addSfx('assets/sfx/impact/impactSoft_medium_001.ogg', T.s3LogoT, 0.6);
addSfx('assets/sfx/interface/drop_002.ogg', T.s4Chip + 0.25, 0.45);
addSfx('assets/sfx/interface/drop_002.ogg', T.s4Card + 0.2, 0.4);
T.s4Steps.forEach(x => addSfx('assets/sfx/interface/click_002.ogg', x, 0.35));
T.s5Roles.forEach(x => addSfx('assets/sfx/ui/rollover2.ogg', x, 0.3));
T.s9Cards.forEach(x => addSfx('assets/sfx/casino/card-slide-1.ogg', x, 0.3));
[0, 1, 2, 3].forEach(k => addSfx('assets/sfx/interface/click_003.ogg', T.s10Exp + k * 0.14, 0.3));
addSfx('assets/sfx/interface/bong_001.ogg', T.s11LogoT, 0.45);

// music volume lane
const lastVoEnd = vo[N - 1].start + vo[N - 1].d;
const musicLane = { version: 1, lanes: [{ target: 'volume', points: [
  { t: 0, v: 0 }, { t: 1.2, v: 0.16 }, { t: r2(lastVoEnd - 0.2), v: 0.16 }, { t: r2(lastVoEnd + 0.6), v: 0.34 }, { t: r2(TOTAL - 2.2), v: 0.34 }, { t: TOTAL, v: 0 },
] }] };

// ---------- scene markup ----------
const sceneClip = (i, inner, cls = '') => {
  const start = S[i - 1];
  const end = i === N ? TOTAL : Math.min(TOTAL, S[i] + XF);
  return `<section id="s${i}" class="clip scene-clip" data-start="${r2(start)}" data-duration="${r2(end - start)}" data-track-index="${1 + ((i + 1) % 2)}"><div class="scene ${cls}" id="s${i}-in">${inner}</div></section>`;
};

const scenes = [];
// 1 — hook
scenes.push(sceneClip(1, `
  <div class="center-stack">
    <div class="eyebrow" id="s1-eb">Retail sales · Jan–Jun 2026</div>
    <div class="counter-row"><span class="counter" id="s1-count">0</span><span class="counter-unit" id="s1-rows">rows</span></div>
    <div class="sub" id="s1-sub">Six months of sales · 6 cities · Andhra Pradesh</div>
    <div class="pill-row" id="s1-cities">${cities.map(c => `<span class="pill">${c[0]}</span>`).join('')}</div>
    <div class="question" id="s1-q">What's really happening to the business?</div>
  </div>`));
// 2 — rows, not answers
scenes.push(sceneClip(2, `
  <div class="sheet-wrap"><table class="sheet" id="s2-sheet">${csvRows.map((r, i) => `<tr>${r.map(c => i ? `<td data-layout-allow-overlap>${esc(c)}</td>` : `<th data-layout-allow-overlap>${esc(c)}</th>`).join('')}</tr>`).join('')}</table></div>
  <div class="sheet-fade"></div>
  <div class="overlay-card" id="s2-card"><div class="oc-l1">Spreadsheets give you rows.</div><div class="oc-l2" id="s2-not">Not answers.</div></div>`));
// 3 — reveal
scenes.push(sceneClip(3, `
  <div class="reveal-top" id="s3-top">
    <div class="logo-row"><div class="mark" id="s3-mark">${brandMark(128)}</div><div class="wordmark" id="s3-word">Clarity</div></div>
    <div class="tagline" id="s3-tag">Turn any spreadsheet into <span class="grad">a report you can act on</span></div>
  </div>
  <div class="shot-rise" id="s3-shot">${browser('clarityeda.netlify.app', 'assets/ui/landing.png', 1320, 820)}</div>`));
// 4 — upload
scenes.push(sceneClip(4, `
  <div class="s4-frame" id="s4-frame">${browser('clarityeda.netlify.app/#/app', 'assets/ui/home.png', 1180, 700, `
    <div class="dz-hi" id="s4-dz"></div>
    <div class="file-chip" id="s4-chip"><span class="fc-ic">${sheetIc}</span><span><b>retail_sales.csv</b><em>8.1 MB</em></span></div>`)}</div>
  <div class="ingest" id="s4-card">
    <div class="ing-file"><span class="fi">${sheetIc}</span><div><b>retail_sales.csv</b><span>8.1 MB · 107,836 rows</span></div></div>
    <div class="ing-steps">${['Reading the file', 'Checking data quality', 'Understanding the columns', 'Writing your report'].map((s, k) => `<div class="st" id="s4-st${k}"><span class="b" id="s4-b${k}"><span class="ck" id="s4-ck${k}">${check}</span></span>${s}</div>`).join('')}</div>
    <div class="local" id="s4-local"><span class="dot-g"></span>Runs in your browser — nothing is uploaded</div>
  </div>`));
// 5 — columns
const k5 = 1180 / 1920;
const hiRow = (id, y0, y1) => `<div class="row-hi" id="${id}" style="left:${r2(372 * k5)}px;top:${r2(y0 * k5)}px;width:${r2(1512 * k5)}px;height:${r2((y1 - y0) * k5)}px"></div>`;
scenes.push(sceneClip(5, `
  <div class="s5-frame">${browser('clarityeda.netlify.app/#/app/columns', 'assets/ui/columns.png', 1180, 738, hiRow('s5-h0', 486, 588) + hiRow('s5-h2', 772, 852) + hiRow('s5-h3', 588, 668))}</div>
  <div class="roles" id="s5-panel">
    <div class="roles-h">How Clarity read your columns</div>
    ${[['transaction_id', 'Identifier', 'never added up', 'grey'], ['revenue', 'Money · ₹', 'totals in lakh & crore', 'teal'], ['store_city', 'Location', 'compared city by city', 'blue'], ['date', 'Date', 'powers every trend', 'amber']].map((r, k) => `
    <div class="role" id="s5-r${k}"><code>${r[0]}</code><span class="arrow">→</span><span class="rp ${r[3]}">${r[1]}</span><div class="rn">${r[2]}</div></div>`).join('')}
  </div>`));
// 6 — summary
const k6 = 1560 / 1920;
const box = (id, x0, y0, x1, y1) => `<div class="ring" id="${id}" style="left:${r2(x0 * k6)}px;top:${r2(y0 * k6)}px;width:${r2((x1 - x0) * k6)}px;height:${r2((y1 - y0) * k6)}px"></div>`;
scenes.push(sceneClip(6, `
  <div class="s6-frame">${browser('clarityeda.netlify.app/#/app/summary', 'assets/ui/summary.png', 1560, 880, box('s6-r0', 368, 459, 744, 620) + box('s6-r1', 750, 459, 1125, 620) + box('s6-r2', 368, 640, 1888, 1022), 's6-browser')}</div>`));
// 7 — share of transactions vs revenue
scenes.push(sceneClip(7, `
  <div class="insight-head">
    <div class="eyebrow">Where the money is</div>
    <div class="h-swap">
      <h2 class="big-h" id="s7-h1"><span class="h-line">Electronics: <b class="neutral">3.7%</b> of transactions.</span><span class="h-line"><b class="teal">49%</b> of revenue.</span></h2>
      <h2 class="big-h" id="s7-h2"><span class="h-line">Grocery: <b class="neutral">50%</b> of transactions.</span><span class="h-line">Just <b class="teal">9%</b> of revenue.</span></h2>
    </div>
  </div>
  <div class="legend"><span><i class="lg-g"></i>Share of transactions</span><span><i class="lg-t"></i>Share of revenue</span></div>
  <div class="pairs">${cats.map((c, k) => `
    <div class="pair" id="s7-p${k}"><div class="pl">${c[0]}</div><div class="pb">
      <div class="bar-line"><div class="bar g" id="s7-g${k}" style="width:${r2(c[1] * PX_PER_PCT)}px"></div><span class="bv muted">${c[1]}%</span></div>
      <div class="bar-line"><div class="bar t" id="s7-t${k}" style="width:${r2(c[2] * PX_PER_PCT)}px"></div><span class="bv">${c[2]}%</span></div>
    </div></div>`).join('')}</div>`));
// 8 — what's changing
scenes.push(sceneClip(8, `
  <div class="insight-head">
    <div class="eyebrow">What's changing</div>
    <h2 class="big-h one">Revenue slid <b class="bad">18%</b> from January to June.</h2>
  </div>
  <div class="chart-card">
    <svg width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}" class="lc">
      ${grid}
      <g id="s8-q"><line x1="${r2((cx(2) + cx(3)) / 2)}" x2="${r2((cx(2) + cx(3)) / 2)}" y1="${PADT}" y2="${CH - PADB}" class="qdiv"/><text x="${r2((cx(2) + cx(3)) / 2 - 18)}" y="${PADT + 24}" text-anchor="end" class="qlab">Jan–Mar</text><text x="${r2((cx(2) + cx(3)) / 2 + 18)}" y="${PADT + 24}" class="qlab">Apr–Jun</text></g>
      <path d="${pathOf(series.total)}" class="ln total" id="s8-lt" stroke-dasharray="${T.s8Len.total}"/>
      <g id="s8-dt">${dots(series.total, 'total')}</g>
      <path d="${pathOf(series.elec)}" class="ln elec" id="s8-le" stroke-dasharray="${T.s8Len.elec}"/>
      <g id="s8-de">${dots(series.elec, 'elec')}</g>
      <path d="${pathOf(series.app)}" class="ln app" id="s8-la" stroke-dasharray="${T.s8Len.app}"/>
      <g id="s8-da">${dots(series.app, 'app')}</g>
    </svg>
    <div class="lc-key"><span id="s8-k0"><i class="k-total"></i>All revenue</span><span id="s8-k1"><i class="k-elec"></i>Electronics</span><span id="s8-k2"><i class="k-app"></i>Apparel</span></div>
  </div>
  <div class="callouts">
    <div class="co" id="s8-c0"><div class="co-l">All revenue</div><div class="co-v bad">−18%</div><div class="co-n">₹8.48 Cr in January → ₹6.93 Cr in June</div></div>
    <div class="co" id="s8-c1"><div class="co-l">Electronics · quarter on quarter</div><div class="co-v bad">−20%</div><div class="co-n">−₹2.45 Cr — more than the whole drop</div></div>
    <div class="co" id="s8-c2"><div class="co-l">Apparel · quarter on quarter</div><div class="co-v good">+23%</div><div class="co-n">+₹72.8 L — share up from 13% to 17%</div></div>
  </div>`));
// 9 — three cards
const cityMax = cities[0][1];
scenes.push(sceneClip(9, `
  <div class="insight-head">
    <div class="eyebrow">Every city, day and product</div>
    <h2 class="big-h one">Ranked, compared and explained.</h2>
  </div>
  <div class="cards3">
    <div class="sc" id="s9-c0"><div class="sc-l">Top city</div><div class="sc-v">Vijayawada</div><div class="sc-n"><b>₹10.1 Cr</b> · 22% of revenue</div>
      <div class="mini-h">${cities.map((c, k) => `<div class="mh"><span>${c[0]}</span><i style="width:${r2((c[1] / cityMax) * 250)}px" class="${k ? '' : 'on'}"></i></div>`).join('')}</div></div>
    <div class="sc" id="s9-c1"><div class="sc-l">Busiest day</div><div class="sc-v">Saturday</div><div class="sc-n"><b>19%</b> of transactions · Monday is quietest</div>
      <div class="mini-v">${days.map(d => `<div class="mv"><i style="height:${r2((d[1] / 19.2) * 150)}px" class="${d[0] === 'Sat' ? 'on' : ''}"></i><span>${d[0][0]}</span></div>`).join('')}</div></div>
    <div class="sc" id="s9-c2"><div class="sc-l">Top products</div><div class="sc-v">15 of 25</div><div class="sc-n">bring in <b>80%</b> of revenue</div>
      <div class="mini-sq">${Array.from({ length: 25 }, (_, k) => `<i class="${k < 15 ? 'on' : ''}"></i>`).join('')}</div><div class="sc-f">Top product: Headphones · ₹4.77 Cr</div></div>
  </div>`));
// 10 — act & share
scenes.push(sceneClip(10, `
  <div class="insight-head"><div class="eyebrow">Then, what to do next</div></div>
  <div class="recs" id="s10-recs"><img src="assets/ui/sec-recs.png" alt=""></div>
  <div class="export-row"><div class="ex-l" id="s10-exl">Export the whole report</div>
    ${['PDF', 'HTML', 'Markdown', 'Cleaned CSV'].map((x, k) => `<div class="ex" id="s10-e${k}">${docIc}<span>${x}</span></div>`).join('')}</div>`));
// 11 — outro
scenes.push(sceneClip(11, `
  <div class="center-stack outro">
    <div class="logo-row"><div class="mark big" id="s11-mark">${brandMark(150)}</div><div class="wordmark big" id="s11-word">Clarity</div></div>
    <div class="tagline" id="s11-tag">Turn any spreadsheet into <span class="grad">a report you can act on</span></div>
    <div class="url-pill" id="s11-url">clarityeda.netlify.app</div>
  </div>`));

// ---------- fonts ----------
const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';
const fontFaces = [400, 500, 600, 700, 800].map(w => `
@font-face{font-family:"Inter";font-style:normal;font-weight:${w};font-display:block;src:url(assets/fonts/inter-latin-ext-${w}-normal.woff2) format("woff2");unicode-range:${LATIN_EXT}}
@font-face{font-family:"Inter";font-style:normal;font-weight:${w};font-display:block;src:url(assets/fonts/inter-latin-${w}-normal.woff2) format("woff2");unicode-range:${LATIN}}`).join('');

const css = fs.readFileSync(path.join(here, 'composition.css'), 'utf8');
const js = fs.readFileSync(path.join(here, 'composition.timeline.js'), 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1920, height=1080">
<title>Clarity — launch film</title>
<script src="assets/js/gsap.min.js"></script>
<style>${fontFaces}
${css}</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080" data-duration="${TOTAL}">
  <div class="bg"></div>
  <div class="glow" id="glow"><div class="glow-a"></div><div class="glow-b"></div></div>
  ${scenes.join('\n')}
  <audio id="music" src="assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3" data-start="0" data-duration="${TOTAL}" data-track-index="10" data-volume="1" data-automation='${JSON.stringify(musicLane)}'></audio>
  ${vo.map(v => `<audio id="vo-${v.id}" src="assets/vo/vo-${v.id}.wav" data-start="${v.start}" data-duration="${v.d}" data-track-index="11" data-volume="1"></audio>`).join('\n  ')}
  ${sfx.map((s, k) => `<audio id="sfx-${k}" src="${s.file}" data-start="${s.at}" data-duration="${s.d}" data-track-index="${20 + (k % 4)}" data-volume="${s.vol}"></audio>`).join('\n  ')}
</div>
<script>
var T = ${JSON.stringify(T)};
var REACT = ${JSON.stringify(react)};
${js}
</script>
</body>
</html>
`;
fs.writeFileSync(path.join(comp, 'index.html'), html);
console.log('TOTAL', TOTAL, 'scenes', S.map(r2).join(' '));
console.log('logo lock', T.s3Logo, 'outro lock', T.s11Logo);
