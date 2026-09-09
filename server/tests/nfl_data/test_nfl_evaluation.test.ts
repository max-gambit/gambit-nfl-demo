import assert from 'node:assert/strict';
import test from 'node:test';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import { buildNflOptionEvaluation, type NflEvaluationContext, type NflOptionEvaluationArgs, type TrustedNflEvaluationCost } from '../../src/nfl_evaluation/index.js';

const seed = await loadNflDemoSeed();
const context = (userText: string, rest: Partial<NflEvaluationContext> = {}): NflEvaluationContext => ({ seed, userText, receivedAt: '2026-09-09T15:00:00Z', ...rest });
const gradeText = 'Receiving: Loveland 9/10; Warren 7/10. Blocking: Loveland 5/10; Warren 9/10.';
const weightText = 'Use receiving 80% and blocking 20%.';
const weighted = (): NflOptionEvaluationArgs => ({ domain: 'college', role: 'two-way tight end', method: 'weighted', judgments: [
  { player_name: 'Loveland', criterion: 'receiving', value: 9, out_of: 10, quote: gradeText },
  { player_name: 'Warren', criterion: 'receiving', value: 7, out_of: 10, quote: gradeText },
  { player_name: 'Loveland', criterion: 'blocking', value: 5, out_of: 10, quote: gradeText },
  { player_name: 'Warren', criterion: 'blocking', value: 9, out_of: 10, quote: gradeText },
], rules: [{ criterion: 'receiving', weight: .8, quote: weightText }, { criterion: 'blocking', weight: .2, quote: weightText }] });

test('supplied weights determine the conditional preference and show exact sensitivity, separate from public stats', async () => {
  const result = await buildNflOptionEvaluation(weighted(), context(`${gradeText} ${weightText}`));
  assert.equal(result.evaluation.status, 'conditional_preference');
  assert.deepEqual(result.evaluation.preferred_player_names, ['Colston Loveland']);
  assert.deepEqual(result.evaluation.options.map(o => Math.round(o.weighted_score!)), [74, 82]);
  assert.equal(result.evaluation.executable, false);
  const weightFlip = result.evaluation.flips.find(f => f.kind === 'weight');
  assert.ok(weightFlip);
  assert.ok(Math.abs(weightFlip.value! - 2 / 3) < 1e-9);
  assert.match(weightFlip.condition, /Tyler Warren leads below/);
  assert.match(result.body.answer, /transparent arithmetic over user-supplied/);
  assert.match(result.body.caveats.join(' '), /No private Giants/);
});

test('a natural follow-up can change weights, inherit only validated grades and reverse the preference', async () => {
  const first = await buildNflOptionEvaluation(weighted(), context(`${gradeText} ${weightText}`));
  const update = 'Now receiving 20% and blocking 80%.';
  const next = await buildNflOptionEvaluation({ domain: 'college', role: 'two-way tight end', rules: [{ criterion: 'receiving', weight: .2, quote: update }, { criterion: 'blocking', weight: .8, quote: update }] }, context(update, { previous: first.evaluation.state }));
  assert.deepEqual(next.evaluation.preferred_player_names, ['Tyler Warren']);
  assert.deepEqual(next.evaluation.options.map(o => Math.round(o.weighted_score!)), [86, 58]);
  assert.equal(next.evaluation.state.query.judgments?.length, 4);
});

test('a single grade revision updates that observation and preserves other approved grades', async () => {
  const first = await buildNflOptionEvaluation(weighted(), context(`${gradeText} ${weightText}`));
  const update = 'Warren receiving 9/10.';
  const next = await buildNflOptionEvaluation({ domain: 'college', role: 'two-way tight end', judgments: [{ player_name: 'Warren', criterion: 'receiving', value: 9, out_of: 10, quote: update }] }, context(update, { previous: first.evaluation.state }));
  assert.deepEqual(next.evaluation.preferred_player_names, ['Tyler Warren']);
  assert.equal(next.evaluation.state.query.judgments?.length, 4);
});

test('changed objective and changed domain do not silently inherit grades, rules or method', async () => {
  const first = await buildNflOptionEvaluation(weighted(), context(`${gradeText} ${weightText}`));
  for (const args of [{ domain: 'college' as const, role: 'movement blocking' }, { domain: 'receiver' as const, role: 'two-way tight end' }]) {
    const next = await buildNflOptionEvaluation(args, context('Change the objective.', { previous: first.evaluation.state }));
    assert.equal(next.evaluation.method, 'public_tradeoffs');
    assert.deepEqual(next.evaluation.state.query.judgments, []);
    assert.deepEqual(next.evaluation.state.query.rules, []);
    assert.ok(next.evaluation.options.every(o => o.weighted_score == null));
  }
});

