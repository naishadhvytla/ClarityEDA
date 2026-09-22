/* ==========================================================================
   Clarity — story engine
   Turns a dataset + its semantic model into a plain-English, evidence-backed
   report: headline, KPIs, takeaways, category breakdowns, trends, drivers,
   rankings, relationships and recommendations. Pure functions, no DOM.
   ========================================================================== */
import { numericStats, pearson, MONTH_NAMES, MONTH_FULL } from './data.js';
import { fmtMeasure, fmtPct, fmtInt, fmtNumber, fmtDate, unitWord, naturalOrder, plural, prettyLabel, isSensitive, isActionable, comparatives } from './semantics.js';

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b = s => `<b>${esc(s)}</b>`;
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const lc = s => (s && !/^[A-Z0-9&]{2,}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const BLANK = '(blank)';
const isVoid = k => k === BLANK || /^(unknown|n\/a|na|none|other|others|not specified|unspecified|-)$/i.test(String(k).trim());

/** "Total charges" stays as is; "Revenue" → "Total revenue". */
export const totalOf = m => (/^total\b/i.test(m.short) ? m.short : `Total ${lc(m.short)}`);
/** Short keys like "1" or "A" read better with their column name: "Pclass 1", "Section A". */
export const dispKey = (meta, key) => (meta && (/^-?[\d.]+$/.test(String(key)) || String(key).length <= 1) && !isVoid(key) ? `${meta.short || meta.label} ${key}` : String(key));

const singularPhrase = pl => { const p = pl.split(' '); const l = p.pop(); return [...p, l.endsWith('ies') ? l.slice(0, -3) + 'y' : l.endsWith('ses') || l.endsWith('ches') || l.endsWith('shes') ? l.slice(0, -2) : l.endsWith('s') ? l.slice(0, -1) : l].join(' '); };

/** "Payment method" → "payment methods" */
export function pluralPhrase(label) {
  const ofAt = lc(label).indexOf(' of ');
  if (ofAt > 0) { const head = lc(label).slice(0, ofAt).split(' '); const h = head.pop(); return [...head, plural(h)].join(' ') + lc(label).slice(ofAt); }
  const parts = lc(label).split(' ');
  const last = parts.pop();
  if (/^[A-Z]/.test(last) || last.length < 4 || /(ed|ing|ly)$/.test(last) || /\d/.test(last)) return lc(label) + ' values';
  return [...parts, plural(last)].join(' ');
}

/* ==========================================================================
   Aggregation
   ========================================================================== */
const DAY = 86400000;

export function bucketUnit(spanDays) {
  if (spanDays <= 31) return 'day';
  if (spanDays <= 120) return 'week';
  if (spanDays <= 1100) return 'month';
  if (spanDays <= 3660) return 'quarter';
  return 'year';
}
export function bucketStart(t, unit) {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (unit === 'day') return Date.UTC(y, m, d.getUTCDate());
  if (unit === 'week') { const day = (d.getUTCDay() + 6) % 7; return Date.UTC(y, m, d.getUTCDate() - day); }
  if (unit === 'month') return Date.UTC(y, m, 1);
  if (unit === 'quarter') return Date.UTC(y, m - (m % 3), 1);
  return Date.UTC(y, 0, 1);
}
export function bucketNext(t, unit) {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (unit === 'day') return t + DAY;
  if (unit === 'week') return t + 7 * DAY;
  if (unit === 'month') return Date.UTC(y, m + 1, 1);
  if (unit === 'quarter') return Date.UTC(y, m + 3, 1);
  return Date.UTC(y + 1, 0, 1);
}
export function bucketLabel(t, unit, multiYear, long = false) {
  const d = new Date(t);
  const M = (long ? MONTH_FULL : MONTH_NAMES)[d.getUTCMonth()];
  if (unit === 'day' || unit === 'week') return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}${multiYear ? ' ' + d.getUTCFullYear() : ''}`;
  if (unit === 'month') return multiYear ? `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}` : M;
  if (unit === 'quarter') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  return String(d.getUTCFullYear());
}
const UNIT_WORD = { day: 'daily', week: 'weekly', month: 'monthly', quarter: 'quarterly', year: 'yearly' };
const UNIT_NOUN = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year' };

/** Group rows by a key function; accumulate measure/target stats. */
function accumulate(n, keyAt, nums, tv, pos, mask) {
  const map = new Map();
  for (let i = 0; i < n; i++) {
    if (mask && !mask[i]) continue;
    const k = keyAt(i);
    if (k === undefined) continue;
    let g = map.get(k);
    if (!g) { g = { key: k, n: 0, cnt: 0, sum: 0, sq: 0, tn: 0, pos: 0, vals: null }; map.set(k, g); }
    g.n++;
    if (nums) { const x = nums[i]; if (Number.isFinite(x)) { g.cnt++; g.sum += x; g.sq += x * x; } }
    if (tv) { const v = tv[i]; if (v != null) { g.tn++; if (v === pos) g.pos++; } }
  }
  for (const g of map.values()) {
    g.mean = g.cnt ? g.sum / g.cnt : NaN;
    g.rate = g.tn ? g.pos / g.tn : NaN;
  }
  return [...map.values()];
}

/** Value of a group under a metric spec: {kind:'sum'|'mean'|'rate'|'count'|'median'|'min'|'max'} */
const metricOf = (g, kind) => kind === 'sum' ? g.sum : kind === 'mean' ? g.mean : kind === 'rate' ? g.rate : kind === 'count' ? g.n : g[kind];

/**
 * Generic aggregation used by the story and the Explore view.
 * spec: { by, byUnit?, measure?, agg: 'count'|'sum'|'mean'|'median'|'min'|'max'|'rate', split?, filter?: {col, values:Set} }
 */
export function aggregate(ds, model, spec) {
  const n = ds.length;
  const byMeta = model.cols[spec.by];
  const mMeta = spec.measure ? model.cols[spec.measure] : null;
  const nums = mMeta ? ds.num(mMeta.name) : null;
  const tgt = spec.agg === 'rate' ? model.target : null;
  const tv = tgt ? ds.str(tgt.name) : null;
  let mask = null;
  if (spec.filter && spec.filter.col) {
    const fv = ds.str(spec.filter.col);
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = spec.filter.values.has(fv[i] == null ? BLANK : fv[i]) ? 1 : 0;
  }
  let keyAt, isTime = false, unit = null, multiYear = false;
  if (byMeta && byMeta.role === 'date') {
    const ts = ds.date(byMeta.name);
    const d = byMeta.profile.dates;
    unit = spec.byUnit || bucketUnit(d ? d.spanDays : 0);
    multiYear = d && new Date(d.min).getUTCFullYear() !== new Date(d.max).getUTCFullYear();
    keyAt = i => (Number.isFinite(ts[i]) ? bucketStart(ts[i], unit) : undefined);
    isTime = true;
  } else {
    const sv = ds.str(spec.by);
    keyAt = i => (sv[i] == null ? BLANK : sv[i]);
  }
  const kind = spec.agg === 'count' ? 'count' : spec.agg;
  let groups = accumulate(n, keyAt, nums, tv, tgt ? tgt.positive : null, mask);
  if (kind === 'median' || kind === 'min' || kind === 'max') {
    const vals = new Map(groups.map(g => [g.key, []]));
    for (let i = 0; i < n; i++) { if (mask && !mask[i]) continue; const k = keyAt(i); if (k === undefined) continue; const x = nums[i]; if (Number.isFinite(x)) vals.get(k).push(x); }
    for (const g of groups) { const st = numericStats(vals.get(g.key)); g.median = st ? st.median : NaN; g.min = st ? st.min : NaN; g.max = st ? st.max : NaN; }
  }
  const total = groups.reduce((s, g) => s + g.n, 0);
  const valTotal = groups.reduce((s, g) => s + (Number.isFinite(g.sum) ? g.sum : 0), 0);
  for (const g of groups) { g.value = metricOf(g, kind); g.share = total ? g.n / total : 0; g.valShare = valTotal ? g.sum / valTotal : NaN; }

  if (isTime) {
    groups.sort((a, b) => a.key - b.key);
    if (groups.length) {
      const filled = []; const byKey = new Map(groups.map(g => [g.key, g]));
      for (let t = groups[0].key; t <= groups[groups.length - 1].key; t = bucketNext(t, unit)) {
        filled.push(byKey.get(t) || { key: t, n: 0, cnt: 0, sum: 0, tn: 0, pos: 0, mean: NaN, rate: NaN, value: kind === 'sum' || kind === 'count' ? 0 : NaN, share: 0 });
        if (filled.length > 2000) break;
      }
      groups = filled;
    }
    for (const g of groups) g.label = bucketLabel(g.key, unit, multiYear);
  } else {
    const ord = byMeta && (byMeta.sub === 'ordinal' || byMeta.sub === 'year' || byMeta.profile.type === 'numeric') ? naturalOrder(groups.map(g => g.key).filter(k => k !== BLANK)) : null;
    if (ord && spec.sort !== 'value') groups.sort((a, b) => (a.key === BLANK) - (b.key === BLANK) || ord(a.key, b.key));
    else groups.sort((a, b) => (Number.isFinite(b.value) ? b.value : -Infinity) - (Number.isFinite(a.value) ? a.value : -Infinity));
    for (const g of groups) g.label = g.key;
  }

  let series = null;
  if (spec.split && spec.split !== spec.by) {
    const sv = ds.str(spec.split);
    const top = accumulate(n, i => (sv[i] == null ? BLANK : sv[i]), null, null, null, mask).sort((a, b) => b.n - a.n);
    const keep = top.slice(0, 5).map(g => g.key);
    const keepSet = new Set(keep);
    const hasOther = top.length > 5;
    const splitKey = i => (keepSet.has(sv[i] == null ? BLANK : sv[i]) ? (sv[i] == null ? BLANK : sv[i]) : 'Other');
    series = [...keep, ...(hasOther ? ['Other'] : [])].map(name => ({ name, values: [] }));
    const cells = new Map();
    for (let i = 0; i < n; i++) {
      if (mask && !mask[i]) continue;
      const k = keyAt(i); if (k === undefined) continue;
      const s = splitKey(i); const ck = k + '\u0001' + s;
      let c = cells.get(ck); if (!c) { c = { n: 0, cnt: 0, sum: 0, tn: 0, pos: 0 }; cells.set(ck, c); }
      c.n++;
      if (nums) { const x = nums[i]; if (Number.isFinite(x)) { c.cnt++; c.sum += x; } }
      if (tv) { const v = tv[i]; if (v != null) { c.tn++; if (v === tgt.positive) c.pos++; } }
    }
    for (const g of groups) for (const s of series) {
      const c = cells.get(g.key + '\u0001' + s.name);
      const v = !c ? (kind === 'sum' || kind === 'count' ? 0 : NaN) : kind === 'sum' ? c.sum : kind === 'count' ? c.n : kind === 'rate' ? (c.tn ? c.pos / c.tn : NaN) : (c.cnt ? c.sum / c.cnt : NaN);
      s.values.push(v);
    }
  }
  return { groups, isTime, unit, multiYear, kind, total, valTotal, series };
}

/* ==========================================================================
   Story
   ========================================================================== */
/** Which metric leads the story: money totals > outcome rate > averages > counts. */
function headlineKind(pm, tg, model) {
  const transactional = model && model.primaryDate && ['sales', 'finance', 'marketing', 'general'].includes(model.domain.key);
  if (pm && pm.agg === 'sum' && (!tg || transactional)) return 'sum';
  if (tg) return 'rate';
  if (pm && pm.agg === 'sum') return 'sum';
  if (pm) return 'mean';
  return 'count';
}
const CONC_SKIP = /(payment|method|mode|type|status|gender|sex|channel|segment|section)/i;

export function buildStory(ds, prof, model, ctx = {}) {
  const N = ds.length;
  const pm = model.primaryMeasure, tg = model.target, dt = model.primaryDate;
  const F = { findings: [], recs: [], flags: {} };
  const sections = [];

  const tv = tg ? ds.str(tg.name) : null;
  let overallRate = NaN, posN = 0, tN = 0;
  if (tv) { for (const v of tv) if (v != null) { tN++; if (v === tg.positive) posN++; } overallRate = tN ? posN / tN : NaN; }
  const kind = headlineKind(pm, Number.isFinite(overallRate) ? tg : null, model);
  const pmNums = pm ? ds.num(pm.name) : null;
  const pmStats = pm ? numericStats(pmNums) : null;

  /* ---------- rank dimensions ---------- */
  const rankCol = pickRankCol(model, pm);
  const dimCands = model.dims.filter(d => d.profile.unique >= 2 && d.profile.unique <= 500);
  const ranked = dimCands.map(d => rankDim(ds, d, kind, pm, pmNums, pmStats, tg, N)).filter(Boolean).sort((a, b) => b.score - a.score);
  const forSections = ranked.filter(r => r.meta !== rankCol && r.k <= 20);

  const about = aboutText(model, forSections.length ? forSections : ranked, pm, pmStats, tg, overallRate, dt, N, kind);
  const kpis = buildKpis(model, pm, pmStats, tg, overallRate, posN, tN, dt, ranked, N, kind);

  forSections.slice(0, 4).forEach(r => sections.push(breakdownSection(ds, model, r, pm, tg, overallRate, N, F)));
  const rest = forSections.slice(4, 10);
  if (rest.length) sections.push(moreBreakdowns(model, rest, pm, tg));

  if (dt && dt.profile.dates && dt.profile.dates.spanDays >= 14) {
    const tr = trendSection(ds, model, dt, pm, tg, N, F, kind);
    if (tr) sections.push(tr);
    const mv = moversSection(ds, model, dt, forSections, pm, tg, N, F, kind);
    if (mv) sections.push(mv);
  }
  if (tg && Number.isFinite(overallRate)) {
    const dr = driversSection(ds, model, tg, overallRate, N, F);
    if (dr) sections.push(dr);
  }
  const rk = rankingSection(ds, model, pm, rankCol, N, F);
  if (rk) sections.push(rk);
  const ms = measuresSection(ds, model, N, F);
  if (ms) sections.push(ms);
  const rel = relationshipsSection(ds, model, F);
  if (rel) sections.push(rel);
  linkedCategories(ds, model, ranked, N, F);

  if (ctx.quality && ctx.openIssues > 0) {
    F.recs.push({ score: 0.3, link: 'cleaning', html: `Resolve the ${b(ctx.openIssues)} open data-quality ${ctx.openIssues === 1 ? 'issue' : 'issues'} in Cleaning before sharing — the quality score is ${b(ctx.quality.score + '/100')}.` });
  }
  const takeaways = pickTakeaways(F.findings, 6);
  const recs = F.recs.sort((a, b) => b.score - a.score).filter((r, i, arr) => arr.findIndex(x => x.html === r.html) === i).slice(0, 6);
  const nextSteps = [];
  const d1 = forSections[0], d2 = forSections[1];
  if (d1 && d2 && pm) nextSteps.push({ score: 0.1, html: `Check whether the ${esc(lc(d1.meta.label))} pattern holds within each ${esc(lc(d2.meta.label))}: in Explore, group by ${b(d1.meta.label)} and split by ${b(d2.meta.label)}.`, link: 'explore' });
  if (!tg) nextSteps.push({ score: 0.05, html: 'Add an outcome column (for example churned, passed or converted) to see what drives it.' });
  if (!dt) nextSteps.push({ score: 0.04, html: 'Add a date column to track how things change over time.' });
  while (recs.length < 3 && nextSteps.length) recs.push(nextSteps.shift());
  return { title: prettyTitle(ctx.datasetName || 'Dataset'), about, kpis, takeaways, sections, recs, domain: model.domain, noun: model.noun, one: model.nounOne, N, overallRate, kind };
}

export function prettyTitle(fileName) {
  return prettyLabel(String(fileName).replace(/\.[a-z0-9]+$/i, '').replace(/[_\-.]+/g, ' ').trim()) || 'Dataset';
}

function pickRankCol(model, pm) {
  if (model.entity) return model.entity;
  if (pm && pm.agg === 'sum') {
    const hc = model.dims.filter(d => d.profile.unique >= 8 && d.sub !== 'ordinal' && d.sub !== 'year').sort((a, b) => b.profile.unique - a.profile.unique)[0];
    if (hc) return hc;
  }
  if (pm && pm.unit === 'score' && model.domain.key === 'education' && model.ids[0]) return model.ids[0];
  return null;
}

/* ---------- dimension ranking ---------- */
function rankDim(ds, d, kind, pm, pmNums, pmStats, tg, N) {
  const sv = ds.str(d.name);
  const useT = tg && tg.name !== d.name;
  const tv = useT ? ds.str(tg.name) : null;
  const groups = accumulate(N, i => (sv[i] == null ? BLANK : sv[i]), pmNums, tv, useT ? tg.positive : null);
  const real = groups.filter(g => !isVoid(g.key));
  const k = real.length;
  if (k < 2) return null;
  const minN = Math.max(5, Math.ceil(N * 0.02));
  let score = 0, eta = 0, z = 0;
  let rk = kind === 'rate' && !useT ? (pm ? (pm.agg === 'sum' ? 'sum' : 'mean') : 'count') : kind;
  if (rk === 'rate') {
    const ok = real.filter(g => g.tn >= minN);
    if (ok.length >= 2) {
      ok.sort((a, b) => b.rate - a.rate);
      const hi = ok[0], lo = ok[ok.length - 1];
      const p = (hi.pos + lo.pos) / (hi.tn + lo.tn);
      const se = Math.sqrt(p * (1 - p) * (1 / hi.tn + 1 / lo.tn));
      z = se ? (hi.rate - lo.rate) / se : 0;
      score = (hi.rate - lo.rate) * (z >= 2.5 ? 1.6 : z >= 1.8 ? 0.9 : 0.3);
    }
  } else if ((rk === 'sum' || rk === 'mean') && pmStats && pmStats.std > 0) {
    let ssb = 0;
    for (const g of real) if (g.cnt) ssb += g.cnt * (g.mean - pmStats.mean) ** 2;
    eta = ssb / (pmStats.variance * pmStats.n);
    score = eta;
    if (rk === 'sum') { const tot = real.reduce((s, g) => s + g.sum, 0); const top = tot ? Math.max(...real.map(g => g.sum)) / tot : 0; score += 0.4 * Math.max(0, top - 1 / k); }
  } else {
    rk = 'count';
    const tot = real.reduce((s, g) => s + g.n, 0);
    score = 0.3 * Math.max(0, Math.max(...real.map(g => g.n)) / tot - 1 / k) + 0.02;
  }
  if (k > 12) score *= 0.6;
  if (k > 20) score *= 0.5;
  if (d.sub === 'code') score *= 0.8;
  return { meta: d, groups, k, score, kind: rk, eta, z, withRate: useT };
}

/* ---------- about + KPIs ---------- */
function aboutText(model, ranked, pm, pmStats, tg, rate, dt, N, kind) {
  const parts = [];
  let s = model.domain.key === 'general' ? 'This dataset has ' : `This looks like ${b(model.domain.phrase)}: `;
  s += b(fmtInt(N) + ' ' + model.noun);
  if (dt && dt.profile.dates) s += ` from ${b(fmtDate(dt.profile.dates.min))} to ${b(fmtDate(dt.profile.dates.max))}`;
  const dl = ranked.slice(0, 3).map(r => `${b(r.k)} ${esc(r.k === 1 ? lc(r.meta.label) : pluralPhrase(r.meta.label))}`);
  if (dl.length) s += `, across ${dl.length > 1 ? dl.slice(0, -1).join(', ') + ' and ' + dl[dl.length - 1] : dl[0]}`;
  parts.push(s + '.');
  const bits = [];
  if (pm && pmStats && (kind === 'sum' || kind === 'mean')) bits.push(`${b(pm.short)} is the main measure (${pm.agg === 'sum' ? 'total' : 'average'} ${b(fmtMeasure(pm, pm.agg === 'sum' ? pmStats.sum : pmStats.mean, { agg: pm.agg, compact: true }))})`);
  if (tg && Number.isFinite(rate)) bits.push(`${b(tg.short)} is the outcome to explain (${esc(lc(tg.rateLabel))} ${b(fmtPct(rate))})`);
  if (bits.length) parts.push(cap(bits.join(', and ')) + '.');
  return parts.join(' ');
}

function buildKpis(model, pm, pmStats, tg, rate, posN, tN, dt, ranked, N, kind) {
  const k = [{ label: cap(model.noun), value: fmtInt(N), sub: `${Object.keys(model.cols).length} columns` }];
  const addMeasure = m => {
    const st = m.profile.stats; if (!st) return;
    k.push(m.agg === 'sum'
      ? { label: totalOf(m), value: fmtMeasure(m, st.sum, { agg: 'sum', compact: true }), sub: `Avg ${fmtMeasure(m, st.mean, { agg: 'mean', compact: true })} per ${model.nounOne}` }
      : { label: `Average ${lc(m.short)}`, value: fmtMeasure(m, st.mean, { agg: 'mean', withUnit: m.unit === 'duration' || m.unit === 'age' }), sub: `Median ${fmtMeasure(m, st.median, { agg: 'median', withUnit: m.unit === 'duration' || m.unit === 'age' })}` });
  };
  if (kind === 'sum') addMeasure(pm);
  if (tg && Number.isFinite(rate)) k.push({ label: tg.rateLabel, value: fmtPct(rate), sub: `${fmtInt(posN)} of ${fmtInt(tN)} ${model.noun}` });
  if (kind !== 'sum' && pm) addMeasure(pm);
  const second = model.measures.filter(m => m !== pm).sort((a, b) => (b.agg === 'sum') - (a.agg === 'sum') || (b.unit === 'currency') - (a.unit === 'currency'))[0];
  if (k.length < 4 && second) addMeasure(second);
  if (k.length < 4 && dt && dt.profile.dates) {
    const d = dt.profile.dates, a = new Date(d.min), z = new Date(d.max);
    const same = a.getUTCFullYear() === z.getUTCFullYear();
    k.push({ label: 'Period', value: same ? `${MONTH_NAMES[a.getUTCMonth()]}–${MONTH_NAMES[z.getUTCMonth()]} ${z.getUTCFullYear()}` : `${a.getUTCFullYear()}–${z.getUTCFullYear()}`, sub: `${fmtInt(d.spanDays + 1)} days` });
  }
  if (k.length < 4 && ranked[0]) {
    const r = ranked[0];
    const g = r.groups.filter(x => !isVoid(x.key)).sort((a, b) => b.n - a.n)[0];
    if (g) k.push({ label: `Most common ${lc(r.meta.label)}`, value: g.key, sub: `${fmtPct(g.n / N)} of ${model.noun}`, text: true });
  }
  return k.slice(0, 4);
}

/* ---------- breakdown ---------- */
function breakdownSection(ds, model, r, pm, tg, overallRate, N, F) {
  const d = r.meta, noun = model.noun;
  for (const g of r.groups) g.disp = dispKey(d, g.key);
  const dimPl = pluralPhrase(d.label);
  const all = r.groups.filter(g => g.key !== BLANK);
  const real = all.filter(g => !isVoid(g.key));
  const blank = r.groups.find(g => g.key === BLANK);
  const ordered = d.sub === 'ordinal' || d.sub === 'year' || d.profile.type === 'numeric';
  const ordFn = ordered ? naturalOrder(all.map(g => g.key)) : null;
  const sortView = (arr, f) => (ordFn ? arr.slice().sort((a, b) => ordFn(a.key, b.key)) : arr.slice().sort((a, b) => f(b) - f(a)));
  const html = [];
  let chart, head, rows, title;
  const sensitive = isSensitive(d);

  if (r.kind === 'sum') {
    const total = r.groups.reduce((s, g) => s + g.sum, 0);
    const fv = v => fmtMeasure(pm, v, { agg: 'sum', compact: true });
    title = `${pm.short} by ${lc(d.label)}`;
    const s = real.slice().sort((a, b) => b.sum - a.sum), top = s[0], sec = s[1], last = s[s.length - 1];
    const topShare = top.sum / total, topCnt = top.n / N;
    const avgAll = total / Math.max(1, r.groups.reduce((x, g) => x + g.cnt, 0));
    let p = `${b(top.disp)} brings in the most ${esc(lc(pm.short))}: ${b(fv(top.sum))}, or ${b(fmtPct(topShare))} of the total`;
    if (topShare > topCnt * 1.25 && topCnt < 0.6) p += ` — from just ${fmtPct(topCnt)} of ${esc(noun)}, because each is worth more (avg ${esc(fmtMeasure(pm, top.mean, { agg: 'mean', compact: true }))} vs ${esc(fmtMeasure(pm, avgAll, { agg: 'mean', compact: true }))} overall)`;
    p += '.';
    if (sec) p += ` ${b(sec.disp)} follows with ${esc(fv(sec.sum))} (${fmtPct(sec.sum / total)}).`;
    if (s.length > 2) p += ` ${b(last.disp)} contributes the least (${esc(fv(last.sum))}, ${fmtPct(last.sum / total)}).`;
    html.push(p);
    if (s.length >= 5) html.push(`The top 2 of ${s.length} ${esc(dimPl)} account for ${b(fmtPct((s[0].sum + s[1].sum) / total))} of ${esc(lc(pm.short))}.`);
    const perRec = real.slice().sort((a, b) => b.mean - a.mean)[0];
    if (perRec && perRec.key !== top.key && s.length > 2 && perRec.cnt >= 5) html.push(`Per ${esc(model.nounOne)}, ${b(perRec.disp)} is the most valuable (avg ${esc(fmtMeasure(pm, perRec.mean, { agg: 'mean', compact: true }))}).`);
    if (r.withRate) rateSentence(real, tg, overallRate, html, N);
    F.findings.push({ kind: 'share', score: 0.45 + 0.6 * Math.max(0, topShare - 1 / s.length) + r.score * 0.3, icon: 'pie',
      html: `${b(top.disp)} is the largest ${esc(lc(d.label))} by ${esc(lc(pm.short))}: ${b(fmtPct(topShare))} of the total (${esc(fv(top.sum))}).` });
    if (topShare >= 0.4 && s.length >= 3 && !CONC_SKIP.test(d.name) && isActionable(d) && !F.flags.conc) {
      F.flags.conc = true;
      F.recs.push({ score: 0.4 + topShare * 0.3, html: `Reduce reliance on ${b(top.disp)}: it generates ${b(fmtPct(topShare))} of ${esc(lc(pm.short))}, so any dip there moves the whole total.` });
    }
    chart = barSpec(sortView(all, g => g.sum), g => g.sum, fv, { highlight: top.key, sub: g => fmtPct(g.sum / total) });
    head = [d.label, cap(noun), '% of ' + noun, totalOf(pm), '% of total', `Avg per ${model.nounOne}`];
    rows = all.slice().sort((a, b) => b.sum - a.sum).map(g => [g.key, fmtInt(g.n), fmtPct(g.n / N), fmtMeasure(pm, g.sum, { agg: 'sum' }), fmtPct(g.sum / total), fmtMeasure(pm, g.mean, { agg: 'mean' })]);
  } else if (r.kind === 'mean') {
    title = `Average ${lc(pm.short)} by ${lc(d.label)}`;
    const ok = real.filter(g => g.cnt >= 3);
    const s = ok.slice().sort((a, b) => b.mean - a.mean), top = s[0], last = s[s.length - 1];
    const overall = pm.profile.stats.mean;
    const fv = v => fmtMeasure(pm, v, { agg: 'mean' });
    const diff = top.mean - last.mean;
    const uw = unitWord(pm);
    let p = `Average ${esc(lc(pm.short))} is highest for ${b(top.disp)} (${b(fv(top.mean))}) and lowest for ${b(last.disp)} (${b(fv(last.mean))}), against ${esc(fv(overall))} overall`;
    if (last.mean > 0 && pm.unit !== 'percent') p += ` — a gap of ${esc(fmtMeasure(pm, diff, { agg: 'mean' }))}${uw ? ' ' + esc(uw) : ''} (${fmtPct(diff / Math.abs(last.mean))})`;
    else if (pm.unit === 'percent') p += ` — a gap of ${fmtNumber(diff * (pm.fraction ? 100 : 1), 1)} percentage points`;
    html.push(p + '.');
    if (r.eta < 0.02) html.push(`These differences are small: ${esc(lc(d.label))} explains little of the variation in ${esc(lc(pm.short))}.`);
    else html.push(`${cap(esc(lc(d.label)))} explains about ${b(fmtPct(r.eta))} of the variation in ${esc(lc(pm.short))}${r.eta >= 0.14 ? ' — a large effect' : r.eta >= 0.06 ? ' — a medium effect' : ' — a modest effect'}.`);
    F.findings.push({ kind: 'gap', score: 0.3 + Math.min(0.8, r.eta * 3), icon: 'bars',
      html: `${esc(d.label)}: ${b(top.disp)} leads on ${esc(lc(pm.short))} (avg ${esc(fv(top.mean))}); ${b(last.disp)} trails (${esc(fv(last.mean))}).` });
    if (r.eta >= 0.04 && s.length >= 2 && !sensitive && isActionable(d) && model.domain.key !== 'general') F.recs.push({ score: 0.35 + r.eta, html: `Learn from ${b(top.disp)}: its average ${esc(lc(pm.short))} is ${b(fmtPct(diff / Math.abs(last.mean || 1)))} higher than ${b(last.disp)}'s.` });
    chart = barSpec(sortView(all.filter(g => g.cnt >= 3), g => g.mean), g => g.mean, fv, { highlight: top.key, ref: { value: overall, label: 'Overall avg' } });
    head = [d.label, cap(noun), `Avg ${lc(pm.short)}`, 'vs overall'];
    rows = all.filter(g => g.cnt).sort((a, b) => b.mean - a.mean).map(g => [g.key, fmtInt(g.n), fv(g.mean), (g.mean >= overall ? '+' : '−') + fmtPct(Math.abs(g.mean - overall) / Math.abs(overall || 1))]);
  } else if (r.kind === 'rate') {
    title = `${tg.rateLabel} by ${lc(d.label)}`;
    const minN = Math.max(5, Math.ceil(N * 0.02));
    const ok = real.filter(g => g.tn >= minN);
    const pool = ok.length >= 2 ? ok : real;
    const s = pool.slice().sort((a, b) => b.rate - a.rate), top = s[0], last = s[s.length - 1];
    let p = `${esc(tg.rateLabel)} is highest for ${b(top.disp)} (${b(fmtPct(top.rate))}) and lowest for ${b(last.disp)} (${b(fmtPct(last.rate))}), against ${b(fmtPct(overallRate))} overall.`;
    if (last.rate > 0 && top.rate / last.rate >= 1.3) p += ` That's ${b((top.rate / last.rate).toFixed(1) + '×')} the rate.`;
    html.push(p);
    const strong = r.z >= 1.8;
    if (!strong) html.push(`<span class="muted">With these group sizes the gap could be chance (z = ${r.z.toFixed(1)}); treat it as a lead, not a conclusion.</span>`);
    F.findings.push({ kind: 'rate', score: strong ? 0.35 + (top.rate - last.rate) * 2 : 0.15 + (top.rate - last.rate) * 0.5, icon: 'target',
      html: `${esc(tg.rateLabel)} ranges from ${b(fmtPct(last.rate))} (${esc(last.disp)}) to ${b(fmtPct(top.rate))} (${esc(top.disp)}) across ${esc(dimPl)}.` });
    if (strong && !sensitive) rateRec(F, tg, top, last, overallRate, noun);
    chart = barSpec(sortView(all.filter(g => g.tn), g => g.rate), g => g.rate, v => fmtPct(v), { highlight: tg.good === true ? last.key : top.key, ref: { value: overallRate, label: 'Overall' }, max: 1 });
    head = [d.label, cap(noun), tg.rateLabel, 'vs overall'];
    rows = all.filter(g => g.tn).sort((a, b) => b.rate - a.rate).map(g => [g.key, fmtInt(g.tn), fmtPct(g.rate), (g.rate >= overallRate ? '+' : '−') + fmtNumber(Math.abs(g.rate - overallRate) * 100, 1) + ' pts']);
  } else {
    title = `${cap(noun)} by ${lc(d.label)}`;
    const s = real.slice().sort((a, b) => b.n - a.n), top = s[0], sec = s[1], last = s[s.length - 1];
    let p = `${b(top.disp)} is the most common ${esc(lc(d.label))} (${b(fmtPct(top.n / N))} of ${esc(noun)})`;
    if (sec) p += `, followed by ${b(sec.disp)} (${fmtPct(sec.n / N)})`;
    p += '.';
    if (s.length > 2) p += ` ${b(last.disp)} is the least common (${fmtPct(last.n / N)}).`;
    html.push(p);
    const topShare = top.n / N;
    F.findings.push({ kind: 'mix', score: 0.2 + Math.max(0, topShare - 1 / s.length), icon: 'pie', html: `${b(fmtPct(topShare))} of ${esc(noun)} are ${b(top.disp)}, the most common ${esc(lc(d.label))}.` });
    chart = barSpec(sortView(all, g => g.n), g => g.n, v => fmtInt(v), { highlight: top.key, sub: g => fmtPct(g.n / N) });
    head = [d.label, cap(noun), '% of ' + noun];
    rows = all.slice().sort((a, b) => b.n - a.n).map(g => [g.key, fmtInt(g.n), fmtPct(g.n / N)]);
  }
  if (sensitive) F.findings.forEach(f => { if (!f.scaled && f.html.includes(esc(lc(d.label)))) { f.score *= 0.7; f.scaled = true; } });
  if (blank && blank.n / N >= 0.005) html.push(`<span class="muted">${fmtInt(blank.n)} ${esc(noun)} (${fmtPct(blank.n / N)}) have no ${esc(lc(d.label))} and are left out of this breakdown.</span>`);
  return { id: 'dim-' + slug(d.name), kind: 'breakdown', title, eyebrow: 'Breakdown', col: d.name, html, chart, table: { head, rows } };
}

