import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildNflExampleEvidence, type AvailabilitySnapshot, type NflExampleArgs, type NflExamplePlay } from '../../src/nfl_examples/evidence.js';
import { healthWorkflow } from '../../src/nfl_examples/healthWorkflow.js';

const raw = async (name: string) => JSON.parse(await readFile(new URL(`../../../data/nfl-examples/${name}.json`, import.meta.url), 'utf8'));
const metadata = (answer: Awaited<ReturnType<typeof buildNflExampleEvidence>>) => answer.sources[0].data!;
const provenance = (answer: Awaited<ReturnType<typeof buildNflExampleEvidence>>) => metadata(answer).numeric_provenance as { selected_play_ids: string[]; team_aggregates: Array<{ team: string; plays: number; third_downs: number; third_down_conversions: number }>; counts: Record<string, number> };

test('named Thomas facts bind LP dates and cannot imply a usage trend or incompatible report fields', async () => {
  const answer = await buildNflExampleEvidence({ domain: 'availability', question: 'Investigate Andrew Thomas and whether his snaps declined.', playerName: 'Andrew Thomas' });
  const assertions = metadata(answer).factual_assertions as Array<{ entity: string; claim: string; practice: Array<{ date: string; status: string }> }>;
  assert.equal(assertions.length, 1);
  assert.equal(assertions[0].entity, 'Andrew Thomas');
  assert.deepEqual(assertions[0].practice, [{ date: '2025-09-17', status: 'LP' }, { date: '2025-09-18', status: 'LP' }, { date: '2025-09-19', status: 'LP' }]);
  assert.match(assertions[0].claim, /28 of 66.*42\.4%/);
  assert.doesNotMatch(assertions[0].claim, /full participation|decline|mismatch|worsen/i);
  const counterfacts = metadata(answer).counterfacts as Array<{ rejected_claim: string; reason: string }>;
  assert.ok(counterfacts.some(item => /declined sharply/.test(item.rejected_claim) && /Earlier game usage.*missing/.test(item.reason)));
  assert.ok(counterfacts.some(item => /mismatch/.test(item.rejected_claim) && /different compatible observations/.test(item.reason)));
  assert.ok(answer.body.key_findings.some(item => item.label === 'No snap-trend baseline'));
});

test('review order is driven by actual dated label changes and exposes the evidence needed next', async () => {
  const answer = await buildNflExampleEvidence({ domain: 'availability', question: 'Show all report changes and review priorities.', playerName: 'all', availabilityView: 'review_priority' });
  const workflow = metadata(answer).workflow as { review_priority: Array<{ player: string; reason: string; next_question: string }>; ordering_basis: string };
  assert.deepEqual(workflow.review_priority.slice(0, 2).map(row => row.player), ['Gunner Olszewski', 'Rakeem Nunez-Roches']);
  for (const row of workflow.review_priority.slice(0, 2)) { assert.match(row.reason, /2025-09-18 LP → 2025-09-19 DNP/); assert.match(row.next_question, /next dated official report/); }
  assert.match(workflow.ordering_basis, /not a medical risk ranking/);
  assert.equal(workflow.review_priority.length, 13);
});

