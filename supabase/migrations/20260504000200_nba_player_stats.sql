-- NBA player advanced stats seed tables.
-- Stats are snapshot-based and can include season participants who are no
-- longer on the latest official roster snapshot.

create table if not exists nba_player_stat_snapshots (
  id                     uuid primary key default gen_random_uuid(),
  season                 text not null,
  season_type            text not null,
  as_of_date             date not null,
  source_name            text not null,
  source_url             text not null,
  retrieved_at           timestamptz not null,
  team_count             int not null,
  row_count              int not null,
  matched_player_count   int not null,
  unmatched_player_count int not null,
  notes                  jsonb not null default '[]'::jsonb,
  glossary               jsonb not null default '{}'::jsonb,
  source_meta            jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  unique (season, season_type, as_of_date, source_name)
);

create table if not exists nba_player_stat_rows (
  snapshot_id                uuid not null references nba_player_stat_snapshots(id) on delete cascade,
  team_id                    text not null references nba_teams(team_id) on delete restrict,
  nba_player_id              bigint references nba_players(nba_player_id) on delete set null,
  player_name                text not null,
  player_name_normalized     text not null,
  source_order               int not null,
  position                   text,
  age                        int,
  games_played               int not null,
  minutes                    int not null,
  points_per_game            numeric not null,
  rebounds_per_game          numeric not null,
  assists_per_game           numeric not null,
  true_shooting_pct          numeric not null,
  effective_fg_pct           numeric not null,
  usage_pct                  numeric not null,
  three_point_attempt_rate   numeric not null,
  free_throw_rate            numeric not null,
  offensive_rebound_pct      numeric not null,
  defensive_rebound_pct      numeric not null,
  rebound_pct                numeric not null,
  assist_pct                 numeric not null,
  turnover_pct               numeric not null,
  offensive_rating           numeric not null,
  defensive_rating           numeric not null,
  net_rating                 numeric not null,
  player_impact_estimate     numeric not null,
  defensive_win_shares       numeric not null,
  match_status               text not null check (match_status in ('roster-matched', 'stats-only')),
  source_row                 jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  primary key (snapshot_id, team_id, player_name_normalized)
);

create index if not exists idx_nba_player_stat_snapshots_latest
  on nba_player_stat_snapshots(as_of_date desc, retrieved_at desc);

create index if not exists idx_nba_player_stat_rows_team
  on nba_player_stat_rows(snapshot_id, team_id, source_order);

create index if not exists idx_nba_player_stat_rows_player
  on nba_player_stat_rows(nba_player_id);

create or replace view nba_current_player_stats as
with latest_snapshot as (
  select *
  from nba_player_stat_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select
  s.id as snapshot_id,
  s.season,
  s.season_type,
  s.as_of_date,
  s.source_name,
  s.source_url,
  s.retrieved_at,
  s.team_count as snapshot_team_count,
  s.row_count as snapshot_row_count,
  s.matched_player_count as snapshot_matched_player_count,
  s.unmatched_player_count as snapshot_unmatched_player_count,
  s.notes as snapshot_notes,
  s.glossary as snapshot_glossary,
  s.source_meta as snapshot_source_meta,
  r.team_id,
  t.nba_team_id,
  t.abbreviation,
  t.city,
  t.name,
  t.full_name,
  t.conference,
  t.division,
  r.nba_player_id,
  r.player_name,
  r.player_name_normalized,
  r.source_order,
  r.position,
  r.age,
  r.games_played,
  r.minutes,
  r.points_per_game,
  r.rebounds_per_game,
  r.assists_per_game,
  r.true_shooting_pct,
  r.effective_fg_pct,
  r.usage_pct,
  r.three_point_attempt_rate,
  r.free_throw_rate,
  r.offensive_rebound_pct,
  r.defensive_rebound_pct,
  r.rebound_pct,
  r.assist_pct,
  r.turnover_pct,
  r.offensive_rating,
  r.defensive_rating,
  r.net_rating,
  r.player_impact_estimate,
  r.defensive_win_shares,
  r.match_status,
  r.source_row,
  r.created_at
from latest_snapshot s
join nba_player_stat_rows r on r.snapshot_id = s.id
join nba_teams t on t.team_id = r.team_id;
