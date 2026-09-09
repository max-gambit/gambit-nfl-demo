import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { selectSavedNflContract, type SavedContractRow } from '../../src/nfl_contracts/saved.js';
import type { NflContractScenarioArgs, NflIllustrativeContractYear } from '../../src/nfl_contracts/types.js';
import { buildNflAiAnswer } from '../../src/nfl_facts/ai_answer.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import { executeCapStrategy } from '../../src/nfl_conversation/contract_tools.js';
import { updateNflConversationState } from '../../src/nfl_conversation/state.js';

const year=(year:number,base_salary:number,guaranteed_salary:number):NflIllustrativeContractYear=>({year,kind:'active',base_salary,guaranteed_salary,other_cash:0,guaranteed_other_cash:0,incentives_cap_charge:0,incentives_cash:0,salary_paid_by_prior_team:0,other_cash_paid_by_prior_team:0});
const savedArgs=():NflContractScenarioArgs=>({schema_version:1,season:2026,team_id:'NYG',timing:'post_june_1',budget:{type:'cap',amount:3e6,reserve:1e6},protected_player_ids:['Jakobi Meyers'],moves:[
  {player_id:'Jakobi Meyers',action:'acquire',illustrative_terms:{basis:'user_supplied_illustrative',label:'Saved rehearsal deal',terms_complete:true,user_input:'Original explicit saved compensation schedule',signing_bonus:2e6,years:[year(2026,2e6,2e6),year(2027,4.5e6,0)],prior_team_obligations:[],guarantee_note:'Supplied guarantees'}},
  {player_id:'Paulson Adebo',action:'restructure',conversion_amount:6e6,unpaid_salary_available:1e6},
]});
const rows=():SavedContractRow[]=>[
  {id:'older',session_id:'original',created_at:'2026-09-08T19:00:00Z',contract_args:{...savedArgs(),moves:savedArgs().moves.map(move=>move.illustrative_terms?{...move,illustrative_terms:{...move.illustrative_terms,signing_bonus:4e6}}:move)}},
  {id:'latest',session_id:'other',created_at:'2026-09-09T19:00:00Z',contract_args:savedArgs()},
];
const response=(name:string,input:unknown):Anthropic.Message=>({id:'test',type:'message',role:'assistant',model:'test',stop_reason:'tool_use',stop_sequence:null,content:[{type:'tool_use',id:'tool-'+name,name,input}],usage:{input_tokens:0,output_tokens:0}} as Anthropic.Message);
const loadData=async()=>({seed:await loadNflDemoSeed(),source_mode:'supabase_current_views' as const,fallback_reason:null});

test('database contract selection imports exact compensation without an older scenario’s constraints',()=>{
  const input=rows(),before=structuredClone(input);
  const result=selectSavedNflContract(input,{player_name:'Jakobi Meyers'},{session_id:'fresh'});
  assert.equal(result.body.saved_contract_reference?.brief_id,'latest');
  assert.equal(result.body.saved_contract_reference?.selection_basis,'latest_saved_for_player');
  assert.deepEqual(result.scenario_args?.moves,[savedArgs().moves[0]]);
  assert.equal(result.scenario_args?.budget,undefined);
  assert.equal(result.scenario_args?.protected_player_ids,undefined);
  assert.equal(result.scenario_args?.moves.length,1);
  assert.deepEqual(input,before);
  assert.ok((result.sources[0].data?.rows as Array<{k:string;v:string}>).some(r=>r.k==='Saved brief'&&r.v==='latest'));
});

test('a current-conversation or explicit reference wins; another player/team cannot provide terms',()=>{
  assert.equal(selectSavedNflContract(rows(),{player_name:'Jakobi Meyers'},{session_id:'original'}).body.saved_contract_reference?.brief_id,'older');
  assert.equal(selectSavedNflContract(rows(),{player_name:'Jakobi Meyers',brief_id:'older'},{session_id:'fresh'}).body.saved_contract_reference?.selection_basis,'explicit_brief');
  for(const request of [{player_name:'Courtland Sutton'},{player_name:'Jakobi Meyers',brief_id:'absent'}])assert.equal(selectSavedNflContract(rows(),request,{session_id:'fresh'}).body.saved_contract_lookup?.status,'not_found');
  assert.equal(selectSavedNflContract([{...rows()[1],contract_args:{...savedArgs(),team_id:'DAL'}}],{player_name:'Jakobi Meyers'},{session_id:'fresh'}).scenario_args,undefined);
});

