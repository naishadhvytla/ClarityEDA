/* ==========================================================================
   Clarity — app entry: routing, shell, auth screens, ingest, save/open.
   ========================================================================== */
import { S, onStateChange, startAnalysis, clearAnalysis, restoreSession, quality, issues, story, model, markSaved } from './state.js';
import * as api from './backend.js';
import { readFile, parseDelimited, toCSV } from './io.js';
import { SAMPLES } from './samples.js';
import { $, $$, esc, icon, brand, toast, openModal, closeModal, confirmDialog, closeMenus, stripTags, timeAgo, fmtBytes } from './ui.js';
import { CONFIG } from './config.js';
import { mountCharts, clearCharts } from './charts.js';
import { VIEWS, actions as viewActions } from './views.js';
import { renderHome, renderProfile, homeActions } from './home.js';
import { renderReport, reportActions } from './report.js';

const initialHash = location.hash;
let authReady = false;

/* ==========================================================================
   Screens + routing
   ========================================================================== */
function showScreen(name) {
  document.documentElement.classList.remove('pre-landing');
  for (const id of ['landing', 'auth', 'app']) $('#' + id).hidden = id !== name;
  const boot = $('#boot');
  if (boot && !boot.classList.contains('gone')) { boot.classList.add('gone'); setTimeout(() => boot.remove(), 250); }
}

const ANALYSIS_VIEWS = ['summary', 'explore', 'columns', 'cleaning', 'data', 'correlations', 'report'];
const TITLES = { home: 'Home', profile: 'Profile', summary: 'Summary', explore: 'Explore', columns: 'Columns', cleaning: 'Cleaning', data: 'Data', correlations: 'Correlations', report: 'Report' };

export const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };

async function route() {
  if (!authReady) return;
  const h = location.hash.replace(/^#\/?/, '');
  const [p0, p1] = h.split('/');
  closeMenus();
  if (p0 === '' || h === '') {
    if (S.user) return go('#/app');
    document.title = 'Clarity — Turn any spreadsheet into a report you can act on';
    return showScreen('landing');
  }
  if (['login', 'signup', 'forgot', 'reset', 'verify'].includes(p0)) {
    if (S.user && p0 !== 'reset') return go('#/app');
    return renderAuth(p0);
  }
  if (p0 === 'demo') return startDemo(p1 || 'sales');
  if (p0 === 'app') {
    if (!S.user && !S.guest) return go('#/login');
    const view = p1 || 'home';
    if (ANALYSIS_VIEWS.includes(view) && !S.a) return go('#/app');
    if (view === 'profile' && !S.user) return go('#/signup');
    return renderApp(view);
  }
  go(S.user ? '#/app' : '#/');
}
window.addEventListener('hashchange', route);

/* ==========================================================================
   Boot
   ========================================================================== */
async function boot() {
  const yr = $('#year'); if (yr) yr.textContent = new Date().getFullYear();
  wireLanding();
  if (!api.configured() || !window.supabase) {
    authReady = true;
    toast('Backend not configured — you can still try the demo.', 'bad');
    return route();
  }
  api.client();
  api.authSettings().then(c => { S.authCfg = c; if (!$('#auth').hidden) route(); });
  let recovering = /type=recovery/.test(initialHash);
  api.onAuthChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') { recovering = true; S.user = session ? session.user : S.user; if (authReady) go('#/reset'); return; }
    if (event === 'SIGNED_OUT') { S.user = null; S.profile = null; S.analyses = null; }
    if (event === 'SIGNED_IN' && session && (!S.user || S.user.id !== session.user.id) && authReady) { await afterSignIn(session.user); if (!recovering) go('#/app'); }
    if (event === 'TOKEN_REFRESHED' && session) S.user = session.user;
  });
  try {
    const session = await api.getSession();
    if (session) await afterSignIn(session.user, true);
  } catch (e) { console.warn(e); }
  authReady = true;
  if (/error_description=/.test(initialHash)) {
    const msg = decodeURIComponent((initialHash.match(/error_description=([^&]+)/) || [])[1] || '').replace(/\+/g, ' ');
    history.replaceState(null, '', location.pathname);
    toast(msg || 'That link is invalid or has expired.', 'bad');
    return go(S.user ? '#/app' : '#/login');
  }
  if (/access_token=/.test(initialHash)) {
    history.replaceState(null, '', location.pathname);
    return go(recovering ? '#/reset' : S.user ? '#/app' : '#/login');
  }
  route();
}

async function afterSignIn(user, restoring = false) {
  S.user = user;
  S.guest = false;
  try { S.profile = await api.ensureProfile(user); } catch { S.profile = { full_name: (user.user_metadata || {}).full_name || '', team: '' }; }
  if (restoring && !S.a) await restoreSession(user.id);
  if (S.a && S.a.source === 'sample' && !S.a.saved) S.a.dirty = true;
  refreshAnalyses();
}

export async function refreshAnalyses() {
  if (!S.user) { S.analyses = []; return []; }
  try { S.analyses = await api.listAnalyses(S.user.id); }
  catch (e) { console.warn(e); S.analyses = S.analyses || []; }
  updateChrome();
  if (currentView() === 'home') rerender();
  return S.analyses;
}

