-- supabase-room-access-migration.sql
-- Phase 1: server-enforced Study Room access filters.
-- Run in Supabase Dashboard → SQL Editor → Run. Idempotent — safe to re-run.
--
-- WHAT THIS DOES
--   1. Adds study_rooms.access_filters JSONB — which eligibility rules the owner
--      enabled, e.g. {"university":true,"friends":true,"fof":false,"course":false}.
--      Rules combine with OR (eligible if you satisfy ANY enabled rule).
--   2. SECURITY DEFINER RPCs that own all room_members writes + the eligibility
--      check, so the rules can't be bypassed by direct table writes with the anon key.
--   3. Revokes direct anon/authenticated writes on room_members (RPCs are the only
--      path), and locks study_rooms.access_filters to the owner-only RPC via
--      column-level UPDATE grants (other columns the client writes stay open).
--
-- CONVENTIONS: users.id TEXT, study_rooms.id UUID, courses.id BIGINT, RLS disabled.

-- ── 1. Column ────────────────────────────────────────────────────────────────
ALTER TABLE public.study_rooms
  ADD COLUMN IF NOT EXISTS access_filters JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. Eligibility check (used by lobby + join) ──────────────────────────────
-- Returns true if p_user may access p_room. Owner always true; empty filters → open.
CREATE OR REPLACE FUNCTION public.check_room_access(p_user text, p_room uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r            public.study_rooms%rowtype;
  f            jsonb;
  owner_school text;
  user_school  text;
  room_cc      text;
BEGIN
  SELECT * INTO r FROM public.study_rooms WHERE id = p_room;
  IF NOT FOUND THEN RETURN false; END IF;
  IF r.created_by = p_user THEN RETURN true; END IF;

  f := COALESCE(r.access_filters, '{}'::jsonb);

  -- No rule enabled → open room.
  IF NOT ( COALESCE((f->>'university')::boolean, false)
        OR COALESCE((f->>'friends')::boolean,   false)
        OR COALESCE((f->>'fof')::boolean,        false)
        OR COALESCE((f->>'course')::boolean,     false) ) THEN
    RETURN true;
  END IF;

  -- university: same (non-null) school as the owner.
  IF COALESCE((f->>'university')::boolean, false) THEN
    SELECT school INTO owner_school FROM public.users WHERE id = r.created_by;
    SELECT school INTO user_school  FROM public.users WHERE id = p_user;
    IF owner_school IS NOT NULL AND user_school IS NOT NULL
       AND lower(btrim(owner_school)) = lower(btrim(user_school)) THEN
      RETURN true;
    END IF;
  END IF;

  -- friends: accepted friendship between user and owner.
  IF COALESCE((f->>'friends')::boolean, false) THEN
    IF EXISTS (
      SELECT 1 FROM public.friendships
      WHERE status = 'accepted'
        AND user_low_id  = least(p_user, r.created_by)
        AND user_high_id = greatest(p_user, r.created_by)
    ) THEN RETURN true; END IF;
  END IF;

  -- friends of friends: user and owner share an accepted friend.
  IF COALESCE((f->>'fof')::boolean, false) THEN
    IF EXISTS (
      WITH owner_friends AS (
        SELECT CASE WHEN user_low_id = r.created_by THEN user_high_id ELSE user_low_id END AS fid
        FROM public.friendships
        WHERE status = 'accepted' AND (user_low_id = r.created_by OR user_high_id = r.created_by)
      ),
      user_friends AS (
        SELECT CASE WHEN user_low_id = p_user THEN user_high_id ELSE user_low_id END AS fid
        FROM public.friendships
        WHERE status = 'accepted' AND (user_low_id = p_user OR user_high_id = p_user)
      )
      SELECT 1 FROM owner_friends o JOIN user_friends u ON o.fid = u.fid
      WHERE o.fid <> p_user AND o.fid <> r.created_by
    ) THEN RETURN true; END IF;
  END IF;

  -- course: user takes the same course (matched by canvas_course_id) as the room's
  -- linked course; falls back to course_code when the linked course has no canvas id.
  IF COALESCE((f->>'course')::boolean, false) AND r.course_id IS NOT NULL THEN
    SELECT canvas_course_id INTO room_cc FROM public.courses WHERE id = r.course_id;
    IF room_cc IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM public.courses c
                 WHERE c.user_id = p_user AND c.canvas_course_id = room_cc) THEN
        RETURN true;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.courses c
        JOIN public.courses rc ON rc.id = r.course_id
        WHERE c.user_id = p_user
          AND rc.course_code IS NOT NULL
          AND lower(btrim(c.course_code)) = lower(btrim(rc.course_code))
      ) THEN RETURN true; END IF;
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- ── 3. Lobby list — only rooms the user may see ──────────────────────────────
CREATE OR REPLACE FUNCTION public.list_accessible_rooms(p_user text)
RETURNS SETOF public.study_rooms
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM public.study_rooms r
  WHERE r.is_active = true
    AND public.check_room_access(p_user, r.id)
  ORDER BY r.last_active DESC
  LIMIT 50;
$$;

