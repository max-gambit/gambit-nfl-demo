import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import { analyzeNflTransactionMarketSnapshot } from '../../src/nfl_transactions/analyze.js';
import {
  parseNflSellerMoveTurn,
  resolveNflSellerMoveConversationTurn,
} from '../../src/nfl_transactions/seller_move_conversation.js';
import { loadReviewedNflTransactionSnapshot } from '../../src/nfl_transactions/seed.js';

const GENERATED_AT = '2026-09-03T16:00:00.000Z';

test('a market-analysis continuation resolves a full Giants seller proposal', async () => {
  const fixture = await liveFixture();
  const turn = parseNflSellerMoveTurn('What if we moved Brian Burns for a 2027 second?', null);
  assert(turn);
  const artifact = resolveNflSellerMoveConversationTurn(turn, fixture.market, null, fixture.seed, fixture.snapshot, GENERATED_AT);

  assert.equal(artifact.status, 'answered');
  assert.equal(artifact.result?.player.player_name, 'Brian Burns');
  assert.equal(artifact.result?.player.position_group, 'EDGE');
  assert.equal(artifact.result?.proposal.pick_year, 2027);
  assert.equal(artifact.result?.proposal.pick_round, 2);
  assert(artifact.result?.comparables.length);
});

test('round-only continuation changes the proposal and market evidence but not player-dependent figures', async () => {
  const fixture = await liveFixture();
  const initial = answer(fixture, 'What if we moved Brian Burns for a 2027 second?', null);
  const updated = answer(fixture, 'Make it a first.', initial.scenario);

  assert.equal(updated.result!.proposal.pick_round, 1);
  assert.notEqual(updated.result!.proposal.label, initial.result!.proposal.label);
  assert.notDeepEqual(updated.result!.comparables, initial.result!.comparables);
  assert.deepEqual(updated.result!.cap, initial.result!.cap);
  assert.deepEqual(updated.result!.depth, initial.result!.depth);
  assert.notEqual(updated.result!.market.range_label, initial.result!.market.range_label);
});

test('player-only continuation preserves the pick and updates contract and depth facts', async () => {
  const fixture = await liveFixture();
  const initial = answer(fixture, 'What if we moved Brian Burns for a 2027 second?', null);
  const updated = answer(fixture, 'What about Thibodeaux instead?', initial.scenario);

  assert.equal(updated.result!.player.player_name, 'Kayvon Thibodeaux');
  assert.deepEqual(updated.result!.proposal, initial.result!.proposal);
  assert.notDeepEqual(updated.result!.cap, initial.result!.cap);
  assert.notDeepEqual(updated.result!.depth, initial.result!.depth);
  assert.equal(updated.result!.cap.next_year, null);
});

test('year-only continuation preserves the player and round', async () => {
  const fixture = await liveFixture();
  const initial = answer(fixture, 'What if we moved Brian Burns for a 2027 second?', null);
  const updated = answer(fixture, 'Use 2028.', initial.scenario);

  assert.equal(updated.result!.proposal.pick_year, 2028);
  assert.equal(updated.result!.proposal.pick_round, 2);
  assert.equal(updated.result!.player.player_id, initial.result!.player.player_id);
});

test('incomplete and unknown-player proposals ask one concise clarification', async () => {
  const fixture = await liveFixture();
  const missingReturn = resolve(fixture, 'What if we moved Brian Burns?', null);
  const unknownPlayer = resolve(fixture, 'What if we moved Smith for a 2027 second?', null);

  assert.equal(missingReturn.status, 'clarification');
  assert.equal(missingReturn.message, 'What draft year and round should New York receive?');
  assert.equal(unknownPlayer.status, 'clarification');
  assert.equal(unknownPlayer.message, 'Which current Giants player did you mean?');
});

test('short clarification replies complete only the missing seller fields', async () => {
  const fixture = await liveFixture();
  const missingReturn = resolve(fixture, 'What if we moved Brian Burns?', null);
  const completedReturn = answer(fixture, '2027 second', missingReturn.scenario);
  assert.equal(completedReturn.result!.player.player_name, 'Brian Burns');
  assert.equal(completedReturn.result!.proposal.pick_year, 2027);
  assert.equal(completedReturn.result!.proposal.pick_round, 2);

  const missingPlayer = resolve(fixture, 'What if we moved someone for a 2027 second?', null);
  assert.equal(missingPlayer.status, 'clarification');
  const completedPlayer = answer(fixture, 'Brian Burns', missingPlayer.scenario);
  assert.equal(completedPlayer.result!.player.player_name, 'Brian Burns');
});

