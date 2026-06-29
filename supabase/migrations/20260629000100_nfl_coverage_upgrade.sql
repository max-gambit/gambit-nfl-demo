-- NFL coverage upgrade drift repair.
-- Keeps hosted/current-view schemas aligned with Contract Ledger estimates and Player Metrics v1.

alter table if exists nfl_cap_sheet_player_rows
  drop constraint if exists nfl_cap_sheet_player_rows_source_status_check;

alter table if exists nfl_cap_sheet_player_rows
  add constraint nfl_cap_sheet_player_rows_source_status_check
  check (source_status in ('captured', 'estimated', 'source-needed', 'not-available'));

alter table if exists nfl_cap_sheet_salary_cells
  drop constraint if exists nfl_cap_sheet_salary_cells_source_status_check;

alter table if exists nfl_cap_sheet_salary_cells
  add constraint nfl_cap_sheet_salary_cells_source_status_check
  check (source_status in ('captured', 'estimated', 'source-needed', 'not-available', 'not-applicable'));

alter table if exists nfl_player_metric_rows
  add column if not exists offense_snaps_2025 int,
  add column if not exists defense_snaps_2025 int,
  add column if not exists special_teams_snaps_2025 int,
  add column if not exists snap_share_2025 numeric,
  add column if not exists starts_2025 int,
  add column if not exists passing_yards_2025 int,
  add column if not exists rushing_yards_2025 int,
  add column if not exists receiving_yards_2025 int,
  add column if not exists scrimmage_yards_2025 int,
  add column if not exists tackles_2025 numeric,
  add column if not exists sacks_2025 numeric,
  add column if not exists interceptions_2025 int,
  add column if not exists touchdowns_2025 int,
  add column if not exists metric_source_family text,
  add column if not exists metric_gap_reason text;

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
