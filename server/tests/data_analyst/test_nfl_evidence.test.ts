import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNflTradeGoalScreen,
  buildCurrentNflEvidence,
  currentNflEvidenceScopeForQuestion,
  currentNflEvidenceTeamIds,
  currentNflEvidenceToDataAnalystTrace,
  extractNflTeamIds,
  scoreNflTradeTargetMotivation,
} from '../../src/claude/nfl_evidence.js';
import { reserveGeneratedSourceRefs } from '../../src/claude/nba_evidence.js';
import { loadCurrentNflData } from '../../src/nfl_data/seed.js';

const SAMPLE_PROMPT = 'Audit the Giants offseason roster. Which position groups look over- or under-invested by 2026 cap number, and where is the data incomplete?';
const TRADE_GOAL_PROMPT = 'We are the Giants. Our goal is to add interior pass-rush juice without creating a 2027 cap problem. Use the current roster and cap data to give me three trade constructions: one salary-out move, one pick-led move, and one stay-disciplined/no-trade path.';

test('NFL evidence detection resolves the sample audit prompt to NYG transaction data', () => {
  assert.equal(currentNflEvidenceScopeForQuestion(SAMPLE_PROMPT), 'transaction_full');
  assert.deepEqual(currentNflEvidenceTeamIds(SAMPLE_PROMPT), ['NYG']);
});

test('NFL evidence extraction does not treat common lowercase words as team abbreviations', () => {
  assert.deepEqual(extractNflTeamIds('No cap room left?'), []);
  assert.deepEqual(extractNflTeamIds('was the cap ledger updated?'), []);
  assert.deepEqual(extractNflTeamIds('Does WAS have cap room?'), ['WAS']);
  assert.deepEqual(extractNflTeamIds('Does NO have cap room?'), ['NO']);
});