test('explicit absence becomes a staffing workflow even when the prefetch requested all report rows', async () => {
  const answer = await buildNflExampleEvidence({ domain: 'availability', question: 'Use the report but assume Andrew Thomas is unavailable.', playerName: 'all' });
  assert.match(answer.body.answer, /User scenario: assume Andrew Thomas is unavailable/);
  assert.equal(answer.body.example_query?.playerName, 'all');
  assert.equal(answer.body.example_query?.assumedUnavailablePlayer, 'Andrew Thomas');
  assert.equal(answer.body.example_query?.assumedUnavailable, true);
  assert.equal(answer.body.tables[0].rows.length, 13);
  assert.deepEqual(answer.body.tables[0].rows.find(row => row[0] === 'Andrew Thomas')!.slice(2, 6), ['LP', 'LP', 'LP', 'Questionable']);
  const contingency = answer.body.tables.find(table => table.title.startsWith('User-assumed absence'))!;
  assert.equal(contingency.rows.length, 3);
  assert.match(JSON.stringify(contingency.rows), /Current roster|current roster/);
  assert.doesNotMatch(JSON.stringify(contingency.rows), /Marcus Mbow|will start|will replace/);
  for (const question of ['Andrew Thomas has a foot injury.', 'Andrew Thomas looks unhealthy.']) {
    const noAssumption = await buildNflExampleEvidence({ domain: 'availability', question });
    assert.equal(noAssumption.body.example_query?.assumedUnavailable, false);
  }
  const fabricatedFlag = await buildNflExampleEvidence({ domain: 'availability', question: 'Show Thomas.', assumedUnavailable: true });
  assert.equal(fabricatedFlag.body.tables.length, 0);
});

test('compound report investigation preserves all changed-label players and a Thomas-only absence subject', async () => {
  const captured = await raw('availability') as AvailabilitySnapshot;
  const changedPlayers = captured.players.filter(player => player.practice.slice(1).some((entry, index) => entry.status !== player.practice[index].status));
  const latestChangedToDnp = changedPlayers.filter(player => player.practice.at(-1)!.status === 'DNP').map(player => player.name).sort();
  const question = 'Using the historical September 17–21, 2025 Giants report, whom should we investigate first and what should we review next? Assume Andrew Thomas is unavailable.';
  for (const playerName of [undefined, 'all', 'Andrew Thomas']) {
    const answer = await buildNflExampleEvidence({ domain: 'availability', question, ...(playerName ? { playerName } : {}) });
    const workflow = metadata(answer).workflow as { report_selection: { playerName: string; players: string[] }; review_priority: Array<{ player: string; reason: string }>; user_assumption: { player: string; unavailable: boolean } };
    assert.equal(answer.body.tables[0].rows.length, captured.players.length);
    assert.equal(workflow.report_selection.playerName, 'all');
    assert.deepEqual(workflow.report_selection.players.sort(), captured.players.map(player => player.name).sort());
    assert.equal(workflow.review_priority.length, captured.players.length);
    assert.deepEqual(workflow.review_priority.slice(0, latestChangedToDnp.length).map(row => row.player), latestChangedToDnp);
    for (const changed of changedPlayers) assert.ok(workflow.review_priority.some(row => row.player === changed.name && /→/.test(row.reason)));
    assert.deepEqual({ player: workflow.user_assumption.player, unavailable: workflow.user_assumption.unavailable }, { player: 'Andrew Thomas', unavailable: true });
    assert.equal(answer.body.example_query?.playerName, 'all');
    assert.equal(answer.body.example_query?.assumedUnavailablePlayer, 'Andrew Thomas');
    assert.ok(answer.body.key_findings.some(finding => finding.label === 'Andrew Thomas · dated observations' && /LP on 2025-09-17/.test(finding.body)));
    const scenarioTables = answer.body.tables.filter(table => table.title.startsWith('User-assumed absence'));
    assert.equal(scenarioTables.length, 1);
    assert.match(scenarioTables[0].title, /Andrew Thomas/);
    assert.match(String(scenarioTables[0].rows[0][1]), /cover Andrew Thomas/);
    assert.doesNotMatch(answer.body.answer, /assume all|every.*unavailable/);
  }
  const named = await buildNflExampleEvidence({ domain: 'availability', question: 'Show Andrew Thomas’s dated timeline.', playerName: 'Andrew Thomas' });
  assert.equal(named.body.tables[0].rows.length, 1);
  assert.equal(named.body.example_query?.playerName, 'Andrew Thomas');
});

