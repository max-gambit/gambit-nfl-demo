-- Keep hosted current-view reads fast after Player Quality Metrics v2.
-- The app projects runtime scorecard fields and skips the large raw source_data JSON.

create index if not exists idx_nfl_player_metric_rows_snapshot_team_player_name
  on public.nfl_player_metric_rows(snapshot_id, team_id, player_name);

create index if not exists idx_nfl_player_metric_rows_snapshot_team_position
  on public.nfl_player_metric_rows(snapshot_id, team_id, position);
