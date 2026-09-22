/* ==========================================================================
   Clarity — analysis views: Summary, Explore, Columns, Cleaning, Data,
   Correlations. Each view renders into the element it is given.
   ========================================================================== */
import { S, story, model, quality, issues, fix, fixAll, undo, resetToOriginal, setRole, setSetting } from './state.js';
import { isMissing, parseNumber, parseDate, pearson } from './data.js';
import { ROLE_INFO, fmtMeasure, fmtPct, fmtInt, fmtNumber, fmtDate } from './semantics.js';
import { aggregate, barSpec, histSpec, bucketLabel } from './story.js';
import { chartSlot, miniHist } from './charts.js';
import { $, esc, icon, toast, openModal, copyText, stripTags, download } from './ui.js';
import { rerender } from './app.js';

const TAKE_ICON = { pie: 'pie', bars: 'bars', target: 'target', up: 'up', down: 'down', upbad: 'up', downgood: 'down', spark: 'spark', link: 'link', calendar: 'calendar', alert: 'alert' };
const DOMAIN_ICON = { sales: 'cart', customers: 'users', hr: 'briefcase', education: 'cap', finance: 'wallet', health: 'heart', marketing: 'megaphone', realestate: 'building', general: 'layers' };
const isNumCell = v => /^[−\-+]?[₹$€£]?\s?[\d,.]+(\s?(%|L|Cr|K|M|B|pts|×))?(\s\(.*\))?$/.test(String(v).trim());

export function tableHTML(head, rows, opts = {}) {
  return `<div class="tbl-wrap" ${opts.max ? `style="max-height:${opts.max}px"` : ''}><table class="table ${opts.compact ? 'compact' : ''}"><thead><tr>${head.map((h, i) => `<th class="${i > 0 && rows.length && isNumCell(rows[0][i]) ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i > 0 && isNumCell(c) ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ==========================================================================
   Summary — the story
   ========================================================================== */
export function sectionHTML(s, { doc = false } = {}) {
  const narr = (s.html || []).map(p => `<p>${p}</p>`).join('');
  if (s.items) {
    const items = s.items.map(it => `<div class="mini">
      <h4>${esc(it.title)}${it.stat ? `<span>${esc(it.stat.label)} <b style="color:var(--ink)">${esc(it.stat.value)}</b></span>` : ''}</h4>
      ${it.chart ? chartSlot(it.chart.type === 'hist' ? { ...it.chart, height: 110 } : it.chart) : ''}
      ${it.html ? `<div class="narr">${it.html.map(p => `<p>${p}</p>`).join('')}</div>` : ''}
      ${it.note ? `<p class="muted" style="font-size:12.5px;margin-top:8px">${esc(it.note)}</p>` : ''}
    </div>`).join('');
    return `<section class="sec" id="sec-${esc(s.id)}"><div class="sec-h"><span class="eyebrow">${esc(s.eyebrow || '')}</span><h3>${esc(s.title)}</h3>${narr ? `<div class="narr" style="margin-top:6px">${narr}</div>` : ''}</div><div class="sub-grid">${items}</div></section>`;
  }
  const charts = [s.chart ? chartSlot(s.chart) : '', s.chart2 ? `<div style="margin-top:18px"><div class="ch-ylab">${esc(s.chart2.title || '')}</div>${chartSlot(s.chart2)}</div>` : ''].join('');
  return `<section class="sec" id="sec-${esc(s.id)}">
    <div class="sec-h"><span class="eyebrow">${esc(s.eyebrow || '')}</span><h3>${esc(s.title)}</h3>${s.subtitle ? `<div class="sub">${esc(s.subtitle)}</div>` : ''}</div>
    <div class="sec-b ${charts ? '' : 'single'}"><div class="narr">${narr}</div>${charts ? `<div>${charts}</div>` : ''}</div>
    ${s.table && s.table.rows.length && !doc ? `<div class="sec-f"><details><summary>${icon('chevR', 'sm')}Show the numbers (${s.table.rows.length} rows)</summary>${tableHTML(s.table.head, s.table.rows, { compact: true })}</details></div>` : ''}
  </section>`;
}

function kpisHTML(kpis) {
  return `<div class="kpi-grid">${kpis.map(k => `<div class="kpi"><div class="l" title="${esc(k.label)}">${esc(k.label)}</div><div class="v ${k.text ? 'text' : ''}" title="${esc(k.value)}">${esc(k.value)}</div><div class="s" title="${esc(k.sub)}">${esc(k.sub)}</div></div>`).join('')}</div>`;
}

function currencySelect() {
  const cur = S.a.settings.currency || 'auto';
  const m = model();
  if (!m.measures.some(x => x.unit === 'currency')) return '';
  const opts = [['auto', 'Auto' + (m.currency && cur === 'auto' ? ` (${m.currency})` : '')], ['₹', '₹ Rupee'], ['$', '$ Dollar'], ['€', '€ Euro'], ['£', '£ Pound'], ['none', 'No symbol']];
  return `<span class="label">Currency</span><select class="select select-sm" data-change="currency" style="width:auto" aria-label="Currency">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function rolesChips(m) {
  const groups = ['measure', 'dimension', 'date', 'target', 'entity', 'id', 'text', 'contact', 'ignore'];
  return groups.map(r => {
    const cols = m.order.filter(c => m.cols[c].role === r);
    if (!cols.length) return '';
    return `<div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line)"><b style="min-width:110px;font-size:13px" class="role-${r}">${esc(ROLE_INFO[r].label)}</b><span style="display:flex;gap:6px;flex-wrap:wrap">${cols.map(c => `<span class="pill" title="${esc(m.cols[c].reason)}">${esc(m.cols[c].label)}${m.cols[c].role !== m.cols[c].auto ? ' ✎' : ''}</span>`).join('')}</span></div>`;
  }).join('');
}

