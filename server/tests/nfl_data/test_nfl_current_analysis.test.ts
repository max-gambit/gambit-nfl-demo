import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildNflCurrentAnswer,
  classifyNflCurrentQuestion,
} from '../../src/nfl_current/analysis.js';
import { loadNflDemoSeed, type NflCurrentDataLoadResult, type NflDemoSeed } from '../../src/nfl_data/seed.js';

let seedPromise: Promise<NflDemoSeed> | null = null;

test('basic Giants cap and roster questions have a bounded deterministic route', () => {
  assert.equal(classifyNflCurrentQuestion('How much 2026 cap space do the Giants currently have?'), 'cap_space');
  assert.equal(classifyNflCurrentQuestion('Who are the Giants starting cornerbacks right now?'), 'starting_cornerbacks');
  assert.equal(classifyNflCurrentQuestion('Which Giants contracts have the largest 2026 cap hits?'), 'largest_cap_hits');
  assert.equal(classifyNflCurrentQuestion('How much cap space do the New York Jets have?'), null);
  assert.equal(classifyNflCurrentQuestion('How does that affect our draft strategy?'), null);
  assert.equal(classifyNflCurrentQuestion('Which position markets have grown?'), null);
});

test('current cap answer states the loaded figure without mislabeling it as cap space', async () => {
  const seed = await nygSeed();
  const result = await buildNflCurrentAnswer('cap_space', { loadTeam: currentLoader(seed) });
  const supported = seed.cap_rows.filter((row) => row.cap_number_2026 != null
    && row.source_status === 'captured'
    && (row.contract_ledger_confidence === 'captured' || row.contract_ledger_confidence === 'derived'));
  const estimated = seed.cap_rows.filter((row) => row.cap_number_2026 != null && !supported.includes(row));
  const expected = supported.reduce((total, row) => total + row.cap_number_2026!, 0);
  const excluded = estimated.reduce((total, row) => total + row.cap_number_2026!, 0);

  assert.match(result.body.answer, /does not support an exact Giants 2026 cap-space figure/i);
  assert.match(result.body.answer, new RegExp(expected.toLocaleString('en-US').replace(/,/g, ',')));
  assert.match(result.body.answer, new RegExp(excluded.toLocaleString('en-US').replace(/,/g, ',')));
  assert.match(result.body.answer, /estimated roster placeholders.*excluded/i);
  assert.match(result.body.answer, /Sep 2, 2026/);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0]?.data?.current_team_cap_summary, true);
  assert.match(String(result.sources[0]?.data?.contribution), /separates them from estimated placeholders/i);
});

test('largest cap hits are sorted from current active-roster contract rows', async () => {
  const result = await buildNflCurrentAnswer('largest_cap_hits', { loadTeam: currentLoader(await nygSeed()) });
  const table = result.body.tables[0];

  assert.equal(table?.title, 'Largest Giants 2026 cap hits');
  assert.equal(table?.rows.length, 5);
  assert.equal(table?.rows[0]?.[1], 'Paulson Adebo');
  assert.equal(table?.rows[1]?.[1], 'Brian Burns');
  assert.equal(result.sources.length, 5);
  assert.ok(result.sources.every((source) => source.data?.current_team_contract === true));
});

test('cornerback answer distinguishes explicit depth-chart evidence from inference', async () => {
  const result = await buildNflCurrentAnswer('starting_cornerbacks', { loadTeam: currentLoader(await nygSeed()) });

  assert.match(result.body.answer, /Paulson Adebo.*only corner.*explicitly listed first/i);
  assert.match(result.body.answer, /inference/i);
  assert.match(result.body.answer, /not current first-team designations/i);
  assert.equal(result.sources.length, 3);
  assert.equal(result.sources[0]?.data?.current_team_roster, true);
  assert.equal(result.sources[1]?.data?.current_team_depth, true);
  assert.equal(result.sources[2]?.data?.current_team_role_history, true);
});

test('all three current answers complete well inside the model deadline and never need a model', async () => {
  const seed = await nygSeed();
  const started = performance.now();
  const answers = await Promise.all([
    buildNflCurrentAnswer('cap_space', { loadTeam: currentLoader(seed) }),
    buildNflCurrentAnswer('starting_cornerbacks', { loadTeam: currentLoader(seed) }),
    buildNflCurrentAnswer('largest_cap_hits', { loadTeam: currentLoader(seed) }),
  ]);

  assert.ok(performance.now() - started < 2_000);
  assert.ok(answers.every((answer) => answer.body.answer.length > 0));
});

test('missing or fallback current data returns a plain unavailable answer', async () => {
  const seed = await nygSeed();
  const fallback = await buildNflCurrentAnswer('cap_space', {
    loadTeam: async () => ({ seed, source_mode: 'checked_in_snapshot_fallback', fallback_reason: 'offline' }),
  });
  const failed = await buildNflCurrentAnswer('starting_cornerbacks', {
    loadTeam: async () => { throw new Error('database offline'); },
  });

  assert.match(fallback.body.answer, /not available from the local database/i);
  assert.match(failed.body.answer, /not available from the local database/i);
  assert.deepEqual(fallback.sources, []);
  assert.deepEqual(failed.sources, []);
});

async function nygSeed(): Promise<NflDemoSeed> {
  seedPromise ??= loadNflDemoSeed().then((seed) => ({
    ...seed,
    teams: seed.teams.filter((row) => row.team_id === 'NYG'),
    roster_entries: seed.roster_entries.filter((row) => row.team_id === 'NYG'),
    cap_rows: seed.cap_rows.filter((row) => row.team_id === 'NYG'),
    player_metrics: seed.player_metrics.filter((row) => row.team_id === 'NYG'),
  }));
  return seedPromise;
}

function currentLoader(seed: NflDemoSeed): () => Promise<NflCurrentDataLoadResult> {
  return async () => ({ seed, source_mode: 'supabase_current_views', fallback_reason: null });
}