function rateSentence(real, tg, overallRate, html, N) {
  const ok = real.filter(g => g.tn >= Math.max(5, N * 0.02));
  if (ok.length < 2) return;
  const s = ok.slice().sort((a, b) => b.rate - a.rate);
  if (s[0].rate - s[s.length - 1].rate < 0.05) return;
  html.push(`${esc(tg.rateLabel)} is highest for ${b(s[0].disp)} (${fmtPct(s[0].rate)}) and lowest for ${b(s[s.length - 1].disp)} (${fmtPct(s[s.length - 1].rate)}), vs ${fmtPct(overallRate)} overall.`);
}

function rateRec(F, tg, top, last, overallRate, noun) {
  if (tg.good === true && last.rate < overallRate) F.recs.push({ score: 0.55 + (overallRate - last.rate), html: `Support ${b(last.disp)} ${esc(noun)}: ${esc(lc(tg.rateLabel))} is only ${b(fmtPct(last.rate))} vs ${fmtPct(overallRate)} overall.` });
  else if (tg.good === false && top.rate > overallRate) F.recs.push({ score: 0.55 + (top.rate - overallRate), html: `Prioritise ${b(top.disp)} ${esc(noun)}: ${esc(lc(tg.rateLabel))} is ${b(fmtPct(top.rate))} vs ${fmtPct(overallRate)} overall.` });
  else if (tg.good == null) F.recs.push({ score: 0.45, html: `Look into ${b(top.disp)}: ${esc(lc(tg.rateLabel))} is ${b(fmtPct(top.rate))} vs ${fmtPct(overallRate)} overall.` });
}

