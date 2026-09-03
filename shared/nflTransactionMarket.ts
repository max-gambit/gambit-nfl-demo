import type { Brief, NflTransactionMarketAnalysis } from './types';

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
