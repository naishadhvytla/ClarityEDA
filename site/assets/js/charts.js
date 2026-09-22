/* ==========================================================================
   Clarity — chart renderer
   Small, dependency-free charts. Horizontal bars and dumbbells are HTML (crisp
   text at any width); lines, columns, histograms and scatters are SVG drawn at
   the container's real width. Colours come from CSS variables so light/dark
   themes and exported reports share one definition.
   Every mark carries data-tip for the hover tooltip; tables carry the values
   for anyone who can't hover.
   ========================================================================== */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tip = (...parts) => esc(parts.filter(p => p != null && p !== '').join('\u001f'));

/* ---------- nice axis ticks ---------- */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { if (min === 0) return [0, 1]; min = Math.min(0, min); max = Math.max(0, max) || 1; }
  const span = max - min;
  const raw = span / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : +v.toPrecision(12));
  return out;
}

/* ==========================================================================
   HTML charts
   ========================================================================== */

/** Horizontal bars: label · bar · value. */
export function htmlBars(spec) {
  const data = spec.data.filter(d => Number.isFinite(d.value));
  if (!data.length) return `<div class="ch-empty">No values to chart.</div>`;
  const max = spec.max != null ? Math.max(spec.max === 1 ? Math.max(...data.map(d => d.value)) * 1.08 : spec.max, 1e-12) : Math.max(...data.map(d => d.value), spec.ref ? spec.ref.value : 0, 1e-12);
  const min = Math.min(0, ...data.map(d => d.value));
  const span = max - min || 1;
  const pos = v => ((v - min) / span) * 100;
  const refX = spec.ref && Number.isFinite(spec.ref.value) ? pos(spec.ref.value) : null;
  const rows = data.map(d => {
    const w = Math.max(0.6, pos(d.value) - pos(0));
    const cls = d.other || d.void ? 'muted' : '';
    return `<div class="hb-row${spec.compact ? ' compact' : ''}" data-tip="${tip(d.label, d.text, d.sub, d.n != null ? d.n.toLocaleString('en-US') + ' rows' : '')}" tabindex="0">
      <div class="hb-label" title="${esc(d.label)}">${esc(d.label)}</div>
      <div class="hb-track">${refX != null ? `<i class="hb-ref" style="left:${refX.toFixed(2)}%"></i>` : ''}<i class="hb-bar ${cls}" style="left:${pos(0).toFixed(2)}%;width:${w.toFixed(2)}%"></i></div>
      <div class="hb-val"><b>${esc(d.text)}</b>${d.sub && !spec.compact ? `<span>${esc(d.sub)}</span>` : ''}</div>
    </div>`;
  }).join('');
  const ref = refX != null ? `<div class="hb-reflegend"><i></i>${esc(spec.ref.label)}: ${esc(spec.fmt ? spec.fmt(spec.ref.value) : spec.ref.value)}</div>` : '';
  return `<div class="hbars">${rows}</div>${ref}`;
}

/** Dumbbell rows comparing two groups; each row has its own scale. */
export function htmlDumbbell(spec) {
  const rows = spec.rows.map(r => {
    const lo = Math.min(r.min, r.a, r.b), hi = Math.max(r.max, r.a, r.b);
    const span = hi - lo || 1;
    const pa = ((r.a - lo) / span) * 100, pb = ((r.b - lo) / span) * 100;
    const left = Math.min(pa, pb), width = Math.abs(pa - pb);
    return `<div class="db-row" tabindex="0" data-tip="${tip(r.label, `${spec.aLabel}: ${r.fa}`, `${spec.bLabel}: ${r.fb}`)}">
      <div class="db-label" title="${esc(r.label)}">${esc(r.label)}</div>
      <div class="db-track"><i class="db-line" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></i>
        <i class="db-dot s2" style="left:${pa.toFixed(2)}%"></i><i class="db-dot s1" style="left:${pb.toFixed(2)}%"></i></div>
      <div class="db-vals"><span><i class="key s2"></i>${esc(r.fa)}</span><span><i class="key s1"></i>${esc(r.fb)}</span></div>
    </div>`;
  }).join('');
  return `<div class="ch-legend"><span><i class="key s2"></i>${esc(spec.aLabel)}</span><span><i class="key s1"></i>${esc(spec.bLabel)}</span></div><div class="dumbbell">${rows}</div>`;
}