function moreBreakdowns(model, list, pm, tg) {
  const items = list.map(r => {
    const all = r.groups.filter(g => g.key !== BLANK);
    const val = r.kind === 'sum' ? g => g.sum : r.kind === 'mean' ? g => g.mean : r.kind === 'rate' ? g => g.rate : g => g.n;
    const fmtv = r.kind === 'sum' ? v => fmtMeasure(pm, v, { agg: 'sum', compact: true }) : r.kind === 'mean' ? v => fmtMeasure(pm, v, { agg: 'mean' }) : r.kind === 'rate' ? v => fmtPct(v) : v => fmtInt(v);
    const s = all.filter(g => Number.isFinite(val(g))).sort((a, b) => val(b) - val(a)).slice(0, 8);
    const metric = r.kind === 'sum' ? totalOf(pm) : r.kind === 'mean' ? `Avg ${lc(pm.short)}` : r.kind === 'rate' ? tg.rateLabel : cap(model.noun);
    const first = s.find(g => !isVoid(g.key)) || s[0];
    return { title: `${metric} by ${lc(r.meta.label)}`, col: r.meta.name, chart: barSpec(s, val, fmtv, { highlight: first && first.key, compact: true, max: r.kind === 'rate' ? 1 : undefined }), note: first ? `Highest: ${first.key} (${fmtv(val(first))})` : '' };
  });
  return { id: 'more-breakdowns', kind: 'grid', title: 'More breakdowns', eyebrow: 'Breakdown', html: [`Other ways to slice the ${esc(model.noun)}, ranked by how much they explain.`], items };
}

