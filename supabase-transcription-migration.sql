-- Large audio/video transcription via direct-to-Storage upload + ElevenLabs Scribe.
-- The browser uploads the file straight to Storage (bypassing the ~4.5MB serverless
-- body limit); the server downloads it and transcribes it via Scribe, then feeds the
-- transcript into the RAG pipeline. media_jobs tracks status for the client.

-- Job tracking (polled by the client for status).
create table if not exists public.media_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      text references public.users(id) on delete cascade,
  course_id    uuid,
  title        text,
  kind         text,                    -- audio | video
  storage_path text,                    -- object path in the media-uploads bucket
  provider     text default 'elevenlabs',
  provider_id  text,                    -- provider transcript/job id (unused for sync Scribe)
  status       text default 'pending',  -- pending|transcribing|indexing|done|error
  document_id  uuid,                     -- rag_documents.id once ingested
  error        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists media_jobs_user_idx     on public.media_jobs (user_id, created_at desc);
create index if not exists media_jobs_provider_idx on public.media_jobs (provider_id);

-- Same anon-client / service-key pattern as the rest of the app → RLS off.
alter table public.media_jobs disable row level security;

-- Private bucket for raw uploads. Uploads use short-lived signed upload URLs (token
-- based), and reads use server-minted signed URLs — so no Storage RLS policy needed.
insert into storage.buckets (id, name, public)
values ('media-uploads', 'media-uploads', false)
on conflict (id) do nothing;
