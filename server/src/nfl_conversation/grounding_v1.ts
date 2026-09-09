import type { DataAnalysisBriefBody } from '@shared/types';
/** A value copied correctly can still be attached to the wrong claim. Keep all
 * quantities in metric-labelled tables/calculations that code owns end to end. */
export function resolveEvidenceProse(value: string, _evidence: Map<string, { body: DataAnalysisBriefBody }>): string {
  if (/highest[- ]upside|most[- ]talented|best (?:talent|athlete)|\d|\$|\{\{|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|dozen|half|quarter)\b/i.test(value)) {
    throw new Error('Keep all numeric values in the tool-owned tables/calculations. Use qualitative prose without quantities or cell tokens. Do not spell numbers out to evade this boundary.');
  }
  return value;
}
