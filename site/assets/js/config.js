/* ==========================================================================
   Clarity — configuration
   The Supabase URL and anon key are public by design: every table is protected
   by Row Level Security, so a user can only ever read or change their own rows.
   Find both under Supabase → Project Settings → API.
   ========================================================================== */
export const CONFIG = {
  SUPABASE_URL: 'https://revgvcklkozqrizurann.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJldmd2Y2tsa296cXJpenVyYW5uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NTAwMTIsImV4cCI6MjEwNTIyNjAxMn0.zDvXzOPhNkMwWwrwuHO-pswBsjeuyv0vXzS7jVDZhCM',
  STORAGE_BUCKET: 'datasets',   // private bucket; files live under <user id>/
  MAX_SAVED: 2,                 // must match the limit enforced by the database trigger
  MAX_FILE_MB: 50,
};
