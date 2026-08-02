-- Schema-drift repair. Some `courses` / `assignments` tables predate the `source`
-- and `is_manual` columns the app relies on to tell manual courses apart from Canvas
-- ones. Symptom: PGRST204 "Could not find the 'is_manual' column of 'courses'".
-- Idempotent — safe to run repeatedly.

alter table public.courses     add column if not exists source        text default 'canvas';
alter table public.courses     add column if not exists is_manual     boolean default false;
alter table public.courses     add column if not exists current_score float;
alter table public.courses     add column if not exists final_score   float;
alter table public.courses     add column if not exists image_url     text;
alter table public.courses     add column if not exists updated_at    timestamptz default now();

alter table public.assignments add column if not exists source    text default 'canvas';
alter table public.assignments add column if not exists is_manual boolean default false;

-- Make PostgREST pick up the new columns immediately (otherwise inserts keep 404ing
-- on them until the schema cache refreshes on its own).
notify pgrst, 'reload schema';