/* ==========================================================================
   Landing wiring
   ========================================================================== */
function wireLanding() {
  const nav = $('#lp-nav');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  $$('[data-scroll]').forEach(a => a.addEventListener('click', e => {
    const t = document.querySelector(a.getAttribute('href'));
    if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }));
}
function updateLandingAuth() {
  $$('[data-auth-cta]').forEach(a => { if (S.user) { a.href = '#/app'; if (a.closest('.lp-actions')) a.textContent = 'Open app'; } });
  $$('[data-auth-link]').forEach(a => { a.hidden = !!S.user; });
}

/* ==========================================================================
   Auth screens
   ========================================================================== */
const GOOGLE = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>`;
let pendingEmail = '';

function renderAuth(mode) {
  showScreen('auth');
  const titles = { login: 'Sign in to Clarity', signup: 'Create your free account', forgot: 'Reset your password', reset: 'Choose a new password', verify: 'Check your inbox' };
  document.title = titles[mode] + ' · Clarity';
  const google = S.authCfg.google && (mode === 'login' || mode === 'signup');
  const pw = (id, ac, ph) => `<div class="input-wrap"><input class="input" id="${id}" type="password" autocomplete="${ac}" placeholder="${ph}" required minlength="6"><button type="button" class="reveal" data-action="reveal" data-for="${id}" aria-label="Show password">${icon('eye', 'sm')}</button></div>`;
  let form = '';
  if (mode === 'login') form = `
    <form id="auth-form" novalidate>
      <div class="form-error" id="auth-err" role="alert"></div><div class="form-note" id="auth-note"></div>
      <div class="field"><label for="au-email">Email</label><input class="input" id="au-email" type="email" autocomplete="email" placeholder="you@example.com" required value="${esc(pendingEmail)}"></div>
      <div class="field"><div class="spread"><label for="au-pass">Password</label><a href="#/forgot" style="font-size:13px">Forgot password?</a></div>${pw('au-pass', 'current-password', 'Your password')}</div>
      <button class="btn btn-primary btn-block btn-lg" type="submit" id="au-submit">Sign in</button>
    </form>
    <p class="auth-foot">New to Clarity? <a href="#/signup">Create a free account</a></p>`;
  else if (mode === 'signup') form = `
    <form id="auth-form" novalidate>
      <div class="form-error" id="auth-err" role="alert"></div>
      <div class="field"><label for="au-name">Full name</label><input class="input" id="au-name" autocomplete="name" placeholder="Your name" required></div>
      <div class="field"><label for="au-email">Email</label><input class="input" id="au-email" type="email" autocomplete="email" placeholder="you@example.com" required value="${esc(pendingEmail)}"></div>
      <div class="field"><label for="au-pass">Password</label>${pw('au-pass', 'new-password', 'At least 6 characters')}<div class="strength" id="pw-strength" data-s="0"><i></i><i></i><i></i><i></i></div></div>
      <div class="field"><label for="au-team">Team or college <span class="faint">(optional)</span></label><input class="input" id="au-team" autocomplete="organization" placeholder="Shown on your reports"></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit" id="au-submit">Create account</button>
      <p class="hint" style="font-size:12px;color:var(--muted);text-align:center;margin-top:12px">Free forever for 2 saved analyses. No credit card.</p>
    </form>
    <p class="auth-foot">Already have an account? <a href="#/login">Sign in</a></p>`;
  else if (mode === 'forgot') form = `
    <form id="auth-form" novalidate>
      <div class="form-error" id="auth-err" role="alert"></div><div class="form-note" id="auth-note"></div>
      <div class="field"><label for="au-email">Email</label><input class="input" id="au-email" type="email" autocomplete="email" placeholder="you@example.com" required value="${esc(pendingEmail)}"></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit" id="au-submit">Send reset link</button>
    </form>
    <p class="auth-foot"><a href="#/login">${icon('arrowL', 'sm')} Back to sign in</a></p>`;
  else if (mode === 'reset') form = S.user ? `
    <form id="auth-form" novalidate>
      <div class="form-error" id="auth-err" role="alert"></div>
      <div class="field"><label for="au-pass">New password</label>${pw('au-pass', 'new-password', 'At least 6 characters')}<div class="strength" id="pw-strength" data-s="0"><i></i><i></i><i></i><i></i></div></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit" id="au-submit">Update password</button>
    </form>` : `<div class="form-error on">${icon('alert', 'sm')}<span>This reset link is invalid or has expired. Request a new one.</span></div><a class="btn btn-primary btn-block btn-lg" href="#/forgot">Send a new link</a>`;
  else if (mode === 'verify') form = `
    <div class="empty" style="padding:10px 0 0;text-align:left"><div class="ill" style="margin:0 0 16px">${icon('mail', 'lg')}</div>
    <p style="color:var(--ink-2)">We sent a confirmation link to <b>${esc(pendingEmail || 'your email')}</b>. Click it to activate your account, then sign in.</p>
    <p class="muted" style="margin-top:10px;font-size:13px">Can't find it? Check spam or promotions.</p></div>
    <div class="form-note" id="auth-note"></div><div class="form-error" id="auth-err" role="alert"></div>
    <div style="display:grid;gap:8px;margin-top:22px"><a class="btn btn-primary btn-block btn-lg" href="#/login">Go to sign in</a><button class="btn btn-block" data-action="resend">Resend confirmation email</button></div>`;
  const sub = { login: 'Welcome back. Pick up where you left off.', signup: 'Upload a file and get your first report in under a minute.', forgot: "Enter your account email and we'll send you a secure link.", reset: 'Make it at least 6 characters.', verify: 'One more step to activate your account.' }[mode];
  $('#auth').innerHTML = `
  <div class="auth">
    <aside class="auth-side">
      ${brand('#/')}
      <div>
        <h2>Understand your data in minutes, not days.</h2>
        <ul>
          <li>${icon('sparkles')}<span>A written report by category, trend and segment — every number backed by your data.</span></li>
          <li>${icon('wand')}<span>Transparent cleaning: duplicates, blanks and messy labels fixed with an undo for everything.</span></li>
          <li>${icon('lock')}<span>Private by design: files are analysed in your browser and saved only when you choose.</span></li>
        </ul>
      </div>
      <div class="quote">“Clarity turned our 600-row sales sheet into a report the whole team understood.”</div>
      <div class="glow"></div>
    </aside>
    <main class="auth-main">
      <a class="btn btn-ghost btn-sm auth-back" href="#/">${icon('arrowL', 'sm')} Home</a>
      <div class="auth-card">
        <div class="mobile-brand">${brand('#/')}</div>
        <h1>${titles[mode]}</h1>
        <p class="sub">${sub}</p>
        ${google ? `<button class="btn btn-block btn-lg oauth" data-action="google">${GOOGLE}Continue with Google</button><div class="or">or with email</div>` : ''}
        ${form}
        ${mode === 'login' || mode === 'signup' ? `<div class="demo-note">Just looking? <a href="#/demo/sales">Explore the live demo</a> — no account needed.</div>` : ''}
      </div>
    </main>
  </div>`;
  const f = $('#auth-form');
  if (f) f.addEventListener('submit', e => { e.preventDefault(); submitAuth(mode); });
  const pass = $('#au-pass');
  if (pass && $('#pw-strength')) pass.addEventListener('input', () => { $('#pw-strength').dataset.s = String(pwScore(pass.value)); });
  const first = $('#auth .input');
  if (first && window.innerWidth > 900) setTimeout(() => (first.value ? ($('#au-pass') || first) : first).focus(), 50);
}

const pwScore = p => (!p ? 0 : p.length < 6 ? 1 : (p.length >= 10) + /[A-Z]/.test(p) + /[0-9]/.test(p) + /[^A-Za-z0-9]/.test(p) >= 2 ? 4 : p.length >= 8 ? 3 : 2);
const authErr = msg => { const e = $('#auth-err'); if (!e) return; e.innerHTML = msg ? `${icon('alert', 'sm')}<span>${esc(msg)}</span>` : ''; e.classList.toggle('on', !!msg); };
const authNote = msg => { const e = $('#auth-note'); if (!e) return; e.innerHTML = msg ? `${icon('checkCircle', 'sm')}<span>${esc(msg)}</span>` : ''; e.classList.toggle('on', !!msg); };
const val = id => ($('#' + id) ? $('#' + id).value.trim() : '');
const validEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

async function submitAuth(mode) {
  authErr(''); authNote('');
  const btn = $('#au-submit');
  const email = val('au-email'), pass = $('#au-pass') ? $('#au-pass').value : '';
  if (mode !== 'reset' && !validEmail(email)) return authErr('Enter a valid email address.');
  if ((mode === 'login' || mode === 'signup' || mode === 'reset') && pass.length < 6) return authErr('Your password needs at least 6 characters.');
  if (mode === 'signup' && !val('au-name')) return authErr('Please add your name — it appears on your reports.');
  pendingEmail = email;
  btn.classList.add('is-loading');
  try {
    if (mode === 'login') {
      const { user } = await api.signIn(email, pass);
      await afterSignIn(user);
      toast(`Welcome back${S.profile && S.profile.full_name ? ', ' + S.profile.full_name.split(' ')[0] : ''}!`, 'good');
      go(S.a && S.a.source === 'sample' ? '#/app/summary' : '#/app');
    } else if (mode === 'signup') {
      const r = await api.signUp({ email, password: pass, full_name: val('au-name'), team: val('au-team') });
      if (r.needsConfirm) return go('#/verify');
      await afterSignIn(r.user);
      toast('Your account is ready.', 'good');
      go('#/app');
    } else if (mode === 'forgot') {
      await api.sendPasswordReset(email);
      authNote('If an account exists for that email, a reset link is on its way. It expires in 1 hour.');
    } else if (mode === 'reset') {
      await api.updatePassword(pass);
      toast('Password updated. You are signed in.', 'good');
      go('#/app');
    }
  } catch (e) {
    const m = api.friendlyAuthError(e);
    authErr(m);
    if (/confirm your email/i.test(m) && mode === 'login') {
      authNote('Need a new confirmation link? Use “Resend” on the next screen.');
      setTimeout(() => go('#/verify'), 1600);
    }
  } finally { btn && btn.classList.remove('is-loading'); }
}

/* ==========================================================================
   App shell
   ========================================================================== */
let shellMounted = false;
const currentView = () => { const h = location.hash.replace(/^#\/?/, '').split('/'); return h[0] === 'app' ? h[1] || 'home' : null; };

function renderShell() {
  $('#app').innerHTML = `
  <div class="app" id="app-shell">
    <aside class="sidebar" id="sidebar" aria-label="Main navigation">
      <div class="side-top">${brand('#/app')}</div>
      <div class="side-scroll"><nav class="nav" id="nav"></nav></div>
      <div class="side-foot" id="side-foot"></div>
    </aside>
    <div class="scrim" data-action="close-nav"></div>
    <div class="main">
      <div id="guest-bar"></div>
      <header class="topbar">
        <div class="row" style="min-width:0"><button class="btn btn-ghost btn-icon menu-toggle" data-action="open-nav" aria-label="Open menu">${icon('menu')}</button><div class="crumbs" id="crumbs"></div></div>
        <div class="top-actions" id="top-actions"></div>
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div>
  </div>`;
  shellMounted = true;
}

function navLink(view, label, ic, extra = '') {
  const cur = currentView();
  return `<a href="#/app${view === 'home' ? '' : '/' + view}" class="${cur === view ? 'active' : ''}" ${cur === view ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${extra}</a>`;
}

function updateChrome() {
  if (!shellMounted || $('#app').hidden) return;
  const a = S.a, view = currentView();
  // navigation
  let nav = `<div class="nav-group">${navLink('home', 'Home', 'home')}${S.user ? navLink('profile', 'Profile', 'user') : ''}</div>`;
  if (a) {
    const q = quality();
    const open = issues().filter(i => i.kind !== 'outlier').length;
    nav += `<div class="nav-group">
      <div class="ds-card"><div class="n" title="${esc(a.name)}">${esc(a.title)}</div><div class="m">${a.ds.length.toLocaleString('en-US')} rows · ${a.ds.cols.length} columns${a.saved ? ' · saved' : ''}</div>
        <div class="q"><span>Quality</span><div class="progress"><i style="width:${q.score}%;background:${q.score >= 75 ? 'var(--good)' : q.score >= 55 ? 'var(--warn)' : 'var(--bad)'}"></i></div><b style="color:var(--ink)">${q.score}</b></div></div>
      <div class="nav-label">Analysis</div>
      ${navLink('summary', 'Summary', 'sparkles')}
      ${navLink('explore', 'Explore', 'compass')}
      ${navLink('columns', 'Columns', 'columns')}
      ${navLink('cleaning', 'Cleaning', 'wand', open ? `<span class="count warn">${open}</span>` : `<span class="count">${icon('check', 'sm')}</span>`)}
      ${navLink('data', 'Data', 'table')}
      ${navLink('correlations', 'Correlations', 'grid')}
      ${navLink('report', 'Report', 'doc')}
    </div>`;
  }
  $('#nav').innerHTML = nav;
  // footer
  if (S.user) {
    const used = S.analyses ? S.analyses.length : 0;
    const name = (S.profile && S.profile.full_name) || S.user.email.split('@')[0];
    $('#side-foot').innerHTML = `
      <div class="usage"><div class="spread"><span>Saved analyses</span><b style="color:var(--ink)">${used} / ${CONFIG.MAX_SAVED}</b></div><div class="progress"><i style="width:${Math.min(100, (used / CONFIG.MAX_SAVED) * 100)}%"></i></div></div>
      <div class="menu-wrap">
        <button class="user-btn" data-menu="user-menu" aria-haspopup="menu"><span class="avatar">${esc((name[0] || '?').toUpperCase())}</span><span class="who"><b>${esc(name)}</b><span>${esc(S.user.email)}</span></span>${icon('more', 'sm')}</button>
        <div class="menu" id="user-menu" role="menu">
          <a href="#/app/profile" role="menuitem">${icon('user', 'sm')}Profile & settings</a>
          <button data-action="theme" role="menuitem">${icon(isDark() ? 'sun' : 'moon', 'sm')}${isDark() ? 'Light mode' : 'Dark mode'}</button>
          <hr><button data-action="signout" role="menuitem">${icon('logout', 'sm')}Sign out</button>
        </div>
      </div>`;
  } else {
    $('#side-foot').innerHTML = `<div class="card" style="padding:14px;box-shadow:none"><b style="font-size:13.5px">You're exploring a demo</b><p class="muted" style="font-size:12.5px;margin:4px 0 12px">Create a free account to upload your own files and save reports.</p><a class="btn btn-primary btn-sm btn-block" href="#/signup">Create free account</a><a class="btn btn-ghost btn-sm btn-block" style="margin-top:6px" href="#/login">Sign in</a></div>`;
  }
  $('#guest-bar').innerHTML = S.guest && !S.user ? `<div class="guest-bar">${icon('sparkles', 'sm')}<span>Demo mode — this is a sample dataset.</span><a href="#/signup" class="btn btn-xs btn-primary">Analyse your own file</a></div>` : '';
  // crumbs
  const crumbs = [];
  if (a && ANALYSIS_VIEWS.includes(view)) crumbs.push(`<span class="ds" title="${esc(a.name)}">${esc(a.title)}</span>${a.dirty && S.user ? ' <span class="saved-dot" title="Unsaved changes"></span>' : ''}<span class="sep">/</span>`);
  crumbs.push(`<b>${TITLES[view] || ''}</b>`);
  $('#crumbs').innerHTML = crumbs.join('');
  // actions
  let act = '';
  if (a && ANALYSIS_VIEWS.includes(view)) {
    act += `<div class="menu-wrap"><button class="btn btn-sm" data-menu="export-menu" aria-haspopup="menu">${icon('download', 'sm')}<span class="hide-sm">Export</span>${icon('chevD', 'sm')}</button>
      <div class="menu" id="export-menu" role="menu">
        <button data-action="export-pdf">${icon('print', 'sm')}<span>PDF report<span class="sub">Print or save as PDF</span></span></button>
        <button data-action="export-html">${icon('code', 'sm')}<span>HTML report<span class="sub">A standalone page to share</span></span></button>
        <button data-action="export-md">${icon('doc', 'sm')}<span>Markdown<span class="sub">For docs, GitHub or Notion</span></span></button>
        <button data-action="copy-summary">${icon('copy', 'sm')}<span>Copy summary<span class="sub">Paste into chat or email</span></span></button>
        <hr><button data-action="export-csv">${icon('sheet', 'sm')}<span>Cleaned data (CSV)</span></button>
      </div></div>`;
    act += S.user ? `<button class="btn btn-sm ${a.dirty ? 'btn-primary' : ''}" data-action="save">${icon(a.dirty ? 'save' : 'checkCircle', 'sm')}<span class="hide-sm">${a.dirty ? (a.saved ? 'Save changes' : 'Save') : 'Saved'}</span></button>`
      : `<a class="btn btn-sm btn-primary" href="#/signup">${icon('save', 'sm')}<span class="hide-sm">Save</span></a>`;
  } else if (view === 'home' && S.user) {
    act += `<button class="btn btn-sm btn-primary" data-action="upload">${icon('upload', 'sm')}<span class="hide-sm">Upload file</span></button>`;
  }
  act += `<button class="btn btn-ghost btn-icon btn-sm hide-sm" data-action="theme" aria-label="Toggle dark mode">${icon(isDark() ? 'sun' : 'moon')}</button>`;
  $('#top-actions').innerHTML = act;
}
onStateChange(() => updateChrome());

