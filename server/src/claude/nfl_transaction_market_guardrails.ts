import type {
  BriefSource,
  NflPositionMarketTrend,
  NflTransactionMarketAnalysis,
  SubmitDataAnalysisInput,
} from '@shared/types';

export interface NflTransactionMarketGuardrailResult {
  ok: boolean;
  issues: string[];
}

export function latestNflTransactionMarketAnalysis(
  traces: Array<{ market_analysis?: NflTransactionMarketAnalysis }>,
): NflTransactionMarketAnalysis | null {
  return traces.flatMap((trace) => trace.market_analysis ? [trace.market_analysis] : []).at(-1) ?? null;
}

export function evaluateNflTransactionMarketDraft(
  draft: SubmitDataAnalysisInput,
  analysis: NflTransactionMarketAnalysis,
): NflTransactionMarketGuardrailResult {
  const text = dataAnalysisText(draft);
  const issues: string[] = [];
  const allowedPositions = new Set(analysis.query.position_groups);
  const artifactNames = new Set([
    ...analysis.comparables,
    ...analysis.influential_transactions,
  ].map((row) => row.player_name.toLowerCase()));

  for (const number of numericTokens(text)) {
    if (!allowedNumericTokens(analysis).has(number)) {
      issues.push(`Numeric token ${number} is absent from the deterministic artifact.`);
    }
  }
  if (/\b(caused|causal|because of this transaction|led directly to|drove the market)\b/i.test(text)
    && analysis.influential_transactions.length > 0) {
    issues.push('Leave-one-out influence is statistical sensitivity, not causal influence.');
  }
  if (!draft.caveats.some((item) => analysis.limitations.some((limitation) => overlap(item, limitation)))) {
    issues.push('The answer omits the artifact coverage limitations.');
  }
  if (!draft.calculations.some((item) => /mobility|player.season|material move/i.test(`${item.label} ${item.formula ?? ''}`))) {
    issues.push('The answer omits the deterministic mobility methodology.');
  }

  const unsupportedPrice = analysis.position_trends.some((trend) => (
    (trend.contract_price.status === 'insufficient_evidence' || trend.trade_compensation.status === 'insufficient_evidence')
    && new RegExp(`\\b${trend.position_group}\\b[^.]{0,160}\\b(price|premium|expensive|cheap|cost)`, 'i').test(text)
  ));
  if (unsupportedPrice) issues.push('The answer makes a price claim for a position with an insufficient price sample.');

  for (const match of text.matchAll(/\b(QB|RB|WR|TE|OT|IOL|EDGE|IDL|LB|CB|S|ST)\b/g)) {
    if (!allowedPositions.has(match[1] as NflPositionMarketTrend['position_group'])) {
      issues.push(`Position ${match[1]} is outside the executed filters.`);
    }
  }
  for (const source of draft.sources) {
    const url = sourceRows(source).find((row) => /url|source/i.test(row.k))?.v;
    if (url && !analysis.source_refs.some((candidate) => candidate.url === url)) {
      issues.push(`Citation ${url} was not returned by the deterministic tool.`);
    }
  }
  for (const sentence of text.split(/[.\n]/)) {
    if (!/\b(?:traded|signed|acquired|released|extended)\b/i.test(sentence)) continue;
    for (const quotedName of properNameCandidates(sentence)) {
      if (!artifactNames.has(quotedName.toLowerCase())) {
        issues.push(`Comparable ${quotedName} was not returned by the deterministic tool.`);
      }
    }
  }

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

export function buildNflTransactionMarketSystemBlock(analysis: NflTransactionMarketAnalysis): string {
  return [
    '=== DETERMINISTIC NFL TRANSACTION-MARKET ARTIFACT ===',
    'The JSON below was calculated from the current local database snapshot after the user asked the question.',
    'It is the sole authority for market numbers, periods, filters, comparables, influence, sources, and limitations.',
    'Do not add calculations or citations. “Influential” means leave-one-out statistical sensitivity, never causality.',
    'If a signal is insufficient, say so. Include the mobility method and material coverage caveats.',
    JSON.stringify(analysis),
  ].join('\n');
}

export function buildDeterministicNflTransactionMarketFallback(
  analysis: NflTransactionMarketAnalysis,
): SubmitDataAnalysisInput {
  const usable = analysis.position_trends.filter((trend) => trend.event_count > 0);
  const growing = usable.filter((trend) => trend.status === 'supported' && trend.direction === 'growing').map((trend) => trend.position_group);
  const shrinking = usable.filter((trend) => trend.status === 'supported' && trend.direction === 'shrinking').map((trend) => trend.position_group);
  const answer = analysis.status === 'insufficient_evidence'
    ? 'The current public-data snapshot does not support a firm market conclusion for the executed filters. The calculated series and comparables are shown below, but the sample and identity gates require an abstention.'
    : [
      growing.length ? `${growing.join(', ')} show supported market growth across at least two non-conflicting signals.` : 'No position clears the supported multi-signal growth gate.',
      shrinking.length ? `${shrinking.join(', ')} show supported market shrinkage.` : 'No position clears the supported multi-signal shrinkage gate.',
      'Treat mixed or directional rows as signal-specific evidence rather than an overall market call.',
    ].join(' ');
  const sources = deterministicMarketSourceRows(analysis, 1);
  const ref = sources[0]?.ref_index ?? 1;
  return {
    answer,
    key_findings: usable.slice(0, 6).map((trend) => ({
      label: `${trend.position_group} · ${trend.direction.replaceAll('_', ' ')}`,
      body: `${trend.event_count} material events. Mobility: ${signalSummary(trend.mobility)}; move share: ${signalSummary(trend.transaction_share)}; contract price: ${signalSummary(trend.contract_price)}; trade price: ${signalSummary(trend.trade_compensation)}.`,
      source_refs: [ref],
    })),
    tables: [{
      title: `Position-market signals · ${analysis.query.baseline_years.join('–')} vs ${analysis.query.recent_years.join('–')}`,
      columns: ['Position', 'Read', 'Events', 'Mobility', 'Move share', 'Contract price', 'Trade price'],
      rows: usable.map((trend) => [
        trend.position_group,
        `${trend.status}: ${trend.direction}`,
        trend.event_count,
        signalSummary(trend.mobility),
        signalSummary(trend.transaction_share),
        signalSummary(trend.contract_price),
        signalSummary(trend.trade_compensation),
      ]),
      source_refs: [ref],
    }],
    calculations: [
      {
        label: 'Mobility',
        formula: analysis.methodology.mobility,
        value: `Calculated for ${analysis.query.start_year}–${analysis.query.end_year} from ${analysis.coverage.event_count} material events.`,
        source_refs: [ref],
      },
      {
        label: 'Market classification',
        formula: analysis.methodology.classification,
        value: analysis.status.replaceAll('_', ' '),
        source_refs: [ref],
      },
    ],
    sources,
    caveats: analysis.limitations.length ? analysis.limitations : ['No additional calculation limitation was returned by the deterministic engine.'],
    followups: [
      'Show me trades only.',
      'Compare edge rushers with interior offensive linemen.',
      'What changed after 2020?',
      'Which recent transactions most influenced that conclusion?',
    ],
  };
}

export function deterministicMarketSourceRows(
  analysis: NflTransactionMarketAnalysis,
  startRefIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'>[] {
  return analysis.source_refs.map((source, index) => ({
    ref_index: startRefIndex + index,
    kind: 'ANALYST_DATA',
    source: source.name,
    title: `NFL transaction market · ${source.name}`,
    updated_at: source.as_of_date,
    data: {
      source_url: source.url,
      rows: [
        { k: 'Source URL', v: source.url },
        { k: 'Attribution', v: source.upstream_attribution },
        { k: 'Retrieved', v: source.retrieved_at },
        { k: 'As of', v: source.as_of_date },
        { k: 'Checksum', v: source.checksum_sha256 },
        { k: 'Coverage', v: source.coverage_note },
        { k: 'Rows', v: source.row_count?.toLocaleString() ?? 'not supplied' },
        { k: 'Coverage range', v: source.coverage_start_date && source.coverage_end_date ? `${source.coverage_start_date}–${source.coverage_end_date}` : 'not supplied' },
      ],
      snapshot_id: analysis.snapshot_id,
      analysis_id: analysis.analysis_id,
    },
  }));
}

export function deterministicMarketChatAnswer(analysis: NflTransactionMarketAnalysis): string {
  const draft = buildDeterministicNflTransactionMarketFallback(analysis);
  const lines = [draft.answer, '', `Executed filters: ${analysis.query.start_year}–${analysis.query.end_year}; ${analysis.query.position_groups.join(', ')}; ${analysis.query.transaction_types.join(', ')}.`, ''];
  for (const finding of draft.key_findings.slice(0, 4)) lines.push(`- ${finding.label}: ${finding.body}`);
  lines.push('', `Method: ${analysis.methodology.mobility} ${analysis.methodology.classification}`);
  if (analysis.comparables.length) {
    lines.push('', 'Supporting transactions:');
    for (const row of analysis.comparables.slice(0, 5)) {
      lines.push(`- ${row.event_date ?? row.event_year} · ${row.player_name} · ${row.position_group ?? 'position unresolved'} · ${row.transaction_type.replaceAll('_', ' ')}${row.compensation_summary ? ` · ${row.compensation_summary}` : ''}`);
    }
  }
  lines.push('', `Coverage: ${analysis.coverage.event_count} material events; ${formatBasisPoints(analysis.coverage.position_match_basis_points)} precise identity coverage.`);
  for (const limitation of analysis.limitations) lines.push(`- ${limitation}`);
  return lines.join('\n');
}

function signalSummary(signal: NflPositionMarketTrend['mobility']): string {
  if (signal.status === 'insufficient_evidence' || signal.baseline_value == null || signal.recent_value == null) return 'insufficient evidence';
  const format = signal.unit === 'events_per_100_player_seasons'
    ? (value: number) => (value / 100).toFixed(1)
    : (value: number) => formatBasisPoints(value);
  return `${format(signal.baseline_value)} → ${format(signal.recent_value)} (${signal.direction}; ${signal.status})`;
}

function formatBasisPoints(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}

function dataAnalysisText(draft: SubmitDataAnalysisInput): string {
  return [
    draft.answer,
    ...draft.key_findings.flatMap((item) => [item.label, item.body]),
    ...draft.tables.flatMap((table) => [table.title, ...table.columns, ...table.rows.flat().map(String)]),
    ...draft.calculations.flatMap((item) => [item.label, item.formula ?? '', item.value]),
    ...draft.caveats,
  ].join('\n');
}

function allowedNumericTokens(analysis: NflTransactionMarketAnalysis): Set<string> {
  const values = new Set<string>(['0', '1', '2', '3', '5', '10', '20', '85', '95', '100']);
  const visit = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      values.add(String(value));
      values.add((value / 100).toFixed(1));
      values.add(Math.round(value / 1_000).toString());
      values.add((value / 1_000_000).toFixed(1).replace(/\.0$/, ''));
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(analysis);
  values.add(String(analysis.query.end_year - analysis.query.start_year + 1));
  return values;
}

function numericTokens(text: string): string[] {
  return [...text.matchAll(/(?<![A-Za-z0-9_])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![A-Za-z0-9_])/g)]
    .map((match) => match[0].replaceAll(',', ''));
}

function sourceRows(source: Omit<BriefSource, 'id' | 'brief_id'>): Array<{ k: string; v: string }> {
  const rows = source.data?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is { k: string; v: string } => (
    Boolean(row) && typeof row === 'object' && typeof (row as { k?: unknown }).k === 'string' && typeof (row as { v?: unknown }).v === 'string'
  ));
}

function overlap(left: string, right: string): boolean {
  const words = (value: string) => new Set(value.toLowerCase().match(/[a-z]{5,}/g) ?? []);
  const a = words(left);
  const b = words(right);
  return [...a].filter((word) => b.has(word)).length >= 2;
}

function properNameCandidates(text: string): string[] {
  return [...text.matchAll(/\b([A-Z][a-z]+[ \t]+[A-Z][a-z]+)\b/g)].map((match) => match[1]);
}
