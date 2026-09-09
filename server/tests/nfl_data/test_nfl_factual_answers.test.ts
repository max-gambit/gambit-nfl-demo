import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import { factualQueryFromQuestion, rosterFactsAnswer } from '../../src/nfl_facts/answer.js';
import { capObservationAnswer, loadCapObservationAnswer } from '../../src/nfl_current/cap_observation.js';

test('veteran IOL question selects three outside-NYG IOL records without a desirability ranking', async () => {
  const seed = await loadNflDemoSeed();
  const query = factualQueryFromQuestion('If the Giants wanted to add a veteran interior offensive lineman, which three players should we investigate first?', seed)!;
  assert.deepEqual(query.position_groups, ['IOL']);
  assert.equal(query.exclude_nyg, true);
  assert.equal(query.veterans_only, true);
  assert.equal(query.limit, 3);
  const answer = rosterFactsAnswer(query, seed);
  assert.equal(answer.body.language_policy, 'facts_only_v1');
  assert.equal(answer.body.tables[0].rows.length, 3);
  assert.ok(answer.body.tables[0].rows.every(r => r[1] !== 'NYG' && ['G', 'C', 'OG', 'OC', 'IOL'].includes(String(r[2]))));
  assert.match(answer.body.answer, /player name \(A–Z\)/);
});

test('roster follow-up preserves cohort and adds the requested numeric filters', async () => {
  const seed = await loadNflDemoSeed();
  const prior = factualQueryFromQuestion('Show veteran interior offensive linemen on other teams.', seed)!;
  const query = factualQueryFromQuestion('Only include players with at least 10 starts and under $5 million in 2026 cap.', seed, prior)!;
  assert.deepEqual(query.position_groups, ['IOL']);
  assert.equal(query.exclude_nyg, true);
  assert.equal(query.max_cap, 5_000_000);
  assert.equal(query.min_starts, 10);
  assert.equal(query.sort, 'name');
  const answer = rosterFactsAnswer(query, seed);
  for (const row of answer.body.tables[0]?.rows ?? []) {
    assert.ok(Number(row[5]) >= 10);
    assert.ok(Number(String(row[4]).replace(/[^0-9]/g, '')) <= 5_000_000);
  }
});

test('Nabers role-coverage question reports receiving records and labels missing assignments', async () => {
  const seed = await loadNflDemoSeed();
  const query = factualQueryFromQuestion('If Malik Nabers were unavailable this week, which receiving roles would need cover?', seed)!;
  assert.deepEqual(query.position_groups, ['WR']);
  assert.deepEqual(query.team_ids, ['NYG']);
  assert.deepEqual(query.player_names, []);
  const answer = rosterFactsAnswer(query, seed);
  assert.ok(answer.body.tables[0].rows.length > 1);
  assert.match(answer.body.answer, /current role assignments would be needed/);
  assert.match(answer.body.answer, /If Malik Nabers is unavailable/);
  assert.ok(answer.body.tables[0].rows.every(r => r[2] === 'WR'));
});

test('public cap observations preserve conflicting totals and reject arithmetic drift', async () => {
  const data = JSON.parse(await readFile(new URL('../../../data/nfl-demo/cap-observation.current.json', import.meta.url), 'utf8'));
  const answer = await loadCapObservationAnswer();
  assert.ok(answer);
  assert.ok(answer.body.answer.includes(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.abs(data.team.cap_space - data.league.cap_space))));
  assert.equal(answer.sources.length, 3);
  assert.equal(answer.body.calculations.length, 3);
  assert.match(answer.body.caveats.join(' '), /not a live feed/);
  const altered = structuredClone(data); altered.league.cap_space += 1;
  assert.equal(capObservationAnswer(altered), null);
  const aligned = structuredClone(data);
  aligned.league.cap_space = aligned.team.cap_space;
  aligned.league.active_cap_spending = aligned.team.total_liabilities - aligned.league.dead_money;
  const reconciled = capObservationAnswer(aligned)!;
  assert.match(reconciled.body.answer, /figures agree/);
  assert.doesNotMatch(reconciled.body.caveats.join(' '), /disagreement is unresolved/);
});
