-- Prototype-real brief sharing: teammate recipients plus tokenized view links.

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  name text not null,
  role text,
  email text,
  avatar_initials text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_members_name_len check (char_length(name) between 1 and 120),
  constraint team_members_initials_len check (avatar_initials is null or char_length(avatar_initials) between 1 and 6)
);

create unique index if not exists idx_team_members_team_name_unique
  on team_members(team_id, lower(name));

create index if not exists idx_team_members_team
  on team_members(team_id, name);

create table if not exists brief_shares (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references briefs(id) on delete cascade,
  team_member_id uuid references team_members(id) on delete set null,
  recipient_name text not null,
  access_level text not null default 'view',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint brief_shares_access_check check (access_level in ('view')),
  constraint brief_shares_recipient_name_len check (char_length(recipient_name) between 1 and 120)
);

create unique index if not exists idx_brief_shares_active_member_unique
  on brief_shares(brief_id, team_member_id)
  where revoked_at is null and team_member_id is not null;

create index if not exists idx_brief_shares_brief_active
  on brief_shares(brief_id, created_at desc)
  where revoked_at is null;

create table if not exists brief_share_links (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references briefs(id) on delete cascade,
  token text not null unique,
  access_level text not null default 'view',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint brief_share_links_access_check check (access_level in ('view')),
  constraint brief_share_links_token_len check (char_length(token) between 16 and 160)
);

create unique index if not exists idx_brief_share_links_one_active_per_brief
  on brief_share_links(brief_id)
  where revoked_at is null;

create index if not exists idx_brief_share_links_token_active
  on brief_share_links(token)
  where revoked_at is null;

insert into team_members (team_id, name, role, email, avatar_initials)
values
  ('GSW', 'Jon Phelps', 'Basketball strategy', 'jon.phelps@warriors.example', 'JP'),
  ('GSW', 'Michael Scheinert', 'Cap and strategy', 'michael.scheinert@warriors.example', 'MS')
on conflict do nothing;

notify pgrst, 'reload schema';