/* ---------- trend ---------- */
function trendSection(ds, model, dt, pm, tg, N, F, kind) {
  const d = dt.profile.dates;
  const ORDER = ['day', 'week', 'month', 'quarter', 'year'];
  let unit = bucketUnit(d.spanDays);
  const need = kind === 'rate' || kind === 'mean' ? 30 : 8;
  const buckets = u => Math.max(1, d.spanDays / { day: 1, week: 7, month: 30.4, quarter: 91.3, year: 365 }[u]);
  while (ORDER.indexOf(unit) < 4 && N / buckets(unit) < need && buckets(ORDER[ORDER.indexOf(unit) + 1]) >= 3) unit = ORDER[ORDER.indexOf(unit) + 1];
  const agg = aggregate(ds, model, { by: dt.name, byUnit: unit, measure: pm && kind !== 'rate' && kind !== 'count' ? pm.name : null, agg: kind });
  const g = agg.groups;
  if (g.length < 3) return null;
  const additive = kind === 'sum' || kind === 'count';
  const cov = (gg, isLast) => { const s = gg.key, e = bucketNext(s, unit); return isLast ? Math.min(1, (d.max - s + DAY) / (e - s)) : Math.min(1, (e - d.min) / (e - s)); };
  const notes = [];
  let use = g.slice();
  const lblL = x => bucketLabel(x.key, unit, agg.multiYear, true);
  if (additive && cov(use[use.length - 1], true) < 0.6) { notes.push(`${lblL(use[use.length - 1])} is only partly covered (data ends ${fmtDate(d.max)}), so it's left out of the comparison.`); use = use.slice(0, -1); }
  if (additive && use.length > 3 && cov(use[0], false) < 0.6) { notes.push(`${lblL(use[0])} is only partly covered (data starts ${fmtDate(d.min)}), so it's left out too.`); use = use.slice(1); }
  if (!additive) use = use.filter(x => (kind === 'rate' ? x.tn : x.cnt) >= 5);
  if (use.length < 3) return null;
  const vals = use.map(x => x.value);
  const first = use[0], last = use[use.length - 1];
  const peak = use.reduce((a, x) => (x.value > a.value ? x : a)), low = use.reduce((a, x) => (x.value < a.value ? x : a));
  const metricName = kind === 'sum' ? `${UNIT_WORD[unit]} ${lc(pm.short)}` : kind === 'mean' ? `average ${lc(pm.short)}` : kind === 'rate' ? lc(tg.rateLabel) : `${model.noun} per ${UNIT_NOUN[unit]}`;
  const fv = v => (kind === 'rate' ? fmtPct(v) : kind === 'count' ? fmtInt(v) : fmtMeasure(pm, v, { agg: kind, compact: true }));
  const n = vals.length, mx = (n - 1) / 2, my = vals.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (i - mx) * (vals[i] - my); sxx += (i - mx) ** 2; syy += (vals[i] - my) ** 2; }
  const slope = sxx ? sxy / sxx : 0, r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  const perPeriod = my ? slope / Math.abs(my) : 0;
  const html = [];
  let change;
  if (kind === 'rate') {
    change = last.value - first.value;
    html.push(`${cap(esc(metricName))} moved from ${b(fv(first.value))} in ${b(lblL(first))} to ${b(fv(last.value))} in ${b(lblL(last))} (${change >= 0 ? '+' : '−'}${fmtNumber(Math.abs(change) * 100, 1)} pts).`);
  } else {
    change = first.value ? (last.value - first.value) / Math.abs(first.value) : NaN;
    const dir = !Number.isFinite(change) ? 'changed' : Math.abs(change) < 0.03 ? 'held steady' : change > 0 ? 'rose' : 'fell';
    html.push(`${cap(esc(metricName))} ${dir}${Number.isFinite(change) && Math.abs(change) >= 0.03 ? ' ' + b(fmtPct(Math.abs(change))) : ''} from ${b(lblL(first))} (${esc(fv(first.value))}) to ${b(lblL(last))} (${esc(fv(last.value))}).`);
  }
  if (peak !== last || low !== first) html.push(kind === 'rate' || kind === 'mean'
    ? `It was highest in ${b(lblL(peak))} (${esc(fv(peak.value))}) and lowest in ${b(lblL(low))} (${esc(fv(low.value))}).`
    : `The strongest ${UNIT_NOUN[unit]} was ${b(lblL(peak))} (${esc(fv(peak.value))}); the weakest was ${b(lblL(low))} (${esc(fv(low.value))}).`);
  const trendWord = r2 >= 0.5 ? (slope > 0 ? 'a steady upward trend' : 'a steady downward trend') : r2 >= 0.2 ? (slope > 0 ? 'a mild upward trend' : 'a mild downward trend') : 'no clear direction';
  const cv = Math.sqrt(syy / n) / Math.abs(my || 1);
  html.push(`Overall that's ${trendWord}${r2 >= 0.2 ? ` (about ${slope >= 0 ? '+' : '−'}${kind === 'rate' ? fmtNumber(Math.abs(slope) * 100, 1) + ' pts' : fmtPct(Math.abs(perPeriod))} per ${UNIT_NOUN[unit]})` : ''}${cv > 0.3 && kind !== 'rate' ? `, with sizeable swings from one ${UNIT_NOUN[unit]} to the next` : ''}.`);
  notes.forEach(t => html.push(`<span class="muted">${esc(t)}</span>`));
  const mag = kind === 'rate' ? Math.abs(change) * 3 : Math.abs(change || 0);
  F.findings.push({ kind: 'trend', score: 0.35 + Math.min(0.6, mag) * (r2 >= 0.2 ? 1 : 0.5), icon: kind === 'rate' ? rateIcon(change, tg) : (change || 0) >= 0 ? 'up' : 'down',
    html: kind === 'rate'
      ? `${esc(cap(metricName))} went from ${b(fv(first.value))} to ${b(fv(last.value))} between ${esc(lblL(first))} and ${esc(lblL(last))}.`
      : Math.abs(change || 0) < 0.03 ? `${esc(cap(metricName))} held steady between ${esc(lblL(first))} and ${esc(lblL(last))}.`
      : `${esc(cap(metricName))} ${change >= 0 ? 'grew' : 'declined'} ${b(fmtPct(Math.abs(change || 0)))} from ${esc(lblL(first))} to ${esc(lblL(last))}${peak !== last && peak !== first ? `, peaking in ${b(lblL(peak))}` : ''}.` });
  if (kind !== 'rate' && Number.isFinite(change) && change <= -0.1 && r2 >= 0.2) F.recs.push({ score: 0.6 + Math.min(0.3, -change), html: `${esc(cap(metricName))} is trending down (${b('−' + fmtPct(-change))} since ${esc(lblL(first))}). Check which segments drive the drop in “What's changing”.` });
  if (kind === 'rate' && tg.good === false && change >= 0.05) F.recs.push({ score: 0.6, html: `${esc(tg.rateLabel)} is rising (${b('+' + fmtNumber(change * 100, 1) + ' pts')} since ${esc(lblL(first))}) — find out what changed.` });

  // day-of-week pattern
  if (unit !== 'quarter' && unit !== 'year' && d.spanDays <= 800 && !d.hasTime) {
    const ts = ds.date(dt.name); const cnt = new Array(7).fill(0);
    let tot = 0; for (const t of ts) if (Number.isFinite(t)) { cnt[(new Date(t).getUTCDay() + 6) % 7]++; tot++; }
    const mx2 = Math.max(...cnt), mn2 = Math.min(...cnt);
    if (tot >= 150 && mn2 > 0 && mx2 / mn2 >= 1.35) {
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const bi = cnt.indexOf(mx2), li = cnt.indexOf(mn2);
      html.push(`${b(days[bi] + 's')} are the busiest day (${fmtPct(mx2 / tot)} of ${esc(model.noun)}); ${b(days[li] + 's')} are the quietest (${fmtPct(mn2 / tot)}).`);
      F.findings.push({ kind: 'weekday', score: 0.2 + Math.min(0.25, (mx2 / mn2 - 1) / 3), icon: 'calendar', html: `${b(days[bi] + 's')} are the busiest day of the week (${fmtPct(mx2 / tot)} of ${esc(model.noun)}).` });
    }
  }
  const title = kind === 'rate' ? `${tg.rateLabel} over time` : kind === 'count' ? `${cap(model.noun)} over time` : kind === 'sum' ? `${pm.short} over time` : `Average ${lc(pm.short)} over time`;
  const chart = { type: 'line', x: g.map(x => x.label), series: [{ name: title, values: g.map(x => (additive ? x.value : ((kind === 'rate' ? x.tn : x.cnt) >= 5 ? x.value : NaN))) }], fmt: fv, fmtAxis: v => (kind === 'rate' ? fmtPct(v, 0) : kind === 'count' ? fmtInt(v) : fmtMeasure(pm, v, { agg: kind, compact: true })), yMin: kind === 'rate' || additive ? 0 : undefined, area: true };
  const table = { head: [cap(UNIT_NOUN[unit]), cap(model.noun), title], rows: g.map(x => [lblL(x), fmtInt(x.n), fv(x.value)]) };
  return { id: 'trend', kind: 'trend', eyebrow: 'Over time', title, subtitle: `${cap(UNIT_WORD[unit])}, ${fmtDate(d.min)} – ${fmtDate(d.max)}`, html, chart, table };
}