test('repeating an acquisition identity retains saved terms while changed amounts still require user input',async()=>{
  const prior=selectSavedNflContract(rows(),{player_name:'Jakobi Meyers'},{session_id:'fresh'}).scenario_args!;
  const question='Use the saved Meyers deal with $5 million of available cap budget and a $1 million reserve. Protect Burns and Thomas.';
  const result=await executeCapStrategy({moves:[{player_id:'Jakobi Meyers',action:'acquire'}]},prior,undefined,undefined,question);
  const args=result.body.contract_scenario!.args as NflContractScenarioArgs;
  assert.equal((result.body.cap_strategy as any).decision.kind,'no_funding');
  assert.deepEqual(args.moves[0].illustrative_terms!.years,prior.moves[0].illustrative_terms!.years);
  assert.equal(args.moves[0].illustrative_terms!.signing_bonus,2e6);
  await assert.rejects(()=>executeCapStrategy({moves:[{...prior.moves[0],illustrative_terms:{...prior.moves[0].illustrative_terms!,signing_bonus:9e6}}]},prior,undefined,undefined,question),/explicit user inputs/);
});

test('saved compensation keeps the active budget, including an explicitly restored constraint',async()=>{
  const imported=selectSavedNflContract(rows(),{player_name:'Jakobi Meyers'},{session_id:'fresh'}).scenario_args!;
  const state=updateNflConversationState({objective:'contract',budget:{type:'cap',amount:5e6,reserve:1e6}},undefined,'Use a $5 million cap budget and $1 million reserve.');
  const answer=await executeCapStrategy({},imported,undefined,state.active,'Use the saved Meyers contract with the same budget.');
  assert.deepEqual((answer.body.contract_scenario!.args as NflContractScenarioArgs).budget,state.active.budget);
  const restored={...state.active,budget:{type:'cap' as const,amount:3e6,reserve:1e6}};
  const changed=await executeCapStrategy({},answer.body.contract_scenario!.args as NflContractScenarioArgs,answer.body.cap_strategy,restored,'Return to the earlier scenario and recalculate.');
  assert.equal((changed.body.contract_scenario!.args as NflContractScenarioArgs).budget?.amount,3e6);
  assert.equal((changed.body.cap_strategy as any).decision.selected.conversion,2e6);
});

test('regeneration pins its original source and excludes the regenerated answer and future records',async()=>{
  const context={session_id:'other',exclude_brief_id:'latest',created_before:'2026-09-09T19:00:00Z'};
  assert.equal(selectSavedNflContract(rows(),{player_name:'Jakobi Meyers'},context).body.saved_contract_reference?.brief_id,'older');
  let calls=0;
  const reference=selectSavedNflContract(rows(),{player_name:'Jakobi Meyers',brief_id:'older'},context).body.saved_contract_reference!;
  const result=await buildNflAiAnswer('Inspect Meyers’s saved illustrative contract.',{loadData,prefetch:false,sessionId:'other',savedContractScope:context,pinnedSavedContract:reference,reviewDraft:async()=>[],readSavedContract:async(request,scope)=>{
    assert.equal(request.brief_id,'older');assert.deepEqual(scope,context);return selectSavedNflContract(rows(),request,scope);
  },callModel:async()=>++calls===1?response('read_saved_contract',{player_name:'Jakobi Meyers',brief_id:'latest'}):response('finish_analysis',{answer:'The original saved compensation is available for inspection.',evidence_id:'lookup_1',continuation_query_id:'lookup_1',answer_statements:['lookup_1:answer']})});
  assert.equal(result.body.saved_contract_reference?.brief_id,'older');
});

