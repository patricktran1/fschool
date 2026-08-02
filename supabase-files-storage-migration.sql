-- supabase-files-storage-migration.sql
-- Stores the ACTUAL file bytes (not just LMS links) so a student can open the
-- real document, and the agent can hand out a working link to it.
--
-- Design:
--   • Bucket `course-files` is PRIVATE. The browser extension uploads file bytes
--     with the anon/publishable key (the only key it can ship), so anon needs
--     INSERT + UPDATE on objects in this bucket — but NOT read.
--   • Downloads happen ONLY through short-lived signed URLs minted server-side
--     with the service key (see api/file-url.js + api/tutor-context.js). So the
--     bucket is never world-readable and links expire.
--
-- Run once in the Supabase SQL editor for the project the app/extension use.

-- 1. Where each file's bytes live in the bucket (path relative to the bucket,
--    e.g. "<userId>/<lms_file_id>.pdf"). NULL until the extension uploads it.
alter table if exists neuroagi.files
  add column if not exists storage_path text;

-- 2. Ensure the private bucket exists (idempotent; also created out-of-band).
insert into storage.buckets (id, name, public, file_size_limit)
values ('course-files', 'course-files', false, 26214400)
on conflict (id) do update set public = false;

-- 3. Let the extension's anon key WRITE bytes into this bucket (reads stay
--    server-only via signed URLs, so no anon SELECT policy is granted).
drop policy if exists "course-files anon insert" on storage.objects;
create policy "course-files anon insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'course-files');

drop policy if exists "course-files anon update" on storage.objects;
create policy "course-files anon update" on storage.objects
  for update to anon, authenticated
  using      (bucket_id = 'course-files')
  with check (bucket_id = 'course-files');
