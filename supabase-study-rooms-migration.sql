-- supabase-study-rooms-migration.sql
-- Study Rooms MVP tables. Run in Supabase Dashboard → SQL Editor → Run.
-- Conventions: users.id TEXT, course_id BIGINT, RLS DISABLED.
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.study_rooms (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by     TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  course_id      BIGINT      REFERENCES public.courses(id) ON DELETE SET NULL,
  room_type      TEXT        NOT NULL DEFAULT 'public'
                 CHECK (room_type IN ('public','invite')),
  max_members    INTEGER     NOT NULL DEFAULT 20,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  join_code      TEXT        UNIQUE,        -- 6-char share code; client retries on collision
  pomodoro_state JSONB,                     -- latest shared timer state, read by late joiners
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Columns added after the first cut — idempotent so re-running upgrades an old table.
ALTER TABLE public.study_rooms ADD COLUMN IF NOT EXISTS join_code      TEXT;
ALTER TABLE public.study_rooms ADD COLUMN IF NOT EXISTS pomodoro_state JSONB;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'study_rooms_join_code_key') THEN
    ALTER TABLE public.study_rooms ADD CONSTRAINT study_rooms_join_code_key UNIQUE (join_code);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.room_members (
  room_id   UUID NOT NULL REFERENCES public.study_rooms(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('host','member')),
  status    TEXT NOT NULL DEFAULT 'joined'
            CHECK (status IN ('invited','requested','joined')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.room_sessions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        UUID        NOT NULL REFERENCES public.study_rooms(id) ON DELETE CASCADE,
  user_id        TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at        TIMESTAMPTZ,
  duration_secs  INTEGER,
  working_on     TEXT,
  goal_text      TEXT,                       -- session goal set on entry
  goal_met       BOOLEAN,                    -- self-reported on leave
  tokens_awarded INTEGER     NOT NULL DEFAULT 0
);
ALTER TABLE public.room_sessions ADD COLUMN IF NOT EXISTS goal_text TEXT;
ALTER TABLE public.room_sessions ADD COLUMN IF NOT EXISTS goal_met  BOOLEAN;

CREATE TABLE IF NOT EXISTS public.nudges (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user_id   TEXT        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  room_id      UUID        REFERENCES public.study_rooms(id) ON DELETE SET NULL,
  kind         TEXT        NOT NULL DEFAULT 'nudge' CHECK (kind IN ('nudge','invite')),
  seen         BOOLEAN     NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_sessions_user ON public.room_sessions(user_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_rooms_active  ON public.study_rooms(is_active, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_nudges_to           ON public.nudges(to_user_id, seen, created_at DESC);

ALTER TABLE public.study_rooms  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.nudges        DISABLE ROW LEVEL SECURITY;

-- Realtime: the lobby (new rooms), host request queue, and incoming nudges all use
-- postgres_changes — those events only fire for tables in the supabase_realtime
-- publication. (In-room presence + Pomodoro use channel broadcast, which needs none.)
-- Guarded so re-running doesn't error on an already-published table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['study_rooms','room_members','nudges'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
