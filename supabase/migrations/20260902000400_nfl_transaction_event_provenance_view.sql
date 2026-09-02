-- PostgreSQL expands SELECT * when a view is created. Recreate the current
-- event view after adding raw/normalization columns so evidence drilldowns can
-- expose the governed raw-to-normalized boundary.
create or replace view nfl_current_transaction_events as
select
  e.snapshot_id,
  e.event_id,
  e.event_year,
  e.event_date,
  e.date_precision,
  e.transaction_type,
  e.player_id,
  e.player_name,
  e.position_group,
  e.from_team_id,
  e.to_team_id,
  e.contract_value_dollars,
  e.contract_apy_dollars,
  e.guaranteed_dollars,
  e.league_cap_dollars,
  e.compensation_pick_rounds,
  e.compensation_includes_player,
  e.trade_player_asset_count,
  e.compensation_band,
  e.compensation_summary,
  e.identity_confidence,
  e.source_ref_ids,
  e.raw_position,
  e.normalization_basis,
  e.raw_source_record
from nfl_transaction_events e
join nfl_current_transaction_dataset_snapshot s using (snapshot_id);
