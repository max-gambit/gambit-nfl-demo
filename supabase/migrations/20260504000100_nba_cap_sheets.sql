-- NBA cap sheet database seed tables.
-- Cap sheets are snapshot-based. The checked-in seed is a reviewed artifact;
-- gated refresh tooling may create later snapshots when explicitly enabled.

create table if not exists nba_cap_sheet_snapshots (
  id           uuid primary key default gen_random_uuid(),
  season       text not null,
  as_of_date   date not null,
  source_name  text not null,
  source_url   text not null,
  retrieved_at timestamptz not null,
  team_count   int not null,
  notes        text,
  source_meta  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (season, as_of_date, source_name)
);

create table if not exists nba_cap_sheets (
  snapshot_id           uuid not null references nba_cap_sheet_snapshots(id) on delete cascade,
  team_id               text not null references nba_teams(team_id) on delete restrict,
  official_roster_count int not null,
  cap_status            text not null,
  tax_status            text not null,
  apron_status          text not null,
  payroll_amount        bigint,
  source_status         text not null check (source_status in ('captured', 'source-needed', 'not-available')),
  missing_sections      text[] not null default array[]::text[],
  source_refs           jsonb not null default '[]'::jsonb,
  source_meta           jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  primary key (snapshot_id, team_id)
);

create table if not exists nba_cap_sheet_metrics (
  snapshot_id   uuid not null references nba_cap_sheet_snapshots(id) on delete cascade,
  team_id       text not null references nba_teams(team_id) on delete restrict,
  metric_key    text not null,
  label         text not null,
  value         text not null,
  amount        bigint,
  source_status text not null check (source_status in ('captured', 'source-needed', 'not-available', 'not-applicable')),
  source_url    text,
  note          text,
  sort_order    int not null,
  primary key (snapshot_id, team_id, metric_key)
);

create table if not exists nba_cap_sheet_player_rows (
  id             text primary key,
  snapshot_id    uuid not null references nba_cap_sheet_snapshots(id) on delete cascade,
  team_id        text not null references nba_teams(team_id) on delete restrict,
  nba_player_id  bigint references nba_players(nba_player_id) on delete set null,
  player_name    text not null,
  source_order   int not null,
  position       text,
  age            int,
  dob            text,
  yos            text,
  roster_status  text,
  fa_status      text,
  fa_year        text,
  bird_rights    text,
  restrictions   text[] not null default array[]::text[],
  how_acquired   text,
  agent          text,
  total_amount   bigint,
  source_status  text not null check (source_status in ('captured', 'source-needed', 'not-available')),
  source_url     text,
  source_data    jsonb not null default '{}'::jsonb,
  unique (snapshot_id, team_id, source_order)
);

create table if not exists nba_cap_sheet_salary_cells (
  player_row_id text not null references nba_cap_sheet_player_rows(id) on delete cascade,
  snapshot_id   uuid not null references nba_cap_sheet_snapshots(id) on delete cascade,
  team_id       text not null references nba_teams(team_id) on delete restrict,
  season        text not null,
  amount        bigint,
  label         text,
  option_type   text,
  is_guaranteed boolean,
  source_status text not null check (source_status in ('captured', 'source-needed', 'not-available', 'not-applicable')),
  source_url    text,
  source_data   jsonb not null default '{}'::jsonb,
  primary key (player_row_id, season)
);

create table if not exists nba_cap_sheet_sections (
  snapshot_id   uuid not null references nba_cap_sheet_snapshots(id) on delete cascade,
  team_id       text not null references nba_teams(team_id) on delete restrict,
  section_key   text not null,
  title         text not null,
  source_status text not null check (source_status in ('captured', 'source-needed', 'not-available', 'not-applicable')),
  source_url    text,
  notes         jsonb not null default '[]'::jsonb,
  rows          jsonb not null default '[]'::jsonb,
  sort_order    int not null,
  primary key (snapshot_id, team_id, section_key)
);

create index if not exists idx_nba_cap_sheet_snapshots_latest
  on nba_cap_sheet_snapshots(as_of_date desc, retrieved_at desc);

create index if not exists idx_nba_cap_sheets_team
  on nba_cap_sheets(team_id, snapshot_id);

create index if not exists idx_nba_cap_sheet_player_rows_team
  on nba_cap_sheet_player_rows(snapshot_id, team_id, source_order);

create index if not exists idx_nba_cap_sheet_salary_cells_team
  on nba_cap_sheet_salary_cells(snapshot_id, team_id, season);

create or replace view nba_current_cap_sheets as
with latest_snapshot as (
  select *
  from nba_cap_sheet_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select
  s.id as snapshot_id,
  s.season,
  s.as_of_date,
  s.source_name,
  s.source_url,
  s.retrieved_at,
  s.team_count as snapshot_team_count,
  s.notes as snapshot_notes,
  s.source_meta as snapshot_source_meta,
  cs.team_id,
  t.nba_team_id,
  t.abbreviation,
  t.city,
  t.name,
  t.full_name,
  t.conference,
  t.division,
  cs.official_roster_count,
  cs.cap_status,
  cs.tax_status,
  cs.apron_status,
  cs.payroll_amount,
  cs.source_status,
  cs.missing_sections,
  cs.source_refs,
  cs.source_meta,
  cs.created_at
from latest_snapshot s
join nba_cap_sheets cs on cs.snapshot_id = s.id
join nba_teams t on t.team_id = cs.team_id;

create or replace view nba_current_cap_sheet_metrics as
with latest_snapshot as (
  select id
  from nba_cap_sheet_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select m.*
from nba_cap_sheet_metrics m
join latest_snapshot s on s.id = m.snapshot_id;

create or replace view nba_current_cap_sheet_player_rows as
with latest_snapshot as (
  select id
  from nba_cap_sheet_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select p.*
from nba_cap_sheet_player_rows p
join latest_snapshot s on s.id = p.snapshot_id;

create or replace view nba_current_cap_sheet_salary_cells as
with latest_snapshot as (
  select id
  from nba_cap_sheet_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select c.*
from nba_cap_sheet_salary_cells c
join latest_snapshot s on s.id = c.snapshot_id;

create or replace view nba_current_cap_sheet_sections as
with latest_snapshot as (
  select id
  from nba_cap_sheet_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select sct.*
from nba_cap_sheet_sections sct
join latest_snapshot s on s.id = sct.snapshot_id;
