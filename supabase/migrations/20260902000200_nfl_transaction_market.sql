-- Governed historical NFL transaction-market snapshots.
-- Snapshots are content-addressed and append-only. Current views select the
-- most recently retrieved reviewed snapshot without mutating older captures.

create table if not exists nfl_transaction_dataset_snapshots (
  snapshot_id text primary key,
  schema_version text not null,
  transformation_version text not null,
  generated_at timestamptz not null,
  retrieved_at timestamptz not null,
  as_of_date date not null,
  snapshot_checksum_sha256 text not null check (snapshot_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  snapshot_file text not null,
  coverage jsonb not null,
  licensing_boundary text not null,
  created_at timestamptz not null default now()
);

create table if not exists nfl_transaction_source_manifests (
  snapshot_id text not null references nfl_transaction_dataset_snapshots(snapshot_id) on delete restrict,
  source_ref_id text not null,
  source_name text not null,
  source_url text not null,
  upstream_attribution text not null,
  retrieved_at timestamptz not null,
  as_of_date date not null,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  coverage_note text not null,
  primary key (snapshot_id, source_ref_id)
);

create table if not exists nfl_transaction_events (
  snapshot_id text not null references nfl_transaction_dataset_snapshots(snapshot_id) on delete restrict,
  event_id text not null,
  event_year int not null check (event_year between 1900 and 2100),
  event_date date,
  date_precision text not null check (date_precision in ('day', 'year')),
  transaction_type text not null check (transaction_type in ('trade', 'free_agent_signing', 're_signing', 'extension', 'tag', 'waiver_claim', 'release', 'other')),
  player_id text,
  player_name text not null,
  position_group text check (position_group in ('QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST')),
  from_team_id text,
  to_team_id text,
  contract_value_dollars bigint,
  contract_apy_dollars bigint,
  guaranteed_dollars bigint,
  league_cap_dollars bigint,
  compensation_pick_rounds int[],
  compensation_includes_player boolean,
  trade_player_asset_count int,
  compensation_band text check (compensation_band in ('round_1', 'rounds_2_3', 'rounds_4_7', 'player_only', 'unknown')),
  compensation_summary text,
  identity_confidence text not null check (identity_confidence in ('matched', 'directional', 'unmatched')),
  source_ref_ids text[] not null,
  primary key (snapshot_id, event_id)
);

create index if not exists idx_nfl_transaction_events_query
  on nfl_transaction_events(snapshot_id, event_year, position_group, transaction_type);
create index if not exists idx_nfl_transaction_events_team
  on nfl_transaction_events(snapshot_id, from_team_id, to_team_id);

create table if not exists nfl_trade_assets (
  snapshot_id text not null references nfl_transaction_dataset_snapshots(snapshot_id) on delete restrict,
  asset_id text not null,
  trade_id text not null,
  event_year int not null,
  trade_date date not null,
  gave_team_id text not null,
  received_team_id text not null,
  asset_type text not null check (asset_type in ('player', 'draft_pick')),
  pfr_id text,
  pfr_name text,
  pick_season int,
  pick_round int,
  pick_number int,
  conditional boolean,
  raw_source_record jsonb not null,
  source_ref_id text not null,
  primary key (snapshot_id, asset_id)
);

create table if not exists nfl_contract_terms (
  snapshot_id text not null references nfl_transaction_dataset_snapshots(snapshot_id) on delete restrict,
  event_id text not null,
  player_id text not null,
  player_name text not null,
  team_id text,
  raw_team text not null,
  raw_position text not null,
  normalized_position_group text check (normalized_position_group in ('QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST')),
  raw_contract_type text not null,
  raw_status text,
  transaction_type text not null,
  year_signed int not null,
  years int not null,
  value_dollars bigint not null,
  apy_dollars bigint not null,
  guaranteed_dollars bigint not null,
  apy_cap_basis_points int not null,
  source_url text,
  normalization_basis text not null,
  raw_source_record jsonb not null,
  primary key (snapshot_id, event_id)
);

create table if not exists nfl_player_external_id_matches (
  snapshot_id text not null references nfl_transaction_dataset_snapshots(snapshot_id) on delete restrict,
  event_id text not null,
  player_id text,
  player_name text not null,
  pfr_id text,
  gsis_id text,
  otc_id text,
  raw_position text,
  normalized_position_group text check (normalized_position_group in ('QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST')),
  match_confidence text not null check (match_confidence in ('matched', 'directional', 'unmatched')),
  normalization_basis text not null,
  primary key (snapshot_id, event_id)
);

create table if not exists nfl_position_year_populations (
  snapshot_id text not null references nfl_transaction_dataset_snapshots(snapshot_id) on delete restrict,
  year int not null,
  team_id text not null default '__LEAGUE__',
  position_group text not null check (position_group in ('QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'IDL', 'LB', 'CB', 'S', 'ST')),
  roster_player_seasons int not null check (roster_player_seasons >= 0),
  source_ref_ids text[] not null,
  primary key (snapshot_id, year, team_id, position_group)
);

create table if not exists nfl_transaction_league_caps (
  snapshot_id text not null references nfl_transaction_dataset_snapshots(snapshot_id) on delete restrict,
  year int not null,
  league_cap_dollars bigint not null,
  source_ref_ids text[] not null,
  primary key (snapshot_id, year)
);

create or replace view nfl_current_transaction_dataset_snapshot as
select * from nfl_transaction_dataset_snapshots
order by retrieved_at desc, snapshot_id desc
limit 1;

create or replace view nfl_current_transaction_events as
select e.* from nfl_transaction_events e
join nfl_current_transaction_dataset_snapshot s using (snapshot_id);

create or replace view nfl_current_transaction_source_manifests as
select m.* from nfl_transaction_source_manifests m
join nfl_current_transaction_dataset_snapshot s using (snapshot_id);

create or replace view nfl_current_position_year_populations as
select p.* from nfl_position_year_populations p
join nfl_current_transaction_dataset_snapshot s using (snapshot_id);

create or replace view nfl_current_transaction_league_caps as
select c.* from nfl_transaction_league_caps c
join nfl_current_transaction_dataset_snapshot s using (snapshot_id);

-- The API role may read governed snapshots. Only the local service-role seed
-- path writes them; no update/delete policy is exposed.
alter table nfl_transaction_dataset_snapshots enable row level security;
alter table nfl_transaction_source_manifests enable row level security;
alter table nfl_transaction_events enable row level security;
alter table nfl_trade_assets enable row level security;
alter table nfl_contract_terms enable row level security;
alter table nfl_player_external_id_matches enable row level security;
alter table nfl_position_year_populations enable row level security;
alter table nfl_transaction_league_caps enable row level security;

create policy "Authenticated read transaction snapshots" on nfl_transaction_dataset_snapshots for select to authenticated using (true);
create policy "Authenticated read transaction sources" on nfl_transaction_source_manifests for select to authenticated using (true);
create policy "Authenticated read transaction events" on nfl_transaction_events for select to authenticated using (true);
create policy "Authenticated read trade assets" on nfl_trade_assets for select to authenticated using (true);
create policy "Authenticated read contract terms" on nfl_contract_terms for select to authenticated using (true);
create policy "Authenticated read player matches" on nfl_player_external_id_matches for select to authenticated using (true);
create policy "Authenticated read position populations" on nfl_position_year_populations for select to authenticated using (true);
create policy "Authenticated read transaction caps" on nfl_transaction_league_caps for select to authenticated using (true);
