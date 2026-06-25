-- NBA roster database seed tables.
-- Snapshot rows are immutable source captures; roster entries point at the
-- latest snapshot through the view below.

create table if not exists nba_teams (
  team_id      text primary key,
  nba_team_id  bigint unique not null,
  abbreviation text not null unique,
  city         text not null,
  name         text not null,
  full_name    text not null,
  conference   text,
  division     text
);

create table if not exists nba_players (
  nba_player_id bigint primary key,
  slug          text,
  full_name     text not null,
  first_name    text,
  last_name     text,
  position      text,
  height        text,
  weight_lbs    int,
  last_attended text,
  country       text,
  jersey_number text,
  source_url    text,
  source_row    jsonb not null default '{}'::jsonb
);

create table if not exists nba_roster_snapshots (
  id          uuid primary key default gen_random_uuid(),
  season      text not null,
  as_of_date  date not null,
  source_name text not null,
  source_url  text not null,
  retrieved_at timestamptz not null,
  team_count  int not null,
  player_count int not null,
  notes       text,
  source_meta jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (season, as_of_date, source_name)
);

create table if not exists nba_roster_entries (
  snapshot_id   uuid not null references nba_roster_snapshots(id) on delete cascade,
  team_id       text not null references nba_teams(team_id) on delete restrict,
  nba_player_id bigint not null references nba_players(nba_player_id) on delete restrict,
  season        text not null,
  source_order  int not null,
  jersey_number text,
  position      text,
  height        text,
  weight_lbs    int,
  last_attended text,
  country       text,
  source_url    text,
  source_row    jsonb not null default '{}'::jsonb,
  primary key (snapshot_id, team_id, nba_player_id)
);

create index if not exists idx_nba_roster_entries_team
  on nba_roster_entries(snapshot_id, team_id, source_order);

create index if not exists idx_nba_roster_entries_player
  on nba_roster_entries(nba_player_id);

create index if not exists idx_nba_roster_snapshots_latest
  on nba_roster_snapshots(as_of_date desc, retrieved_at desc);

create or replace view nba_current_roster_entries as
with latest_snapshot as (
  select *
  from nba_roster_snapshots
  order by as_of_date desc, retrieved_at desc
  limit 1
)
select
  s.id as snapshot_id,
  s.season,
  s.as_of_date,
  s.source_name,
  s.source_url,
  s.retrieved_at,
  s.team_count as snapshot_team_count,
  s.player_count as snapshot_player_count,
  s.notes as snapshot_notes,
  s.source_meta as snapshot_source_meta,
  e.team_id,
  t.nba_team_id,
  t.abbreviation,
  t.city,
  t.name,
  t.full_name,
  t.conference,
  t.division,
  count(*) over (partition by e.snapshot_id, e.team_id)::int as official_roster_count,
  e.nba_player_id,
  p.slug as player_slug,
  p.full_name as player_full_name,
  p.first_name,
  p.last_name,
  e.source_order,
  e.jersey_number,
  e.position,
  e.height,
  e.weight_lbs,
  e.last_attended,
  e.country,
  p.source_url as player_source_url,
  e.source_url as entry_source_url,
  e.source_row
from latest_snapshot s
join nba_roster_entries e on e.snapshot_id = s.id
join nba_teams t on t.team_id = e.team_id
join nba_players p on p.nba_player_id = e.nba_player_id;
