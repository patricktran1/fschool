-- supabase-courses-source-constraint.sql
-- FIX for Postgres error 23514 (check_violation) on public.courses when the
-- browser extension upserts rows with source = 'extension'.
--
-- BACKGROUND: the extension (extension/background.js) now writes to the SAME
-- schema the live fschoolai.com app reads — `public` — instead of the isolated
-- `neuroagi` schema. public.courses has a CHECK constraint (courses_source_check)
-- that only permits the app's own source values, so extension upserts are rejected
-- with 23514. This migration widens the allowlist to include 'extension'.
--
-- ⚠️ RUN ORDER: apply this on the production project that backs fschoolai.com
--    BEFORE merging/deploying the extension PR — otherwise every extension sync
--    fails. Same gating pattern as the auth Phase-1 SQL.
--
-- ⚠️ DO NOT BLIND-RUN STEP 2. The exact allowlist below is a TEMPLATE. Run STEP 1
--    first, read the real definition, and make sure STEP 2 preserves every value
--    that already appears there (plus 'extension'). Dropping a value still present
--    in existing rows would make this migration fail or orphan data.

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 — inspect the current constraint (read-only). Copy its allowed values.
-- ─────────────────────────────────────────────────────────────────────────────
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.courses'::regclass
  and contype  = 'c'
  and conname   = 'courses_source_check';

-- Also confirm the columns the extension writes actually exist on public.courses:
--   user_id, canvas_course_id, name, course_code, current_score, source, updated_at
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'courses'
order by ordinal_position;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 — widen the allowlist to include 'extension'.
-- Replace the IN (...) list with the EXACT values from STEP 1 plus 'extension'.
-- (The values below are a best-guess template — VERIFY against STEP 1 output.)
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.courses drop constraint if exists courses_source_check;

alter table public.courses
  add constraint courses_source_check
  check (source is null or source in ('manual', 'canvas', 'sync', 'extension'));

-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE on assignments / files: the extension also writes source='extension' to
-- public.assignments and public.files. If those tables have their own
-- *_source_check constraints, repeat STEP 1 + STEP 2 for each:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid in ('public.assignments'::regclass, 'public.files'::regclass)
--     and contype = 'c';
-- ─────────────────────────────────────────────────────────────────────────────