/** Arrow follows the direction; colour follows whether that direction is good for this outcome. */
const rateIcon = (ch, tg) => (ch >= 0 ? (tg.good === false ? 'upbad' : 'up') : (tg.good === false ? 'downgood' : 'down'));

/* ---------- movers ---------- */
function halfLabel(a, z) {
  const A = new Date(a), Z = new Date(z);
  const sameY = A.getUTCFullYear() === Z.getUTCFullYear();
  if (sameY && A.getUTCMonth() === Z.getUTCMonth()) return `${MONTH_NAMES[A.getUTCMonth()]} ${Z.getUTCFullYear()}`;
  return `${MONTH_NAMES[A.getUTCMonth()]}${sameY ? '' : ' ' + A.getUTCFullYear()}–${MONTH_NAMES[Z.getUTCMonth()]} ${Z.getUTCFullYear()}`;
}

function moversSection(ds, model, dt, ranked, pm, tg, N, F, kind) {
  const d = dt.profile.dates;
  if (d.spanDays < 28) return null;
  const ts = ds.date(dt.name);
  const rawMid = (d.min + d.max) / 2;
  let mid = bucketStart(rawMid, 'day');
  if (d.spanDays >= 90) { const a = bucketStart(rawMid, 'month'), z = bucketNext(a, 'month'); mid = rawMid - a < z - rawMid ? a : z; }
  const nums = pm && (kind === 'sum' || kind === 'mean') ? ds.num(pm.name) : null;
  const tv = kind === 'rate' ? ds.str(tg.name) : null;
  const minN = Math.max(8, Math.ceil(N * 0.01));
  let best = null;
  ranked.slice(0, 4).forEach((r, ri) => {
    if (r.k < 2 || r.k > 12 || (kind === 'rate' && r.meta.name === tg.name)) return;
    const sv = ds.str(r.meta.name);
    const key = half => i => (Number.isFinite(ts[i]) && (half ? ts[i] >= mid : ts[i] < mid) && sv[i] != null && !isVoid(sv[i]) ? sv[i] : undefined);
    const h1 = accumulate(N, key(0), nums, tv, tg && tg.positive), h2 = accumulate(N, key(1), nums, tv, tg && tg.positive);
    const m2 = new Map(h2.map(g => [g.key, g]));
    const rows = [];
    for (const a of h1) {
      const z = m2.get(a.key); if (!z || a.n < minN || z.n < minN) continue;
      const va = metricOf(a, kind), vz = metricOf(z, kind);
      if (!Number.isFinite(va) || !Number.isFinite(vz)) continue;
      const ch = kind === 'rate' ? vz - va : va ? (vz - va) / Math.abs(va) : NaN;
      if (Number.isFinite(ch)) rows.push({ key: a.key, disp: dispKey(r.meta, a.key), va, vz, ch, delta: vz - va, weight: a.n + z.n });
    }
    if (rows.length < 2) return;
    const t1 = rows.reduce((s, x) => s + x.va, 0), t2 = rows.reduce((s, x) => s + x.vz, 0);
    let score;
    if (kind === 'sum' || kind === 'count') {
      for (const x of rows) { x.s1 = t1 ? x.va / t1 : 0; x.s2 = t2 ? x.vz / t2 : 0; x.shift = x.s2 - x.s1; }
      score = Math.max(...rows.map(x => Math.abs(x.shift)));
    }
    else { const W = rows.reduce((s, x) => s + x.weight, 0); score = Math.max(...rows.map(x => Math.abs(x.ch) * Math.sqrt(x.weight / W))); }
    score *= 1 - 0.12 * ri;
    if (!best || score > best.score) best = { r, rows, score, t1, t2 };
  });
  const thr = kind === 'sum' || kind === 'count' ? 0.03 : kind === 'rate' ? 0.03 : 0.05;
  if (!best || best.score < thr) return null;
  const { r, rows, t1, t2 } = best;
  const additive = kind === 'sum' || kind === 'count';
  const sorted = rows.slice().sort((a, b) => (additive ? b.shift - a.shift : b.ch - a.ch));
  const up = sorted[0], down = sorted[sorted.length - 1];
  const p1 = halfLabel(d.min, mid - DAY), p2 = halfLabel(mid, d.max);
  const fv = v => (kind === 'rate' ? fmtPct(v) : kind === 'count' ? fmtInt(v) : fmtMeasure(pm, v, { agg: kind, compact: true }));
  const fch = x => (kind === 'rate' ? `${x >= 0 ? '+' : '−'}${fmtNumber(Math.abs(x) * 100, 1)} pts` : `${x >= 0 ? '+' : '−'}${fmtPct(Math.abs(x))}`);
  const fdelta = x => `${x >= 0 ? '+' : '−'}${fv(Math.abs(x))}`;
  const metric = kind === 'sum' ? lc(pm.short) : kind === 'mean' ? 'average ' + lc(pm.short) : kind === 'rate' ? lc(tg.rateLabel) : model.noun;
  const dimL = lc(r.meta.label);
  const html = [];
  if (additive) {
    const oc = t1 ? (t2 - t1) / t1 : 0;
    const ocTxt = Math.abs(oc) < 0.03 ? 'held roughly steady' : oc > 0 ? 'rose ' + b(fmtPct(oc)) : 'fell ' + b(fmtPct(-oc));
    html.push(`From ${esc(p1)} to ${esc(p2)}, ${esc(metric)} ${ocTxt} overall (${esc(fv(t1))} → ${esc(fv(t2))}).`);
    const verb = x => (Math.abs(x.ch) < 0.03 ? 'held steady' : x.ch > 0 ? `grew ${b(fmtPct(x.ch))}` : `fell ${b(fmtPct(-x.ch))}`);
    if (up.shift > 0.005) html.push(`${b(up.disp)} did best: it ${verb(up)} (${esc(fdelta(up.delta))}), lifting its share from ${fmtPct(up.s1)} to ${b(fmtPct(up.s2))}.`);
    if (down.shift < -0.005) html.push(`${b(down.disp)} ${up.shift > 0.005 ? 'lagged' : 'did worst'}: it ${verb(down)} (${esc(fdelta(down.delta))}), and its share slipped from ${fmtPct(down.s1)} to ${b(fmtPct(down.s2))}.`);
    const netDelta = t2 - t1;
    const driver = rows.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    if (Math.abs(oc) >= 0.05 && Math.sign(driver.delta) === Math.sign(netDelta) && Math.abs(driver.delta / netDelta) >= 0.5) html.push(`${b(driver.disp)} alone accounts for ${Math.abs(driver.delta / netDelta) >= 1 ? 'more than all' : 'most'} of the overall ${netDelta > 0 ? 'increase' : 'drop'}.`);
  } else {
    html.push(`Comparing ${esc(p1)} with ${esc(p2)}:`);
    const bits = [];
    const mv = (x, w) => `${b(x.disp)} ${w} the most (${esc(fv(x.va))} → ${b(fv(x.vz))}, ${fch(x.ch)})`;
    const good = kind === 'rate' ? tg.good : null;
    if (up.ch > 0) bits.push(mv(up, good === false ? 'worsened' : good === true ? 'improved' : 'rose'));
    if (down.ch < 0) bits.push(mv(down, good === false ? 'improved' : good === true ? 'worsened' : 'fell'));
    html.push(cap(bits.join(', while ') || `every ${esc(dimL)} moved the same way`) + '.');
  }
  const bigUp = additive ? up.shift >= 0.03 && up.ch > 0.05 : up.ch >= thr;
  const bigDown = additive ? down.shift <= -0.03 && down.ch < -0.05 : down.ch <= -thr;
  if (kind === 'rate') {
    const worse = tg.good === true ? down : up, better = tg.good === true ? up : down;
    const verb = x => (tg.good == null ? (x.ch > 0 ? 'is rising' : 'is falling') : x === worse ? 'is getting worse' : 'is improving');
    if (bigUp || bigDown) {
      const x = Math.abs(up.ch) >= Math.abs(down.ch) ? up : down;
      F.findings.push({ kind: 'mover', score: 0.45 + Math.min(0.4, Math.abs(x.ch) * 3), icon: rateIcon(x.ch, tg), html: `${esc(cap(metric))} for ${b(x.disp)} ${verb(x)}: ${b(fch(x.ch))} in ${esc(p2)} vs ${esc(p1)}.` });
    }
    void better;
  } else {
    if (bigDown) F.findings.push({ kind: 'mover', score: 0.55 + Math.min(0.45, best.score * 2), icon: 'down', html: `${b(down.disp)} is losing ground: ${esc(metric)} ${b(fch(down.ch))} in ${esc(p2)} vs ${esc(p1)}.` });
    if (bigUp) F.findings.push({ kind: 'mover', score: 0.5 + Math.min(0.45, best.score * 2), icon: 'up', html: `${b(up.disp)} is the fastest-growing ${esc(dimL)}: ${esc(metric)} ${b(fch(up.ch))} in ${esc(p2)} vs ${esc(p1)}.` });
  }
  if (kind !== 'rate') {
    if (bigDown) F.recs.push({ score: 0.7, html: `Investigate ${b(down.disp)}: ${esc(metric)} ${additive ? 'dropped ' + b(fv(-down.delta)) + ' (' + fch(down.ch) + ')' : 'fell ' + b(fch(down.ch))} between ${esc(p1)} and ${esc(p2)}.` });
    if (bigUp) F.recs.push({ score: 0.5, html: `Build on ${b(up.disp)}: ${esc(metric)} grew ${b(fmtPct(Math.abs(up.ch)))} between ${esc(p1)} and ${esc(p2)}.` });
  } else if (tg.good === false && up.ch >= thr && !isSensitive(r.meta)) F.recs.push({ score: 0.6, html: `Watch ${b(up.disp)}: ${esc(metric)} rose ${b(fch(up.ch))} between ${esc(p1)} and ${esc(p2)}.` });
  else if (tg.good === true && down.ch <= -thr && !isSensitive(r.meta)) F.recs.push({ score: 0.6, html: `Watch ${b(down.disp)}: ${esc(metric)} fell ${b(fch(down.ch))} between ${esc(p1)} and ${esc(p2)}.` });

  const topKeys = rows.slice().sort((a, b) => b.weight - a.weight).slice(0, 5).map(x => x.key);
  const agg = aggregate(ds, model, { by: dt.name, measure: nums ? pm.name : null, agg: kind, split: r.meta.name });
  const series = agg.series ? topKeys.map(k => agg.series.find(s => s.name === k)).filter(Boolean) : [];
  const chart = series.length >= 2 ? { type: 'line', x: agg.groups.map(g => g.label), series, fmt: fv, fmtAxis: fv, legend: true, yMin: additive || kind === 'rate' ? 0 : undefined } : null;
  const table = { head: [r.meta.label, p1, p2, 'Change'], rows: sorted.map(x => [x.key, fv(x.va), fv(x.vz), additive ? `${fdelta(x.delta)} (${fch(x.ch)})` : fch(x.ch)]) };
  return { id: 'movers', kind: 'movers', eyebrow: 'Over time', title: `What's changing by ${dimL}`, subtitle: `${cap(metric)}, ${p1} vs ${p2}`, html, chart, table };
}

