-- Adaptive spaced repetition (SM-2) scheduling state, one row per (user, card).
-- Cards live as JSON in `flashcards.cards`, so we key on a stable card_key derived
-- from course + question text (see src/lib/srs.ts cardKey).

create table if not exists public.srs_reviews (
  user_id          text references public.users(id) on delete cascade,
  card_key         text not null,
  course_id        uuid,
  question         text,
  answer           text,
  ease             real default 2.5,
  interval_days    real default 0,
  reps             int  default 0,
  lapses           int  default 0,
  due_at           timestamptz,
  last_reviewed_at timestamptz,
  created_at       timestamptz default now(),
  primary key (user_id, card_key)
);

create index if not exists srs_reviews_due_idx on public.srs_reviews (user_id, due_at);

-- Same anon-client / service-key pattern as the rest of the app → RLS off.
alter table public.srs_reviews disable row level security;