test('report summary describes the actual review reasons when a cohort has no new DNP labels', async () => {
  const captured = await raw('availability') as AvailabilitySnapshot;
  const players = captured.players.filter(player => ['Andrew Thomas', 'Roy Robertson-Harris'].includes(player.name));
  const answer = healthWorkflow({ domain: 'availability', question: 'Show all report review priorities.', playerName: 'all' }, { ...captured, players });
  const queue = (metadata(answer).workflow as { review_priority: Array<{ player: string; reason: string }> }).review_priority;
  assert.equal(queue.length, 2);
  for (const item of queue) assert.ok(answer.body.answer.includes(`${item.player}: ${item.reason}`));
  assert.doesNotMatch(answer.body.answer, /changed to DNP/);
  assert.match(answer.body.answer, /no earlier usage baseline|data gap/);
});

test('trusted follow-up continuity retains the same absence subject without changing the current user question', async () => {
  const initial = await buildNflExampleEvidence({ domain: 'availability', question: 'Assume Andrew Thomas is unavailable.', playerName: 'Andrew Thomas' });
  const previousQuery = initial.body.example_query as unknown as NflExampleArgs;
  const question = 'Show his timeline';
  const followup = await buildNflExampleEvidence({ ...previousQuery, question, availabilityView: 'timeline' }, { previousQuery });
  assert.equal(followup.body.example_query?.question, question);
  assert.equal(followup.body.example_query?.assumedUnavailable, true);
  assert.equal(followup.body.example_query?.assumedUnavailablePlayer, 'Andrew Thomas');
  assert.equal(followup.body.example_query?.playerName, 'Andrew Thomas');
  const assumption = (metadata(followup).workflow as { user_assumption: { player: string; origin: string; current_user_question: string; previous_query_question: string; exact_user_question?: string } }).user_assumption;
  assert.equal(assumption.player, 'Andrew Thomas');
  assert.equal(assumption.origin, 'trusted_previous_query');
  assert.equal(assumption.current_user_question, question);
  assert.equal(assumption.previous_query_question, initial.body.example_query?.question);
  assert.equal(assumption.exact_user_question, undefined, 'The follow-up must not be presented as a new literal absence assumption');
  assert.deepEqual(followup.body.tables.filter(table => table.title.startsWith('User-assumed absence')).map(table => table.title), ['User-assumed absence · Andrew Thomas · separate from the 2025 report']);
  const nextQuery = followup.body.example_query as unknown as NflExampleArgs;
  const thirdTurn = await buildNflExampleEvidence({ ...nextQuery, question: 'What evidence changes that review?' }, { previousQuery: nextQuery });
  assert.equal(thirdTurn.body.example_query?.assumedUnavailablePlayer, 'Andrew Thomas');
  assert.equal(thirdTurn.body.example_query?.question, 'What evidence changes that review?');
});

test('changed absence actors and model-authored previous-query fields cannot acquire trusted continuity', async () => {
  const initial = await buildNflExampleEvidence({ domain: 'availability', question: 'Assume Andrew Thomas is unavailable.', playerName: 'Andrew Thomas' });
  const previousQuery = initial.body.example_query as unknown as NflExampleArgs;
  const forgedActor = await buildNflExampleEvidence({ ...previousQuery, question: 'Show his timeline', assumedUnavailablePlayer: 'Gunner Olszewski' }, { previousQuery });
  assert.equal(forgedActor.sources.length, 0);
  assert.match(forgedActor.body.answer, /different absence subject requires a new explicit user assumption/);
  const noTrustedContext = await buildNflExampleEvidence({ ...previousQuery, question: 'Show his timeline' });
  assert.equal(noTrustedContext.sources.length, 0);
  const modelPreviousQuery = await buildNflExampleEvidence({ ...previousQuery, question: 'Show his timeline', previousQuery } as NflExampleArgs);
  assert.equal(modelPreviousQuery.sources.length, 0);
  assert.match(modelPreviousQuery.body.answer, /Unsupported example fields: previousQuery/);
  const wrongDomain = await buildNflExampleEvidence({ ...previousQuery, question: 'Show his timeline' }, { previousQuery: { ...previousQuery, domain: 'college' } });
  assert.equal(wrongDomain.sources.length, 0);
  const newLiteralAssumption = await buildNflExampleEvidence({ ...previousQuery, question: 'Assume Gunner Olszewski is unavailable.', playerName: 'Gunner Olszewski', assumedUnavailablePlayer: 'Gunner Olszewski' }, { previousQuery });
  assert.equal(newLiteralAssumption.body.example_query?.assumedUnavailablePlayer, 'Gunner Olszewski');
});

