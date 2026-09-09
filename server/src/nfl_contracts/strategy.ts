import { buildNflContractComparison, calculateNflContractScenario, getNflContractDossier, getNflContractDossierCoverage } from './index.js';
import { validateNflContractScenarioArgs } from './validation.js';
import type { NflContractDossier, NflContractScenarioArgs, NflContractScenarioMove, NflFundingObservation } from './types.js';
import {observationsFromScenario} from './funding_observations.js';
import type { FactualAnswer } from '../nfl_facts/answer.js';

const STEP = 1_000;
const money = (n: number | null) => n == null ? 'Unknown' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n===0?0:n);
const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const same = (a: string, b: string) => normalized(a) === normalized(b);
const availableDossiers = () => getNflContractDossierCoverage().map(d => getNflContractDossier(d.player_id)!);

export interface FundingCandidate {
  player_id: string;
  player_name: string;
  eligible: boolean;
  reason: string;
  max_conversion: number;
  max_relief: number;
  conversion: number | null;
  relief: number | null;
  next_year_added_cap: number | null;
  later_added_cap: Array<{year: number; amount: number}>;
  move: NflContractScenarioMove | null;
}
export interface FundingDecision {
  kind: 'no_funding' | 'minimum_conversion' | 'no_supported_fit' | 'unresolved';
  incoming_cap: number | null;
  incoming_cash: number | null;
  funding_gap: number | null;
  selected: FundingCandidate | null;
  candidates: FundingCandidate[];
  scenario_args: NflContractScenarioArgs;
  reason: string;
}
export interface CapStrategyArtifact {
  schema_version: 1;
  /** Validated user terms and observations; solver amounts never replace these. */
  discovery_inputs: NflContractScenarioArgs;
  funding_observations: NflFundingObservation[];
  derivation: { conversion_increment: number; scope: string; objective: string };
  decision: FundingDecision;
  sensitivity: Array<{ label: string; budget: number; reserve: number; signing_bonus: number | null; decision: FundingDecision }>;
  thresholds: { budget_without_funding: number | null; max_reserve_without_funding: number | null; max_incoming_cost_without_funding: number; max_modeled_signing_bonus_without_funding: number | null };
}

function acquisitionOnly(args: NflContractScenarioArgs): NflContractScenarioArgs {
  return {...structuredClone(args), moves: args.moves.filter(m => m.action === 'acquire').map(m => structuredClone(m))};
}

/** Search whole-$1,000 conversions using the existing calculator as the oracle.
 * No source-row shortcut can bypass its floor, void, team or guarantee checks. */
function candidate(d: NflContractDossier, args: NflContractScenarioArgs, gap: number, available: NflContractDossier[], observations:NflFundingObservation[]): FundingCandidate {
  const result: FundingCandidate = {player_id:d.player_id, player_name:d.player_name, eligible:false, reason:'', max_conversion:0, max_relief:0, conversion:null, relief:null, next_year_added_cap:null, later_added_cap:[], move:null};
  const observation = observations.find(m => same(m.player_id,d.player_id) || same(m.player_id,d.player_name));
  const base: NflContractScenarioMove = {player_id:d.player_name,action:'restructure', ...(observation?.unpaid_salary_available != null ? {unpaid_salary_available:observation.unpaid_salary_available} : {}), ...(observation?.credited_seasons != null ? {credited_seasons:observation.credited_seasons} : {})};
  const run = (amount: number) => calculateNflContractScenario({...args,moves:[{...base,conversion_amount:amount}],budget:undefined},available);
  const first = run(STEP);
  if (first.status === 'blocked') {result.reason = first.issues.filter(i => i.severity === 'blocked').map(i => i.message).join(' '); return result;}
  const salary = d.reported_years.find(y => y.year === args.season)?.fields['Base Salary'];
  if (salary == null) {result.reason='Reported salary is missing.';return result;}
  let lo=1, hi=Math.floor(Math.min(salary, observation?.unpaid_salary_available ?? salary)/STEP);
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(run(mid*STEP).status==='blocked')hi=mid-1;else lo=mid;}
  result.max_conversion=lo*STEP;
  result.max_relief=run(result.max_conversion).years.find(y=>y.year===args.season)!.cap_relief!;
  result.eligible=true;
  if(result.max_relief<gap){result.reason='This conversion cannot cover the whole funding gap within the supported salary limits.';return result;}
  lo=1;hi=result.max_conversion/STEP;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(run(mid*STEP).years.find(y=>y.year===args.season)!.cap_relief!>=gap)hi=mid;else lo=mid+1;}
  const amount=lo*STEP, calculated=run(amount);
  result.conversion=amount;
  result.relief=calculated.years.find(y=>y.year===args.season)!.cap_relief!;
  result.next_year_added_cap=calculated.years.find(y=>y.year===args.season+1)!.added_proration;
  result.later_added_cap=calculated.years.filter(y=>y.year>args.season&&y.added_proration>0).map(y=>({year:y.year,amount:y.added_proration}));
  result.move={...base,conversion_amount:amount};
  result.reason='Conditional on unpaid salary, conversion permission and transaction-date checks; annual cash is unchanged.';
  return result;
}