function fixBanner() {
  const list = issues().filter(i => i.kind !== 'outlier' && (i.kind === 'duplicates' || i.kind === 'labels' || i.kind === 'mixed' || i.kind === 'dropcol' || (i.kind === 'missing' && i.severity !== 'low')));
  if (!list.length) return '';
  const what = list.map(i => i.kind === 'duplicates' ? `${fmtInt(i.count)} duplicate rows` : i.kind === 'labels' ? `inconsistent “${i.col}” labels` : i.kind === 'missing' ? `gaps in “${i.col}”` : i.kind === 'mixed' ? `unreadable “${i.col}” values` : `an unusable “${i.col}” column`);
  return `<div class="fix-banner no-print"><span class="ti">${icon('wand', 'sm')}</span><div class="tx"><b>Make this report more accurate.</b> Clarity found ${esc(what.slice(0, 3).join(', '))}${what.length > 3 ? ` and ${what.length - 3} more` : ''}. Fixing them changes the numbers above.</div>
    <a class="btn btn-sm" href="#/app/cleaning">Review</a><button class="btn btn-sm btn-primary" data-action="fix-all">${icon('wand', 'sm')}Fix automatically</button></div>`;
}

function renderSummary(el) {
  const a = S.a, st = story(), m = model(), q = quality();
  const qCls = q.score >= 75 ? 'good' : q.score >= 55 ? 'warn' : 'bad';
  el.innerHTML = `
  <div class="story-hero">
    <div class="meta">
      <span class="pill accent">${icon(DOMAIN_ICON[m.domain.key] || 'layers', 'sm')}${esc(m.domain.label)}</span>
      <span class="pill">${fmtInt(a.ds.length)} ${esc(m.noun)}</span><span class="pill">${a.ds.cols.length} columns</span>
      <a class="pill ${qCls}" href="#/app/cleaning" style="text-decoration:none">Quality ${q.score}/100</a>
      ${a.saved ? `<span class="pill good">${icon('checkCircle', 'sm')}Saved</span>` : ''}
    </div>
    <h1>${esc(st.title)}</h1>
    <p class="about">${st.about}</p>
    ${a.context ? `<p class="muted row" style="margin-top:10px;position:relative;gap:8px">${icon('target', 'sm')}<span>${esc(a.context)}</span></p>` : ''}
    <div class="story-tools no-print">
      ${currencySelect()}
      <a class="btn btn-sm" href="#/app/columns">${icon('columns', 'sm')}Adjust columns</a>
      <button class="btn btn-sm" data-action="copy-summary">${icon('copy', 'sm')}Copy summary</button>
      <a class="btn btn-sm" href="#/app/report">${icon('doc', 'sm')}Full report</a>
    </div>
  </div>
  ${fixBanner()}
  <div class="block">${kpisHTML(st.kpis)}</div>
  <div class="block">
    <div class="block-title"><h2>${icon('sparkles')}Key takeaways</h2></div>
    ${st.takeaways.length ? `<div class="takeaways">${st.takeaways.map(t => `<div class="take"><span class="ti ${esc(t.icon)}">${icon(TAKE_ICON[t.icon] || 'spark', 'sm')}</span><span>${t.html}</span></div>`).join('')}</div>`
      : `<div class="card card-b muted">No strong patterns stood out. Try the Explore page to slice the data your way, or mark an outcome column on the Columns page.</div>`}
  </div>
  ${st.sections.length ? `<div class="block">
    <div class="block-title"><h2>${icon('layers')}The details</h2></div>
    <div class="toc">${st.sections.map(s => `<a href="#" data-action="scrollto" data-target="sec-${esc(s.id)}">${esc(s.title)}</a>`).join('')}<a href="#" data-action="scrollto" data-target="sec-recs">What to do next</a></div>
    ${st.sections.map(s => sectionHTML(s)).join('')}
  </div>` : ''}
  <div class="block" id="sec-recs">
    <div class="block-title"><h2>${icon('bulb')}What to do next</h2></div>
    <div class="recs">${st.recs.map(r => `<div class="rec"><span>${r.html}${r.link ? ` <a href="#/app/${r.link}">Open ${r.link} →</a>` : ''}</span></div>`).join('')}</div>
  </div>
  <div class="block">
    <div class="block-title"><h2>${icon('columns')}How Clarity read your columns</h2><a class="btn btn-sm" href="#/app/columns">Adjust</a></div>
    <div class="card" style="padding:4px 20px 8px">${rolesChips(m)}</div>
  </div>`;
}

/* ==========================================================================
   Explore
   ========================================================================== */
let ex = null;
function exDefaults() {
  const m = model();
  const st = story();
  const firstDim = (st.sections.find(s => s.kind === 'breakdown') || {}).col || (m.dims[0] && m.dims[0].name) || (m.dates[0] && m.dates[0].name) || (m.entities[0] && m.entities[0].name);
  const pm = m.primaryMeasure;
  return { key: S.a.id, by: firstDim, byUnit: 'auto', measure: st.kind === 'rate' ? '__rate' : pm ? pm.name : '__count', agg: pm ? (pm.agg === 'sum' ? 'sum' : 'mean') : 'count', split: '', fcol: '', fval: '', sort: 'value', top: 15 };
}

