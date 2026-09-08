import type {
  DataAnalysisBriefBody, DataAnalysisFinding, DataAnalysisTable,
  NflSellerMoveResponse, NflTransactionComparable, NflTransactionMarketAnalysis,
  NflTransactionMarketSignal,
} from './types';
import { factualBody } from './nflFacts';
import { nflTransactionMarketCohortEvidence, nflTransactionTradePackageLines } from './nflTransactionMarket';

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const period = (years: [number, number]) => years[0] === years[1] ? String(years[0]) : years.join('–');
const inPeriod = (year: number, years: [number, number]) => year >= years[0] && year <= years[1];
const number = (n: number) => n.toLocaleString('en-US');
const valid = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

function refs(analysis: NflTransactionMarketAnalysis, ids?: string[]): number[] {
  return analysis.source_refs.flatMap((source, index) => !ids || ids.includes(source.id) ? [index + 1] : []);
}

function signalComparison(signal: NflTransactionMarketSignal) {
  const rate = signal.unit === 'events_per_100_player_seasons';
  const display = (value: number | null) => valid(value) ? `${(value / 100).toFixed(2)}${rate ? '' : '%'}` : 'Not recorded';
  const comparable = signal.status !== 'insufficient_evidence' && valid(signal.baseline_value) && valid(signal.recent_value);
  const difference = comparable ? (signal.recent_value! - signal.baseline_value!) / 100 : null;
  return {
    baseline: display(signal.baseline_value), recent: display(signal.recent_value),
    change: difference == null ? 'Comparison unavailable' : `${difference > 0 ? '+' : ''}${difference.toFixed(2)} ${rate ? 'per 100' : 'percentage points'}`,
    comparable,
  };
}

/** Narrative, samples and arithmetic all come from the same saved calculation. */
export function factualMarketAnswer(analysis: NflTransactionMarketAnalysis): DataAnalysisBriefBody {
  const { query, coverage } = analysis;
  const baseline = period(query.baseline_years), recent = period(query.recent_years);
  const tradeOnly = query.transaction_types.length === 1 && query.transaction_types[0] === 'trade';
  const scope = query.position_groups.join(', ') || 'all positions';
  const evidence = nflTransactionMarketCohortEvidence(analysis);
  const trends = [...analysis.position_trends].sort((a, b) => a.position_group.localeCompare(b.position_group));
  const findings: DataAnalysisFinding[] = [];
  const comparisonRows: DataAnalysisTable['rows'] = [];

  for (const trend of trends) {
    const annual = analysis.yearly_series.filter(row => row.position_group === trend.position_group);
    const earlier = annual.filter(row => inPeriod(row.year, query.baseline_years));
    const later = annual.filter(row => inPeriod(row.year, query.recent_years));
    const count = (rows: typeof annual) => rows.reduce((sum, row) => sum + row.event_count, 0);
    const denominator = (rows: typeof annual) => rows.reduce((sum, row) => sum + row.roster_player_seasons, 0);
    const movement = signalComparison(trend.mobility);
    if (movement.comparable && trends.indexOf(trend) < 3) {
      findings.push({
        label: `${trend.position_group} · activity over the two periods`,
        body: `${baseline} contains ${number(count(earlier))} player events across ${number(denominator(earlier))} roster player-seasons; ${recent} contains ${number(count(later))} across ${number(denominator(later))}. The rate is ${movement.baseline} → ${movement.recent} events per 100 roster player-seasons (${movement.change}). These are rates over the stated windows, not forecasts.`,
        source_refs: refs(analysis),
      });
    }
    const metrics: Array<[string, NflTransactionMarketSignal]> = [
      ['Events per 100 roster player-seasons', trend.mobility],
      ['Share of league transaction events', trend.transaction_share],
      ...(coverage.trade_count ? [['Single-player trades returning rounds 1–3', trend.trade_compensation] as [string, NflTransactionMarketSignal]] : []),
      ...(coverage.contract_count ? [['Median contract APY / league cap', trend.contract_price] as [string, NflTransactionMarketSignal]] : []),
    ];
    for (const [label, signal] of metrics) {
      const row = signalComparison(signal);
      comparisonRows.push([trend.position_group, label, row.baseline, row.recent, row.change]);
    }
    if (evidence.complete && coverage.trade_count && trends.indexOf(trend) < 3) {
      const rows = evidence.rows.filter(row => row.position_group === trend.position_group && row.transaction_type === 'trade');
      const priced = (years: [number, number]) => rows.filter(row => inPeriod(row.event_year, years) && row.compensation_band != null && row.compensation_band !== 'unknown');
      const a = priced(query.baseline_years), b = priced(query.recent_years);
      const rounds123 = (rows: typeof a) => rows.filter(row => row.compensation_band === 'round_1' || row.compensation_band === 'rounds_2_3').length;
      findings.push({
        label: `${trend.position_group} · what the draft-return percentages contain`,
        body: `${baseline}: ${rounds123(a)} of ${a.length} trades with an allocable single-player return include a round 1–3 pick. ${recent}: ${rounds123(b)} of ${b.length}. Each trade is classified by its earliest returned round. Multi-player packages remain in the historical record but receive no per-player draft-return percentage.${trend.trade_compensation.status === 'insufficient_evidence' ? ' The comparison does not meet the saved analysis’s minimum evidence requirements.' : ''}`,
        source_refs: refs(analysis, ['trades']),
      });
    }
  }

  const lead = `${query.start_year}–${query.end_year} contains ${number(coverage.event_count)} ${scope} player ${tradeOnly ? 'trade events' : 'movement events'}${coverage.distinct_trade_count != null && coverage.trade_count ? ` across ${number(coverage.distinct_trade_count)} distinct trades${tradeOnly ? '' : ', plus the other selected transaction types'}` : ''}. The comparison below separates transaction frequency, the position’s share of league activity${coverage.trade_count ? ', and the recorded draft returns' : ''}${coverage.contract_count ? ', and contract APY relative to the league cap' : ''}.`;
  const periodNote = `Comparing ${baseline} with ${recent}. ${query.team_ids.length ? `Team filter: ${query.team_ids.join(', ')} (either side of a transaction). ` : ''}${query.include_ytd ? `${query.end_year} is a partial year and is shown separately from the completed-year period comparison. ` : ''}Every value uses the selected historical scope.`;
  return factualBody({
    answer_layout: 'market_overview', answer: `${lead}\n\n${periodNote}`,
    key_findings: findings,
    tables: [{ title: 'Period comparison', columns: ['Position', 'Measure', baseline, recent, 'Change'], rows: comparisonRows, source_refs: refs(analysis) }],
    calculations: [],
    caveats: [
      'Player events count recorded player movements; one trade can contain multiple player events. Draft-return percentages describe only allocable single-player trades, not every recorded package or the value of a current player.',
      ...(evidence.complete ? [] : [evidence.summary]),
      'Historical transactions do not establish current availability, asking prices or a forecast. Missing inputs remain unreported.',
      ...analysis.limitations,
    ],
    followups: [query.position_groups.length === 1 ? `Compare ${query.position_groups[0]} with ${query.position_groups[0] === 'IOL' ? 'EDGE' : 'IOL'} over the same period.` : `What changed after ${Math.floor((query.start_year + query.end_year) / 2)}?`, 'Show the complete trade packages.', 'Which trades returned a first-round pick?'],
    market_analysis: analysis,
  });
}

