import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import { analyzeNflTransactionMarketSnapshot } from '../../src/nfl_transactions/analyze.js';
import {
  defaultSellerMarketFromSnapshot,
  parseNflSellerMoveTurn,
  resolveNflSellerMoveConversationTurn,
  sellerMarketForTurn,
} from '../../src/nfl_transactions/seller_move_conversation.js';
import { loadReviewedNflTransactionSnapshot } from '../../src/nfl_transactions/seed.js';
import { deterministicSellerMoveEvidenceRows, sellerMoveArtifactBody } from '../../src/routes/briefs.js';

const GENERATED_AT = '2026-09-03T16:00:00.000Z';

test('fresh seller proposals use the latest ten completed seasons without a prior market answer', async () => {
  const fixture = await liveFixture();
  const market = defaultSellerMarketFromSnapshot(fixture.seed, fixture.snapshot);

  assert.equal(market.query.start_year, 2016);
  assert.equal(market.query.end_year, 2025);
  assert.equal(market.query.include_ytd, false);
});

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

test('a compound market and seller question isolates the player and proposed return', () => {
  const question = 'Since 2018, how has the trade market for EDGE players changed—and if the Giants moved Brian Burns for a 2027 second-round pick, would that return be above, within, or below the historical range?';
  const turn = parseNflSellerMoveTurn(question, null);

  assert(turn);
  assert.equal(turn.patch.player_query, 'Brian Burns');
  assert.equal(turn.patch.pick_year, 2027);
  assert.equal(turn.patch.pick_round, 2);
  assert.equal(turn.market_question, 'Since 2018, how has the trade market for EDGE players changed');
});

test('a compound question uses its explicit market scope instead of stale channel filters', async () => {
  const fixture = await liveFixture();
  const turn = parseNflSellerMoveTurn(
    'Since 2018, how has the trade market for EDGE players changed—and if the Giants moved Brian Burns for a 2027 second, where would that land?',
    null,
  )!;
  const staleMarket = analyzeNflTransactionMarketSnapshot({
    analysis_mode: 'ten_year_trend',
    start_year: 2016,
    end_year: 2020,
    team_ids: ['NYG'],
    position_groups: ['WR'],
    transaction_types: ['extension'],
    include_ytd: false,
    max_comparables: 12,
  }, fixture.snapshot, { generatedAt: GENERATED_AT });
  const market = sellerMarketForTurn(turn, staleMarket, fixture.seed, fixture.snapshot);

  assert.equal(market.query.start_year, 2018);
  assert.equal(market.query.end_year, 2025);
  assert.deepEqual(market.query.team_ids, []);
  assert.deepEqual(market.query.position_groups, ['EDGE']);
  assert.deepEqual(market.query.transaction_types, ['trade']);
});

test('compound seller bodies request both live result surfaces', async () => {
  const fixture = await liveFixture();
  const artifact = answer(fixture, 'What if we moved Brian Burns for a 2027 second?', null);
  const body = sellerMoveArtifactBody(fixture.market, artifact, true);

  assert.equal(body.combined_market_seller_analysis, true);
  assert.equal(body.market_analysis, fixture.market);
  assert.equal(body.seller_move_analysis, artifact);
});

test('seller answers cite contract, role, the trade rule, and historical comparables', async () => {
  const fixture = await liveFixture();
  const artifact = answer(fixture, 'What if we moved Brian Burns for a 2027 second?', null);
  const sources = await deterministicSellerMoveEvidenceRows(artifact);

  assert.equal(sources[0]?.data?.seller_move_contract, true);
  assert.equal(sources[1]?.data?.seller_move_role, true);
  assert.equal(sources[2]?.ref_index, 3);
  assert.equal(sources[2]?.data?.seller_move_rule, true);
  assert.match(String(sources[2]?.data?.source_url), /^https:/);
  assert.equal(sources[3]?.ref_index, 4);
  assert.equal(sources[3]?.data?.seller_move_comparable, true);
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
  assert.match(updated.result!.market.timing_note, /later pick is treated as weaker/i);
  assert.doesNotMatch(updated.result!.market.middle_range?.stronger_pick ?? '', /^20\d{2}/);
  assert.doesNotMatch(updated.result!.market.middle_range?.weaker_pick ?? '', /^20\d{2}/);
});