/* ---------- outcome drivers ---------- */
function driversSection(ds, model, tg, overallRate, N, F) {
  const tv = ds.str(tg.name);
  const res = [];
  for (const m of model.measures) {
    const x = ds.num(m.name);
    let n1 = 0, s1 = 0, q1 = 0, n0 = 0, s0 = 0, q0 = 0;
    for (let i = 0; i < N; i++) {
      const v = x[i], t = tv[i];
      if (!Number.isFinite(v) || t == null) continue;
      if (t === tg.positive) { n1++; s1 += v; q1 += v * v; } else { n0++; s0 += v; q0 += v * v; }
    }
    if (n1 < 5 || n0 < 5) continue;
    const m1 = s1 / n1, m0 = s0 / n0;
    const v1 = Math.max(0, q1 / n1 - m1 * m1), v0 = Math.max(0, q0 / n0 - m0 * m0);
    const sd = Math.sqrt(((n1 - 1) * v1 + (n0 - 1) * v0) / (n1 + n0 - 2));
    res.push({ m, m1, m0, d: sd ? (m1 - m0) / sd : 0, n1, n0 });
  }
  res.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const strong = res.filter(r => Math.abs(r.d) >= 0.2);
  if (!strong.length) return null;
  const noun = model.noun;
  const html = [];
  const fu = (m, v) => fmtMeasure(m, v, { agg: 'mean', withUnit: true });
  strong.slice(0, 3).forEach((r, i) => {
    const [more, less] = comparatives(r.m);
    const rel = r.m0 ? (r.m1 - r.m0) / Math.abs(r.m0) : NaN;
    const cmp = r.m1 > r.m0 ? more : less;
    const lead = i === 0 ? `${cap(esc(noun))} who ${esc(tg.posLabel)} had` : 'They also had';
    html.push(`${lead} ${cmp} ${esc(lc(r.m.short))}: ${b(fu(r.m, r.m1))} on average vs ${b(fu(r.m, r.m0))} for those who ${esc(tg.negLabel)}${Number.isFinite(rel) && r.m.unit !== 'percent' && Math.abs(rel) < 20 ? ` (${r.m1 > r.m0 ? '+' : '−'}${fmtPct(Math.abs(rel))})` : ''}.`);
  });
  const top = strong[0];
  const bands = rateBands(ds, top.m, tg, N);
  let chart2 = null;
  if (bands && bands.length >= 2) {
    const lo = bands[0], hi = bands[bands.length - 1];
    const phr = bd => (top.m.unit === 'count' ? `${esc(noun)} with ${esc(bd.phrase)} ${esc(lc(top.m.short))}` : `${esc(noun)} with ${esc(lc(top.m.short))} ${esc(bd.phrase)}`);
    if (Math.abs(hi.rate - lo.rate) >= 0.03) html.push(`${esc(tg.rateLabel)} ${hi.rate > lo.rate ? 'climbs' : 'drops'} from ${b(fmtPct(lo.rate))} for ${phr(lo)} to ${b(fmtPct(hi.rate))} for ${phr(hi)}.`);
    chart2 = { type: 'column', title: `${tg.rateLabel} by ${lc(top.m.short)}`, data: bands.map(bd => ({ label: bd.label, value: bd.rate, text: fmtPct(bd.rate), n: bd.n })), fmt: v => fmtPct(v), ref: { value: overallRate, label: 'Overall' }, max: 1 };
    const worst = tg.good === true ? (hi.rate < lo.rate ? hi : lo) : (hi.rate > lo.rate ? hi : lo);
    const gap = Math.abs(worst.rate - overallRate);
    if (gap >= 0.04) {
      if (tg.good === true) F.recs.push({ score: 0.6 + Math.min(0.3, gap), html: `Support ${phr(worst)}: their ${esc(lc(tg.rateLabel))} is only ${b(fmtPct(worst.rate))} vs ${fmtPct(overallRate)} overall.` });
      else if (tg.good === false) F.recs.push({ score: 0.65 + Math.min(0.3, gap), html: `Act early on ${esc(lc(top.m.short))}: ${esc(lc(tg.rateLabel))} reaches ${b(fmtPct(worst.rate))} for ${phr(worst)}, vs ${fmtPct(overallRate)} overall.` });
      else F.recs.push({ score: 0.5, html: `${esc(tg.rateLabel)} is ${b(fmtPct(worst.rate))} for ${phr(worst)} vs ${fmtPct(overallRate)} overall — worth a closer look.` });
    }
  }
  F.findings.push({ kind: 'driver', score: 0.5 + Math.min(0.5, Math.abs(top.d) * 0.5), icon: 'spark',
    html: `${cap(esc(lc(top.m.short)))} separates the groups most: ${esc(noun)} who ${esc(tg.posLabel)} average ${b(fu(top.m, top.m1))} vs ${b(fu(top.m, top.m0))} for those who ${esc(tg.negLabel)}.` });
  const rows = strong.slice(0, 6).map(r => ({ label: r.m.label, a: r.m1, b: r.m0, fa: fmtMeasure(r.m, r.m1, { agg: 'mean' }), fb: fmtMeasure(r.m, r.m0, { agg: 'mean' }), d: r.d, min: Math.min(r.m.profile.stats.q1, r.m1, r.m0), max: Math.max(r.m.profile.stats.q3, r.m1, r.m0) }));
  const chart = { type: 'dumbbell', rows, aLabel: cap(tg.posLabel), bLabel: cap(tg.negLabel) };
  const table = { head: ['Measure', `Avg: ${tg.posLabel}`, `Avg: ${tg.negLabel}`, 'Effect size (d)'], rows: res.slice(0, 10).map(r => [r.m.label, fmtMeasure(r.m, r.m1, { agg: 'mean' }), fmtMeasure(r.m, r.m0, { agg: 'mean' }), (r.d >= 0 ? '+' : '−') + Math.abs(r.d).toFixed(2)]) };
  return { id: 'drivers', kind: 'drivers', eyebrow: 'Outcome', title: `What sets apart ${noun} who ${tg.posLabel}`, subtitle: `Average of each measure: ${tg.posLabel} vs ${tg.negLabel}`, html, chart, chart2, table };
}

