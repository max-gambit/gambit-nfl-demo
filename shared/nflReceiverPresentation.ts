import type { DataAnalysisBriefBody } from './types';

export const RECEIVER_COMPARISON_METHODS = {
  receiving_production: 'Ordered by observed full-season receiving yards; this measures production, not projected Giants performance.',
  contract_horizon: 'Ordered by last active contract year where a deep dossier is captured; otherwise the dated snapshot field, with voids unverified. Receiving yards break ties. This does not rank guaranteed liability.',
  inside_role: 'The attributed between-the-hashes assessment is shown first; the other profiles lack a comparable inside-role assessment. This is an evidence ordering, not a scouting grade.',
} as const;

/** A malformed tool response can append its serialization after the actual prose. */
export function cleanNflAnalystProse(value: string): string {
  return value.replace(/^\s*<answer>\s*/i, '').split(/<\/answer\s*>|<\/?parameter\b/i)[0].trim();
}

/** Reorder only the known receiver preamble, using the saved answer's own text. */
export function receiverAnswerPresentation(body: DataAnalysisBriefBody): DataAnalysisBriefBody {
  if (!body.receiver_query || body.ai_analysis?.outcome !== 'complete') return body;
  const cleaned = cleanNflAnalystProse(body.answer);
  const method = Object.values(RECEIVER_COMPARISON_METHODS).find(value => cleaned.startsWith(value));
  if (!method) return cleaned === body.answer ? body : { ...body, answer: cleaned };
  const [preamble, ...paragraphs] = cleaned.split(/\n\s*\n/);
  const interpretation = paragraphs.join('\n\n').trim();
  const records = preamble.slice(method.length).trim();
  // Keep the exact record summary in the lead if no analyst interpretation exists.
  const answer = interpretation || records;
  if (!answer) return body;
  return {
    ...body, answer,
    supporting_details: [
      ...(body.supporting_details ?? []),
      { label: 'Comparison method', body: method, source_refs: body.answer_source_refs ?? [] },
      ...(interpretation && records ? [{ label: 'Recorded comparison', body: records, source_refs: body.answer_source_refs ?? [] }] : []),
    ],
  };
}
