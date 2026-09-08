#!/usr/bin/env python3
"""Capture eight bounded public contract dossiers; never writes the roster snapshot.

Numeric player tables are reporting, not executed contracts. The output preserves
the reviewed ledger separately so a changed/terminated deal cannot silently win.
"""
import argparse
import datetime as dt
import hashlib
import html
import json
from pathlib import Path
import re
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PLAYERS = ['Brian Burns', 'Andrew Thomas', 'Paulson Adebo', 'Jon Runyan',
           'Darius Slayton', 'Courtland Sutton', 'Jakobi Meyers', 'Christian Kirk']


def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', value))).strip()


def money(value):
    value = clean(value)
    if not re.fullmatch(r'\(?\$[\d,]+\)?', value):
        return None
    return int(value.replace('$', '').replace(',', '').replace('(', '').replace(')', '')) * (-1 if '(' in value else 1)


def tables(page):
    result = []
    for m in re.finditer(r'<table\b([^>]*)>(.*?)</table>', page, re.S):
        preceding = re.findall(r'<h[45][^>]*>(.*?)</h[45]>', page[:m.start()], re.S)
        section = clean(preceding[-1]) if preceding else ''
        if 'current-contract' not in m.group(1) and section not in ['Contract History', 'Dead Money History', 'Cash Flows']:
            continue
        rows = [[clean(c) for c in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]>', row, re.S)]
                for row in re.findall(r'<tr\b[^>]*>(.*?)</tr>', m.group(2), re.S)]
        result.append({'section': section, 'table_attributes': clean(m.group(1)), 'rows': rows})
    return result


def current_rows(page):
    match = re.search(r'<table class="contract current-contract[^\"]*">(.*?)</table>', page, re.S)
    if not match:
        return []
    table = match.group(1)
    header = re.search(r'<thead>(.*?)</thead>', table, re.S).group(1)
    header_rows = re.findall(r'<tr[^>]*>(.*?)</tr>', header, re.S)
    children = iter([clean(x) for x in re.findall(r'<th\b[^>]*>(.*?)</th>', header_rows[1], re.S)] if len(header_rows) > 1 else [])
    labels = []
    for attrs, body in re.findall(r'<th\b([^>]*)>(.*?)</th>', header_rows[0], re.S):
        label = clean(body)
        width = int((re.search(r'colspan="(\d+)"', attrs) or [None, '1'])[1])
        if 'Dead Money' in label:
            labels.extend(['reported_dead', 'reported_savings'])
        elif width > 1:
            labels.extend([label + ' ' + next(children) for _ in range(width)])
        else:
            labels.append(label)
    rows = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', re.search(r'<tbody>(.*?)</tbody>', table, re.S).group(1), re.S):
        cells = re.findall(r'<td\b[^>]*>(.*?)</td>', row, re.S)
        year = re.match(r'(\d{4})', clean(cells[0]))
        if not year:
            continue
        fields = {k: money(v) for k, v in zip(labels, cells) if k and k not in ['reported_dead', 'reported_savings', 'Year', 'Age', 'Cap %']}
        transactions = {}
        for k in ['reported_dead', 'reported_savings']:
            if k in labels:
                transactions[k] = {action: money(value) for action, value in re.findall(r'<div class="([^"]+)"[^>]*>(.*?)</div>', cells[labels.index(k)], re.S)}
        rows.append({'year': int(year[1]), 'year_annotation': clean(cells[0]),
                     'is_void': clean(cells[2]) == 'Void', 'fields': fields, **transactions})
    return rows


def capture(snapshot, name):
    row = next(r for r in snapshot['cap_rows'] if r['player_name'] == name)
    roster = next(r for r in snapshot['roster_entries'] if r['player_id'] == row['player_id'])
    url = row['source_url'].rstrip('/')
    request = urllib.request.Request(url, headers={'User-Agent': 'gambit-reviewed-contract-dossier/1.0'})
    with urllib.request.urlopen(request, timeout=25) as response:
        raw = response.read()
    page = raw.decode('utf-8-sig')
    years = current_rows(page)
    ledger = row['source_data']['contract_years']
    current = next((r for r in years if r['year'] == 2026), None)
    cash_payout = re.search(r'2026 Cash Payout:\s*(\$[\d,]+)', clean(page))
    conflicts = []
    if not current:
        conflicts.append('No current-contract table for 2026 on the inspected player page; the saved roster ledger describes an active deal.')
    elif current['fields'].get('Cap Number') != row['cap_number_2026']:
        conflicts.append('The inspected current-contract cap number differs from the saved roster ledger.')
    return {'player_id': row['player_id'], 'player_name': name, 'team_id': row['team_id'],
            'roster_status_as_of_snapshot': roster['roster_status'],
            'source_status': 'source_conflict' if conflicts else 'reported',
            'source_url': url, 'inspected_at': dt.datetime.now(dt.timezone.utc).isoformat(),
            'source_sha256': hashlib.sha256(raw).hexdigest(),
            'snapshot_as_of': snapshot['as_of_date'], 'snapshot_ledger': ledger,
            'reported_2026_cash_payout': money(cash_payout.group(1)) if cash_payout else None,
            'reported_years': years, 'conflicts': conflicts,
            'source_tables': tables(page),
            'unknown_fields': ['Executed contract and amendments', 'Paid versus unpaid compensation at the hypothetical transaction time',
                               'Guarantee conditions, offsets, injury protection and termination-pay eligibility',
                               'Option exercise/payment status and incentive classification at the transaction time',
                               'Club/player consent, trade availability and negotiated compensation'],
            'availability': 'not_established'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/nfl-contract-scenarios/dossiers.json')
    args = parser.parse_args()
    snapshot = json.loads((ROOT / 'data/nfl-demo/current.json').read_text())
    dossier = {'schema_version': 1, 'snapshot_as_of': snapshot['as_of_date'], 'dossiers': []}
    for name in PLAYERS:
        result = capture(snapshot, name)
        dossier['dossiers'].append(result)
        print(name, result['source_status'], len(result['reported_years']), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dossier, indent=2) + '\n')


if __name__ == '__main__':
    main()
