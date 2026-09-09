import assert from 'node:assert/strict';
import test from 'node:test';
import { bindContractScenario,executeContractScenario,explicitPlayerProtections } from '../../src/nfl_conversation/contract_tools.js';
import { buildNflAiAnswer } from '../../src/nfl_facts/ai_answer.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import { buildNflReceiverComparison } from '../../src/nfl_scouting/evidence.js';
const args={schema_version:1 as const,season:2026,team_id:'NYG',timing:'post_june_1' as const,moves:[{player_id:'Paulson Adebo',action:'restructure' as const,conversion_amount:6e6}]};
test('player mentions and model-proposed protections cannot silently change the protected roster',()=>{
 assert.deepEqual(explicitPlayerProtections('Keep availability, price and the Slayton contract conflict unresolved.').names,[]);
 assert.deepEqual(explicitPlayerProtections('Assume Malik Nabers is unavailable.',[],['Malik Nabers']).names,[]);
 assert.deepEqual(explicitPlayerProtections('Protect Burns and Thomas.').names,['Brian Burns','Andrew Thomas']);
 assert.deepEqual(explicitPlayerProtections('Protect only Burns and Thomas.',['Malik Nabers','Darius Slayton']).names,['Brian Burns','Andrew Thomas']);
 assert.deepEqual(explicitPlayerProtections('Keep Malik Nabers on our roster.',[],['Malik Nabers']).names,['Malik Nabers']);
 const bound=bindContractScenario({...args,protected_player_ids:['Malik Nabers','Paulson Adebo']},'Convert $6 million of Paulson Adebo’s 2026 salary. Protect Burns and Thomas.',undefined,undefined);
 assert.deepEqual(bound.protected_player_ids,['Brian Burns','Andrew Thomas']);
});
test('an analyst cannot turn a hypothetical absence into a protected-player constraint',async()=>{
 const seed=await loadNflDemoSeed();let count=0;
 const result=await buildNflAiAnswer('Assume Malik Nabers is unavailable. Compare receiver options.',{prefetch:false,loadData:async()=>({seed,source_mode:'supabase_current_views',fallback_reason:null}),reviewDraft:async()=>[],callModel:async()=>({id:'test',type:'message',role:'assistant',model:'test',stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0},content:[{type:'tool_use',id:String(++count),name:count===1?'set_scenario':count===2?'compare_receivers':'finish_analysis',input:count===1?{objective:'acquisition',protected_player_names:['Malik Nabers']}:count===2?{}:{answer:'Compare recorded production and role evidence before investigating availability and price.',evidence_id:'lookup_1',continuation_query_id:'lookup_1'}}]} as any)});
 assert.equal(result.body.ai_analysis?.outcome,'complete');
 assert.deepEqual(result.body.conversation_state?.active.protected_player_names,[]);
});
test('a model cannot invent a conversion amount, paid salary or credited seasons',()=>{
 assert.throws(()=>bindContractScenario(args,'Make the deal affordable.',undefined,undefined),/explicit/);
 assert.throws(()=>bindContractScenario({...args,moves:[{...args.moves[0],conversion_amount:2026}]},'Continue the same scenario.',args,undefined),/explicit/);
 assert.equal(bindContractScenario(args,'Convert $6 million for Paulson Adebo.',undefined,undefined).moves[0].conversion_amount,6e6);
 assert.throws(()=>bindContractScenario({...args,moves:[{...args.moves[0],credited_seasons:5}]},'Five years of experience. Convert $6 million.',undefined,undefined),/credited_seasons/);
});
test('newly requested player protection is enforced before any model scenario update',async()=>{
 const result=await executeContractScenario({schema_version:1,season:2026,team_id:'NYG',timing:'post_june_1',moves:[{player_id:'Brian Burns',action:'trade'}]},'Keep Burns. Compare funding alternatives.',undefined,undefined);
 assert.match(result.body.key_findings.map(f=>f.body).join(' '),/protected-player/);
});
test('unavailable-by-user cannot be created by a tool argument alone',async()=>{
 const seed=await loadNflDemoSeed();
 await assert.rejects(buildNflReceiverComparison({player_names:['Malik Nabers'],assumed_unavailable_names:['Malik Nabers']},seed,'Compare our receiver options.'),/No user supplied/);
 const answer=await buildNflReceiverComparison({player_names:['Malik Nabers'],assumed_unavailable_names:['Malik Nabers']},seed,'Assume Nabers is unavailable.');
 assert.ok(answer.body.tables[0].rows.some(r=>r[0]==='Malik Nabers'&&r[2]==='Assumed unavailable by user'));
});
test('repeated unsupported risk prose returns explicitly incomplete evidence',async()=>{
 const seed=await loadNflDemoSeed();let count=0;
 const result=await buildNflAiAnswer('Compare our options.',{prefetch:false,loadData:async()=>({seed,source_mode:'supabase_current_views',fallback_reason:null}),reviewDraft:async()=>[],callModel:async()=>({id:'test',type:'message',role:'assistant',model:'test',stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0},content:[{type:'tool_use',id:String(++count),name:count===1?'compare_receivers':'finish_analysis',input:count===1?{}:{answer:'Compare the recorded production with the shorter commitments. He has a twenty percent injury risk.',key_findings:[],tables:[{table_id:'lookup_1:0',title:'Made-up 2099 claims',row_ids:['r0'],column_names:['Player','2025 receiving yards']}],evidence_id:'lookup_1',continuation_query_id:'lookup_1',caveats:[],assumptions:[],followups:[]}}]} as any)});
 assert.equal(result.body.ai_analysis?.outcome,'evidence_only');
 assert.match(result.body.answer,/did not finish/);
 assert.doesNotMatch(result.body.answer,/twenty|risk/);
 assert.equal(result.body.ai_analysis?.repair_count,1);
 assert.doesNotMatch(result.body.tables[0].title,/2099/);
 assert.ok(result.body.receiver_query);
});