export function calculateMinimumFunding(input: NflContractScenarioArgs, available = availableDossiers(), observations=observationsFromScenario(input)): FundingDecision {
  const args=validateNflContractScenarioArgs(input);
  if(!args.moves.some(m=>m.action==='acquire'))throw new Error('Funding discovery needs an acquisition with complete incoming terms.');
  if(args.moves.some(m=>['release','trade'].includes(m.action)))throw new Error('This funding search preserves the roster and compares single salary conversions. Analyze an explicit release/trade separately, including replacement needs.');
  if(!args.budget)throw new Error('Supply the available cap or cash budget and reserve before finding funding.');
  const baseline=acquisitionOnly(args), acquisition=calculateNflContractScenario(baseline,available);
  const year=acquisition.years.find(y=>y.year===args.season)!;
  const incoming_cap=year.cap_relief==null?null:-year.cap_relief;
  const incoming_cash=year.cash_relief==null?null:-year.cash_relief;
  const cost=args.budget.type==='cap'?incoming_cap:incoming_cash;
  const unknown=acquisition.status==='blocked'||cost==null;
  const gap=unknown?null:Math.max(0,cost+args.budget.reserve-args.budget.amount);
  const candidates=available.filter(d=>d.team_id===args.team_id).map(d=>candidate(d,args,gap??0,available,observations));
  const decision: FundingDecision={kind:'unresolved', incoming_cap, incoming_cash,funding_gap:gap,selected:null,candidates,scenario_args:baseline,reason:''};
  if(unknown){decision.reason='Incoming terms or acquisition constraints are unresolved; funding need and fit are unknown.';return decision;}
  if(gap===0){decision.kind='no_funding';decision.reason='Acquisition alone fits the supplied budget after reserve. Keep existing salaries unchanged to avoid adding future cap obligations.';return decision;}
  if(args.budget.type==='cash'){decision.kind='no_supported_fit';decision.reason='Salary conversion preserves annual cash and cannot close this cash-budget gap. Revise the incoming terms or cash budget, or evaluate a separate roster decision.';return decision;}
  const ranked=candidates.filter(c=>c.move).sort((a,b)=>a.next_year_added_cap!-b.next_year_added_cap! || a.later_added_cap.reduce((n,y)=>n+y.amount,0)-b.later_added_cap.reduce((n,y)=>n+y.amount,0) || a.conversion!-b.conversion! || a.player_name.localeCompare(b.player_name));
  if(!ranked.length){decision.kind='no_supported_fit';decision.reason='No single supported salary conversion closes the gap. Multiple conversions, releases/trades, extensions and added years have not been optimized.';return decision;}
  decision.kind='minimum_conversion';decision.selected=ranked[0];
  decision.scenario_args={...baseline,moves:[...baseline.moves,ranked[0].move!]};
  decision.reason='Use '+ranked[0].player_name+' only to cover the gap, rounded up to the next supported conversion increment. Among the inspected single conversions, this adds the least next-year cap; all later allocations remain visible.';
  return decision;
}

