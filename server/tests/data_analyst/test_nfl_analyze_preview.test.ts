import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNflGiantsAnalyzePreview,
  NFL_GIANTS_ANALYZE_ACCEPTANCE_QUESTION,
} from '../../src/claude/nfl_analyze_preview.js';
import { isSubmitDataAnalysisInput } from '../../src/claude/data_analyst.js';

test('NFL Giants Analyze preview is source-backed and schema-valid', async () => {
  const payload = await buildNflGiantsAnalyzePreview(NFL_GIANTS_ANALYZE_ACCEPTANCE_QUESTION);

  assert.equal(isSubmitDataAnalysisInput(payload), true);
  assert.match(payload.answer, /restructure/i);
  assert.ok(payload.sources.some((source) => source.title.includes('NFL cap and contract rows') && source.ref_index === 1));
  assert.ok(payload.sources.some((source) => source.title.includes('NFL rules') && source.ref_index === 3));
  assert.ok(payload.key_findings.every((finding) => finding.source_refs.length > 0));
  assert.ok(payload.key_findings.some((finding) => /post-June/i.test(finding.body)));
  assert.ok(payload.tables[0]?.columns.includes('Post-June cut'));
  assert.ok(payload.tables[0]?.columns.includes('Confidence'));
  assert.ok(payload.tables[0]?.rows.some((row) => row[0] === 'Andrew Thomas'));
  const capSource = payload.sources.find((source) => source.ref_index === 1);
  const capRows = capSource?.data && typeof capSource.data === 'object' && 'rows' in capSource.data && Array.isArray(capSource.data.rows)
    ? capSource.data.rows as Array<Record<string, unknown>>
    : [];
  const andrewThomas = capRows.find((row) => row.player === 'Andrew Thomas');
  assert.equal(typeof andrewThomas?.post_june_1_cut_savings_2026, 'number');
  assert.equal(andrewThomas?.contract_ledger_confidence, 'captured');
  assert.ok(payload.calculations.some((calculation) => calculation.label === 'Modeled restructure room'));
  assert.ok(payload.caveats.some((caveat) => caveat.includes('static checked-in snapshot')));
  assert.ok(payload.caveats.some((caveat) => caveat.includes('Contract confidence')));
  assert.doesNotMatch(payload.answer, /Contract Ledger v1|captured-confidence|source-needed|app rows|cap rows/i);
  assert.doesNotMatch(payload.caveats.join(' '), /Contract Ledger v1|source-needed/i);
});
