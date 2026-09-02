import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  DEFAULT_NFL_TRANSACTION_MANIFEST_PATH,
  loadReviewedNflTransactionSnapshot,
} from '../../src/nfl_transactions/seed.js';
import { parseCsv } from '../../src/nfl_transactions/ingest.js';

test('CSV parser preserves quoted raw source fields', () => {
  const rows = parseCsv('trade_id,pfr_name,note\n1,"Smith, John","pick ""condition"""\n');
  assert.deepEqual(rows, [{ trade_id: '1', pfr_name: 'Smith, John', note: 'pick "condition"' }]);
});

test('reviewed transaction snapshot is checksum verified and covers completed years', async () => {
  const { snapshot, manifest } = await loadReviewedNflTransactionSnapshot();
  assert.equal(snapshot.snapshot_id, manifest.snapshot_id);
  assert.equal(snapshot.schema_version, 'nfl_transaction_snapshot.v1');
  assert.match(manifest.snapshot_checksum_sha256, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.coverage.start_year, 2016);
  assert.equal(snapshot.coverage.end_year, 2025);
  assert.ok(snapshot.coverage.event_count >= 10_000);
  assert.ok(snapshot.coverage.trade_event_count >= 500);
  assert.ok(snapshot.coverage.position_match_basis_points >= 9_500);
  assert.ok(snapshot.coverage.compensation_coverage_basis_points < 10_000);
  assert.ok(snapshot.coverage.contract_term_coverage_basis_points < 10_000);
  assert.ok(snapshot.source_refs.every((source) => Number.isSafeInteger(source.row_count) && source.row_count! > 0));
  assert.ok(snapshot.source_refs.every((source) => source.coverage_start_date && source.coverage_end_date));
  assert.equal(new Set(snapshot.roster_player_seasons.filter((row) => row.team_id == null).map((row) => row.year)).size, 10);
});

test('snapshot preserves raw boundaries while analytical values stay safe', async () => {
  const { snapshot } = await loadReviewedNflTransactionSnapshot();
  assert.ok(snapshot.trade_assets.every((asset) => asset.raw_source_record.trade_id));
  assert.ok(snapshot.contract_terms.every((term) => term.raw_source_record.contract_history_match !== undefined));
  assert.ok(snapshot.events.every((event) => [
    event.contract_value_dollars,
    event.contract_apy_dollars,
    event.guaranteed_dollars,
    event.league_cap_dollars,
  ].every((value) => value == null || Number.isSafeInteger(value))));
  assert.ok(snapshot.events.every((event) => event.guaranteed_dollars == null
    || event.contract_value_dollars == null
    || event.guaranteed_dollars <= event.contract_value_dollars));
  assert.ok(snapshot.player_matches.some((match) => /ambiguous DE\/OLB\/DL/.test(match.normalization_basis)));
  const coachRights = snapshot.events.find((event) => event.player_name === 'Sean Payton' && event.event_year === 2023);
  assert.equal(coachRights?.position_group, null);
  assert.equal(coachRights?.identity_confidence, 'unmatched');
  assert.match(coachRights?.normalization_basis ?? '', /possible non-player rights transaction/i);
  assert.ok(coachRights?.raw_source_record);
});

test('checked-in data files contain no generated market conclusion', async () => {
  const manifest = await readFile(DEFAULT_NFL_TRANSACTION_MANIFEST_PATH, 'utf8');
  assert.doesNotMatch(manifest, /which position markets|trade strategy|Ty.?s question/i);
});
