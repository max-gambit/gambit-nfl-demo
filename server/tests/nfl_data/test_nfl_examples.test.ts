import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildNflExampleEvidence, isQualifyingExamplePlay, nflExampleCoverage, summarizeExamplePlays, type NflExamplePlay } from '../../src/nfl_examples/evidence.js';

const readSnapshot = async (name: string) => JSON.parse(await readFile(new URL(`../../../data/nfl-examples/${name}.json`, import.meta.url), 'utf8'));

test('college comparison uses official same-season stats with distinct game denominators and college measurements', async () => {
  const answer = await buildNflExampleEvidence({ domain: 'college', question: 'Compare the two historical prospects.' });
  assert.equal(answer.body.tables[0].rows.length, 2);
  assert.deepEqual(answer.body.tables[0].rows[0], ['Tyler Warren', 'Penn State', 16, 104, 1233, 8, '6.50', '77.06', 78, 261]);
  assert.deepEqual(answer.body.tables[0].rows[1], ['Colston Loveland', 'Michigan', 10, 56, 582, 5, '5.60', '58.20', 77, 245]);
  assert.ok(answer.body.tables.every(t => t.title.includes('2025 draft class')));
  assert.ok(answer.body.caveats.some(c => c.includes('not combine')));
});

test('receiving-to-blocking follow-up changes attributed focus and preserves limitations', async () => {
  const receiving = await buildNflExampleEvidence({ domain: 'college', question: 'Use detached receiving.', collegePriority: 'receiving' });
  const blocking = await buildNflExampleEvidence({ domain: 'college', question: 'Change to movement blocking.', collegePriority: 'movement_blocking' });
  assert.equal(receiving.body.tables[1].columns[1], 'Focus: receiving');
  assert.equal(receiving.body.tables[1].rows[0][0], 'Colston Loveland');
  assert.match(String(receiving.body.tables[1].rows[0][1]), /separation.*refinement/);
  assert.equal(blocking.body.tables[1].columns[1], 'Focus: movement / blocking');
  assert.equal(blocking.body.tables[1].rows[0][0], 'Tyler Warren');
  assert.match(String(blocking.body.tables[1].rows[0][1]), /lead\/move.*need work/);
  assert.match(blocking.body.answer, /Lance Zierlein/);
  assert.notEqual(receiving.body.answer, blocking.body.answer);
});

test('college refuses uncaptured draft class and player', async () => {
  for (const options of [{ draftClass: 2027 }, { playerName: 'Harold Fannin Jr.' }]) {
    const answer = await buildNflExampleEvidence({ domain: 'college', question: 'Compare prospects.', ...options });
    assert.equal(answer.body.tables.length, 0);
  }
});

test('Thomas timeline and actual snaps remain dated and separate from assumed absence', async () => {
  const answer = await buildNflExampleEvidence({ domain: 'availability', question: 'Assume Andrew Thomas is unavailable.', playerName: 'Andrew Thomas', assumedUnavailable: true });
  const row = answer.body.tables[0].rows[0];
  assert.deepEqual(row.slice(0, 6), ['Andrew Thomas', 'Foot', 'LP', 'LP', 'LP', 'Questionable']);
  assert.deepEqual(row.slice(7, 10), [28, '42.4%', 'No practice-label change']);
  assert.deepEqual(answer.body.tables[1].rows, [['Andrew Thomas', 28, 66, '42.4%'], ['Marcus Mbow', 38, 66, '57.6%']]);
  assert.match(answer.body.answer, /User scenario/);
  assert.ok(answer.body.caveats.some(c => c.includes('not the current injury report')));
  assert.ok(answer.body.tables.every(t => t.title.includes('2025')));
});

test('change flags do not infer medicine and confirmed inactive zero differs from missing usage', async () => {
  const answer = await buildNflExampleEvidence({ domain: 'availability', question: 'Show all changes.', playerName: 'all' });
  const rows = answer.body.tables[0].rows;
  assert.equal(rows.length, 13);
  const olszewski = rows.find(r => r[0] === 'Gunner Olszewski')!;
  assert.deepEqual(olszewski.slice(7, 9), [1, '1.5%']);
  assert.match(String(olszewski[9]), /2025-09-18 LP → 2025-09-19 DNP/);
  assert.match(String(rows.find(r => r[0] === 'Demetrius Flannigan-Fowles')![9]), /DNP → .*LP/);
  assert.equal(rows.find(r => r[0] === 'Darius Muasau')![7], 0);
  assert.equal(rows.find(r => r[0] === 'Roy Robertson-Harris')![7], null);
  assert.doesNotMatch(String(olszewski[9]), /worsen|risk|healthy|recover|improv/i);
  assert.equal((answer.sources[2].data!.numeric_provenance as Array<{ player: string }>).some(p => p.player === 'Darius Muasau'), false);
});

test('availability refuses unknown player, team or window', async () => {
  for (const args of [{ playerName: 'Not a Captured Player' }, { teamId: 'DAL' }, { season: 2026 }, { weekStart: 4 }]) {
    const answer = await buildNflExampleEvidence({ domain: 'availability', question: 'Show availability.', ...args });
    assert.equal(answer.body.tables.length, 0);
  }
});

