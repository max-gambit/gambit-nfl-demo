import {extractBudget} from '../nfl_contracts/input_provenance.js';
import type { NflConversationState, NflObjective, NflScenarioState } from '@shared/nflConversation';
const objectives: NflObjective[] = ['acquisition','internal_roster','contract','college','availability','coaching','rules','history'];
const list = (v: unknown): string[] => {
  if (!Array.isArray(v) || v.length > 20 || v.some(x => typeof x !== 'string' || x.length > 1000)) throw new Error('Invalid scenario list.');
  return [...new Set(v as string[])];
};
export function userMoneyAmounts(question: string): number[] {
  return [...question.matchAll(/(?:\$\s*([\d,.]+)\s*(million|billion|[mk])?\b|\b([\d,.]+)\s*(million|billion|[mk]|dollars)\b)/gi)].map(m=>Number((m[1]??m[3]).replaceAll(',',''))*(/^(million|m)$/i.test(m[2]??m[4]??'')?1e6:/^billion$/i.test(m[2]??m[4]??'')?1e9:/^k$/i.test(m[2]??m[4]??'')?1e3:1));
}
export function updateNflConversationState(input: unknown, previous: NflConversationState | undefined, question: string, budgetBeforeTurn?: NflScenarioState['budget']): NflConversationState {
  if (!input || typeof input !== 'object') throw new Error('Scenario must be an object.');
  const a = input as Record<string, unknown>;
  if (a.operation === 'restore') {
    const restored = [previous?.active, ...(previous?.saved ?? [])].find(s => s?.id === a.restore_id);
    if (!restored) throw new Error('Unknown earlier scenario. Use one of the saved scenario IDs.');
    return { schema_version: 1, active: structuredClone(restored), saved: [previous!.active, ...previous!.saved].filter(s => s.id !== restored.id).slice(0,8) };
  }
  if (!objectives.includes(a.objective as NflObjective)) throw new Error('Choose a supported scenario objective.');
  const objective = a.objective as NflObjective;
  const refine = previous?.active.objective === objective;
  const compatibleFinancial=!!previous&&['acquisition','contract'].includes(previous.active.objective)&&['acquisition','contract'].includes(objective);
  const active: NflScenarioState = refine ? structuredClone(previous.active) : {
    id: 'scenario-' + crypto.randomUUID(), objective, team_id: previous?.active.team_id ?? 'NYG', horizon: '', budget: null,
    protected_player_names: [], candidate_scope: 'unspecified', transaction: 'none', scenario_date: null,
    supplied_terms: [], unresolved_inputs: [], assumptions: [],
  };
  if(!refine&&compatibleFinancial){active.budget=structuredClone(previous!.active.budget);active.protected_player_names=[...previous!.active.protected_player_names];}
  for (const k of ['horizon','team_id'] as const) if (k in a) {
    if (typeof a[k] !== 'string' || a[k].length > 150) throw new Error('Invalid ' + k);
    active[k] = a[k];
  }
  for (const k of ['protected_player_names','supplied_terms','unresolved_inputs','assumptions'] as const) if (k in a) active[k] = list(a[k]);
  if ('candidate_scope' in a) {
    if (!['external','internal','both','unspecified'].includes(String(a.candidate_scope))) throw new Error('Invalid candidate scope.');
    active.candidate_scope = a.candidate_scope as NflScenarioState['candidate_scope'];
  }
  if ('transaction' in a) {
    if (!['none','trade','release','restructure','acquire','hold'].includes(String(a.transaction))) throw new Error('Invalid transaction.');
    active.transaction = a.transaction as NflScenarioState['transaction'];
  }
  if ('scenario_date' in a) {
    if (a.scenario_date !== null && (typeof a.scenario_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(a.scenario_date) || !Number.isFinite(Date.parse(a.scenario_date)))) throw new Error('Invalid scenario date.');
    active.scenario_date = a.scenario_date as string | null;
  }
  if ('budget' in a) {
    if (a.budget === null) {
      if(compatibleFinancial&&active.budget&&!/(?:^|[.!?]\s*)(?:remove|drop|clear|ignore) (?:the )?(?:cap |cash )?budget/i.test(question))throw new Error('Retain the compatible budget unless the user explicitly removes it.');
      active.budget = null;
    }
    else {
      const b = a.budget as { type: 'cap'|'cash'; amount: number; reserve: number };
      if (!['cap','cash'].includes(b.type) || ![b.amount,b.reserve].every(x => Number.isFinite(x) && x >= 0)) throw new Error('Invalid budget; label cap versus cash explicitly.');
      const amounts=extractBudget(question,b.type,budgetBeforeTurn??previous?.active.budget??undefined);const reserves=extractBudget(question,'reserve');
      for(const [field,candidates]of [['amount',amounts],['reserve',reserves]] as const){
        const old=previous?.active.budget;
        if(new Set(candidates).size>1||candidates.length&&candidates.some(n=>n!==b[field]))throw new Error('Budget and reserve must match the separately supplied amounts.');
        if(!candidates.length&&!(old&&old.type===b.type&&old[field]===b[field]))throw new Error('Do not invent a budget or reserve. Supply its amount and cap/cash basis explicitly.');
      }
      if(extractBudget(question,b.type==='cap'?'cash':'cap').length)throw new Error('Do not change cash to cap or cap to cash.');
      active.budget = { ...b };
    }
  }
  // A change in objective starts a new constraint set. Keep the prior scenario
  // available for an explicit return; do not silently inherit its filters.
  return { schema_version: 1, active, saved: refine ? previous!.saved : [ ...(previous ? [previous.active] : []), ...(previous?.saved ?? []) ].slice(0,8) };
}
export const nflScenarioTool = {
  name: 'set_scenario', description: 'Persist the interpreted objective and explicit assumptions. On a new objective, code clears the prior budget, transaction, exclusions and supplied terms; restate only compatible user constraints. Restore an earlier scenario with its ID when asked to return to it. A vague affordability preference must leave budget null. Use before a calculation or an explicit scenario restore. For other turns include scenario in finish_analysis instead.',
  input_schema: { type: 'object' as const, properties: {
    operation: {type:'string',enum:['update','restore']}, restore_id:{type:'string'}, objective:{type:'string',enum:objectives}, team_id:{type:'string'}, horizon:{type:'string'},
    candidate_scope:{type:'string',enum:['external','internal','both','unspecified']},transaction:{type:'string',enum:['none','trade','release','restructure','acquire','hold']},scenario_date:{type:['string','null']},
    budget:{anyOf:[{type:'null'},{type:'object',properties:{type:{type:'string',enum:['cap','cash']},amount:{type:'number',minimum:0},reserve:{type:'number',minimum:0}},required:['type','amount','reserve'],additionalProperties:false}]},
    ...Object.fromEntries(['protected_player_names','supplied_terms','unresolved_inputs','assumptions'].map(k=>[k,{type:'array',items:{type:'string'}}])),
  }, required:['operation'], additionalProperties:false },
};
