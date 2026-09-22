/* Clarity — the Report page (a printable document) and its exports. */
import { S, story, model, quality } from './state.js';
import { ROLE_INFO, fmtInt, fmtPct, fmtMeasure, fmtDate } from './semantics.js';
import { chartSlot, renderChart } from './charts.js';
import { esc, icon, toast, download, stripTags } from './ui.js';
import { toCSV } from './io.js';
import { tableHTML } from './views.js';
import { go } from './app.js';

const METHOD = [
  'Column meanings (money, category, date, outcome…) are inferred from column names and values. Review or change them on the Columns page.',
  '“Highest” and “lowest” statements only consider groups with at least 2% of rows (minimum 5), so tiny groups cannot dominate.',
  'Gaps between outcome rates are checked with a two-proportion z-test; gaps that could be chance are labelled as such.',
  '“Explains X% of the variation” is η² — the share of the measure\'s variance that lies between groups.',
  'Relationships use Pearson correlation. Correlation shows that measures move together, not that one causes the other.',
  'Unusual values are found with the 1.5×IQR rule. They are flagged for review and never removed automatically.',
  'Period comparisons split the date range at its midpoint; partially covered first or last periods are excluded from growth figures.',
];

function colSummary(meta) {
  const c = meta.profile;
  if (c.stats) return `${fmtMeasure(meta.role === 'measure' ? meta : null, c.stats.min, { compact: true })} to ${fmtMeasure(meta.role === 'measure' ? meta : null, c.stats.max, { compact: true })}`;
  if (c.dates) return `${fmtDate(c.dates.min)} to ${fmtDate(c.dates.max)}`;
  if (c.top && c.top.length) return `${fmtInt(c.unique)} values; most common “${String(c.top[0][0]).slice(0, 30)}”`;
  return '—';
}

/** The report body. staticCharts=true renders charts inline (for HTML export). */
function docHTML({ staticCharts = false } = {}) {
  const a = S.a, st = story(), m = model(), q = quality();
  const chart = spec => (!spec ? '' : staticCharts ? `<div class="fig">${renderChart(spec, 760)}</div>` : chartSlot(spec));
  const author = S.profile && S.profile.full_name ? S.profile.full_name : S.user ? S.user.email : '';
  const team = S.profile && S.profile.team ? S.profile.team : '';
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  let n = 0;
  const secs = st.sections.map(s => {
    n++;
    const paras = (s.html || []).map(p => `<p>${p}</p>`).join('');
    if (s.items) {
      return `<section class="doc-sec"><h2>${n}. ${esc(s.title)}</h2>${paras}${s.items.map(it => `<h3>${esc(it.title)}</h3>${it.html ? it.html.map(p => `<p>${p}</p>`).join('') : ''}${it.chart && it.chart.type !== 'hist' ? chart(it.chart) : ''}${it.note ? `<p class="muted">${esc(it.note)}</p>` : ''}`).join('')}</section>`;
    }
    const rows = s.table ? s.table.rows.slice(0, 15) : [];
    return `<section class="doc-sec"><h2>${n}. ${esc(s.title)}</h2>${s.subtitle ? `<p class="muted">${esc(s.subtitle)}</p>` : ''}${paras}${chart(s.chart)}${s.chart2 ? `<p class="fig-cap">${esc(s.chart2.title || '')}</p>${chart(s.chart2)}` : ''}
      ${rows.length ? tableHTML(s.table.head, rows, { compact: true }).replace('class="tbl-wrap"', 'class="tbl-wrap" style="border:0"') + (s.table.rows.length > rows.length ? `<p class="muted">Showing ${rows.length} of ${s.table.rows.length} rows.</p>` : '') : ''}</section>`;
  }).join('');
  n++;
  const quality_ = `<section class="doc-sec"><h2>${n}. Data quality and preparation</h2>
    <p>The dataset scores <b>${q.score}/100</b> (${esc(q.grade.toLowerCase())}). The score starts at 100 and subtracts capped penalties for measurable problems:</p>
    ${tableHTML(['Check', 'Detail', 'Penalty'], q.parts.map(p => [p.t, p.detail, p.pen ? '−' + p.pen : '0']), { compact: true })}
    ${a.log.length ? `<h3>Changes made before analysis</h3><ul>${a.log.map(l => `<li>${esc(l.msg)}</li>`).join('')}</ul>` : '<p>No changes were made to the data before analysis.</p>'}</section>`;
  const cols = `<section class="doc-sec"><h2>Appendix A. Column guide</h2>${tableHTML(['Column', 'Used as', 'Type', 'Missing', 'Values'], m.order.map(c => { const meta = m.cols[c]; return [meta.label, ROLE_INFO[meta.role].label, meta.profile.type, meta.profile.missing ? fmtPct(meta.profile.missingPct) : '0', colSummary(meta)]; }), { compact: true })}</section>`;
  const method = `<section class="doc-sec"><h2>Appendix B. Method and limitations</h2><ul>${METHOD.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`;
  return `
    <header class="cover"><span class="eyebrow">Data analysis report</span><h1>${esc(st.title)}</h1>
      <div class="meta">${esc(a.name)} · ${fmtInt(a.ds.length)} rows × ${a.ds.cols.length} columns · ${esc(m.domain.label)}<br>${author ? `Prepared by ${esc(author)}${team ? ' · ' + esc(team) : ''} · ` : ''}${esc(date)}</div>
      ${a.context ? `<div class="callout"><b>Question:</b> ${esc(a.context)}</div>` : ''}
    </header>
    <section class="doc-sec"><h2>Executive summary</h2><p>${st.about}</p>
      <div class="kpi-grid">${st.kpis.map(k => `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="v ${k.text ? 'text' : ''}">${esc(k.value)}</div><div class="s">${esc(k.sub)}</div></div>`).join('')}</div>
      ${st.takeaways.length ? `<h3>Key findings</h3><ol>${st.takeaways.map(t => `<li>${t.html}</li>`).join('')}</ol>` : ''}
      <h3>Recommendations</h3><ol>${st.recs.map(r => `<li>${r.html}</li>`).join('')}</ol>
    </section>
    ${secs}${quality_}${cols}${method}
    <p class="muted" style="margin-top:34px;border-top:1px solid var(--line);padding-top:12px">Generated with Clarity. Every figure in this report was computed from the dataset described above.</p>`;
}

