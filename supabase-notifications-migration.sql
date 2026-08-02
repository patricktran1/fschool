-- supabase-notifications-migration.sql
-- Run in Supabase Dashboard → SQL Editor.
-- Creates the notifications table for the in-app bell system.

CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL,   -- friend_request | request_accepted | nudge | room_invite | assignment_due | milestone
  title      TEXT,
  body       TEXT,
  data       JSONB,                  -- type-specific: { from_user_id, from_name, room_id, assignment_id, ... }
  read       BOOLEAN     NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: fast lookup of a user's unread notifications, newest first
CREATE INDEX IF NOT EXISTS notifications_user_idx
  ON public.notifications (user_id, read, created_at DESC);

-- CRITICAL: RLS must be DISABLED — the app uses the anon key and RLS would 401 every read/write
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
