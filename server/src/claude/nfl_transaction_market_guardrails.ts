import type {
  BriefSource,
  NflPositionMarketTrend,
  NflSellerMoveConversationArtifact,
  NflTransactionMarketAnalysis,
  SubmitDataAnalysisInput,
} from '@shared/types';
import { nflTransactionMarketFootballRead, nflTransactionTradePackageLines } from '@shared/nflTransactionMarket';
import { positionGroupsFromQuestion, teamIdsFromQuestion } from '../nfl_transactions/question.js';
import { nflTransactionMarketModelContext } from '../nfl_transactions/model_context.js';

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
  sellerMoveAnalysis: NflSellerMoveConversationArtifact | null = null,
): NflTransactionMarketGuardrailResult {
  const text = dataAnalysisText(draft);
  const issues: string[] = [];
  const sellerResult = sellerMoveAnalysis?.result ?? null;
  const allowedPositions = new Set([
    ...analysis.query.position_groups,
    ...(sellerResult ? [sellerResult.player.position_group] : []),
  ]);
  const artifactNames = new Set([
    ...analysis.comparables,
    ...analysis.influential_transactions,
    ...(sellerResult ? [sellerResult.player, ...sellerResult.comparables] : []),
  ].map((row) => row.player_name.toLowerCase()));

  for (const number of numericTokens(text)) {
    if (!allowedNumericTokens(analysis, sellerMoveAnalysis).has(number)) {
      issues.push(`Numeric token ${number} is absent from the deterministic artifact.`);
    }
  }
  validateDeclaredPeriods(text, analysis, issues);
  validateDeclaredScope(text, analysis, issues);
  validateDeclaredTransactionTypes(text, analysis, issues);
  validatePositionSignalNumbers(text, analysis, issues);
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

  const unsupportedPrice = analysis.position_trends.some((trend) => proseSentences(text).some((sentence) => {
    if (!new RegExp(`\\b${trend.position_group}\\b`, 'i').test(sentence)) return false;
    if (/\b(?:insufficient|unavailable|not enough|cannot support|does not support)\b/i.test(sentence)) return false;
    return (trend.contract_price.status === 'insufficient_evidence'
        && /\b(?:contract (?:price|cost)|apy|guarantee|expensive|cheap)\b/i.test(sentence))
      || (trend.trade_compensation.status === 'insufficient_evidence'
        && /\b(?:trade (?:price|return)|compensation|premium[- ]pick)\b/i.test(sentence));
  }));
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
  for (const sentence of proseSentences(text)) {
    if (!/\b(?:traded|signed|acquired|released|extended)\b/i.test(sentence)) continue;
    for (const candidate of actionNameCandidates(sentence)) {
      if (teamIdsFromQuestion(candidate).length > 0) continue;
      if (!matchesArtifactName(candidate, artifactNames)) {
        issues.push(`Comparable ${candidate} was not returned by the deterministic tool.`);
      }
    }
  }

  validateSellerMoveInterpretation(draft.answer, sellerMoveAnalysis, issues);

  return { ok: issues.length === 0, issues: [...new Set(issues)] };
}

/**
 * Validate model-written football reasoning while keeping the calculation,
 * methodology, limitations, and source list server-owned.
 */
export function evaluateNflArtifactInterpretation(
  answer: string,
  analysis: NflTransactionMarketAnalysis,
  sellerMoveAnalysis: NflSellerMoveConversationArtifact | null = null,
): NflTransactionMarketGuardrailResult {
  const governedBody = buildDeterministicNflTransactionMarketFallback(analysis);
  const validation = evaluateNflTransactionMarketDraft({ ...governedBody, answer }, analysis, sellerMoveAnalysis);
  const answerNumbers = new Set(numericTokens(answer));
  const issues = validation.issues.filter((issue) => {
    const numeric = issue.match(/^Numeric token ([\d.]+) /)?.[1];
    return numeric == null || answerNumbers.has(numeric);
  });
  validateInterpretationDirections(answer, analysis, issues);
  validateSellerMoneyClaims(answer, sellerMoveAnalysis, issues);
  validateSellerProposalClaims(answer, sellerMoveAnalysis, issues);
  return { ok: issues.length === 0, issues };
}