/* ==========================================================================
   SVG charts (drawn at a known pixel width)
   ========================================================================== */
const FONT = 'font-family="inherit"';

function yAxis(ticks, y, W, padL, fmt) {
  return ticks.map(t => `<line class="c-grid" x1="${padL}" x2="${W}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="c-tick" x="${padL - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end" ${FONT}>${esc(fmt(t))}</text>`).join('');
}

function xLabels(labels, x, H, maxLabels) {
  const n = labels.length;
  const every = Math.max(1, Math.ceil(n / maxLabels));
  let out = '';
  labels.forEach((l, i) => {
    if (i % every !== 0 && i !== n - 1) return;
    if (i !== n - 1 && n - 1 - i < every && i !== 0) return;
    out += `<text class="c-tick" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" ${FONT}>${esc(l)}</text>`;
  });
  return out;
}

/** Line / area chart. spec: { x:[labels], series:[{name, values}], fmt, fmtAxis, yMin, area, legend } */
export function svgLine(spec, W) {
  W = Math.max(260, Math.round(W));
  const H = spec.height || (W < 480 ? 200 : 240);
  const multi = spec.series.length > 1;
  const all = spec.series.flatMap(s => s.values).filter(Number.isFinite);
  if (!all.length) return `<div class="ch-empty">No values to chart.</div>`;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (spec.yMin != null) lo = Math.min(lo, spec.yMin);
  const ticks = niceTicks(lo, hi, W < 480 ? 4 : 5);
  const fa = spec.fmtAxis || spec.fmt || (v => v);
  const tickW = Math.max(...ticks.map(t => String(fa(t)).length)) * 6.6 + 14;
  const padL = Math.min(90, Math.max(34, tickW)), padR = multi ? 14 : 56, padT = 12, padB = 26;
  const n = spec.x.length;
  const x = i => padL + (n === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1));
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const y = v => padT + (1 - (v - y0) / (y1 - y0 || 1)) * (H - padT - padB);
  let svg = yAxis(ticks, y, W - padR, padL, fa);
  svg += `<line class="c-axis" x1="${padL}" x2="${W - padR}" y1="${y(Math.max(y0, Math.min(y1, 0 >= y0 && 0 <= y1 ? 0 : y0))).toFixed(1)}" y2="${y(Math.max(y0, Math.min(y1, 0 >= y0 && 0 <= y1 ? 0 : y0))).toFixed(1)}"/>`;
  spec.series.forEach((s, si) => {
    const cls = multi ? `s${si + 1}` : 'sc';
    const segs = [];
    let cur = [];
    s.values.forEach((v, i) => { if (Number.isFinite(v)) cur.push([x(i), y(v)]); else if (cur.length) { segs.push(cur); cur = []; } });
    if (cur.length) segs.push(cur);
    for (const seg of segs) {
      const d = seg.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
      if (spec.area && !multi && seg.length > 1) svg += `<path class="c-area ${cls}" d="${d}L${seg[seg.length - 1][0].toFixed(1)},${y(y0).toFixed(1)}L${seg[0][0].toFixed(1)},${y(y0).toFixed(1)}Z"/>`;
      svg += `<path class="c-line ${cls}" d="${d}"/>`;
      if (seg.length === 1) svg += `<circle class="c-dot ${cls}" cx="${seg[0][0].toFixed(1)}" cy="${seg[0][1].toFixed(1)}" r="4"/>`;
    }
    if (n <= 40) s.values.forEach((v, i) => { if (Number.isFinite(v)) svg += `<circle class="c-pt ${cls}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${n <= 14 ? 3.5 : 2.5}"/>`; });
    const li = s.values.map((v, i) => (Number.isFinite(v) ? i : -1)).filter(i => i >= 0).pop();
    if (li != null && !multi) {
      svg += `<circle class="c-dot ${cls}" cx="${x(li).toFixed(1)}" cy="${y(s.values[li]).toFixed(1)}" r="4.5"/>`;
      svg += `<text class="c-end" x="${(x(li) + 8).toFixed(1)}" y="${(y(s.values[li]) + 4).toFixed(1)}" ${FONT}>${esc((spec.fmt || fa)(s.values[li]))}</text>`;
    }
  });
  svg += xLabels(spec.x, x, H, Math.max(2, Math.floor((W - padL - padR) / 64)));
  // hover bands: one per x, carrying every series' value
  const bw = n > 1 ? (W - padL - padR) / (n - 1) : W - padL - padR;
  spec.x.forEach((lab, i) => {
    const rows = spec.series.map((s, si) => `${multi ? s.name + ': ' : ''}${Number.isFinite(s.values[i]) ? (spec.fmt || fa)(s.values[i]) : '—'}${multi ? '\u001e' + (si + 1) : ''}`);
    svg += `<g class="c-hit" data-tip="${tip(lab, ...rows)}"><rect x="${(x(i) - bw / 2).toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${H - padT - padB}" fill="transparent"/><line class="c-guide" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${padT}" y2="${H - padB}"/></g>`;
  });
  const legend = multi ? `<div class="ch-legend">${spec.series.map((s, i) => `<span><i class="key line s${i + 1}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `${legend}<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(spec.series.map(s => s.name).join(', '))}">${svg}</svg>`;
}

/** Vertical columns. spec: { data:[{label,value,text}], fmt, ref, max } */
export function svgColumns(spec, W) {
  W = Math.max(260, Math.round(W));
  const H = spec.height || 220;
  const data = spec.data;
  const vals = data.map(d => d.value).filter(Number.isFinite);
  if (!vals.length) return `<div class="ch-empty">No values to chart.</div>`;
  const hi = Math.max(...vals, spec.ref ? spec.ref.value : 0);
  const ticks = niceTicks(0, hi, 4);
  const fa = spec.fmt || (v => v);
  const padL = Math.max(34, Math.max(...ticks.map(t => String(fa(t)).length)) * 6.6 + 14), padR = 8, padT = 22, padB = 28;
  const n = data.length;
  const band = (W - padL - padR) / n;
  const bw = Math.min(56, band * 0.62);
  const y1 = ticks[ticks.length - 1];
  const y = v => padT + (1 - v / (y1 || 1)) * (H - padT - padB);
  let svg = yAxis(ticks, y, W - padR, padL, fa);
  data.forEach((d, i) => {
    if (!Number.isFinite(d.value)) return;
    const cx = padL + band * i + band / 2, top = y(d.value), base = y(0);
    const h = Math.max(1, base - top), r = Math.min(4, h / 2, bw / 2);
    svg += `<g class="c-hit" data-tip="${tip(d.label, d.text, d.n != null ? d.n.toLocaleString('en-US') + ' rows' : '')}"><path class="c-col ${d.muted ? 'muted' : ''}" d="M${(cx - bw / 2).toFixed(1)},${base.toFixed(1)}V${(top + r).toFixed(1)}Q${(cx - bw / 2).toFixed(1)},${top.toFixed(1)} ${(cx - bw / 2 + r).toFixed(1)},${top.toFixed(1)}H${(cx + bw / 2 - r).toFixed(1)}Q${(cx + bw / 2).toFixed(1)},${top.toFixed(1)} ${(cx + bw / 2).toFixed(1)},${(top + r).toFixed(1)}V${base.toFixed(1)}Z"/>
      <rect x="${(cx - band / 2).toFixed(1)}" y="${padT}" width="${band.toFixed(1)}" height="${H - padT - padB}" fill="transparent"/></g>`;
    if (band > 34) svg += `<text class="c-val" x="${cx.toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle" ${FONT}>${esc(d.text)}</text>`;
    svg += `<text class="c-tick" x="${cx.toFixed(1)}" y="${H - 8}" text-anchor="middle" ${FONT}>${esc(String(d.label).length > Math.max(4, band / 7) ? String(d.label).slice(0, Math.max(3, Math.floor(band / 7) - 1)) + '…' : d.label)}</text>`;
  });
  svg += `<line class="c-axis" x1="${padL}" x2="${W - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
  if (spec.ref && Number.isFinite(spec.ref.value)) svg += `<line class="c-ref" x1="${padL}" x2="${W - padR}" y1="${y(spec.ref.value).toFixed(1)}" y2="${y(spec.ref.value).toFixed(1)}"/><text class="c-reflab" x="${W - padR}" y="${(y(spec.ref.value) - 5).toFixed(1)}" text-anchor="end" ${FONT}>${esc(spec.ref.label)} ${esc(fa(spec.ref.value))}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(spec.title || 'Column chart')}">${svg}</svg>`;
}

