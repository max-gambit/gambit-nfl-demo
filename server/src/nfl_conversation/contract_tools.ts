import {extractBudget,bindFundingObservationInputs} from '../nfl_contracts/input_provenance.js';
import { buildNflContractComparison, buildNflContractScenario, getNflContractDossier, getNflContractDossierCoverage, validateNflContractScenarioArgs, validateNflScenarioInputProvenance, type NflContractScenarioArgs, type NflContractComparisonAnswer } from '../nfl_contracts/index.js';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import type { NflScenarioState } from '@shared/nflConversation';
import { buildCapStrategy, type CapStrategyArtifact } from '../nfl_contracts/strategy.js';
import { NFL_CONTRACT_SCENARIO_TOOL_SCHEMA } from '../nfl_contracts/tool_schema.js';
import {applyRetainedFundingObservations,observationsFromScenario,retainedFundingObservations} from '../nfl_contracts/funding_observations.js';
import type {NflFundingObservationSnapshot} from '../nfl_contracts/types.js';
import {isDeepStrictEqual} from 'node:util';


const normalize=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,'');
export function explicitPlayerProtections(currentQuestion:string, previous:string[]=[], candidateNames:string[]=[]){
  const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const names=[...new Set([...getNflContractDossierCoverage().map(d=>d.player_name),...previous,...candidateNames].map(name=>getNflContractDossier(name)?.player_name??name))];
  const known=names.map(name=>({name,aliases:[name,name.split(' ').at(-1)!]}));
  const resolve=(name:string)=>known.find(d=>d.aliases.some(a=>normalize(a)===normalize(name)))?.name??name;
  const protectedNames=new Set(previous.map(resolve)); const removed=new Set<string>();
  const clauses=currentQuestion.split(/[.!?\n]/).map(clause=>clause.trim());
  for(const clause of clauses){
    // A protection command must name a player list, not merely mention a
    // player somewhere after "keep" (for example, keep Slayton's conflict unresolved).
    const command=clause.match(/(?:^|\b(?:and|but|actually)\s+)(?:please\s+)?(protect(?:\s+only)?|keep|do not (?:trade|release|move)|don.t (?:trade|release|move))\s+(.+)$/i);
    if(command){
      let remaining=command[2];const selected:string[]=[];
      for(const d of known){
        for(const alias of [...d.aliases].sort((a,b)=>b.length-a.length)){
          if(alias!==d.name&&known.filter(p=>p.aliases.includes(alias)).length>1)continue;
          const expression=new RegExp('\\b'+escape(alias)+'\\b','gi');
          if(expression.test(remaining)){selected.push(d.name);remaining=remaining.replace(expression,'#');}
        }
      }
      if(selected.length&&/^\s*#(?:\s*(?:,|and|&)\s*#)*\s*(?:protected|on (?:the |our )?roster|on (?:the |our )?team)?\s*$/i.test(remaining)){
        if(/^protect\s+only$/i.test(command[1]))protectedNames.clear();
        for(const selectedName of selected){protectedNames.add(selectedName);removed.delete(selectedName);}
      }
    }
    for(const d of known){
    const alias=d.aliases.find(a=>new RegExp('\\b'+escape(a)+'\\b','i').test(clause));if(!alias)continue;
    const aliases=d.aliases.map(escape).join('|');
    const unprotect=new RegExp('(?:^|\\b(?:and|but|actually)\\s+)(?:please\\s+)?(?:unprotect|remove (?:the )?protection (?:from|for)|allow (?:a )?(?:trade|release|move) (?:of|for))\\s+(?:'+aliases+')\\b|(?:'+aliases+') (?:is |are )?no longer protected','i');
    if(unprotect.test(clause)){protectedNames.delete(d.name);removed.add(d.name);continue;}
    }
  }
  return {names:[...protectedNames],removed:[...removed]};
}

