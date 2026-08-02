-- ============================================================
-- NeuroAgi — public schema for a fresh Supabase project
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query → Run
-- Safe to re-run (uses IF NOT EXISTS / idempotent policies).
-- Do NOT touch the auth.* schema — Supabase manages that automatically.
-- ============================================================

-- ── users ────────────────────────────────────────────────────
-- id is a client-generated UUID stored as text (no Supabase Auth).
create table if not exists public.users (
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
create table if not exists public.courses (
  id               uuid primary key default gen_random_uuid(),
  user_id          text references public.users(id) on delete cascade,
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
create table if not exists public.assignments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              text references public.users(id) on delete cascade,
  course_id            uuid references public.courses(id) on delete cascade,
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

-- ── canvas_data (blob store) ─────────────────────────────────
-- NOTE: deliberately NO check constraint on data_type, so the
-- browser extension can write ext_courses / ext_assignments / ext_grades.
create table if not exists public.canvas_data (
  id         bigint generated always as identity primary key,
  user_id    text references public.users(id) on delete cascade,
  data_type  text,
  payload    jsonb,
  synced_at  timestamptz default now(),
  unique(user_id, data_type)
);

-- ── files (extension file index — one row per LMS file) ──────
create table if not exists public.files (
  id            uuid primary key default gen_random_uuid(),
  user_id       text references public.users(id) on delete cascade,
  course_id     uuid references public.courses(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
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
create table if not exists public.flashcards (
  id           bigint generated always as identity primary key,
  user_id      text references public.users(id) on delete cascade,
  course_id    uuid references public.courses(id) on delete cascade,
  cards        jsonb,
  generated_at timestamptz default now(),
  unique(user_id, course_id)
);

-- ── chat_logs ────────────────────────────────────────────────
create table if not exists public.chat_logs (
  id         bigint generated always as identity primary key,
  user_id    text references public.users(id) on delete cascade,
  role       text,
  content    text,
  page       text,
  created_at timestamptz default now()
);

-- ── tutor_impressions (one row per chat exchange) ────────────
create table if not exists public.tutor_impressions (
  id         bigint generated always as identity primary key,
  user_id    text references public.users(id) on delete cascade,
  impression text,
  created_at timestamptz default now()
);

-- ── tutor_mind (one row per user, full rewrite each session) ─
create table if not exists public.tutor_mind (
  user_id    text primary key references public.users(id) on delete cascade,
  mind_doc   text,
  updated_at timestamptz default now()
);

-- ── beta_sessions (page analytics) ──────────────────────────
create table if not exists public.beta_sessions (
  id               bigint generated always as identity primary key,
  user_id          text references public.users(id) on delete cascade,
  page             text,
  entered_at       timestamptz,
  exited_at        timestamptz,
  duration_seconds int
);

-- ── schools (lookup table for onboarding autocomplete) ───────
create table if not exists public.schools (
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

-- ============================================================
-- Row Level Security — open policies.
-- This app uses its own UUID identity (no Supabase Auth), so
-- auth.uid() is always null. Open policies are intentional.
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'users','courses','assignments','files','canvas_data','flashcards',
    'chat_logs','tutor_impressions','tutor_mind','beta_sessions','schools'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "open_all" on public.%I;', t);
    execute format('create policy "open_all" on public.%I for all using (true) with check (true);', t);
  end loop;
end $$;

-- ============================================================
-- Storage buckets (run separately if SQL errors — or create in
-- Dashboard → Storage): "uploads" (manual image uploads) and
-- "course-files" (extension file sync).
-- ============================================================
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true), ('course-files', 'course-files', true)
on conflict (id) do nothing;

-- Open storage policies
drop policy if exists "open_storage_select" on storage.objects;
drop policy if exists "open_storage_insert" on storage.objects;
create policy "open_storage_select" on storage.objects for select using (true);
create policy "open_storage_insert" on storage.objects for insert with check (true);
