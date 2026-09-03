import type { Brief, NflTransactionMarketAnalysis } from './types';

export interface NflTransactionMarketFootballRead {
  conclusion: string;
  implication: string;
}

export function transactionMarketAnalysisFromBrief(
  brief: Pick<Brief, 'body'>,
): NflTransactionMarketAnalysis | null {
  return brief.body?.kind === 'data_analysis'
    ? brief.body.market_analysis ?? null
    : null;
}

export function latestTransactionMarketBrief(
  briefs: readonly Brief[],
): Brief | null {
  for (let index = briefs.length - 1; index >= 0; index -= 1) {
    if (transactionMarketAnalysisFromBrief(briefs[index])) return briefs[index];
  }
  return null;
}

export function latestTransactionMarketBriefForActiveAnalysis(
  briefs: readonly Brief[],
  activeBriefId: string | null,
  pendingMarketBriefIds: ReadonlySet<string> = new Set(),
): Brief | null {
  const activeBrief = briefs.find((brief) => brief.id === activeBriefId);
  const activeMarketAnalysis = activeBrief && transactionMarketAnalysisFromBrief(activeBrief);
  const pendingMarketAnalysis = activeBrief?.status === 'generating'
    && pendingMarketBriefIds.has(activeBrief.id);
  if (!activeMarketAnalysis && !pendingMarketAnalysis) return null;
  return latestTransactionMarketBrief(briefs);
}

/**
 * Turn governed market signals into a concise football-operations read.
 * This deliberately stays qualitative: the rendered artifact remains the
 * authority for every number, evidence gate, and comparison window.
 */