function rateBands(ds, m, tg, N) {
  const x = ds.num(m.name), tv = ds.str(tg.name);
  const st = m.profile.stats;
  if (!st) return null;
  const fv = v => fmtMeasure(m, v, { agg: 'sum', compact: true });
  const fu = v => fmtMeasure(m, v, { agg: 'sum', compact: true, withUnit: m.unit !== 'count' });
  if (m.profile.unique <= 6) {
    const vals = [...new Set([...x].filter(Number.isFinite))].sort((a, b) => a - b);
    return vals.map(v => { let n = 0, p = 0; for (let i = 0; i < N; i++) if (x[i] === v && tv[i] != null) { n++; if (tv[i] === tg.positive) p++; } return { label: fv(v), phrase: fu(v), rate: n ? p / n : NaN, n }; }).filter(bd => bd.n >= 5);
  }
  let edges = [st.min, st.q1, st.median, st.q3, st.max];
  edges = edges.filter((v, i) => i === 0 || v > edges[i - 1]);
  if (edges.length < 3) return null;
  const bands = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const lo = edges[k], hi = edges[k + 1], lastBand = k === edges.length - 2;
    let n = 0, p = 0;
    for (let i = 0; i < N; i++) { const v = x[i]; if (!Number.isFinite(v) || tv[i] == null) continue; if (v >= lo && (lastBand ? v <= hi : v < hi)) { n++; if (tv[i] === tg.positive) p++; } }
    let label, phrase;
    if (st.integer) {
      const a = lo, z = lastBand ? hi : hi - 1;
      label = a === z ? fv(a) : lastBand ? `${fv(a)}+` : `${fv(a)}–${fv(z)}`;
      phrase = a === z ? fu(a) : lastBand ? `${fu(a)} or more` : k === 0 ? `${fu(z)} or less` : `${fv(a)}–${fu(z)}`;
    } else {
      label = k === 0 ? `< ${fv(hi)}` : lastBand ? `${fv(lo)}+` : `${fv(lo)}–${fv(hi)}`;
      phrase = k === 0 ? `below ${fu(hi)}` : lastBand ? `of ${fu(lo)} or more` : `between ${fv(lo)} and ${fu(hi)}`;
    }
    if (n >= 5) bands.push({ label, phrase, rate: p / n, n });
  }
  return bands;
}

/* ---------- rankings ---------- */
function rankingSection(ds, model, pm, col, N, F) {
  if (!col) return null;
  const sv = ds.str(col.name);
  const nums = pm ? ds.num(pm.name) : null;
  const groups = accumulate(N, i => (sv[i] == null || isVoid(sv[i]) ? undefined : sv[i]), nums, null, null);
  if (groups.length < 5) return null;
  const html = [];
  const colPl = col.role === 'id' ? model.noun : pluralPhrase(col.label.replace(/\s+(name|names|title)$/i, '') || col.label);
  let chart, table, title;
  if (pm && pm.agg === 'sum') {
    const s = groups.slice().sort((a, b) => b.sum - a.sum);
    const total = s.reduce((x, g) => x + g.sum, 0);
    if (total <= 0) return null;
    let acc = 0, k80 = 0;
    for (const g of s) { acc += g.sum; k80++; if (acc / total >= 0.8) break; }
    const top = s[0];
    html.push(`${b(top.key)} is the #1 ${esc(col.role === 'id' ? model.nounOne : singularPhrase(colPl))} with ${b(fmtMeasure(pm, top.sum, { agg: 'sum', compact: true }))} (${fmtPct(top.sum / total)} of ${esc(lc(pm.short))}).`);
    if (s.length >= 8) {
      html.push(`Just ${b(k80)} of ${fmtInt(s.length)} ${esc(colPl)} (${b(fmtPct(k80 / s.length))}) generate 80% of ${esc(lc(pm.short))}.`);
      if (k80 / s.length <= 0.35) F.findings.push({ kind: 'pareto', score: 0.5 + (0.35 - k80 / s.length), icon: 'pie', html: `${b(fmtPct(k80 / s.length))} of ${esc(colPl)} (${k80} of ${s.length}) generate 80% of ${esc(lc(pm.short))}, led by ${b(top.key)}.` });
    }
    const shown = s.slice(0, 10);
    title = `Top ${shown.length} ${colPl} by ${lc(pm.short)}`;
    chart = barSpec(shown, g => g.sum, v => fmtMeasure(pm, v, { agg: 'sum', compact: true }), { highlight: top.key, sub: g => fmtPct(g.sum / total) });
    table = { head: ['#', col.label, cap(model.noun), totalOf(pm), '% of total'], rows: s.slice(0, 25).map((g, i) => [String(i + 1), g.key, fmtInt(g.n), fmtMeasure(pm, g.sum, { agg: 'sum' }), fmtPct(g.sum / total)]) };
  } else if (pm) {
    const s = groups.filter(g => g.cnt).sort((a, b) => b.mean - a.mean);
    const top5 = s.slice(0, 5), bot5 = s.slice(-5).reverse();
    const fv = v => fmtMeasure(pm, v, { agg: 'mean' });
    title = `Highest and lowest ${lc(pm.short)}`;
    html.push(`Highest: ${top5.map(g => `${b(g.key)} (${esc(fv(g.mean))})`).join(', ')}.`);
    html.push(`Lowest: ${bot5.map(g => `${b(g.key)} (${esc(fv(g.mean))})`).join(', ')}.`);
    chart = barSpec(top5.concat(bot5.slice().reverse()), g => g.mean, fv, { highlight: top5[0] && top5[0].key, compact: true });
    table = { head: ['#', col.label, `${lc(pm.short) === pm.short ? cap(pm.short) : pm.short}`], rows: s.slice(0, 25).map((g, i) => [String(i + 1), g.key, fv(g.mean)]) };
  } else {
    const s = groups.slice().sort((a, b) => b.n - a.n).slice(0, 10);
    title = `Most frequent ${colPl}`;
    html.push(`${b(s[0].key)} appears most often (${fmtInt(s[0].n)} ${esc(model.noun)}).`);
    chart = barSpec(s, g => g.n, v => fmtInt(v), { highlight: s[0].key });
    table = { head: [col.label, cap(model.noun)], rows: s.map(g => [g.key, fmtInt(g.n)]) };
  }
  return { id: 'ranking', kind: 'ranking', eyebrow: 'Rankings', title, html, chart, table };
}

/* ---------- measures in plain English ---------- */
function measuresSection(ds, model, N, F) {
  const list = model.measures.slice(0, 8);
  if (!list.length) return null;
  const noun = model.noun, one = model.nounOne;
  const items = list.map(m => {
    const st = m.profile.stats;
    if (!st) return null;
    const f = v => fmtMeasure(m, v, { agg: 'median', withUnit: true });
    const f0 = v => fmtMeasure(m, v, { agg: 'median' });
    const per = m.unit === 'count' || m.agg === 'sum' ? ` per ${esc(one)}` : '';
    const lines = [];
    if (st.q1 === st.q3) lines.push(`Most ${esc(noun)} have ${b(f(st.median))}${per}; values range from ${esc(f0(st.min))} to ${esc(f(st.max))}.`);
    else lines.push(`Typically ${b(f(st.median))}${per}; the middle half of ${esc(noun)} fall between ${b(f0(st.q1))} and ${b(f(st.q3))}. Values range from ${esc(f0(st.min))} to ${esc(f(st.max))}.`);
    if (st.skew > 1 && st.mean > st.median * 1.08) lines.push(`A few very large values pull the average up to ${esc(fmtMeasure(m, st.mean, { agg: 'mean', withUnit: true }))}.`);
    else if (st.skew < -1 && st.mean < st.median * 0.92) lines.push(`A few very low values pull the average down to ${esc(fmtMeasure(m, st.mean, { agg: 'mean', withUnit: true }))}.`);
    thresholdFacts(ds, m, model).forEach(fx => { lines.push(fx.html); if (fx.finding) F.findings.push(fx.finding); if (fx.rec) F.recs.push(fx.rec); });
    if (m.profile.missing) lines.push(`<span class="muted">${fmtInt(m.profile.missing)} ${esc(noun)} have no value.</span>`);
    return { title: m.label, col: m.name, html: lines, chart: histSpec(ds.num(m.name), st, v => fmtMeasure(m, v, { agg: 'median', compact: true })), stat: { label: m.agg === 'sum' ? 'Total' : 'Average', value: fmtMeasure(m, m.agg === 'sum' ? st.sum : st.mean, { agg: m.agg, compact: true }) } };
  }).filter(Boolean);
  return { id: 'measures', kind: 'measures', eyebrow: 'The numbers', title: 'What the numbers look like', html: [`How each measure is spread across the ${fmtInt(N)} ${esc(noun)}.`], items };
}