test('NFL evidence block uses full NYG app roster and cap data ahead of Intel', async () => {
  const evidence = await buildCurrentNflEvidence(SAMPLE_PROMPT);

  assert.ok(evidence);
  assert.equal(evidence.team_ids[0], 'NYG');
  assert.equal(evidence.scope, 'transaction_full');
  assert.match(evidence.systemBlock, /CURRENT NFL APP EVIDENCE \(MANDATORY\)/);
  assert.match(evidence.systemBlock, /Roster rows: 92/);
  assert.match(evidence.systemBlock, /Cap rows: 92/);
  assert.match(evidence.systemBlock, /Source-needed cap rows: 0/);
  assert.match(evidence.systemBlock, /Contract field coverage: guarantees=91\/92; dead\/cut=92\/92; post-June=92\/92; trade=92\/92; contract_years=92\/92; void_years=92\/92/);
  assert.match(evidence.systemBlock, /current NFL player metrics/);
  assert.match(evidence.systemBlock, /Player metric coverage: captured_public_metrics=72\/92; strong_position_scorecards=43\/92/);
  assert.match(evidence.systemBlock, /Top position scorecards:/);
  assert.match(evidence.systemBlock, /Player Quality Metrics v3 is position-specific evidence/);
  assert.match(evidence.systemBlock, /post_june_cut_savings=/);
  assert.match(evidence.systemBlock, /trade_savings=/);
  assert.match(evidence.systemBlock, /evidence_quality=high confidence/);
  assert.match(evidence.systemBlock, /evidence_quality_counts\(/);
  assert.match(evidence.systemBlock, /Position-group cap rollups:/);
  assert.match(evidence.systemBlock, /NFL coverage matrix/);
  assert.match(evidence.systemBlock, /Question readiness:/);
  assert.match(evidence.systemBlock, /player_quality=strong/);
  assert.match(evidence.systemBlock, /current NFL roster\/cap file is authoritative/i);
  assert.match(evidence.systemBlock, /Intel\/context graph is lower-precedence posture context only/i);
  assert.match(evidence.systemBlock, /Visible answer style/i);
  assert.match(evidence.systemBlock, /Do not say the Giants have only 4 rostered players/i);
  assert.match(evidence.systemBlock, /cap audit is blocked on ingestion/i);
  assert.match(evidence.systemBlock, /Rows needing source review/i);
  assert.doesNotMatch(evidence.systemBlock, /confidence=captured/i);
  assert.doesNotMatch(evidence.systemBlock, /source=source-needed/i);
  assert.doesNotMatch(evidence.systemBlock, /data-completeness failure/i);
  assert.doesNotMatch(evidence.systemBlock, /contract years\/guarantees not exposed/i);
});

test('NFL evidence reserves app roster and cap source cards before generated refs', async () => {
  const evidence = await buildCurrentNflEvidence(SAMPLE_PROMPT);
  assert.ok(evidence);

  const datasetRows = evidence.sources.map((source) => {
    const rows = source.data?.rows;
    if (!Array.isArray(rows)) return null;
    const dataset = rows.find((row) => row && typeof row === 'object' && 'k' in row && row.k === 'Dataset');
    return dataset && typeof dataset === 'object' && 'v' in dataset ? String(dataset.v) : null;
  });

  assert.deepEqual(datasetRows, ['nfl_rosters_current', 'nfl_cap_sheets_current', 'nfl_player_metrics_current', 'nfl_coverage_current']);
  assert.equal(evidence.reserved_max_ref_index, 4);

  const generated = reserveGeneratedSourceRefs([{
    ref_index: 1,
    kind: 'NEWS',
    source: 'MODEL',
    title: 'Generated source',
    updated_at: null,
    data: null,
  }], evidence.reserved_max_ref_index);

  assert.equal(generated[0].ref_index, 5);
});

test('NFL evidence produces chat trust-trail datasets for roster and cap preloads', async () => {
  const evidence = await buildCurrentNflEvidence(SAMPLE_PROMPT, { consumer: 'chat' });
  assert.ok(evidence);

  const trace = currentNflEvidenceToDataAnalystTrace(evidence, 'preloaded_current_nfl_evidence_test');
  assert.equal(trace.tool_name, 'query_nfl_data');
  assert.deepEqual(trace.datasets.map((dataset) => dataset.dataset_id), [
    'nfl_rosters_current',
    'nfl_cap_sheets_current',
    'nfl_player_metrics_current',
    'nfl_coverage_current',
  ]);
  assert.deepEqual(trace.datasets[0].team_ids, ['NYG']);
  assert.equal(trace.datasets[0].row_count, 92);
  assert.equal(trace.datasets[1].row_count, 92);
  assert.equal(trace.datasets[2].row_count, 92);
  assert.equal(trace.datasets[3].team_ids.includes('NYG'), true);
});

test('NFL trade-goal evidence adds depth hierarchy target lanes and caveat cleanup', async () => {
  const evidence = await buildCurrentNflEvidence(TRADE_GOAL_PROMPT);

  assert.ok(evidence);
  assert.equal(evidence.team_ids[0], 'NYG');
  assert.equal(evidence.reserved_max_ref_index, 6);
  assert.match(evidence.systemBlock, /trade-goal checks/i);
  assert.match(evidence.systemBlock, /Depth-after-trade checks:/);
  assert.match(evidence.systemBlock, /Lower-pain outgoing hierarchy:/);
  assert.match(evidence.systemBlock, /Seller thesis cards:/);
  assert.match(evidence.systemBlock, /Counterparty seller screen:/);
  assert.doesNotMatch(evidence.systemBlock, /motivation_tier=/);
  assert.match(evidence.systemBlock, /recommended_action=/);
  assert.match(evidence.systemBlock, /Seller case:/);
  assert.match(evidence.systemBlock, /Seller objection:/);
  assert.match(evidence.systemBlock, /What they lose:/);
  assert.match(evidence.systemBlock, /Validate availability:/);
  assert.match(evidence.systemBlock, /Bad cap-relief\/non-core guardrails:/);
  assert.match(evidence.systemBlock, /Greg Newsome II/);
  assert.match(evidence.systemBlock, /Jon Runyan/);
  assert.match(evidence.systemBlock, /Paulson Adebo/);
  assert.match(evidence.systemBlock, /Jevon Holland/);
  assert.match(evidence.systemBlock, /Brian Burns .*bad 2026 cap-relief trade/i);
  assert.match(evidence.systemBlock, /Andrew Thomas .*bad 2026 cap-relief trade/i);
  assert.match(evidence.systemBlock, /(Vita Vea|Grover Stewart|A'Shawn Robinson|Harrison Phillips|Tedarrell Slaton)/);
  assert.match(evidence.systemBlock, /Vita Vea .*recommended_action=posture_change_only/i);
  assert.match(evidence.systemBlock, /Do not headline Vita Vea as the best lane unless Tampa's posture flips/i);
  assert.doesNotMatch(evidence.systemBlock, /Vita Vea[^\n]+highest-confidence lane/i);
  assert.doesNotMatch(evidence.systemBlock, /Burns .*needs source review/i);

  const datasets = evidence.sources.map((source) => {
    const rows = source.data?.rows;
    if (!Array.isArray(rows)) return null;
    const dataset = rows.find((row) => row && typeof row === 'object' && 'k' in row && row.k === 'Dataset');
    return dataset && typeof dataset === 'object' && 'v' in dataset ? String(dataset.v) : null;
  });
  assert.deepEqual(datasets, ['nfl_rosters_current', 'nfl_cap_sheets_current', 'nfl_player_metrics_current', 'nfl_coverage_current', 'nfl_trade_screen_current', 'nfl_context_graph']);
  assert.equal(evidence.trace_datasets.some((dataset) => dataset.dataset_id === 'nfl_coverage_current' && dataset.team_ids.includes('NYG')), true);
  assert.equal(evidence.trace_datasets.some((dataset) => dataset.dataset_id === 'nfl_trade_screen_current' && dataset.team_ids.includes('NYG')), true);
  assert.equal(evidence.trace_datasets.some((dataset) => dataset.dataset_id === 'nfl_context_graph' && dataset.team_ids.includes('NYG') && dataset.team_ids.includes('TB')), true);
});

test('NFL trade motivation scorer tiers the same target profile by counterparty posture', () => {
  const base = {
    subject_team_id: 'NYG',
    target_team_id: 'TB',
    player_name: 'Example DT',
    position: 'DT',
    cap_number_2026: 12_000_000,
    trade_savings_2026: 8_000_000,
    contract_years_remaining: 1,
    contract_lever: 'cut_candidate',
    target_rank_in_group: 4,
    seller_group_depth_after: 10,
    seller_posture: 'asset_accumulator',
    preferred_deal_archetypes: ['Draft-capital-for-veteran-player trades'],
    frequent_partners: [],
    intel_confidence: 'high',
    generic_intel: false,
  };

  assert.equal(scoreNflTradeTargetMotivation({
    ...base,
    intel_posture: 'retool',
    intel_cap_status: 'restructure_needed',
  }).tier, 'credible_call');

  assert.equal(scoreNflTradeTargetMotivation({
    ...base,
    intel_posture: 'contend_soon',
    intel_cap_status: 'near_cap',
    target_rank_in_group: 1,
    contract_lever: 'restructure_candidate',
  }).tier, 'long_shot_unless_posture_changes');

  assert.equal(scoreNflTradeTargetMotivation({
    ...base,
    intel_posture: 'retool',
    intel_cap_status: 'restructure_needed',
    intel_confidence: 'medium',
    generic_intel: true,
  }).tier, 'monitor_only');
});

test('NFL fused trade screen exposes structured target lanes and downgrades cap-fit-only targets', async () => {
  const seed = await loadCurrentNflData();
  const screen = await buildNflTradeGoalScreen(seed, 'NYG', TRADE_GOAL_PROMPT);

  assert.ok(screen);
  assert.ok(screen.counterparty_intel_team_ids.includes('NYG'));
  assert.ok(screen.counterparty_intel_team_ids.includes('TB'));
  const vea = screen.target_lanes.find((lane) => lane.target_team_id === 'TB' && lane.target_player_name === 'Vita Vea');
  assert.ok(vea);
  assert.equal(vea.motivation_tier, 'long_shot_unless_posture_changes');
  assert.equal(vea.recommended_action, 'posture_change_only');
  assert.match(vea.seller_depth_consequence, /DL after trade/);
  assert.ok(vea.reasons.some((reason) => /expiring/i.test(reason)));
  assert.ok(vea.blockers.some((blocker) => /contend|core|top-priced|top-of-room/i.test(blocker)));
  assert.match(vea.seller_case, /high-impact, low-probability target/i);
  assert.match(vea.seller_objection, /Do not headline Vita Vea/i);
  assert.match(vea.what_they_lose, /DL|top|interior/i);
  assert.match(vea.validation_trigger, /Confirm whether Tampa is protecting/i);
  assert.ok(screen.named_target_lanes.some((line) => /recommended_action=posture_change_only/.test(line)));
  assert.equal(screen.named_target_lanes.some((line) => /motivation_tier=/.test(line)), false);
  assert.equal(screen.named_target_lanes.some((line) => /highest-confidence lane/i.test(line)), false);
});

test('NFL trade target lanes honor requested position instead of defaulting to pass rush', async () => {
  const seed = await loadCurrentNflData();
  const receiverScreen = await buildNflTradeGoalScreen(
    seed,
    'NYG',
    'We are the Giants and need a wide receiver trade target without adding 2027 money.',
  );
  const genericScreen = await buildNflTradeGoalScreen(
    seed,
    'NYG',
    'We are the Giants. Build trade constructions without naming a position group yet.',
  );

  assert.ok(receiverScreen);
  assert.equal(receiverScreen.target_lanes.every((lane) => lane.position === 'WR'), true);
  assert.equal(receiverScreen.named_target_lanes.some((line) => /\b(Vita Vea|Harrison Phillips|Grover Stewart)\b/.test(line)), false);
  assert.ok(genericScreen);
  assert.deepEqual(genericScreen.target_lanes, []);
  assert.match(genericScreen.named_target_lanes[0] ?? '', /No named target lane passed/);
});
