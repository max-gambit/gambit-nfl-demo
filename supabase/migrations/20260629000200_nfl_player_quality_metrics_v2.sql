-- Player Quality Metrics v2.
-- Adds additive scorecard fields while preserving current-view shape for v1 clients.

alter table if exists nfl_player_metric_rows
  add column if not exists metric_coverage_level text,
  add column if not exists metric_confidence text,
  add column if not exists metric_families jsonb not null default '[]'::jsonb,
  add column if not exists position_metric_summary text,
  add column if not exists position_metrics jsonb not null default '{}'::jsonb,
  add column if not exists quality_flags jsonb not null default '[]'::jsonb;

alter table if exists nfl_player_metric_rows
  drop constraint if exists nfl_player_metric_rows_metric_coverage_level_check;

alter table if exists nfl_player_metric_rows
  add constraint nfl_player_metric_rows_metric_coverage_level_check
  check (metric_coverage_level is null or metric_coverage_level in ('strong', 'directional', 'gap'));

alter table if exists nfl_player_metric_rows
  drop constraint if exists nfl_player_metric_rows_metric_confidence_check;

alter table if exists nfl_player_metric_rows
  add constraint nfl_player_metric_rows_metric_confidence_check
  check (metric_confidence is null or metric_confidence in ('captured', 'derived', 'source-needed'));

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
  r.source_data,
  r.metric_coverage_level,
  r.metric_confidence,
  r.metric_families,
  r.position_metric_summary,
  r.position_metrics,
  r.quality_flags
from latest_snapshot s
join nfl_player_metric_rows r on r.snapshot_id = s.id
join nfl_teams t on t.team_id = r.team_id;
