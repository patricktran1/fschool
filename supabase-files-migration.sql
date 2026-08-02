-- ============================================================
-- NeuroAgi — `files` table migration
--
-- Adds a structured file index the Chrome extension populates from
-- the student's LMS (Canvas / D2L / Moodle): one row per file,
-- tagged to its course and (where known) its assignment, plus rich
-- context (type, status, source url, folder).
--
-- `content_text` is the phase-2 seam: extracted text the AI reads
-- to actually help with the work. Left null by the index sync; a
-- later extension change fills it without needing another migration.
--
-- Idempotent. Run in: Supabase Dashboard -> SQL Editor -> Run.
-- Creates the table in BOTH `public` and `neuroagi` so it matches
-- whichever schema the extension's SB_PROFILE currently targets.
--
-- IMPORTANT: the live schemas DISAGREE on id types — public.courses.id
-- is bigint while neuroagi.courses.id is uuid. So we DETECT each
-- schema's actual users/courses/assignments id type and build the
-- foreign keys to match, instead of hardcoding a type.
-- ============================================================

do $$
declare
  s            text;
  user_id_type text;
  crs_id_type  text;
  asg_id_type  text;
begin
  foreach s in array array['public', 'neuroagi']
  loop
    -- Skip neuroagi if that schema was never created on this project.
    if s = 'neuroagi' and not exists (select 1 from information_schema.schemata where schema_name = 'neuroagi') then
      continue;
    end if;

    -- Read the real id types from the parent tables in THIS schema.
    select data_type into user_id_type from information_schema.columns
      where table_schema = s and table_name = 'users'       and column_name = 'id';
    select data_type into crs_id_type  from information_schema.columns
      where table_schema = s and table_name = 'courses'     and column_name = 'id';
    select data_type into asg_id_type  from information_schema.columns
      where table_schema = s and table_name = 'assignments' and column_name = 'id';

    -- Sensible fallbacks if a parent table is missing (FK just won't bind).
    user_id_type := coalesce(user_id_type, 'text');
    crs_id_type  := coalesce(crs_id_type,  'uuid');
    asg_id_type  := coalesce(asg_id_type,  'uuid');

    execute format($f$
      create table if not exists %1$I.files (
        id            uuid primary key default gen_random_uuid(),
        user_id       %2$s references %1$I.users(id) on delete cascade,
        course_id     %3$s references %1$I.courses(id) on delete cascade,
        assignment_id %4$s references %1$I.assignments(id) on delete set null,
        lms_file_id   text,          -- stable id from the LMS (dedupe key)
        name          text,          -- e.g. "inverting-matrices.pdf"
        file_type     text,          -- "pdf" | "docx" | "link" | ...
        size_bytes    bigint,
        source_url    text,          -- session-gated LMS download url
        folder        text,          -- LMS folder / content-module path
        status        text,          -- "submitted" | "course_material" | "feedback"
        content_text  text,          -- PHASE 2: extracted text for the AI (null until then)
        source        text default 'extension',
        updated_at    timestamptz default now(),
        unique(user_id, lms_file_id)
      );
    $f$, s, user_id_type, crs_id_type, asg_id_type);

    -- Open RLS to match every other table in this app (UUID identity, auth.uid() is null).
    execute format('alter table %I.files enable row level security;', s);
    execute format('drop policy if exists "open_all" on %I.files;', s);
    execute format('create policy "open_all" on %I.files for all using (true) with check (true);', s);

    -- Query helpers: files-by-course and files-by-assignment are the AI's hot paths.
    execute format('create index if not exists files_user_course_idx on %I.files (user_id, course_id);', s);
    execute format('create index if not exists files_assignment_idx on %I.files (assignment_id);', s);
  end loop;
end $$;

-- New-schema grants (public inherits these automatically; neuroagi needs them explicit).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'neuroagi') then
    grant all on neuroagi.files to anon, authenticated, service_role;
  end if;
end $$;
