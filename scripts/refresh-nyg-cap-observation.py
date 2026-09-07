"""Capture dated public cap observations; reject parsing/arithmetic drift.

Run before presenting: python3 scripts/refresh-nyg-cap-observation.py
This updates a separate observation file, never the contract ledger/database.
"""
import datetime
import hashlib
import html
import json
import pathlib
import re
import urllib.request
from html.parser import HTMLParser


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables, self.table, self.row, self.cell = [], None, None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'table': self.table = []
        if tag == 'tr': self.row = []
        if tag in ('td', 'th'): self.cell = ''

    def handle_data(self, value):
        if self.cell is not None: self.cell += value

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            if self.row is not None: self.row.append(' '.join(self.cell.split()))
            self.cell = None
        if tag == 'tr' and self.row is not None:
            if self.table is not None: self.table.append(self.row)
            self.row = None
        if tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def dollars(value):
    sign = -1 if '(' in value or '-' in value else 1
    return sign * int(re.sub(r'[^0-9]', '', value))


def fetch(path):
    url = 'https://overthecap.com/' + path
    request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    raw = urllib.request.urlopen(request, timeout=30).read()
    text = raw.decode()
    parser = Tables()
    parser.feed(text)
    return {'url': url, 'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'sha256': hashlib.sha256(raw).hexdigest()}, text, parser.tables


team, text, _ = fetch('salary-cap/new-york-giants')
plain = ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', text)).split())
match = re.search(r'Total Cap Liabilities: ([($,\d)]+) Top 51: ([($,\d)]+) Team Cap Space: ([($,\d)]+)', plain)
if not match: raise ValueError('Team cap summary shape changed')
team.update(label='Giants team page', total_liabilities=dollars(match[1]), top_51=dollars(match[2]), cap_space=dollars(match[3]))
league, _, tables = fetch('salary-cap-space')
if tables[0][0] != ['Team', 'Cap Space', 'Effective Cap Space', '#', 'Active Cap Spending', 'Dead Money']:
    raise ValueError('League cap headers changed')
rows = [row for row in tables[0] if row and row[0] == 'Giants']
if len(rows) != 1: raise ValueError('Expected one Giants row in first season table')
row = rows[0]
league.update(label='League cap-space page', cap_space=dollars(row[1]), contracts=int(row[3]), active_cap_spending=dollars(row[4]), dead_money=dollars(row[5]))
calculator, _, tables = fetch('calculator/new-york-giants')
rows = [row for table in tables if table and table[0] == ['Season', 'Total Liabilities', 'Team Salary Cap', 'Cap Space'] for row in table if row and row[0] == '2026']
if len(rows) != 1: raise ValueError('Expected one 2026 calculator summary')
applied_cap = dollars(rows[0][2])
calculator.update(label='Giants cap calculator', applied_cap=applied_cap)
if team['total_liabilities'] + team['cap_space'] != applied_cap:
    raise ValueError('Team page does not reconcile to calculator; preserve prior capture')
if league['active_cap_spending'] + league['dead_money'] + league['cap_space'] != applied_cap:
    raise ValueError('League page does not reconcile to calculator; preserve prior capture')
result = {'schema': 'public_cap_observation.v1', 'team_id': 'NYG', 'season': 2026,
          'team': team, 'league': league, 'calculator': calculator}
target = pathlib.Path(__file__).resolve().parents[1] / 'data/nfl-demo/cap-observation.current.json'
target.parent.mkdir(parents=True, exist_ok=True)
temporary = target.with_suffix('.tmp')
temporary.write_text(json.dumps(result, indent=2) + '\n')
temporary.replace(target)
print(json.dumps(result, indent=2))
