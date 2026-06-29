-- NFL roster/cap database seed tables.
-- Snapshot rows are immutable reviewed captures; current views point at the
-- latest snapshot by as_of_date/retrieved_at.

create table if not exists nfl_teams (
  team_id      text primary key,
  abbreviation text not null unique,
  full_name    text not null,
  conference   text,
  division     text,
  source_url   text
);

create table if not exists nfl_players (
  player_id     text primary key,
  player_name   text not null,
  first_name    text,
  last_name     text,
  position      text,
  jersey_number text,
  height_inches int,
  weight_lbs    int,
  experience    text,
  college       text,
  source_url    text,
  source_row    jsonb not null default '{}'::jsonb
);

create table if not exists nfl_roster_snapshots (
  id           uuid primary key default gen_random_uuid(),
  season       text not null,
  as_of_date   date not null,
  source_name  text not null,
  source_url   text not null,
  retrieved_at timestamptz not null,
  team_count   int not null,
  player_count int not null,
  notes        text,
  source_meta  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (season, as_of_date, source_name)
);

create table if not exists nfl_roster_entries (
  snapshot_id     uuid not null references nfl_roster_snapshots(id) on delete cascade,
  team_id         text not null references nfl_teams(team_id) on delete restrict,
  player_id       text not null references nfl_players(player_id) on delete restrict,
  season          text not null,
  source_order    int not null,
  jersey_number   text,
  position        text,
  age             int,
  roster_status   text not null,
  contract_status text not null,
  height_inches   int,
  weight_lbs      int,
  experience      text,
  college         text,
  source_url      text,
  source_note     text not null,
  source_row      jsonb not null default '{}'::jsonb,
  primary key (snapshot_id, team_id, player_id)
);

create index if not exists idx_nfl_roster_entries_team
  on nfl_roster_entries(snapshot_id, team_id, source_order);

create index if not exists idx_nfl_roster_entries_player
  on nfl_roster_entries(player_id);

create index if not exists idx_nfl_roster_snapshots_latest
  on nfl_roster_snapshots(as_of_date desc, retrieved_at desc);

