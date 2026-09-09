import {getNflContractDossier} from './index.js';
import type {NflContractScenarioArgs,NflFundingObservation,NflFundingObservationSnapshot} from './types.js';

const canonical=(s:string)=>getNflContractDossier(s)?.player_name??s;
export function observationsFromScenario(args:NflContractScenarioArgs):NflFundingObservation[]{
  return args.moves.filter(m=>m.action==='restructure'&&(m.unpaid_salary_available!=null||m.credited_seasons!=null)).map(m=>({player_id:canonical(m.player_id),...(m.unpaid_salary_available!=null?{unpaid_salary_available:m.unpaid_salary_available}:{}),...(m.credited_seasons!=null?{credited_seasons:m.credited_seasons}:{})}));
}
export function retainedFundingObservations(args:NflContractScenarioArgs,snapshots:NflFundingObservationSnapshot[]):NflFundingObservation[]{
  const values=new Map<string,NflFundingObservation>();
  for(const snapshot of snapshots.filter(s=>s.season===args.season&&s.team_id===args.team_id))for(const observation of snapshot.observations){const player=canonical(observation.player_id);values.set(player,{...values.get(player),...observation,player_id:player});}
  return [...values.values()];
}
export function applyRetainedFundingObservations(args:NflContractScenarioArgs,snapshots:NflFundingObservationSnapshot[]):NflFundingObservationSnapshot{
  const retained=retainedFundingObservations(args,snapshots);
  for(const move of args.moves.filter(m=>m.action==='restructure')){
    const prior=retained.find(v=>canonical(v.player_id)===canonical(move.player_id));
    for(const field of ['unpaid_salary_available','credited_seasons'] as const)if(move[field]==null&&prior?.[field]!=null)move[field]=prior[field];
  }
  return {team_id:args.team_id,season:args.season,observations:retainedFundingObservations(args,[{team_id:args.team_id,season:args.season,observations:retained},{team_id:args.team_id,season:args.season,observations:observationsFromScenario(args)}])};
}