/** Histogram. spec: { bins:[{x0,x1,count,label}], fmt, median } */
export function svgHist(spec, W, H = 120, mini = false) {
  W = Math.max(160, Math.round(W));
  const bins = spec.bins;
  const maxC = Math.max(...bins.map(b => b.count), 1);
  const padL = 4, padR = 4, padT = 6, padB = mini ? 4 : 20;
  const lo = bins[0].x0, hi = bins[bins.length - 1].x1;
  const x = v => padL + ((v - lo) / (hi - lo || 1)) * (W - padL - padR);
  const y = c => padT + (1 - c / maxC) * (H - padT - padB);
  let svg = '';
  bins.forEach(b => {
    const x0 = x(b.x0) + 1, x1 = x(b.x1) - 1, w = Math.max(1, x1 - x0);
    const top = y(b.count), base = y(0), h = base - top;
    const r = Math.min(3, h / 2, w / 2);
    svg += `<g class="c-hit" data-tip="${tip(b.label, b.count.toLocaleString('en-US') + ' rows')}">${b.count ? `<path class="c-col" d="M${x0.toFixed(1)},${base.toFixed(1)}V${(top + r).toFixed(1)}Q${x0.toFixed(1)},${top.toFixed(1)} ${(x0 + r).toFixed(1)},${top.toFixed(1)}H${(x1 - r).toFixed(1)}Q${x1.toFixed(1)},${top.toFixed(1)} ${x1.toFixed(1)},${(top + r).toFixed(1)}V${base.toFixed(1)}Z"/>` : ''}<rect x="${x(b.x0).toFixed(1)}" y="${padT}" width="${Math.max(1, x(b.x1) - x(b.x0)).toFixed(1)}" height="${H - padT - padB}" fill="transparent"/></g>`;
  });
  svg += `<line class="c-axis" x1="${padL}" x2="${W - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;
  if (Number.isFinite(spec.median) && !mini) svg += `<line class="c-ref" x1="${x(spec.median).toFixed(1)}" x2="${x(spec.median).toFixed(1)}" y1="${padT}" y2="${y(0).toFixed(1)}"/>`;
  if (!mini) {
    const f = spec.fmt || (v => v);
    const intBins = bins[0].x1 - bins[0].x0 === 1;
    svg += `<text class="c-tick" x="${padL}" y="${H - 5}" ${FONT}>${esc(f(intBins ? lo + 0.5 : lo))}</text>`;
    svg += `<text class="c-tick" x="${W - padR}" y="${H - 5}" text-anchor="end" ${FONT}>${esc(f(intBins ? hi - 0.5 : hi))}${spec.clipped ? '+' : ''}</text>`;
    if (Number.isFinite(spec.median)) { const mx = x(spec.median), right = mx > W * 0.6; svg += `<text class="c-reflab" x="${(mx + (right ? -5 : 5)).toFixed(1)}" y="${padT + 9}" text-anchor="${right ? 'end' : 'start'}" ${FONT}>median ${esc(f(spec.median))}</text>`; }
  }
  return `<svg class="chart${mini ? ' mini' : ''}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Distribution">${svg}</svg>`;
}

/** Scatter with least-squares line. spec: { points:[[x,y]], xLabel, yLabel, fx, fy } */
export function svgScatter(spec, W) {
  W = Math.max(260, Math.round(W));
  const H = spec.height || (W < 480 ? 240 : 280);
  const pts = spec.points;
  if (pts.length < 3) return `<div class="ch-empty">Not enough points.</div>`;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const xt = niceTicks(Math.min(...xs), Math.max(...xs), W < 480 ? 4 : 6), yt = niceTicks(Math.min(...ys), Math.max(...ys), 5);
  const fx = spec.fx || (v => v), fy = spec.fy || (v => v);
  const padL = Math.max(36, Math.max(...yt.map(t => String(fy(t)).length)) * 6.6 + 14), padR = 12, padT = 10, padB = 40;
  const X = v => padL + ((v - xt[0]) / (xt[xt.length - 1] - xt[0] || 1)) * (W - padL - padR);
  const Y = v => padT + (1 - (v - yt[0]) / (yt[yt.length - 1] - yt[0] || 1)) * (H - padT - padB);
  let svg = yAxis(yt, Y, W - padR, padL, fy);
  xt.forEach(t => { svg += `<text class="c-tick" x="${X(t).toFixed(1)}" y="${H - 22}" text-anchor="middle" ${FONT}>${esc(fx(t))}</text>`; });
  svg += `<line class="c-axis" x1="${padL}" x2="${W - padR}" y1="${(H - padB).toFixed(1)}" y2="${(H - padB).toFixed(1)}"/>`;
  svg += `<text class="c-axlab" x="${((padL + W - padR) / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" ${FONT}>${esc(spec.xLabel)}</text>`;
  const r = pts.length > 400 ? 2.5 : 3.5;
  pts.forEach(p => { svg += `<circle class="c-sc" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${r}" data-tip="${tip(`${spec.xLabel}: ${fx(p[0])}`, `${spec.yLabel}: ${fy(p[1])}`)}"/>`; });
  // trend line
  const n = pts.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  if (sxx) {
    const k = sxy / sxx, c = my - k * mx;
    const xa = xt[0], xb = xt[xt.length - 1];
    const clampY = v => Math.max(yt[0], Math.min(yt[yt.length - 1], v));
    svg += `<line class="c-trend" x1="${X(xa).toFixed(1)}" y1="${Y(clampY(k * xa + c)).toFixed(1)}" x2="${X(xb).toFixed(1)}" y2="${Y(clampY(k * xb + c)).toFixed(1)}"/>`;
  }
  return `<div class="ch-ylab">${esc(spec.yLabel)}</div><svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(spec.xLabel)} vs ${esc(spec.yLabel)}">${svg}</svg>`;
}

