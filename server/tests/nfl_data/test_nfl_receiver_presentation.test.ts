import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataAnalysisBriefBody } from '@shared/types';
import { factualAnswerPresentation } from '@shared/nflAnswerDepth';
import { RECEIVER_COMPARISON_METHODS, cleanNflAnalystProse } from '@shared/nflReceiverPresentation';
import { buildNflAiAnswer } from '../../src/nfl_facts/ai_answer.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';

const method=RECEIVER_COMPARISON_METHODS.contract_horizon;
const records='Christian Kirk recorded 28 receptions for 239 yards.';
const conclusion='Christian Kirk is the shorter-contract outside option; keeping the internal receiver avoids an acquisition. The current-team charge does not establish the incoming cost.';
const saved=():DataAnalysisBriefBody=>({kind:'data_analysis',language_policy:'grounded_ai_v1',receiver_query:{priority:'contract_horizon'},answer:method+' '+records+'\n\n'+conclusion,answer_source_refs:[4],ai_analysis:{outcome:'complete',model:'fixture',elapsed_ms:0,tool_names:[],assumptions:[]},key_findings:[],tables:[],calculations:[],caveats:['Current availability is unverified.'],followups:[]});

test('saved receiver prose leads with its original conclusion and keeps exact details without mutating the source',()=>{
 const body=saved();const original=structuredClone(body);const result=factualAnswerPresentation(body);
 assert.equal(result.answer,conclusion);assert.deepEqual(body,original);
 assert.deepEqual(result.supporting_details,[{label:'Comparison method',body:method,source_refs:[4]},{label:'Recorded comparison',body:records,source_refs:[4]}]);
 assert.deepEqual(result.caveats,body.caveats);assert.deepEqual(result.tables,body.tables);
 assert.deepEqual(factualAnswerPresentation(result),result);
});

test('missing analysis keeps its explicit incomplete result and a factual-only lead keeps its records',()=>{
 const body=saved();body.ai_analysis!.outcome='evidence_only';
 assert.equal(factualAnswerPresentation(body),body);
 body.ai_analysis!.outcome='complete';body.answer=method+' '+records;
 assert.equal(factualAnswerPresentation(body).answer,records);
});

test('only structural tool trailers are removed from prose',()=>{
 assert.equal(cleanNflAnalystProse(conclusion+'</answer>\n<parameter name="answer_statements">junk'),conclusion);
 assert.equal(cleanNflAnalystProse('The cap comparison is A < B.'),'The cap comparison is A < B.');
});

test('new receiver answers lead with analysis and preserve exact facts, methodology and source bindings in detail',async()=>{
 const seed=await loadNflDemoSeed();let round=0;
 const result=await buildNflAiAnswer('Compare outside receivers for next-year flexibility.',{prefetch:false,loadData:async()=>({seed,source_mode:'supabase_current_views',fallback_reason:null}),reviewDraft:async()=>[],callModel:async()=>({id:'fixture',type:'message',role:'assistant',model:'fixture',stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0},content:[{type:'tool_use',id:String(round),name:round++===0?'compare_receivers':'finish_analysis',input:round===1?{priority:'contract_horizon'}:{answer:conclusion,answer_statements:['lookup_1:answer'],evidence_id:'lookup_1',continuation_query_id:'lookup_1'}}]} as any)});
 assert.equal(result.body.ai_analysis?.outcome,'complete');assert.equal(result.body.answer,conclusion);
 assert.ok(result.body.supporting_details?.some(d=>d.body===method));
 assert.ok(result.body.supporting_details?.some(d=>d.body.includes('Christian Kirk recorded 28 receptions')));
 assert.ok(result.body.supporting_details?.every(d=>d.source_refs.every(ref=>result.sources.some(s=>s.ref_index===ref))));
 assert.ok(result.body.tables.length);assert.ok(result.body.receiver_query);
});
