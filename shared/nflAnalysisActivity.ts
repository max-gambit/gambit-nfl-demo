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
