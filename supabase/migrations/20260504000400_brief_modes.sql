-- Add explicit generation mode for recommendation briefs vs. data analyst answers.
alter table briefs
  add column if not exists mode text not null default 'brief';

do $$ begin
  alter table briefs
    add constraint briefs_mode_check
    check (mode in ('brief', 'data_analyst'));
exception when duplicate_object then null; end $$;

create index if not exists idx_briefs_mode
  on briefs(mode, created_at desc);

notify pgrst, 'reload schema';