export function nflTransactionMarketFootballRead(
  analysis: NflTransactionMarketAnalysis,
): NflTransactionMarketFootballRead {
  if (analysis.status === 'insufficient_evidence') {
    return {
      conclusion: 'The current public data is not strong enough to support a market call.',
      implication: 'For New York: treat this as an early read and close the stated data gaps before setting a trade posture.',
    };
  }

  const ranked = [...analysis.position_trends]
    .filter((trend) => trend.status !== 'insufficient_evidence')
    .sort((left, right) => right.event_count - left.event_count);
  const edge = ranked.find((trend) => trend.position_group === 'EDGE');
  const iol = ranked.find((trend) => trend.position_group === 'IOL');
  const exactEdgeIolComparison = ranked.length === 2 && Boolean(edge && iol);
  const tradeOnly = analysis.query.transaction_types.length === 1
    && analysis.query.transaction_types[0] === 'trade';

  if (analysis.query.analysis_mode === 'recent_influence' && analysis.influential_transactions.length > 0) {
    const names = analysis.influential_transactions.slice(0, 4).map((row) => row.player_name);
    return {
      conclusion: `${joinNames(names)} are the recent transactions that most change the reported market result when tested one at a time.`,
      implication: 'For New York: use these deals as the first sensitivity checks on the conclusion, not as proof that any one transaction caused the market trend.',
    };
  }

  if (tradeOnly) {
    const premiumPickLeaders = [...ranked]
      .filter((trend) => trend.trade_compensation.status !== 'insufficient_evidence'
        && trend.trade_compensation.overall_value != null)
      .sort((left, right) => (
        right.trade_compensation.overall_value! - left.trade_compensation.overall_value!
        || right.trade_compensation.sample_size - left.trade_compensation.sample_size
      ))
      .slice(0, 3);
    if (premiumPickLeaders.length > 0) {
      const completedEndYear = analysis.query.include_ytd
        ? analysis.query.end_year - 1
        : analysis.query.end_year;
      return {
        conclusion: `${premiumPickLeaders.map((trend) => `${trend.position_group} (${formatPercent(trend.trade_compensation.overall_value!)})`).join(', ')} posted the highest observed shares of trades returning day-one or day-two picks from ${analysis.query.start_year}–${completedEndYear}.`,
        implication: 'For New York: use those league rates to set opening price expectations, then anchor the actual call to role fit and the closest returned transactions.',
      };
    }
  }

  if (exactEdgeIolComparison && edge && iol) {
    const edgeMovement = movementClause(edge.position_group, edge.mobility.direction);
    const edgeTradePrice = signalIsUsable(edge.trade_compensation)
      ? priceClause('premium trade compensation', edge.trade_compensation.direction)
      : 'premium trade compensation is not precise enough to call';
    const iolMovement = movementClause(iol.position_group, iol.mobility.direction);
    const iolPrice = priceSignalsConflict(iol)
      ? 'its contract-cost and premium-pick trade signals do not agree'
      : usablePriceSignal(iol)
        ? priceClause('its clearest price signal', usablePriceSignal(iol)!.direction)
        : 'its price evidence is not strong enough to call';
    const edgeAction = edge.mobility.direction === 'growing'
      && signalIsUsable(edge.trade_compensation)
      && ['growing', 'flat'].includes(edge.trade_compensation.direction)
      ? 'pay selectively for difference-making EDGE talent'
      : signalIsUsable(edge.trade_compensation)
        ? 'price EDGE targets to the observed compensation range'
        : 'keep EDGE price discipline provisional until more comparable trades are available';
    const iolAction = iol.mobility.direction === 'growing'
      ? 'test whether greater IOL availability creates acquisition leverage'
      : 'validate IOL availability before assuming acquisition leverage';

    return {
      conclusion: `${edgeMovement} and ${edgeTradePrice}. ${iolMovement}, but ${iolPrice}.`,
      implication: `For New York: ${edgeAction} and ${iolAction}.`,
    };
  }

  const lead = ranked.slice(0, 3).map((trend) => {
    const movement = movementClause(trend.position_group, trend.mobility.direction);
    const priceSignal = usablePriceSignal(trend);
    if (priceSignalsConflict(trend)) {
      return `${movement}, while its contract-cost and premium-pick trade signals do not agree`;
    }
    return priceSignal
      ? `${movement}; ${priceClause('its clearest price signal', priceSignal.direction)}`
      : `${movement}; its price evidence is not strong enough to call`;
  });
  const conclusion = lead.length > 0
    ? `${lead.join('. ')}.`
    : 'The requested scope does not contain a position signal strong enough to summarize.';
  const primary = ranked[0];
  const primaryPrice = primary ? usablePriceSignal(primary) : null;
  const implication = primary
    ? primaryPrice
      ? `For New York: negotiate to the observed ${primary.position_group} movement and price range, then test the call against the closest player-level transactions.`
      : `For New York: use the ${primary.position_group} movement read, but keep price posture provisional until more comparable deals are available.`
    : 'For New York: do not set a trade posture until the public data supports a position-level read.';
  return { conclusion, implication };
}

function movementClause(position: string, direction: string): string {
  if (direction === 'growing') return `${position} movement has increased`;
  if (direction === 'shrinking') return `${position} movement has decreased`;
  if (direction === 'flat') return `${position} movement has held broadly steady`;
  return `${position} movement is mixed`;
}

function priceClause(label: string, direction: string): string {
  if (direction === 'growing') return `${label} has strengthened`;
  if (direction === 'shrinking') return `${label} has softened`;
  if (direction === 'flat') return `${label} has held up`;
  return `${label} is mixed`;
}

function usablePriceSignal(
  trend: NflTransactionMarketAnalysis['position_trends'][number],
): NflTransactionMarketAnalysis['position_trends'][number]['trade_compensation'] | null {
  if (signalIsUsable(trend.trade_compensation)) return trend.trade_compensation;
  if (signalIsUsable(trend.contract_price)) return trend.contract_price;
  return null;
}

function priceSignalsConflict(trend: NflTransactionMarketAnalysis['position_trends'][number]): boolean {
  const left = trend.contract_price;
  const right = trend.trade_compensation;
  if (!signalIsUsable(left) || !signalIsUsable(right)) return false;
  if (left.direction === 'mixed' || right.direction === 'mixed') return true;
  return left.direction !== right.direction;
}

function signalIsUsable(
  signal: NflTransactionMarketAnalysis['position_trends'][number]['trade_compensation'],
): boolean {
  return signal.status !== 'insufficient_evidence';
}

function formatPercent(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(1)}%`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'No single transaction';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
