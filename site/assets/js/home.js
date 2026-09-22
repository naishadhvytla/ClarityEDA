/* Clarity — Home (dashboard) and Profile pages. */
import { S } from './state.js';
import { SAMPLES } from './samples.js';
import { CONFIG } from './config.js';
import * as api from './backend.js';
import { $, esc, safeInline, icon, toast, timeAgo } from './ui.js';
import { setTheme, rerender } from './app.js';

const SAMPLE_ICON = { cart: ['cart', 'c1'], cap: ['cap', 'c3'], users: ['users', 'c2'] };

function greeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = S.profile && S.profile.full_name ? S.profile.full_name.split(' ')[0] : '';
  return name ? `${part}, ${name}` : part;
}

function analysisCard(row) {
  const rep = row.report || {};
  const st = rep.story || {};
  const head = st.takeaways && st.takeaways[0] ? st.takeaways[0].html : st.about || (rep.insights && rep.insights[0] ? esc(rep.insights[0].tx) : '');
  const q = row.quality ?? (rep.quality && rep.quality.score);
  const isOpen = S.a && S.a.saved && S.a.saved.id === row.id;
  return `<article class="acard">
    <div class="ab">
      <div class="at"><div style="min-width:0"><div class="an">${esc(row.name)}</div><div class="ad">${esc(row.dataset_name || '')} · saved ${esc(timeAgo(row.created_at))}</div></div>
        ${st.domain ? `<span class="pill accent">${esc(st.domain.label)}</span>` : ''}</div>
      ${head ? `<p class="ah">${safeInline(head)}</p>` : ''}
      <div class="as"><div><b>${(row.rows || 0).toLocaleString('en-US')}</b><span>rows</span></div><div><b>${esc(row.cols ?? '—')}</b><span>columns</span></div><div><b>${esc(q ?? '—')}</b><span>quality</span></div></div>
    </div>
    <div class="af">
      <button class="btn btn-sm btn-primary" data-action="open" data-id="${esc(row.id)}">${isOpen ? 'Continue' : 'Open'}</button>
      <button class="btn btn-sm" data-action="open" data-id="${esc(row.id)}" data-view="report">${icon('doc', 'sm')}Report</button>
      <button class="btn btn-sm btn-ghost btn-danger" style="margin-left:auto" data-action="delete" data-id="${esc(row.id)}" aria-label="Delete ${esc(row.name)}">${icon('trash', 'sm')}</button>
    </div>
  </article>`;
}

