alter table if exists briefs
  add column if not exists progress jsonb;
