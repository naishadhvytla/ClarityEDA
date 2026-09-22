-- ============================================================================
-- Clarity — Supabase schema (reference)
--
-- Your existing project already has these objects. You only need this file to
-- set up a NEW Supabase project, or to add the optional "update" policy that
-- lets "Save changes" update a saved analysis in place.
-- Run it in Supabase → SQL Editor. It is safe to run more than once.
-- ============================================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text default '',
  team       text default '',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

drop policy if exists "profiles: read own"   on public.profiles;
drop policy if exists "profiles: insert own" on public.profiles;
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: read own"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: insert own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles: update own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- analyses ----------
create table if not exists public.analyses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  dataset_name text,
  rows         integer,
  cols         integer,
  quality      integer,
  storage_path text,
  report       jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists analyses_user_created_idx on public.analyses (user_id, created_at desc);
alter table public.analyses enable row level security;

drop policy if exists "analyses: read own"   on public.analyses;
drop policy if exists "analyses: insert own" on public.analyses;
drop policy if exists "analyses: update own" on public.analyses;
drop policy if exists "analyses: delete own" on public.analyses;
create policy "analyses: read own"   on public.analyses for select using (auth.uid() = user_id);
create policy "analyses: insert own" on public.analyses for insert with check (auth.uid() = user_id);
create policy "analyses: update own" on public.analyses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "analyses: delete own" on public.analyses for delete using (auth.uid() = user_id);

-- At most 2 saved analyses per account (the app shows the same limit: CONFIG.MAX_SAVED).
create or replace function public.enforce_analysis_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.analyses where user_id = new.user_id) >= 2 then
    raise exception 'ANALYSIS_LIMIT_REACHED';
  end if;
  return new;
end;
$$;
drop trigger if exists analyses_limit on public.analyses;
create trigger analyses_limit before insert on public.analyses
  for each row execute function public.enforce_analysis_limit();

-- ---------- storage: private "datasets" bucket, one folder per user ----------
insert into storage.buckets (id, name, public)
values ('datasets', 'datasets', false)
on conflict (id) do nothing;

drop policy if exists "datasets: read own"   on storage.objects;
drop policy if exists "datasets: upload own" on storage.objects;
drop policy if exists "datasets: update own" on storage.objects;
drop policy if exists "datasets: delete own" on storage.objects;
create policy "datasets: read own"   on storage.objects for select using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "datasets: upload own" on storage.objects for insert with check (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "datasets: update own" on storage.objects for update using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "datasets: delete own" on storage.objects for delete using (bucket_id = 'datasets' and (storage.foldername(name))[1] = auth.uid()::text);
