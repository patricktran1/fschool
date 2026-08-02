-- Chat history: group flat chat_logs into named conversations.
-- The NeuralRing chat previously loaded a user's last 20 messages as one perpetual
-- thread. This adds conversations so users can start new chats and revisit old ones.

-- ── chat_conversations ───────────────────────────────────────
create table if not exists public.chat_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    text references public.users(id) on delete cascade,
  title      text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Group messages by conversation. Nullable so legacy rows survive; the backfill
-- below assigns them to a single "Earlier conversation" per user.
alter table public.chat_logs
  add column if not exists conversation_id uuid references public.chat_conversations(id) on delete cascade;

create index if not exists chat_conversations_user_updated_idx
  on public.chat_conversations (user_id, updated_at desc);
create index if not exists chat_logs_conversation_idx
  on public.chat_logs (conversation_id, created_at);

-- This app uses the anon key with no Supabase Auth (like chat_logs/users), so
-- RLS must be OFF or every insert is rejected (error 42501). Match the siblings.
alter table public.chat_conversations disable row level security;

-- ── One-time backfill: legacy flat history → one conversation per user ────────
-- Safe to re-run: only touches rows that still have a null conversation_id.
do $$
declare
  u record;
  new_conv uuid;
begin
  for u in
    select distinct user_id
    from public.chat_logs
    where conversation_id is null and user_id is not null
  loop
    insert into public.chat_conversations (user_id, title, created_at, updated_at)
    values (
      u.user_id,
      'Earlier conversation',
      coalesce((select min(created_at) from public.chat_logs where user_id = u.user_id and conversation_id is null), now()),
      coalesce((select max(created_at) from public.chat_logs where user_id = u.user_id and conversation_id is null), now())
    )
    returning id into new_conv;

    update public.chat_logs
    set conversation_id = new_conv
    where user_id = u.user_id and conversation_id is null;
  end loop;
end $$;
