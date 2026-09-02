-- Isolate the Giants public demo from legacy tenants and user-authored work.
-- Existing rows are intentionally preserved and classified as legacy.

alter table sessions
  add column if not exists workspace_key text not null default 'legacy';
alter table sessions
  add column if not exists seed_key text;

alter table projects
  add column if not exists workspace_key text not null default 'legacy';
alter table projects
  add column if not exists seed_key text;

update sessions set workspace_key = 'legacy' where workspace_key is null or workspace_key = '';
update projects set workspace_key = 'legacy' where workspace_key is null or workspace_key = '';

alter table sessions drop constraint if exists sessions_workspace_key_check;
alter table sessions add constraint sessions_workspace_key_check
  check (workspace_key in ('legacy', 'nyg-demo'));

alter table projects drop constraint if exists projects_workspace_key_check;
alter table projects add constraint projects_workspace_key_check
  check (workspace_key in ('legacy', 'nyg-demo'));

create unique index if not exists idx_sessions_workspace_seed_owned
  on sessions(workspace_key, seed_key)
  where seed_key is not null;

create unique index if not exists idx_projects_workspace_seed_owned
  on projects(workspace_key, seed_key)
  where seed_key is not null;

create index if not exists idx_sessions_workspace_active
  on sessions(workspace_key, updated_at desc)
  where archived_at is null;

create index if not exists idx_projects_workspace_active
  on projects(workspace_key, updated_at desc)
  where archived_at is null;

notify pgrst, 'reload schema';