test('incomplete and unknown-player proposals ask one concise clarification', async () => {
  const fixture = await liveFixture();
  const missingReturn = resolve(fixture, 'What if we moved Brian Burns?', null);
  const unknownPlayer = resolve(fixture, 'What if we moved Smith for a 2027 second?', null);

  assert.equal(missingReturn.status, 'clarification');
  assert.equal(missingReturn.message, 'What draft year and round should New York receive?');
  assert.equal(unknownPlayer.status, 'clarification');
  assert.match(unknownPlayer.message ?? '', /could not find Smith in the current Giants roster or cap sheet/i);
});

test('Dexter Lawrence follows the loaded current roster truth and suggests sourced Giants linemen', async () => {
  const fixture = await liveFixture();
  const dexter = resolve(fixture, 'What if we moved Dexter Lawrence for a 2027 second?', null);

  assert.equal(fixture.seed.roster_entries.some((row) => row.team_id === 'NYG' && row.player_name === 'Dexter Lawrence'), false);
  assert.equal(dexter.status, 'clarification');
  assert.match(dexter.message ?? '', /could not find Dexter Lawrence in the current Giants roster or cap sheet as of 2026-09-02/i);
  assert.match(dexter.message ?? '', /same position with usable contract data include/i);
  assert.match(dexter.message ?? '', /DJ Reader|Darius Alexander|Bobby Jamison-Travis/i);
});

test('player resolution distinguishes roster match, incomplete contract data, ambiguity, and typo suggestions', async () => {
  const fixture = await liveFixture();
  const incompleteSeed = structuredClone(fixture.seed);
  const burns = incompleteSeed.cap_rows.find((row) => row.player_name === 'Brian Burns')!;
  burns.source_url = null;
  const parsedBurns = parseNflSellerMoveTurn('What if we moved Brian Burns for a 2027 second?', null)!;
  const incomplete = resolveNflSellerMoveConversationTurn(
    parsedBurns, fixture.market, null, incompleteSeed, fixture.snapshot, GENERATED_AT,
  );
  assert.equal(incomplete.status, 'unavailable');
  assert.match(incomplete.message ?? '', /on the current Giants roster.*contract row is not complete enough/i);

  const ambiguousSeed = structuredClone(fixture.seed);
  const exemplar = structuredClone(ambiguousSeed.roster_entries.find((row) => row.team_id === 'NYG')!);
  ambiguousSeed.roster_entries.push(
    { ...exemplar, player_id: 'test-smith-1', player_name: 'Alex Smith', roster_status: 'active' },
    { ...exemplar, player_id: 'test-smith-2', player_name: 'Jordan Smith', roster_status: 'active' },
  );
  const parsedSmith = parseNflSellerMoveTurn('What if we moved Smith for a 2027 second?', null)!;
  const ambiguous = resolveNflSellerMoveConversationTurn(
    parsedSmith, fixture.market, null, ambiguousSeed, fixture.snapshot, GENERATED_AT,
  );
  assert.equal(ambiguous.status, 'clarification');
  assert.match(ambiguous.message ?? '', /Alex Smith or Jordan Smith/i);

  const parsedTypo = parseNflSellerMoveTurn('What if we moved Bryan Burns for a 2027 second?', null)!;
  const typo = resolveNflSellerMoveConversationTurn(
    parsedTypo, fixture.market, null, fixture.seed, fixture.snapshot, GENERATED_AT,
  );
  assert.equal(typo.status, 'clarification');
  assert.match(typo.message ?? '', /Did you mean Brian Burns/i);
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
  assert.match(dataBody, /combined_market_seller_analysis[\s\S]+NflTransactionMarketAnalysisView[\s\S]+NflSellerMoveAnalysis/);
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