test('narrowing candidates retains only their previously approved grades', async () => {
  const first = await buildNflOptionEvaluation(weighted(), context(`${gradeText} ${weightText}`));
  const next = await buildNflOptionEvaluation({ domain: 'college', role: 'two-way tight end', player_names: ['Warren'] }, context('Just Warren.', { previous: first.evaluation.state }));
  assert.deepEqual(next.evaluation.preferred_player_names, ['Tyler Warren']);
  assert.equal(next.evaluation.state.query.judgments?.length, 2);
});

test('changed objective cannot resubmit old validated quotes absent from current user text', async () => {
  const first = await buildNflOptionEvaluation(weighted(), context(`${gradeText} ${weightText}`));
  const revised = { ...weighted(), role: 'movement blocking' };
  await assert.rejects(buildNflOptionEvaluation(revised, context('Now focus on movement blocking.', { previous: first.evaluation.state })), /not present in user-authored/);
  await assert.rejects(buildNflOptionEvaluation({ domain: 'receiver', role: 'outside receiving', rules: weighted().rules }, context('Switch to receivers.', { previous: first.evaluation.state })), /not present in user-authored/);
  const explicitlySuppliedAgain = await buildNflOptionEvaluation(revised, context(`For the changed objective use these inputs: ${gradeText} ${weightText}`, { previous: first.evaluation.state }));
  assert.equal(explicitlySuppliedAgain.evaluation.status, 'conditional_preference');
});

test('public-only comparison has descriptive tradeoffs, paired attributed limitations, sources, and no invented score', async () => {
  const result = await buildNflOptionEvaluation({ domain: 'college', role: 'detached receiving' }, context('Compare the historical tight ends as detached receivers.'));
  assert.equal(result.evaluation.status, 'public_shortlist');
  assert.deepEqual(result.evaluation.public_shortlist, ['Tyler Warren']);
  assert.deepEqual(result.evaluation.preferred_player_names, []);
  assert.ok(result.evaluation.options.every(o => o.weighted_score == null && !o.judgments.length));
  assert.match(result.body.answer, /does not value route skill, blocking/);
  assert.match(result.body.key_findings.map(f => f.body).join(' '), /man-coverage separation.*refinement/);
  assert.equal(result.evaluation.options[0].receiving_yards_per_game, 1233 / 16);
  assert.match(JSON.stringify(result.sources), /2025-04-22/);
  assert.match(JSON.stringify(result.sources), /41984087f4e832aa/);
});

test('UI evaluation block binds author and date but keeps supplied provenance unverified', async () => {
  const quote = '[Evaluation]\nPlayer: Colston Loveland\nAuthor: Illustrative demo model\nDate: 2026-09-09\nObservation: Receiving role 9/10; movement blocking 5/10.\n[/Evaluation]';
  const rules = 'Receiving role minimum 8/10.';
  const result = await buildNflOptionEvaluation({ domain: 'college', role: 'detached receiving', player_names: ['Loveland'], method: 'threshold', judgments: [{ player_name: 'Loveland', criterion: 'Receiving role', value: 9, out_of: 10, quote, author: 'Illustrative demo model', date: '2026-09-09' }], rules: [{ criterion: 'Receiving role', minimum: { value: 8, out_of: 10 }, quote: rules }] }, context(`${quote}\n${rules}`));
  assert.equal(result.evaluation.status, 'conditional_preference');
  assert.match(JSON.stringify(result.sources), /Illustrative demo model/);
  assert.match(JSON.stringify(result.sources), /user_supplied_unverified/);
  assert.equal(result.body.tables[1].rows[0][4], '2026-09-09');
});

test('missing metadata defaults explicitly to conversation and receipt date', async () => {
  const result = await buildNflOptionEvaluation(weighted(), context(`${gradeText} ${weightText}`));
  const row = result.body.tables[1].rows[0];
  assert.equal(row[3], 'Conversation supplied');
  assert.equal(row[4], '2026-09-09 received; evaluation date not supplied');
  assert.equal(row[5], 'User message');
});

