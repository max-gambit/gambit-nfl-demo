"""Capture explicit 2025 regular-season G/GS from the existing IOL players' NFL logs.

This augments historical usage only. It never refreshes rosters or contract data.
Raw pages are cached outside the repository; the reviewed output retains dates,
source hashes and game rows so the totals can be independently checked.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def plain(value):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def parse_game_log(page, player_name):
    title = re.search(r"<title[^>]*>(.*?)</title>", page, re.S | re.I)
    normalize = lambda value: re.sub(r"[^a-z0-9]", "", value.lower())
    if not title or not normalize(plain(title[1])).startswith(normalize(player_name)) or '2025' not in title[1]:
        raise ValueError('Player identity or season does not match the requested log')
    tables = []
    for match in re.finditer(r'<table\b.*?</table>', page, re.S | re.I):
        headings = re.findall(r'<h3\b[^>]*>(.*?)</h3>', page[:match.start()], re.S | re.I)
        if headings and plain(headings[-1]).lower() == 'regular season':
            tables.append(match[0])
    if len(tables) != 1:
        raise ValueError('No unique regular-season table; missing is not zero')
    table = tables[0]
    headers = [plain(value) for value in re.findall(r'<th\b[^>]*>(.*?)</th>', table, re.S)]
    required = ['WK', 'Game Date', 'G', 'GS']
    if any(headers.count(key) != 1 for key in required):
        raise ValueError('Expected explicit week, date, G and GS columns')
    rows = []
    for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', table, re.S):
        cells = [plain(value) for value in re.findall(r'<td\b[^>]*>(.*?)</td>', row, re.S)]
        if not cells:
            continue
        if len(cells) != len(headers):
            raise ValueError('Game-log row has unexpected columns')
        values = dict(zip(headers, cells))
        week, games, starts = (int(values[key]) for key in ['WK', 'G', 'GS'])
        game_date = datetime.strptime(values['Game Date'], '%m/%d/%Y').date()
        if not 1 <= week <= 18 or games not in [0, 1] or starts not in [0, 1] or starts > games:
            raise ValueError('Invalid regular-season game or start count')
        if not date(2025, 9, 1) <= game_date <= date(2026, 1, 11):
            raise ValueError('Game date is outside the 2025 regular season')
        rows.append({'week': week, 'date': game_date.isoformat(), 'games': games, 'starts': starts})
    if not rows or len({row['date'] for row in rows}) != len(rows) or len(rows) > 18:
        raise ValueError('Empty, duplicated or oversized regular-season log')
    if sum(row['games'] for row in rows) > 17:
        raise ValueError('More than 17 regular-season appearances')
    return sorted(rows, key=lambda row: row['date'])


def capture(player, cache):
    url = player['source_url'].rstrip('/') + '/stats/logs/2025/'
    if not re.fullmatch(r'https://www\.nfl\.com/players/[a-z0-9-]+/stats/logs/2025/', url):
        raise ValueError('Existing roster source is not an NFL player URL')
    path = cache / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    if path.exists():
        cached = json.loads(path.read_text())
    else:
        request = urllib.request.Request(url, headers={'User-Agent': 'Gambit public NFL research (historical game logs)'})
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.url.rstrip('/') != url.rstrip('/'):
                raise ValueError('Game log redirected to a different URL')
            page = response.read().decode('utf-8')
        cached = {'url': url, 'captured_at': datetime.now(timezone.utc).isoformat(), 'html': page}
        path.write_text(json.dumps(cached))
    rows = parse_game_log(cached['html'], player['player_name'])
    return {'player_id': player['player_id'], 'player_name': player['player_name'], 'source_url': url,
            'captured_at': cached['captured_at'], 'sha256': hashlib.sha256(cached['html'].encode()).hexdigest(),
            'games_2025': sum(row['games'] for row in rows), 'starts_2025': sum(row['starts'] for row in rows),
            'game_rows': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=Path('/tmp/giants-iol-starts-2025'))
    parser.add_argument('--output', type=Path, default=ROOT / 'data/nfl-player-metrics/starts-2025.json')
    args = parser.parse_args()
    seed = json.loads((ROOT / 'data/nfl-demo/current.json').read_text())
    players = [row for row in seed['roster_entries'] if row['position'] in ['G', 'C', 'OG', 'OC', 'IOL']]
    args.cache.mkdir(parents=True, exist_ok=True)
    records, unavailable = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(capture, player, args.cache): player for player in players}
        for index, future in enumerate(as_completed(pending), 1):
            player = pending[future]
            try:
                records.append(future.result())
            except Exception as error:
                unavailable.append({'player_id': player['player_id'], 'player_name': player['player_name'], 'reason': str(error)})
            if index % 25 == 0:
                print(f'{index}/{len(players)} checked; {len(records)} explicit logs captured', flush=True)
    result = {'schema': 'nfl_regular_season_starts.v1', 'season': 2025, 'roster_as_of': seed['as_of_date'],
              'scope': 'Interior offensive linemen in the existing roster snapshot; all 2025 teams combined per NFL player log.',
              'records': sorted(records, key=lambda row: row['player_id']),
              'unavailable': sorted(unavailable, key=lambda row: row['player_id'])}
    if len(records) < 100:
        raise ValueError(f'Insufficient capture coverage ({len(records)}); existing output preserved')
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'captured': len(records), 'unavailable': len(unavailable), 'output': str(args.output)}))


if __name__ == '__main__':
    main()
