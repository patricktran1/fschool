-- supabase-rls-client-tables.sql — RLS for the CLIENT-FACING tables.
-- Completes Phase 2 of supabase-auth-migration.sql, which only stubbed users/courses/
-- assignments/files AND never ran `enable row level security` (so its policies were inert).
--
-- PREREQUISITES:
--   • This file is SELF-CONTAINED — it creates public.users.auth_id + current_profile_id()
--     below (idempotent), so you don't need to run supabase-auth-migration.sql first.
--   • The web login must use Supabase Auth (src/api/auth.ts signInWithPassword) and be
--     DEPLOYED, so every browser request carries a JWT. RLS denies sessionless anon access —
--     deploy the auth change first or Tier A reads break for logged-in users.
--
-- Owner-scoped pattern: `user_id = public.current_profile_id()`. Server endpoints use the
-- service_role key (BYPASSES RLS), so ingestion/notifications/Canvas writes are unaffected.
--
-- IMPORTANT: each table is first stripped of ALL existing policies. Postgres OR's permissive
-- policies, so a leftover `open_all using(true)` (from supabase-schema.sql) would defeat the
-- restrictive policy below. `reset_policies(t)` drops whatever is there before we re-create.
--
-- ⚠️ This migration ENABLES RLS only on TIER A (verified safe). Every other client-facing
-- table gets its policy written + ready, but RLS is left OFF behind a labelled gate, because
-- enabling it blindly would break a real feature (extension Canvas sync, leaderboard, etc.).

-- ── Prerequisites (self-contained + idempotent) ─────────────────────────────────
-- Bridge column linking each profile to its GoTrue auth user, and the helper that maps the
-- caller's JWT (auth.uid()) → their public.users.id. (Mirrors supabase-auth-migration.sql;
-- duplicated here so this file runs standalone. `create or replace` / `if not exists` make
-- re-running harmless.)
alter table public.users
  add column if not exists auth_id uuid references auth.users(id) on delete set null;
create unique index if not exists users_auth_id_key
  on public.users (auth_id) where auth_id is not null;

create or replace function public.current_profile_id()
returns text language sql stable as $$
  select id from public.users where auth_id = auth.uid()
$$;

-- helper: drop every existing policy on a public table (so ours isn't OR'd with an open_all)
create or replace function public.reset_policies(p_table text)
returns void language plpgsql as $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = p_table loop
    execute format('drop policy %I on public.%I;', r.policyname, p_table);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- TIER A — per-user private, web-only. ENABLE NOW (safe + verified).
--   Owner's own data only; never read cross-user; never written by the extension. Server
--   writes (notifications, RAG ingest) use the service key and bypass RLS.
-- ════════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'chat_logs','chat_conversations','flashcards','srs_reviews',
    'rag_documents','notifications','tutor_impressions','tutor_mind','beta_sessions'
  ] loop
    perform public.reset_policies(t);
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy %I on public.%I for all '
      'using (user_id = public.current_profile_id()) '
      'with check (user_id = public.current_profile_id());', t || '_self', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- TIER B — collaborative study-room tables. Membership-scoped. A SECURITY DEFINER helper
-- avoids RLS recursion (a policy on room_members can't directly sub-query room_members).
-- Policies are READY; RLS enable is commented — ⚠️ I could not run this live, so TEST study
-- rooms in staging (create/join a room, see co-members) before enabling in prod.
-- ════════════════════════════════════════════════════════════════════════════════
create or replace function public.is_room_member(p_room_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room_id and user_id = public.current_profile_id()
  );
$$;

select public.reset_policies('study_rooms');
create policy study_rooms_access on public.study_rooms for all
  using (created_by = public.current_profile_id() or public.is_room_member(id))
  with check (created_by = public.current_profile_id());

select public.reset_policies('room_members');
create policy room_members_access on public.room_members for all
  using (user_id = public.current_profile_id() or public.is_room_member(room_id))
  with check (user_id = public.current_profile_id());

select public.reset_policies('room_sessions');
create policy room_sessions_access on public.room_sessions for all
  using (user_id = public.current_profile_id() or public.is_room_member(room_id))
  with check (user_id = public.current_profile_id());

select public.reset_policies('nudges');
create policy nudges_access on public.nudges for all
  using (from_user_id = public.current_profile_id() or to_user_id = public.current_profile_id())
  with check (from_user_id = public.current_profile_id());

-- After staging confirms study rooms still work, enable:
-- alter table public.study_rooms  enable row level security;
-- alter table public.room_members enable row level security;
-- alter table public.room_sessions enable row level security;
-- alter table public.nudges       enable row level security;

-- ════════════════════════════════════════════════════════════════════════════════
-- TIER C — Canvas tables written by the BROWSER EXTENSION. ⚠️ DO NOT ENABLE YET.
-- courses/assignments/canvas_data/files are written by the extension, which does NOT yet
-- send a user JWT. Enabling RLS now → its anon writes are denied → Canvas sync breaks.
-- Policies are owner-correct and ready; enable per table only AFTER the extension sends the
-- user's access_token (same prerequisite as auth-migration.sql Phase 2).
-- ════════════════════════════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['courses','assignments','canvas_data','files'] loop
    perform public.reset_policies(t);
    execute format(
      'create policy %I on public.%I for all '
      'using (user_id = public.current_profile_id()) '
      'with check (user_id = public.current_profile_id());', t || '_self', t);
    -- execute format('alter table public.%I enable row level security;', t);  -- ENABLE AFTER EXTENSION AUTH
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- TIER D — shared reference / library (read by everyone; no per-user owner).
-- schools = reference data; course_content = a course library shared across students and
-- written by the extension. Read-all policies are ready; RLS enable is gated.
-- ════════════════════════════════════════════════════════════════════════════════
select public.reset_policies('schools');
create policy schools_read   on public.schools for select using (true);
create policy schools_insert on public.schools for insert with check (true);
-- alter table public.schools enable row level security;  -- safe once you confirm no client UPDATE/DELETE is needed

select public.reset_policies('course_content');
create policy course_content_read on public.course_content for select using (true);
-- alter table public.course_content enable row level security;  -- ENABLE AFTER EXTENSION AUTH (+ an insert policy for it)

-- ════════════════════════════════════════════════════════════════════════════════
-- users — NEEDS A CODE CHANGE FIRST, so RLS is left OFF here.
-- The browser reads OTHER users' (id, name) for the leaderboard (Leaderboard.tsx), friends
-- (api/friends.ts), and study-room rosters (StudyRooms.tsx). A self-only policy breaks those;
-- a read-all policy would leak email/password_hash/auth_id. Fix = a public view of safe
-- columns + switching those reads to it:
create or replace view public.users_public as
  select id, name, school, city, country, continent from public.users;
grant select on public.users_public to anon, authenticated;
-- THEN: change the cross-user reads (Leaderboard/friends/StudyRooms) from `users` → `users_public`,
-- and only after that:
--   select public.reset_policies('users');
--   alter table public.users enable row level security;
--   create policy users_self on public.users for all
--     using (auth_id = auth.uid()) with check (auth_id = auth.uid());

notify pgrst, 'reload schema';