test('two evaluation blocks keep each player’s author, date and source local', async () => {
  const warren = '[Evaluation]\nPlayer: Tyler Warren\nAuthor: Alice\nDate: 2026-09-01\nSource: Model A\nObservation: Receiving 7/10.\n[/Evaluation]';
  const loveland = '[Evaluation]\nPlayer: Colston Loveland\nAuthor: Bob\nDate: 2026-09-02\nSource: Model B\nObservation: Receiving 9/10.\n[/Evaluation]';
  const both = `${warren}\n${loveland}`;
  const base: NflOptionEvaluationArgs = { domain: 'college', role: 'receiving', judgments: [{ player_name: 'Loveland', criterion: 'receiving', value: 9, out_of: 10, quote: both, author: 'Bob', date: '2026-09-02', source: 'Model B' }] };
  const valid = await buildNflOptionEvaluation(base, context(both));
  assert.deepEqual(valid.body.tables[1].rows[0].slice(3), ['Bob', '2026-09-02', 'Model B']);
  for (const metadata of [{ author: 'Alice' }, { date: '2026-09-01' }, { source: 'Model A' }]) {
    for (const metadataQuote of [undefined, warren, both]) await assert.rejects(buildNflOptionEvaluation({ ...base, judgments: [{ ...base.judgments![0], ...metadata, ...(metadataQuote ? { metadata_quote: metadataQuote } : {}) }] }, context(both)), /this player’s block\/segment/);
  }
  const unscoped = 'Author: Alice; Date: 2026-09-01; Source: Model A';
  await assert.rejects(buildNflOptionEvaluation({ ...base, judgments: [{ ...base.judgments![0], author: 'Alice', date: '2026-09-01', source: 'Model A', metadata_quote: unscoped }] }, context(`${both}\n${unscoped}`)), /this player’s block\/segment/);
});

test('plain multi-player metadata stays local and explicitly shared metadata can apply to both', async () => {
  const plain = 'Warren receiving 7/10; Author: Alice; Date: 2026-09-01; Source: Model A. Loveland receiving 9/10; Author: Bob; Date: 2026-09-02; Source: Model B.';
  const base = { player_name: 'Loveland', criterion: 'receiving', value: 9, out_of: 10, quote: plain };
  await assert.rejects(buildNflOptionEvaluation({ domain: 'college', role: 'receiving', judgments: [{ ...base, author: 'Alice' }] }, context(plain)), /this player’s block\/segment/);
  const valid = await buildNflOptionEvaluation({ domain: 'college', role: 'receiving', judgments: [{ ...base, author: 'Bob', date: '2026-09-02', source: 'Model B' }] }, context(plain));
  assert.equal(valid.body.tables[1].rows[0][3], 'Bob');
  const shared = 'Shared metadata for all compared players:\nAuthor: Dana\nDate: 2026-09-03\nSource: Supplied report';
  const args = weighted(); args.judgments = args.judgments!.map(j => ({ ...j, author: 'Dana', date: '2026-09-03', source: 'Supplied report', metadata_quote: shared }));
  const result = await buildNflOptionEvaluation(args, context(`${gradeText} ${weightText}\n${shared}`));
  assert.ok(result.body.tables[1].rows.every(row => row[3] === 'Dana' && row[4] === '2026-09-03'));
});