function renderApp(view) {
  showScreen('app');
  if (!shellMounted) renderShell();
  $('#app-shell').classList.remove('nav-open');
  document.title = `${TITLES[view] || 'Clarity'}${S.a && ANALYSIS_VIEWS.includes(view) ? ' · ' + S.a.title : ''} · Clarity`;
  updateChrome();
  rerender(true);
}

export function rerender(scrollTop = false) {
  const view = currentView();
  if (!view || $('#app').hidden) return;
  const el = $('#view');
  const y = window.scrollY;
  clearCharts();
  try {
    if (view === 'home') renderHome(el);
    else if (view === 'profile') renderProfile(el);
    else if (view === 'report') renderReport(el);
    else if (VIEWS[view]) VIEWS[view](el);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="card"><div class="empty"><div class="ill">${icon('alert', 'lg')}</div><div class="big">Something went wrong on this page</div><p>${esc(e.message)}</p><div style="margin-top:16px"><a class="btn" href="#/app">Go home</a></div></div></div>`;
  }
  requestAnimationFrame(() => mountCharts(el));
  if (scrollTop) { window.scrollTo(0, 0); } else window.scrollTo(0, y);
}
onStateChange(() => { if (currentView() && ANALYSIS_VIEWS.concat('home').includes(currentView())) rerender(); });

/* ==========================================================================
   Theme
   ========================================================================== */
const isDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
export function setTheme(t) {
  if (t === 'system') { document.documentElement.removeAttribute('data-theme'); try { localStorage.removeItem('clarity-theme'); } catch {} }
  else { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('clarity-theme', t); } catch {} }
  updateChrome();
  const lpBtn = $('.lp-actions [data-action="theme"]');
  if (lpBtn) lpBtn.innerHTML = icon(isDark() ? 'sun' : 'moon');
}

/* ==========================================================================
   Ingest: upload, samples, demo
   ========================================================================== */
export async function pickFile() {
  if (!S.user) {
    openModal({ title: 'Create a free account to upload', body: `<p>The demo uses sample data. With a free account you can analyse your own CSV or Excel files and save up to ${CONFIG.MAX_SAVED} reports.</p>`, actions: [{ label: 'Not now' }, { label: 'Create account', cls: 'btn-primary', run: () => go('#/signup') }] });
    return;
  }
  if (!(await confirmReplaceCurrent())) return;
  const inp = $('#file-input');
  inp.value = '';
  inp.click();
}
$('#file-input').addEventListener('change', e => { const f = e.target.files[0]; if (f) ingestFile(f, true); });

async function confirmReplaceCurrent() {
  if (!S.a || !S.a.dirty || !S.user || S.a.source === 'sample') return true;
  return confirmDialog({ title: 'Start a new analysis?', body: `<p>You have unsaved changes to <b>${esc(S.a.title)}</b>. They'll be lost if you continue.</p>`, confirm: 'Discard and continue', danger: true });
}

function ingestScreen(name, size) {
  if (!shellMounted) { showScreen('app'); renderShell(); }
  showScreen('app');
  $('#view').innerHTML = `<div class="ingest"><div class="ingest-card card" style="padding:26px">
    <div class="file"><div class="fi">${icon('sheet')}</div><div style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(name)}</b><span class="muted" style="font-size:13px">${size ? fmtBytes(size) : 'Sample dataset'}</span></div></div>
    <div class="ingest-steps" id="steps">
      <div class="st active"><span class="b"></span>Reading the file</div>
      <div class="st"><span class="b"></span>Checking data quality</div>
      <div class="st"><span class="b"></span>Understanding the columns</div>
      <div class="st"><span class="b"></span>Writing your report</div>
    </div></div></div>`;
}
const step = async i => {
  const st = $$('#steps .st');
  st.forEach((s, k) => { s.classList.toggle('done', k < i); s.classList.toggle('active', k === i); if (k < i) s.querySelector('.b').innerHTML = icon('check', 'sm'); });
  await new Promise(r => setTimeout(r, 180));
};

async function ingestFile(file, confirmed = false) {
  if (!confirmed && !(await confirmReplaceCurrent())) return;
  ingestScreen(file.name, file.size);
  try {
    await step(0);
    const { rows, cols, note } = await readFile(file);
    await step(1);
    startAnalysis({ name: file.name, rows, cols, size: file.size, source: 'upload' });
    await step(2); model();
    await step(3); story();
    await step(4);
    if (note) toast(note);
    go('#/app/summary');
    rerender(true);
  } catch (e) {
    console.warn(e);
    $('#view').innerHTML = `<div class="ingest"><div class="ingest-card card" style="padding:26px"><div class="empty" style="padding:6px 0"><div class="ill" style="background:var(--bad-wash);color:var(--bad)">${icon('alert', 'lg')}</div><div class="big">We couldn't read this file</div><p>${esc(e.message || 'Unknown error')}</p>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:18px"><button class="btn btn-primary" data-action="upload">Try another file</button><a class="btn" href="#/app">Back home</a></div></div></div></div>`;
  }
}

export async function loadSample(id, { silent = false } = {}) {
  const s = SAMPLES.find(x => x.id === id) || SAMPLES[0];
  if (!(await confirmReplaceCurrent())) return false;
  if (!silent) ingestScreen(s.file, 0);
  const csv = s.build();
  const { rows, cols } = parseDelimited(csv);
  if (!silent) { await step(1); }
  startAnalysis({ name: s.file, rows, cols, size: csv.length, source: 'sample' });
  if (!silent) { await step(2); model(); await step(3); story(); await step(4); }
  return true;
}

async function startDemo(id) {
  if (!S.user) S.guest = true;
  if (!window.Papa) await new Promise(r => setTimeout(r, 200));
  const ok = await loadSample(id);
  if (ok) go('#/app/summary');
}

/* drag & drop anywhere on the home page */
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => {
  const dz = $('#dropzone');
  if (!dz || !e.dataTransfer || ![...(e.dataTransfer.types || [])].includes('Files')) return;
  e.preventDefault(); dz.classList.add('drag');
}));
document.addEventListener('dragleave', e => { const dz = $('#dropzone'); if (dz && (e.target === dz || !dz.contains(e.relatedTarget))) dz.classList.remove('drag'); });
document.addEventListener('drop', e => {
  const dz = $('#dropzone');
  if (!dz || !e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault(); dz.classList.remove('drag');
  if (!S.user) return pickFile();
  ingestFile(e.dataTransfer.files[0]);
});

/* ==========================================================================
   Save / open / delete
   ========================================================================== */
function buildPayload(context) {
  const a = S.a, st = story(), q = quality(), m = model();
  return {
    v: 2, context: context || a.context || '',
    author: (S.profile && S.profile.full_name) || S.user.email, team: (S.profile && S.profile.team) || '',
    story: { title: st.title, about: st.about, kpis: st.kpis, takeaways: st.takeaways.map(t => ({ html: t.html, icon: t.icon })), recs: st.recs.map(r => r.html), domain: m.domain },
    roles: a.roles, settings: a.settings, log: a.log, colOrder: a.ds.cols,
    N: a.ds.length, cols: a.ds.cols.length, quality: q, duplicates: a.prof.duplicates,
    insights: st.takeaways.map(t => ({ tx: stripTags(t.html), ev: '' })),
    profileCols: a.prof.columns.map(c => ({ name: c.name, type: c.type, missing: c.missing, missingPct: c.missingPct, unique: c.unique,
      stats: c.stats ? { mean: c.stats.mean, median: c.stats.median, std: c.stats.std, min: c.stats.min, max: c.stats.max, q1: c.stats.q1, q3: c.stats.q3, skew: c.stats.skew, outliers: c.stats.outliers } : null,
      catTop: c.top ? c.top.slice(0, 6) : null })),
  };
}

async function doSave({ name, context, replaceId, updateInPlace }) {
  // If in-place updates aren't allowed by the database policy, the old copy is replaced instead.
  const a = S.a;
  a.context = context;
  const record = { name, datasetName: a.name, rows: a.ds.length, cols: a.ds.cols.length, quality: quality().score, csv: toCSV(a.ds.rows, a.ds.cols), report: buildPayload(context) };
  if (updateInPlace && a.saved) {
    try { const row = await api.updateAnalysis(a.saved.id, S.user.id, a.saved.storage_path, record); markSaved(row); await refreshAnalyses(); toast('Changes saved', 'good'); return true; }
    catch (e) { console.warn(e); replaceId = a.saved.id; }
  }
  if (replaceId) {
    const old = (S.analyses || []).find(x => x.id === replaceId);
    if (old) await api.deleteAnalysis(old);
  }
  try {
    const row = await api.saveAnalysis(S.user.id, record);
    markSaved(row);
    await refreshAnalyses();
    toast(updateInPlace ? 'Changes saved' : `Saved “${name}” to your account`, 'good');
    return true;
  } catch (e) {
    if (e.limit) { await refreshAnalyses(); promptSave(); toast(`You've used all ${CONFIG.MAX_SAVED} slots. Replace one to save.`, 'bad'); return false; }
    toast('Save failed: ' + (e.message || 'unknown error'), 'bad');
    return false;
  }
}

export async function promptSave() {
  if (!S.user) return go('#/signup');
  const a = S.a;
  if (!a) return;
  if (!S.analyses) await refreshAnalyses();
  const list = S.analyses || [];
  const full = list.length >= CONFIG.MAX_SAVED && !(a.saved && list.some(x => x.id === a.saved.id));
  const inPlace = a.saved && list.some(x => x.id === a.saved.id);
  const defName = a.saved ? a.saved.name : a.title;
  const body = `
    <div class="field"><label for="sv-name">Name</label><input class="input" id="sv-name" value="${esc(defName)}" maxlength="80"></div>
    <div class="field"><label for="sv-ctx">Question this analysis answers <span class="faint">(optional)</span></label><input class="input" id="sv-ctx" value="${esc(a.context || '')}" placeholder="e.g. Which categories should we invest in next quarter?" maxlength="200"></div>
    ${inPlace ? `<label class="check"><input type="radio" name="sv-mode" value="update" checked> Update “${esc(a.saved.name)}”</label><label class="check" style="margin-top:6px"><input type="radio" name="sv-mode" value="new" ${list.length >= CONFIG.MAX_SAVED ? 'disabled' : ''}> Save as a new analysis${list.length >= CONFIG.MAX_SAVED ? ' (no free slot)' : ''}</label>` : ''}
    ${full ? `<div class="form-note on" style="margin-top:6px">${icon('info', 'sm')}<span>You're using ${list.length} of ${CONFIG.MAX_SAVED} slots. Choose one to replace:</span></div>
      <div style="display:grid;gap:6px">${list.map((x, i) => `<label class="check" style="padding:10px 12px;border:1px solid var(--line);border-radius:10px"><input type="radio" name="sv-replace" value="${esc(x.id)}" ${i === list.length - 1 ? 'checked' : ''}><span><b>${esc(x.name)}</b><span class="muted" style="display:block;font-size:12px">${esc(x.dataset_name || '')} · saved ${esc(timeAgo(x.created_at))}</span></span></label>`).join('')}</div>` : `<p class="muted" style="font-size:12.5px">Saves the cleaned dataset and this report to your private storage. ${inPlace ? '' : `Uses ${list.length + 1} of ${CONFIG.MAX_SAVED} slots.`}</p>`}`;
  openModal({ title: inPlace ? 'Save changes' : 'Save analysis', body, actions: [
    { label: 'Cancel' },
    { label: full ? 'Replace and save' : 'Save', cls: 'btn-primary', run: async bg => {
      const name = (bg.querySelector('#sv-name').value || '').trim() || a.title;
      const context = (bg.querySelector('#sv-ctx').value || '').trim();
      const mode = bg.querySelector('input[name="sv-mode"]:checked');
      const rep = bg.querySelector('input[name="sv-replace"]:checked');
      if (full && rep) {
        const victim = list.find(x => x.id === rep.value);
        const ok = await confirmDialog({ title: 'Replace saved analysis?', body: `<p>“${esc(victim.name)}” and its stored data will be permanently deleted.</p>`, confirm: 'Replace', danger: true });
        if (!ok) return true;
      }
      await doSave({ name, context, replaceId: full && rep ? rep.value : null, updateInPlace: mode ? mode.value === 'update' : false });
    } },
  ] });
}

export async function openSaved(id, view = 'summary') {
  if (!(await confirmReplaceCurrent())) return;
  let row = (S.analyses || []).find(x => x.id === id);
  ingestScreen(row ? row.dataset_name || row.name : 'Saved analysis', 0);
  try {
    if (!row || !row.report) row = await api.getAnalysis(id);
    await step(0);
    if (!row.storage_path) { go('#/app'); return legacyReport(row); }
    const text = await api.downloadDataset(row.storage_path);
    await step(1);
    const { rows, cols } = parseDelimited(text);
    const rep = row.report || {};
    startAnalysis({ name: row.dataset_name || row.name, rows, cols, size: text.length, source: 'saved', saved: row, log: rep.log || [], roles: rep.roles || {}, settings: rep.settings || {}, context: rep.context || '' });
    await step(2); model(); await step(3); story(); await step(4);
    go('#/app/' + view);
    rerender(true);
  } catch (e) {
    console.error(e);
    toast("Couldn't open this analysis: " + (e.message || ''), 'bad');
    go('#/app');
  }
}

function legacyReport(row) {
  const m = row.report || {};
  const q = m.quality || {};
  openModal({ title: row.name, wide: true, body: `<p class="muted" style="font-size:13px">Saved with an earlier version of Clarity, before datasets were stored. Summary from the saved report:</p>
    <div class="kpi-grid" style="margin:14px 0"><div class="kpi"><div class="l">Rows</div><div class="v">${esc((m.N || row.rows || 0).toLocaleString('en-US'))}</div></div><div class="kpi"><div class="l">Columns</div><div class="v">${esc(m.cols || row.cols || '—')}</div></div><div class="kpi"><div class="l">Quality</div><div class="v">${esc(q.score ?? row.quality ?? '—')}</div></div></div>
    ${(m.insights || []).length ? `<ul>${m.insights.map(i => `<li>${esc(i.tx)}</li>`).join('')}</ul>` : '<p>No findings were stored.</p>'}`, actions: [{ label: 'Close' }] });
}

export async function removeSaved(id) {
  const row = (S.analyses || []).find(x => x.id === id);
  if (!row) return;
  const ok = await confirmDialog({ title: 'Delete this analysis?', body: `<p><b>${esc(row.name)}</b> and its stored dataset will be permanently deleted. Export the report first if you need a copy.</p>`, confirm: 'Delete', danger: true });
  if (!ok) return;
  try {
    await api.deleteAnalysis(row);
    if (S.a && S.a.saved && S.a.saved.id === id) { S.a.saved = null; S.a.dirty = true; }
    await refreshAnalyses();
    toast('Analysis deleted — slot freed', 'good');
    rerender();
  } catch (e) { toast('Delete failed: ' + (e.message || ''), 'bad'); }
}

async function signOutNow() {
  const ok = !S.a || !S.a.dirty || S.a.source === 'sample' || await confirmDialog({ title: 'Sign out?', body: `<p>You have unsaved changes to <b>${esc(S.a.title)}</b>.</p>`, confirm: 'Sign out anyway', danger: true });
  if (!ok) return;
  await api.signOut();
  S.user = null; S.profile = null; S.analyses = null; S.guest = false;
  clearAnalysis();
  shellMounted = false;
  $('#app').innerHTML = '';
  updateLandingAuth();
  toast('Signed out');
  go('#/');
}

/* ==========================================================================
   Global actions (event delegation)
   ========================================================================== */
const actions = {
  theme: () => setTheme(isDark() ? 'light' : 'dark'),
  'open-nav': () => $('#app-shell').classList.add('nav-open'),
  'close-nav': () => $('#app-shell').classList.remove('nav-open'),
  reveal: el => { const inp = $('#' + el.dataset.for); const show = inp.type === 'password'; inp.type = show ? 'text' : 'password'; el.innerHTML = icon(show ? 'eyeOff' : 'eye', 'sm'); el.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); },
  google: async el => { el.classList.add('is-loading'); try { await api.signInWithGoogle(); } catch (e) { authErr(api.friendlyAuthError(e)); el.classList.remove('is-loading'); } },
  resend: async el => { el.classList.add('is-loading'); try { await api.resendConfirmation(pendingEmail); authNote('Sent. The new link replaces the old one.'); } catch (e) { authErr(api.friendlyAuthError(e)); } finally { el.classList.remove('is-loading'); } },
  signout: () => signOutNow(),
  upload: () => pickFile(),
  sample: el => loadSample(el.dataset.id).then(ok => ok && go('#/app/summary')),
  save: () => promptSave(),
  open: el => openSaved(el.dataset.id, el.dataset.view || 'summary'),
  delete: el => removeSaved(el.dataset.id),
  ...viewActions, ...homeActions, ...reportActions,
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  closeMenus();
  if (el.closest('.sidebar') && window.innerWidth <= 900) $('#app-shell') && $('#app-shell').classList.remove('nav-open');
  fn(el, e);
});
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
  if ($('#app-shell')) $('#app-shell').classList.remove('nav-open');
  // A link to the page you're already on (e.g. Home after an upload error) still re-renders it.
  if (a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
});
window.addEventListener('beforeunload', e => { if (S.user && S.a && S.a.dirty && S.a.source === 'upload') { e.preventDefault(); e.returnValue = ''; } });

export { closeModal };
const start = () => boot().catch(e => { console.error(e); authReady = true; route(); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
