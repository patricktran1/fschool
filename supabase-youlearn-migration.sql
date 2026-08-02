-- supabase-youlearn-migration.sql
-- Phase 1: YouLearn document reader
-- Run in Supabase Dashboard → SQL Editor
--
-- Adds AI-processed columns to the files table so extracted text, summary,
-- and highlights persist — re-opening a processed file is instant (no re-extraction).

ALTER TABLE public.files ADD COLUMN IF NOT EXISTS content_text  TEXT;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS summary       TEXT;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS highlights    JSONB;   -- string[]
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS processed_at  TIMESTAMPTZ;

-- Ensure files table has user_id (should exist already, but idempotent)
-- ALTER TABLE public.files ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Index for fast per-user file lookup (may already exist)
CREATE INDEX IF NOT EXISTS files_user_id_idx ON public.files (user_id, created_at DESC);

-- RLS must be OFF so anon-key client can read/write (matches existing pattern)
ALTER TABLE public.files DISABLE ROW LEVEL SECURITY;