test('explicit false clears an inherited absence and its stale contingency view', async () => {
  const initial = await buildNflExampleEvidence({ domain: 'availability', question: 'Assume Andrew Thomas is unavailable.', playerName: 'Andrew Thomas' });
  const previousQuery = initial.body.example_query as unknown as NflExampleArgs;
  assert.equal(previousQuery.availabilityView, 'contingency');
  const cleared = await buildNflExampleEvidence({ ...previousQuery, question: 'Clear that assumption and show his dated timeline.', assumedUnavailable: false }, { previousQuery });
  assert.equal(cleared.body.example_query?.assumedUnavailable, false);
  assert.equal(cleared.body.example_query?.assumedUnavailablePlayer, undefined);
  assert.equal(cleared.body.example_query?.availabilityView, 'timeline');
  assert.equal((metadata(cleared).workflow as { user_assumption: unknown }).user_assumption, null);
  assert.ok(cleared.body.tables.every(table => !table.title.startsWith('User-assumed absence')));
  assert.equal(cleared.body.tables[0].rows[0][0], 'Andrew Thomas');
});

test('third-down outcome and distance totals match an independent count of the public rows', async () => {
  const data = await raw('coaching');
  const plays: NflExamplePlay[] = data.plays;
  const expected = plays.filter(play => ['NYG', 'KC'].includes(play.posteam) && play.down === 3 && play.ydstogo != null && play.ydstogo >= 7 && play.ydstogo <= 10 && play.third_down_converted === 0 && ['run', 'pass'].includes(play.play_type!) && ![play.qb_kneel, play.qb_spike, play.aborted_play, play.play_deleted].includes(1));
  const answer = await buildNflExampleEvidence({ domain: 'coaching', question: 'Review failed third downs at 7–10 yards.', teamId: 'NYG', comparisonTeamId: 'KC', coachingFilters: { outcome: 'failed', minYardsToGo: 7, maxYardsToGo: 10, reviewLimit: 3 }, coachingView: 'review_queue' });
  assert.deepEqual(provenance(answer).selected_play_ids.sort(), expected.map(play => `${play.game_id}:${play.play_id}`).sort());
  assert.equal(provenance(answer).counts.displayed_queue, 3);
  assert.equal(provenance(answer).counts.after_filters, expected.length);
  assert.ok(expected.length > 3, 'Queue limit is smaller than the analysis sample');
  assert.deepEqual(answer.body.example_query?.coachingFilters, { outcome: 'failed', minYardsToGo: 7, maxYardsToGo: 10, reviewLimit: 3 });
  assert.ok(provenance(answer).team_aggregates.every(stats => stats.third_down_conversions === 0));
});

test('converted plus failed plus unknown splits preserve all third-down denominators', async () => {
  const answer = await buildNflExampleEvidence({ domain: 'coaching', question: 'Compare NYG and KC converted and failed third downs.', teamId: 'NYG', comparisonTeamId: 'KC', coachingView: 'converted_failed' });
  const rows = answer.body.tables.find(table => table.title.includes('converted / failed by distance'))!.rows;
  for (const team of ['NYG', 'KC']) {
    const teamRows = rows.filter(row => row[0] === team);
    assert.equal(teamRows.reduce((total, row) => total + Number(row[2]), 0), 40);
    assert.ok(teamRows.every(row => Number(row[2]) === Number(row[3]) + Number(row[4]) + Number(row[5])));
    assert.equal(teamRows.reduce((total, row) => total + Number(row[3]), 0), team === 'NYG' ? 11 : 17);
    assert.equal(teamRows.reduce((total, row) => total + Number(row[4]), 0), team === 'NYG' ? 29 : 23);
  }
});

