-- nav_mode: which navigation UI the student prefers.
-- 'swipe' = spatial gesture graph (default / original), 'tabs' = bottom tab bar.
-- The app also mirrors this to localStorage, so it works before this runs;
-- adding the column enables the choice to sync across devices.

alter table public.users
  add column if not exists nav_mode text not null default 'swipe';

-- guard against unexpected values
alter table public.users
  drop constraint if exists users_nav_mode_check;
alter table public.users
  add constraint users_nav_mode_check check (nav_mode in ('swipe', 'tabs'));
