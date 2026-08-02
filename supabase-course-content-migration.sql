-- supabase-course-content-migration.sql
-- Creates the shared course content library table.
--
-- This is the "data moat": content extracted from LMS pages by the browser
-- extension is stored here deduplicated across all students. One row per unique
-- piece of content (syllabus, lecture, rubric, etc.) per course. When two
-- students visit the same page, seen_by_count increments instead of inserting
-- a duplicate. Claude Haiku processes each new row to extract a summary and
-- concept list for the AI tutor (see api/extension-content.js).
--
-- Run in: Supabase Dashboard → SQL Editor → Run.
-- Idempotent — safe to re-run.
-- Targets public schema only (neuroagi is dead/unused).

-- ── Table ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.course_content (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Identity ──────────────────────────────────────────────────────────────
  university_id    TEXT        NOT NULL DEFAULT 'unknown',
                                -- short ID derived from LMS URL, e.g. 'uoft', 'ubc'
  course_id        TEXT        NOT NULL,
                                -- courseCode or Canvas course ID string
  canvas_course_id TEXT,        -- original Canvas course ID for joining to courses table
  content_type     TEXT        NOT NULL
                                CHECK (content_type IN ('syllabus','lecture','rubric','announcement','module','file')),

  -- ── Deduplication ─────────────────────────────────────────────────────────
  content_hash     TEXT        NOT NULL UNIQUE,
                                -- SHA-256 of (university_id|course_id|content_type|text[:500])
                                -- Same content from any student → same hash → no duplicate

  -- ── Content ───────────────────────────────────────────────────────────────
  text             TEXT,        -- full extracted text, capped at 50 000 chars by ingest
  week_number      INTEGER,     -- semester week if available (lectures)
  module_name      TEXT,        -- module or file name
  professor_name   TEXT,        -- extracted from page
  source_url       TEXT,        -- original session-gated LMS URL

  -- ── AI-enriched fields (written by Library Organizer after insert) ────────
  summary          TEXT,        -- 2-3 sentence Claude summary
  concepts         JSONB,       -- string[] of key concepts, e.g. ["dynamic programming","memoization"]

  -- ── Crowd signal ──────────────────────────────────────────────────────────
  seen_by_count    INTEGER      NOT NULL DEFAULT 1,
                                -- how many students have visited this content
  last_seen_at     TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS: DISABLED ─────────────────────────────────────────────────────────────
-- No per-user rows — this is a shared table. Anon key must write freely.
-- DISABLE (not ENABLE + open policy) so there is no RLS overhead at all.
ALTER TABLE public.course_content DISABLE ROW LEVEL SECURITY;

-- ── Indexes ───────────────────────────────────────────────────────────────────
-- Dedup lookup (hot path — every extension submission hits this)
CREATE UNIQUE INDEX IF NOT EXISTS course_content_hash_idx
  ON public.course_content (content_hash);

-- AI tutor query path: Study.jsx queries by canvas_course_id
CREATE INDEX IF NOT EXISTS course_content_canvas_course_idx
  ON public.course_content (canvas_course_id)
  WHERE canvas_course_id IS NOT NULL;

-- University + course scoping (leaderboard / library browse)
CREATE INDEX IF NOT EXISTS course_content_university_course_idx
  ON public.course_content (university_id, course_id);

-- Week ordering (Study.jsx orders by week_number DESC)
CREATE INDEX IF NOT EXISTS course_content_week_idx
  ON public.course_content (canvas_course_id, week_number DESC NULLS LAST)
  WHERE canvas_course_id IS NOT NULL;