test('captured PBP has actual source identities, bounded games and independently checked totals', async () => {
  const captured = await readSnapshot('coaching');
  const plays = captured.plays as NflExamplePlay[];
  assert.equal(captured.source_row_count, 48771);
  assert.equal(plays.length, 765);
  assert.equal(new Set(plays.map(p => `${p.game_id}:${p.play_id}`)).size, 765);
  assert.ok(plays.every(p => p.season_type === 'REG' && [1, 2, 3].includes(p.week) && ['NYG','KC','DAL'].includes(p.posteam)));
  assert.equal(plays.filter(isQualifyingExamplePlay).length, nflExampleCoverage.coaching.qualifying_plays);
  const answer = await buildNflExampleEvidence({ domain: 'coaching', question: 'Compare Kansas City and the Giants.' });
  assert.deepEqual(answer.body.tables[0].rows.map(r => r.slice(0, 3)), [['KC',3,179],['NYG',3,188]]);
  assert.deepEqual(answer.body.tables[0].rows.map(r => [r[3],r[5],r[7]]), [[126,950,'17 / 40'],[128,1018,'11 / 40']]);
  assert.ok(answer.body.caveats.some(c => c.includes('not exclusively head-to-head')));
});

test('third-down, red-zone, self-scout and team follow-ups recalculate actual subsets', async () => {
  const third = await buildNflExampleEvidence({ domain: 'coaching', question: 'Use third downs only.', teamId: 'KC', comparisonTeamId: 'NYG' });
  assert.deepEqual(third.body.tables[0].rows.map(r => [r[0],r[2],r[7],r[8]]), [['KC',40,'17 / 40','42.5%'],['NYG',40,'11 / 40','27.5%']]);
  const red = await buildNflExampleEvidence({ domain: 'coaching', question: 'Now compare Dallas and the Giants in the red zone.' });
  assert.deepEqual(red.body.tables[0].rows.map(r => [r[0],r[2]]), [['DAL',30],['NYG',34]]);
  const week = await buildNflExampleEvidence({ domain: 'coaching', question: 'Giants self-scout vs Kansas City, Week 3.' });
  assert.deepEqual(week.body.tables[0].rows.map(r => [r[0],r[2]]), [['NYG',61],['KC',64]]);
  const others = await buildNflExampleEvidence({ domain: 'coaching', question: 'Compare Dallas and Kansas City.' });
  assert.deepEqual(others.body.tables[0].rows.map(r => r[0]).sort(), ['DAL','KC']);
});

test('coaching rejects uncaptured requests even when options mask the question', async () => {
  for (const args of [
    { question: 'Compare Buffalo and NYG.' }, { question: 'Use Week 4.', weekStart: 1, weekEnd: 3 },
    { question: 'Use the 2026 sample.', season: 2025 }, { question: 'Compare the sample.', teamId: 'BUF' },
    { question: 'Compare the sample.', weekStart: 3, weekEnd: 1 },
  ]) {
    const answer = await buildNflExampleEvidence({ domain: 'coaching', ...args });
    assert.equal(answer.body.tables.length, 0, args.question);
  }
});

test('definitions retain sacks and scrambles, exclude kneels/no-plays and expose missing denominators', async () => {
  const plays = (await readSnapshot('coaching')).plays as NflExamplePlay[];
  assert.ok(plays.some(p => p.sack === 1 && isQualifyingExamplePlay(p)));
  assert.ok(plays.some(p => p.qb_scramble === 1 && isQualifyingExamplePlay(p)));
  assert.ok(plays.some(p => p.qb_kneel === 1 && !isQualifyingExamplePlay(p)));
  assert.ok(plays.some(p => p.play_type === 'no_play' && !isQualifyingExamplePlay(p)));
  const s = summarizeExamplePlays([{ ...plays.find(isQualifyingExamplePlay)!, qb_dropback: null, yards_gained: null }]);
  assert.equal(s.plays, 1);
  assert.equal(s.known_dropback_rows, 0);
  assert.equal(s.known_yards_rows, 0);
  assert.equal(summarizeExamplePlays([]).plays, 0);
});

test('every table/calculation citation resolves to a source with capture/effective dates and digest', async () => {
  for (const domain of ['college','availability','coaching'] as const) {
    const answer = await buildNflExampleEvidence({ domain, question: 'Show the example.' });
    const refs = new Set(answer.sources.map(s => s.ref_index));
    for (const block of [...answer.body.tables,...answer.body.calculations,...answer.body.key_findings]) assert.ok(block.source_refs.every(ref => refs.has(ref)));
    for (const source of answer.sources) {
      assert.match(String(source.data?.sha256), /^[a-f0-9]{64}$/);
      assert.match(String(source.data?.captured_at), /^2026-09-08T/);
      assert.ok(source.data?.effective_date);
      assert.match(String(source.data?.source_url), /^https:\/\//);
    }
  }
});
