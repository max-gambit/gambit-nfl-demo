#!/usr/bin/env python3
"""Add original PBP descriptions/context only for the already captured game/play IDs.

This public-source capture verifies every existing field before publishing a separate
detail artifact. It never refreshes the historical sample or manufactures charting.
"""
import csv
import gzip
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[3]
DIRECTORY = ROOT / 'data' / 'nfl-examples'
original = json.loads((DIRECTORY / 'coaching.json').read_text())
source = next(s for s in original['sources'] if s['id'] == 'pbp')
assert source['source_url'] == 'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_2025.csv.gz'
numeric = {'play_id', 'week', 'down', 'ydstogo', 'yardline_100', 'yards_gained', 'qb_dropback', 'qb_scramble', 'qb_kneel', 'qb_spike', 'sack', 'third_down_converted', 'first_down', 'touchdown', 'pass_touchdown', 'rush_touchdown', 'aborted_play', 'play_deleted'}
detail_fields = ['qtr', 'quarter_seconds_remaining', 'score_differential', 'shotgun', 'no_huddle']

def number(value):
    return None if value in ('', 'NA', 'NaN', None) else float(value)

def identity(row):
    return f"{row['game_id']}:{int(float(row['play_id']))}"

expected = {identity(row): row for row in original['plays']}
assert len(expected) == len(original['plays'])
with urlopen(Request(source['source_url'], headers={'User-Agent': 'Gambit-bounded-play-review/1.0'}), timeout=60) as response:
    data = response.read(30 * 1024 * 1024 + 1)
    assert len(data) <= 30 * 1024 * 1024, 'Source unexpectedly large'
    last_modified = response.headers.get('Last-Modified')
assert hashlib.sha256(data).hexdigest() == source['sha256'], 'Source bytes changed; keep the current artifact and review a new capture separately'
details = []
reader = csv.DictReader(io.StringIO(gzip.decompress(data).decode()))
for row in reader:
    key = identity(row)
    if key not in expected:
        continue
    prior = expected[key]
    for field, value in prior.items():
        received = number(row[field]) if field in numeric else row[field]
        assert received == value, f'Original historical field changed: {key} / {field}'
    assert row.get('desc'), f'No original description for {key}'
    details.append({'game_id': row['game_id'], 'play_id': int(float(row['play_id'])), 'description': row['desc'], **{field: number(row[field]) for field in detail_fields}})
assert {identity(row) for row in details} == set(expected), 'Detail source did not cover the exact captured IDs'
assert len(details) == len(expected), 'Duplicate source IDs'
captured = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
artifact = {
    'schema': 'nfl_examples_play_details.v1', 'captured_at': captured,
    'base_artifact_sha256': hashlib.sha256((DIRECTORY / 'coaching.json').read_bytes()).hexdigest(),
    'base_source_sha256': source['sha256'], 'all_existing_fields_verified': True,
    'source': {'id': 'pbp_details', 'source_url': source['source_url'], 'title': 'nflverse original play descriptions and game context; exact captured IDs', 'effective_date': source['effective_date'], 'captured_at': captured, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), 'last_modified': last_modified},
    'plays': sorted(details, key=lambda row: (row['game_id'], row['play_id'])),
}
target = DIRECTORY / 'coaching-play-details.json'
target.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'ok': True, 'matched_plays': len(details), 'all_existing_fields_verified': True, 'same_source_bytes': artifact['source']['sha256'] == source['sha256'], 'captured_at': captured, 'output': str(target)}))
