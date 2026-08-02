-- flashcards_v2: one row per card (replaces single-row flashcards table)
create table if not exists flashcards_v2 (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  uuid not null,
  question   text not null,
  answer     text not null,
  created_at timestamptz not null default now()
);

create index if not exists flashcards_v2_user_course
  on flashcards_v2 (user_id, course_id, created_at desc);

alter table flashcards_v2 enable row level security;

create policy "Users can manage their own flashcards"
  on flashcards_v2
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
