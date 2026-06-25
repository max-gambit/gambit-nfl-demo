-- Gambit UI Remix — Supabase / Postgres schema.
-- Apply this in the Supabase SQL editor (one-shot) before running `npm run seed`.

-- Required extensions
create extension if not exists "pgcrypto";

-- ── sessions ────────────────────────────────────────────────────────────────
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  label       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

-- ── briefs ──────────────────────────────────────────────────────────────────
do $$ begin
  create type brief_status as enum ('generating', 'ready', 'partial', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists briefs (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  question    text not null,
  thesis      text,
  progress    jsonb,
  status      brief_status not null default 'generating',
  error       text,
  duration_ms int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_briefs_session
  on briefs(session_id, created_at desc);

-- ── chat turns ──────────────────────────────────────────────────────────────
do $$ begin
  create type turn_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

create table if not exists chat_turns (
  id          uuid primary key default gen_random_uuid(),
  brief_id    uuid not null references briefs(id) on delete cascade,
  role        turn_role not null,
  content     text not null,
  tool_calls  jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_turns_brief
  on chat_turns(brief_id, created_at);

-- ── brief sources ───────────────────────────────────────────────────────────
create table if not exists brief_sources (
  id          uuid primary key default gen_random_uuid(),
  brief_id    uuid not null references briefs(id) on delete cascade,
  ref_index   int not null,
  kind        text not null,
  source      text,
  title       text not null,
  data        jsonb,
  updated_at  text
);

create index if not exists idx_sources_brief
  on brief_sources(brief_id, ref_index);

-- ── brief options ───────────────────────────────────────────────────────────
create table if not exists brief_options (
  id              uuid primary key default gen_random_uuid(),
  brief_id        uuid not null references briefs(id) on delete cascade,
  ref_index       int not null,
  title           text not null,
  subtitle        text,
  type_kind       text,
  path_kind       text,
  net_cap_num     numeric,
  net_cap_label   text,
  epm             text,
  cba_section     text,
  timing          text,
  src_count       int default 0,
  likelihood_kind text,
  likelihood_pct  int,
  spark           int[]
);

create index if not exists idx_options_brief
  on brief_options(brief_id, ref_index);

-- ── agent runs ──────────────────────────────────────────────────────────────
do $$ begin
  create type agent_kind as enum ('deck', 'memo', 'research', 'comp_set', 'synthesize');
exception when duplicate_object then null; end $$;

do $$ begin
  create type agent_status as enum ('queued', 'running', 'needs_input', 'completed', 'failed');
exception when duplicate_object then null; end $$;

create table if not exists agent_runs (
  id            uuid primary key default gen_random_uuid(),
  brief_id      uuid references briefs(id) on delete set null,
  session_id    uuid references sessions(id) on delete set null,
  kind          agent_kind not null,
  status        agent_status not null default 'queued',
  progress      int not null default 0,
  title         text not null,
  sub           text,
  config        jsonb not null,
  result        jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  just_finished boolean not null default false
);

create index if not exists idx_agent_runs_brief
  on agent_runs(brief_id, created_at desc);

-- ── artifacts ───────────────────────────────────────────────────────────────
create table if not exists artifacts (
  id            uuid primary key default gen_random_uuid(),
  agent_run_id  uuid not null references agent_runs(id) on delete cascade,
  brief_id      uuid not null references briefs(id) on delete cascade,
  name          text not null,
  kind          text not null,
  storage_url   text,
  meta          jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_artifacts_brief
  on artifacts(brief_id, created_at desc);

-- ── bookmarks ───────────────────────────────────────────────────────────────
create table if not exists bookmarks (
  user_id     uuid,
  brief_id    uuid not null references briefs(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, brief_id)
);

-- ── monitors ────────────────────────────────────────────────────────────────
create table if not exists monitors (
  id           uuid primary key default gen_random_uuid(),
  brief_id     uuid references briefs(id) on delete cascade,
  kind         text not null,
  config       jsonb not null,
  paused       boolean not null default false,
  last_fired   timestamptz,
  next_fire_at timestamptz,
  alerts_count int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_monitors_next_fire
  on monitors(next_fire_at) where paused = false;

-- ── CBA reference corpus ────────────────────────────────────────────────────
create table if not exists cba_articles (
  id     text primary key,
  label  text not null,
  body   text not null
);

-- ── Realtime publication (so client can subscribe to agent_runs) ───────────
-- Note: Supabase enables `supabase_realtime` automatically; this is idempotent.
do $$ begin
  alter publication supabase_realtime add table agent_runs;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table artifacts;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table chat_turns;
exception when duplicate_object then null; when undefined_object then null; end $$;
