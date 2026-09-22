/* Clarity — reading files (CSV, TSV, JSON, Excel) and writing CSV. */
import { CONFIG } from './config.js';

const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve; s.onerror = () => { delete loaded[src]; reject(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  return loaded[src];
}

function cleanHeaders(fields) {
  const seen = new Map();
  return fields.map((f, i) => {
    let h = String(f == null ? '' : f).replace(/^﻿/, '').trim() || `Column ${i + 1}`;
    const k = h.toLowerCase();
    if (seen.has(k)) { const n = seen.get(k) + 1; seen.set(k, n); h = `${h} (${n})`; } else seen.set(k, 1);
    return h;
  });
}

/** Parse delimited text with a header row. Returns { rows, cols, delimiter }. */
export function parseDelimited(text, delimiter = '') {
  const res = window.Papa.parse(text, { header: false, skipEmptyLines: 'greedy', delimiter, dynamicTyping: false });
  const data = res.data;
  if (!data.length) return { rows: [], cols: [] };
  const cols = cleanHeaders(data[0]);
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const a = data[i];
    if (a.length === 1 && String(a[0]).trim() === '') continue;
    const o = {};
    for (let j = 0; j < cols.length; j++) o[cols[j]] = a[j] === undefined ? '' : a[j];
    rows.push(o);
  }
  return { rows, cols, delimiter: res.meta.delimiter };
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && prefix.split('.').length < 2) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

function fromObjects(arr) {
  const flat = arr.filter(o => o && typeof o === 'object').map(o => flatten(o));
  const colSet = new Set();
  flat.forEach(o => Object.keys(o).forEach(k => colSet.add(k)));
  const raw = [...colSet];
  const cols = cleanHeaders(raw);
  const rows = flat.map(o => { const r = {}; raw.forEach((k, i) => { const v = o[k]; r[cols[i]] = v == null ? '' : v; }); return r; });
  return { rows, cols };
}

const pad = n => String(n).padStart(2, '0');
function dateToString(d) {
  const y = d.getFullYear(), m = pad(d.getMonth() + 1), day = pad(d.getDate());
  const hh = d.getHours(), mm = d.getMinutes();
  return hh || mm ? `${y}-${m}-${day} ${pad(hh)}:${pad(mm)}` : `${y}-${m}-${day}`;
}

/** Read a File into { rows, cols, note }. Throws Error with a friendly message. */
export async function readFile(file) {
  const name = file.name || 'data';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (file.size > CONFIG.MAX_FILE_MB * 1048576) throw new Error(`This file is ${(file.size / 1048576).toFixed(0)} MB. Clarity works in your browser and supports files up to ${CONFIG.MAX_FILE_MB} MB.`);
  if (!file.size) throw new Error('This file is empty.');
  if (['csv', 'tsv', 'txt', 'tab'].includes(ext)) {
    const text = await file.text();
    const out = parseDelimited(text, ext === 'tsv' || ext === 'tab' ? '\t' : '');
    if (!out.cols.length || !out.rows.length) throw new Error('No rows were found. Make sure the first line contains column names.');
    return out;
  }
  if (ext === 'json') {
    let j;
    try { j = JSON.parse(await file.text()); } catch (e) { throw new Error('This JSON file could not be read: ' + e.message); }
    let arr = Array.isArray(j) ? j : (j.data || j.records || j.rows || j.items || Object.values(j).find(Array.isArray));
    if (!Array.isArray(arr)) arr = [j];
    if (arr.length && Array.isArray(arr[0])) {
      const cols = cleanHeaders(arr[0]);
      return { rows: arr.slice(1).map(a => Object.fromEntries(cols.map((c, i) => [c, a[i] ?? '']))), cols };
    }
    const out = fromObjects(arr);
    if (!out.rows.length) throw new Error('No records were found in this JSON file.');
    return out;
  }
  if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
    await loadScript('assets/vendor/xlsx-0.20.3.full.min.js');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    let sheetName = null, aoa = null;
    for (const sn of wb.SheetNames) {
      const a = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '', blankrows: false });
      if (a.length > 1) { sheetName = sn; aoa = a; break; }
    }
    if (!aoa) throw new Error('The spreadsheet has no rows of data.');
    // Skip title rows above the header: pick the first row with the most filled cells within the first 10.
    let hi = 0, best = -1;
    for (let i = 0; i < Math.min(10, aoa.length - 1); i++) { const f = aoa[i].filter(v => String(v).trim() !== '').length; if (f > best) { best = f; hi = i; } }
    const cols = cleanHeaders(aoa[hi]);
    const rows = aoa.slice(hi + 1).map(a => { const o = {}; cols.forEach((c, j) => { const v = a[j]; o[c] = v instanceof Date ? dateToString(v) : v == null ? '' : v; }); return o; })
      .filter(r => cols.some(c => String(r[c]).trim() !== ''));
    const keep = cols.filter(c => !/^Column \d+$/.test(c) || rows.some(r => String(r[c]).trim() !== ''));
    const note = wb.SheetNames.length > 1 ? `Using sheet “${sheetName}” (${wb.SheetNames.length} sheets in this file).` : '';
    return { rows: rows.map(r => Object.fromEntries(keep.map(c => [c, r[c]]))), cols: keep, note };
  }
  throw new Error(`“.${ext}” files aren't supported yet. Use CSV, TSV, JSON or Excel (.xlsx, .xls).`);
}

export function toCSV(rows, cols) {
  return window.Papa.unparse({ fields: cols, data: rows.map(r => cols.map(c => (r[c] == null ? '' : r[c]))) });
}
