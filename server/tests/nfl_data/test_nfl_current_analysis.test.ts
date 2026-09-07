import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildNflCurrentAnswer,
  classifyNflCurrentQuestion,
} from '../../src/nfl_current/analysis.js';
import { loadNflDemoSeed, type NflCurrentDataLoadResult, type NflDemoSeed } from '../../src/nfl_data/seed.js';

let seedPromise: Promise<NflDemoSeed> | null = null;

test('basic Giants cap and roster questions have a bounded deterministic route', () => {
  assert.equal(classifyNflCurrentQuestion('How much 2026 cap space do the Giants currently have?'), 'cap_space');
  assert.equal(classifyNflCurrentQuestion('How much cap space would the Giants save by cutting Darius Slayton?'), null);
  assert.equal(classifyNflCurrentQuestion('How much cap space do the Giants save by cutting Darius Slayton?'), null);
  assert.equal(classifyNflCurrentQuestion('What is the Giants cap room if they trade a player?'), null);
  assert.equal(classifyNflCurrentQuestion('Who are the Giants starting cornerbacks right now?'), 'starting_cornerbacks');
  assert.equal(classifyNflCurrentQuestion('Which Giants contracts have the largest 2026 cap hits?'), 'largest_cap_hits');
  assert.equal(classifyNflCurrentQuestion('Show our current Giants wide receiver contracts in a table.'), 'wide_receiver_contracts');
  assert.equal(classifyNflCurrentQuestion('List Giants wide receiver contracts over the last 10 years.'), null);
  assert.equal(classifyNflCurrentQuestion('List Giants wide receiver contracts over the last decade.'), null);
  assert.equal(classifyNflCurrentQuestion('Show Giants WR contract trends since 2018.'), null);
  assert.equal(classifyNflCurrentQuestion('How much cap space do the New York Jets have?'), null);
  assert.equal(classifyNflCurrentQuestion('How does that affect our draft strategy?'), null);
  assert.equal(classifyNflCurrentQuestion('Which position markets have grown?'), null);
});

test('current cap answer uses the captured team total and reconciles its components', async () => {
  const seed = await nygSeed();
  const result = await buildNflCurrentAnswer('cap_space', { loadTeam: currentLoader(seed) });
  const summary = seed.team_cap_summaries?.find((row) => row.team_id === 'NYG');
  assert.ok(summary);

  assert.match(result.body.answer, /Giants currently have approximately \$10,392,701 in 2026 cap space/i);
  assert.match(result.body.answer, /Sep 3, 2026/);
  assert.equal(
    summary.top_51_cap_spending_dollars + summary.dead_money_dollars + summary.current_cap_space_dollars,
    summary.applied_team_cap_dollars,
  );
  assert.match(result.body.caveats[0] ?? '', /carryover and other adjustments.*remain unavailable/i);
  assert.equal(result.sources.length, 3);
  assert.equal(result.sources[0]?.data?.current_team_cap_summary, true);
  assert.equal(result.sources[0]?.data?.source_url, 'https://overthecap.com/salary-cap-space');
  assert.equal(result.sources[1]?.data?.source_url, 'https://overthecap.com/calculator/new-york-giants');
  assert.equal(result.sources[2]?.data?.source_url, 'https://operations.nfl.com/calendar-events/nfl-free-agency/nfl-salary-cap');
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

test('wide receiver contract table is built from current active-roster contract rows', async () => {
  const result = await buildNflCurrentAnswer('wide_receiver_contracts', { loadTeam: currentLoader(await nygSeed()) });
  const table = result.body.tables[0];

  assert.equal(table?.title, 'Current Giants wide receiver contracts');
  assert.ok(table && table.rows.length > 0);
  assert.ok(table.rows.some((row) => row[0] === 'Darius Slayton'));
  assert.ok(table.rows.some((row) => row[0] === 'Malik Nabers'));
  assert.equal(result.sources.length, table.rows.length);
  assert.ok(result.sources.every((source) => source.data?.current_team_contract === true));
  assert.ok(result.sources.every((source) => source.data?.current_position_contract_group === 'WR'));
  assert.ok(result.sources.every((source) => /^https:\/\/overthecap\.com\/player\//.test(String(source.data?.source_url))));
});

test('all current answers complete well inside the model deadline and never need a model', async () => {
  const seed = await nygSeed();
  const started = performance.now();
  const answers = await Promise.all([
    buildNflCurrentAnswer('cap_space', { loadTeam: currentLoader(seed) }),
    buildNflCurrentAnswer('starting_cornerbacks', { loadTeam: currentLoader(seed) }),
    buildNflCurrentAnswer('largest_cap_hits', { loadTeam: currentLoader(seed) }),
    buildNflCurrentAnswer('wide_receiver_contracts', { loadTeam: currentLoader(seed) }),
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

test('the preserved-question retry path rebuilds current Giants answers deterministically', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const route = await readFile(path.join(repoRoot, 'server', 'src', 'routes', 'briefs.ts'), 'utf8');

  assert.match(route, /classifyNflCurrentQuestion\(existingBrief\.question\)/);
  assert.match(route, /return regenerateCurrentNflBrief\(existingBrief, currentQuestionKind\)/);
  assert.match(route, /async function regenerateCurrentNflBrief[\s\S]*buildNflCurrentAnswer\(questionKind\)[\s\S]*status: 'ready'/);
});

test('team-cap migration backfills the current Giants row for migration-only installs', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const migration = await readFile(path.join(repoRoot, 'supabase', 'migrations', '20260903000100_nfl_team_cap_summary.sql'), 'utf8');

  assert.match(migration, /update nfl_cap_sheets cs[\s\S]*current_cap_space_2026 = 10392701/);
  assert.match(migration, /team_cap_summary[\s\S]*source_status', 'captured'/);
  assert.match(migration, /where cs\.snapshot_id = latest_snapshot\.id[\s\S]*cs\.team_id = 'NYG'/);
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
