-- ============================================================
-- NeuroAgi app schema — ISOLATED `neuroagi` schema inside the
-- shared FschoolAI project (wqgxpouhbwhwpzudrptp).
--
-- Creates everything the React app + Chrome extension + Vercel
-- api/ functions need, WITHOUT touching Vincent's public.* tables
-- or the project's global storage.* policies.
--
-- Run in: Supabase Dashboard → SQL Editor → New query → Run.
-- Safe / idempotent. Non-destructive to anything outside `neuroagi`.
--
-- PREREQUISITE (one-time, in dashboard): Settings → API →
--   "Exposed schemas" → add `neuroagi` (keep `public`).
-- ============================================================

create schema if not exists neuroagi;

-- API roles must be able to use the schema. `public` gets these grants
-- automatically; a brand-new schema does not — so they're explicit here.
grant usage on schema neuroagi to anon, authenticated, service_role;

-- ── users (client-generated UUID stored as text, no Supabase Auth) ─
create table if not exists neuroagi.users (
  id                 text primary key,
  name               text,
  email              text unique,
  password_hash      text,
  school             text,
  city               text,
  country            text,
  continent          text,
  canvas_token       text,
  canvas_base_url    text,
  ring_name          text,
  study_time         float    default 0,
  streak             int      default 0,
  gpa                float,
  favorite_song      text,
  leaderboard_opt_in boolean  default false,
  canvas_synced_at   timestamptz,
  created_at         timestamptz default now()
);

-- ── courses ──────────────────────────────────────────────────
create table if not exists neuroagi.courses (
  id               uuid primary key default gen_random_uuid(),
  user_id          text references neuroagi.users(id) on delete cascade,
  canvas_course_id text,
  name             text,
  course_code      text,
  current_score    float,
  final_score      float,
  image_url        text,
  source           text default 'canvas',
  is_manual        boolean default false,
  updated_at       timestamptz default now(),
  unique(user_id, canvas_course_id)
);

-- ── assignments ──────────────────────────────────────────────
create table if not exists neuroagi.assignments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              text references neuroagi.users(id) on delete cascade,
  course_id            uuid references neuroagi.courses(id) on delete cascade,
  canvas_assignment_id text,
  title                text,
  description          text,
  due_at               timestamptz,
  points_possible      float,
  score                float,
  submitted_at         timestamptz,
  submission_type      text,
  late                 boolean default false,
  missing              boolean default false,
  source               text default 'canvas',
  is_manual            boolean default false,
  updated_at           timestamptz default now(),
  unique(user_id, canvas_assignment_id)
);

-- ── canvas_data (blob store — extension writes ext_* data_types) ─
create table if not exists neuroagi.canvas_data (
  id         bigint generated always as identity primary key,
  user_id    text references neuroagi.users(id) on delete cascade,
  data_type  text,
  payload    jsonb,
  synced_at  timestamptz default now(),
  unique(user_id, data_type)
);

-- ── files (extension file index — one row per LMS file) ──────
create table if not exists neuroagi.files (
  id            uuid primary key default gen_random_uuid(),
  user_id       text references neuroagi.users(id) on delete cascade,
  course_id     uuid references neuroagi.courses(id) on delete cascade,
  assignment_id uuid references neuroagi.assignments(id) on delete set null,
  lms_file_id   text,
  name          text,
  file_type     text,
  size_bytes    bigint,
  source_url    text,
  folder        text,
  status        text,
  content_text  text,   -- PHASE 2: extracted text for the AI (null until then)
  source        text default 'extension',
  updated_at    timestamptz default now(),
  unique(user_id, lms_file_id)
);

-- ── flashcards ───────────────────────────────────────────────
create table if not exists neuroagi.flashcards (
  id           bigint generated always as identity primary key,
  user_id      text references neuroagi.users(id) on delete cascade,
  course_id    uuid references neuroagi.courses(id) on delete cascade,
  cards        jsonb,
  generated_at timestamptz default now(),
  unique(user_id, course_id)
);

-- ── chat_logs ────────────────────────────────────────────────
create table if not exists neuroagi.chat_logs (
  id         bigint generated always as identity primary key,
  user_id    text references neuroagi.users(id) on delete cascade,
  role       text,
  content    text,
  page       text,
  created_at timestamptz default now()
);

-- ── tutor_impressions (one row per chat exchange) ────────────
create table if not exists neuroagi.tutor_impressions (
  id         bigint generated always as identity primary key,
  user_id    text references neuroagi.users(id) on delete cascade,
  impression text,
  created_at timestamptz default now()
);

-- ── tutor_mind (one row per user, full rewrite each session) ─
create table if not exists neuroagi.tutor_mind (
  user_id    text primary key references neuroagi.users(id) on delete cascade,
  mind_doc   text,
  updated_at timestamptz default now()
);

-- ── beta_sessions (page analytics) ──────────────────────────
create table if not exists neuroagi.beta_sessions (
  id               bigint generated always as identity primary key,
  user_id          text references neuroagi.users(id) on delete cascade,
  page             text,
  entered_at       timestamptz,
  exited_at        timestamptz,
  duration_seconds int
);

-- ── schools (onboarding autocomplete lookup) ─────────────────
create table if not exists neuroagi.schools (
  id         bigint generated always as identity primary key,
  name       text,
  city       text,
  country    text,
  continent  text,
  status     text,
  login_url  text,
  token_flow text,
  domain     text
);

-- ── Open RLS policies (app uses its own UUID identity, auth.uid()
--    is always null — open policies are intentional, same as public). ─
do $$
declare t text;
begin
  foreach t in array array[
    'users','courses','assignments','files','canvas_data','flashcards',
    'chat_logs','tutor_impressions','tutor_mind','beta_sessions','schools'
  ]
  loop
    execute format('alter table neuroagi.%I enable row level security;', t);
    execute format('drop policy if exists "open_all" on neuroagi.%I;', t);
    execute format('create policy "open_all" on neuroagi.%I for all using (true) with check (true);', t);
  end loop;
end $$;

-- ── Table/sequence privileges for the API roles ─────────────
--    (public grants these automatically; a new schema needs them explicit) ─
grant all on all tables    in schema neuroagi to anon, authenticated, service_role;
grant all on all sequences in schema neuroagi to anon, authenticated, service_role;
alter default privileges in schema neuroagi grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema neuroagi grant all on sequences to anon, authenticated, service_role;

-- NOTE: storage buckets/policies are project-GLOBAL (storage schema) and
-- shared with Vincent's app — deliberately NOT modified here. If the app's
-- image upload feature is needed, coordinate storage bucket setup separately.