test('live-shaped ordinary global metadata header works with full quotes or excerpts and survives a weight follow-up', async () => {
  const liveText = 'Compare Tyler Warren and Colston Loveland as historical draft prospects for a receiving role using my illustrative grades, not a verified Giants model. Source: supplied rehearsal model. Author: Max. Date: 2026-09-09. Grades use a 0–10 scale, higher is better. Colston Loveland: receiving 9/10, blocking 5/10. Tyler Warren: receiving 7/10, blocking 9/10. Weight receiving 80% and blocking 20%. Show the ranking, why it changes the decision, and what public evidence might challenge it.';
  for (const excerpt of [false, true]) {
    const args = weighted();
    args.judgments = args.judgments!.map(j => ({ ...j, quote: excerpt ? j.player_name === 'Loveland' ? 'Colston Loveland: receiving 9/10, blocking 5/10.' : 'Tyler Warren: receiving 7/10, blocking 9/10.' : liveText, author: 'Max', date: '2026-09-09', source: 'supplied rehearsal model', ...(excerpt ? { metadata_quote: 'Source: supplied rehearsal model. Author: Max. Date: 2026-09-09.' } : {}) }));
    args.rules = args.rules!.map(r => ({ ...r, quote: 'Weight receiving 80% and blocking 20%.' }));
    const first = await buildNflOptionEvaluation(args, context(liveText));
    assert.deepEqual(first.evaluation.preferred_player_names, ['Colston Loveland']);
    assert.ok(first.body.tables[1].rows.every(row => row[3] === 'Max' && row[4] === '2026-09-09' && row[5] === 'supplied rehearsal model'));
    assert.ok(first.evaluation.state.bound_quotes.includes(liveText));
    const update = 'Now receiving 20% and blocking 80%.';
    const next = await buildNflOptionEvaluation({ domain: 'college', role: args.role, rules: [{ criterion: 'receiving', weight: .2, quote: update }, { criterion: 'blocking', weight: .8, quote: update }] }, context(update, { previous: first.evaluation.state }));
    assert.deepEqual(next.evaluation.preferred_player_names, ['Tyler Warren']);
    assert.ok(next.body.tables[1].rows.every(row => row[3] === 'Max' && row[4] === '2026-09-09'));
    await assert.rejects(buildNflOptionEvaluation({ ...args, role: 'different objective' }, context('Use a different objective.', { previous: first.evaluation.state })), /not present in user-authored/);
  }
});

test('a player-specific or repeated metadata header cannot masquerade as ordinary global metadata', async () => {
  const cases = [
    { text: 'Warren: Author: Alice. Source: Model A. Loveland receiving 9/10. Warren receiving 7/10.', metadata_quote: 'Author: Alice. Source: Model A.' },
    { text: 'Author: Alice. Warren receiving 7/10. Author: Bob. Loveland receiving 9/10.', metadata_quote: 'Author: Alice.' },
    { text: '[Evaluation]\nPlayer: Warren\nAuthor: Alice\nReceiving 7/10.\n[/Evaluation]\n[Evaluation]\nPlayer: Loveland\nReceiving 9/10.\n[/Evaluation]', metadata_quote: 'Author: Alice' },
  ];
  for (const row of cases) await assert.rejects(buildNflOptionEvaluation({ domain: 'college', role: 'receiving', judgments: [{ player_name: 'Loveland', criterion: 'receiving', value: 9, out_of: 10, quote: row.text, author: 'Alice', metadata_quote: row.metadata_quote }] }, context(row.text)), /this player’s block\/segment/);
});

test('live receiver shared-heading grades and separate weight/minimum occurrences resolve from literal input', async () => {
  const liveText = 'Use these illustrative grades to decide whom to investigate for the outside receiving role. Source: supplied rehearsal evaluation. Author: Max. Date: 2026-09-09. Outside receiving: Jakobi Meyers 9/10; Courtland Sutton 8/10; Christian Kirk 5/10; Darnell Mooney 6/10; Darius Slayton 7/10. Higher is better. Weight outside receiving 100%; outside receiving minimum 8/10. Does this change the public shortlist? Keep availability, price and the Slayton contract conflict unresolved.';
  const sharedHeading = 'Outside receiving: Jakobi Meyers 9/10; Courtland Sutton 8/10; Christian Kirk 5/10; Darnell Mooney 6/10; Darius Slayton 7/10.';
  const entries = [['Jakobi Meyers', 9], ['Courtland Sutton', 8], ['Christian Kirk', 5], ['Darnell Mooney', 6], ['Darius Slayton', 7]] as const;
  for (const quoteMode of ['full', 'heading', 'short', 'paraphrase']) {
    const args: NflOptionEvaluationArgs = { domain: 'receiver', role: 'outside receiving', player_names: entries.map(([name]) => name), method: 'weighted', judgments: entries.map(([name, value]) => ({ player_name: name, criterion: 'outside receiving', value, out_of: 10, quote: quoteMode === 'full' ? liveText : quoteMode === 'heading' ? sharedHeading : quoteMode === 'short' ? `${name} ${value}/10` : `${name}'s outside receiving grade is ${value} out of 10`, author: 'Max', source: 'supplied rehearsal evaluation', date: '2026-09-09', metadata_quote: 'Source: supplied rehearsal evaluation. Author: Max. Date: 2026-09-09.' })), rules: [{ criterion: 'outside receiving', weight: 1, minimum: { value: 8, out_of: 10 }, quote: quoteMode === 'paraphrase' ? 'Use 100% outside receiving with an 8/10 floor' : 'Weight outside receiving 100%; outside receiving minimum 8/10.' }] };
    const result = await buildNflOptionEvaluation(args, context(liveText));
    assert.deepEqual(result.evaluation.preferred_player_names, ['Jakobi Meyers']);
    assert.deepEqual(result.evaluation.options.map(o => o.threshold_status), ['passes', 'passes', 'fails', 'fails', 'fails']);
    assert.deepEqual(result.evaluation.options.map(o => o.weighted_score), [90, 80, 50, 60, 70]);
    assert.ok(result.evaluation.options.every(o => o.incoming_cap == null));
    assert.equal(result.evaluation.options.find(o => o.player_name === 'Darius Slayton')!.last_active_contract_year, null);
    assert.equal(result.evaluation.executable, false);
    assert.ok(result.evaluation.state.query.judgments!.every(j => liveText.includes(j.quote)));
    assert.ok(liveText.includes(result.evaluation.state.query.rules![0].quote));
    assert.ok(result.body.tables[1].rows.every(row => row[3] === 'Max' && row[4] === '2026-09-09'));
    await assert.rejects(buildNflOptionEvaluation({ ...args, judgments: [{ ...args.judgments![0], value: 10 }] }, context(liveText)), /same literal user score/);
  }
});

