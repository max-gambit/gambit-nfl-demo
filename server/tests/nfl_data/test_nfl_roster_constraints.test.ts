import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNflDemoSeed, type NflDemoSeed } from '../../src/nfl_data/seed.js';
import { factualQueryFromQuestion, rosterFactsAnswer } from '../../src/nfl_facts/answer.js';
import { classifyNflAnalysisTurn } from '../../src/nfl_transactions/intent.js';

const loaded = loadNflDemoSeed();
async function sample(): Promise<NflDemoSeed> {
  const seed = structuredClone(await loaded);
  const names = ['Aaron Banks', 'Andrew Vorhees', 'Chris Paul'];
  seed.roster_entries = names.map((name, index) => ({ ...seed.roster_entries.find(row => row.player_name === name)!, age: 29 + index, position: 'G', experience: '4', roster_status: 'active' }));
  const ids = new Set(seed.roster_entries.map(row => row.player_id));
  seed.cap_rows = seed.cap_rows.filter(row => ids.has(row.player_id!)).map(row => ({ ...row, source_status: 'captured', cap_number_2026: 4_000_000 + names.indexOf(row.player_name) * 1_000_000 }));
  seed.player_metrics = seed.player_metrics.filter(row => ids.has(row.player_id)).map(row => ({ ...row, source_status: 'captured', starts_2025: 9 + names.indexOf(row.player_name), source_data: {} }));
  return seed;
}

test('age and cap comparisons preserve strict and inclusive boundaries', async () => {
  const seed = await sample();
  const cases = [
    ['under age 30', ['Aaron Banks']],
    ['age at most 30', ['Aaron Banks', 'Andrew Vorhees']],
    ['older than 30', ['Chris Paul']],
    ['at least 30 years old', ['Andrew Vorhees', 'Chris Paul']],
    ['under $5 million in 2026 cap', ['Aaron Banks']],
    ['2026 cap at most $5 million', ['Aaron Banks', 'Andrew Vorhees']],
    ['over $5 million in 2026 cap', ['Chris Paul']],
    ['at least ten starts last season', ['Andrew Vorhees', 'Chris Paul']],
    ['between 9 and 10 starts', ['Aaron Banks', 'Andrew Vorhees']],
    ['age between 29 and 30', ['Aaron Banks', 'Andrew Vorhees']],
  ] as const;
  for (const [constraint, expected] of cases) {
    const query = factualQueryFromQuestion(`Show players across the NFL with ${constraint}.`, seed)!;
    assert.deepEqual(query.unresolved_constraints, [], constraint);
    const answer = rosterFactsAnswer(query, seed);
    assert.deepEqual(answer.body.tables[0]?.rows.map(row => row[0]) ?? [], expected, constraint);
  }
});

test('unrecognized constraints and mixed known/unknown names return no partial selection', async () => {
  const seed = await sample();
  for (const constraint of ['healthy', 'with fewer than five pressures allowed', 'with a PFF grade above 80', 'available for trade', 'on expiring contracts', 'with at least 10 starts in 2024', 'with age under 30 or cap under $5 million', 'with cap not under $5 million', 'with age between 40 and 20']) {
    const query = factualQueryFromQuestion(`Show veteran guards on other teams ${constraint}.`, seed)!;
    assert.ok(query.unresolved_constraints?.length, constraint);
    assert.deepEqual(rosterFactsAnswer(query, seed).body.tables, [], constraint);
  }
  const unknown = factualQueryFromQuestion('Compare Aaron Banks with John Unrecognized.', seed)!;
  assert.ok(unknown.unresolved_constraints?.some(value => /Unrecognized/.test(value)));
  assert.deepEqual(rosterFactsAnswer(unknown, seed).body.tables, []);
});

test('follow-ups preserve every other constraint and retain an unresolved condition until removed', async () => {
  const seed = await sample();
  let query = factualQueryFromQuestion('Show veteran guards on other teams under age 31 and at least 10 starts.', seed)!;
  query = factualQueryFromQuestion('Sort by lowest cap.', seed, query)!;
  assert.deepEqual(rosterFactsAnswer(query, seed).body.tables[0].rows.map(row => row[0]), ['Andrew Vorhees']);
  query = factualQueryFromQuestion('Only healthy players.', seed, query)!;
  query = factualQueryFromQuestion('Sort by most 2025 starts.', seed, query)!;
  assert.deepEqual(rosterFactsAnswer(query, seed).body.tables, []);
  assert.ok(query.unresolved_constraints?.includes('healthy'));
  query = factualQueryFromQuestion('Remove the health filter.', seed, query)!;
  assert.deepEqual(rosterFactsAnswer(query, seed).body.tables[0].rows.map(row => row[0]), ['Andrew Vorhees']);
  query = factualQueryFromQuestion('Remove the age filter.', seed, query)!;
  assert.deepEqual(rosterFactsAnswer(query, seed).body.tables[0].rows.map(row => row[0]), ['Chris Paul', 'Andrew Vorhees']);
});

