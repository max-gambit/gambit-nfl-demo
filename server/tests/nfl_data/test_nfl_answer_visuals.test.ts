import assert from 'node:assert/strict';
import test from 'node:test';
import { chartNumber, nflAnswerVisuals } from '@shared/nflAnswerVisuals';
import type { DataAnalysisTable } from '@shared/types';

const table = (columns: string[], rows: DataAnalysisTable['rows']): DataAnalysisTable => ({ title: 'Historical source comparison', columns, rows, source_refs: [4, 7] });

test('chart parsing preserves signed currency and never converts missing or contextual text to zero', () => {
  assert.equal(chartNumber('-$4,000,000'), -4_000_000);
  assert.equal(chartNumber('−$4,000,000'), -4_000_000);
  assert.equal(chartNumber('41.7%'), 41.7);
  assert.equal(chartNumber(0), 0);
  for (const value of [null, '', 'Unknown', '2026 · snapshot', 'Paulson Adebo: $8,000,000', '8/10', '1,2', 'Infinity']) assert.equal(chartNumber(value), null);
});

test('player chart retains row identity, source refs and unknown observations without modifying the table', () => {
  const source = table(['Player', 'Team / scope', '2025 receiving yards', 'Contract horizon'], [['A', 'NYG · internal', 800, 2028], ['B', 'DAL · external', null, 2026], ['C', 'JAX · external', 0, 2027]]);
  const before = structuredClone(source);
  const [chart] = nflAnswerVisuals([source]);
  assert.equal(chart.kind, 'bars'); if (chart.kind !== 'bars') return;
  assert.deepEqual(chart.metrics, ['2025 receiving yards']);
  assert.deepEqual(chart.points.map(p => [p.label, p.internal, p.values[0]]), [['A', true, 800], ['B', false, null], ['C', false, 0]]);
  assert.equal(chart.points[1].labels[0], 'Not recorded');
  assert.deepEqual(chart.sourceRefs, [4, 7]);
  assert.deepEqual(source, before);
});

test('financial chart preserves year, hold/scenario basis and signed changes', () => {
  const [years, alternatives] = nflAnswerVisuals([
    table(['Year', 'Hold cap', 'Scenario cap'], [[2026, '$24,199,390', '$21,199,390'], [2027, '$20,317,037', '$23,317,037']]),
    table(['Alternative', 'Current cap change vs hold (+ used)', 'Next-year cap change vs hold (+ used)', 'After moves and reserve'], [['Hold', '$0', '$0', '$6,000,000'], ['Conversion', '-$4,000,000', '$4,000,000', '$10,000,000']]),
  ]);
  assert.equal(years.kind, 'bars'); assert.equal(alternatives.kind, 'bars');
  if (years.kind !== 'bars' || alternatives.kind !== 'bars') return;
  assert.equal(years.points[0].label, '2026');
  assert.deepEqual(years.metrics, ['Hold cap', 'Scenario cap']);
  assert.deepEqual(years.points[1].values, [20_317_037, 23_317_037]);
  assert.deepEqual(alternatives.points[1].values, [-4_000_000, 4_000_000]);
  assert.equal(years.title, 'Cap comparison');
});

test('practice grid retains dated categorical changes and designation separately from snaps', () => {
  const [chart] = nflAnswerVisuals([table(['Player', 'Sept 17', 'Sept 18', 'Sept 19', 'Game designation', 'Offensive snaps'], [['A', 'LP', 'LP', 'DNP', 'Questionable', 1], ['B', 'DNP', 'LP', 'LP', 'Doubtful', 0]])]);
  assert.equal(chart.kind, 'practice'); if (chart.kind !== 'practice') return;
  assert.deepEqual(chart.dates, ['Sept 17', 'Sept 18', 'Sept 19']);
  assert.deepEqual(chart.players[0], { name: 'A', statuses: ['LP', 'LP', 'DNP'], designation: 'Questionable' });
});

test('third-down chart retains offense and situation, declines missing outcomes instead of hiding them', () => {
  const source = table(['Offense', 'Distance bucket', 'Converted', 'Failed', 'Conversion share'], [['NYG', 'medium', 5, 7, '41.7%'], ['NYG', 'long', 1, 4, '20.0%']]);
  const [chart] = nflAnswerVisuals([source]);
  assert.equal(chart.kind, 'downs'); if (chart.kind !== 'downs') return;
  assert.deepEqual(chart.rows.map(row => [row.label, row.share]), [['NYG · medium', '41.7%'], ['NYG · long', '20.0%']]);
  source.rows[1][2] = null;
  assert.deepEqual(nflAnswerVisuals([source]), []);
});

test('unsupported or unsourced tables stay tables; capped display remains explicit', () => {
  assert.deepEqual(nflAnswerVisuals([table(['Player', 'Grade', 'Year'], [['A', '8/10', 2026], ['B', '9/10', 2027]])]), []);
  assert.deepEqual(nflAnswerVisuals([table(['Year', 'Receiving yards'], [[2024, 900], [2025, 1000]])]), []);
  assert.deepEqual(nflAnswerVisuals([table(['Year', 'Hold cap (%)', 'Scenario cap (%)'], [[2026, '10%', '12%'], [2027, '12%', '10%']])]), []);
  const source = table(['Player', '2025 starts'], Array.from({ length: 14 }, (_, i) => [`Player ${i}`, i]));
  const [chart] = nflAnswerVisuals([source]);
  assert.equal(chart.totalRows, 14); assert.equal(chart.kind, 'bars');
  if (chart.kind === 'bars') assert.equal(chart.points.length, 12);
  source.source_refs = [];
  assert.deepEqual(nflAnswerVisuals([source]), []);
});
