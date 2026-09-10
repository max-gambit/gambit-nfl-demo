export interface AnalysisActivity {
  id: string;
  kind: 'reasoning' | 'tool' | 'status';
  text: string;
  status?: 'running' | 'done' | 'failed';
}
export interface AnalysisActivityEvent extends Omit<AnalysisActivity, 'text'> {
  text?: string;
  delta?: string;
}

/** Keep summaries bounded and separate from the checked answer and sources. */
export function updateAnalysisActivity(items: AnalysisActivity[], event: AnalysisActivityEvent): AnalysisActivity[] {
  const previous = items.find(item => item.id === event.id);
  const next: AnalysisActivity = {
    id: event.id, kind: event.kind,
    text: (event.text ?? ((previous?.text ?? '') + (event.delta ?? ''))).slice(0, 12000),
    status: event.status ?? previous?.status,
  };
  return (previous ? items.map(item => item.id === event.id ? next : item) : [...items, next]).slice(-60);
}

// Provider summaries describe both football analysis and the model's own work.
// Keep a complete summary or omit it; never splice away a condition, negate a
// claim, or invent a polished replacement. The original activity stays intact.
const processNarration = [
  /\b(?:tokens?|prompts?|instructions?|guidelines?|developer|system message|json|schema|api|tool(?:s|ing)?|overthink\w*)\b/i,
  /\b(?:user|assistant|chatbot)\b/i,
  /\b(?:word (?:count|limit|budget)|\d+\s*(?:[-–]\s*\d+\s*)?words?|time (?:budget|limit)|remaining time)\b/i,
  /\b(?:my|our|the|this|a|final)\s+(?:answer|response|output)\b/i,
  /\b(?:format(?:ting)?|stylistic|disclaimers?|commentary|boilerplate|concise|verbosity|citations?|source refs?)\b/i,
  /\b(?:I|we)(?:['’](?:ll|m|re|ve)|\s+(?:need|should|must|want|have|will|can))\b[^.!?]{0,65}\b(?:craft|draft|writ|structur|organiz|trim|mention|clarif|respond|quot|reiterat|summari[sz]|articulat)\w*\b/i,
  /\b(?:I|we)(?:['’](?:ll|m|re|ve)|\s+(?:need|should|must|want|have|will|can))\b[^.!?]{0,100}\b(?:checks?|references?|tables?|rows?|paragraphs?|sentences?|requests?|efficient\w*|clear|focused|straightforward|keep it)\b/i,
  /\b(?:let['’]s|make sure|important to ensure|adher\w*|complet\w* (?:this|the) task)\b/i,
];
const footballAnalysis = /\b(?:cap|cash|salary|salaries|contract|conversion|guarantee[ds]?|bonus(?:es)?|prorat\w*|vesting|unpaid|reserve|budget|liabilit\w*|roster|receiv\w*|quarterback|linem[ae]n|tackle|coverage|route[sd]?|target[sd]?|yards?|snaps?|touchdowns?|blocking|pass(?:ing)?|rushing|production|practice|injur\w*|eligib\w*|draft|trade|pick[sd]?|football|CBA|NFL|Giants)\b/i;

/** Display projection for new streams and saved activity; no record changes. */
export function presentAnalysisActivity(items: AnalysisActivity[], live = false): AnalysisActivity[] {
  return items.flatMap(item => {
    if (item.kind === 'status' || item.kind === 'tool' && item.text === toolLabels.finish_analysis) return [];
    if (item.kind !== 'reasoning') return [item];
    // A later delta can turn a football opening into process narration. Wait for
    // this summary to finish, while real tool activity continues immediately.
    if (item.status === 'running' || item.status === 'failed' || live && item.status !== 'done') return [];
    const text = item.text.replace(/\r\n/g, '\n').split(/\n\s*\n/)
      .filter(part => !/^\s*(?:\*\*[^*]+\*\*|#{1,6}\s+[^\n]+)\s*$/.test(part)).join('\n\n').trim();
    if (!text || !footballAnalysis.test(text) || processNarration.some(pattern => pattern.test(text))) return [];
    return [{ ...item, text }];
  });
}

const toolLabels: Record<string, string> = {
  search_player_records: 'Searching player records', read_giants_cap: 'Reading Giants cap figures',
  read_contract_dossiers: 'Reading contracts', read_saved_contract: 'Finding the saved contract',
  read_trade_history: 'Reading trade history', read_nfl_rules: 'Reading NFL rules',
  calculate_contract_scenario: 'Calculating contract costs', nfl_contract_comparison: 'Comparing contract alternatives',
  find_minimum_cap_funding: 'Calculating the cap room needed', set_scenario: 'Updating scenario assumptions',
  finish_analysis: 'Checking the answer', compare_receivers: 'Comparing receivers',
  get_nfl_example_evidence: 'Reading football examples',
  evaluate_nfl_options: 'Evaluating alternatives',
};
export function analysisToolLabel(name: string, input: unknown): string {
  const args = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const names = Array.isArray(args.player_names) ? args.player_names.filter((v): v is string => typeof v === 'string').slice(0, 4)
    : typeof args.player_name === 'string' ? [args.player_name] : [];
  const label = toolLabels[name] ?? 'Reading football evidence';
  return names.length ? `${label} · ${names.join(', ').slice(0, 160)}` : label;
}
