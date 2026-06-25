-- Project workflow boards seeded from generated briefs.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  title text not null,
  source_brief_id uuid references briefs(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_title_len check (char_length(title) between 1 and 120)
);

create index if not exists idx_projects_user_active_updated
  on projects(user_id, updated_at desc)
  where archived_at is null;

create index if not exists idx_projects_source_brief
  on projects(source_brief_id, created_at desc);

create table if not exists project_briefs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  brief_id uuid not null references briefs(id) on delete cascade,
  step text not null default 'research',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_briefs_step_check check (step in (
    'research',
    'validate',
    'feedback',
    'gm',
    'proposal'
  )),
  constraint project_briefs_unique_project_brief unique (project_id, brief_id)
);

create index if not exists idx_project_briefs_project_step_order
  on project_briefs(project_id, step, sort_order, created_at);

create index if not exists idx_project_briefs_brief
  on project_briefs(brief_id, created_at desc);

notify pgrst, 'reload schema';