create or replace view nfl_current_roster_entries as
with latest_snapshot as (
  select *
  from nfl_roster_snapshots
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
  s.player_count as snapshot_player_count,
  s.notes as snapshot_notes,
  s.source_meta as snapshot_source_meta,
  e.team_id,
  t.abbreviation,
  t.full_name,
  t.conference,
  t.division,
  count(*) over (partition by e.snapshot_id, e.team_id)::int as official_roster_count,
  e.player_id,
  p.player_name,
  e.source_order,
  e.jersey_number,
  e.position,
  e.age,
  e.roster_status,
  e.contract_status,
  e.height_inches,
  e.weight_lbs,
  e.experience,
  e.college,
  p.source_url as player_source_url,
  e.source_url as entry_source_url,
  e.source_note,
  e.source_row
from latest_snapshot s
join nfl_roster_entries e on e.snapshot_id = s.id
join nfl_teams t on t.team_id = e.team_id
join nfl_players p on p.player_id = e.player_id;

create table if not exists nfl_cap_sheet_snapshots (
  id           uuid primary key default gen_random_uuid(),
  season       text not null,
  as_of_date   date not null,
  source_name  text not null,
  source_url   text not null,
  retrieved_at timestamptz not null,
  team_count   int not null,
  player_count int not null,
  notes        text,
  source_meta  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (season, as_of_date, source_name)
);

create table if not exists nfl_cap_sheets (
  snapshot_id                       uuid not null references nfl_cap_sheet_snapshots(id) on delete cascade,
  team_id                           text not null references nfl_teams(team_id) on delete restrict,
  official_roster_count             int not null,
  player_cap_row_count              int not null,
  source_needed_count               int not null,
  total_cap_number_2026             bigint,
  total_restructure_savings_2026    bigint,
  total_cut_savings_2026            bigint,
  source_status                     text not null check (source_status in ('captured', 'partial', 'source-needed')),
  source_refs                       jsonb not null default '[]'::jsonb,
  source_meta                       jsonb not null default '{}'::jsonb,
  created_at                        timestamptz not null default now(),
  primary key (snapshot_id, team_id)
);

create table if not exists nfl_cap_sheet_player_rows (
  id                                  text primary key,
  snapshot_id                         uuid not null references nfl_cap_sheet_snapshots(id) on delete cascade,
  team_id                             text not null references nfl_teams(team_id) on delete restrict,
  player_id                           text references nfl_players(player_id) on delete set null,
  player_name                         text not null,
  source_order                        int not null,
  position                            text,
  cap_number_2026                     bigint,
  cash_due_2026                       bigint,
  total_value_remaining               bigint,
  years_remaining                     int,
  contract_end_year                   int,
  contract_years_remaining            int,
  void_year_count                     int,
  void_years_source_status            text not null default 'not-available' check (void_years_source_status in ('captured', 'derived', 'source-needed', 'not-available')),
  guaranteed_remaining                bigint,
  dead_money_if_cut_2026              bigint,
  cut_savings_2026                    bigint,
  post_june_1_dead_money_2026         bigint,
  post_june_1_cut_savings_2026        bigint,
  trade_dead_money_2026               bigint,
  trade_savings_2026                  bigint,
  post_june_1_trade_dead_money_2026   bigint,
  post_june_1_trade_savings_2026      bigint,
  restructure_savings_estimate_2026   bigint,
  extension_savings_estimate_2026     bigint,
  contract_ledger_status              text not null default 'source-needed' check (contract_ledger_status in ('captured', 'source-needed')),
  contract_ledger_confidence          text not null default 'source-needed' check (contract_ledger_confidence in ('captured', 'derived', 'estimated', 'source-needed')),
  tag_eligible_2027                   boolean not null default false,
  contract_lever                      text not null,
  source_url                          text,
  source_status                       text not null check (source_status in ('captured', 'estimated', 'source-needed', 'not-available')),
  source_data                         jsonb not null default '{}'::jsonb,
  unique (snapshot_id, team_id, source_order)
);

create table if not exists nfl_cap_sheet_salary_cells (
  player_row_id text not null references nfl_cap_sheet_player_rows(id) on delete cascade,
  snapshot_id   uuid not null references nfl_cap_sheet_snapshots(id) on delete cascade,
  team_id       text not null references nfl_teams(team_id) on delete restrict,
  season        text not null,
  amount        bigint,
  label         text,
  option_type   text,
  is_guaranteed boolean,
  source_status text not null check (source_status in ('captured', 'estimated', 'source-needed', 'not-available', 'not-applicable')),
  source_url    text,
  source_data   jsonb not null default '{}'::jsonb,
  primary key (player_row_id, season)
);

create index if not exists idx_nfl_cap_sheet_snapshots_latest
  on nfl_cap_sheet_snapshots(as_of_date desc, retrieved_at desc);

create index if not exists idx_nfl_cap_sheets_team
  on nfl_cap_sheets(team_id, snapshot_id);

create index if not exists idx_nfl_cap_sheet_player_rows_team
  on nfl_cap_sheet_player_rows(snapshot_id, team_id, source_order);

create or replace view nfl_current_cap_sheets as
with latest_snapshot as (
  select *
  from nfl_cap_sheet_snapshots
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
  s.player_count as snapshot_player_count,
  s.notes as snapshot_notes,
  s.source_meta as snapshot_source_meta,
  cs.team_id,
  t.abbreviation,
  t.full_name,
  t.conference,
  t.division,
  cs.official_roster_count,
  cs.player_cap_row_count,
  cs.source_needed_count,
  cs.total_cap_number_2026,
  cs.total_restructure_savings_2026,
  cs.total_cut_savings_2026,
  cs.source_status,
  cs.source_refs,
  cs.source_meta,
  cs.created_at
from latest_snapshot s
join nfl_cap_sheets cs on cs.snapshot_id = s.id
join nfl_teams t on t.team_id = cs.team_id;

create or replace view nfl_current_cap_sheet_player_rows as
with latest_snapshot as (
  select *
  from nfl_cap_sheet_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select
  s.id as snapshot_id,
  s.season,
  s.as_of_date,
  s.source_name,
  s.source_url as snapshot_source_url,
  s.retrieved_at,
  s.team_count as snapshot_team_count,
  s.player_count as snapshot_player_count,
  s.notes as snapshot_notes,
  s.source_meta as snapshot_source_meta,
  p.team_id,
  t.abbreviation,
  t.full_name,
  t.conference,
  t.division,
  p.id,
  p.player_id,
  p.player_name,
  p.source_order,
  p.position,
  p.cap_number_2026,
  p.cash_due_2026,
  p.total_value_remaining,
  p.years_remaining,
  p.contract_end_year,
  p.contract_years_remaining,
  p.void_year_count,
  p.void_years_source_status,
  p.guaranteed_remaining,
  p.dead_money_if_cut_2026,
  p.cut_savings_2026,
  p.post_june_1_dead_money_2026,
  p.post_june_1_cut_savings_2026,
  p.trade_dead_money_2026,
  p.trade_savings_2026,
  p.post_june_1_trade_dead_money_2026,
  p.post_june_1_trade_savings_2026,
  p.restructure_savings_estimate_2026,
  p.extension_savings_estimate_2026,
  p.contract_ledger_status,
  p.contract_ledger_confidence,
  p.tag_eligible_2027,
  p.contract_lever,
  p.source_url,
  p.source_status,
  p.source_data
from latest_snapshot s
join nfl_cap_sheet_player_rows p on p.snapshot_id = s.id
join nfl_teams t on t.team_id = p.team_id;

create or replace view nfl_current_cap_sheet_salary_cells as
with latest_snapshot as (
  select id
  from nfl_cap_sheet_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select c.*
from nfl_cap_sheet_salary_cells c
join latest_snapshot s on s.id = c.snapshot_id;

create table if not exists nfl_player_metric_snapshots (
  id           uuid primary key default gen_random_uuid(),
  season       text not null,
  as_of_date   date not null,
  source_name  text not null,
  source_url   text not null,
  retrieved_at timestamptz not null,
  team_count   int not null,
  row_count    int not null,
  notes        text,
  source_meta  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (season, as_of_date, source_name)
);

create table if not exists nfl_player_metric_rows (
  snapshot_id       uuid not null references nfl_player_metric_snapshots(id) on delete cascade,
  team_id           text not null references nfl_teams(team_id) on delete restrict,
  player_id         text not null references nfl_players(player_id) on delete restrict,
  player_name       text not null,
  position          text,
  snaps_2025        int,
  offense_snaps_2025 int,
  defense_snaps_2025 int,
  special_teams_snaps_2025 int,
  snap_share_2025 numeric,
  games_2025        int,
  starts_2025       int,
  passing_yards_2025 int,
  rushing_yards_2025 int,
  receiving_yards_2025 int,
  scrimmage_yards_2025 int,
  tackles_2025      numeric,
  sacks_2025        numeric,
  interceptions_2025 int,
  touchdowns_2025   int,
  availability_risk text not null,
  role              text not null,
  value_tier        text not null,
  metric_note       text not null,
  metric_source_family text,
  metric_gap_reason text,
  source_url        text,
  source_status     text not null check (source_status in ('captured', 'roster-derived', 'source-needed')),
  source_data       jsonb not null default '{}'::jsonb,
  primary key (snapshot_id, team_id, player_id)
);

create index if not exists idx_nfl_player_metric_snapshots_latest
  on nfl_player_metric_snapshots(as_of_date desc, retrieved_at desc);

create or replace view nfl_current_player_metric_rows as
with latest_snapshot as (
  select *
  from nfl_player_metric_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select
  s.id as snapshot_id,
  s.season,
  s.as_of_date,
  s.source_name,
  s.source_url as snapshot_source_url,
  s.retrieved_at,
  s.team_count as snapshot_team_count,
  s.row_count as snapshot_row_count,
  s.notes as snapshot_notes,
  s.source_meta as snapshot_source_meta,
  r.team_id,
  t.abbreviation,
  t.full_name,
  t.conference,
  t.division,
  r.player_id,
  r.player_name,
  r.position,
  r.snaps_2025,
  r.offense_snaps_2025,
  r.defense_snaps_2025,
  r.special_teams_snaps_2025,
  r.snap_share_2025,
  r.games_2025,
  r.starts_2025,
  r.passing_yards_2025,
  r.rushing_yards_2025,
  r.receiving_yards_2025,
  r.scrimmage_yards_2025,
  r.tackles_2025,
  r.sacks_2025,
  r.interceptions_2025,
  r.touchdowns_2025,
  r.availability_risk,
  r.role,
  r.value_tier,
  r.metric_note,
  r.metric_source_family,
  r.metric_gap_reason,
  r.source_url,
  r.source_status,
  r.source_data
from latest_snapshot s
join nfl_player_metric_rows r on r.snapshot_id = s.id
join nfl_teams t on t.team_id = r.team_id;