export function buildNflTransactionMarketSystemBlock(analysis: NflTransactionMarketAnalysis): string {
  return [
    '=== DETERMINISTIC NFL TRANSACTION-MARKET ARTIFACT ===',
    'The JSON below was calculated from the current local database snapshot after the user asked the question.',
    'It is the sole authority for market numbers, periods, filters, comparables, influence, sources, and limitations.',
    'Do not add calculations or citations. “Influential” means leave-one-out statistical sensitivity, never causality.',
    'If a signal is insufficient, say so. Include the mobility method and material coverage caveats.',
    JSON.stringify(nflTransactionMarketModelContext(analysis)),
  ].join('\n');
}

export function buildDeterministicNflTransactionMarketFallback(
  analysis: NflTransactionMarketAnalysis,
): SubmitDataAnalysisInput {
  // Keep every requested position visible, including zero-event cohorts. A
  // missing market is itself governed evidence and must not disappear from
  // the deterministic fallback.
  const usable = analysis.position_trends;
  const tradeOnly = analysis.query.transaction_types.length === 1 && analysis.query.transaction_types[0] === 'trade';
  const premiumTradeRanking = usable
    .filter((trend) => trend.trade_compensation.status !== 'insufficient_evidence'
      && trend.trade_compensation.overall_value != null)
    .sort((a, b) => (
      b.trade_compensation.overall_value! - a.trade_compensation.overall_value!
      || b.trade_compensation.sample_size - a.trade_compensation.sample_size
      || a.position_group.localeCompare(b.position_group)
    ));
  const footballRead = nflTransactionMarketFootballRead(analysis);
  const answer = analysis.status === 'insufficient_evidence'
    ? 'The current public data does not support a market conclusion for the requested scope. The calculated series and transactions are still available, but the stated coverage gaps need to be resolved before setting a trade posture.'
    : tradeOnly && premiumTradeRanking.length > 0
      ? `Across all completed years in ${analysis.query.start_year}–${analysis.query.end_year}, the highest observed day-one or day-two pick shares among allocable single-player trades were ${premiumTradeRanking.slice(0, 3).map((trend) => `${trend.position_group} ${formatBasisPoints(trend.trade_compensation.overall_value!)}`).join(', ')}. Multi-player and unknown-compensation deals remain comparables but are not assigned a fabricated per-player price.`
    : [footballRead.conclusion, footballRead.implication].join(' ');
  const sources = deterministicMarketSourceRows(analysis, 1);
  const ref = sources[0]?.ref_index ?? 1;
  return {
    answer,
    key_findings: (tradeOnly ? premiumTradeRanking : usable).slice(0, 6).map((trend) => ({
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
    title: `${source.name} snapshot`,
    updated_at: source.as_of_date,
    data: {
      source_url: source.url,
      rows: [
        { k: 'Attribution', v: source.upstream_attribution },
        { k: 'Retrieved', v: source.retrieved_at },
        { k: 'As of', v: source.as_of_date },
        { k: 'Coverage', v: source.coverage_note },
        { k: 'Records in this snapshot', v: source.row_count?.toLocaleString() ?? 'not supplied' },
        { k: 'Coverage range', v: source.coverage_start_date && source.coverage_end_date ? `${source.coverage_start_date}–${source.coverage_end_date}` : 'not supplied' },
      ],
      snapshot_id: analysis.snapshot_id,
      analysis_id: analysis.analysis_id,
    },
  }));
}

export function deterministicMarketEventSourceRows(
  analysis: NflTransactionMarketAnalysis,
  startRefIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'>[] {
  const rows = [...analysis.comparables, ...analysis.influential_transactions, ...(analysis.full_cohort ?? [])]
    .filter((row, index, all) => all.findIndex((candidate) => candidate.event_id === row.event_id) === index);
  return rows.map((row, index) => {
    const preferredSourceId = row.transaction_type === 'trade' ? 'trades'
      : ['free_agent_signing', 're_signing', 'extension', 'tag'].includes(row.transaction_type) ? 'contracts'
        : null;
    const upstream = (preferredSourceId
      ? analysis.source_refs.find((source) => source.id === preferredSourceId && row.source_ref_ids.includes(source.id))
      : null)
      ?? analysis.source_refs.find((source) => row.source_ref_ids.includes(source.id));
    return {
      ref_index: startRefIndex + index,
      kind: 'ANALYST_DATA' as const,
      source: 'nflverse transaction history',
      title: `${row.player_name} transaction`,
      updated_at: row.event_date ?? String(row.event_year),
      data: {
        ...(upstream ? { source_url: upstream.url } : {}),
        rows: [
          { k: 'Date', v: row.event_date ?? `${row.event_year} (${row.date_precision} date)` },
          { k: 'Move', v: row.transaction_type.replaceAll('_', ' ') },
          { k: 'Position', v: row.position_group ?? 'unresolved' },
          { k: 'Teams', v: `${row.from_team_id ?? '—'} → ${row.to_team_id ?? '—'}` },
          { k: 'Player', v: row.player_name },
          { k: 'Compensation', v: row.compensation_summary ?? row.compensation_band ?? 'not available' },
          ...(row.trade_package ? [{ k: 'Trade package', v: nflTransactionTradePackageLines(row).join(' / ') }] : []),
          { k: 'Contract terms', v: row.contract_apy_dollars == null ? 'not available' : `$${row.contract_apy_dollars.toLocaleString()} APY` },
          { k: 'Relevance', v: analysis.influential_transactions.some((candidate) => candidate.event_id === row.event_id) ? 'Key transaction in the displayed result' : 'Supporting comparison' },
        ],
        transaction: row,
        transaction_sources: analysis.source_refs.filter((source) => row.source_ref_ids.includes(source.id)),
        snapshot_id: analysis.snapshot_id,
        analysis_id: analysis.analysis_id,
      },
    };
  });
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
  lines.push('', `Coverage: ${analysis.coverage.event_count} player moves analyzed; ${formatBasisPoints(analysis.coverage.position_match_basis_points)} of player records matched.`);
  for (const limitation of analysis.limitations) lines.push(`- ${limitation}`);
  return lines.join('\n');
}

function signalSummary(signal: NflPositionMarketTrend['mobility']): string {
  if (signal.status === 'insufficient_evidence' || signal.baseline_value == null || signal.recent_value == null) return 'insufficient evidence';
  const format = signal.unit === 'events_per_100_player_seasons'
    ? (value: number) => (value / 100).toFixed(2)
    : (value: number) => formatBasisPoints(value, 2);
  const delta = signal.unit === 'events_per_100_player_seasons'
    ? `${signed((signal.recent_value - signal.baseline_value) / 100, 2)} per 100`
    : `${signed(signal.recent_value - signal.baseline_value, 0)} bp`;
  const overall = signal.overall_value == null ? '' : `; all completed years ${format(signal.overall_value)}`;
  return `${format(signal.baseline_value)} → ${format(signal.recent_value)}; Δ ${delta} (${signal.direction}; ${signal.status}${overall})`;
}

function formatBasisPoints(value: number, precision = 1): string {
  return `${(value / 100).toFixed(precision)}%`;
}

function signed(value: number, precision: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(precision)}`;
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

function allowedNumericTokens(
  analysis: NflTransactionMarketAnalysis,
  sellerMoveAnalysis: NflSellerMoveConversationArtifact | null = null,
): Set<string> {
  const values = new Set<string>(['0', '1', '2', '3', '5', '10', '20', '85', '95', '100']);
  const visit = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      for (const candidate of new Set([value, Math.abs(value)])) {
        values.add(String(candidate));
        values.add((candidate / 100).toFixed(1));
        values.add((candidate / 100).toFixed(2));
        values.add(Math.round(candidate / 1_000).toString());
        values.add((candidate / 1_000_000).toFixed(1).replace(/\.0$/, ''));
      }
    } else if (typeof value === 'string') {
      for (const token of numericTokens(value)) values.add(token);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(visit);
    }
  };
  visit(nflTransactionMarketModelContext(analysis));
  visit(sellerMoveAnalysis);
  for (const trend of analysis.position_trends) {
    for (const signal of [trend.mobility, trend.transaction_share, trend.contract_price, trend.trade_compensation]) {
      if (signal.baseline_value != null && signal.recent_value != null) {
        visit(signal.recent_value - signal.baseline_value);
      }
    }
  }
  values.add(String(analysis.query.end_year - analysis.query.start_year + 1));
  return values;
}

function validateSellerMoveInterpretation(
  answer: string,
  sellerMoveAnalysis: NflSellerMoveConversationArtifact | null,
  issues: string[],
): void {
  const result = sellerMoveAnalysis?.result;
  if (!result) return;
  if (!answer.toLowerCase().includes(result.player.player_name.toLowerCase())) {
    issues.push(`The interpretation omits the proposed player, ${result.player.player_name}.`);
  }

  const statedRanges = new Set(
    [...answer.toLowerCase().matchAll(/\b(?:(above|below)(?:[-\s]+the)?(?:[-\s]+typical|[-\s]+historical|[-\s]+market)?[-\s]+range|within(?:[-\s]+the)?(?:[-\s]+typical|[-\s]+historical|[-\s]+market)?[-\s]+range)\b/g)]
      .map((match) => match[1] ?? 'within'),
  );
  if (result.market.range) {
    if (!statedRanges.has(result.market.range)) {
      issues.push(`The interpretation does not state the calculated ${result.market.range}-range market result.`);
    }
    for (const stated of statedRanges) {
      if (stated !== result.market.range) {
        issues.push(`The interpretation calls the proposed return ${stated}, but the calculation says ${result.market.range}.`);
      }
    }
  } else if (statedRanges.size > 0) {
    issues.push('The interpretation assigns a historical range despite insufficient comparison data.');
  }
}

function validateInterpretationDirections(
  answer: string,
  analysis: NflTransactionMarketAnalysis,
  issues: string[],
): void {
  for (const sentence of proseSentences(answer)) {
    const mentioned = interpretationPositionTrends(sentence, analysis);
    if (mentioned.length !== 1) continue;
    const trend = mentioned[0];
    for (const clause of interpretationClauses(sentence)) {
      const claimed = claimedDirection(clause);
      if (!claimed) continue;
      const signal = signalForClaim(clause, trend);
      const expected = typeof signal === 'object' && signal != null ? signal.direction : trend.direction;
      const status = typeof signal === 'object' && signal != null ? signal.status : trend.status;
      if (status === 'insufficient_evidence') {
        issues.push(`The interpretation assigns ${claimed} direction to ${trend.position_group} despite insufficient evidence.`);
      } else if (expected !== claimed) {
        issues.push(`The interpretation calls the ${trend.position_group} ${signalLabel(clause)} ${claimed}, but the calculation says ${expected}.`);
      }
    }
  }
}

function interpretationPositionTrends(sentence: string, analysis: NflTransactionMarketAnalysis): NflPositionMarketTrend[] {
  const positions = positionGroupsFromQuestion(sentence);
  const mentioned = analysis.position_trends.filter((trend) => positions.includes(trend.position_group));
  if (mentioned.length || positions.length) return mentioned;
  // A single-position answer can refer to its market without repeating the
  // position in every sentence. Keep those claims subject to the same guard.
  if (analysis.position_trends.length === 1
    && /\b(?:market|movement|mobility|trade activity|trade returns?|compensation|premium[- ]pick|share of league trades)\b/i.test(sentence)) {
    return analysis.position_trends;
  }
  return [];
}

function claimedDirection(value: string): NflPositionMarketTrend['direction'] | null {
  const matches = new Set<NflPositionMarketTrend['direction']>();
  if (/\b(?:growing|growth|increased|increasing|rose|rising|expanded|strengthened)\b/i.test(value)) matches.add('growing');
  if (/\b(?:shrinking|shrank|declined|declining|decreased|fell|falling|cooled|contracted|fewer)\b/i.test(value)) matches.add('shrinking');
  if (/\b(?:flat|stable|steady|unchanged|held)\b/i.test(value)) matches.add('flat');
  if (/\b(?:mixed|conflicting|conflict|diverged|diverging|disagree)\b/i.test(value)) matches.add('mixed');
  return matches.size === 1 ? [...matches][0] : null;
}

function signalLabel(value: string): string {
  if (/\b(?:compensation|premium[- ]pick|day[- ]one|day[- ]two|pick share|trade return)\b/i.test(value)) return 'trade-return signal';
  if (/\b(?:contract|apy|guarantee)\b/i.test(value)) return 'contract-cost signal';
  if (/\b(?:move share|share of)\b/i.test(value)) return 'share-of-moves signal';
  if (/\b(?:movement|mobility|activity|volume|per 100)\b/i.test(value)) return 'player-movement signal';
  return 'overall market read';
}

function validateSellerMoneyClaims(
  answer: string,
  sellerMoveAnalysis: NflSellerMoveConversationArtifact | null,
  issues: string[],
): void {
  const result = sellerMoveAnalysis?.result;
  if (!result) return;
  for (const sentence of proseSentences(answer)) {
    for (const claim of moneyClaims(sentence)) {
      const field = nearestMoneyField(sentence, claim.index);
      if (!field) {
        issues.push(`The interpretation includes an unbound money claim (${claim.raw}).`);
        continue;
      }
      let expected: number[];
      if (field === 'cap_space') {
        expected = [result.cap.current_year_cap_space_created_dollars];
      } else if (field === 'dead_money') {
        expected = [
          result.cap.current_year_dead_money_dollars,
          ...(result.cap.next_year ? [result.cap.next_year.accelerated_dead_money_dollars] : []),
        ];
      } else if (field === 'scheduled_cap') {
        expected = [
          result.cap.current_cap_number_dollars,
          ...(result.cap.next_year ? [result.cap.next_year.scheduled_cap_dollars] : []),
        ];
      } else {
        expected = result.cap.next_year ? [result.cap.next_year.cap_effect_dollars] : [];
      }
      if (!expected.some((value) => moneyClaimMatches(claim, value))) {
        issues.push(`The ${field.replaceAll('_', ' ')} figure ${claim.raw} does not match that field in the seller calculation.`);
      }
    }
  }
}

function validateSellerProposalClaims(
  answer: string,
  sellerMoveAnalysis: NflSellerMoveConversationArtifact | null,
  issues: string[],
): void {
  const result = sellerMoveAnalysis?.result;
  if (!result) return;
  const player = escapeRegExp(result.player.player_name);
  const round = '(first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th)?|R[1-7]|Round\\s+[1-7])';
  const patterns = [
    new RegExp(`\\b(20\\d{2})\\s+${round}(?:[-\\s]+round)?(?:[-\\s]+pick)?[^.!?]{0,35}\\bfor\\s+${player}\\b`, 'gi'),
    new RegExp(`\\b${player}\\b[^.!?]{0,35}\\bfor\\s+(?:a\\s+)?(20\\d{2})\\s+${round}`, 'gi'),
  ];
  for (const pattern of patterns) {
    for (const match of answer.matchAll(pattern)) {
      const year = Number(match[1]);
      const pickRound = parseRoundClaim(match[2]);
      if (year !== result.proposal.pick_year || pickRound !== result.proposal.pick_round) {
        issues.push(`The interpretation changes the user proposal to ${year} round ${pickRound ?? 'unknown'}.`);
      }
    }
  }
}

type MoneyClaim = {
  raw: string;
  amount: number;
  unit: 'dollars' | 'thousand' | 'million';
  decimals: number;
  index: number;
};

function moneyClaims(value: string): MoneyClaim[] {
  const claims: MoneyClaim[] = [];
  const pattern = /(\$)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(million|thousand|[mk])?\b/gi;
  for (const match of value.matchAll(pattern)) {
    if (!match[1] && !match[3]) continue;
    const numeric = Number(match[2].replaceAll(',', ''));
    if (!Number.isFinite(numeric)) continue;
    const suffix = (match[3] ?? '').toLowerCase();
    claims.push({
      raw: match[0].trim(),
      amount: numeric,
      unit: suffix === 'm' || suffix === 'million' ? 'million' : suffix === 'k' || suffix === 'thousand' ? 'thousand' : 'dollars',
      decimals: match[2].split('.')[1]?.length ?? 0,
      index: match.index ?? 0,
    });
  }
  return claims;
}

function nearestMoneyField(
  value: string,
  claimIndex: number,
): 'cap_space' | 'dead_money' | 'scheduled_cap' | 'cap_effect' | null {
  const patterns: Array<{
    field: 'cap_space' | 'dead_money' | 'scheduled_cap' | 'cap_effect';
    regex: RegExp;
  }> = [
    { field: 'cap_space', regex: /\b(?:cap space|space created|cap savings|cap relief)\b/gi },
    { field: 'dead_money', regex: /\b(?:dead money|dead cap|accelerat(?:ed|ing|ion)|dead)\b/gi },
    { field: 'scheduled_cap', regex: /\b(?:scheduled cap|cap number|cap hit)\b/gi },
    { field: 'cap_effect', regex: /\b(?:next[- ]year cap effect|cap effect)\b/gi },
  ];
  const afterClaim = value.slice(claimIndex);
  const afterCandidates = patterns.flatMap(({ field, regex }) => (
    [...afterClaim.matchAll(regex)].map((match) => ({ field, distance: match.index ?? 0 }))
  ));
  if (afterCandidates.length > 0) {
    return afterCandidates.sort((left, right) => left.distance - right.distance)[0].field;
  }
  const candidates = patterns.flatMap(({ field, regex }) => (
    [...value.matchAll(regex)].map((match) => ({ field, distance: Math.abs((match.index ?? 0) - claimIndex) }))
  ));
  return candidates.sort((left, right) => left.distance - right.distance)[0]?.field ?? null;
}

function moneyClaimMatches(claim: MoneyClaim, expectedDollars: number): boolean {
  const expected = Math.abs(expectedDollars);
  const divisor = claim.unit === 'million' ? 1_000_000 : claim.unit === 'thousand' ? 1_000 : 1;
  return claim.amount === Number((expected / divisor).toFixed(claim.decimals));
}

function parseRoundClaim(value: string): number | null {
  const normalized = value.toLowerCase()
    .replace(/^round\s+/, '')
    .replace(/^([1-7])(?:st|nd|rd|th)$/, '$1')
    .replace(/^r/, '');
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
  const parsed = words[normalized] ?? Number(normalized);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 7 ? parsed : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function numericTokens(text: string): string[] {
  return [...text.matchAll(/(?<![A-Za-z0-9_.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![A-Za-z0-9_.])/g)]
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

function validateDeclaredPeriods(
  text: string,
  analysis: NflTransactionMarketAnalysis,
  issues: string[],
): void {
  const allowed = new Set([
    analysis.query.baseline_years,
    analysis.query.recent_years,
    [analysis.query.start_year, analysis.query.end_year] as [number, number],
  ].map(([start, end]) => `${start}:${end}`));
  for (const match of text.matchAll(/\b((?:19|20)\d{2})\s*(?:[–—-]|to|through)\s*((?:19|20)\d{2})\b/gi)) {
    const pair = `${Number(match[1])}:${Number(match[2])}`;
    if (!allowed.has(pair)) issues.push(`Period ${match[1]}–${match[2]} does not match the executed analysis windows.`);
  }
}

function validateDeclaredScope(
  text: string,
  analysis: NflTransactionMarketAnalysis,
  issues: string[],
): void {
  const expected = new Set(analysis.query.team_ids);
  for (const sentence of proseSentences(text)) {
    if (!/\b(?:executed filters?|executed scope|analysis (?:covers?|covered|for)|filtered to|team scope)\b/i.test(sentence)) continue;
    const leaguewide = /\b(?:leaguewide|league-wide|across the nfl|nfl-wide|all teams?)\b/i.test(sentence);
    if (leaguewide && expected.size > 0) {
      issues.push('The prose claims a leaguewide scope, but the executed analysis is team-filtered.');
    }
    const claimed = new Set(teamIdsFromQuestion(sentence));
    if (claimed.size > 0 && !sameSet(claimed, expected)) {
      issues.push(`The prose team scope (${[...claimed].join(', ')}) does not match the executed filters (${[...expected].join(', ') || 'leaguewide'}).`);
    }
  }
}

function validateDeclaredTransactionTypes(
  text: string,
  analysis: NflTransactionMarketAnalysis,
  issues: string[],
): void {
  const actual = new Set(analysis.query.transaction_types);
  if (/\b(?:trades? only|only trades?)\b/i.test(text) && !sameSet(actual, new Set(['trade']))) {
    issues.push('The prose claims trades-only scope, but the executed transaction filters differ.');
  }
  const contractTypes = new Set(['free_agent_signing', 're_signing', 'extension', 'tag']);
  if (/\b(?:contracts? only|only contracts?)\b/i.test(text) && !sameSet(actual, contractTypes)) {
    issues.push('The prose claims contracts-only scope, but the executed transaction filters differ.');
  }
  const materialTypes = new Set(['trade', 'free_agent_signing', 're_signing', 'extension', 'tag', 'waiver_claim', 'release']);
  if (/\b(?:all (?:material moves?|transaction types?)|every material move)\b/i.test(text) && !sameSet(actual, materialTypes)) {
    issues.push('The prose claims the full material-moves cohort, but the executed transaction filters differ.');
  }
}

function validatePositionSignalNumbers(
  text: string,
  analysis: NflTransactionMarketAnalysis,
  issues: string[],
): void {
  for (const sentence of proseSentences(text)) {
    const mentioned = interpretationPositionTrends(sentence, analysis);
    if (mentioned.length !== 1) continue;
    const trend = mentioned[0];
    for (const clause of interpretationClauses(sentence)) {
      const signal = signalForClaim(clause, trend);
      if (signal == null) continue;
      const allowed = typeof signal === 'number'
        ? new Set([normalizeNumber(String(signal))])
        : signalNumericVariants(signal, clause);
      if (/\b(?:event count|events? (?:analyzed|observed)|cohort (?:of )?\d+ events?)\b/i.test(clause)) {
        allowed.add(normalizeNumber(String(trend.event_count)));
      }
      for (const token of numericTokens(clause)) {
        const value = Number(token);
        if ((value >= 1900 && value <= 2100) || ['5', '10', '20', '85', '95', '100'].includes(normalizeNumber(token))) continue;
        if (!allowed.has(normalizeNumber(token))) {
          issues.push(`Numeric token ${token} is not attached to the claimed ${trend.position_group} signal in the deterministic artifact.`);
        }
      }
    }
  }
}

function signalForClaim(
  clause: string,
  trend: NflPositionMarketTrend,
): NflPositionMarketTrend['mobility'] | number | null {
  if (/\b(?:trade price|trade returns?|compensation|premium[- ]pick|day[- ]one|day[- ]two|pick share)\b/i.test(clause)) return trend.trade_compensation;
  if (/\b(?:contract price|apy|guaranteed share|salary[- ]cap price)\b/i.test(clause)) return trend.contract_price;
  if (/\b(?:move share|share of (?:league(?:wide|-wide)? )?(?:material moves|trades))\b/i.test(clause)) return trend.transaction_share;
  if (/\b(?:mobility|player movement|trade activity|market volume|material[- ]move rate|(?:events?|moves?|trades?) per 100)\b/i.test(clause)) return trend.mobility;
  if (/\b(?:material events?|event count|transactions? observed)\b/i.test(clause)) return trend.event_count;
  return null;
}

function signalNumericVariants(
  signal: NflPositionMarketTrend['mobility'],
  clause: string,
): Set<string> {
  const values = new Set<string>();
  const candidates = [
    signal.overall_value,
    signal.baseline_value,
    signal.recent_value,
  ];
  const per100Rate = signal.unit === 'events_per_100_player_seasons' && /\bper 100\b/i.test(clause);
  for (const candidate of per100Rate ? candidates : [...candidates, signal.relative_change_basis_points]) {
    for (const token of per100Rate ? rateNumericVariants(candidate) : artifactNumericVariants(candidate)) values.add(token);
  }
  if (signal.baseline_value != null && signal.recent_value != null) {
    const difference = signal.recent_value - signal.baseline_value;
    for (const token of per100Rate ? rateNumericVariants(difference) : artifactNumericVariants(difference)) values.add(token);
  }
  if (/\b(?:sample(?: size)?|observations?|contracts? observed|trades? observed)\b/i.test(clause)) {
    values.add(normalizeNumber(String(signal.sample_size)));
  }
  return values;
}

function rateNumericVariants(value: unknown): Set<string> {
  const values = new Set<string>();
  if (typeof value !== 'number' || !Number.isFinite(value)) return values;
  for (const candidate of new Set([value, Math.abs(value)])) {
    for (const precision of [0, 1, 2, 3]) {
      values.add(normalizeNumber((candidate / 100).toFixed(precision)));
    }
  }
  return values;
}

function artifactNumericVariants(value: unknown): Set<string> {
  const values = new Set<string>();
  const visit = (candidate: unknown) => {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      for (const numeric of new Set([candidate, Math.abs(candidate)])) {
        values.add(normalizeNumber(String(numeric)));
        values.add(normalizeNumber((numeric / 100).toFixed(1)));
        values.add(normalizeNumber((numeric / 100).toFixed(2)));
        values.add(normalizeNumber(Math.round(numeric / 1_000).toString()));
        values.add(normalizeNumber((numeric / 1_000_000).toFixed(1)));
      }
    } else if (Array.isArray(candidate)) {
      candidate.forEach(visit);
    } else if (candidate && typeof candidate === 'object') {
      Object.values(candidate as Record<string, unknown>).forEach(visit);
    }
  };
  visit(value);
  return values;
}

function normalizeNumber(value: string): string {
  return Number(value).toString();
}

function proseSentences(text: string): string[] {
  // Decimal points are part of governed numeric values, not sentence breaks.
  return text.split(/\n|(?<!\d)\.|\.(?!\d)/);
}

function interpretationClauses(sentence: string): string[] {
  return sentence.split(/;|\b(?:but|while|whereas|yet|without)\b|,\s+(?=and\s)/i);
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function actionNameCandidates(text: string): string[] {
  const names = new Set<string>();
  const token = "[A-Z][A-Za-z'’-]+";
  const subject = new RegExp(`\\b(${token}(?:[ \\t]+${token})?)\\s+(?:was\\s+)?(?:traded|signed|acquired|released|extended)\\b`, 'g');
  const object = new RegExp(`\\b(?:traded|signed|acquired|released|extended)\\s+(${token}(?:[ \\t]+${token})?)\\b`, 'g');
  for (const match of text.matchAll(subject)) names.add(match[1]);
  for (const match of text.matchAll(object)) names.add(match[1]);
  return [...names];
}

function matchesArtifactName(candidate: string, artifactNames: Set<string>): boolean {
  const normalized = candidate.toLowerCase();
  if (artifactNames.has(normalized)) return true;
  if (normalized.includes(' ')) return false;
  return [...artifactNames].some((name) => name.split(/\s+/).at(-1) === normalized);
}
