-- Projects V2: inbound trade scenario library.
-- Projects remain the container; structured scenarios become the primary work object.

alter table projects add column if not exists workflow_type text not null default 'inbound_trade';
alter table projects add column if not exists subject_team_id text not null default 'GSW';
alter table projects add column if not exists counterparty_team_id text;
alter table projects add column if not exists inbound_player_id int;
alter table projects add column if not exists trigger_summary text not null default '';
alter table projects add column if not exists counterparty_context jsonb not null default '{}'::jsonb;

alter table projects drop constraint if exists projects_workflow_type_check;
alter table projects add constraint projects_workflow_type_check check (workflow_type in (
  'inbound_trade',
  'decision'
));

create index if not exists idx_projects_workflow_counterparty
  on projects(workflow_type, subject_team_id, counterparty_team_id, updated_at desc)
  where archived_at is null;

create table if not exists project_trade_scenarios (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  summary text not null default '',
  status text not null default 'active',
  rank int not null default 0,
  participating_teams text[] not null default '{}'::text[],
  notes text not null default '',
  basketball_fit text not null default '',
  risks text not null default '',
  phone_framing text not null default '',
  walk_away text not null default '',
  counter_range text not null default '',
  validation_summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_trade_scenarios_title_len check (char_length(title) between 1 and 160),
  constraint project_trade_scenarios_status_check check (status in (
    'active',
    'shortlisted',
    'presented',
    'terms_agreed',
    'archived',
    'collapsed'
  ))
);

create index if not exists idx_project_trade_scenarios_project_rank
  on project_trade_scenarios(project_id, rank, updated_at desc);

create index if not exists idx_project_trade_scenarios_project_status
  on project_trade_scenarios(project_id, status, updated_at desc);

create table if not exists project_scenario_players (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references project_trade_scenarios(id) on delete cascade,
  team_id text not null,
  nba_player_id int,
  player_name text not null,
  direction text not null,
  salary_amount numeric,
  salary_source_status text not null default 'source-needed',
  manual_override boolean not null default false,
  stats_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_scenario_players_direction_check check (direction in (
    'outgoing',
    'incoming'
  )),
  constraint project_scenario_players_salary_source_check check (salary_source_status in (
    'captured',
    'source-needed',
    'not-available',
    'not-applicable',
    'manual'
  )),
  constraint project_scenario_players_name_len check (char_length(player_name) between 1 and 160)
);

create unique index if not exists idx_project_scenario_players_unique_player
  on project_scenario_players(scenario_id, team_id, nba_player_id, direction)
  where nba_player_id is not null;

create index if not exists idx_project_scenario_players_scenario_direction
  on project_scenario_players(scenario_id, direction, team_id);

create table if not exists project_scenario_assets (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references project_trade_scenarios(id) on delete cascade,
  asset_type text not null,
  label text not null,
  direction text not null,
  team_id text,
  amount numeric,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_scenario_assets_type_check check (asset_type in (
    'pick',
    'cash',
    'rights',
    'exception',
    'other'
  )),
  constraint project_scenario_assets_direction_check check (direction in (
    'outgoing',
    'incoming'
  )),
  constraint project_scenario_assets_label_len check (char_length(label) between 1 and 200)
);

create index if not exists idx_project_scenario_assets_scenario
  on project_scenario_assets(scenario_id, direction, asset_type);

create table if not exists project_scenario_validations (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references project_trade_scenarios(id) on delete cascade,
  kind text not null,
  status text not null default 'not_run',
  summary text not null default '',
  details jsonb not null default '{}'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_scenario_validations_kind_check check (kind in (
    'app_advisory',
    'trade_builder',
    'internal_cap_sheet',
    'cba'
  )),
  constraint project_scenario_validations_status_check check (status in (
    'not_run',
    'pass',
    'warning',
    'fail',
    'source_needed',
    'manual_pending'
  )),
  constraint project_scenario_validations_unique_kind unique (scenario_id, kind)
);

create index if not exists idx_project_scenario_validations_scenario_kind
  on project_scenario_validations(scenario_id, kind);

create table if not exists project_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  scenario_id uuid references project_trade_scenarios(id) on delete cascade,
  artifact_type text not null,
  title text not null,
  url text,
  notes text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_artifacts_type_check check (artifact_type in (
    'trade_builder_report',
    'internal_cap_sheet',
    'source_brief',
    'scout_intel',
    'performance_intel',
    'slack_note',
    'email_note',
    'other'
  )),
  constraint project_artifacts_title_len check (char_length(title) between 1 and 200)
);

create index if not exists idx_project_artifacts_project
  on project_artifacts(project_id, created_at desc);

create index if not exists idx_project_artifacts_scenario
  on project_artifacts(scenario_id, artifact_type, created_at desc)
  where scenario_id is not null;

alter table project_trade_scenarios enable row level security;
alter table project_scenario_players enable row level security;
alter table project_scenario_assets enable row level security;
alter table project_scenario_validations enable row level security;
alter table project_artifacts enable row level security;

notify pgrst, 'reload schema';