test('exclusions do not become inclusions or clear the positive team scope', async () => {
  const seed = await loaded;
  const query = factualQueryFromQuestion('Show Giants players excluding Brian Burns.', seed)!;
  assert.deepEqual(query.team_ids, ['NYG']);
  assert.deepEqual(query.player_names, []);
  const answer = rosterFactsAnswer(query, seed);
  assert.ok(answer.body.tables[0].rows.every(row => row[1] === 'NYG' && row[0] !== 'Brian Burns'));
  const prior = factualQueryFromQuestion('Show veteran interior offensive linemen on other teams.', seed)!;
  const excluded = factualQueryFromQuestion('Exclude the Cowboys.', seed, prior)!;
  assert.deepEqual(excluded.excluded_team_ids, ['DAL']);
  assert.deepEqual(excluded.position_groups, ['IOL']);
  assert.equal(excluded.exclude_nyg, true);
  assert.ok(rosterFactsAnswer(excluded, seed).body.tables[0].rows.every(row => row[1] !== 'DAL' && row[1] !== 'NYG'));
});

test('tightening one side of a numeric range preserves the opposite bound', async () => {
  const seed = await sample();
  const prior = factualQueryFromQuestion('Show players across the NFL with age between 30 and 40.', seed)!;
  const query = factualQueryFromQuestion('Only age under 32.', seed, prior)!;
  assert.deepEqual(query.unresolved_constraints, []);
  assert.deepEqual(rosterFactsAnswer(query, seed).body.tables[0].rows.map(row => row[0]), ['Andrew Vorhees','Chris Paul']);
  assert.ok(query.numeric_filters?.some(filter => filter.field === 'age' && filter.operator === 'gte' && filter.value === 30));
});

test('missing age is reported as unavailable data and never treated as a matching zero', async () => {
  const seed = await loaded;
  const query = factualQueryFromQuestion('Show veteran interior offensive linemen on other teams under age 30.', seed)!;
  const answer = rosterFactsAnswer(query, seed);
  assert.deepEqual(answer.body.tables, []);
  assert.match(answer.body.answer, /can’t apply recorded age < 30/);
  assert.match(answer.body.answer, /173 players/);
  assert.doesNotMatch(answer.body.answer, /No matches/);
});

test('sort counts and qualified player lists cannot bypass constraint handling', async () => {
  const seed = await loaded;
  const question = 'Show Giants players with the 10 highest 2026 cap hits.';
  assert.equal(classifyNflAnalysisTurn(question, { market_query: null, seller_scenario: null }).kind, 'general');
  const query = factualQueryFromQuestion(question, seed)!;
  assert.deepEqual(query.unresolved_constraints, []);
  assert.equal(query.limit, 10);
  const rows = rosterFactsAnswer(query, seed).body.tables[0].rows;
  assert.equal(rows.length, 10);
  const caps = rows.map(row => Number(String(row[4]).replace(/[^\d.-]/g, '')));
  assert.ok(caps.every((value, index) => index === 0 || value <= caps[index-1]));
  assert.equal(factualQueryFromQuestion('Sort by cap.', seed, query)!.sort, 'cap_asc');
});

