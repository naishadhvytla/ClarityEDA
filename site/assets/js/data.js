/* ==========================================================================
   Clarity — data engine
   Type inference, date parsing, profiling, quality scoring and cleaning.
   Pure functions only (no DOM) so the same code runs in the browser and in
   Node-based tests.
   ========================================================================== */

export const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', 'nil', '-', '--', '?', '#n/a', 'undefined', '#value!', '#div/0!', '#ref!', '<na>']);
const BOOL_TOKENS = new Set(['true', 'false', 'yes', 'no', 'y', 'n', 't', 'f', '0', '1']);
const CURRENCY_SYMBOLS = ['₹', '$', '€', '£', '¥'];

export const isMissing = v =>
  v == null || (typeof v === 'number' && !Number.isFinite(v)) ||
  (typeof v === 'string' && MISSING_TOKENS.has(v.trim().toLowerCase()));

/* ---------- numbers ---------- */
const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v == null) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  let neg = false;
  if (s[0] === '(' && s[s.length - 1] === ')') { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^(rs\.?|inr|usd|eur|gbp)\s*/i, '').replace(/\s*(rs\.?|inr|usd|eur|gbp|\/-)$/i, '');
  if (/[₹$€£¥]/.test(s)) s = s.replace(/[₹$€£¥]/g, '');
  if (s.endsWith('%')) s = s.slice(0, -1);
  if (/[,\s]/.test(s)) s = s.replace(/[,\s]/g, '');
  if (!NUM_RE.test(s)) return NaN;
  const n = Number(s);
  return neg ? -n : n;
}

/* ---------- dates ---------- */
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const RE_ISO = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(?:Z|[+-]\d{2}:?\d{2})?)?$/i;
const RE_NUMERIC = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i;
const RE_D_MON_Y = /^(\d{1,2})(?:st|nd|rd|th)?[ \-/]([a-z]{3,9})\.?[ \-/,]*(\d{4}|\d{2})$/i;
const RE_MON_D_Y = /^([a-z]{3,9})\.?[ \-]?(\d{1,2})(?:st|nd|rd|th)?,?[ \-]+(\d{4})$/i;
const RE_MON_Y = /^([a-z]{3,9})\.?[ \-/,]+(\d{4})$/i;
const RE_Y_M = /^(\d{4})[-/](\d{1,2})$/;

const fullYear = y => (y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y);
function mk(y, m, d, hh = 0, mm = 0, ss = 0) {
  if (m < 0 || m > 11 || d < 1 || d > 31 || y < 1800 || y > 2200) return NaN;
  const t = Date.UTC(y, m, d, hh, mm, ss);
  const dt = new Date(t);
  return dt.getUTCDate() === d ? t : NaN; // rejects 31 Feb etc.
}

