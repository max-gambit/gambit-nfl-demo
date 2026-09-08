import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadNflDemoSeed, type NflDemoSeed } from '../../src/nfl_data/seed.js';
import { applyStartsSnapshot, applyReviewedIolSnaps, validateStartsSnapshot, type NflStartsSnapshot } from '../../src/nfl_data/starts.js';

const source = readFile(new URL('../../../data/nfl-player-metrics/starts-2025.json', import.meta.url), 'utf8').then(text => validateStartsSnapshot(JSON.parse(text)));
const loaded = loadNflDemoSeed();

test('captured totals reconcile to explicit regular-season game rows', async () => {
  const snapshot = await source;
  assert.equal(snapshot.records.length, 160);
  const banks = snapshot.records.find(record => record.player_name === 'Aaron Banks')!;
  assert.equal(banks.games_2025, 15);
  assert.equal(banks.starts_2025, 14);
  assert.equal(banks.game_rows.reduce((sum,row) => sum + row.starts,0),14);
  for (const mutate of [
    (bad: NflStartsSnapshot) => { bad.records[0].starts_2025++; },
    (bad: NflStartsSnapshot) => { bad.records[0].game_rows.push(bad.records[0].game_rows[0]); },
    (bad: NflStartsSnapshot) => { bad.records[0].game_rows[0].date = '2025-08-01'; },
    (bad: NflStartsSnapshot) => { bad.records[0].source_url = 'https://example.com/players/test/'; },
  ]) {
    const bad = structuredClone(snapshot); mutate(bad); assert.throws(() => validateStartsSnapshot(bad));
  }
});

test('historical augmentation changes no roster, contract or source snapshot dates', async () => {
  const raw = JSON.parse(await readFile(new URL('../../../data/nfl-demo/current.json', import.meta.url), 'utf8')) as NflDemoSeed;
  const result = applyStartsSnapshot(raw, await source);
  assert.strictEqual(result.roster_entries, raw.roster_entries);
  assert.strictEqual(result.cap_rows, raw.cap_rows);
  assert.equal(result.as_of_date, raw.as_of_date);
  assert.equal(result.retrieved_at, raw.retrieved_at);
  const noLog = raw.player_metrics.find(row => row.player_name === 'Alijah Vera-Tucker')!;
  assert.equal(result.player_metrics.find(row => row.player_id === noLog.player_id)?.starts_2025, noLog.starts_2025);
  assert.ok(result.player_metrics.some(row => row.starts_2025 === 0 && row.source_data?.starts_2025_source));
});

test('the stable NFL URL survives a current-team change but does not join a different identity', async () => {
  const seed = structuredClone(await loaded);
  const record = (await source).records.find(row => row.player_name === 'Aaron Banks')!;
  const player = seed.roster_entries.find(row => row.player_id === record.player_id)!;
  const metric = seed.player_metrics.find(row => row.player_id === record.player_id)!;
  player.player_id = metric.player_id = 'nfl:NYG:aaron-banks';
  player.team_id = metric.team_id = 'NYG';
  metric.starts_2025 = null;
  delete metric.source_data!.starts_2025_source;
  assert.equal(applyStartsSnapshot(seed, await source).player_metrics.find(row => row.player_id === metric.player_id)?.starts_2025, 14);
  player.source_url = 'https://www.nfl.com/players/different-person/';
  assert.equal(applyStartsSnapshot(seed, await source).player_metrics.find(row => row.player_id === metric.player_id)?.starts_2025, null);
});

test('a disagreement in an existing starts count does not select a preferred number', async () => {
  const seed = structuredClone(await loaded);
  const metric = seed.player_metrics.find(row => row.player_name === 'Aaron Banks')!;
  metric.starts_2025 = 7;
  delete metric.source_data!.starts_2025_source;
  const result = applyStartsSnapshot(seed, await source).player_metrics.find(row => row.player_id === metric.player_id)!;
  assert.equal(result.starts_2025, null);
  assert.deepEqual(result.source_data?.starts_2025_conflict, { previous: 7, official: 14, source_url: 'https://www.nfl.com/players/aaron-banks/stats/logs/2025/' });
});

test('reviewed snaps use the historical team and existing aliases, not a depth-only zero', async () => {
  const seed = await loaded;
  for (const [name, snaps, starts, games] of [
    ['Cade Mays',733,12,14], ['Garrett Bradbury',1072,17,17], ['Mike Onwenu',1169,17,17], ['Olu Oluwatimi',312,4,8],
  ] as const) {
    const row = seed.player_metrics.find(row => row.player_name === name)!;
    assert.equal(row.snaps_2025,snaps,name); assert.equal(row.starts_2025,starts,name); assert.equal(row.games_2025,games,name);
  }
  const empty = applyReviewedIolSnaps(structuredClone(seed), { rows: [] });
  const missing = empty.player_metrics.find(row => row.player_name === 'Ben Scott')!;
  assert.equal(missing.snaps_2025,null);
});