/** Exact chronological examples; selection never uses a football grade or valuation. */
export function marketExampleTrades(analysis: NflTransactionMarketAnalysis, year?: number) {
  const evidence = nflTransactionMarketCohortEvidence(analysis);
  const byDate = (a: NflTransactionComparable, b: NflTransactionComparable) =>
    b.event_year - a.event_year || (b.event_date ?? '').localeCompare(a.event_date ?? '') || a.event_id.localeCompare(b.event_id);
  const trades = evidence.rows.filter(row => row.transaction_type === 'trade' && (year == null || row.event_year === year)).sort(byDate);
  const firstRound = year == null ? trades.filter(row => row.trade_package?.assets.some(asset =>
    asset.asset_type === 'draft_pick' && asset.pick_round === 1 && asset.received_team_id === row.from_team_id)) : [];
  const selected = [...new Map((firstRound.length ? firstRound : trades).map(row => [row.trade_id ?? row.event_id, row])).values()];
  return {
    rows: selected.slice(0, 3),
    title: year != null ? `${year} recorded trade packages` : firstRound.length ? 'Recorded trades returning a first-round pick' : 'Recent recorded trade packages',
    selection: `${Math.min(3, selected.length)} ${evidence.complete ? 'latest qualifying trades in this cohort' : 'examples from the saved sample'}, ordered by recorded date.${firstRound.length ? ' Each includes a first-round pick received by the player’s former team.' : ''} Whole packages are shown on both sides.`,
  };
}

