alter table nfl_cap_sheets
  add column if not exists current_cap_space_2026 bigint,
  add column if not exists effective_cap_space_2026 bigint,
  add column if not exists league_cap_2026 bigint,
  add column if not exists applied_team_cap_2026 bigint,
  add column if not exists carryover_2026 bigint,
  add column if not exists adjustments_2026 bigint,
  add column if not exists top_51_cap_spending_2026 bigint,
  add column if not exists dead_money_2026 bigint,
  add column if not exists cap_accounting_basis text,
  add column if not exists cap_summary_as_of_date date,
  add column if not exists cap_summary_source_urls jsonb not null default '[]'::jsonb;

-- The checked-in public snapshot is part of this migration so a normal
-- migration-only checkout never needs to infer cap room from player charges.
with latest_snapshot as (
  select id
  from nfl_cap_sheet_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
update nfl_cap_sheets cs
set
  current_cap_space_2026 = 10392701,
  effective_cap_space_2026 = 10392701,
  league_cap_2026 = 301200000,
  applied_team_cap_2026 = 300195334,
  carryover_2026 = null,
  adjustments_2026 = null,
  top_51_cap_spending_2026 = 261190088,
  dead_money_2026 = 28612545,
  cap_accounting_basis = 'Top 51 offseason accounting',
  cap_summary_as_of_date = '2026-09-03'::date,
  cap_summary_source_urls = '["https://overthecap.com/salary-cap-space","https://overthecap.com/calculator/new-york-giants","https://operations.nfl.com/calendar-events/nfl-free-agency/nfl-salary-cap"]'::jsonb,
  source_meta = coalesce(cs.source_meta, '{}'::jsonb) || jsonb_build_object(
    'team_cap_summary',
    jsonb_build_object(
      'season', '2026',
      'accounting_note', 'Over The Cap calculates current room from the Top 51 active cap spending and dead-money totals shown in its 2026 table. Its current public pages do not separate carryover from other club adjustments.',
      'source_status', 'captured',
      'source_content_sha256', jsonb_build_object(
        'https://overthecap.com/salary-cap-space', 'sha256:2fde3005dde78f9a56f9388cb3f4de9f95c27973c5555cc2dcd0ddccca2721e7',
        'https://overthecap.com/salary-cap/new-york-giants', 'sha256:31f089ddcda779a0dc6f1876b9838dbf828de513e7fc3204829bf9d77db34d1f',
        'https://overthecap.com/calculator/new-york-giants', 'sha256:e60f1ae1fbfb994f4680809c3ea2264aca23a315763abbf60b7097080e2e4ec9'
      )
    )
  )
from latest_snapshot
where cs.snapshot_id = latest_snapshot.id
  and cs.team_id = 'NYG';

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
  cs.created_at,
  cs.current_cap_space_2026,
  cs.effective_cap_space_2026,
  cs.league_cap_2026,
  cs.applied_team_cap_2026,
  cs.carryover_2026,
  cs.adjustments_2026,
  cs.top_51_cap_spending_2026,
  cs.dead_money_2026,
  cs.cap_accounting_basis,
  cs.cap_summary_as_of_date,
  cs.cap_summary_source_urls
from latest_snapshot s
join nfl_cap_sheets cs on cs.snapshot_id = s.id
join nfl_teams t on t.team_id = cs.team_id;
