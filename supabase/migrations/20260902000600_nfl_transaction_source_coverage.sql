-- Structured per-source provenance for audit-ready snapshot cards.

alter table nfl_transaction_source_manifests
  add column if not exists row_count bigint,
  add column if not exists coverage_start_date date,
  add column if not exists coverage_end_date date;

alter table nfl_transaction_source_manifests
  drop constraint if exists nfl_transaction_source_manifests_row_count_check;

alter table nfl_transaction_source_manifests
  add constraint nfl_transaction_source_manifests_row_count_check
  check (row_count is null or row_count >= 0);
