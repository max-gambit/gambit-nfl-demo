-- Keep raw-to-normalized boundaries on every governed event row so evidence
-- drilldowns do not need to infer them from a side table.
alter table nfl_transaction_events add column if not exists raw_position text;
alter table nfl_transaction_events add column if not exists normalization_basis text;
alter table nfl_transaction_events add column if not exists raw_source_record jsonb;
