-- Persist answer-template selection separately from the generation engine
-- (`briefs.mode`). Existing briefs default to the current recommendation card.
alter table briefs
  add column if not exists template_id text not null default 'decision_brief',
  add column if not exists template_base_id text,
  add column if not exists custom_template_id uuid,
  add column if not exists template_instructions text;

update briefs
set template_id = 'data_table'
where mode = 'data_analyst'
  and template_id = 'decision_brief';

do $$ begin
  alter table briefs
    add constraint briefs_template_id_check
    check (template_id in (
      'decision_brief',
      'comparison_matrix',
      'options_table',
      'evidence_report',
      'staff_packet',
      'data_table',
      'custom'
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table briefs
    add constraint briefs_template_base_id_check
    check (
      template_base_id is null
      or template_base_id in (
        'decision_brief',
        'comparison_matrix',
        'options_table',
        'evidence_report',
        'staff_packet'
      )
    );
exception when duplicate_object then null; end $$;

create table if not exists saved_brief_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  base_template_id text not null,
  instructions text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_brief_templates_name_len check (char_length(name) between 1 and 60),
  constraint saved_brief_templates_instructions_len check (char_length(instructions) between 1 and 2000),
  constraint saved_brief_templates_base_check check (base_template_id in (
    'decision_brief',
    'comparison_matrix',
    'options_table',
    'evidence_report',
    'staff_packet'
  ))
);

alter table saved_brief_templates enable row level security;

create index if not exists idx_briefs_template
  on briefs(template_id, created_at desc);

create index if not exists idx_saved_brief_templates_user
  on saved_brief_templates(user_id, created_at desc);

notify pgrst, 'reload schema';