test('the historical starts augmentation supports a nonempty factual IOL comparison', async () => {
  const seed = await loaded;
  const prior = factualQueryFromQuestion('Show veteran interior offensive linemen on other teams.', seed)!;
  const query = factualQueryFromQuestion('Only include players with at least 10 starts and under $5 million in 2026 cap.', seed, prior)!;
  const answer = rosterFactsAnswer(query, seed);
  assert.ok(answer.body.tables[0].rows.length >= 3);
  assert.ok(answer.body.tables[0].rows.every(row => Number(row[5]) >= 10 && Number(String(row[4]).replace(/[^\d]/g,'')) < 5_000_000));
  assert.match(answer.body.caveats.join(' '), /21 of 173.*starts/);
  const source = answer.sources.find(source => source.title?.startsWith('Andrew Vorhees'))!;
  const data = source.data as { regular_season_game_log: { starts_2025: number; game_rows: Array<{ starts: number }>; source_url: string } };
  assert.equal(data.regular_season_game_log.starts_2025, data.regular_season_game_log.game_rows.reduce((sum,row) => sum + row.starts,0));
  assert.match(data.regular_season_game_log.source_url, /nfl.com\/players\/andrew-vorhees\/stats\/logs\/2025\//);
});

test('excluding the entire positive cohort returns no matches without expanding scope', async () => {
  const seed = await loaded;
  for (const subject of ['Cowboys players', 'Brian Burns']) {
    const prior = factualQueryFromQuestion(`Show ${subject}.`, seed)!;
    const query = factualQueryFromQuestion(`Exclude ${subject}.`, seed, prior)!;
    assert.deepEqual(query.unresolved_constraints, []);
    assert.deepEqual(query.team_ids, prior.team_ids);
    assert.deepEqual(query.player_names, prior.player_names);
    assert.deepEqual(rosterFactsAnswer(query, seed).body.tables, []);
  }
});

test('historical usage for a team is never interpreted as current team membership', async () => {
  const seed = await loaded;
  for (const question of ['Show interior offensive linemen with at least 10 starts in 2025 for the Patriots.', 'Show players with more than 100 snaps for the Patriots in 2025.']) {
    const query = factualQueryFromQuestion(question, seed)!;
    assert.ok(query.unresolved_constraints?.some(value => value.startsWith('historical team usage:')));
    assert.deepEqual(rosterFactsAnswer(query, seed).body.tables, []);
  }
});

test('qualified starting-cornerback questions cannot reach a fixed player list', async () => {
  const seed = await loaded;
  assert.equal(classifyNflAnalysisTurn('Who are the Giants starting cornerbacks right now?', { market_query: null, seller_scenario: null }).kind, 'current_team');
  for (const condition of ['age exactly 30', 'with fewer than 5 starts', 'who are healthy']) {
    const question = `Who are the Giants starting cornerbacks ${condition}?`;
    assert.equal(classifyNflAnalysisTurn(question, { market_query: null, seller_scenario: null }).kind, 'general');
    assert.deepEqual(rosterFactsAnswer(factualQueryFromQuestion(question, seed)!, seed).body.tables, []);
  }
});

test('youngest and oldest selections require recorded ages', async () => {
  const seed = await loaded;
  for (const order of ['youngest', 'oldest']) {
    const answer = rosterFactsAnswer(factualQueryFromQuestion(`Show the 3 ${order} Giants players.`, seed)!, seed);
    assert.deepEqual(answer.body.tables, []);
    assert.match(answer.body.answer, /none of the .* players in this group have recorded age/);
    assert.doesNotMatch(answer.body.caveats.join(' '), /appear after/);
  }
});

test('independently captured snaps are used for filtering, display and source links', async () => {
  const seed = await loaded;
  const answer = rosterFactsAnswer(factualQueryFromQuestion('Show Kingsley Eguakun with more than 100 snaps.', seed)!, seed);
  assert.equal(answer.body.tables[0].rows[0][6], '149');
  const source = answer.sources[0].data as { rows: Array<{ k: string; v: string }> };
  assert.match(source.rows.find(row => row.k === '2025 snap-count source')!.v, /snap_counts_2025\.csv$/);
  const dbShape = structuredClone(seed);
  dbShape.player_metrics.find(row => row.player_name === 'Daniel Faalele')!.source_data = {};
  const dbSource = rosterFactsAnswer(factualQueryFromQuestion('Show Daniel Faalele.', dbShape)!, dbShape).sources[0].data as typeof source;
  assert.match(dbSource.rows.find(row => row.k === '2025 snap-count source')!.v, /snap_counts_2025\.csv$/);
});

test('snapshot-year qualifiers and recognized follow-up introductions remain supported', async () => {
  const seed = await loaded;
  const prior = factualQueryFromQuestion('Show the Giants wide receiver contracts and 2026 cap numbers.', seed)!;
  assert.deepEqual(prior.unresolved_constraints, []);
  assert.ok(rosterFactsAnswer(prior, seed).body.tables[0].rows.length);
  const query = factualQueryFromQuestion('What about IOL?', seed, prior)!;
  assert.deepEqual(query.unresolved_constraints, []);
  assert.deepEqual(query.team_ids, ['NYG']);
  assert.deepEqual(query.position_groups, ['IOL']);
  assert.ok(rosterFactsAnswer(query, seed).body.tables[0].rows.length);
});

test('adding an upper starts bound preserves the existing minimum', async () => {
  const seed = await sample();
  const prior = factualQueryFromQuestion('Show players across the NFL with at least 10 starts.', seed)!;
  const query = factualQueryFromQuestion('And at most 12 starts.', seed, prior)!;
  assert.deepEqual(query.unresolved_constraints, []);
  assert.deepEqual(rosterFactsAnswer(query, seed).body.tables[0].rows.map(row => row[0]), ['Andrew Vorhees', 'Chris Paul']);
});
