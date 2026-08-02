-- Brain graph layer — a property graph in Postgres that sits ON TOP of the RAG /
-- vector layer (supabase-rag-migration.sql). No Neo4j: a typed node+edge model in
-- Postgres covers the User→Course→Topic→Weakness→Interest graph, stays in one DB,
-- and is trivially "delete-brain"-able (everything is user_id-scoped + cascades).
--
-- The "hybrid" linkage the blueprint calls for — "vectors linked to nodes in the
-- graph" — is realized two ways:
--   1. brain_nodes carry an OPTIONAL embedding (same 1536-d space as rag_chunks),
--      so the graph itself is semantically searchable (Mem0-style recall).
--   2. brain_node_sources bridges a node → the rag_sections that evidence it, so a
--      retrieved fact can cite the exact document section/page it came from.
--
-- Prereq: run supabase-rag-migration.sql first (this references rag_sections).

create extension if not exists vector;

-- ── nodes (entities) ─────────────────────────────────────────
-- type conventions (extend freely): user | course | assignment | topic | concept |
-- skill | weakness | interest | goal | experience | resource | person
create table if not exists public.brain_nodes (
  id           uuid primary key default gen_random_uuid(),
  user_id      text references public.users(id) on delete cascade,
  type         text not null,
  label        text,                         -- human-readable name ("Applied Calculus", "Startups")
  props        jsonb default '{}'::jsonb,    -- arbitrary structured properties
  -- Optional mirror of a canonical row elsewhere (so the graph can point at real
  -- courses/assignments without duplicating their data): e.g. ('courses', <uuid>).
  ref_table    text,
  ref_id       text,
  -- Optional semantic vector (same model as rag_chunks: text-embedding-3-small) so
  -- nodes can be retrieved by meaning, not just by edge traversal.
  embedding    vector(1536),
  confidence   real default 1.0,             -- how sure we are this node is real/relevant
  salience     real default 0.0,             -- importance/recency weight for ranking
  created_at   timestamptz default now(),
  last_seen_at timestamptz default now()
);

-- One topic/skill/etc. per user (dedupe on re-observation → upsert + reinforce).
create unique index if not exists brain_nodes_user_type_label_uniq
  on public.brain_nodes (user_id, type, lower(label)) where label is not null;
create index if not exists brain_nodes_user_type_idx on public.brain_nodes (user_id, type);
create index if not exists brain_nodes_ref_idx       on public.brain_nodes (ref_table, ref_id);
create index if not exists brain_nodes_embedding_idx on public.brain_nodes using hnsw (embedding vector_cosine_ops);

-- ── edges (relationships) ────────────────────────────────────
-- Directed + typed + weighted + temporal. type conventions (extend freely):
-- enrolled_in | studies | struggles_with | strong_in | interested_in |
-- prerequisite_of | covers | mentions | related_to | influenced_by
create table if not exists public.brain_edges (
  id          uuid primary key default gen_random_uuid(),
  user_id     text references public.users(id) on delete cascade,
  src_id      uuid references public.brain_nodes(id) on delete cascade,
  dst_id      uuid references public.brain_nodes(id) on delete cascade,
  type        text not null,
  weight      real  default 1.0,             -- strength of the relationship
  confidence  real  default 1.0,
  props       jsonb default '{}'::jsonb,
  observed_at timestamptz default now(),     -- temporal: when this relation was last seen
  created_at  timestamptz default now()
);

create unique index if not exists brain_edges_uniq on public.brain_edges (user_id, src_id, dst_id, type);
create index if not exists brain_edges_src_idx on public.brain_edges (src_id, type);
create index if not exists brain_edges_dst_idx on public.brain_edges (dst_id, type);

-- ── bridge: graph node ↔ RAG source material ─────────────────
-- "This topic node is evidenced by these document sections (with page numbers)."
-- Lets a graph-derived answer cite the exact source it came from.
create table if not exists public.brain_node_sources (
  node_id    uuid references public.brain_nodes(id)   on delete cascade,
  section_id uuid references public.rag_sections(id)  on delete cascade,
  relation   text default 'evidence',       -- evidence | defined_in | example_of
  weight     real default 1.0,
  created_at timestamptz default now(),
  primary key (node_id, section_id)
);
create index if not exists brain_node_sources_section_idx on public.brain_node_sources (section_id);

-- Consistent with the rest of the app: anon client + service-key server, no Supabase
-- Auth on these tables → RLS off. All access is via the service key in api/.
alter table public.brain_nodes        disable row level security;
alter table public.brain_edges        disable row level security;
alter table public.brain_node_sources disable row level security;

-- ── helper: ego-graph traversal (relational side of "hybrid") ────────────────
-- Undirected neighbourhood of a node up to p_max_depth hops, cycle-safe.
create or replace function public.brain_neighbors(
  p_node_id   uuid,
  p_max_depth int  default 2,
  p_user_id   text default null
)
returns table (node_id uuid, depth int, via_edge text)
language sql stable
as $$
  with recursive walk as (
    select p_node_id as node_id, 0 as depth, null::text as via_edge, array[p_node_id] as path
    union all
    select nb.node_id, w.depth + 1, e.type, w.path || nb.node_id
    from walk w
    join public.brain_edges e
      on (e.src_id = w.node_id or e.dst_id = w.node_id)
    cross join lateral (
      select case when e.src_id = w.node_id then e.dst_id else e.src_id end as node_id
    ) nb
    where w.depth < p_max_depth
      and not nb.node_id = any(w.path)               -- prevent cycles
      and (p_user_id is null or e.user_id = p_user_id)
  )
  select node_id, min(depth) as depth, (array_agg(via_edge))[1] as via_edge
  from walk
  where node_id <> p_node_id
  group by node_id;
$$;

-- ── helper: semantic search over graph memory (vector side of "hybrid") ───────
-- Mem0-style "reflect/recall": retrieve the nodes most related in MEANING to a
-- query, optionally filtered to certain node types.
create or replace function public.brain_search_nodes(
  p_user_id         text,
  p_query_embedding vector(1536),
  p_types           text[] default null,
  p_match_count     int    default 10
)
returns table (node_id uuid, type text, label text, props jsonb, score double precision)
language sql stable
as $$
  select id, type, label, props, 1 - (embedding <=> p_query_embedding) as score
  from public.brain_nodes
  where user_id = p_user_id
    and embedding is not null
    and (p_types is null or type = any(p_types))
  order by embedding <=> p_query_embedding
  limit p_match_count;
$$;
