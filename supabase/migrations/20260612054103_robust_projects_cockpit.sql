-- Robust Projects cockpit: projects become decision initiatives, while
-- project_briefs remain linked source briefs for compatibility.

alter table projects add column if not exists question text;
alter table projects add column if not exists objective text not null default '';
alter table projects add column if not exists active_step text not null default 'research';
alter table projects add column if not exists status text not null default 'active';
alter table projects add column if not exists package_status text not null default 'not_started';

update projects p
set question = coalesce(nullif(p.question, ''), b.question, p.title)
from briefs b
where p.source_brief_id = b.id
  and (p.question is null or p.question = '');

update projects p
set question = coalesce(nullif(p.question, ''), linked.question, p.title)
from (
  select distinct on (pb.project_id)
    pb.project_id,
    b.question
  from project_briefs pb
  join briefs b on b.id = pb.brief_id
  order by pb.project_id, pb.created_at asc
) linked
where p.id = linked.project_id
  and (p.question is null or p.question = '');

update projects
set question = title
where question is null or question = '';

alter table projects alter column question set not null;

with ranked_steps as (
  select
    pb.project_id,
    pb.step,
    row_number() over (
      partition by pb.project_id
      order by
        case pb.step
          when 'proposal' then 5
          when 'gm' then 4
          when 'feedback' then 3
          when 'validate' then 2
          else 1
        end desc,
        pb.updated_at desc
    ) as row_num
  from project_briefs pb
)
update projects p
set active_step = ranked_steps.step
from ranked_steps
where p.id = ranked_steps.project_id
  and ranked_steps.row_num = 1;

alter table projects drop constraint if exists projects_active_step_check;
alter table projects add constraint projects_active_step_check check (active_step in (
  'research',
  'validate',
  'feedback',
  'gm',
  'proposal'
));

alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check check (status in (
  'active',
  'packaged',
  'archived'
));

alter table projects drop constraint if exists projects_package_status_check;
alter table projects add constraint projects_package_status_check check (package_status in (
  'not_started',
  'drafted',
  'stale',
  'ready'
));

create index if not exists idx_projects_active_step
  on projects(active_step, updated_at desc)
  where archived_at is null;

create table if not exists project_stage_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  step text not null,
  body text not null default '',
  ai_draft text not null default '',
  citation_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_stage_notes_step_check check (step in (
    'research',
    'validate',
    'feedback',
    'gm',
    'proposal'
  )),
  constraint project_stage_notes_unique_step unique (project_id, step)
);

create index if not exists idx_project_stage_notes_project_step
  on project_stage_notes(project_id, step);

create table if not exists project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  step text not null,
  label text not null,
  required boolean not null default true,
  completed_at timestamptz,
  sort_order int not null default 0,
  source text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_tasks_step_check check (step in (
    'research',
    'validate',
    'feedback',
    'gm',
    'proposal'
  )),
  constraint project_tasks_source_check check (source in (
    'system',
    'ai',
    'user'
  )),
  constraint project_tasks_label_len check (char_length(label) between 1 and 240)
);

create index if not exists idx_project_tasks_project_step_order
  on project_tasks(project_id, step, sort_order, created_at);

create table if not exists project_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  status text not null default 'drafted',
  markdown text not null default '',
  sections jsonb not null default '[]'::jsonb,
  source_refs jsonb not null default '[]'::jsonb,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_packages_status_check check (status in (
    'drafted',
    'stale',
    'ready'
  ))
);

create index if not exists idx_project_packages_project_latest
  on project_packages(project_id, generated_at desc nulls last, created_at desc);

with stage_templates(step, body, ai_draft) as (
  values
    ('research', 'Classify the decision trigger and track: inbound trade call, outbound trade target, free-agency path, extension, or cap-driven roster need. Capture counterparty/team context, spending threshold, roster need, early target list, and linked source briefs.', ''),
    ('validate', 'Validate cap/CBA fidelity before the recommendation hardens: apron distance, salary matching, exceptions, deadlines, PCMS/Trade Builder timing, independent cap sheet cross-checks, and scenario cascade risk.', ''),
    ('feedback', 'Capture cross-department feedback from analytics, scouting/front office, medical/performance, player development, coaching, cap/legal, and any independent scenario comparisons.', ''),
    ('gm', 'Prepare the GM review packet: 3-4 strongest concepts, decision question, soft outreach framing, walk-away/counter ranges, designated negotiators, objections, and revision asks.', ''),
    ('proposal', 'Draft the decision package: recommended action, source-backed evidence, cap/tax impact, risks, formal execution checklist, ownership/league approval needs, and next steps.', '')
)
insert into project_stage_notes (project_id, step, body, ai_draft)
select p.id, stage_templates.step, stage_templates.body, stage_templates.ai_draft
from projects p
cross join stage_templates
on conflict (project_id, step) do nothing;

with task_templates(step, label, required, sort_order) as (
  values
    ('research', 'Name the trigger, decision track, and desired basketball outcome.', true, 0),
    ('research', 'Capture counterparty/team context: apron level, aims, pressure, known targets, and signals.', true, 1),
    ('research', 'Link source briefs or notes with the core evidence and unanswered questions.', true, 2),
    ('validate', 'Cross-check cap/CBA math against the internal cap sheet and external builder output.', true, 0),
    ('validate', 'Model scenario cascade risk, deadlines, PCMS timing, and hard-cap exposure.', true, 1),
    ('validate', 'Identify evidence or number changes that would flip the recommendation.', false, 2),
    ('feedback', 'Capture analytics, scouting/front office, coaching, medical/performance, and cap/legal feedback.', true, 0),
    ('feedback', 'Compare independent scenario work and separate consensus from unresolved disagreement.', true, 1),
    ('gm', 'Narrow to the 3-4 strongest concepts or one binary recommendation.', true, 0),
    ('gm', 'Record walk-away price, counter ranges, outreach framing, and negotiator/approval constraints.', true, 1),
    ('proposal', 'Generate or refresh the decision package with cited evidence and cap/tax impact.', true, 0),
    ('proposal', 'Review the formal execution checklist: league check, owner approval, terms, call, medicals.', true, 1)
)
insert into project_tasks (project_id, step, label, required, sort_order, source)
select p.id, task_templates.step, task_templates.label, task_templates.required, task_templates.sort_order, 'system'
from projects p
cross join task_templates
where not exists (
  select 1
  from project_tasks existing
  where existing.project_id = p.id
    and existing.step = task_templates.step
    and existing.label = task_templates.label
);

alter table projects enable row level security;
alter table project_briefs enable row level security;
alter table project_stage_notes enable row level security;
alter table project_tasks enable row level security;
alter table project_packages enable row level security;

notify pgrst, 'reload schema';
