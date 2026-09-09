import assert from 'node:assert/strict';
import test from 'node:test';
import {buildNflAiAnswer} from '../../src/nfl_facts/ai_answer.js';
import {loadNflDemoSeed} from '../../src/nfl_data/seed.js';
import {updateNflConversationState} from '../../src/nfl_conversation/state.js';
import {executeContractScenario,explicitPlayerProtections} from '../../src/nfl_conversation/contract_tools.js';
import {buildNflReceiverComparison} from '../../src/nfl_scouting/evidence.js';
import {factualAnswerPresentation} from '@shared/nflAnswerDepth';
const response=(calls:Array<{name:string;input:unknown}>)=>({id:'test',type:'message',role:'assistant',model:'test',stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0},content:calls.map((c,i)=>({type:'tool_use',id:'c'+i,...c}))}) as any;
const loaded=async()=>({seed:await loadNflDemoSeed(),source_mode:'supabase_current_views' as const,fallback_reason:null});
test('incomplete scenario and market preserve status through screen and export presentation',()=>{
 for(const details of [{seller_move_analysis:{result:{}}},{market_analysis:{},answer_layout:'market_overview'}]){
 const body:any={kind:'data_analysis',language_policy:'facts_only_v1',answer:'Analysis incomplete.',key_findings:[],tables:[],calculations:[],caveats:['Provider unavailable'],followups:[],ai_analysis:{outcome:'evidence_only'},conversation_state:{active:{id:'keep'}},...details};
 assert.strictEqual(factualAnswerPresentation(body),body);
 }
});
test('timeout retains executed narrow receiver query instead of prefetched alternatives',async()=>{
 let round=0;
 const result=await buildNflAiAnswer('Find outside WRs below $6 million current-team cap.',{loadData:loaded,reviewDraft:async()=>[],callModel:async()=>{if(round++)throw new Error('Provider unavailable');return response([{name:'search_player_records',input:{team_ids:[],position_groups:['WR'],exclude_nyg:true,numeric_filters:[{field:'cap_2026',operator:'lt',value:6e6}],sort:'cap_asc',limit:10}}]);}});
 assert.equal(result.body.ai_analysis?.outcome,'evidence_only');
 assert.deepEqual(result.body.factual_query?.numeric_filters,[{field:'cap_2026',operator:'lt',value:6e6}]);
 assert.equal(result.body.factual_query?.exclude_nyg,true);assert.ok(!result.body.receiver_query);
});
test('displayed horizon has exact active and void dossier in persisted sources',async()=>{
 const result=await buildNflReceiverComparison({player_names:['Jakobi Meyers'],priority:'contract_horizon'},await loadNflDemoSeed(),'');
 assert.match(String(result.body.tables[0].rows[0][8]),/2028.*dossier/);
 const source=result.sources.find(s=>s.title?.includes('inspected active and void'))!;
 assert.ok(source);assert.ok(result.body.tables[0].source_refs.includes(source.ref_index));
 assert.match(JSON.stringify(source.data),/2028/);assert.match(JSON.stringify(source.data),/2030/);assert.match(JSON.stringify(source.data),/SHA256/);
});
test('explicit removal changes calculation while retained protection blocks it',async()=>{
 const state=updateNflConversationState({objective:'contract',protected_player_names:['Brian Burns']},undefined,'Keep Brian Burns.').active;
 const args={schema_version:1,season:2026,team_id:'NYG',timing:'post_june_1',moves:[{player_id:'Brian Burns',action:'trade'}],protected_player_ids:['Brian Burns']};
 const blocked=await executeContractScenario(args,'Continue the same trade.',undefined,state);
 assert.ok((blocked.body.contract_scenario!.result as any).moves[0].issues.some((i:any)=>i.code==='PROTECTED_PLAYER'));
 const allowed=await executeContractScenario(args,'Unprotect Burns. Trade Brian Burns.',undefined,state);
 assert.ok(!(allowed.body.contract_scenario!.result as any).moves[0].issues.some((i:any)=>i.code==='PROTECTED_PLAYER'));
 assert.deepEqual(explicitPlayerProtections("Don't unprotect Burns.",['Brian Burns']).names,['Brian Burns']);
 assert.deepEqual(explicitPlayerProtections('Keep Brian Burns and Andrew Thomas.').names,['Brian Burns','Andrew Thomas']);
});
test('exact result statements carry quantities while model-written claims cannot',async()=>{
 let round=0;
 const result=await buildNflAiAnswer('Compare our recorded receiver production.',{prefetch:false,loadData:loaded,reviewDraft:async()=>[],callModel:async()=>response(round++?[{name:'finish_analysis',input:{answer:'The answer is 99 percent certain.',answer_statements:['lookup_1:answer'],evidence_id:'lookup_1',continuation_query_id:'lookup_1'}}]:[{name:'compare_receivers',input:{}}])});
 assert.equal(result.body.ai_analysis?.outcome,'complete');assert.doesNotMatch(result.body.answer,/99 percent/);
 assert.match(result.body.answer,/Courtland Sutton recorded/);assert.doesNotMatch(result.body.answer,/Ordered by observed/);assert.match(result.body.supporting_details![0].body,/Ordered by observed/);assert.ok(result.body.tables.length);
});


test('executed contract state persists without a model-authored scenario and cannot omit the user budget',async()=>{
 let round=0;
 const result=await buildNflAiAnswer('Convert $6 million for Paulson Adebo. Use a $5 million cap budget and $1 million reserve.',{prefetch:false,loadData:loaded,reviewDraft:async()=>[],callModel:async()=>response(round++?[{name:'finish_analysis',input:{answer:'The salary conversion shifts the cap charge into the following season.',answer_statements:['lookup_1:answer'],evidence_id:'lookup_1',continuation_query_id:'lookup_1'}}]:[{name:'calculate_contract_scenario',input:{schema_version:1,season:2026,team_id:'NYG',timing:'post_june_1',moves:[{player_id:'Paulson Adebo',action:'restructure',conversion_amount:6e6}]}}])});
 assert.equal(result.body.ai_analysis?.outcome,'complete');assert.equal(result.body.conversation_state?.active.objective,'contract');
 assert.deepEqual(result.body.conversation_state?.active.budget,{type:'cap',amount:5e6,reserve:1e6});
 assert.deepEqual((result.body.contract_scenario!.args as any).budget,result.body.conversation_state?.active.budget);
});

test('a reviewed rule keeps its conditions instead of an unchecked additional model claim',async()=>{
 let round=0;
 const result=await buildNflAiAnswer('Explain 2026 regular-season overtime.',{prefetch:false,loadData:loaded,reviewDraft:async()=>[],callModel:async()=>response(round++?[{name:'finish_analysis',input:{answer:'The clock stops until the second offense has possessed the ball.',evidence_id:'lookup_1',continuation_query_id:'lookup_1',answer_statements:['lookup_1:answer']}}]:[{name:'read_nfl_rules',input:{question:'Under the 2026 NFL playing rulebook, how does regular-season overtime handle possession opportunities and the time limit?'}}])});
 assert.match(result.body.answer,/10-minute/);assert.doesNotMatch(result.body.answer,/clock stops/);assert.equal(result.body.conversation_state?.active.objective,'rules');
});
