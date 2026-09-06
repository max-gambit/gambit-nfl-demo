import type { NflTransactionMarketAnalysis } from '@shared/types';

/** Keep the full audit record in persistence/UI, while prose uses the bounded sample. */
export function nflTransactionMarketModelContext(analysis: NflTransactionMarketAnalysis): NflTransactionMarketAnalysis {
  const { full_cohort: _fullCohort, ...context } = analysis;
  return context;
}