export function marketAnnualRows(analysis: NflTransactionMarketAnalysis) {
  const byYear = new Map<number, { year: number; events: number; rosterPlayerSeasons: number; partial: boolean }>();
  for (const row of analysis.yearly_series) {
    const point = byYear.get(row.year) ?? { year: row.year, events: 0, rosterPlayerSeasons: 0, partial: analysis.query.include_ytd && row.year === analysis.query.end_year };
    point.events += row.event_count;
    point.rosterPlayerSeasons += row.roster_player_seasons;
    byYear.set(row.year, point);
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

export function factualSellerAnswer(body: DataAnalysisBriefBody): DataAnalysisBriefBody {
  const result = body.seller_move_analysis?.result;
  if (!result) return body;
  const { cap, player, proposal } = result;
  const next = cap.next_year;
  const capRows: DataAnalysisTable['rows'] = [[cap.current_year, money(cap.current_cap_number_dollars), money(cap.current_year_dead_money_dollars), money(cap.current_year_cap_space_created_dollars)]];
  if (next) capRows.push([next.year, money(next.scheduled_cap_dollars), money(next.accelerated_dead_money_dollars), money(next.cap_effect_dollars)]);
  const market = body.market_analysis;
  const cohort = market ? nflTransactionMarketCohortEvidence(market).rows : [];
  const returns = result.comparables.map(row => {
    const full = cohort.find(event => event.event_id === row.event_id);
    return [row.player_name, row.event_date ?? String(row.event_year), `${row.from_team_id} → ${row.to_team_id}`, full && nflTransactionTradePackageLines(full).length ? nflTransactionTradePackageLines(full).join('\n') : `${row.compensation_summary} (full opposing package is not stored in this answer)`];
  });
  return {
    ...body, answer_layout: 'trade_scenario',
    answer: `For a proposed ${proposal.pick_year} round ${proposal.pick_round} return for ${player.player_name}, the recorded ${cap.current_year} contract calculation is ${money(cap.current_cap_number_dollars)} of scheduled cap charge − ${money(cap.current_year_dead_money_dollars)} of dead money = ${money(cap.current_year_cap_space_created_dollars)} of cap space created.${next ? `\n\nThe ${next.year} schedule is ${money(next.scheduled_cap_dollars)}; ${money(next.accelerated_dead_money_dollars)} would remain as accelerated dead money, giving a ${money(next.cap_effect_dollars)} cap-space effect in that year.` : ''}`,
    key_findings: [
      { label: 'Scenario and timing', body: `${cap.accounting_timing}. The ${proposal.pick_year} round ${proposal.pick_round} pick is a user-supplied assumption, not an observed offer. Contract record: ${player.contract_as_of_date}.`, source_refs: [1, 3] },
      { label: 'Historical return sample', body: `${result.market.range_label} ${result.market.sample_size} usable trades in ${result.market.cohort_label}. ${result.market.timing_note}`, source_refs: result.comparables.map((_, i) => i + 4) },
      { label: 'Recorded 2025 usage', body: `${result.depth.basis} These records do not establish the current assignment, replacement suitability or medical availability.`, source_refs: [2] },
    ],
    tables: [
      { title: 'Contract accounting by year', columns: ['Year', 'Scheduled cap charge', 'Dead money under scenario', 'Cap space created'], rows: capRows, source_refs: [1, 3] },
      ...(returns.length ? [{ title: 'Recorded historical packages in the comparison sample', columns: ['Player', 'Date', 'Move', 'Recorded assets on both sides'], rows: returns, source_refs: result.comparables.map((_, i) => i + 4) }] : []),
    ],
  };
}

/** Enrich earlier factual answers from their own saved data without refreshing or replacing it. */
export function factualAnswerPresentation(body: DataAnalysisBriefBody): DataAnalysisBriefBody {
  if (body.language_policy !== 'facts_only_v1') return body;
  if (body.seller_move_analysis?.result) return factualSellerAnswer(body);
  const legacyOverview = !body.key_findings.length && !body.tables.length && /^[\d,]+ matching player events from /.test(body.answer);
  if (body.market_analysis && (body.answer_layout === 'market_overview' || legacyOverview)) return factualMarketAnswer(body.market_analysis);
  return body;
}

export interface ScenarioChange { label: string; before: string; after: string; changed: boolean }
export function sellerScenarioChanges(current: NflSellerMoveResponse, previous: NflSellerMoveResponse | null): ScenarioChange[] {
  if (!previous) return [];
  const a = previous, b = current;
  const fields: Array<[string, string, string]> = [
    ['Player', a.player.player_name, b.player.player_name],
    ['Proposed return', `${a.proposal.pick_year} round ${a.proposal.pick_round}`, `${b.proposal.pick_year} round ${b.proposal.pick_round}`],
    ['Timing', a.cap.accounting_timing, b.cap.accounting_timing],
    ['Contract record', a.player.contract_as_of_date, b.player.contract_as_of_date],
    ['Cap space created', `${a.cap.current_year}: ${money(a.cap.current_year_cap_space_created_dollars)}`, `${b.cap.current_year}: ${money(b.cap.current_year_cap_space_created_dollars)}`],
    ['Dead money', `${a.cap.current_year}: ${money(a.cap.current_year_dead_money_dollars)}`, `${b.cap.current_year}: ${money(b.cap.current_year_dead_money_dollars)}`],
  ];
  if (a.cap.next_year || b.cap.next_year) fields.push(['Following-year cap effect', a.cap.next_year ? `${a.cap.next_year.year}: ${money(a.cap.next_year.cap_effect_dollars)}` : 'Not recorded', b.cap.next_year ? `${b.cap.next_year.year}: ${money(b.cap.next_year.cap_effect_dollars)}` : 'Not recorded']);
  return fields.map(([label, before, after]) => ({ label, before, after, changed: before !== after }));
}