export function renderReport(el) {
  el.innerHTML = `
  <div class="page-head no-print"><div><h1>Report</h1><p>A shareable document of everything Clarity found — ready to print, send or publish.</p></div>
    <div class="row" style="flex-wrap:wrap">
      <button class="btn btn-sm" data-action="export-md">${icon('doc', 'sm')}Markdown</button>
      <button class="btn btn-sm" data-action="export-html">${icon('code', 'sm')}HTML</button>
      <button class="btn btn-sm btn-primary" data-action="export-pdf">${icon('print', 'sm')}Download PDF</button>
    </div></div>
  <article class="doc" id="doc">${docHTML()}</article>`;
}

/* ---------- exports ---------- */
const fileBase = () => (S.a ? S.a.title : 'report').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_');

async function exportHTML() {
  let css = '';
  try { css = await (await fetch('assets/css/app.css', { cache: 'force-cache' })).text(); } catch { /* fall back to minimal styles */ }
  const st = story();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(st.title)} — Clarity report</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>${css}
body{background:var(--bg)}.wrap{max-width:980px;margin:0 auto;padding:32px 20px 60px}</style></head>
<body><div class="wrap"><article class="doc">${docHTML({ staticCharts: true })}</article></div></body></html>`;
  download(`${fileBase()}_report.html`, html, 'text/html');
  toast('HTML report downloaded', 'good');
}

const md = html => stripTags(String(html).replace(/<b>(.*?)<\/b>/g, '**$1**').replace(/<span class="muted">(.*?)<\/span>/g, '_$1_'));
const mdTable = (head, rows) => `| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n${rows.map(r => `| ${r.map(c => String(c).replace(/\|/g, '\\|')).join(' | ')} |`).join('\n')}`;

function exportMarkdown() {
  const a = S.a, st = story(), m = model(), q = quality();
  const out = [`# ${st.title}`, '', `_${a.name} · ${fmtInt(a.ds.length)} rows × ${a.ds.cols.length} columns · ${m.domain.label} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}_`, ''];
  if (a.context) out.push(`> **Question:** ${a.context}`, '');
  out.push('## Executive summary', '', md(st.about), '', mdTable(['Metric', 'Value', 'Note'], st.kpis.map(k => [k.label, k.value, k.sub])), '');
  if (st.takeaways.length) { out.push('### Key findings', ''); st.takeaways.forEach((t, i) => out.push(`${i + 1}. ${md(t.html)}`)); out.push(''); }
  out.push('### Recommendations', ''); st.recs.forEach((r, i) => out.push(`${i + 1}. ${md(r.html)}`)); out.push('');
  st.sections.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title}`, '');
    (s.html || []).forEach(p => out.push(md(p), ''));
    if (s.items) s.items.forEach(it => { out.push(`### ${it.title}`, ''); (it.html || []).forEach(p => out.push(md(p), '')); if (it.note) out.push(`_${it.note}_`, ''); });
    if (s.table && s.table.rows.length) out.push(mdTable(s.table.head, s.table.rows.slice(0, 20)), '');
  });
  out.push('## Data quality', '', `Score: **${q.score}/100** (${q.grade}).`, '');
  if (a.log.length) { out.push('Changes made before analysis:', ''); a.log.forEach(l => out.push(`- ${l.msg}`)); out.push(''); }
  out.push('## Column guide', '', mdTable(['Column', 'Used as', 'Type'], m.order.map(c => [m.cols[c].label, ROLE_INFO[m.cols[c].role].label, m.cols[c].profile.type])), '');
  out.push('## Method and limitations', '', ...METHOD.map(t => `- ${t}`), '', '_Generated with Clarity._');
  download(`${fileBase()}_report.md`, out.join('\n'), 'text/markdown');
  toast('Markdown report downloaded', 'good');
}

function exportPDF() {
  const onReport = location.hash.startsWith('#/app/report');
  if (!onReport) go('#/app/report');
  setTimeout(() => { window.print(); }, onReport ? 50 : 600);
}

function exportCSV() {
  const a = S.a;
  download(`${fileBase()}_cleaned.csv`, toCSV(a.ds.rows, a.ds.cols), 'text/csv');
  toast('Cleaned CSV downloaded', 'good');
}

export const reportActions = {
  'export-pdf': exportPDF,
  'export-html': exportHTML,
  'export-md': exportMarkdown,
  'export-csv': exportCSV,
};
