/* ==========================================================================
   Clarity — application state
   One current analysis at a time. The working dataset is immutable-by-
   convention: every change produces a new rows array, so undo is cheap.
   Derived things (profile, semantic model, story) are cached per version.
   ========================================================================== */
import { Dataset, profileDataset, qualityScore, detectIssues, applyFix as engineFix, defaultMode } from './data.js';
import { understand } from './semantics.js';
import { buildStory, prettyTitle } from './story.js';
import { idbGet, idbSet, idbDel } from './store.js';

export const S = {
  user: null,        // Supabase user
  profile: null,     // { full_name, team }
  guest: false,      // exploring a sample without an account
  analyses: null,    // cached list of saved analyses
  authCfg: { google: true },
  a: null,           // current analysis
};

const listeners = new Set();
export const onStateChange = fn => listeners.add(fn);
const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

export const dateFallback = () => (/^en-US$/i.test(navigator.language || '') ? 'mdy' : 'dmy');
const HISTORY_MAX = 20;

/**
 * Start a new analysis from parsed rows.
 * opts: { name, rows, cols, size, source: 'upload'|'sample'|'saved', saved?: row, log?, roles?, settings?, note? }
 */
export function startAnalysis(opts) {
  const ds = new Dataset(opts.rows, opts.cols);
  const prof = profileDataset(ds, dateFallback());
  S.a = {
    id: Date.now().toString(36),
    name: opts.name,
    title: prettyTitle(opts.name),
    size: opts.size || 0,
    source: opts.source,
    saved: opts.saved || null,          // saved analysis row (when opened from the dashboard)
    origRows: opts.rows, origCols: opts.cols.slice(),
    origProf: opts.origProf || prof,
    ds, prof,
    log: opts.log || [],
    history: [],
    roles: opts.roles || {},
    settings: { currency: 'auto', ...(opts.settings || {}) },
    context: opts.context || '',
    dirty: opts.source !== 'saved',
    version: 0,
    _c: {},
  };
  persistSoon();
  emit();
  return S.a;
}

export const clearAnalysis = () => { S.a = null; idbDel('session'); emit(); };

function setWorking(rows, cols, msg) {
  const a = S.a;
  a.history.push({ ds: a.ds, prof: a.prof, log: a.log.slice() });
  if (a.history.length > HISTORY_MAX) a.history.shift();
  a.ds = new Dataset(rows, cols, { dateOrder: { ...a.ds.dateOrder } });
  a.prof = profileDataset(a.ds, dateFallback());
  if (msg) a.log = [...a.log, { t: new Date().toISOString(), msg }];
  touch();
}
function touch() { const a = S.a; a.version++; a._c = {}; a.dirty = true; persistSoon(); emit(); }

export const quality = () => cached('q', () => qualityScore(S.a.prof));
export const issues = () => cached('i', () => detectIssues(S.a.prof));
export const model = () => cached('m', () => understand(S.a.ds, S.a.prof, S.a.roles, S.a.settings));
export const story = () => cached('s', () => buildStory(S.a.ds, S.a.prof, model(), {
  datasetName: S.a.name, quality: quality(),
  openIssues: issues().filter(i => i.kind !== 'outlier' && i.severity !== 'low').length,
}));
function cached(k, fn) { const c = S.a._c; if (!(k in c)) c[k] = fn(); return c[k]; }

/** Apply one fix. Returns the log message. */
export function fix(issueId, mode) {
  const a = S.a;
  const is = issues().find(x => x.id === issueId);
  if (!is) return null;
  const m = mode || defaultMode(is) || is.options[0].mode;
  const r = engineFix(a.ds, a.prof, is, m);
  if (!r.dataChanged) { a.log = [...a.log, { t: new Date().toISOString(), msg: r.msg }]; a.acknowledged = { ...(a.acknowledged || {}), [issueId]: true }; touch(); return r.msg; }
  setWorking(r.rows, r.cols, r.msg);
  return r.msg;
}

/** Apply every recommended fix (never touches outliers). Returns the number applied. */
export function fixAll() {
  const a = S.a;
  const start = { ds: a.ds, prof: a.prof, log: a.log.slice() };
  let n = 0, guard = 0;
  let ds = a.ds, prof = a.prof, log = a.log.slice();
  while (guard++ < 60) {
    const is = detectIssues(prof).find(x => x.kind !== 'outlier');
    if (!is) break;
    const r = engineFix(ds, prof, is, defaultMode(is));
    if (!r.dataChanged) break;
    ds = new Dataset(r.rows, r.cols, { dateOrder: { ...ds.dateOrder } });
    prof = profileDataset(ds, dateFallback());
    log.push({ t: new Date().toISOString(), msg: r.msg });
    n++;
  }
  if (!n) return 0;
  a.history.push(start);
  if (a.history.length > HISTORY_MAX) a.history.shift();
  a.ds = ds; a.prof = prof; a.log = log;
  touch();
  return n;
}

export function undo() {
  const a = S.a;
  const h = a.history.pop();
  if (!h) return false;
  a.ds = h.ds; a.prof = h.prof; a.log = h.log;
  touch();
  return true;
}

export function resetToOriginal() {
  const a = S.a;
  a.history.push({ ds: a.ds, prof: a.prof, log: a.log.slice() });
  a.ds = new Dataset(a.origRows, a.origCols.slice());
  a.prof = profileDataset(a.ds, dateFallback());
  a.log = [];
  touch();
}

export function setRole(col, role) {
  const a = S.a;
  if (!role || role === 'auto') { const r = { ...a.roles }; delete r[col]; a.roles = r; }
  else a.roles = { ...a.roles, [col]: role };
  touch();
}
export function setSetting(k, v) { S.a.settings = { ...S.a.settings, [k]: v }; touch(); }
export function markSaved(row) { S.a.saved = row; S.a.dirty = false; S.a.source = 'saved'; persistSoon(); emit(); }

/* ---------- persistence (survives refresh) ---------- */
let saveT = null;
function persistSoon() { clearTimeout(saveT); saveT = setTimeout(persist, 700); }
async function persist() {
  const a = S.a;
  if (!a) return;
  const cells = a.ds.rows.length * a.ds.cols.length;
  if (cells > 3_000_000) return;
  await idbSet('session', {
    owner: S.user ? S.user.id : 'guest', name: a.name, size: a.size, source: a.source, saved: a.saved,
    rows: a.ds.rows, cols: a.ds.cols, origRows: cells < 1_500_000 ? a.origRows : null, origCols: a.origCols,
    log: a.log, roles: a.roles, settings: a.settings, context: a.context, dirty: a.dirty, at: Date.now(),
  });
}
export async function restoreSession(owner) {
  const s = await idbGet('session');
  if (!s || s.owner !== owner || !s.rows) return false;
  if (Date.now() - (s.at || 0) > 7 * 86400000) { idbDel('session'); return false; }
  const origDs = s.origRows ? new Dataset(s.origRows, s.origCols) : null;
  startAnalysis({ name: s.name, rows: s.rows, cols: s.cols, size: s.size, source: s.source, saved: s.saved, log: s.log, roles: s.roles, settings: s.settings, context: s.context,
    origProf: origDs ? profileDataset(origDs, dateFallback()) : undefined });
  if (s.origRows) { S.a.origRows = s.origRows; S.a.origCols = s.origCols; }
  S.a.dirty = !!s.dirty;
  return true;
}