export function calculateCapStrategy(input:NflContractScenarioArgs,available=availableDossiers(),observations=observationsFromScenario(input)):CapStrategyArtifact {
  const args=validateNflContractScenarioArgs(input), decision=calculateMinimumFunding(args,available,observations), budget=args.budget!;
  const sensitivity:CapStrategyArtifact['sensitivity']=[];
  const one=args.moves.filter(m=>m.action==='acquire');
  const terms=one.length===1?one[0].illustrative_terms:undefined;
  const add=(label:string,changed:NflContractScenarioArgs)=>sensitivity.push({label,budget:changed.budget!.amount,reserve:changed.budget!.reserve,signing_bonus:terms?changed.moves.find(m=>m.action==='acquire')!.illustrative_terms!.signing_bonus:null,decision:calculateMinimumFunding(changed,available,observations)});
  add('Current inputs',args);
  for(const delta of [-1_000_000,1_000_000]){
    if(budget.amount+delta>=0)add('Available budget '+(delta<0?'−':'+')+'$1m',{...structuredClone(args),budget:{...budget,amount:budget.amount+delta}});
    if(budget.reserve+delta>=0)add('Reserve '+(delta<0?'−':'+')+'$1m',{...structuredClone(args),budget:{...budget,reserve:budget.reserve+delta}});
    if(terms){
      // One million of first-year cap stress, implemented as an explicitly
      // derived bonus-only illustration. This changes cash and all allocations.
      const bonusDelta=delta*terms.years.length;
      if(terms.signing_bonus+bonusDelta>=0 && terms.signing_bonus+bonusDelta<=1_000_000_000){
        const changed=structuredClone(args);
        changed.moves.find(m=>m.action==='acquire')!.illustrative_terms!.signing_bonus+=bonusDelta;
        add('Illustrative new signing bonus '+(bonusDelta<0?'−':'+')+money(Math.abs(bonusDelta)),changed);
      }
    }
  }
  const cost=budget.type==='cap'?decision.incoming_cap:decision.incoming_cash;
  if(cost!=null&&decision.kind!=='unresolved'){
    const below=cost+budget.reserve-1_000_000;
    if(below>=0&&!sensitivity.some(s=>s.budget===below&&s.reserve===budget.reserve&&s.signing_bonus===(terms?.signing_bonus??null)))add('Budget $1m below no-funding threshold',{...structuredClone(args),budget:{...budget,amount:below}});
  }
  let maxBonus:number|null=null;
  if(terms&&cost!=null&&decision.kind!=='unresolved'){
    // Threshold on the same stated $1,000 grid as the funding search.
    const fits=(bonus:number)=>{const changed=acquisitionOnly(args);changed.moves[0].illustrative_terms!.signing_bonus=bonus;return calculateNflContractScenario(changed,available).budget?.fits===true;};
    if(fits(0)){let lo=0,hi=1_000_000_000/STEP;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(fits(mid*STEP))lo=mid;else hi=mid-1;}maxBonus=lo*STEP;}
  }
  return {schema_version:1,discovery_inputs:args,funding_observations:structuredClone(observations),derivation:{conversion_increment:STEP,scope:'Single salary conversions in the reviewed team dossiers; protected players and blocked contracts excluded. No roster removals, new years or combined conversions.',objective:'Close the funding gap, then minimize next-year added cap among individually sufficient minimum conversions; ties minimize all later added cap, then conversion amount.'},decision,sensitivity,thresholds:{budget_without_funding:cost==null?null:cost+budget.reserve,max_reserve_without_funding:cost==null?null:budget.amount-cost,max_incoming_cost_without_funding:budget.amount-budget.reserve,max_modeled_signing_bonus_without_funding:maxBonus}};
}