test('unrelated market follow-ups are not hijacked as seller proposals', () => {
  const previous = {
    team_id: 'NYG' as const,
    player_id: 'player-1',
    player_name: 'Player One',
    player_query: 'Player One',
    position_group: 'EDGE' as const,
    pick_year: 2027,
    pick_round: 2,
    market_scope: { snapshot_id: 'snapshot', start_year: 2016, end_year: 2025, include_ytd: false, team_ids: [] },
  };
  assert.equal(parseNflSellerMoveTurn('What changed after 2020?', previous), null);
  assert.equal(parseNflSellerMoveTurn('Show me trades only.', previous), null);
  assert.equal(parseNflSellerMoveTurn('How does that affect our draft strategy?', previous), null);
  assert.equal(parseNflSellerMoveTurn('What if the trade market changes after 2020?', previous), null);
  assert.equal(parseNflSellerMoveTurn('Trade strategy by position.', previous), null);
  assert.equal(parseNflSellerMoveTurn('What if we traded for an EDGE?', previous), null);
  assert.equal(parseNflSellerMoveTurn('Show me the trades behind that.', previous)?.patch.show_comparables, true);
});

test('scenario modifiers require state from the same channel', async () => {
  const fixture = await liveFixture();
  const initial = answer(fixture, 'What if we moved Brian Burns for a 2027 second?', null);

  assert(parseNflSellerMoveTurn('Make it a first.', initial.scenario));
  assert.equal(parseNflSellerMoveTurn('Make it a first.', null), null);
  assert.equal(parseNflSellerMoveTurn('Use 2028.', null), null);
  assert.equal(parseNflSellerMoveTurn('What about Thibodeaux instead?', null), null);
});

test('the active Analysis path contains no embedded form or retired cap room', async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const marketView = await readFile(path.join(repoRoot, 'src', 'fenway', 'NflTransactionMarketAnalysis.tsx'), 'utf8');
  const dataBody = await readFile(path.join(repoRoot, 'src', 'fenway', 'DataAnalysisCardBody.tsx'), 'utf8');

  assert.doesNotMatch(marketView, /NflModelMove|Model a move|Seller-side check/);
  assert.doesNotMatch(dataBody, /NflModelMove|Model a move|Seller-side check/);
});

let fixturePromise: Promise<Awaited<ReturnType<typeof buildLiveFixture>>> | null = null;

async function liveFixture() {
  fixturePromise ??= buildLiveFixture();
  return fixturePromise;
}

async function buildLiveFixture() {
  const [seed, reviewed] = await Promise.all([loadNflDemoSeed(), loadReviewedNflTransactionSnapshot()]);
  const market = analyzeNflTransactionMarketSnapshot({
    analysis_mode: 'ten_year_trend',
    start_year: 2016,
    end_year: 2025,
    transaction_types: ['trade', 'free_agent_signing', 're_signing', 'extension', 'tag', 'waiver_claim', 'release'],
    include_ytd: false,
    max_comparables: 12,
  }, reviewed.snapshot, { generatedAt: GENERATED_AT });
  return { seed, snapshot: reviewed.snapshot, market };
}

function answer(
  fixture: Awaited<ReturnType<typeof liveFixture>>,
  question: string,
  previous: Parameters<typeof parseNflSellerMoveTurn>[1],
) {
  const artifact = resolve(fixture, question, previous);
  assert.equal(artifact.status, 'answered', artifact.message ?? 'scenario did not resolve');
  assert(artifact.result);
  return artifact;
}

function resolve(
  fixture: Awaited<ReturnType<typeof liveFixture>>,
  question: string,
  previous: Parameters<typeof parseNflSellerMoveTurn>[1],
) {
  const parsed = parseNflSellerMoveTurn(question, previous);
  assert(parsed);
  return resolveNflSellerMoveConversationTurn(parsed, fixture.market, previous, fixture.seed, fixture.snapshot, GENERATED_AT);
}