test('current grade conflicts and differing revisions cannot hide behind a shorter or previously approved quote', async () => {
  const conflicting = 'Receiving: Warren 8/10; Loveland 9/10. Warren receiving 7/10.';
  await assert.rejects(buildNflOptionEvaluation({ domain: 'college', role: 'receiving', judgments: [{ player_name: 'Warren', criterion: 'receiving', value: 8, out_of: 10, quote: 'Receiving: Warren 8/10' }] }, context(conflicting)), /Conflicting grades/);
  const first = await buildNflOptionEvaluation(weighted(), context(`${gradeText} ${weightText}`));
  await assert.rejects(buildNflOptionEvaluation({ domain: 'college', role: 'two-way tight end', judgments: [{ player_name: 'Warren', criterion: 'receiving', value: 7, out_of: 10, quote: gradeText }] }, context('Warren receiving 8/10.', { previous: first.evaluation.state })), /current message supplies a different value/);
});

test('conflicting repeated criterion rules are rejected even when a short quote selects one', async () => {
  for (const text of ['Receiving weight 80%. Receiving weight 20%.', 'Receiving minimum 8/10. Receiving minimum 6/10.']) {
    const rule = text.includes('weight') ? { criterion: 'receiving', weight: .8, quote: 'Receiving weight 80%.' } : { criterion: 'receiving', minimum: { value: 8, out_of: 10 }, quote: 'Receiving minimum 8/10.' };
    await assert.rejects(buildNflOptionEvaluation({ domain: 'college', role: 'receiving', rules: [rule] }, context(text)), /Conflicting rules/);
  }
});

test('missing candidate grade prevents a complete preference and does not redistribute weights', async () => {
  const args = weighted(); args.judgments = args.judgments!.slice(0, 3);
  const result = await buildNflOptionEvaluation(args, context(`${gradeText} ${weightText}`));
  assert.equal(result.evaluation.status, 'needs_input');
  assert.deepEqual(result.evaluation.preferred_player_names, []);
  assert.equal(result.evaluation.options.find(o => o.player_name === 'Tyler Warren')!.weighted_score, null);
  assert.ok(result.evaluation.flips.some(f => f.kind === 'missing_input' && f.player_name === 'Tyler Warren'));
});

test('threshold selection and floor relaxation change eligibility with a literal flip target', async () => {
  const floor = 'Blocking minimum 8/10.';
  const args = { ...weighted(), method: 'threshold' as const, rules: [{ criterion: 'blocking', minimum: { value: 8, out_of: 10 }, quote: floor }] };
  const first = await buildNflOptionEvaluation(args, context(`${gradeText} ${floor}`));
  assert.deepEqual(first.evaluation.preferred_player_names, ['Tyler Warren']);
  assert.equal(first.evaluation.flips.find(f => f.kind === 'threshold')!.value, 8);
  const lower = 'Blocking minimum 5/10.';
  const second = await buildNflOptionEvaluation({ domain: 'college', role: 'two-way tight end', rules: [{ criterion: 'blocking', minimum: { value: 5, out_of: 10 }, quote: lower }] }, context(lower, { previous: first.evaluation.state }));
  assert.equal(second.evaluation.status, 'tie');
  assert.equal(second.evaluation.preferred_player_names.length, 2);
});