function thresholdFacts(ds, m, model) {
  const out = [];
  const t = new Set(m.tokens);
  const x = ds.num(m.name);
  const st = m.profile.stats;
  let n = 0; for (const v of x) if (Number.isFinite(v)) n++;
  if (!n) return out;
  const count = f => { let c = 0; for (const v of x) if (Number.isFinite(v) && f(v)) c++; return c; };
  const noun = model.noun;
  if (t.has('attendance') && st.max <= 100 && st.max > 1) {
    const c = count(v => v < 75);
    if (c) out.push({ html: `${b(fmtInt(c))} ${esc(noun)} (${b(fmtPct(c / n))}) are below the common 75% attendance requirement.`,
      finding: { kind: 'threshold', score: 0.35 + Math.min(0.4, c / n), icon: 'alert', html: `${b(fmtPct(c / n))} of ${esc(noun)} (${fmtInt(c)}) are below 75% attendance.` },
      rec: { score: 0.55 + Math.min(0.3, c / n), html: `Follow up with the ${b(fmtInt(c))} ${esc(noun)} below 75% attendance before exams.` } });
  }
  if ((t.has('cgpa') || t.has('gpa') || t.has('sgpa')) && st.max <= 10 && st.max > 4) {
    out.push({ html: `${b(fmtPct(count(v => v >= 8) / n))} have a ${esc(m.short)} of 8 or above; ${b(fmtPct(count(v => v < 6) / n))} are below 6.` });
  }
  if ((t.has('marks') || t.has('score') || t.has('percentage')) && st.min >= 0 && st.max <= 100 && st.max > 70) {
    const c = count(v => v < 40);
    if (c) out.push({ html: `${b(fmtInt(c))} ${esc(noun)} (${fmtPct(c / n)}) scored below 40.` });
  }
  if (t.has('discount') && st.min >= 0 && st.max > 0) out.push({ html: `${b(fmtPct(count(v => v > 0) / n))} of ${esc(noun)} had a discount.` });
  if ((t.has('backlogs') || t.has('backlog')) && st.integer) out.push({ html: `${b(fmtPct(count(v => v > 0) / n))} of ${esc(noun)} have at least one backlog.` });
  if (t.has('tenure') && t.has('months')) out.push({ html: `${b(fmtPct(count(v => v <= 6) / n))} of ${esc(noun)} have been around for 6 months or less.` });
  return out;
}

/* ---------- relationships ---------- */
function relationshipsSection(ds, model, F) {
  const ms = model.measures.slice(0, 14);
  if (ms.length < 2) return null;
  const pairs = [];
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
    const { r, n } = pearson(ds.num(ms[i].name), ds.num(ms[j].name));
    if (Number.isFinite(r) && n >= 10) pairs.push({ a: ms[i], b: ms[j], r, n });
  }
  const LOCK = 0.93;
  const interest = p => Math.abs(p.r) * (p.a.unit === p.b.unit ? 0.7 : 1) * (Math.abs(p.r) >= LOCK ? 0.35 : 1);
  pairs.sort((x, y) => interest(y) - interest(x));
  const sig = pairs.filter(p => Math.abs(p.r) >= 0.3);
  if (!sig.length) return null;
  const word = r => (Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.5 ? 'moderate' : 'weak but noticeable');
  const html = [];
  const lock = sig.filter(p => Math.abs(p.r) >= LOCK);
  const subject = m => (m.unit === 'age' ? `Older ${esc(model.noun)}` : `${esc(cap(model.noun))} with ${comparatives(m)[0]} ${b(lc(m.short))}`);
  sig.filter(p => Math.abs(p.r) < LOCK).slice(0, 3).forEach(p => {
    html.push(`${subject(p.a)} tend to have ${comparatives(p.b)[p.r > 0 ? 0 : 1]} ${b(lc(p.b.short))}: a ${word(p.r)} ${p.r > 0 ? 'positive' : 'negative'} link (r = ${p.r.toFixed(2)}).`);
  });
  if (lock.length) html.push(`${lock.slice(0, 2).map(p => `${b(p.a.short)} and ${b(p.b.short)}`).join('; ')} move almost in lockstep (r ≥ ${LOCK}), so one is probably calculated from the other.`);
  html.push('<span class="muted">Correlation shows that things move together, not that one causes the other.</span>');
  const best = sig.find(p => Math.abs(p.r) < LOCK) || sig[0];
  if (Math.abs(best.r) >= 0.4 && Math.abs(best.r) < LOCK) F.findings.push({ kind: 'corr', score: 0.25 + Math.abs(best.r) * 0.4, icon: 'link', html: `${cap(comparatives(best.a)[0])} ${b(lc(best.a.short))} goes with ${comparatives(best.b)[best.r > 0 ? 0 : 1]} ${b(lc(best.b.short))} (r = ${best.r.toFixed(2)}).` });
  const xa = ds.num(best.a.name), ya = ds.num(best.b.name);
  const pts = [];
  const step = Math.max(1, Math.floor(xa.length / 900));
  for (let i = 0; i < xa.length; i += step) if (Number.isFinite(xa[i]) && Number.isFinite(ya[i])) pts.push([xa[i], ya[i]]);
  const chart = { type: 'scatter', points: pts, xLabel: best.a.label, yLabel: best.b.label, fx: v => fmtMeasure(best.a, v, { agg: 'median', compact: true }), fy: v => fmtMeasure(best.b, v, { agg: 'median', compact: true }), r: best.r };
  const table = { head: ['Measure A', 'Measure B', 'r', 'Strength'], rows: pairs.slice().sort((x, y) => Math.abs(y.r) - Math.abs(x.r)).slice(0, 10).map(p => [p.a.label, p.b.label, p.r.toFixed(2), Math.abs(p.r) >= 0.3 ? word(p.r) : 'none']) };
  return { id: 'relationships', kind: 'relationships', eyebrow: 'Relationships', title: 'Which numbers move together', subtitle: `${best.a.label} vs ${best.b.label}`, html, chart, table };
}

/* ---------- linked categories (Cramér's V) ---------- */
function linkedCategories(ds, model, ranked, N, F) {
  const cands = ranked.filter(r => r.k >= 2 && r.k <= 12).slice(0, 5).map(r => r.meta);
  let best = null;
  for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
    const a = ds.str(cands[i].name), c = ds.str(cands[j].name);
    const tab = new Map(), ra = new Map(), rc = new Map();
    let n = 0;
    for (let k = 0; k < N; k++) { if (a[k] == null || c[k] == null || isVoid(a[k]) || isVoid(c[k])) continue; n++; const key = a[k] + '\u0001' + c[k]; tab.set(key, (tab.get(key) || 0) + 1); ra.set(a[k], (ra.get(a[k]) || 0) + 1); rc.set(c[k], (rc.get(c[k]) || 0) + 1); }
    if (n < 30 || ra.size < 2 || rc.size < 2) continue;
    let chi = 0;
    for (const [ka, na] of ra) for (const [kc, nc] of rc) { const e = (na * nc) / n; const o = tab.get(ka + '\u0001' + kc) || 0; chi += (o - e) ** 2 / e; }
    const v = Math.sqrt(chi / (n * (Math.min(ra.size, rc.size) - 1)));
    if (!best || v > best.v) best = { v, a: cands[i], c: cands[j], tab, ra, rc, n };
  }
  if (!best || best.v < 0.2) return;
  let cell = null;
  const minS = Math.max(10, N * 0.02);
  for (const [ka, na] of best.ra) for (const [kc, nc] of best.rc) {
    const o = best.tab.get(ka + '\u0001' + kc) || 0; if (na < minS || o < 5) continue;
    const within = o / na, overall = nc / best.n, lift = within / overall;
    if (!cell || lift > cell.lift) cell = { ka, kc, within, overall, lift };
  }
  if (!cell || cell.lift < 1.3) return;
  F.findings.push({ kind: 'link', score: 0.3 + Math.min(0.4, best.v), icon: 'link',
    html: `${esc(cap(lc(best.a.label)))} and ${esc(lc(best.c.label))} are linked: ${b(fmtPct(cell.within))} of ${b(dispKey(best.a, cell.ka))} ${esc(model.noun)} are ${b(dispKey(best.c, cell.kc))}, vs ${fmtPct(cell.overall)} overall.` });
}

/* ---------- helpers ---------- */
function pickTakeaways(findings, max) {
  const out = [], per = {};
  for (const f of findings.slice().sort((a, b) => b.score - a.score)) {
    if ((per[f.kind] || 0) >= 2) continue;
    per[f.kind] = (per[f.kind] || 0) + 1;
    out.push(f);
    if (out.length >= max) break;
  }
  return out;
}

export function barSpec(groups, val, fmt, opts = {}) {
  let data = groups.map(g => ({ label: g.label ?? g.key, value: val(g), text: fmt(val(g)), n: g.n, sub: opts.sub ? opts.sub(g) : null, highlight: g.key === opts.highlight, void: isVoid(g.key) }));
  if (data.length > 12) {
    const rest = data.slice(11);
    const additive = !opts.ref && opts.max !== 1;
    data = data.slice(0, 11);
    if (additive) { const v = rest.reduce((s, x) => s + (Number.isFinite(x.value) ? x.value : 0), 0); data.push({ label: `Other (${rest.length})`, value: v, text: fmt(v), other: true }); }
  }
  return { type: 'bar', data, fmt, ref: opts.ref || null, max: opts.max, compact: !!opts.compact };
}

export function histSpec(nums, st, fmt) {
  let lo = st.min, hi = st.max, clipped = false;
  // Long tails squash everything into one bar: show the typical range and gather the tail into the last bin.
  if (st.iqr > 0 && st.max > st.q3 + 3 * st.iqr) { hi = Math.max(st.p95, st.q3 + 3 * st.iqr); clipped = hi < st.max; }
  if (st.iqr > 0 && st.min < st.q1 - 3 * st.iqr) lo = Math.min(st.p05, st.q1 - 3 * st.iqr);
  let bins;
  if (st.integer && hi - lo <= 30) {
    bins = [];
    for (let v = Math.round(lo); v <= Math.round(hi); v++) bins.push({ x0: v - 0.5, x1: v + 0.5, count: 0, label: fmt(v) });
    for (const x of nums) if (Number.isFinite(x)) { let i = Math.round(Math.min(Math.max(x, lo), hi) - Math.round(lo)); if (bins[i]) bins[i].count++; }
    if (clipped && bins.length) bins[bins.length - 1].label += ' or more';
  } else {
    const k = Math.max(6, Math.min(24, Math.ceil(Math.sqrt(st.n))));
    const w = (hi - lo) / k || 1;
    bins = Array.from({ length: k }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }));
    for (const x of nums) if (Number.isFinite(x)) { let i = Math.floor((x - lo) / w); if (i >= k) i = k - 1; if (i < 0) i = 0; bins[i].count++; }
    bins.forEach((bn, i) => { bn.label = clipped && i === k - 1 ? `${fmt(bn.x0)} or more` : `${fmt(bn.x0)} – ${fmt(bn.x1)}`; });
  }
  return { type: 'hist', bins, fmt, median: st.median, clipped };
}

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
