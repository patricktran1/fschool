-- supabase-friends-migration.sql
-- The friendship graph + RPCs that src/api/friends.js calls.
-- Run in Supabase Dashboard → SQL Editor → Run.  Idempotent — safe to re-run.
--
-- WHY THIS FILE EXISTS:
--   friends.js calls list_friends / list_friend_requests / send_friend_request /
--   respond_friend_request / remove_friend via supabase.rpc(...). Those functions
--   were never committed to the repo, so calling them threw "function not found"
--   and the UI showed "No friends yet".
--
-- SCHEMA NOTE: production already has a public.friendships table (built earlier,
-- never committed either) using a CANONICAL PAIR shape, not requester/addressee:
--   id uuid, user_low_id text, user_high_id text, status text,
--   requested_by text, responded_by text, blocked_by text,
--   metadata jsonb, created_at timestamptz, responded_at timestamptz
-- user_low_id/user_high_id is the pair sorted with least()/greatest() so each
-- relationship has exactly one row regardless of who looks it up. This file
-- targets THAT schema — it does not create a new table.
--
-- CONVENTIONS: users.id is TEXT (app uuid in localStorage, NOT Supabase Auth).
--   All ids here are TEXT. Functions are SECURITY DEFINER so they work with the
--   anon key (the app has no auth.uid()).

-- ── Table already exists in prod — just make sure RLS + indexes are in place ──
alter table public.friendships enable row level security;

create unique index if not exists idx_friendships_pair on public.friendships(user_low_id, user_high_id);
create index if not exists idx_friendships_low  on public.friendships(user_low_id, status);
create index if not exists idx_friendships_high on public.friendships(user_high_id, status);

-- ── Drop any ad-hoc versions first ───────────────────────────────────────────
drop function if exists public.list_friends(text);
drop function if exists public.list_friend_requests(text);
drop function if exists public.send_friend_request(text, text);
drop function if exists public.respond_friend_request(text, text, boolean);
drop function if exists public.remove_friend(text, text);

-- ── list_friends(p_user) → [{ friend_id, friends_since }] ─────────────────────
create function public.list_friends(p_user text)
returns table (friend_id text, friends_since timestamptz)
language sql security definer set search_path = public as $$
  select
    case when user_low_id = p_user then user_high_id else user_low_id end,
    coalesce(responded_at, created_at)
  from public.friendships
  where status = 'accepted'
    and (user_low_id = p_user or user_high_id = p_user);
$$;

-- ── list_friend_requests(p_user) → [{ friendship_id, other_user_id, direction, requested_at }]
--    direction is 'incoming' (someone asked you) or 'outgoing' (you asked them).
create function public.list_friend_requests(p_user text)
returns table (friendship_id uuid, other_user_id text, direction text, requested_at timestamptz)
language sql security definer set search_path = public as $$
  select
    id,
    case when user_low_id = p_user then user_high_id else user_low_id end,
    case when requested_by = p_user then 'outgoing' else 'incoming' end,
    created_at
  from public.friendships
  where status = 'pending'
    and (user_low_id = p_user or user_high_id = p_user);
$$;

-- ── send_friend_request(p_requester, p_addressee) ─────────────────────────────
-- Creates a pending request. If the OTHER person already requested you, it
-- auto-accepts. Raises 'already friends' / 'blocked' so the UI can message it.
create function public.send_friend_request(p_requester text, p_addressee text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  lo text := least(p_requester, p_addressee);
  hi text := greatest(p_requester, p_addressee);
  existing public.friendships%rowtype;
begin
  if p_requester = p_addressee then
    raise exception 'cannot friend yourself';
  end if;

  select * into existing from public.friendships
  where user_low_id = lo and user_high_id = hi
  limit 1;

  if found then
    if existing.status = 'accepted' then
      raise exception 'already friends';
    elsif existing.status = 'blocked' then
      raise exception 'blocked';
    elsif existing.status = 'pending' then
      if existing.requested_by = p_addressee then
        -- the other side already asked → accept it now
        update public.friendships
          set status = 'accepted', responded_by = p_requester, responded_at = now()
          where id = existing.id;
        return 'accepted';
      end if;
      return 'pending';                       -- I already have a request out
    else -- declined: allow a fresh request from whoever is asking now
      update public.friendships
        set requested_by = p_requester, responded_by = null, blocked_by = null,
            status = 'pending', created_at = now(), responded_at = null
        where id = existing.id;
      return 'pending';
    end if;
  end if;

  insert into public.friendships (user_low_id, user_high_id, status, requested_by)
  values (lo, hi, 'pending', p_requester);
  return 'pending';
end;
$$;

-- ── respond_friend_request(p_user, p_other, p_accept) ─────────────────────────
-- p_user accepts/declines a pending request that p_other sent them.
create function public.respond_friend_request(p_user text, p_other text, p_accept boolean)
returns text
language plpgsql security definer set search_path = public as $$
declare
  lo text := least(p_user, p_other);
  hi text := greatest(p_user, p_other);
  existing public.friendships%rowtype;
begin
  select * into existing from public.friendships
  where user_low_id = lo and user_high_id = hi
    and status = 'pending' and requested_by = p_other
  limit 1;

  if not found then
    raise exception 'no pending request';
  end if;

  update public.friendships
    set status = case when p_accept then 'accepted' else 'declined' end,
        responded_by = p_user,
        responded_at = now()
    where id = existing.id;

  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;

-- ── remove_friend(p_user, p_other) ────────────────────────────────────────────
-- Removes the link in either direction (unfriend / cancel sent / clear declined).
create function public.remove_friend(p_user text, p_other text)
returns void
language sql security definer set search_path = public as $$
  delete from public.friendships
  where user_low_id = least(p_user, p_other)
    and user_high_id = greatest(p_user, p_other);
$$;

-- ── Let the anon + authenticated roles call these over PostgREST ──────────────
grant execute on function public.list_friends(text)                         to anon, authenticated;
grant execute on function public.list_friend_requests(text)                 to anon, authenticated;
grant execute on function public.send_friend_request(text, text)            to anon, authenticated;
grant execute on function public.respond_friend_request(text, text, boolean) to anon, authenticated;
grant execute on function public.remove_friend(text, text)                  to anon, authenticated;

-- ── Quick smoke test (optional — replace the ids with two real users.id) ──────
-- select public.send_friend_request('USER_A_ID', 'USER_B_ID');   -- → 'pending'
-- select * from public.list_friend_requests('USER_B_ID');        -- B sees 1 incoming
-- select public.respond_friend_request('USER_B_ID','USER_A_ID', true); -- → 'accepted'
-- select * from public.list_friends('USER_A_ID');                -- A now sees B
