alter table if exists brief_options
  add column if not exists details jsonb;