-- ── 4. Join — the only path to a room_members write for self-join ────────────
-- Returns 'joined' | 'requested' | 'denied' | 'not_found'.
--   • owner            → host/joined
--   • already joined   → joined
--   • invited row      → joined
--   • valid join code  → joined (bypasses type + filters)
--   • ineligible       → denied
--   • invite-only room → requested
--   • public + eligible→ joined
CREATE OR REPLACE FUNCTION public.join_room(p_user text, p_room uuid, p_code text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r        public.study_rooms%rowtype;
  existing public.room_members%rowtype;
BEGIN
  SELECT * INTO r FROM public.study_rooms WHERE id = p_room;
  IF NOT FOUND OR NOT r.is_active THEN RETURN 'not_found'; END IF;

  IF r.created_by = p_user THEN
    INSERT INTO public.room_members(room_id, user_id, role, status)
    VALUES (p_room, p_user, 'host', 'joined')
    ON CONFLICT (room_id, user_id) DO UPDATE SET role = 'host', status = 'joined';
    RETURN 'joined';
  END IF;

  SELECT * INTO existing FROM public.room_members WHERE room_id = p_room AND user_id = p_user;
  IF FOUND AND existing.status = 'joined'  THEN RETURN 'joined'; END IF;
  IF FOUND AND existing.status = 'invited' THEN
    UPDATE public.room_members SET status = 'joined', role = 'member'
      WHERE room_id = p_room AND user_id = p_user;
    RETURN 'joined';
  END IF;

  IF p_code IS NOT NULL AND r.join_code IS NOT NULL AND upper(p_code) = upper(r.join_code) THEN
    INSERT INTO public.room_members(room_id, user_id, role, status)
    VALUES (p_room, p_user, 'member', 'joined')
    ON CONFLICT (room_id, user_id) DO UPDATE SET status = 'joined';
    RETURN 'joined';
  END IF;

  IF NOT public.check_room_access(p_user, p_room) THEN
    RETURN 'denied';
  END IF;

  IF r.room_type = 'invite' THEN
    INSERT INTO public.room_members(room_id, user_id, role, status)
    VALUES (p_room, p_user, 'member', 'requested')
    ON CONFLICT (room_id, user_id) DO UPDATE
      SET status = CASE WHEN room_members.status = 'joined' THEN 'joined' ELSE 'requested' END;
    RETURN 'requested';
  END IF;

  INSERT INTO public.room_members(room_id, user_id, role, status)
  VALUES (p_room, p_user, 'member', 'joined')
  ON CONFLICT (room_id, user_id) DO UPDATE SET status = 'joined';
  RETURN 'joined';
END;
$$;

-- ── 5. Host responds to a join request ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_room_request(p_owner text, p_room uuid, p_member text, p_accept boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.study_rooms%rowtype;
BEGIN
  SELECT * INTO r FROM public.study_rooms WHERE id = p_room;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF r.created_by <> p_owner THEN RAISE EXCEPTION 'not room owner'; END IF;
  IF p_accept THEN
    UPDATE public.room_members SET status = 'joined' WHERE room_id = p_room AND user_id = p_member;
    RETURN 'joined';
  ELSE
    DELETE FROM public.room_members WHERE room_id = p_room AND user_id = p_member;
    RETURN 'declined';
  END IF;
END;
$$;

-- ── 6. A member invites someone (writes an 'invited' row) ─────────────────────
CREATE OR REPLACE FUNCTION public.invite_to_room(p_inviter text, p_room uuid, p_invitee text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.room_members
                 WHERE room_id = p_room AND user_id = p_inviter AND status = 'joined') THEN
    RAISE EXCEPTION 'inviter not in room';
  END IF;
  INSERT INTO public.room_members(room_id, user_id, role, status)
  VALUES (p_room, p_invitee, 'member', 'invited')
  ON CONFLICT (room_id, user_id) DO NOTHING;
END;
$$;

-- ── 7. Leave ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_room(p_user text, p_room uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.room_members WHERE room_id = p_room AND user_id = p_user;
$$;

-- ── 8. Owner edits the access filters ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_room_access(p_owner text, p_room uuid, p_filters jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.study_rooms%rowtype;
BEGIN
  SELECT * INTO r FROM public.study_rooms WHERE id = p_room;
  IF NOT FOUND THEN RAISE EXCEPTION 'room not found'; END IF;
  IF r.created_by <> p_owner THEN RAISE EXCEPTION 'not room owner'; END IF;
  UPDATE public.study_rooms SET access_filters = COALESCE(p_filters, '{}'::jsonb) WHERE id = p_room;
END;
$$;

-- ── 9. Grants + write lockdown ───────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.check_room_access(text, uuid)               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_accessible_rooms(text)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_room(text, uuid, text)                 TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_room_request(text, uuid, text, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_to_room(text, uuid, text)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leave_room(text, uuid)                      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_room_access(text, uuid, jsonb)          TO anon, authenticated;

-- room_members: RPCs (SECURITY DEFINER) own all writes. Keep SELECT for the lobby,
-- the host request queue, and realtime postgres_changes.
REVOKE INSERT, UPDATE, DELETE ON public.room_members FROM anon, authenticated;
GRANT  SELECT                  ON public.room_members TO   anon, authenticated;

-- study_rooms: lock access_filters to set_room_access (owner-only) by re-granting
-- UPDATE only on the columns the client legitimately writes directly. INSERT stays
-- open so room creation (creator = owner) can set filters at creation time.
REVOKE UPDATE ON public.study_rooms FROM anon, authenticated;
GRANT  UPDATE (name, course_id, room_type, max_members, is_active, join_code, pomodoro_state, last_active)
  ON public.study_rooms TO anon, authenticated;

-- ── Smoke test (optional — replace ids) ──────────────────────────────────────
-- select public.set_room_access('OWNER_ID','ROOM_UUID','{"friends":true}'::jsonb);
-- select public.check_room_access('OTHER_ID','ROOM_UUID');   -- false unless friend
-- select * from public.list_accessible_rooms('OTHER_ID');
