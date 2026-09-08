#!/usr/bin/env python3
"""Capture bounded public historical examples; no credentials or live availability feed.

Run from any directory. Only writes data/nfl-examples. Public page facts are reviewed
mappings guarded against source drift; a mismatch fails before replacing artifacts.
PBP selection preserves source row identity and selection/exclusion audit counts.
"""
from __future__ import annotations
import csv, gzip, hashlib, html, io, json, pathlib, re, urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/nfl-examples'
CAPTURED = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
SOURCES = {
 'warren': ('https://gopsusports.com/sports/football/roster/season/2024/player/tyler-warren', 'Penn State: Tyler Warren 2024 roster and season biography', '2024 season'),
 'loveland': ('https://mgoblue.com/sports/football/roster/colston-loveland/25486', 'Michigan: Colston Loveland 2024 roster and season biography', '2024 season'),
 'scouting': ('https://www.neworleanssaints.com/news/2025-nfl-draft-tight-end-rankings-tyler-warren-colston-loveland-te-scouting-reports-top-10-tuesday', 'Lance Zierlein NFL.com draft assessments reproduced by Saints.com', '2025-04-22'),
 'injuries': ('https://www.giants.com/news/week-3-nfl-injury-report-new-york-giants-vs-kansas-city-chiefs', 'Giants official Week 3 practice and game-status report', '2025-09-17 through 2025-09-21'),
 'inactives': ('https://www.giants.com/news/andrew-thomas-active-snf-chiefs-inactive-list-xavier-worthy-injury-status', 'Giants official Week 3 active/inactive report', '2025-09-21'),
 'snaps': ('https://www.giants.com/news/snap-counts-week-3-kansas-city-chiefs-cam-skattebo-jaxson-dart-abdul-carter-andrew-thomas-marcus-mbow', 'Giants official Week 3 observed snap counts, Matt Citak', '2025-09-21 game; published 2025-09-22'),
 'schedule': ('https://nflreadr.nflverse.com/articles/nflverse_data_schedule.html', 'nflverse data update and availability schedule', 'documentation at capture'),
 'dictionary': ('https://nflreadr.nflverse.com/articles/dictionary_pbp.html', 'nflverse play-by-play field definitions', 'documentation at capture'),
 'pbp': ('https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz', 'nflverse 2025 play-by-play release', '2025 REG weeks 1-3; selected NYG, KC, DAL offenses'),
}


def fetch(key):
 url, title, effective = SOURCES[key]
 request = urllib.request.Request(url, headers={'User-Agent': 'Gambit historical evidence capture/1.0'})
 with urllib.request.urlopen(request, timeout=60) as response:
  raw = response.read()
  meta = {'id': key, 'source_url': url, 'title': title, 'effective_date': effective, 'captured_at': CAPTURED, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'last_modified': response.headers.get('Last-Modified')}
 return raw, meta


def plain(raw):
 text = re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>', ' ', raw.decode(), flags=re.I)
 return re.sub(r'\s+', ' ', html.unescape(re.sub('<[^>]+>', ' ', text))).strip()


def require(text, phrase):
 if phrase not in text:
  raise ValueError(f'Source drift: expected fact anchor absent: {phrase}')


def table_rows(raw):
 for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', raw.decode(), re.S | re.I):
  yield [plain(cell.encode()) for cell in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row, re.S | re.I)]