test('review queue returns the original public description for exact IDs and IDs can drive a narrower follow-up', async () => {
  const details = await raw('coaching-play-details');
  const initial = await buildNflExampleEvidence({ domain: 'coaching', question: 'Review failed third downs.', teamId: 'NYG', comparisonTeamId: 'KC', coachingView: 'review_queue', coachingFilters: { outcome: 'failed', reviewLimit: 8 } });
  const queue = (metadata(initial).workflow as { review_queue: Array<{ evidence_id: string; description: string; posteam: string; game_id: string }> }).review_queue;
  assert.equal(queue.length, 8);
  for (const play of queue) {
    const original = details.plays.find((row: { game_id: string; play_id: number }) => `${row.game_id}:${row.play_id}` === play.evidence_id);
    assert.ok(original);
    assert.equal(play.description, original.description);
    assert.ok(play.description.length > 20);
  }
  const ids = queue.slice(0, 2).map(play => play.evidence_id);
  const followup = await buildNflExampleEvidence({ domain: 'coaching', question: 'Show these two identified plays.', teamId: 'NYG', comparisonTeamId: 'KC', coachingFilters: { playIds: ids }, coachingView: 'review_queue' });
  assert.deepEqual(provenance(followup).selected_play_ids.sort(), ids.sort());
  assert.equal(provenance(followup).counts.after_filters, 2);
  const game = await buildNflExampleEvidence({ domain: 'coaching', question: 'Show this captured game.', teamId: 'NYG', comparisonTeamId: 'KC', coachingFilters: { gameIds: [queue[0].game_id] } });
  assert.ok(provenance(game).selected_play_ids.every(play => play.startsWith(`${queue[0].game_id}:`)));
});

test('live exact-play follow-up binds the literal ID and does not mistake its opponent code for an offense request', async () => {
  const split = await buildNflExampleEvidence({ domain: 'coaching', question: 'Compare NYG and KC third-down splits for 2025 Weeks 1–3.', teamId: 'NYG', comparisonTeamId: 'KC', weekStart: 1, weekEnd: 3, situation: 'third_down', coachingView: 'converted_failed' });
  const splitQuery = split.body.example_query as unknown as NflExampleArgs;
  const narrowed = await buildNflExampleEvidence({ ...splitQuery, question: 'Failures only, 7–10 yards, keep the same teams and weeks.', coachingFilters: { outcome: 'failed', minYardsToGo: 7, maxYardsToGo: 10 }, coachingView: 'review_queue' });
  assert.deepEqual(provenance(narrowed).team_aggregates.map(row => [row.team, row.plays]), [['NYG', 8], ['KC', 9]]);
  const previousQuery = narrowed.body.example_query as unknown as NflExampleArgs;
  const question = 'Inspect just 2025_01_NYG_WAS:940. What actually happened, what does the recorded text establish, and what would we need to inspect before changing the coaching plan?';
  const details = await raw('coaching-play-details');
  const original = details.plays.find((play: { game_id: string; play_id: number }) => play.game_id === '2025_01_NYG_WAS' && play.play_id === 940);
  for (const teamArgs of [{}, { comparisonTeamId: 'WAS' }, { teamId: 'WAS', comparisonTeamId: 'NYG' }]) {
    const inspected = await buildNflExampleEvidence({ ...previousQuery, ...teamArgs, question });
    assert.deepEqual(provenance(inspected).selected_play_ids, ['2025_01_NYG_WAS:940']);
    assert.equal(inspected.body.example_query?.question, question);
    assert.equal(inspected.body.example_query?.weekStart, 1);
    assert.equal(inspected.body.example_query?.weekEnd, 3);
    assert.deepEqual(inspected.body.example_query?.coachingFilters, { outcome: 'failed', minYardsToGo: 7, maxYardsToGo: 10, playIds: ['2025_01_NYG_WAS:940'] });
    assert.equal(inspected.body.example_query?.coachingView, 'review_queue');
    assert.ok(inspected.body.tables[0].rows.every(row => row[0] !== 'WAS'));
    const queue = (metadata(inspected).workflow as { review_queue: Array<{ evidence_id: string; description: string; posteam: string; defteam: string; down: number; ydstogo: number; yards_gained: number; outcome: string }> }).review_queue;
    assert.equal(queue.length, 1);
    assert.deepEqual([queue[0].posteam, queue[0].defteam, queue[0].down, queue[0].ydstogo, queue[0].yards_gained, queue[0].outcome], ['NYG', 'WAS', 3, 10, 8, 'failed']);
    assert.equal(queue[0].description, original.description);
    const recorded = inspected.body.key_findings.find(finding => finding.label === 'Recorded play · 2025_01_NYG_WAS:940')!;
    assert.ok(recorded.body.includes(original.description));
    assert.ok(inspected.body.key_findings.some(finding => finding.label === 'Next coaching question' && /Inspect film/.test(finding.body)));
  }
  const direct = await buildNflExampleEvidence({ domain: 'coaching', question });
  assert.deepEqual(provenance(direct).selected_play_ids, ['2025_01_NYG_WAS:940']);
});

