import type { NflContractScenarioArgs, NflContractScenarioResult } from '../nfl_contracts/index.js';
import type { TrustedNflEvaluationCost } from '../nfl_evaluation/index.js';

/** Only server-executed acquisition results may cross into a price gate. A
 * seller cap row, old AI prose or tool-supplied number is never a cost source. */
export function evaluationCostsFromContracts(artifacts: Array<{id:string; args:unknown; result:unknown}>): TrustedNflEvaluationCost[] {
  const latest = new Map<string, TrustedNflEvaluationCost>();
  for (const artifact of artifacts) {
    const args = artifact.args as NflContractScenarioArgs;
    const result = artifact.result as NflContractScenarioResult;
    if (!args || !result || !Array.isArray(result.moves) || result.team_id !== args.team_id || result.season !== args.season) continue;
    for (const move of result.moves.filter(move => move.action === 'acquire')) {
      const year = move.years.find(row => row.year === args.season);
      latest.set(move.player_name, {
        origin:'contract_scenario', player_name:move.player_name, team_id:args.team_id, season:args.season,
        incoming_cap:move.status === 'blocked' ? null : year?.cap_after ?? null,
        status:move.status, acquisition_path:'unresolved', source_id:artifact.id,
        as_of:move.source_as_of ?? new Date().toISOString(), ...(move.source_url ? {source_url:move.source_url}:{}),
        conditions:[...move.assumptions,...move.issues.map(issue=>issue.message), 'The transaction route and availability are not established by this acquisition-cost illustration.'],
      });
    }
  }
  return [...latest.values()];
}
