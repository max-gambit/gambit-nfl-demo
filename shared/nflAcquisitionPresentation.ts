import type { DataAnalysisBriefBody, DataAnalysisTable } from './types';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const amount = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

function includesCost(text: string, expected: number, kind: 'cap' | 'cash'): boolean {
  for (const match of text.matchAll(/\$([\d,]+(?:\.\d+)?)\s*(million|billion|thousand|[mbk])?\b/gi)) {
    const value = Number(match[1].replaceAll(',', '')) * (/^(million|m)$/i.test(match[2] ?? '') ? 1e6 : /^(billion|b)$/i.test(match[2] ?? '') ? 1e9 : /^(thousand|k)$/i.test(match[2] ?? '') ? 1e3 : 1);
    if (value !== expected) continue;
    const before = text.slice(Math.max(0, match.index! - 70), match.index);
    const after = text.slice(match.index! + match[0].length);
    const metric = kind === 'cap' ? 'cap(?:\\s+(?:space|charge|cost|hit))?' : 'cash(?:\\s+(?:paid|cost|payment))?';
    // A matching budget or reserve amount is not the player's acquisition cost.
    if (new RegExp('^\\s*(?:(?:of|in)\\s+)?(?:Giants\\s+)?' + metric + '\\b(?!\\s+budget)', 'i').test(after)
      || new RegExp('\\b' + metric + '\\s+(?:(?:is|of|at|equals)\\s+)?$', 'i').test(before)) return true;
  }
  return false;
}

export interface NflAcquisitionSummary {
  player: string;
  illustrative: boolean;
  years: Array<{ year: number; cap: number | null; cash: number | null }>;
  sourceRefs: number[];
}

/** Show the executed incoming-player costs separately from any funding moves. */
export function nflAcquisitionSummary(body: DataAnalysisBriefBody): NflAcquisitionSummary | null {
  const result = record(body.contract_scenario?.result);
  const moves = Array.isArray(result.moves) ? result.moves.map(record).filter(move => move.action === 'acquire') : [];
  if (moves.length !== 1 || moves[0].status === 'blocked' || typeof moves[0].player_name !== 'string') return null;
  const move = moves[0];
  const years = Array.isArray(move.years) ? move.years.map(record).filter(row => Number.isInteger(row.year)).map(row => ({ year: row.year as number, cap: amount(row.cap_after), cash: amount(row.cash_after) })) : [];
  const sourceRefs = [...new Set((body.contract_scenario?.tables ?? []).flatMap(table => table.source_refs))];
  if (!years.length || !sourceRefs.length) return null;
  return { player: move.player_name as string, illustrative: move.status === 'illustrative', years, sourceRefs };
}

/** Clarify earlier saved funding wording without changing numbers or stored records. */
export function acquisitionAnswerPresentation(body: DataAnalysisBriefBody): DataAnalysisBriefBody {
  if (!body.cap_strategy || !body.contract_scenario) return body;
  if (body.ai_analysis && body.ai_analysis.outcome !== 'complete') return body;
  const strategy = record(body.cap_strategy);
  const decision = record(strategy.decision);
  const budget = record(record(strategy.discovery_inputs).budget);
  const noConversion = decision.kind === 'no_funding' && decision.funding_gap === 0 && budget.type === 'cap';
  const prose = (text: string) => {
    const clarified = budget.type === 'cap' ? text.replace(/\bwithout funding\b/gi, 'without a salary conversion') : text;
    return noConversion ? clarified.replace(/\bMinimum funding needed is \$0\.?/gi, 'No salary conversion is needed.').replace(/\brequire no funding\b/gi, 'need no salary conversion') : clarified;
  };
  const table = (value: DataAnalysisTable): DataAnalysisTable => {
    if (!['Minimum funding decision', 'Acquisition cost and budget fit'].includes(value.title)) return value;
    const label = value.columns.indexOf('Alternative');
    if (label < 0) return value;
    return { ...value, title: 'Acquisition cost and budget fit', rows: value.rows.map(row => row.map((cell, index) => index !== label ? cell
      : cell === 'Hold / no acquisition' ? 'Do not acquire · no added cost'
      : cell === 'Acquire without funding' || cell === 'Acquisition without funding moves' ? noConversion ? 'Acquire · use existing cap room' : 'Acquire · no salary conversion'
      : cell === 'Acquire + minimum conversion' ? 'Acquire + minimum salary conversion' : cell)) };
  };
  const paragraphs = (body.answer_paragraphs?.length ? body.answer_paragraphs : body.answer.split(/\n\s*\n/).map(text => ({ text, source_refs: body.answer_source_refs ?? [] }))).map(paragraph => ({ ...paragraph, text: prose(paragraph.text) }));
  const summary = nflAcquisitionSummary(body);
  const season = record(strategy.discovery_inputs).season;
  const current = summary?.years.find(year => year.year === season);
  const opening = paragraphs[0];
  if (opening && summary && current?.cap != null && current.cash != null) {
    if (!includesCost(opening.text, current.cap, 'cap') || !includesCost(opening.text, current.cash, 'cash')) {
      const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
      opening.text = `${summary.illustrative ? 'On the illustrative terms, ' : ''}${summary.player} would use ${money(current.cap)} of cap space and ${money(current.cash)} in cash in ${current.year}. ` + opening.text;
      opening.source_refs = [...new Set([...summary.sourceRefs, ...opening.source_refs])];
    }
  }
  return { ...body, answer: paragraphs.map(paragraph => paragraph.text).join('\n\n'), answer_paragraphs: paragraphs,
    tables: body.tables.map(table), contract_scenario: { ...body.contract_scenario, tables: body.contract_scenario.tables?.map(table) } };
}
