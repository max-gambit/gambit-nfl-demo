import {extractBudget} from '../nfl_contracts/input_provenance.js';
import { buildNflContractScenario, getNflContractDossier, getNflContractDossierCoverage, validateNflContractScenarioArgs, validateNflScenarioInputProvenance, type NflContractScenarioArgs } from '../nfl_contracts/index.js';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import type { NflScenarioState } from '@shared/nflConversation';


const normalize=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,'');
export function explicitPlayerProtections(currentQuestion:string, previous:string[]=[]){
  const known=getNflContractDossierCoverage().map(d=>({name:d.player_name,aliases:[d.player_name,d.player_name.split(' ').at(-1)!]}));
  const resolve=(name:string)=>known.find(d=>d.aliases.some(a=>normalize(a)===normalize(name)))?.name??name;
  const protectedNames=new Set(previous.map(resolve)); const removed=new Set<string>();
  const clauses=currentQuestion.split(/[.!?\n]/);
  for(const d of known)for(const clause of clauses){
    const alias=d.aliases.find(a=>new RegExp('\\b'+a+'\\b','i').test(clause));if(!alias)continue;
    const unprotect=new RegExp('(?:^|\\b(?:and|but|actually)\\s+)(?:please\\s+)?(?:unprotect|remove (?:the )?protection (?:from|for)|allow (?:a )?(?:trade|release|move) (?:of|for))\\s+(?:'+d.aliases.join('|')+')\\b|(?:'+d.aliases.join('|')+') (?:is |are )?no longer protected','i');
    if(unprotect.test(clause)){protectedNames.delete(d.name);removed.add(d.name);continue;}
    if(/\b(?:keep|protect|do not (?:trade|release|move)|don.t (?:trade|release|move))\b/i.test(clause)){protectedNames.add(d.name);removed.delete(d.name);}
  }
  return {names:[...protectedNames],removed:[...removed]};
}

