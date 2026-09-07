-- Publish a transaction snapshot only after every immutable child table has
-- been seeded and count-verified. Readers never observe a partially loaded
-- snapshot, and API pagination pins one published snapshot_id per request.

alter table nfl_transaction_dataset_snapshots
  add column if not exists published_at timestamptz;

update nfl_transaction_dataset_snapshots
set published_at = coalesce(published_at, created_at)
where published_at is null;

create or replace view nfl_current_transaction_dataset_snapshot as
select * from nfl_transaction_dataset_snapshots
where published_at is not null
order by published_at desc, retrieved_at desc, snapshot_id desc
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