function renderExplore(el) {
  const m = model();
  if (!ex || ex.key !== S.a.id) ex = exDefaults();
  const byOpts = [
    ['Categories', m.dims.filter(d => d.profile.unique >= 1)],
    ['Dates', m.dates],
    ['Names', m.entities],
  ];
  if (!ex.by) { el.innerHTML = `<div class="page-head"><div><h1>Explore</h1></div></div><div class="card"><div class="empty"><div class="ill">${icon('compass', 'lg')}</div><div class="big">Nothing to group by yet</div><p>Mark a column as a Category on the Columns page to slice the data.</p><a class="btn" style="margin-top:14px" href="#/app/columns">Open Columns</a></div></div>`; return; }
  const byMeta = m.cols[ex.by];
  const isTime = byMeta && byMeta.role === 'date';
  const measureOpts = [['__count', `Number of ${m.noun}`], ...m.measures.map(x => [x.name, x.label])];
  if (m.target) measureOpts.push(['__rate', m.target.rateLabel]);
  const numeric = ex.measure !== '__count' && ex.measure !== '__rate';
  const splitOpts = m.dims.filter(d => d.name !== ex.by && d.profile.unique <= 30);
  const filterOpts = m.dims.filter(d => d.profile.unique <= 200);
  let fvals = [];
  if (ex.fcol) { const sv = S.a.ds.str(ex.fcol); const set = new Map(); for (const v of sv) { const k = v == null ? '(blank)' : v; set.set(k, (set.get(k) || 0) + 1); } fvals = [...set.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]); if (!fvals.includes(ex.fval)) ex.fval = fvals[0] || ''; }
  const sel = (name, opts, cur, attrs = '') => `<select class="select" data-change="ex" data-k="${name}" ${attrs}>${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  const spec = { by: ex.by, byUnit: isTime && ex.byUnit !== 'auto' ? ex.byUnit : undefined, measure: numeric ? ex.measure : null, agg: ex.measure === '__count' ? 'count' : ex.measure === '__rate' ? 'rate' : ex.agg, split: ex.split || null, sort: ex.sort, filter: ex.fcol ? { col: ex.fcol, values: new Set([ex.fval]) } : null };
  const res = aggregate(S.a.ds, m, spec);
  const mMeta = numeric ? m.cols[ex.measure] : null;
  const kindName = spec.agg;
  const fv = v => kindName === 'count' ? fmtInt(v) : kindName === 'rate' ? fmtPct(v) : fmtMeasure(mMeta, v, { agg: kindName, compact: true });
  const fvFull = v => kindName === 'count' ? fmtInt(v) : kindName === 'rate' ? fmtPct(v) : fmtMeasure(mMeta, v, { agg: kindName });
  const metricLabel = ex.measure === '__count' ? `Number of ${m.noun}` : ex.measure === '__rate' ? m.target.rateLabel : `${{ sum: 'Total', mean: 'Average', median: 'Median', min: 'Minimum', max: 'Maximum' }[ex.agg]} ${mMeta.short.toLowerCase() === mMeta.short ? mMeta.short : mMeta.short.charAt(0).toLowerCase() + mMeta.short.slice(1)}`;
  let groups = res.groups.filter(g => Number.isFinite(g.value) && (kindName !== 'rate' || g.tn));
  if (!isTime && ex.sort === 'label') groups.sort((x, y) => String(x.label).localeCompare(String(y.label), undefined, { numeric: true }));
  const shown = isTime ? groups : groups.slice(0, ex.top === 'all' ? groups.length : +ex.top);

  // answer sentence
  let answer = '';
  const real = groups.filter(g => g.key !== '(blank)');
  if (real.length) {
    const hi = real.reduce((x, y) => (y.value > x.value ? y : x)), lo = real.reduce((x, y) => (y.value < x.value ? y : x));
    const total = res.valTotal;
    const lbl = g => (isTime ? bucketLabel(g.key, res.unit, res.multiYear, true) : g.label);
    answer = `${isTime ? 'Highest in' : 'Highest:'} <b>${esc(lbl(hi))}</b> (${esc(fvFull(hi.value))}${kindName === 'sum' && total ? `, ${fmtPct(hi.value / total)} of the total` : kindName === 'count' ? `, ${fmtPct(hi.value / res.total)}` : ''}). ${isTime ? 'Lowest in' : 'Lowest:'} <b>${esc(lbl(lo))}</b> (${esc(fvFull(lo.value))}).`;
    if (ex.fcol) answer += ` <span class="muted">Only ${esc(m.cols[ex.fcol].label)} = “${esc(ex.fval)}” (${fmtInt(res.total)} ${esc(m.noun)}).</span>`;
  }

  // chart
  let chart = '';
  if (isTime) {
    const series = res.series ? res.series : [{ name: metricLabel, values: res.groups.map(g => g.value) }];
    chart = chartSlot({ type: 'line', x: res.groups.map(g => g.label), series, fmt: fv, fmtAxis: fv, area: !res.series, legend: !!res.series, yMin: kindName === 'sum' || kindName === 'count' || kindName === 'rate' ? 0 : undefined });
  } else if (res.series) {
    const idx = new Map(res.groups.map((g, i) => [g.key, i]));
    chart = splitBars(shown.map(g => ({ label: g.label, vals: res.series.map(s => s.values[idx.get(g.key)]) })), res.series.map(s => s.name), fv, kindName === 'sum' || kindName === 'count');
  } else {
    chart = chartSlot(barSpec(shown, g => g.value, fv, { max: kindName === 'rate' ? 1 : undefined, sub: kindName === 'sum' && res.valTotal ? g => fmtPct(g.value / res.valTotal) : kindName === 'count' ? g => fmtPct(g.n / res.total) : null }));
  }
  // table
  const head = [byMeta.label, `${m.noun.charAt(0).toUpperCase() + m.noun.slice(1)}`, metricLabel].concat(res.series ? res.series.map(s => s.name) : []);
  const idx = new Map(res.groups.map((g, i) => [g.key, i]));
  const trows = (isTime ? groups : groups).map(g => [isTime ? bucketLabel(g.key, res.unit, res.multiYear, true) : g.label, fmtInt(g.n), fvFull(g.value)].concat(res.series ? res.series.map(s => fvFull(s.values[idx.get(g.key)])) : []));
  ex._table = { head, rows: trows };

  el.innerHTML = `
  <div class="page-head"><div><h1>Explore</h1><p>Slice any measure by any category. Pick what to compare and Clarity answers in a sentence, a chart and a table.</p></div></div>
  <div class="controls">
    <div class="ctl"><label>Group by</label><select class="select" data-change="ex" data-k="by">${byOpts.filter(g => g[1].length).map(([g, list]) => `<optgroup label="${g}">${list.map(d => `<option value="${esc(d.name)}" ${d.name === ex.by ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</optgroup>`).join('')}</select></div>
    ${isTime ? `<div class="ctl" style="max-width:150px"><label>Period</label>${sel('byUnit', [['auto', 'Auto'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']], ex.byUnit)}</div>` : ''}
    <div class="ctl"><label>Show</label>${sel('measure', measureOpts, ex.measure)}</div>
    ${numeric ? `<div class="ctl" style="max-width:150px"><label>As</label>${sel('agg', [['sum', 'Total'], ['mean', 'Average'], ['median', 'Median'], ['min', 'Minimum'], ['max', 'Maximum']], ex.agg)}</div>` : ''}
    <div class="ctl"><label>Split by</label>${sel('split', [['', 'None'], ...splitOpts.map(d => [d.name, d.label])], ex.split)}</div>
    <div class="ctl"><label>Filter</label>${sel('fcol', [['', 'All rows'], ...filterOpts.map(d => [d.name, d.label])], ex.fcol)}</div>
    ${ex.fcol ? `<div class="ctl"><label>equals</label>${sel('fval', fvals.map(v => [v, v]), ex.fval)}</div>` : ''}
    ${!isTime ? `<div class="ctl" style="max-width:140px"><label>Sort</label>${sel('sort', [['value', 'By value'], ['label', 'A → Z']], ex.sort)}</div><div class="ctl" style="max-width:110px"><label>Top</label>${sel('top', [['10', '10'], ['15', '15'], ['25', '25'], ['all', 'All']], ex.top)}</div>` : ''}
  </div>
  <div class="card" style="margin-top:16px">
    ${answer ? `<div class="answer">${answer}</div>` : ''}
    <div class="card-b"><div class="spread" style="margin-bottom:12px"><b>${esc(metricLabel)} by ${esc(byMeta.label.toLowerCase())}${ex.split ? ', split by ' + esc(m.cols[ex.split].label.toLowerCase()) : ''}</b>${!isTime && groups.length > shown.length ? `<span class="muted" style="font-size:12.5px">Showing ${shown.length} of ${groups.length}</span>` : ''}</div>${chart || '<div class="ch-empty">No values for this combination.</div>'}</div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-h"><h3>Table</h3><button class="btn btn-sm" data-action="ex-csv">${icon('download', 'sm')}Download CSV</button></div>
    <div style="padding:0">${tableHTML(head, trows, { compact: true, max: 460 })}</div>
  </div>`;
}

function splitBars(rows, names, fmt, stacked) {
  const legend = `<div class="ch-legend">${names.map((n, i) => `<span><i class="key s${i + 1}"></i>${esc(n)}</span>`).join('')}</div>`;
  if (stacked) {
    const max = Math.max(...rows.map(r => r.vals.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0)), 1e-12);
    return legend + `<div class="hbars">${rows.map(r => {
      const tot = r.vals.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
      let left = 0;
      const segs = r.vals.map((v, i) => { const w = (Number.isFinite(v) ? v : 0) / max * 100; const seg = w > 0 ? `<i class="hb-bar" style="left:${left.toFixed(2)}%;width:calc(${w.toFixed(2)}% - 2px);background:var(--s${i + 1});border-radius:${i === r.vals.length - 1 ? '0 4px 4px 0' : '0'}" data-tip="${esc(r.label + '\u001f' + names[i] + ': ' + fmt(v))}"></i>` : ''; left += w; return seg; }).join('');
      return `<div class="hb-row"><div class="hb-label" title="${esc(r.label)}">${esc(r.label)}</div><div class="hb-track">${segs}</div><div class="hb-val"><b>${esc(fmt(tot))}</b></div></div>`;
    }).join('')}</div>`;
  }
  const all = rows.flatMap(r => r.vals).filter(Number.isFinite);
  const max = Math.max(...all, 1e-12);
  return legend + `<div class="hbars">${rows.map(r => `<div class="hb-row" style="align-items:start;padding:4px"><div class="hb-label" title="${esc(r.label)}" style="padding-top:2px">${esc(r.label)}</div><div style="display:grid;gap:3px">${r.vals.map((v, i) => `<div class="hb-track" style="height:9px" data-tip="${esc(r.label + '\u001f' + names[i] + ': ' + fmt(v))}"><i class="hb-bar" style="left:0;width:${Number.isFinite(v) ? Math.max(0.5, v / max * 100).toFixed(2) : 0}%;background:var(--s${i + 1})"></i></div>`).join('')}</div><div class="hb-val" style="display:grid;gap:3px;font-size:11.5px;line-height:9px">${r.vals.map(v => `<span>${esc(fmt(v))}</span>`).join('')}</div></div>`).join('')}</div>`;
}

/* ==========================================================================
   Columns
   ========================================================================== */
function colSummary(c, meta) {
  const p = c;
  if (p.stats) return `${fmtMeasure(meta.role === 'measure' ? meta : null, p.stats.min, { compact: true })} – ${fmtMeasure(meta.role === 'measure' ? meta : null, p.stats.max, { compact: true })} · median ${fmtMeasure(meta.role === 'measure' ? meta : null, p.stats.median, { compact: true })}`;
  if (p.dates) return `${fmtDate(p.dates.min)} → ${fmtDate(p.dates.max)}`;
  if (p.top && p.top.length) return `Most common: “${String(p.top[0][0]).slice(0, 28)}” (${fmtPct(p.top[0][1] / Math.max(1, p.N - p.missing))})`;
  return '—';
}
function colMini(c) {
  if (c.stats && c.stats.n > 1) return miniHist(histSpec(S.a.ds.num(c.name), c.stats, v => fmtNumber(v, 2)), 130, 32);
  if (c.top && c.top.length) {
    const top = c.top.slice(0, 4), max = top[0][1] || 1;
    return `<div style="display:grid;gap:3px;width:130px">${top.map(([k, n]) => `<div style="display:flex;align-items:center;gap:6px" data-tip="${esc(k + '\u001f' + n.toLocaleString('en-US') + ' rows')}"><i style="display:block;height:6px;border-radius:0 3px 3px 0;background:var(--chart);width:${Math.max(4, n / max * 90)}px"></i></div>`).join('')}</div>`;
  }
  return '';
}
function renderColumns(el) {
  const m = model(), a = S.a;
  const counts = {};
  m.order.forEach(c => { const r = m.cols[c].role; counts[r] = (counts[r] || 0) + 1; });
  const overridden = Object.keys(a.roles).length;
  const roleOpts = ['measure', 'dimension', 'date', 'target', 'entity', 'id', 'text', 'ignore'];
  el.innerHTML = `
  <div class="page-head"><div><h1>Columns</h1><p>How Clarity understood each column. If something is off — say an ID treated as a number to add up — change its role and every page updates.</p></div>
    ${overridden ? `<button class="btn btn-sm" data-action="reset-roles">${icon('reset', 'sm')}Reset ${overridden} change${overridden > 1 ? 's' : ''}</button>` : ''}</div>
  <div class="kpi-grid" style="margin-bottom:16px">${['measure', 'dimension', 'date', 'target'].map(r => `<div class="kpi"><div class="l">${esc({ measure: 'Measures', dimension: 'Categories', date: 'Dates', target: 'Outcomes' }[r])}</div><div class="v">${counts[r] || 0}</div><div class="s">${esc(ROLE_INFO[r].desc)}</div></div>`).join('')}</div>
  <div class="tbl-wrap"><table class="table">
    <thead><tr><th>Column</th><th>Role</th><th>Type</th><th class="n">Missing</th><th class="n">Unique</th><th>Summary</th><th>Shape</th></tr></thead>
    <tbody>${m.order.map(name => {
      const meta = m.cols[name], c = meta.profile;
      return `<tr>
        <td style="min-width:200px"><div class="col-name">${esc(meta.label)}</div><div class="col-reason">${esc(name !== meta.label ? name + ' · ' : '')}${esc(meta.reason)}</div></td>
        <td><select class="select role-select ${meta.role === meta.auto ? 'auto' : ''}" data-change="role" data-col="${esc(name)}" aria-label="Role for ${esc(meta.label)}">
          ${roleOpts.map(r => `<option value="${r}" ${meta.role === r ? 'selected' : ''}>${esc(ROLE_INFO[r].label)}${r === meta.auto ? ' (auto)' : ''}</option>`).join('')}
          ${meta.auto === 'contact' ? `<option value="contact" ${meta.role === 'contact' ? 'selected' : ''}>Contact (auto)</option>` : ''}
        </select></td>
        <td><span class="pill">${esc(c.type)}${meta.role === 'measure' && meta.unit !== 'number' ? ' · ' + esc(meta.unit === 'currency' ? 'money' + (meta.currency ? ' ' + meta.currency : '') : meta.unit) : ''}</span></td>
        <td class="n">${c.missing ? `${fmtInt(c.missing)} <span class="muted">(${fmtPct(c.missingPct)})</span>` : '<span class="muted">0</span>'}</td>
        <td class="n">${fmtInt(c.unique)}</td>
        <td class="muted" style="font-size:12.5px;min-width:180px">${esc(colSummary(c, meta))}</td>
        <td>${colMini(c)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

/* ==========================================================================
   Cleaning
   ========================================================================== */
function issuePreview(is) {
  const a = S.a, rows = a.ds.rows, col = is.col;
  const c = col ? a.prof.columns.find(x => x.name === col) : null;
  const other = a.ds.cols.filter(x => x !== col).slice(0, 3);
  let pick = [];
  if (is.kind === 'duplicates') { const seen = new Set(); rows.forEach((r, i) => { const k = a.ds.cols.map(cc => r[cc]).join('\u0001'); if (seen.has(k)) pick.push(i); else seen.add(k); }); }
  else if (is.kind === 'missing') rows.forEach((r, i) => { if (isMissing(r[col])) pick.push(i); });
  else if (is.kind === 'labels') rows.forEach((r, i) => { const v = r[col]; if (typeof v === 'string' && !isMissing(v)) { const t = v.trim().replace(/\s+/g, ' '); const top = c.top.find(([k]) => k.toLowerCase() === t.toLowerCase()); if (v !== t || (top && top[0] !== t)) pick.push(i); } });
  else if (is.kind === 'mixed') rows.forEach((r, i) => { const v = r[col]; if (!isMissing(v) && (c.type === 'numeric' ? !Number.isFinite(parseNumber(v)) : !Number.isFinite(parseDate(v, c.dateOrder)))) pick.push(i); });
  else if (is.kind === 'outlier') rows.forEach((r, i) => { const x = parseNumber(r[col]); if (Number.isFinite(x) && (x < c.stats.lb || x > c.stats.ub)) pick.push(i); });
  else if (is.kind === 'numformat') rows.forEach((r, i) => { const v = r[col]; if (typeof v === 'string' && /[,₹$€£¥%]|^\s*\(/.test(v)) pick.push(i); });
  else if (is.kind === 'datefmt') rows.forEach((r, i) => { if (!isMissing(r[col]) && !/^\d{4}-\d{2}-\d{2}/.test(String(r[col]).trim())) pick.push(i); });
  const cols = col ? [col, ...other] : a.ds.cols.slice(0, 5);
  const sample = pick.slice(0, 8);
  if (!sample.length) return '<p class="muted">No affected rows to show.</p>';
  return `<p class="muted" style="font-size:12.5px;margin-bottom:8px">Showing ${sample.length} of ${fmtInt(pick.length)} affected rows.</p>
    <div class="tbl-wrap" style="max-height:320px"><table class="table compact"><thead><tr><th class="n">Row</th>${cols.map(cc => `<th>${esc(cc)}</th>`).join('')}</tr></thead><tbody>
    ${sample.map(i => `<tr><td class="n muted">${i + 2}</td>${cols.map(cc => { const v = rows[i][cc]; const hl = cc === col; return `<td class="${isMissing(v) ? 'miss' : ''}" style="${hl ? 'font-weight:600;white-space:pre' : ''}">${isMissing(v) ? '' : hl ? esc(JSON.stringify(String(v)).slice(1, -1)) : esc(v)}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

function renderCleaning(el) {
  const a = S.a, q = quality(), list = issues();
  const ack = a.acknowledged || {};
  const actionable = list.filter(i => i.kind !== 'outlier');
  const o = a.origProf, c = a.prof;
  const miss = p => p.columns.reduce((s, x) => s + x.missing, 0);
  const color = q.score >= 75 ? 'var(--good)' : q.score >= 55 ? 'var(--warn)' : 'var(--bad)';
  const issueHTML = is => `<div class="issue ${ack[is.id] ? '' : ''}" data-id="${esc(is.id)}">
      <div class="issue-h" data-action="toggle-issue"><span class="sev ${is.severity}" title="${is.severity} severity"></span>
        <div class="it"><b>${esc(is.title)}${ack[is.id] ? ' <span class="pill good" style="margin-left:6px">Reviewed</span>' : ''}</b><span>${is.col ? esc(is.col) : 'Whole dataset'} · ${fmtInt(is.count)} ${is.kind === 'dropcol' ? 'rows' : 'affected'}</span></div>
        <span class="pill ${is.severity === 'high' ? 'bad' : is.severity === 'medium' ? 'warn' : ''}">${esc(is.severity)}</span>
        <span class="chev">${icon('chevR', 'sm')}</span></div>
      <div class="issue-b"><p>${esc(is.problem)}</p>
        <div class="opts">${is.options.map((op, i) => `<button class="btn btn-sm ${i === 0 && is.kind !== 'outlier' ? 'btn-primary' : ''}" data-action="fix" data-id="${esc(is.id)}" data-mode="${esc(op.mode)}" title="${esc(op.desc || '')}">${esc(op.label)}</button>`).join('')}
          <button class="btn btn-sm btn-ghost" data-action="preview-issue" data-id="${esc(is.id)}">${icon('eye', 'sm')}Preview rows</button></div></div>
    </div>`;
  el.innerHTML = `
  <div class="page-head"><div><h1>Cleaning</h1><p>Every issue Clarity found, why it matters, and how to fix it. Nothing changes until you choose — and every change can be undone.</p></div>
    <div class="row" style="flex-wrap:wrap">
      ${a.history.length ? `<button class="btn btn-sm" data-action="undo">${icon('undo', 'sm')}Undo</button>` : ''}
      ${a.log.length ? `<button class="btn btn-sm" data-action="reset-data">${icon('reset', 'sm')}Reset to original</button>` : ''}
      ${actionable.length ? `<button class="btn btn-sm btn-primary" data-action="fix-all">${icon('wand', 'sm')}Fix ${actionable.length} recommended</button>` : ''}
    </div></div>
  <div class="clean-grid">
    <div>
      ${list.length ? list.map(issueHTML).join('') : `<div class="card"><div class="empty"><div class="ill" style="background:var(--good-wash);color:var(--good)">${icon('checkCircle', 'lg')}</div><div class="big">Your data looks clean</div><p>No duplicates, gaps or inconsistent labels were found.</p><a class="btn btn-primary" style="margin-top:14px" href="#/app/summary">Read the summary</a></div></div>`}
      ${list.some(i => i.kind === 'outlier') ? `<p class="muted" style="font-size:12.5px;margin-top:10px">${icon('info', 'sm')} Unusual values are never changed automatically — they are often real (a large order, a top student).</p>` : ''}
    </div>
    <div class="stack">
      <div class="card card-b">
        <div class="qring" style="background:conic-gradient(${color} ${q.score * 3.6}deg, var(--surface-3) 0)"><b>${q.score}</b></div>
        <div style="text-align:center;font-weight:650;margin-bottom:14px">${esc(q.grade)} data quality</div>
        <div class="qparts">${q.parts.map(p => `<div><span class="muted">${esc(p.t)} <span class="faint">· ${esc(p.detail)}</span></span><span class="pen ${p.pen ? 'neg' : ''}">${p.pen ? '−' + p.pen : '0'}</span></div>`).join('')}</div>
      </div>
      <div class="card card-b">
        <b style="display:block;margin-bottom:10px">Before → after</b>
        <div class="qparts">
          <div><span class="muted">Rows</span><span>${fmtInt(o.N)} → <b>${fmtInt(c.N)}</b></span></div>
          <div><span class="muted">Columns</span><span>${o.columns.length} → <b>${c.columns.length}</b></span></div>
          <div><span class="muted">Missing cells</span><span>${fmtInt(miss(o))} → <b>${fmtInt(miss(c))}</b></span></div>
          <div><span class="muted">Duplicate rows</span><span>${fmtInt(o.duplicates)} → <b>${fmtInt(c.duplicates)}</b></span></div>
        </div>
      </div>
      <div class="card card-b">
        <b style="display:block;margin-bottom:10px">Change log</b>
        ${a.log.length ? `<div class="log">${a.log.slice().reverse().map(l => `<div class="log-item">${icon('check', 'sm')}<div><div>${esc(l.msg)}</div><div class="t">${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div></div>`).join('')}</div>` : '<p class="muted" style="font-size:13px">No changes yet.</p>'}
      </div>
    </div>
  </div>`;
}

/* ==========================================================================
   Data table
   ========================================================================== */
let dt = { key: null, q: '', sort: null, dir: 1, page: 0 };
function renderData(el) {
  const a = S.a;
  if (dt.key !== a.id + ':' + a.version) dt = { key: a.id + ':' + a.version, q: dt.key && dt.key.startsWith(a.id) ? dt.q : '', sort: null, dir: 1, page: 0 };
  el.innerHTML = `
  <div class="page-head"><div><h1>Data</h1><p>The working dataset after cleaning — ${fmtInt(a.ds.length)} rows × ${a.ds.cols.length} columns. Click a header to sort; blank cells are shaded.</p></div>
    <button class="btn btn-sm" data-action="export-csv">${icon('download', 'sm')}Download CSV</button></div>
  <div class="toolbar"><div class="search-wrap">${icon('search', 'sm')}<input class="input" id="dt-q" placeholder="Search all columns…" value="${esc(dt.q)}" aria-label="Search rows"></div><span class="muted" id="dt-count" style="font-size:13px"></span><div class="pager" id="dt-pager"></div></div>
  <div id="dt-mount"></div>`;
  let t;
  $('#dt-q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { dt.q = e.target.value; dt.page = 0; drawTable(); }, 180); });
  drawTable();
}
function drawTable() {
  const a = S.a, m = model(), cols = a.ds.cols;
  let idx = a.ds.rows.map((_, i) => i);
  if (dt.q) { const q = dt.q.toLowerCase(); idx = idx.filter(i => cols.some(c => String(a.ds.rows[i][c] ?? '').toLowerCase().includes(q))); }
  if (dt.sort) {
    const c = dt.sort, meta = m.cols[c], num = meta && meta.profile.type === 'numeric', date = meta && meta.profile.type === 'date';
    const key = num ? a.ds.num(c) : date ? a.ds.date(c) : a.ds.str(c);
    idx.sort((x, y) => { const u = key[x], v = key[y]; const um = u == null || (typeof u === 'number' && !Number.isFinite(u)), vm = v == null || (typeof v === 'number' && !Number.isFinite(v)); if (um && vm) return 0; if (um) return 1; if (vm) return -1; return (num || date ? u - v : String(u).localeCompare(String(v), undefined, { numeric: true })) * dt.dir; });
  }
  const per = 50, pages = Math.max(1, Math.ceil(idx.length / per));
  dt.page = Math.min(dt.page, pages - 1);
  const slice = idx.slice(dt.page * per, dt.page * per + per);
  $('#dt-count').textContent = `${fmtInt(idx.length)} ${dt.q ? 'matching ' : ''}rows`;
  $('#dt-pager').innerHTML = `<span>Page ${dt.page + 1} of ${pages}</span><button class="btn btn-sm btn-icon" data-action="dt-page" data-d="-1" ${dt.page === 0 ? 'disabled' : ''} aria-label="Previous page">${icon('chevR', 'sm').replace('<svg', '<svg style="transform:rotate(180deg)"')}</button><button class="btn btn-sm btn-icon" data-action="dt-page" data-d="1" ${dt.page >= pages - 1 ? 'disabled' : ''} aria-label="Next page">${icon('chevR', 'sm')}</button>`;
  $('#dt-mount').innerHTML = `<div class="tbl-wrap" style="max-height:68vh"><table class="table compact"><thead><tr><th class="n faint">#</th>${cols.map(c => { const meta = m.cols[c]; const num = meta && meta.profile.type === 'numeric'; return `<th class="sortable ${dt.sort === c ? 'sorted' : ''} ${num ? 'n' : ''}" data-action="dt-sort" data-col="${esc(c)}">${esc(c)}<span class="arrow">${dt.sort === c ? (dt.dir > 0 ? '↑' : '↓') : '↕'}</span><span class="ty">${esc(meta ? (ROLE_INFO[meta.role] || {}).label || meta.role : '')}</span></th>`; }).join('')}</tr></thead>
    <tbody>${slice.map(i => `<tr><td class="n faint">${i + 1}</td>${cols.map(c => { const v = a.ds.rows[i][c]; const meta = m.cols[c]; return isMissing(v) ? '<td class="miss"></td>' : `<td class="${meta && meta.profile.type === 'numeric' ? 'n' : ''}">${esc(v)}</td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length + 1}" class="muted" style="text-align:center;padding:30px">No rows match “${esc(dt.q)}”.</td></tr>`}</tbody></table></div>`;
}

/* ==========================================================================
   Correlations
   ========================================================================== */
let corrSel = null;
function renderCorrelations(el) {
  const m = model();
  const ms = m.measures.slice(0, 14);
  if (ms.length < 2) {
    el.innerHTML = `<div class="page-head"><div><h1>Correlations</h1></div></div><div class="card"><div class="empty"><div class="ill">${icon('grid', 'lg')}</div><div class="big">Not enough measures</div><p>Correlations need at least two numeric measures. This dataset has ${ms.length}. You can promote a numeric column to a Measure on the Columns page.</p><a class="btn" style="margin-top:14px" href="#/app/columns">Open Columns</a></div></div>`;
    return;
  }
  const n = ms.length, mat = [], pairs = [];
  for (let i = 0; i < n; i++) { mat[i] = []; for (let j = 0; j < n; j++) mat[i][j] = i === j ? { r: 1 } : null; }
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const p = pearson(S.a.ds.num(ms[i].name), S.a.ds.num(ms[j].name)); mat[i][j] = mat[j][i] = p; if (Number.isFinite(p.r)) pairs.push({ i, j, r: p.r, n: p.n }); }
  pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  if (!corrSel || !ms[corrSel.i] || !ms[corrSel.j] || corrSel.key !== S.a.id) corrSel = pairs[0] ? { i: pairs[0].i, j: pairs[0].j, key: S.a.id } : null;
  const cell = r => {
    if (!Number.isFinite(r)) return 'background:var(--surface-2);color:var(--faint)';
    const a = Math.min(1, Math.abs(r));
    const c = r >= 0 ? '42,120,214' : '179,55,42';
    return `background:rgba(${c},${(0.08 + a * 0.82).toFixed(2)});color:${a > 0.55 ? '#fff' : 'var(--ink)'}`;
  };
  const word = r => (Math.abs(r) >= 0.7 ? 'strong' : Math.abs(r) >= 0.5 ? 'moderate' : Math.abs(r) >= 0.3 ? 'weak' : 'no real');
  let detail = '';
  if (corrSel) {
    const A = ms[corrSel.i], B = ms[corrSel.j], r = mat[corrSel.i][corrSel.j].r;
    const xa = S.a.ds.num(A.name), ya = S.a.ds.num(B.name), pts = [];
    const step = Math.max(1, Math.floor(xa.length / 1200));
    for (let k = 0; k < xa.length; k += step) if (Number.isFinite(xa[k]) && Number.isFinite(ya[k])) pts.push([xa[k], ya[k]]);
    detail = `<div class="card" style="margin-top:16px"><div class="card-h"><div><h3>${esc(A.label)} vs ${esc(B.label)}</h3><div class="sub">${Number.isFinite(r) ? `r = ${r.toFixed(2)} — a ${word(r)} ${r >= 0 ? 'positive' : 'negative'} relationship` : 'Not enough overlapping values'}</div></div></div>
      <div class="card-b">${Number.isFinite(r) && Math.abs(r) >= 0.3 ? `<p class="narr" style="margin-bottom:12px"><span>When <b>${esc(A.short.toLowerCase())}</b> is higher, <b>${esc(B.short.toLowerCase())}</b> tends to be ${r > 0 ? 'higher' : 'lower'}. Correlation shows they move together — not that one causes the other.</span></p>` : `<p class="muted" style="margin-bottom:12px">These two measures don't move together in any consistent way.</p>`}
      ${chartSlot({ type: 'scatter', points: pts, xLabel: A.label, yLabel: B.label, fx: v => fmtMeasure(A, v, { compact: true, agg: 'median' }), fy: v => fmtMeasure(B, v, { compact: true, agg: 'median' }) })}</div></div>`;
  }
  el.innerHTML = `
  <div class="page-head"><div><h1>Correlations</h1><p>Which measures rise and fall together. Click any cell to see the relationship up close.</p></div></div>
  <div class="clean-grid" style="grid-template-columns:minmax(0,1fr) 320px">
    <div class="card"><div class="card-b heat"><table><thead><tr><th></th>${ms.map(x => `<th title="${esc(x.label)}">${esc(x.short.length > 12 ? x.short.slice(0, 11) + '…' : x.short)}</th>`).join('')}</tr></thead>
      <tbody>${ms.map((x, i) => `<tr><th class="rh" title="${esc(x.label)}">${esc(x.short.length > 18 ? x.short.slice(0, 17) + '…' : x.short)}</th>${ms.map((_, j) => { const p = mat[i][j]; const r = p ? p.r : NaN; return `<td style="${cell(r)}" class="${corrSel && ((corrSel.i === i && corrSel.j === j) || (corrSel.i === j && corrSel.j === i)) ? 'sel' : ''}" ${i !== j ? `data-action="corr-pick" data-i="${i}" data-j="${j}"` : ''} data-tip="${esc(`${x.label} ↔ ${ms[j].label}\u001f r = ${Number.isFinite(r) ? r.toFixed(2) : 'n/a'}`)}">${Number.isFinite(r) ? r.toFixed(2).replace('-', '−') : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
      <div class="scale-legend"><span>−1</span><span class="bar"></span><span>+1</span><span style="margin-left:8px">Red: move in opposite directions · Blue: move together</span></div></div></div>
    <div class="card"><div class="card-h"><h3>Strongest relationships</h3></div><div class="card-b" style="padding-top:6px">
      ${pairs.slice(0, 10).map(p => `<div class="pair" data-action="corr-pick" data-i="${p.i}" data-j="${p.j}"><span><b>${esc(ms[p.i].short)}</b> <span class="muted">↔</span> <b>${esc(ms[p.j].short)}</b><span class="muted" style="display:block;font-size:12px">${word(p.r)} ${p.r >= 0 ? 'positive' : 'negative'}</span></span><span class="r" style="color:${p.r >= 0 ? 'var(--s1)' : 'var(--bad)'}">${p.r >= 0 ? '+' : '−'}${Math.abs(p.r).toFixed(2)}</span></div>`).join('')}
    </div></div>
  </div>
  ${detail}`;
}

/* ==========================================================================
   Wiring
   ========================================================================== */
export const VIEWS = { summary: renderSummary, explore: renderExplore, columns: renderColumns, cleaning: renderCleaning, data: renderData, correlations: renderCorrelations };

export const actions = {
  scrollto: el => { const t = document.getElementById(el.dataset.target); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'toggle-issue': el => el.closest('.issue').classList.toggle('open'),
  fix: el => { const msg = fix(el.dataset.id, el.dataset.mode); if (msg) toast(msg, 'good'); },
  'fix-all': () => { const n = fixAll(); toast(n ? `Applied ${n} fix${n > 1 ? 'es' : ''}. Unusual values were left for you to review.` : 'Nothing to fix', n ? 'good' : ''); },
  'preview-issue': el => { const is = issues().find(x => x.id === el.dataset.id); if (!is) return; openModal({ title: `${is.title}${is.col ? ' — ' + is.col : ''}`, body: `<p style="margin-bottom:12px">${esc(is.problem)}</p>${issuePreview(is)}`, wide: true, actions: [{ label: 'Close' }, { label: is.options[0].label, cls: 'btn-primary', run: () => { const msg = fix(is.id, is.options[0].mode); if (msg) toast(msg, 'good'); } }] }); },
  undo: () => { if (undo()) toast('Undone'); },
  'reset-data': () => { resetToOriginal(); toast('Back to the original data. Use Undo to reverse.'); },
  'reset-roles': () => { S.a.roles = {}; setSetting('currency', S.a.settings.currency); toast('Column roles reset to automatic'); },
  'dt-sort': el => { const c = el.dataset.col; if (dt.sort === c) dt.dir *= -1; else { dt.sort = c; dt.dir = 1; } drawTable(); },
  'dt-page': el => { dt.page += +el.dataset.d; drawTable(); },
  'corr-pick': el => { corrSel = { i: +el.dataset.i, j: +el.dataset.j, key: S.a.id }; rerender(); requestAnimationFrame(() => { const c = $('#view .card:last-child'); if (c && window.innerWidth < 1080) c.scrollIntoView({ behavior: 'smooth' }); }); },
  'ex-csv': () => { if (!ex || !ex._table) return; const t = ex._table; download(`${S.a.title.replace(/[^\w-]+/g, '_')}_explore.csv`, window.Papa.unparse({ fields: t.head, data: t.rows }), 'text/csv'); },
  'copy-summary': async () => { const ok = await copyText(summaryText()); toast(ok ? 'Summary copied — paste it anywhere' : 'Copy failed', ok ? 'good' : 'bad'); },
};

export function summaryText() {
  const st = story();
  const lines = [`${st.title}`, '', stripTags(st.about), '', 'Key takeaways:'];
  st.takeaways.forEach(t => lines.push('• ' + stripTags(t.html)));
  if (st.recs.length) { lines.push('', 'What to do next:'); st.recs.forEach((r, i) => lines.push(`${i + 1}. ${stripTags(r.html)}`)); }
  lines.push('', 'Made with Clarity');
  return lines.join('\n');
}

document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el || !S.a) return;
  const kind = el.dataset.change;
  if (kind === 'currency') setSetting('currency', el.value);
  else if (kind === 'role') {
    const col = el.dataset.col;
    setRole(col, el.value === model().cols[col].auto ? 'auto' : el.value);
    const m = model(), meta = m.cols[col];
    if (meta.role !== el.value) toast(`${meta.reason}. “${meta.label}” stays ${ROLE_INFO[meta.role].label.toLowerCase()}.`, 'bad');
    else toast(`“${meta.label}” is now treated as ${ROLE_INFO[meta.role].label.toLowerCase()}. The report has been updated.`, 'good');
  } else if (kind === 'ex') {
    ex[el.dataset.k] = el.value;
    if (el.dataset.k === 'measure') { const mm = model().cols[el.value]; if (mm) ex.agg = mm.agg === 'sum' ? 'sum' : 'mean'; }
    if (el.dataset.k === 'by') ex.byUnit = 'auto';
    if (el.dataset.k === 'fcol') ex.fval = '';
    rerender();
  }
});
