-- supabase-auth-migration.sql
-- Migrate the LIVE fschoolai.com login (public schema) from the hand-rolled
-- public.users + client-side SHA-256 scheme to Supabase Auth (GoTrue, which owns
-- the `auth` schema and does bcrypt salting).
--
-- TARGET: the production app served at fschoolai.com, built from the
--   vincent/frontend/dev branch (vincentyang0702-pixel/FschoolAI-). That app's
--   Supabase client uses { db: { schema: 'public' } } and login reads/writes
--   public.users (id text = client UUID, password_hash = SHA-256 hex).
--   NOTE: an earlier draft of this file targeted the `neuroagi` schema — wrong tree.
--   The neuroagi.users.auth_id column added on 2026-06-12 is harmless but inert for
--   the live app; the column that matters is public.users.auth_id below.
--
-- STRATEGY: we do NOT move data into `auth`. GoTrue manages auth.users itself.
-- We BRIDGE: keep public.users as the profile table and add an auth_id column
-- linking each profile to its auth.users row. Existing FKs that point at
-- public.users.id stay untouched.
--
-- Run in the Supabase SQL editor against the project that backs fschoolai.com.
-- Phase 1 is safe to run now (additive). Phase 2 tightens RLS and MUST NOT run until
-- both the web app and the extension send a real user JWT — otherwise reads break.

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1 — bridge column (safe, additive, run anytime)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.users
  add column if not exists auth_id uuid references auth.users(id) on delete set null;

create unique index if not exists users_auth_id_key
  on public.users (auth_id)
  where auth_id is not null;

-- password_hash stays for now so lazy-migration (verify old hash → create auth user)
-- can still read it. Drop it only after Phase 3 backfill confirms every active user
-- has an auth_id:  alter table public.users drop column password_hash;


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2 — real RLS (run ONLY after app + extension send the user's access_token)
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ TEMPLATE — validate against public's ACTUAL policies/columns before running.
-- public is Vincent's shared schema; its existing policy names may NOT be "open_all"
-- (run `select policyname, tablename from pg_policies where schemaname='public';`
-- first and adjust the DROP statements). Also confirm each child table's user_id
-- type matches public.users.id (text) before scoping.

-- helper: the caller's profile id (text) for the current JWT
create or replace function public.current_profile_id()
returns text
language sql stable
as $$
  select id from public.users where auth_id = auth.uid()
$$;

-- users: a row is yours if its auth_id matches your JWT
-- drop policy if exists <existing_policy_name> on public.users;
create policy users_self on public.users
  for all
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- child tables: row is yours if its user_id maps to your profile
-- (repeat for every public table with a user_id fk — courses, assignments, files, …)
-- drop policy if exists <existing_policy_name> on public.courses;
create policy courses_self on public.courses
  for all
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

create policy assignments_self on public.assignments
  for all
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());

create policy files_self on public.files
  for all
  using (user_id = public.current_profile_id())
  with check (user_id = public.current_profile_id());


-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 3 — backfill helper (server-side, service_role only — NOT for the client)
-- ─────────────────────────────────────────────────────────────────────────────
-- You cannot import SHA-256 hashes into GoTrue (it expects bcrypt). Existing users
-- get an auth.users row via the lazy path: on next successful SHA-256 login,
-- admin.createUser with the plaintext they just typed, then link:
--   update public.users set auth_id = $1 where id = $2;
-- (handled by /api/auth-migrate?action=migrate)