/** Tiny sparkline histogram for column cards. */
export function miniHist(spec, W = 140, H = 34) { return svgHist(spec, W, H, true); }

/** Render any spec to markup at a given width. */
export function renderChart(spec, width) {
  if (!spec) return '';
  switch (spec.type) {
    case 'bar': return htmlBars(spec);
    case 'dumbbell': return htmlDumbbell(spec);
    case 'line': return svgLine(spec, width);
    case 'column': return svgColumns(spec, width);
    case 'hist': return svgHist(spec, width, spec.height || 150);
    case 'scatter': return svgScatter(spec, width);
    default: return '';
  }
}

/* ==========================================================================
   Mounting + tooltip (browser only)
   ========================================================================== */
const registry = new Map();
let seq = 0;

/** Returns a placeholder; call mountCharts(root) after inserting it. */
export function chartSlot(spec, cls = '') {
  if (!spec) return '';
  const id = 'ch' + (++seq);
  registry.set(id, spec);
  if (spec.type === 'bar' || spec.type === 'dumbbell') return `<div class="chart-slot ${cls}" data-chart="${id}">${renderChart(spec)}</div>`;
  return `<div class="chart-slot ${cls}" data-chart="${id}"></div>`;
}

export function mountCharts(root = document) {
  root.querySelectorAll('.chart-slot[data-chart]').forEach(el => {
    const spec = registry.get(el.dataset.chart);
    if (!spec || spec.type === 'bar' || spec.type === 'dumbbell') return;
    const w = el.clientWidth || el.parentElement.clientWidth || 600;
    if (el._w === w) return;
    el._w = w;
    el.innerHTML = renderChart(spec, w);
  });
}

export function clearCharts() { registry.clear(); }

let resizeT;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => mountCharts(document), 120); });
  // One tooltip for every chart. Values lead, labels follow.
  const tt = document.createElement('div');
  tt.className = 'tooltip';
  tt.setAttribute('role', 'tooltip');
  const show = (el, x, y) => {
    const parts = el.getAttribute('data-tip').split('\u001f');
    tt.textContent = '';
    const head = document.createElement('div'); head.className = 'tt-h'; head.textContent = parts[0]; tt.appendChild(head);
    parts.slice(1).forEach((p, i) => {
      const row = document.createElement('div'); row.className = 'tt-r' + (i === 0 ? ' lead' : '');
      const [txt, series] = p.split('\u001e');
      if (series) { const k = document.createElement('i'); k.className = 'key line s' + series; row.appendChild(k); }
      row.appendChild(document.createTextNode(txt));
      tt.appendChild(row);
    });
    if (!tt.isConnected) document.body.appendChild(tt);
    tt.classList.add('on');
    const r = tt.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tt.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  };
  const hide = () => tt.classList.remove('on');
  document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else hide();
  });
  document.addEventListener('focusin', e => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); }
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
}