export function renderHome(el) {
  const list = S.analyses;
  const a = S.a;
  const cont = a && (!a.saved || a.dirty) ? `<div class="card" style="margin-bottom:18px;padding:16px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <span class="dz-ic" style="width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:var(--accent-wash);color:var(--accent-ink)">${icon('sparkles')}</span>
      <div style="flex:1;min-width:200px"><b>Continue: ${esc(a.title)}</b><div class="muted" style="font-size:13px">${a.ds.length.toLocaleString('en-US')} rows · ${a.source === 'sample' ? 'sample dataset' : a.saved ? 'unsaved changes' : 'not saved yet'}</div></div>
      <a class="btn btn-sm" href="#/app/summary">Open summary</a>${S.user && a.source !== 'sample' ? `<button class="btn btn-sm btn-primary" data-action="save">${icon('save', 'sm')}Save</button>` : ''}
    </div>` : '';
  const samples = SAMPLES.map(s => `<button class="sample" data-action="sample" data-id="${s.id}"><span class="si ${SAMPLE_ICON[s.icon][1]}">${icon(SAMPLE_ICON[s.icon][0])}</span><span><b>${esc(s.title)}</b><span>${esc(s.blurb)}</span></span><span class="go">${icon('arrowR', 'sm')}</span></button>`).join('');
  let saved = '';
  if (!S.user) saved = `<div class="card card-b" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:220px"><b>Save your analyses</b><p class="muted" style="font-size:13.5px;margin-top:4px">Create a free account to upload your own files and keep up to ${CONFIG.MAX_SAVED} reports.</p></div><a class="btn btn-primary" href="#/signup">Create free account</a></div>`;
  else if (!list) saved = `<div class="analyses">${[0, 1].map(() => `<div class="skel" style="height:220px;border-radius:14px"></div>`).join('')}</div>`;
  else {
    const cards = list.map(analysisCard);
    for (let i = list.length; i < CONFIG.MAX_SAVED; i++) cards.push(`<div class="slot-empty"><div><b>Empty slot</b>Upload a file or open a sample, then press Save.<div style="margin-top:14px"><button class="btn btn-sm" data-action="upload">${icon('upload', 'sm')}Upload file</button></div></div></div>`);
    saved = `<div class="analyses">${cards.join('')}</div>`;
  }
  el.innerHTML = `
  <div class="page-head"><div><h1>${esc(S.user ? greeting() : 'Welcome to the Clarity demo')}</h1><p>${S.user ? 'Upload a spreadsheet and get a written report on it in seconds.' : 'Pick a sample to see what Clarity writes about it.'}</p></div></div>
  ${cont}
  <div class="dash-hero">
    <div class="dropzone" id="dropzone" data-action="upload" role="button" tabindex="0" aria-label="Upload a file">
      <div class="dz-ic">${icon('upload', 'lg')}</div>
      <h3>${S.user ? 'Drop a file here, or click to upload' : 'Upload your own file'}</h3>
      <p>${S.user ? 'CSV, Excel or JSON · up to ' + CONFIG.MAX_FILE_MB + ' MB · stays in your browser until you save' : 'Create a free account to analyse your own CSV or Excel files.'}</p>
      <span class="btn btn-primary">${icon(S.user ? 'file' : 'user', 'sm')}${S.user ? 'Choose file' : 'Create free account'}</span>
      <div class="types"><span class="pill">.csv</span><span class="pill">.xlsx</span><span class="pill">.xls</span><span class="pill">.tsv</span><span class="pill">.json</span></div>
    </div>
    <div><div class="nav-label" style="padding:4px 2px 10px">Or try a sample dataset</div><div class="samples">${samples}</div></div>
  </div>
  <div class="section-title"><h2>Saved analyses</h2>${S.user && list ? `<span class="muted">${list.length} of ${CONFIG.MAX_SAVED} slots used</span>` : ''}</div>
  ${saved}
  <div class="section-title"><h2>Tips for great results</h2></div>
  <div class="feature-grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
    <div class="feature" style="padding:18px"><div class="fi" style="margin-bottom:10px">${icon('columns')}</div><h3 style="font-size:14.5px">One header row</h3><p style="font-size:13.5px">Put column names in the first row and one record per row. Clear names like <b>revenue</b>, <b>city</b> or <b>order_date</b> help Clarity understand them.</p></div>
    <div class="feature" style="padding:18px"><div class="fi" style="margin-bottom:10px">${icon('target')}</div><h3 style="font-size:14.5px">Include an outcome</h3><p style="font-size:13.5px">A yes/no column such as <b>churned</b>, <b>passed</b> or <b>converted</b> unlocks “what drives it” analysis.</p></div>
    <div class="feature" style="padding:18px"><div class="fi" style="margin-bottom:10px">${icon('calendar')}</div><h3 style="font-size:14.5px">Add dates for trends</h3><p style="font-size:13.5px">Any date format works — including DD/MM/YYYY. Clarity picks daily, weekly or monthly views for you.</p></div>
  </div>`;
  const dz = $('#dropzone');
  if (dz) dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dz.click(); } });
}