test('grade identity binding rejects cross-player numbers, fabricated values, scales and missing criterion scores', async () => {
  const cases = [
    { quote: 'Receiving: Loveland 9/10; Warren 7/10.', player_name: 'Warren', criterion: 'receiving', value: 9, out_of: 10 },
    { quote: 'Warren receiving 8/10.', player_name: 'Warren', criterion: 'receiving', value: 9, out_of: 10 },
    { quote: 'Warren receiving 8/10.', player_name: 'Warren', criterion: 'receiving', value: 8, out_of: 100 },
    { quote: 'Warren receiving not recorded; blocking 8/10.', player_name: 'Warren', criterion: 'receiving', value: 8, out_of: 10 },
  ];
  for (const j of cases) await assert.rejects(buildNflOptionEvaluation({ domain: 'college', role: 'receiving', judgments: [j] }, context(j.quote)), /same literal user score/);
  await assert.rejects(buildNflOptionEvaluation(weighted(), context('No grades supplied.')), /not present in user-authored/);
});

test('fabricated author, date and source cannot be attached to genuine user grades', async () => {
  for (const metadata of [{ author: 'Giants scouting department' }, { date: '2026-01-01' }, { source: 'Private model' }]) {
    const args = weighted(); args.judgments = [{ ...args.judgments![0], ...metadata }];
    await assert.rejects(buildNflOptionEvaluation(args, context(`${gradeText} ${weightText}`)), /explicitly supplied|evaluation date/);
  }
});

test('fabricated or incomplete weights and implicit thresholds are rejected', async () => {
  const args = weighted(); args.rules![0].weight = .9;
  await assert.rejects(buildNflOptionEvaluation(args, context(`${gradeText} ${weightText}`)), /weight must match/);
  const incomplete = weighted(); incomplete.rules = incomplete.rules!.slice(0, 1);
  await assert.rejects(buildNflOptionEvaluation(incomplete, context(`${gradeText} ${weightText}`)), /total one hundred/);
  const implicit = weighted(); implicit.method = 'threshold'; implicit.rules = [{ criterion: 'receiving', minimum: { value: 9, out_of: 10 }, quote: gradeText }];
  await assert.rejects(buildNflOptionEvaluation(implicit, context(gradeText)), /explicit minimum/);
  const crossed = 'Receiving minimum unresolved; blocking 8/10.';
  await assert.rejects(buildNflOptionEvaluation({ domain: 'college', role: 'receiving', method: 'threshold', rules: [{ criterion: 'receiving', minimum: { value: 8, out_of: 10 }, quote: crossed }] }, context(crossed)), /literal criterion minimum/);
});

test('medical likelihoods cannot be relabeled as team fit scores', async () => {
  const quote = 'Warren injury risk 8/10; receiving 8/10.';
  for (const criterion of ['injury risk', 'receiving']) await assert.rejects(buildNflOptionEvaluation({ domain: 'college', role: 'tight end', judgments: [{ player_name: 'Warren', criterion, value: 8, out_of: 10, quote }] }, context(quote)), /medical|Medical/);
});

test('repairing a role-grade quote does not turn a separate medical caveat into a graded medical claim', async () => {
  const text = 'Warren receiving 8/10. Keep injury uncertainty unresolved.';
  const result = await buildNflOptionEvaluation({ domain: 'college', role: 'tight end', player_names: ['Warren'], judgments: [{ player_name: 'Warren', criterion: 'receiving', value: 8, out_of: 10, quote: 'Warren has a receiving grade of 8 out of 10' }] }, context(text));
  assert.equal(result.evaluation.state.query.judgments![0].quote, text);
  assert.equal(result.evaluation.executable, false);
});

const costFor = (player_name: string, incoming_cap: number, status: TrustedNflEvaluationCost['status'] = 'conditional'): TrustedNflEvaluationCost => ({ origin: 'contract_scenario', player_name, team_id: 'NYG', season: Number.parseInt(seed.season, 10), incoming_cap, status, acquisition_path: 'trade', source_id: 'test-root-scenario', as_of: '2026-09-09T14:00:00Z', conditions: ['Hypothetical acquired contract; consent and availability unverified.'] });