test('literal ID inspection still rejects genuine unsupported offense requests and unknown identities without widening', async () => {
  for (const question of [
    'Inspect 2025_01_NYG_WAS:940 and compare Washington offense with the Giants.',
    'Inspect 2025_01_NYG_WAS:940, then show the WAS offense.',
    'Show the WAS offense in 2025 Weeks 1–3.',
  ]) {
    const answer = await buildNflExampleEvidence({ domain: 'coaching', question, teamId: 'NYG', comparisonTeamId: 'KC' });
    assert.equal(answer.sources.length, 0, question);
    assert.equal(answer.body.tables.length, 0);
    assert.match(answer.body.answer, /requested team is outside/);
  }
  for (const requestedId of ['2025_01_NYG_WAS:999999', '2025_01_NYG_WAS:', '2025_01_NYG_FAKE:940', '2025_99_NYG_WAS:940', '2025_01_NYG_WAS:940.1', '2025_01_NYG_WAS:940 and 2025_01_NYG_WAS:999999']) {
    const answer = await buildNflExampleEvidence({ domain: 'coaching', question: `Inspect just ${requestedId}.`, teamId: 'NYG', comparisonTeamId: 'KC' });
    assert.equal(answer.sources.length, 0, requestedId);
    assert.equal(answer.body.tables.length, 0);
    assert.match(answer.body.answer, /not captured.*No replacement plays/);
  }
  const unrelatedTeam = await buildNflExampleEvidence({ domain: 'coaching', question: 'Inspect just 2025_01_NYG_WAS:940.', teamId: 'NYG', comparisonTeamId: 'BUF' });
  assert.equal(unrelatedTeam.sources.length, 0, 'Only an opponent code actually encoded by the validated literal ID can be treated as a parser mistake');
  const unknownArgumentId = await buildNflExampleEvidence({ domain: 'coaching', question: 'Inspect just 2025_01_NYG_WAS:940.', teamId: 'NYG', comparisonTeamId: 'KC', coachingFilters: { playIds: ['2025_01_NYG_WAS:999999'] } });
  assert.equal(unknownArgumentId.sources.length, 0, 'An unknown argument ID must not be silently replaced by a known literal ID');
});