test('a fresh conversation reads a database contract then calculates the exact failed question',async()=>{
  let calls=0,reads=0;
  const question='Let’s explore Meyers using the saved hypothetical contract. We have $5 million of available cap budget and want to retain a $1 million reserve. Protect Burns and Thomas. Compare doing nothing, acquiring him without restructuring anyone, and using the minimum funding needed. Show this year’s and next year’s cap and cash.';
  const result=await buildNflAiAnswer(question,{loadData,prefetch:false,sessionId:'fresh',reviewDraft:async()=>[],readSavedContract:async(request,context)=>{
    reads++;assert.equal(context.session_id,'fresh');return selectSavedNflContract(rows(),request,context);
  },callModel:async params=>{
    calls++;
    if(calls===1)return response('set_scenario',{objective:'contract',budget:{type:'cap',amount:5e6,reserve:1e6}});
    if(calls===2)return response('read_saved_contract',{player_name:'Jakobi Meyers'});
    if(calls===3){
      const lookup=JSON.parse(String((params.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0].content));
      assert.equal(lookup.saved_contract_lookup.scenario_args.moves[0].illustrative_terms.signing_bonus,2e6);
      assert.equal(lookup.saved_contract_lookup.scenario_args.moves[0].illustrative_terms.user_input,undefined);
      return response('find_minimum_cap_funding',{});
    }
    return response('finish_analysis',{answer:'The saved illustrative deal fits the stated budget and reserve without a conversion. Hold avoids the new receiver obligations.',evidence_id:'lookup_2',continuation_query_id:'lookup_2',answer_statements:['lookup_2:answer'],tables:[{table_id:'lookup_2:0'}]});
  }});
  assert.equal(reads,1);assert.equal(calls,4);assert.equal(result.body.ai_analysis?.outcome,'complete');
  assert.equal((result.body.cap_strategy as any).decision.kind,'no_funding');
  assert.deepEqual((result.body.contract_scenario!.args as NflContractScenarioArgs).budget,{type:'cap',amount:5e6,reserve:1e6});
  assert.deepEqual((result.body.contract_scenario!.args as NflContractScenarioArgs).protected_player_ids,['Brian Burns','Andrew Thomas']);
  assert.equal(result.body.saved_contract_reference?.brief_id,'latest');
  assert.ok(result.sources.some(source=>source.source==='Saved user-supplied illustration'));
  // A reloaded follow-up uses the executed imported contract without another DB lookup.
  let turns=0;
  const followup=await buildNflAiAnswer('Actually, we only have $3 million available. Keep everything else unchanged.',{loadData,prefetch:false,sessionId:'fresh',history:[{question,body:result.body}],reviewDraft:async()=>[],readSavedContract:async()=>{throw new Error('Should retain the executed contract');},callModel:async()=>++turns===1?response('find_minimum_cap_funding',{}):response('finish_analysis',{answer:'A minimum conversion now covers the funding gap, with the future cap cost shown below.',evidence_id:'lookup_1',continuation_query_id:'lookup_1',answer_statements:['lookup_1:answer']})});
  assert.equal((followup.body.cap_strategy as any).decision.selected.conversion,2e6);
  assert.equal(followup.body.ai_analysis?.outcome,'complete');assert.equal(turns,2);
  assert.equal(followup.body.saved_contract_reference?.brief_id,'latest');
  let deltaTurns=0;
  const deltaQuestion='What if I find another $1 million? Do we still need the restructure?';
  const delta=await buildNflAiAnswer(deltaQuestion,{loadData,prefetch:false,sessionId:'fresh',history:[{question,body:result.body},{question:'Actually, we only have $3 million available. Keep everything else unchanged.',body:followup.body}],reviewDraft:async()=>[],callModel:async params=>{
    deltaTurns++;
    if(deltaTurns===1){
      const context=JSON.parse(String(params.messages[0].content));
      assert.equal(context.previous_contract_scenario.moves[0].illustrative_terms.user_input,undefined);
      assert.ok(context.scenario_state.active.supplied_terms.every((line:string)=>!line.startsWith('Original user input')));
      return response('set_scenario',{objective:'contract',budget:{type:'cap',amount:4e6,reserve:1e6}});
    }
    return deltaTurns===2?response('find_minimum_cap_funding',{}):response('finish_analysis',{answer:'The acquisition fits without a restructure after the budget increase.',evidence_id:'lookup_1',continuation_query_id:'lookup_1',answer_statements:['lookup_1:answer']});
  }});
  assert.equal(delta.body.ai_analysis?.outcome,'complete');
  assert.equal((delta.body.cap_strategy as any).decision.kind,'no_funding');
  assert.equal((delta.body.contract_scenario!.args as NflContractScenarioArgs).budget?.amount,4e6);
  assert.equal((delta.body.contract_scenario!.args as NflContractScenarioArgs).moves[0].illustrative_terms!.user_input,savedArgs().moves[0].illustrative_terms!.user_input);
});

test('a database miss requests the missing terms without an empty retry loop or fabricated price',async()=>{
  let calls=0;
  const result=await buildNflAiAnswer('Use Sutton’s saved hypothetical contract.',{loadData,prefetch:false,sessionId:'fresh',reviewDraft:async()=>[],readSavedContract:async(request,context)=>selectSavedNflContract(rows(),request,context),callModel:async()=>++calls===1?response('read_saved_contract',{player_name:'Courtland Sutton'}):response('finish_analysis',{answer:'The database lookup found no saved illustrative deal for this player. Please identify the saved deal or provide its proposed compensation.',evidence_id:'lookup_1',continuation_query_id:'lookup_1',answer_statements:['lookup_1:answer']})});
  assert.equal(calls,2);assert.equal(result.body.ai_analysis?.outcome,'needs_input');
  assert.equal(result.body.contract_scenario,undefined);assert.equal(result.body.followups.length,0);
  assert.match(result.body.answer,/found no saved illustrative/);
});