export async function buildCapStrategy(input:NflContractScenarioArgs,observations=observationsFromScenario(input)):Promise<FactualAnswer> {
  const strategy=calculateCapStrategy(input,undefined,observations), d=strategy.decision, args=d.scenario_args;
  const answer=await buildNflContractComparison(args);
  // Each candidate, including excluded candidates, has a separately inspectable
  // dated source; no numeric value is attributed to an absent source bundle.
  for(const c of d.candidates){const dossier=getNflContractDossier(c.player_id)!;if(answer.sources.some(s=>s.data?.source_url===dossier.source_url))continue;answer.sources.push({ref_index:answer.sources.length+1,kind:'CAP',source:'OverTheCap public contract reporting',title:c.player_name+' · funding eligibility',updated_at:dossier.inspected_at,data:{source_url:dossier.source_url,reported_years:dossier.reported_years,source_tables:dossier.source_tables,rows:[{k:'Eligibility',v:c.reason},{k:'SHA256',v:dossier.source_sha256}]}});}
  if(observations.length)answer.sources.push({ref_index:answer.sources.length+1,kind:'CAP',source:'User-supplied funding observations · not independently verified',title:'Retained candidate funding limits',updated_at:new Date().toISOString().slice(0,10),data:{contribution:'Player-bound user inputs retained independently of selected moves; these are not public contract findings.',rows:observations.flatMap(o=>[{k:o.player_id+' · unpaid salary available',v:money(o.unpaid_salary_available??null)},{k:o.player_id+' · credited seasons',v:o.credited_seasons??'Not supplied'}])}});
  const refs=answer.sources.map(s=>s.ref_index), comp=answer.comparison_result;
  const branches=comp.alternatives.map(a=>({id:a.id,label:a.id==='hold'?'Hold / no acquisition':a.id==='requested'?(d.kind==='minimum_conversion'?'Acquire + minimum conversion':'Acquire without funding'):a.label,result:a.result}));
  const table={title:'Minimum funding decision',columns:['Alternative','Current cap change vs hold (+ used)','Next-year cap change vs hold (+ used)','Current annual cash change','Next-year annual cash change','After moves and reserve','Funding conversion'],rows:branches.map(a=>{const current=comp.years.find(y=>y.year===args.season)!.alternatives.find(y=>y.alternative_id===a.id)!;const next=comp.years.find(y=>y.year===args.season+1)!.alternatives.find(y=>y.alternative_id===a.id)!;return[a.label,money(current.cap_room_change_vs_hold==null?null:-current.cap_room_change_vs_hold),money(next.cap_room_change_vs_hold==null?null:-next.cap_room_change_vs_hold),money(current.cash_change_vs_hold),money(next.cash_change_vs_hold),money(a.result.budget?.after_reserve??null),a.id==='requested'&&d.selected?d.selected.player_name+': '+money(d.selected.conversion):'None'];}),source_refs:refs};
  const sensitivity={title:'Sensitivity: one input changed at a time',columns:['Illustrative case','Available '+input.budget!.type+' budget','Reserve','New acquisition bonus','Funding gap','Minimum conversion','Next-year cap added by funding','Result'],rows:strategy.sensitivity.map(s=>[s.label,money(s.budget),money(s.reserve),money(s.signing_bonus),money(s.decision.funding_gap),s.decision.selected?s.decision.selected.player_name+': '+money(s.decision.selected.conversion):'None',money(s.decision.selected?.next_year_added_cap??(s.decision.kind==='no_funding'?0:null)),s.decision.kind==='no_funding'?'Acquisition fits without funding':s.decision.kind==='minimum_conversion'?'Conditional funding fit':s.decision.reason]),source_refs:refs};
  const thresholds=strategy.thresholds;
  const thresholdText=thresholds.budget_without_funding==null?'Incoming terms or acquisition constraints must be resolved before a funding threshold can be established.':'Without funding, the available '+input.budget!.type+' budget must be at least '+money(thresholds.budget_without_funding)+' with the current reserve. '+(thresholds.max_reserve_without_funding!<0?'Even a zero reserve does not fit the current budget. ':'At the current budget, the reserve can be at most '+money(thresholds.max_reserve_without_funding)+'. ')+'Incoming '+input.budget!.type+' cost can be at most '+money(thresholds.max_incoming_cost_without_funding)+'. '+(thresholds.max_modeled_signing_bonus_without_funding==null?'No feasible bonus threshold is established.':'Holding all other illustrative terms fixed, the largest modeled new signing bonus that fits in $1,000 increments is '+money(thresholds.max_modeled_signing_bonus_without_funding)+'.');
  answer.body.answer=d.reason+' '+(d.funding_gap==null?'':'The supplied '+input.budget!.type+' funding gap is '+money(d.funding_gap)+'. ')+(d.selected?'The calculator derives a '+money(d.selected.conversion)+' conversion for '+money(d.selected.relief)+' current cap relief and '+money(d.selected.next_year_added_cap)+' added next-year cap. ':'')+'This is a conditional planning result, not a verified executable transaction.';
  answer.body.tables=[table,sensitivity,...answer.body.tables];
  answer.body.supporting_details=[{label:'Search scope and objective',body:strategy.derivation.scope+' '+strategy.derivation.objective+' Conversion amounts use $1,000 increments.',source_refs:refs},{label:'What would change the recommendation',body:thresholdText,source_refs:refs},...d.candidates.map(c=>({label:c.player_name+' · funding option',body:(c.eligible?'Supported maximum conversion '+money(c.max_conversion)+'; maximum current cap relief '+money(c.max_relief)+'. ':'Excluded. ')+c.reason,source_refs:refs}))];
  for(const s of strategy.sensitivity.filter(s=>s.signing_bonus!=null&&s.signing_bonus!==input.moves.find(m=>m.action==='acquire')?.illustrative_terms?.signing_bonus)){
    const r=calculateNflContractScenario(s.decision.scenario_args);
    answer.body.supporting_details.push({label:s.label+' · full-year effects',body:r.years.map(y=>y.year+': combined cap change vs hold '+money(y.cap_relief==null?null:-y.cap_relief)+'; annual cash change '+money(y.cash_relief==null?null:-y.cash_relief)+'.').join(' '),source_refs:refs});
  }
  answer.body.calculations.unshift({label:'Funding needed after reserve',formula:'max(0, incoming '+input.budget!.type+' cost + reserve − available budget)',value:money(d.funding_gap),source_refs:refs});
  answer.body.key_findings.unshift({label:'What would change the recommendation',body:thresholdText,source_refs:refs});
  answer.body.caveats.unshift('Sensitivity rows are system-generated what-if illustrations, not new user terms or observed prices. Budget/reserve vary by $1m; bonus-only rows vary the new acquisition bonus to change first-year cap by $1m, also changing acquisition cash and later bonus allocation. Each row recalculates funding independently; original terms remain saved.',strategy.derivation.scope,'No player availability, seller willingness, trade compensation or football value is inferred. Hold avoids new commitments but leaves the acquisition objective unfilled. Unknown unpaid salary and executed conversion rights are the facts most likely to invalidate a proposed funding move.');
  answer.body.followups=['Find the minimum funding again with the same terms and constraints.','Show every later cap allocation for the recommended funding move.','Explain which funding candidates were excluded and why.'];
  answer.body.cap_strategy=strategy as unknown as Record<string,unknown>;
  answer.body.funding_observations={team_id:input.team_id,season:input.season,observations:strategy.funding_observations};
  answer.body.contract_scenario={args:answer.scenario_args,result:{...answer.scenario_result,comparison:comp},tables:structuredClone(answer.body.tables),calculations:structuredClone(answer.body.calculations)};
  return answer;
}
