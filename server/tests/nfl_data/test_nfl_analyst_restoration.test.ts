import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { collectEvidenceFacts, validateSourcedParagraphs, numericMentions } from '../../src/nfl_conversation/claims.js';
import { buildNflAiAnswer, analystPlayerEvidence, analystPlayerQuery } from '../../src/nfl_facts/ai_answer.js';
import { buildNflReceiverComparison } from '../../src/nfl_scouting/evidence.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import type { FactualAnswer } from '../../src/nfl_facts/answer.js';
import { categoricalGroundingIssues } from '../../src/nfl_conversation/semantic_grounding.js';

const seed=loadNflDemoSeed();
const evidence: FactualAnswer&{id:string}={id:'lookup_1',sources:[{ref_index:1,kind:'table',source:'Recorded test data',title:'Meyers record',updated_at:'2026-09-09',data:{source_url:'https://example.com/meyers'}}],body:{kind:'data_analysis',answer:'',key_findings:[],tables:[{title:'Recorded production and current-team charge',columns:['Player','2025 receiving yards','2025 receptions','2026 current-team cap'],rows:[['Jakobi Meyers',835,75,'$6,210,588']],source_refs:[1]}],calculations:[],caveats:[],followups:[]}};
const facts=collectEvidenceFacts([evidence]);
const validate=(text:string)=>validateSourcedParagraphs([{text,source_refs:[1]}],facts,new Set([1]));

test('source-bound prose preserves correct numbers and controlled rounding',()=>{
  assert.equal(validate('Jakobi Meyers recorded 835 receiving yards in 2025.')[0].text,'Jakobi Meyers recorded 835 receiving yards in 2025.');
  assert.ok(validate('Jakobi Meyers has a $6.21 million current-team cap charge in 2026.')[0].fact_ids!.length);
  assert.equal(validate('One concern is role fit on third down.')[0].text,'One concern is role fit on third down.');
  assert.equal(numericMentions('six million dollars')[0].value,6e6);
  const remapped={...evidence,sources:evidence.sources.map(s=>({...s,ref_index:9})),body:{...evidence.body,tables:evidence.body.tables.map(t=>({...t,source_refs:[9]}))}};
  assert.deepEqual(collectEvidenceFacts([remapped]).map(f=>f.id),facts.map(f=>f.id));
});
test('correct values cannot silently change metric, year, currency, sign or cap basis',()=>{
  for(const value of ['Jakobi Meyers recorded 835 receptions in 2025.','Jakobi Meyers recorded 835 receiving yards in 2026.','Jakobi Meyers costs the acquiring team $6.21 million in 2026.','Jakobi Meyers recorded $835 in 2025.','Jakobi Meyers has a -$6.21 million current-team cap charge in 2026.','Jakobi Meyers recorded 999 receiving yards in 2025.'])assert.throws(()=>validate(value),/Unsupported quantity/,value);
  assert.throws(()=>validateSourcedParagraphs([{text:'Meyers has a recorded contract.',source_refs:[999]}],facts,new Set([1])),/Unknown/);
});
test('broad search records full population before selecting displayed rows',async()=>{
  const data=await seed;
  const query=analystPlayerQuery({team_ids:[],position_groups:['WR'],exclude_nyg:true,sort:'receiving_yards_desc',limit:3},data,null);
  const result=analystPlayerEvidence(query,data);
  assert.equal(result.body.population?.displayed_count,3);
  assert.ok(result.body.population!.matched_count>3);
  assert.equal(result.body.population?.complete,false);
  const yards=result.body.tables[0].columns.indexOf('2025 receiving yards');
  assert.ok(Number(String(result.body.tables[0].rows[0][yards]).replaceAll(',',''))>=Number(String(result.body.tables[0].rows[1][yards]).replaceAll(',','')));
});
test('receiver comparison accepts a roster-search player beyond prepared dossiers',async()=>{
  const data=await seed;
  const player=data.roster_entries.find(p=>p.position==='WR'&&p.team_id!=='NYG'&&!['Courtland Sutton','Jakobi Meyers','Christian Kirk'].includes(p.player_name))!;
  const result=await buildNflReceiverComparison({player_names:[player.player_name]},data,'Compare this receiver.');
  assert.equal(result.body.tables[0].rows[0][0],player.player_name);
  assert.ok(result.body.tables[0].rows[0].some(value=>value==='No comparable assessment captured'));
});
const response=(name:string,input:unknown):Anthropic.Message=>({id:'test',type:'message',role:'assistant',model:'fixed-test-model',stop_reason:'tool_use',stop_sequence:null,content:[{type:'tool_use',id:'tool-'+name,name,input}],usage:{input_tokens:0,output_tokens:0}} as Anthropic.Message);
test('numerical draft failures trigger one targeted repair without silently deleting prose',async()=>{
  let calls=0;
  const result=await buildNflAiAnswer('Compare the recorded receiver.',{loadData:async()=>({seed:await seed,source_mode:'supabase_current_views',fallback_reason:null}),initialEvidence:evidence,reviewDraft:async()=>[],callModel:async params=>{
    calls++;
    if(calls===2)assert.match(JSON.stringify(params.messages.at(-1)),/Unsupported quantity/);
    return response('finish_analysis',{answer_paragraphs:[{text:calls===1?'Jakobi Meyers recorded 999 receiving yards in 2025.':'Jakobi Meyers recorded 835 receiving yards in 2025. Treat that production as a reason to investigate fit, conditional on the incoming terms.',source_refs:[1]}],evidence_id:'lookup_1',continuation_query_id:'lookup_1'});
  }});
  assert.equal(calls,2);assert.equal(result.body.ai_analysis?.outcome,'complete');assert.equal(result.body.ai_analysis?.repair_count,1);assert.match(result.body.answer,/835/);assert.ok(result.body.answer_paragraphs?.[0].fact_ids?.length);
});
test('repeated unsupported quantity returns incomplete evidence and never a mutilated recommendation',async()=>{
  const result=await buildNflAiAnswer('Compare Meyers.',{loadData:async()=>({seed:await seed,source_mode:'supabase_current_views',fallback_reason:null}),initialEvidence:evidence,reviewDraft:async()=>[],callModel:async()=>response('finish_analysis',{answer:'Meyers recorded 999 yards. Therefore acquire him.',answer_source_refs:[1],evidence_id:'lookup_1',continuation_query_id:'lookup_1'})});
  assert.equal(result.body.ai_analysis?.outcome,'evidence_only');assert.doesNotMatch(result.body.answer,/Therefore acquire/);
});
test('semantic checks reject unsupported best-producer and separation claims',()=>{
  const prose={answer:'Meyers has the best recorded receiving production and is a clear separator.',findings:[],caveats:[],assumptions:[],followups:[]};
  assert.equal(categoricalGroundingIssues(prose,[evidence]).length,2);
});
