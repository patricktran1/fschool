-- supabase-room-chat-migration.sql
-- Phase 2: Persisted in-room chat.
-- Run in Supabase Dashboard → SQL Editor → Run. Idempotent — safe to re-run.
--
-- KEY DECISION (from team): room "deletion" = is_active=false, never a real DELETE.
-- Messages are kept forever. ON DELETE RESTRICT ensures no accidental wipe if
-- someone tries to DELETE a study_rooms row directly.

-- ── 1. Table ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.room_messages (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    UUID        NOT NULL REFERENCES public.study_rooms(id) ON DELETE RESTRICT,
  user_id    TEXT        NOT NULL,
  name       TEXT        NOT NULL,
  body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS room_messages_room_created
  ON public.room_messages (room_id, created_at);

-- ── 2. RPC: post a message (verifies sender is a joined member) ──────────────
CREATE OR REPLACE FUNCTION public.post_room_message(
  p_user text, p_room uuid, p_name text, p_body text
)
RETURNS public.room_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  msg public.room_messages;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room AND user_id = p_user AND status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not a joined member';
  END IF;

  INSERT INTO public.room_messages(room_id, user_id, name, body)
  VALUES (p_room, p_user, p_name, trim(p_body))
  RETURNING * INTO msg;

  RETURN msg;
END;
$$;

-- ── 3. RPC: load recent messages (verifies caller is a joined member) ────────
-- Reads go through a SECURITY DEFINER function so they work whether or not RLS is
-- enabled on room_messages, AND so only joined members can read a room's history.
-- (A plain anon SELECT either leaks every room's chat, or — if RLS is on — returns
-- nothing. Both are wrong; this RPC is the single correct read path.)
CREATE OR REPLACE FUNCTION public.list_room_messages(
  p_user text, p_room uuid, p_limit int DEFAULT 100
)
RETURNS SETOF public.room_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.room_members
    WHERE room_id = p_room AND user_id = p_user AND status = 'joined'
  ) THEN
    RAISE EXCEPTION 'not a joined member';
  END IF;

  RETURN QUERY
    SELECT * FROM public.room_messages
    WHERE room_id = p_room
    ORDER BY created_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 500));
END;
$$;

-- ── 4. Grants + write lockdown ───────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.post_room_message(text, uuid, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_room_messages(text, uuid, int)
  TO anon, authenticated;

-- Reads + writes are RPC-only. Lock the table down on every privilege; the
-- SECURITY DEFINER functions above are the sole access path. This is correct
-- regardless of whether RLS is enabled on the table.
REVOKE INSERT, UPDATE, DELETE, SELECT ON public.room_messages FROM anon, authenticated;

-- One-time cleanup of any diagnostic row left during debugging (harmless if none).
DELETE FROM public.room_messages WHERE body = 'rls-probe-msg' AND name = 'DIAGNOSTIC';