def main():
 pages, sources = {}, {}
 for key in SOURCES:
  raw, meta = fetch(key)
  pages[key], sources[key] = raw, meta
  print(f'Captured {key}: {meta["bytes"]:,} bytes', flush=True)
 text = {key: plain(raw) for key, raw in pages.items() if key != 'pbp'}
 require(text['warren'], '104 receptions for 1,233 yards and eight touchdowns')
 require(text['warren'], 'Started 16 games')
 require(text['warren'], 'Height 6-6 Weight 261 lbs')
 require(text['loveland'], 'Appeared in 10 games with seven starts')
 require(text['loveland'], '56 catches')
 require(text['loveland'], '582 yards with five touchdowns')
 require(text['loveland'], 'Height: 6-5 Weight: 245')
 require(text['scouting'], 'Tyler Warren Draft Analysis by Lance Zierlein')
 require(text['scouting'], 'Colston Loveland Draft Analysis by Lance Zierlein')
 require(text['scouting'], 'lead/move blocker')
 require(text['scouting'], 'entire route tree')
 require(text['schedule'], 'Our data source died after the 2024 season')
 require(text['schedule'], 'after all post-season games are completed')
 college = {
  'schema': 'nfl_examples_college.v1', 'captured_at': CAPTURED, 'draft_class': 2025, 'stat_season': 2024, 'status': 'historical_draft_class',
  'measurement_basis': 'Official 2024 college roster listings; not combine measurements or current body measurements.',
  'sources': [sources[k] for k in ['warren', 'loveland', 'scouting']],
  'players': [
   {'name': 'Tyler Warren', 'school': 'Penn State', 'position': 'TE', 'games': 16, 'receptions': 104, 'receiving_yards': 1233, 'receiving_touchdowns': 8, 'height_inches': 78, 'weight_pounds': 261, 'stats_source_id': 'warren', 'measurement_source_id': 'warren', 'stats_locator': '2024 season biography: Season: Started 16 games', 'measurement_locator': '2024 roster header: Height 6-6 Weight 261 lbs', 'assessment': {'author': 'Lance Zierlein, NFL.com (reproduced by Saints.com)', 'source_id': 'scouting', 'published_on': '2025-04-22', 'original_url': 'https://www.nfl.com/prospects/tyler-warren/32005741-5271-7637-9a66-3790edc85a60', 'receiving': 'Alignment flexibility and contested-catch strength; better suited to short and intermediate work, with limited vertical separation.', 'movement_blocking': 'Effective lead/move blocker and direct-snap runner; in-line block sustain and hand placement need work.'}},
   {'name': 'Colston Loveland', 'school': 'Michigan', 'position': 'TE', 'games': 10, 'receptions': 56, 'receiving_yards': 582, 'receiving_touchdowns': 5, 'height_inches': 77, 'weight_pounds': 245, 'stats_source_id': 'loveland', 'measurement_source_id': 'loveland', 'stats_locator': 'Junior (2024) biography: Appeared in 10 games with seven starts', 'measurement_locator': '2024 roster header: Height 6-5 Weight 245', 'assessment': {'author': 'Lance Zierlein, NFL.com (reproduced by Saints.com)', 'source_id': 'scouting', 'published_on': '2025-04-22', 'original_url': 'https://www.nfl.com/prospects/colston-loveland/32004c4f-5645-6221-1f26-a303114b69f8', 'receiving': 'Broad route repertoire and man-coverage separation; route detail and footwork still need refinement.', 'movement_blocking': 'Projected blocking ceiling around average; point-of-attack strength was a concern.'}},
  ],
 }
 injury_rows = []
 inactive_text = text['inactives'].split('GIANTS INACTIVES', 1)[1].split('CHIEFS INACTIVES', 1)[0]
 for row in table_rows(pages['injuries']):
  if len(row) != 6 or row[0] == 'Player': continue
  if row[0].startswith('DE Mike Danna'): break
  position, name = row[0].split(' ', 1)
  if row[2] not in ['LP', 'FP', 'DNP']: raise ValueError(f'Invalid report row: {row}')
  observed = re.search(re.escape(name) + r' - (\d+) offensive snaps?(?:, [^()]+)? \(([\d.]+) percent', text['snaps'])
  inactive = name in inactive_text
  injury_rows.append({'name': name, 'position': position, 'reported_injury': row[1], 'practice': [{'date': date, 'status': status} for date, status in zip(['2025-09-17','2025-09-18','2025-09-19'], row[2:5])], 'game_status': 'No game designation' if row[5] == '-' else row[5], 'gameday': 'Inactive' if inactive else 'Observed offensive participation' if observed else 'Not captured', 'offensive_snaps': int(observed.group(1)) if observed else 0 if inactive else None, 'reported_offensive_snap_percent': float(observed.group(2)) if observed else 0 if inactive else None, 'offense_team_snaps': 66 if observed else None})
 if len(injury_rows) != 13: raise ValueError(f'Expected 13 NYG report rows, found {len(injury_rows)}')
 thomas = next(row for row in injury_rows if row['name'] == 'Andrew Thomas')
 assert thomas['offensive_snaps'] == 28 and thomas['game_status'] == 'Questionable'
 require(text['snaps'], 'Greg Van Roten - 66 offensive snaps (100 percent)')
 availability = {'schema': 'nfl_examples_availability.v1', 'captured_at': CAPTURED, 'team_id': 'NYG', 'opponent': 'KC', 'game_date': '2025-09-21', 'season': 2025, 'week': 3, 'sources': [sources[k] for k in ['injuries','inactives','snaps','schedule']], 'players': injury_rows, 'observed_offensive_usage': [{'name':'Andrew Thomas','snaps':28,'team_snaps':66},{'name':'Marcus Mbow','snaps':38,'team_snaps':66}], 'role_observation': 'Giants.com reported that Marcus Mbow replaced Andrew Thomas during this game. This is a historical observation, not a current assignment.'}
 require(text['snaps'], 'Marcus Mbow - 38 offensive snaps')
 require(text['snaps'], 'Marcus Mbow came in for Thomas')
 all_rows = list(csv.DictReader(io.StringIO(gzip.decompress(pages['pbp']).decode())))
 keep = ['play_id','game_id','game_date','week','posteam','defteam','home_team','away_team','season_type','down','ydstogo','yardline_100','play_type','yards_gained','qb_dropback','qb_scramble','qb_kneel','qb_spike','sack','third_down_converted','first_down','touchdown','pass_touchdown','rush_touchdown','aborted_play','play_deleted']
 strings = {'game_id','game_date','posteam','defteam','home_team','away_team','season_type','play_type'}
 for key in keep:
  if key not in all_rows[0]: raise ValueError(f'Missing PBP field {key}')
 selected = []
 for row in all_rows:
  if row['season_type'] != 'REG' or not 1 <= int(row['week']) <= 3 or row['posteam'] not in ['NYG','KC','DAL']: continue
  selected.append({key: row[key] if key in strings else float(row[key]) if row[key] not in ('','NA') else None for key in keep})
 if len(selected) != 765: raise ValueError(f'Source drift: expected 765 bounded PBP rows, found {len(selected)}; review coverage counts before promotion')
 coaching = {'schema': 'nfl_examples_coaching.v1', 'captured_at': CAPTURED, 'season':2025, 'season_type':'REG', 'weeks':[1,2,3], 'team_ids':['NYG','KC','DAL'], 'source_row_count':len(all_rows), 'captured_row_count':len(selected), 'sources':[sources[k] for k in ['pbp','dictionary','schedule']], 'games': sorted(set(r['game_id'] for r in selected)), 'selection': '2025 REG weeks 1-3, posteam in NYG/KC/DAL. Preserve all source rows in that selection. Analysis excludes non-run/pass rows, kneels, spikes, aborted and deleted plays; sacks and scrambles are retained.', 'plays':selected}
 OUT.mkdir(exist_ok=True)
 for name, data in [('college.json',college),('availability.json',availability),('coaching.json',coaching)]:
  (OUT / name).write_text(json.dumps(data, indent=2)+'\n')
 print(json.dumps({'players':len(college['players']),'injury_rows':len(injury_rows),'pbp_source_rows':len(all_rows),'pbp_captured_rows':len(selected),'games':coaching['games']}))

if __name__ == '__main__': main()
