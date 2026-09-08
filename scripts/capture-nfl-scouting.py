#!/usr/bin/env python3
"""Capture a bounded official receiving comparison; no roster-wide refresh."""
import concurrent.futures, datetime, hashlib, html, json, re, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
URLS={
'Courtland Sutton':'https://www.denverbroncos.com/team/players-roster/courtland-sutton/career',
'Jakobi Meyers':'https://www.jaguars.com/team/players-roster/jakobi-meyers/career',
'Christian Kirk':'https://www.49ers.com/team/players-roster/christian-kirk/career',
'Darnell Mooney':'https://www.giants.com/team/players-roster/darnell-mooney/career',
'Malik Nabers':'https://www.giants.com/team/players-roster/malik-nabers/career'}
def clean(s):return re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',s))).strip()
def capture(pair):
 name,url=pair
 raw=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=40).read()
 tables=[]
 for table in re.findall(r'<table\b[^>]*>(.*?)</table>',raw.decode(),re.S):
  headers=[clean(c) for c in re.findall(r'<th\b[^>]*>(.*?)</th>',table,re.S)]
  if 'REC' not in headers or 'YDS' not in headers:continue
  rows=[[clean(c) for c in re.findall(r'<td\b[^>]*>(.*?)</td>',r,re.S)] for r in re.findall(r'<tr\b[^>]*>(.*?)</tr>',table,re.S)]
  rows=[r for r in rows if r and r[0]=='2025']
  if rows:tables.append({'columns':headers[:len(rows[0])],'rows':rows})
 if len(tables)!=1:raise RuntimeError(f'{name}: expected one receiving table, got {len(tables)}')
 return {'player_name':name,'source_url':url,'captured_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source_sha256':hashlib.sha256(raw).hexdigest(),'season':2025,'season_type':'regular','table':tables[0]}
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:rows=list(pool.map(capture,URLS.items()))
 path=ROOT/'data/nfl-scouting/receiving.json'
 path.write_text(json.dumps({'schema_version':1,'records':rows},indent=2)+'\n')
 for r in rows:print(r['player_name'],r['table'])
