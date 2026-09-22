/* ==========================================================================
   Clarity — Supabase backend (auth, profiles, saved analyses, storage)
   Tables used (see supabase/schema.sql):
     profiles(id, full_name, team, created_at)
     analyses(id, user_id, name, dataset_name, rows, cols, quality, storage_path, report jsonb, created_at)
   Storage bucket: datasets (private), files at <user id>/<uuid>.csv
   ========================================================================== */
import { CONFIG } from './config.js';

let sb = null;
export const configured = () => !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && !/YOUR_/.test(CONFIG.SUPABASE_URL + CONFIG.SUPABASE_ANON_KEY));

export function client() {
  if (!sb && window.supabase && configured()) {
    sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return sb;
}

/** The URL auth emails and OAuth should come back to (this page, no hash). */
export const siteURL = () => location.origin + location.pathname;

export function friendlyAuthError(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/invalid login credentials/i.test(m)) return "That email and password don't match. Check them, or reset your password.";
  if (/email not confirmed/i.test(m)) return 'Please confirm your email address first — check your inbox for the link.';
  if (/already registered|already exists/i.test(m)) return 'An account with this email already exists. Try signing in instead.';
  if (/password should be at least|weak password/i.test(m)) return 'Choose a password with at least 6 characters.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Too many attempts. Please wait a minute and try again.';
  if (/unable to validate email|invalid email|email address.*invalid/i.test(m)) return "That doesn't look like a valid email address.";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "Can't reach the server. Check your internet connection and try again.";
  if (/provider is not enabled|unsupported provider/i.test(m)) return 'Google sign-in is not enabled for this project yet.';
  return m || 'Something went wrong. Please try again.';
}

export async function authSettings() {
  try {
    const r = await fetch(`${CONFIG.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: CONFIG.SUPABASE_ANON_KEY } });
    if (!r.ok) throw new Error();
    const j = await r.json();
    return { google: !!(j.external && j.external.google), signupDisabled: !!j.disable_signup, autoconfirm: !!j.mailer_autoconfirm };
  } catch { return { google: true, signupDisabled: false, autoconfirm: false }; }
}

export async function getSession() {
  const { data, error } = await client().auth.getSession();
  if (error) throw error;
  return data.session;
}
export const onAuthChange = cb => client().auth.onAuthStateChange((event, session) => cb(event, session));

export async function signIn(email, password) {
  const { data, error } = await client().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signUp({ email, password, full_name, team }) {
  const { data, error } = await client().auth.signUp({ email, password, options: { data: { full_name, team }, emailRedirectTo: siteURL() } });
  if (error) throw error;
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) throw new Error('User already registered');
  return { ...data, needsConfirm: !data.session };
}
export async function signInWithGoogle() {
  const { error } = await client().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: siteURL() } });
  if (error) throw error;
}
export async function sendPasswordReset(email) {
  const { error } = await client().auth.resetPasswordForEmail(email, { redirectTo: siteURL() });
  if (error) throw error;
}
export async function resendConfirmation(email) {
  const { error } = await client().auth.resend({ type: 'signup', email, options: { emailRedirectTo: siteURL() } });
  if (error) throw error;
}
export async function updatePassword(password) {
  const { error } = await client().auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() { try { await client().auth.signOut(); } catch { /* already signed out */ } }

/* ---------- profiles ---------- */
export async function ensureProfile(user) {
  const md = user.user_metadata || {};
  const c = client();
  let { data } = await c.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!data) {
    await c.from('profiles').insert({ id: user.id, full_name: md.full_name || md.name || '', team: md.team || '' });
    ({ data } = await c.from('profiles').select('*').eq('id', user.id).maybeSingle());
  }
  return data || { id: user.id, full_name: md.full_name || md.name || '', team: md.team || '' };
}
export async function updateProfile(uid, patch) {
  const { error } = await client().from('profiles').update(patch).eq('id', uid);
  if (error) throw error;
}

/* ---------- analyses ---------- */
export async function listAnalyses(uid) {
  const { data, error } = await client().from('analyses').select('id,name,dataset_name,rows,cols,quality,storage_path,report,created_at').eq('user_id', uid).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
export async function getAnalysis(id) {
  const { data, error } = await client().from('analyses').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}
export async function downloadDataset(path) {
  const { data, error } = await client().storage.from(CONFIG.STORAGE_BUCKET).download(path);
  if (error) throw error;
  return data.text();
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

/** Upload the cleaned CSV, then insert the row. If the insert fails the file is removed again. */
export async function saveAnalysis(uid, { name, datasetName, rows, cols, quality, csv, report }) {
  const c = client();
  const path = `${uid}/${uuid()}.csv`;
  const up = await c.storage.from(CONFIG.STORAGE_BUCKET).upload(path, new Blob([csv], { type: 'text/csv' }), { contentType: 'text/csv', upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await c.from('analyses').insert({ user_id: uid, name, dataset_name: datasetName, rows, cols, quality, storage_path: path, report }).select('id,name,dataset_name,rows,cols,quality,storage_path,report,created_at').single();
  if (error) {
    await c.storage.from(CONFIG.STORAGE_BUCKET).remove([path]).catch(() => {});
    if (/ANALYSIS_LIMIT_REACHED/i.test(error.message || '')) { const e = new Error('ANALYSIS_LIMIT_REACHED'); e.limit = true; throw e; }
    throw error;
  }
  return data;
}

/** Replace a saved analysis in place (new file, same row). */
export async function updateAnalysis(id, uid, oldPath, { name, datasetName, rows, cols, quality, csv, report }) {
  const c = client();
  const path = `${uid}/${uuid()}.csv`;
  const up = await c.storage.from(CONFIG.STORAGE_BUCKET).upload(path, new Blob([csv], { type: 'text/csv' }), { contentType: 'text/csv', upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await c.from('analyses').update({ name, dataset_name: datasetName, rows, cols, quality, storage_path: path, report }).eq('id', id).select('id,name,dataset_name,rows,cols,quality,storage_path,report,created_at');
  if (error || !data || !data.length) {
    await c.storage.from(CONFIG.STORAGE_BUCKET).remove([path]).catch(() => {});
    throw error || new Error('UPDATE_NOT_ALLOWED');
  }
  if (oldPath) await c.storage.from(CONFIG.STORAGE_BUCKET).remove([oldPath]).catch(() => {});
  return data[0];
}

export async function deleteAnalysis(row) {
  const c = client();
  if (row.storage_path) await c.storage.from(CONFIG.STORAGE_BUCKET).remove([row.storage_path]).catch(() => {});
  const { error } = await c.from('analyses').delete().eq('id', row.id);
  if (error) throw error;
}