export function bindContractScenario(input:unknown, userText:string, prior:NflContractScenarioArgs|undefined, state:NflScenarioState|undefined,currentQuestion=userText,additionalPlayerNames:string[]=[],budgetBeforeTurn?:NflContractScenarioArgs['budget']):NflContractScenarioArgs {
  const raw=structuredClone(input) as NflContractScenarioArgs;
  // Attribution is copied by the server, not transcribed by the model. Amounts
  // are independently checked against the actual current message below.
  for(const move of raw.moves??[]){
    move.player_id=getNflContractDossier(move.player_id)?.player_name??move.player_id;
    const previous=prior?.moves.find(m=>normalize(getNflContractDossier(m.player_id)?.player_name??m.player_id)===normalize(move.player_id)&&m.action===move.action);
    // Naming the same acquisition again retains its exact saved compensation.
    // A model need not transcribe the schedule when it supplies only a move ID.
    if(move.action==='acquire'&&!Object.hasOwn(move,'illustrative_terms')&&previous?.illustrative_terms)move.illustrative_terms=structuredClone(previous.illustrative_terms);
    if(move.illustrative_terms){move.illustrative_terms.user_input=previous?.illustrative_terms?.user_input??currentQuestion;move.illustrative_terms.guarantee_note='Outstanding guarantees use the supplied annual amounts; the original user terms and this turn retain changes.';}
  }
  const previousBudget=state?.budget??prior?.budget??undefined;
  const budgetBaseline=budgetBeforeTurn??previousBudget;
  if(!raw.budget){
    const cap=extractBudget(currentQuestion,'cap',budgetBaseline),cash=extractBudget(currentQuestion,'cash',budgetBaseline),reserve=extractBudget(currentQuestion,'reserve');
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
  const priorForValidation=prior?structuredClone(prior):previousBudget?{...args,moves:[]}:undefined;
  if(priorForValidation&&previousBudget)priorForValidation.budget=structuredClone(previousBudget);
  if(priorForValidation)priorForValidation.moves=priorForValidation.moves.map(m=>({...m,player_id:getNflContractDossier(m.player_id)?.player_name??m.player_id}));
  const validation=validateNflScenarioInputProvenance(args,{current_question:currentQuestion,prior_args:priorForValidation,budget_before_turn:budgetBaseline,additional_player_names:additionalPlayerNames});
  if(!validation.ok)throw new Error('Use explicit user inputs for these fields: '+validation.gaps.map(g=>g.path+': '+g.message).join(' | '));
  const protections=explicitPlayerProtections(currentQuestion,state?.protected_player_names??prior?.protected_player_ids??[],args.protected_player_ids);
  args.protected_player_ids=protections.names;
  return args;
}
export async function executeContractScenario(input:unknown,userText:string,prior:NflContractScenarioArgs|undefined,state:NflScenarioState|undefined,currentQuestion=userText,observations:NflFundingObservationSnapshot[]=[],budgetBeforeTurn?:NflContractScenarioArgs['budget']):Promise<FactualAnswer>{
  const args=bindContractScenario(input,userText,prior,state,currentQuestion,[],budgetBeforeTurn);
  const retained=applyRetainedFundingObservations(args,observations);
  const result=await buildNflContractScenario(args);
  result.body.funding_observations=retained;
  result.body.contract_scenario={args:result.scenario_args,result:result.scenario_result,tables:structuredClone(result.body.tables),calculations:structuredClone(result.body.calculations)};
  return result;
}
export async function executeContractComparison(input:unknown,userText:string,prior:NflContractScenarioArgs|undefined,state:NflScenarioState|undefined,currentQuestion=userText,observations:NflFundingObservationSnapshot[]=[],budgetBeforeTurn?:NflContractScenarioArgs['budget']):Promise<NflContractComparisonAnswer>{
  const args=bindContractScenario(input,userText,prior,state,currentQuestion,[],budgetBeforeTurn);
  const retained=applyRetainedFundingObservations(args,observations);
  const answer=await buildNflContractComparison(args);
  answer.body.funding_observations=retained;
  // Persist the requested alternative, never the generated hold baseline.
  answer.body.contract_scenario={args:answer.scenario_args,result:{...answer.scenario_result,comparison:answer.comparison_result},tables:structuredClone(answer.body.tables),calculations:structuredClone(answer.body.calculations)};
  return answer;
}
function mergeScenarioFields(nested:Record<string,unknown>,flat:Record<string,unknown>,path='scenario'):Record<string,unknown>{
  const merged=structuredClone(nested);
  for(const [key,value] of Object.entries(flat)){
    if(!Object.hasOwn(merged,key)){merged[key]=structuredClone(value);continue;}
    const existing=merged[key];
    if(isDeepStrictEqual(existing,value))continue;
    if(existing&&value&&typeof existing==='object'&&typeof value==='object'&&!Array.isArray(existing)&&!Array.isArray(value)){
      merged[key]=mergeScenarioFields(existing as Record<string,unknown>,value as Record<string,unknown>,path+'.'+key);
    }else throw new Error('Conflicting nested and flat values for '+path+'.'+key+'. Supply one explicit value.');
  }
  return merged;
}

export async function executeCapStrategy(input:unknown, prior:NflContractScenarioArgs|undefined, previousStrategy:Record<string,unknown>|undefined, state:NflScenarioState|undefined, question:string,snapshots:NflFundingObservationSnapshot[]=[],budgetBeforeTurn?:NflContractScenarioArgs['budget']):Promise<FactualAnswer>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Funding discovery arguments must be an object.');
  const {funding_observations:observationInput,...request}=input as Record<string,unknown>;
  const allowed=new Set(['scenario',...Object.keys(NFL_CONTRACT_SCENARIO_TOOL_SCHEMA.properties)]);
  if(Object.keys(request).some(key=>!allowed.has(key)))throw new Error('Funding discovery does not accept these fields: '+Object.keys(request).filter(key=>!allowed.has(key)).join(', ')+'. Pass {} to retain prior terms, or supply only changed scenario fields.');
  const {scenario:nested,...flat}=request;
  if(nested!==undefined&&(!nested||typeof nested!=='object'||Array.isArray(nested)))throw new Error('scenario must be an object.');
  // Equivalent or complementary fields sometimes arrive in both schema forms.
  // Normalize them before literal validation; conflicting values remain errors.
  const fields=mergeScenarioFields((nested??{}) as Record<string,unknown>,flat);
  const previous=(previousStrategy as unknown as CapStrategyArtifact|undefined)?.discovery_inputs??prior;
  const proposed=structuredClone(previous||Object.keys(fields).length?{...previous,...fields}:undefined) as NflContractScenarioArgs|undefined;
  if(!proposed)throw new Error('Supply the acquisition terms, year, team, timing, available budget and reserve first.');
  // Let the existing literal binder read a changed budget/reserve. The prior
  // artifact owns unchanged compensation and unpaid-salary observations.
  if(!Object.hasOwn(fields,'budget'))delete proposed.budget;
  const saved=previousStrategy as unknown as CapStrategyArtifact|undefined;
  const observed=retainedFundingObservations(proposed,[...snapshots,...(previous?[{team_id:previous.team_id,season:previous.season,observations:observationsFromScenario(previous)}]:[]),...(saved?[{team_id:saved.discovery_inputs.team_id,season:saved.discovery_inputs.season,observations:saved.funding_observations??observationsFromScenario(saved.discovery_inputs)}]:[])]);
  const canonical=(values:unknown)=>Array.isArray(values)?values.map(v=>v&&typeof v==='object'&&typeof v.player_id==='string'?{...v,player_id:getNflContractDossier(v.player_id)?.player_name??v.player_id}:v):values;
  const funding=bindFundingObservationInputs(question,proposed,observed,canonical(observationInput),getNflContractDossierCoverage().filter(d=>d.team_id===proposed.team_id).map(d=>d.player_name));
  // Keep legacy in-move observations synchronized with the separately bound
  // values; removing a move never removes its candidate constraints.
  for(const move of proposed.moves??[])if(move.action==='restructure'){
    const observation=funding.find(v=>normalize(v.player_id)===normalize(getNflContractDossier(move.player_id)?.player_name??move.player_id));
    for(const field of ['unpaid_salary_available','credited_seasons'] as const)if(observation?.[field]!=null)move[field]=observation[field];
  }
  const bound=bindContractScenario(proposed,question,previous,state,question,funding.map(v=>v.player_id),budgetBeforeTurn);
  return buildCapStrategy(bound,funding);
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