export function bindContractScenario(input:unknown, userText:string, prior:NflContractScenarioArgs|undefined, state:NflScenarioState|undefined,currentQuestion=userText):NflContractScenarioArgs {
  const raw=structuredClone(input) as NflContractScenarioArgs;
  // Attribution is copied by the server, not transcribed by the model. Amounts
  // are independently checked against the actual current message below.
  for(const move of raw.moves??[]){
    move.player_id=getNflContractDossier(move.player_id)?.player_name??move.player_id;
    const previous=prior?.moves.find(m=>normalize(getNflContractDossier(m.player_id)?.player_name??m.player_id)===normalize(move.player_id)&&m.action===move.action);
    if(move.illustrative_terms){move.illustrative_terms.user_input=previous?.illustrative_terms?.user_input??currentQuestion;move.illustrative_terms.guarantee_note='Outstanding guarantees use the supplied annual amounts; the original user terms and this turn retain changes.';}
  }
  if(!raw.budget){
    const cap=extractBudget(currentQuestion,'cap'),cash=extractBudget(currentQuestion,'cash'),reserve=extractBudget(currentQuestion,'reserve');
    const previousBudget=state?.budget??prior?.budget;
    if(cap.length||cash.length||reserve.length){
      if(cap.length&&cash.length)throw new Error('Choose cap or cash for this budget.');
      const type=cap.length?'cap':cash.length?'cash':previousBudget?.type;
      const amount=(cap.length?cap:cash.length?cash:previousBudget?[previousBudget.amount]:[]);
      const reserves=reserve.length?reserve:previousBudget?[previousBudget.reserve]:[];
      if(!type||new Set(amount).size!==1||new Set(reserves).size!==1)throw new Error('Specify the budget amount, cap/cash basis and reserve separately.');
      raw.budget={type,amount:amount[0],reserve:reserves[0]};
    }else if(previousBudget)raw.budget=structuredClone(previousBudget);
  }
  const args=validateNflContractScenarioArgs(raw);
  const priorForValidation=prior?structuredClone(prior):state?.budget?{...args,moves:[],budget:structuredClone(state.budget)}:undefined;
  if(priorForValidation)priorForValidation.moves=priorForValidation.moves.map(m=>({...m,player_id:getNflContractDossier(m.player_id)?.player_name??m.player_id}));
  const validation=validateNflScenarioInputProvenance(args,{current_question:currentQuestion,prior_args:priorForValidation});
  if(!validation.ok)throw new Error('Use explicit user inputs for these fields: '+validation.gaps.map(g=>g.path+': '+g.message).join(' | '));
  const protections=explicitPlayerProtections(currentQuestion,state?.protected_player_names??[]);
  const removedIds=protections.removed.flatMap(name=>[name,getNflContractDossier(name)?.player_id??name]).map(normalize);
  args.protected_player_ids=[...new Set([...(args.protected_player_ids??[]).filter(id=>!removedIds.includes(normalize(id))),...protections.names])];
  return args;
}
export async function executeContractScenario(input:unknown,userText:string,prior:NflContractScenarioArgs|undefined,state:NflScenarioState|undefined,currentQuestion=userText):Promise<FactualAnswer>{
  const args=bindContractScenario(input,userText,prior,state,currentQuestion);
  const result=await buildNflContractScenario(args);
  result.body.contract_scenario={args:result.scenario_args,result:result.scenario_result,tables:structuredClone(result.body.tables),calculations:structuredClone(result.body.calculations)};
  return result;
}
export function contractDossiersEvidence(playerNames?:string[]):FactualAnswer {
  const coverage=getNflContractDossierCoverage();
  const selected=(playerNames?.length?playerNames:coverage.map(d=>d.player_name)).map(name=>{
    const dossier=getNflContractDossier(name);if(!dossier)throw new Error('No deep contract dossier for '+name);return dossier;
  });
  const sources:FactualAnswer['sources']=selected.map((d,i)=>({ref_index:i+1,kind:'CAP',title:d.player_name+' · reported contract dossier',source:'OverTheCap public reporting',updated_at:d.inspected_at,data:{source_url:d.source_url,source_tables:d.source_tables,rows:[{k:'Source status',v:d.source_status},{k:'Snapshot roster code',v:d.roster_status_as_of_snapshot},{k:'Availability',v:d.availability},{k:'Conflicts',v:d.conflicts.join(' ')||'None identified in this inspection'},{k:'Unknown terms',v:d.unknown_fields.join('; ')},{k:'SHA256',v:d.source_sha256}]}}));
  const money=(n:number|null|undefined)=>n==null?'Not reported':'$'+n.toLocaleString('en-US');
  return {body:{kind:'data_analysis',language_policy:'facts_only_v1',answer:'The dated public contract dossiers separate active and void years, reported charges, and unresolved terms. These are original-team obligations, not an incoming Giants price.',key_findings:selected.filter(d=>d.conflicts.length).map(d=>({label:d.player_name+' · source conflict',body:d.conflicts.join(' '),source_refs:[selected.indexOf(d)+1]})),tables:[{title:'Reported contract years and original-team obligations',columns:['Player','Team','Year','Year kind','Original-team cap','Base salary','Reported guaranteed salary','Status'],rows:selected.flatMap(d=>d.reported_years.length?d.reported_years.filter(y=>y.year>=2026).map(y=>[d.player_name,d.team_id,y.year,y.is_void?'Void':'Active',money(y.fields['Cap Number']),money(y.fields['Base Salary']),money(y.fields['Guaranteed Salary']),d.source_status]):[[d.player_name,d.team_id,'Unknown','Unknown','Blocked','Blocked','Unknown',d.source_status]]),source_refs:sources.map(s=>s.ref_index)}],calculations:[],caveats:['Guarantee types, vesting, offsets, paid versus unpaid cash and current availability need verification. A void-year cap charge is not an active contract year.','The broad team/roster refresh remains separate from these narrow dossier captures.'],followups:['Calculate a specified move using these contract terms.']},sources};
}