export function renderProfile(el) {
  const p = S.profile || {};
  const used = S.analyses ? S.analyses.length : 0;
  const theme = document.documentElement.getAttribute('data-theme') || 'system';
  el.innerHTML = `
  <div class="page-head"><div><h1>Profile & settings</h1><p>Your name and team appear on the reports you export.</p></div></div>
  <div class="profile-grid">
    <div class="stack">
      <div class="card"><div class="card-h"><h3>Account</h3></div><div class="card-b">
        <div class="field"><label for="pf-name">Full name</label><input class="input" id="pf-name" value="${esc(p.full_name || '')}" autocomplete="name"></div>
        <div class="field"><label for="pf-team">Team or college</label><input class="input" id="pf-team" value="${esc(p.team || '')}" autocomplete="organization"></div>
        <div class="field"><label for="pf-email">Email</label><input class="input" id="pf-email" value="${esc(S.user.email)}" disabled></div>
        <button class="btn btn-primary" data-action="save-profile">Save changes</button>
      </div></div>
      <div class="card"><div class="card-h"><h3>Password</h3></div><div class="card-b">
        <div class="field"><label for="pf-pw">New password</label><input class="input" id="pf-pw" type="password" autocomplete="new-password" placeholder="At least 6 characters"></div>
        <div class="field"><label for="pf-pw2">Confirm new password</label><input class="input" id="pf-pw2" type="password" autocomplete="new-password"></div>
        <button class="btn" data-action="change-password">${icon('key', 'sm')}Update password</button>
      </div></div>
      <div class="card"><div class="card-h"><h3>Appearance</h3></div><div class="card-b">
        <div class="seg" role="group" aria-label="Theme">${[['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([v, l, ic]) => `<button class="${theme === v ? 'on' : ''}" data-action="set-theme" data-theme-val="${v}">${icon(ic, 'sm')} ${l}</button>`).join('')}</div>
      </div></div>
    </div>
    <div class="stack">
      <div class="card card-b">
        <div class="muted" style="font-size:12.5px">Saved analyses</div>
        <div style="font-size:30px;font-weight:720;letter-spacing:-.03em;margin:4px 0 10px">${used} <span class="muted" style="font-size:16px;font-weight:500">/ ${CONFIG.MAX_SAVED}</span></div>
        <div class="progress"><i style="width:${Math.min(100, (used / CONFIG.MAX_SAVED) * 100)}%"></i></div>
        <p class="muted" style="font-size:12.5px;margin-top:10px">Delete an analysis from Home to free a slot.</p>
      </div>
      <div class="card card-b">
        <b style="display:block;margin-bottom:4px">Signed in as</b><p class="muted" style="font-size:13px;word-break:break-all">${esc(S.user.email)}</p>
        <p class="muted" style="font-size:12.5px;margin-top:6px">Member since ${new Date(S.user.created_at || Date.now()).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p>
        <button class="btn btn-block" style="margin-top:14px" data-action="signout">${icon('logout', 'sm')}Sign out</button>
      </div>
    </div>
  </div>`;
}

export const homeActions = {
  'save-profile': async el => {
    const full_name = $('#pf-name').value.trim(), team = $('#pf-team').value.trim();
    el.classList.add('is-loading');
    try { await api.updateProfile(S.user.id, { full_name, team }); S.profile = { ...S.profile, full_name, team }; toast('Profile saved', 'good'); rerender(); }
    catch (e) { toast('Could not save profile: ' + (e.message || ''), 'bad'); }
    finally { el.classList.remove('is-loading'); }
  },
  'change-password': async el => {
    const a = $('#pf-pw').value, b = $('#pf-pw2').value;
    if (a.length < 6) return toast('Use at least 6 characters.', 'bad');
    if (a !== b) return toast("The two passwords don't match.", 'bad');
    el.classList.add('is-loading');
    try { await api.updatePassword(a); $('#pf-pw').value = ''; $('#pf-pw2').value = ''; toast('Password updated', 'good'); }
    catch (e) { toast(api.friendlyAuthError(e), 'bad'); }
    finally { el.classList.remove('is-loading'); }
  },
  'set-theme': el => { setTheme(el.dataset.themeVal); rerender(); },
};