/** Parse a single value to a UTC timestamp. `order` resolves 03/04/2024 ambiguity ('dmy' | 'mdy'). */
export function parseDate(v, order = 'dmy') {
  if (v == null) return NaN;
  if (v instanceof Date) return isNaN(v) ? NaN : v.getTime();
  if (typeof v === 'number') return NaN;
  const s = String(v).trim();
  if (s.length < 6 || s.length > 40) return NaN;
  let m;
  if ((m = RE_ISO.exec(s))) return mk(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  if ((m = RE_NUMERIC.exec(s))) {
    const a = +m[1], b = +m[2], y = fullYear(+m[3]);
    let hh = +(m[4] || 0);
    if (m[7]) { const pm = m[7].toLowerCase() === 'pm'; if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
    const [d, mo] = order === 'mdy' ? [b, a] : [a, b];
    return mk(y, mo - 1, d, hh, +(m[5] || 0), +(m[6] || 0));
  }
  if ((m = RE_D_MON_Y.exec(s))) { const mo = MONTHS[m[2].toLowerCase()]; return mo == null ? NaN : mk(fullYear(+m[3]), mo, +m[1]); }
  if ((m = RE_MON_D_Y.exec(s))) { const mo = MONTHS[m[1].toLowerCase()]; return mo == null ? NaN : mk(+m[3], mo, +m[2]); }
  if ((m = RE_MON_Y.exec(s))) { const mo = MONTHS[m[1].toLowerCase()]; return mo == null ? NaN : mk(+m[2], mo, 1); }
  if ((m = RE_Y_M.exec(s))) return mk(+m[1], +m[2] - 1, 1);
  return NaN;
}

/** Decide whether ambiguous numeric dates are day-first or month-first by looking for values > 12. */
export function detectDateOrder(values, fallback = 'dmy') {
  let dmy = 0, mdy = 0;
  for (const v of values) {
    const m = RE_NUMERIC.exec(String(v).trim());
    if (!m) continue;
    if (+m[1] > 12 && +m[2] <= 12) dmy++;
    else if (+m[2] > 12 && +m[1] <= 12) mdy++;
  }
  if (dmy > mdy) return 'dmy';
  if (mdy > dmy) return 'mdy';
  return fallback;
}

export const isoDate = t => new Date(t).toISOString().slice(0, 10);

/* ---------- Dataset: rows + cached typed column views ---------- */
export class Dataset {
  constructor(rows, cols, opts = {}) {
    this.rows = rows;
    this.cols = cols;
    this.dateOrder = opts.dateOrder || {};
    this._cache = new Map();
  }
  get length() { return this.rows.length; }
  raw(col) { return this.rows.map(r => r[col]); }
  num(col) {
    const k = 'n:' + col;
    if (!this._cache.has(k)) {
      const a = new Float64Array(this.rows.length);
      for (let i = 0; i < a.length; i++) { const v = this.rows[i][col]; a[i] = isMissing(v) ? NaN : parseNumber(v); }
      this._cache.set(k, a);
    }
    return this._cache.get(k);
  }
  str(col) {
    const k = 's:' + col;
    if (!this._cache.has(k)) this._cache.set(k, this.rows.map(r => { const v = r[col]; return isMissing(v) ? null : String(v).trim(); }));
    return this._cache.get(k);
  }
  date(col) {
    const k = 'd:' + col;
    if (!this._cache.has(k)) {
      const order = this.dateOrder[col] || 'dmy';
      const a = new Float64Array(this.rows.length);
      for (let i = 0; i < a.length; i++) { const v = this.rows[i][col]; a[i] = isMissing(v) ? NaN : parseDate(v, order); }
      this._cache.set(k, a);
    }
    return this._cache.get(k);
  }
}

/* ---------- statistics ---------- */
export function quantileSorted(a, p) {
  if (!a.length) return NaN;
  const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

export function numericStats(arr) {
  const a = [];
  for (const x of arr) if (Number.isFinite(x)) a.push(x);
  const n = a.length;
  if (!n) return null;
  a.sort((x, y) => x - y);
  let sum = 0, integer = true, zeros = 0, negatives = 0;
  for (const x of a) { sum += x; if (integer && !Number.isInteger(x)) integer = false; if (x === 0) zeros++; if (x < 0) negatives++; }
  const mean = sum / n;
  let m2 = 0, m3 = 0, m4 = 0;
  for (const x of a) { const d = x - mean; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
  const variance = m2 / n, std = Math.sqrt(variance);
  const skew = std ? (m3 / n) / std ** 3 : 0;
  const kurt = std ? (m4 / n) / std ** 4 - 3 : 0;
  const q1 = quantileSorted(a, 0.25), median = quantileSorted(a, 0.5), q3 = quantileSorted(a, 0.75), iqr = q3 - q1;
  const lb = q1 - 1.5 * iqr, ub = q3 + 1.5 * iqr;
  let outliers = 0, outLow = 0, outHigh = 0;
  if (iqr > 0) for (const x of a) { if (x < lb) { outliers++; outLow++; } else if (x > ub) { outliers++; outHigh++; } }
  return {
    n, sum, mean, median, q1, q3, iqr, std, variance, skew, kurt, lb, ub, outliers, outLow, outHigh,
    min: a[0], max: a[n - 1], range: a[n - 1] - a[0], p05: quantileSorted(a, 0.05), p95: quantileSorted(a, 0.95),
    integer, zeros, negatives,
  };
}

export function pearson(x, y) {
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i], b = y[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    n++; sx += a; sy += b; sxx += a * a; syy += b * b; sxy += a * b;
  }
  if (n < 5) return { r: NaN, n };
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return { r: den === 0 ? NaN : (n * sxy - sx * sy) / den, n };
}

/* ---------- type inference ---------- */
function evenlySample(arr, max) {
  if (arr.length <= max) return arr;
  const out = [], step = arr.length / max;
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

/**
 * Infer a column's storage type from its raw values.
 * Returns { type, dateOrder?, percent, currency, leadingZeros, avgLen }.
 * type: numeric | date | boolean | categorical | text | empty
 */
export function inferType(rawValues, dateFallback = 'dmy') {
  const present = [];
  for (const v of rawValues) if (!isMissing(v)) present.push(v);
  const info = { type: 'empty', percent: false, currency: null, leadingZeros: 0, avgLen: 0 };
  if (!present.length) return info;
  const sample = evenlySample(present, 20000);
  const N = sample.length;
  let nNum = 0, nDate = 0, nPct = 0, lead = 0, lenSum = 0, spaced = 0;
  const cur = {};
  const lowerSet = new Set();
  const order = detectDateOrder(sample.slice(0, 5000), dateFallback);
  for (const v of sample) {
    if (v instanceof Date) { nDate++; continue; }
    if (typeof v === 'number') { nNum++; continue; }
    const s = String(v).trim();
    lenSum += s.length;
    if (s.includes(' ')) spaced++;
    if (lowerSet.size <= 3) lowerSet.add(s.toLowerCase());
    if (Number.isFinite(parseNumber(s))) {
      nNum++;
      if (s.endsWith('%')) nPct++;
      if (/^0\d+$/.test(s)) lead++;
      for (const c of CURRENCY_SYMBOLS) if (s.includes(c)) { cur[c] = (cur[c] || 0) + 1; break; }
      if (/^(rs\.?|inr)\s*\d|\d\s*(inr|\/-)$/i.test(s)) cur['₹'] = (cur['₹'] || 0) + 1;
    } else if (Number.isFinite(parseDate(s, order))) nDate++;
  }
  info.avgLen = lenSum / N;
  info.leadingZeros = lead / N;
  const uniqLower = lowerSet;
  if (nDate / N >= 0.9) return { ...info, type: 'date', dateOrder: order };
  if (nNum / N >= 0.9) {
    if (uniqLower.size <= 2 && [...uniqLower].every(x => x === '0' || x === '1') && present.every(v => v === 0 || v === 1 || v === '0' || v === '1')) return { ...info, type: 'boolean' };
    if (info.leadingZeros > 0.05) return { ...info, type: 'categorical' };
    info.percent = nPct / N > 0.5;
    const topCur = Object.entries(cur).sort((a, b) => b[1] - a[1])[0];
    info.currency = topCur && topCur[1] / N > 0.3 ? topCur[0] : null;
    return { ...info, type: 'numeric' };
  }
  if (uniqLower.size <= 2) {
    const all = new Set(sample.map(v => String(v).trim().toLowerCase()));
    if (all.size <= 2 && [...all].every(x => BOOL_TOKENS.has(x))) return { ...info, type: 'boolean' };
  }
  if (info.avgLen > 45 || (info.avgLen > 25 && spaced / N > 0.8 && new Set(sample).size / N > 0.8)) return { ...info, type: 'text' };
  return { ...info, type: 'categorical' };
}

/* ---------- profiling ---------- */
function freqTable(strs) {
  const m = new Map();
  for (const s of strs) if (s != null) m.set(s, (m.get(s) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function profileColumn(ds, name, dateFallback = 'dmy') {
  const raw = ds.raw(name);
  const N = raw.length;
  const t = inferType(raw, dateFallback);
  if (t.type === 'date') ds.dateOrder[name] = t.dateOrder;
  let missing = 0;
  for (const v of raw) if (isMissing(v)) missing++;
  const col = {
    name, type: t.type, N, missing, missingPct: N ? missing / N : 0,
    percent: t.percent, currency: t.currency, avgLen: t.avgLen, dateOrder: t.dateOrder || null,
    unique: 0, uniqueRatio: 0, stats: null, top: null, dates: null, mixed: 0, variants: 0, formatted: 0, nonIsoDates: 0,
  };
  const strs = ds.str(name);
  if (t.type === 'numeric') {
    const nums = ds.num(name);
    col.stats = numericStats(nums);
    const set = new Set();
    for (let i = 0; i < N; i++) {
      if (strs[i] == null) continue;
      if (Number.isFinite(nums[i])) { set.add(nums[i]); if (typeof raw[i] === 'string' && /[,₹$€£¥%]|^\s*\(|\s/.test(raw[i].trim())) col.formatted++; }
      else col.mixed++;
    }
    col.unique = set.size;
    if (col.unique <= 50) {
      const m = new Map();
      for (const x of nums) if (Number.isFinite(x)) m.set(x, (m.get(x) || 0) + 1);
      col.top = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => [String(k), c]);
    }
  } else if (t.type === 'date') {
    const ts = ds.date(name);
    let mn = Infinity, mx = -Infinity, n = 0, hasTime = false;
    const set = new Set();
    for (let i = 0; i < ts.length; i++) {
      const x = ts[i];
      if (!Number.isFinite(x)) { if (strs[i] != null) col.mixed++; continue; }
      n++; set.add(x);
      if (x < mn) mn = x; if (x > mx) mx = x;
      if (!hasTime && x % 86400000 !== 0) hasTime = true;
      if (!/^\d{4}-\d{2}-\d{2}/.test(strs[i])) col.nonIsoDates++;
    }
    col.unique = set.size;
    col.dates = n ? { min: mn, max: mx, n, spanDays: (mx - mn) / 86400000, hasTime } : null;
  } else {
    const ft = freqTable(strs);
    col.unique = ft.length;
    col.top = ft.slice(0, 60);
    if (t.type === 'categorical' && ft.length <= 5000) {
      const groups = new Map();
      for (const [v, c] of ft) { const k = v.toLowerCase().replace(/\s+/g, ' '); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([v, c]); }
      for (const g of groups.values()) if (g.length > 1) col.variants += g.slice(1).reduce((s, x) => s + x[1], 0);
    }
    const ws = raw.filter(v => typeof v === 'string' && v !== v.trim() && v.trim() !== '').length;
    col.whitespace = ws;
  }
  const present = N - missing;
  col.uniqueRatio = present ? col.unique / present : 0;
  col.empty = t.type === 'empty';
  col.constant = !col.empty && col.unique <= 1;
  return col;
}

export function profileDataset(ds, dateFallback = 'dmy') {
  const columns = ds.cols.map(c => profileColumn(ds, c, dateFallback));
  const seen = new Set();
  let duplicates = 0;
  for (const r of ds.rows) {
    let k = '';
    for (const c of ds.cols) k += (r[c] == null ? '' : String(r[c])) + '\u0001';
    if (seen.has(k)) duplicates++; else seen.add(k);
  }
  return { N: ds.rows.length, columns, duplicates };
}

/* ---------- quality score (transparent, capped penalties) ---------- */
export function qualityScore(prof) {
  const { N, columns, duplicates } = prof;
  const cells = N * columns.length;
  const totalMissing = columns.reduce((s, c) => s + c.missing, 0);
  const missRate = cells ? totalMissing / cells : 0;
  const dupRate = N ? duplicates / N : 0;
  const constCols = columns.filter(c => c.constant).length;
  const emptyCols = columns.filter(c => c.empty).length;
  const mixedCols = columns.filter(c => c.mixed > 0).length;
  const labelCols = columns.filter(c => c.variants > 0).length;
  const outlierCells = columns.reduce((s, c) => s + (c.stats ? c.stats.outliers : 0), 0);
  const numCells = columns.reduce((s, c) => s + (c.stats ? c.stats.n : 0), 0);
  const outRate = numCells ? outlierCells / numCells : 0;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts = [
    { key: 'missing', t: 'Missing values', pen: Math.round(missRate * 100 * 0.9), detail: `${(missRate * 100).toFixed(1)}% of cells` },
    { key: 'dup', t: 'Duplicate rows', pen: Math.round(dupRate * 100 * 0.9), detail: plural(duplicates, 'row') },
    { key: 'const', t: 'Constant columns', pen: constCols * 4, detail: plural(constCols, 'column') },
    { key: 'empty', t: 'Empty columns', pen: emptyCols * 6, detail: plural(emptyCols, 'column') },
    { key: 'mixed', t: 'Mixed-type columns', pen: mixedCols * 5, detail: plural(mixedCols, 'column') },
    { key: 'labels', t: 'Inconsistent labels', pen: labelCols * 2, detail: plural(labelCols, 'column') },
    { key: 'outliers', t: 'Outliers', pen: Math.round(outRate * 100 * 0.35), detail: `${(outRate * 100).toFixed(1)}% of numeric cells` },
  ];
  let score = 100;
  for (const p of parts) { p.pen = Math.max(0, Math.min(30, p.pen)); score -= p.pen; }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 55 ? 'Fair' : 'Poor';
  return { score, grade, parts, missRate, dupRate, totalMissing, constCols, emptyCols, mixedCols, outRate };
}

/* ---------- issue detection ---------- */
const SEV = { high: 0, medium: 1, low: 2 };

export function detectIssues(prof) {
  const out = [];
  const { N, columns, duplicates } = prof;
  if (duplicates > 0) out.push({
    id: 'dup', kind: 'duplicates', title: 'Duplicate rows', col: null, count: duplicates,
    severity: duplicates / N > 0.05 ? 'high' : 'medium',
    problem: `${duplicates.toLocaleString('en-US')} rows are exact copies of an earlier row. They double-count in totals and averages.`,
    options: [{ mode: 'remove', label: 'Remove duplicates', desc: 'Keep the first occurrence of each row' }],
  });
  for (const c of columns) {
    if (c.empty) {
      out.push({ id: 'empty:' + c.name, kind: 'dropcol', title: 'Empty column', col: c.name, count: N, severity: 'high',
        problem: `"${c.name}" has no values at all.`, options: [{ mode: 'drop', label: 'Drop column', desc: 'Remove it from the dataset' }] });
      continue;
    }
    if (c.constant) out.push({ id: 'const:' + c.name, kind: 'dropcol', title: 'Constant column', col: c.name, count: N, severity: 'low',
      problem: `Every row of "${c.name}" has the same value, so it cannot explain any differences.`,
      options: [{ mode: 'drop', label: 'Drop column', desc: 'Remove it from the dataset' }] });
    if (c.mixed > 0 && (c.type === 'numeric' || c.type === 'date')) out.push({
      id: 'mixed:' + c.name, kind: 'mixed', title: c.type === 'numeric' ? 'Text inside a number column' : 'Unreadable dates', col: c.name, count: c.mixed, severity: 'high',
      problem: `${c.mixed.toLocaleString('en-US')} values in "${c.name}" can't be read as ${c.type === 'numeric' ? 'numbers' : 'dates'}.`,
      options: [{ mode: 'blank', label: 'Convert to blank', desc: 'Treat them as missing so they stop skewing results' }, { mode: 'drop', label: 'Drop those rows' }],
    });
    if (c.missing > 0) {
      const idLike = c.uniqueRatio > 0.9 && c.type !== 'numeric';
      let options;
      if (c.type === 'numeric' && c.stats) options = [
        { mode: 'median', label: `Fill with median (${fmtPlain(c.stats.median)})`, desc: 'Robust to outliers' },
        { mode: 'mean', label: `Fill with mean (${fmtPlain(c.stats.mean)})` },
        { mode: 'zero', label: 'Fill with 0' },
        { mode: 'drop', label: 'Drop rows' }];
      else if (c.type === 'date' || idLike) options = [{ mode: 'drop', label: 'Drop rows', desc: 'Rows without this value are removed' }, { mode: 'unknown', label: 'Fill with "Unknown"' }];
      else options = [
        { mode: 'unknown', label: 'Fill with "Unknown"', desc: 'Keeps the rows and shows the gap honestly in breakdowns' },
        { mode: 'mode', label: `Fill with most common ("${String(c.top && c.top[0] ? c.top[0][0] : '').slice(0, 24)}")` },
        { mode: 'drop', label: 'Drop rows' }];
      out.push({ id: 'miss:' + c.name, kind: 'missing', title: 'Missing values', col: c.name, count: c.missing,
        severity: c.missingPct > 0.2 ? 'high' : c.missingPct > 0.05 ? 'medium' : 'low',
        problem: `${c.missing.toLocaleString('en-US')} of ${N.toLocaleString('en-US')} rows (${(c.missingPct * 100).toFixed(1)}%) have no "${c.name}".`, options });
    }
    if (c.variants > 0) out.push({ id: 'labels:' + c.name, kind: 'labels', title: 'Inconsistent labels', col: c.name, count: c.variants, severity: 'medium',
      problem: `Some values in "${c.name}" differ only by capitalisation or spacing (e.g. ${variantExample(c)}), which splits one category into several.`,
      options: [{ mode: 'merge', label: 'Merge variants', desc: 'Use the most common spelling for each group' }] });
    else if (c.whitespace > 0) out.push({ id: 'ws:' + c.name, kind: 'labels', title: 'Extra spaces', col: c.name, count: c.whitespace, severity: 'low',
      problem: `${c.whitespace.toLocaleString('en-US')} values in "${c.name}" have leading or trailing spaces.`,
      options: [{ mode: 'merge', label: 'Trim spaces' }] });
    if (c.type === 'numeric' && c.formatted > 0) out.push({ id: 'fmt:' + c.name, kind: 'numformat', title: 'Numbers stored as text', col: c.name, count: c.formatted, severity: 'low',
      problem: `${c.formatted.toLocaleString('en-US')} values in "${c.name}" include symbols or separators (like ₹, $, %, commas). Clarity reads them correctly, but other tools may not.`,
      options: [{ mode: 'plain', label: 'Convert to plain numbers' }] });
    if (c.type === 'date' && c.nonIsoDates > 0) out.push({ id: 'date:' + c.name, kind: 'datefmt', title: 'Non-standard date format', col: c.name, count: c.nonIsoDates, severity: 'low',
      problem: `"${c.name}" uses ${c.dateOrder === 'mdy' ? 'month-first' : 'day-first'} or written-out dates. Converting to YYYY-MM-DD removes ambiguity when the file is shared.`,
      options: [{ mode: 'iso', label: 'Convert to YYYY-MM-DD' }] });
    if (c.stats && c.stats.outliers > 0) out.push({ id: 'out:' + c.name, kind: 'outlier', title: 'Unusual values', col: c.name, count: c.stats.outliers, severity: c.stats.outliers / c.stats.n > 0.05 ? 'medium' : 'low',
      problem: `${c.stats.outliers.toLocaleString('en-US')} values fall outside the typical range [${fmtPlain(c.stats.lb)} – ${fmtPlain(c.stats.ub)}] (1.5×IQR rule). They may be real extremes, not errors.`,
      options: [{ mode: 'keep', label: 'Keep (acknowledge)', desc: 'Nothing changes' }, { mode: 'cap', label: 'Cap to range', desc: 'Clamp extremes to the range bounds' }, { mode: 'drop', label: 'Drop rows' }] });
  }
  out.sort((a, b) => SEV[a.severity] - SEV[b.severity]);
  return out;
}

function variantExample(c) {
  const groups = new Map();
  for (const [v] of c.top || []) { const k = v.toLowerCase().replace(/\s+/g, ' '); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); }
  for (const g of groups.values()) if (g.length > 1) return g.slice(0, 3).map(x => `"${x}"`).join(', ');
  return 'different spellings';
}

function fmtPlain(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  return n.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 0 : a >= 1 ? 2 : 4 });
}

/* ---------- applying fixes ----------
   Fixes never mutate the previous rows array: changed rows are shallow-copied,
   unchanged rows are shared. Undo is therefore just keeping the old array. */
export function applyFix(ds, prof, issue, mode) {
  const rows = ds.rows, cols = ds.cols, col = issue.col;
  const c = col ? prof.columns.find(x => x.name === col) : null;
  const n = v => v.toLocaleString('en-US');
  let next = rows, nextCols = cols, msg = '', changed = 0;
  const setCol = (fn) => {
    next = rows.map(r => { const v = fn(r[col], r); if (v === undefined) return r; changed++; return { ...r, [col]: v }; });
  };
  switch (issue.kind) {
    case 'duplicates': {
      const seen = new Set();
      next = rows.filter(r => { let k = ''; for (const cc of cols) k += (r[cc] == null ? '' : String(r[cc])) + '\u0001'; if (seen.has(k)) return false; seen.add(k); return true; });
      msg = `Removed ${n(rows.length - next.length)} duplicate rows`;
      break;
    }
    case 'dropcol':
      nextCols = cols.filter(x => x !== col);
      next = rows.map(r => { const o = { ...r }; delete o[col]; return o; });
      msg = `Dropped column "${col}"`;
      break;
    case 'missing': {
      if (mode === 'drop') { next = rows.filter(r => !isMissing(r[col])); msg = `Dropped ${n(rows.length - next.length)} rows with no "${col}"`; break; }
      let fill;
      if (mode === 'median') fill = round6(c.stats.median);
      else if (mode === 'mean') fill = round6(c.stats.mean);
      else if (mode === 'zero') fill = 0;
      else if (mode === 'mode') fill = c.top && c.top[0] ? c.top[0][0] : 'Unknown';
      else fill = 'Unknown';
      setCol(v => (isMissing(v) ? fill : undefined));
      msg = `Filled ${n(changed)} missing "${col}" values with ${mode === 'unknown' ? '"Unknown"' : mode + ' (' + fill + ')'}`;
      break;
    }
    case 'mixed': {
      const bad = c.type === 'numeric' ? v => !isMissing(v) && !Number.isFinite(parseNumber(v)) : v => !isMissing(v) && !Number.isFinite(parseDate(v, c.dateOrder || 'dmy'));
      if (mode === 'drop') { next = rows.filter(r => !bad(r[col])); msg = `Dropped ${n(rows.length - next.length)} rows with unreadable "${col}"`; }
      else { setCol(v => (bad(v) ? '' : undefined)); msg = `Converted ${n(changed)} unreadable "${col}" values to blank`; }
      break;
    }
    case 'labels': {
      const counts = new Map();
      for (const r of rows) { const v = r[col]; if (isMissing(v)) continue; const t = String(v).trim().replace(/\s+/g, ' '); counts.set(t, (counts.get(t) || 0) + 1); }
      const best = new Map();
      for (const [v, cnt] of counts) { const k = v.toLowerCase(); const b = best.get(k); if (!b || cnt > b[1]) best.set(k, [v, cnt]); }
      setCol(v => { if (isMissing(v)) return undefined; const t = String(v).trim().replace(/\s+/g, ' '); const canon = best.get(t.toLowerCase())[0]; return canon === v ? undefined : canon; });
      msg = `Standardised ${n(changed)} labels in "${col}"`;
      break;
    }
    case 'numformat':
      setCol(v => { if (typeof v !== 'string' || isMissing(v)) return undefined; const x = parseNumber(v); return Number.isFinite(x) && String(x) !== v ? x : undefined; });
      msg = `Converted ${n(changed)} formatted values in "${col}" to plain numbers`;
      break;
    case 'datefmt':
      setCol(v => { if (isMissing(v)) return undefined; const t = parseDate(v, c.dateOrder || 'dmy'); if (!Number.isFinite(t)) return undefined; const iso = t % 86400000 ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : isoDate(t); return iso === v ? undefined : iso; });
      msg = `Converted ${n(changed)} dates in "${col}" to YYYY-MM-DD`;
      break;
    case 'outlier': {
      const { lb, ub } = c.stats;
      if (mode === 'cap') { setCol(v => { const x = parseNumber(v); if (!Number.isFinite(x)) return undefined; if (x < lb) return round6(lb); if (x > ub) return round6(ub); return undefined; }); msg = `Capped ${n(changed)} unusual "${col}" values to [${fmtPlain(lb)}, ${fmtPlain(ub)}]`; }
      else if (mode === 'drop') { next = rows.filter(r => { const x = parseNumber(r[col]); return !Number.isFinite(x) || (x >= lb && x <= ub); }); msg = `Dropped ${n(rows.length - next.length)} rows with unusual "${col}"`; }
      else msg = `Reviewed ${n(issue.count)} unusual "${col}" values and kept them`;
      break;
    }
  }
  return { rows: next, cols: nextCols, msg, dataChanged: next !== rows || nextCols !== cols };
}

const round6 = x => Math.round(x * 1e6) / 1e6;

/** Default "safe" fix for one-click cleaning. Outliers are never auto-changed. */
export function defaultMode(issue) {
  if (issue.kind === 'outlier') return null;
  return issue.options[0].mode;
}