test('matched comparison retains only common down/distance/field-position cells and exposes unmatched exclusions', async () => {
  const answer = await buildNflExampleEvidence({ domain: 'coaching', question: 'Match NYG and KC third-down situations.', teamId: 'NYG', comparisonTeamId: 'KC', coachingView: 'matched_situations' });
  const workflow = metadata(answer).workflow as { matched_situations: { common_cells: Array<{ key: string; team_counts: Record<string, number>; play_ids: string[] }>; excluded_plays_without_shared_cell: number }; hypotheses: Array<{ status: string }> };
  const cells = workflow.matched_situations.common_cells;
  assert.ok(cells.length > 0);
  assert.ok(cells.every(cell => cell.team_counts.NYG > 0 && cell.team_counts.KC > 0));
  assert.deepEqual(provenance(answer).selected_play_ids.sort(), cells.flatMap(cell => cell.play_ids).sort());
  assert.equal(provenance(answer).counts.after_filters - provenance(answer).counts.after_matching, workflow.matched_situations.excluded_plays_without_shared_cell);
  assert.match(JSON.stringify(workflow.hypotheses), /Requires user or staff film charting/);
  assert.ok(answer.body.caveats.some(caveat => /score, personnel and player availability are not adjusted/.test(caveat)));
});

test('explicit matching of literal plays remains a matched comparison', async () => {
  const answer = await buildNflExampleEvidence({ domain:'coaching', question:'Match NYG 2025_01_NYG_WAS:940 and KC 2025_01_KC_LAC:1613 by down, distance and field position.', teamId:'NYG', comparisonTeamId:'KC', coachingView:'matched_situations', comparisonMode:'matched_down_distance_field_position' });
  assert.equal(answer.body.example_query?.comparisonMode,'matched_down_distance_field_position');
  assert.deepEqual(provenance(answer).selected_play_ids.sort(),['2025_01_KC_LAC:1613','2025_01_NYG_WAS:940']);
});

test('unknown fields, out-of-scope IDs and impossible requested windows refuse substitution', async () => {
  const invalid = [
    { coachingFilters: { pressure: true } },
    { coachingFilters: { distanceBuckets: ['deep'] } },
    { coachingFilters: { minYardsToGo: 10, maxYardsToGo: 2 } },
    { coachingFilters: { playIds: ['2025_99_NYG_KC:1'] } },
    { coachingFilters: { gameIds: ['2025_01_DAL_PHI'] }, teamId: 'NYG', comparisonTeamId: 'KC' },
    { coachingFilters: { reviewLimit: 0 } },
    { comparisonMode: 'pressure_adjusted' },
    { unknownMetric: 'EPA' },
  ];
  for (const options of invalid) {
    const answer = await buildNflExampleEvidence({ domain: 'coaching', question: 'Show the requested sample.', ...options } as NflExampleArgs);
    assert.equal(answer.body.tables.length, 0, JSON.stringify(options));
    assert.equal(answer.sources.length, 0);
  }
  const empty = await buildNflExampleEvidence({ domain: 'coaching', question: 'Show third downs with 99 yards to go.', situation: 'third_down', coachingFilters: { minYardsToGo: 99 } });
  assert.equal(provenance(empty).counts.after_filters, 0);
  assert.equal(empty.body.example_query?.situation, 'third_down');
  assert.ok(empty.body.caveats.some(caveat => /No plays satisfy this exact query/.test(caveat)));
});

test('executable workflow actions retain scope and run successfully', async () => {
  for (const domain of ['availability', 'coaching'] as const) {
    const answer = await buildNflExampleEvidence({ domain, question: domain === 'coaching' ? 'Compare NYG and KC Week 2 third downs.' : 'Show Thomas.', ...(domain === 'coaching' ? { teamId: 'NYG', comparisonTeamId: 'KC', weekStart: 2, weekEnd: 2 } : {}) });
    const actions = metadata(answer).followup_actions as Array<{ tool: string; args: NflExampleArgs }>;
    assert.equal(actions.length, 3);
    for (const action of actions) {
      assert.equal(action.tool, 'get_nfl_example_evidence');
      const result = await buildNflExampleEvidence(action.args);
      assert.ok(result.sources.length > 0, result.body.answer);
      if (domain === 'coaching') { assert.equal(result.body.example_query?.weekStart, 2); assert.equal(result.body.example_query?.weekEnd, 2); }
    }
  }
});
