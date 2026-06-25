-- Archive channels by hiding sessions from the normal UI without deleting
-- their briefs. Hard delete still uses the existing session -> brief cascade.

alter table sessions
  add column if not exists archived_at timestamptz;

create index if not exists idx_sessions_active_created_at
  on sessions(created_at desc)
  where archived_at is null;
