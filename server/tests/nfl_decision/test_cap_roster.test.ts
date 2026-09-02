import assert from 'node:assert/strict';
import test from 'node:test';
import type { NflCapRosterDecisionRequest } from '@shared/types';
import { buildCapRosterDecision } from '../../src/nfl_decision/cap_roster.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';

async function fixtureRequest(overrides: Partial<NflCapRosterDecisionRequest> = {}) {
  const seed = structuredClone(await loadNflDemoSeed());
  seed.as_of_date = '2026-09-02T12:00:00.000Z';
  seed.retrieved_at = '2026-09-02T12:15:00.000Z';
  const request: NflCapRosterDecisionRequest = {
    team_id: 'NYG',
    target_relief_dollars: 12_000_000,
    protected_player_ids: ['nfl:NYG:brian-burns'],
    protected_position_groups: [],
    allowed_levers: ['hold', 'pre_june_cut', 'post_june_cut', 'trade'],
    ...overrides,
  };
  return buildCapRosterDecision(request, {
    data: { seed, source_mode: 'supabase_current_views', fallback_reason: null },
    generatedAt: new Date('2026-09-02T18:00:00.000Z'),
  });
}

test('cap roster branches use positive integer relief and reconcile components', async () => {
  const result = await fixtureRequest();
  assert.equal(result.schema_version, 'nfl_cap_roster_decision.v1');
  for (const branch of result.branches) {
    assert.equal(branch.total_relief_dollars, branch.actions.reduce((sum, action) => sum + action.relief_dollars, 0));
    assert.equal(branch.total_dead_money_dollars, branch.actions.reduce((sum, action) => sum + action.dead_money_dollars, 0));
    assert.equal(new Set(branch.actions.map((action) => action.player_id)).size, branch.actions.length);
    assert.ok(branch.actions.every((action) => Number.isSafeInteger(action.relief_dollars) && action.relief_dollars > 0));
    assert.ok(branch.actions.every((action) => action.rule_references.every((rule) => rule.locator && rule.authoritative_url)));
  }
  assert.equal(result.branches.flatMap((branch) => branch.actions).some((action) => action.player_name === 'Brian Burns'), false);
});

test('protected position groups never enter transaction branches', async () => {
  const result = await fixtureRequest({ protected_position_groups: ['OL'] });
  const transactions = result.branches.flatMap((branch) => branch.actions);
  assert.equal(transactions.some((action) => ['G', 'C', 'T', 'OT', 'OG', 'OL'].includes(action.position ?? '')), false);
});

test('impossible target returns supported maximum without false recommendation', async () => {
  const result = await fixtureRequest({ target_relief_dollars: 500_000_000 });
  const maximum = result.branches.find((branch) => branch.id === 'maximize_relief');
  assert.ok(maximum);
  assert.equal(maximum.target_met, false);
  assert.equal(maximum.status, 'insufficient_evidence');
  assert.equal(result.status, 'insufficient_evidence');
  assert.equal(result.recommended_branch_id, null);
});

test('manual assumptions stay labeled and stale fallback blocks recommendation', async () => {
  const seed = await loadNflDemoSeed();
  const result = await buildCapRosterDecision({
    team_id: 'NYG',
    target_relief_dollars: 1_000_000,
    protected_player_ids: [],
    protected_position_groups: [],
    allowed_levers: ['trade'],
    assumptions: [{ key: 'replacement_cost', label: 'Replacement cost', value: 2_000_000, source: 'user_entered' }],
  }, {
    data: { seed, source_mode: 'checked_in_snapshot_fallback', fallback_reason: 'database unavailable' },
    generatedAt: new Date('2026-09-02T18:00:00.000Z'),
  });
  assert.equal(result.assumptions[0]?.source, 'user_entered');
  assert.equal(result.status, 'blocked');
  assert.equal(result.recommended_branch_id, null);
});