test('unknown incoming price is not zero; only compatible root cost can pass a cap ceiling', async () => {
  const text = 'Sutton receiving 8/10. Receiving minimum 7/10. Incoming cap maximum $5 million.';
  const args: NflOptionEvaluationArgs = { domain: 'receiver', role: 'outside receiving', player_names: ['Courtland Sutton'], method: 'threshold', judgments: [{ player_name: 'Sutton', criterion: 'receiving', value: 8, out_of: 10, quote: 'Sutton receiving 8/10.' }], rules: [{ criterion: 'receiving', minimum: { value: 7, out_of: 10 }, quote: 'Receiving minimum 7/10.' }], constraints: { max_incoming_cap: 5_000_000, quote: 'Incoming cap maximum $5 million.' } };
  const unknown = await buildNflOptionEvaluation(args, context(text));
  assert.equal(unknown.evaluation.status, 'needs_input');
  assert.equal(unknown.evaluation.options[0].incoming_cap, null);
  const cheap = await buildNflOptionEvaluation(args, context(text, { trustedCosts: [costFor('Courtland Sutton', 4_000_000)] }));
  assert.equal(cheap.evaluation.status, 'conditional_preference');
  assert.equal(cheap.evaluation.options[0].incoming_cap, 4_000_000);
  assert.equal(cheap.evaluation.executable, false);
  const expensive = await buildNflOptionEvaluation(args, context(text, { trustedCosts: [costFor('Courtland Sutton', 7_000_000)] }));
  assert.equal(expensive.evaluation.status, 'no_eligible_option');
  assert.equal(expensive.evaluation.flips.find(f => f.kind === 'price')!.value, 5_000_000);
  const blocked = await buildNflOptionEvaluation(args, context(text, { trustedCosts: [costFor('Courtland Sutton', 0, 'blocked')] }));
  assert.equal(blocked.evaluation.options[0].incoming_cap, null);
  await assert.rejects(buildNflOptionEvaluation(args, context(text, { trustedCosts: [{ ...costFor('Courtland Sutton', 0), season: 2024 }] })), /Invalid trusted/);
  await assert.rejects(buildNflOptionEvaluation({ ...args, incoming_cap: 0 } as NflOptionEvaluationArgs, context(text)), /Invalid evaluation fields/);
});

test('internal-only scope removes outside names without inventing a current internal role assignment', async () => {
  const quote = 'Use internal only.';
  const result = await buildNflOptionEvaluation({ domain: 'receiver', role: 'receiving coverage', player_names: ['Courtland Sutton', 'Malik Nabers'], constraints: { internal_only: true, quote } }, context(quote));
  assert.equal(result.evaluation.options.find(o => o.player_name === 'Courtland Sutton')!.threshold_status, 'fails');
  assert.deepEqual(result.evaluation.public_shortlist, ['Malik Nabers']);
  assert.match(result.evaluation.options.find(o => o.player_name === 'Malik Nabers')!.path, /current assignment unresolved/);
});

test('cap equality fails strict under/below and passes inclusive at-most/ceiling', async () => {
  for (const [phrase, operator, status] of [['under', 'lt', 'no_eligible_option'], ['below', 'lt', 'no_eligible_option'], ['at most', 'lte', 'public_shortlist'], ['ceiling', 'lte', 'public_shortlist']] as const) {
    const quote = `Incoming cap ${phrase} $5 million.`;
    const args: NflOptionEvaluationArgs = { domain: 'receiver', role: 'outside receiving', player_names: ['Courtland Sutton'], constraints: { max_incoming_cap: 5_000_000, quote } };
    const result = await buildNflOptionEvaluation(args, context(quote, { trustedCosts: [costFor('Courtland Sutton', 5_000_000)] }));
    assert.equal(result.evaluation.status, status);
    assert.equal(result.evaluation.state.query.constraints!.max_incoming_cap_operator, operator);
    if (operator === 'lt') {
      assert.match(result.evaluation.flips.find(f => f.kind === 'price')!.condition, /below \$5,000,000/);
      const next = await buildNflOptionEvaluation({ domain: 'receiver', role: 'outside receiving' }, context('Recheck with the revised cost.', { previous: result.evaluation.state, trustedCosts: [costFor('Courtland Sutton', 4_999_999)] }));
      assert.equal(next.evaluation.status, 'public_shortlist');
      await assert.rejects(buildNflOptionEvaluation({ ...args, constraints: { ...args.constraints!, max_incoming_cap_operator: 'lte' } }, context(quote)), /comparison operator must match/);
    }
  }
});
