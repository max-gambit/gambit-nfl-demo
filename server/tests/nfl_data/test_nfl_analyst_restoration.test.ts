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
    if(calls===2)assert.match(JSON.stringify(params.messages),/Unsupported quantity/);
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

test('a cited number cannot move between two named players in one sentence',()=>{
  const second={...evidence,id:'lookup_2',sources:evidence.sources.map(s=>({...s,ref_index:2,title:'Sutton record'})),body:{...evidence.body,tables:[{...evidence.body.tables[0],rows:[['Courtland Sutton',1017,74,'$13,975,000']],source_refs:[2]}]}};
  const catalog=collectEvidenceFacts([evidence,second]);
  const check=(text:string)=>validateSourcedParagraphs([{text,source_refs:[1,2]}],catalog,new Set([1,2]));
  assert.ok(check('Meyers recorded 835 receiving yards, while Sutton recorded 1,017 receiving yards in 2025.'));
  assert.ok(check('Meyers and Sutton each cleared 800 receiving yards in 2025.'));
  assert.throws(()=>check('Meyers and Sutton each cleared 900 receiving yards in 2025.'),/Unsupported quantity/);
  assert.throws(()=>check('Meyers recorded 1,017 receiving yards, while Sutton recorded 835 receiving yards in 2025.'),/Unsupported quantity/);
  assert.equal(numericMentions('The dated Sept 17–19, 2025 report and 2025-09-21 game are separate observations.').length,0);
});

test('accepted compensation and active constraints survive beyond the prose history window',async()=>{
  const {executeCapStrategy}=await import('../../src/nfl_conversation/contract_tools.js');
  const {updateNflConversationState}=await import('../../src/nfl_conversation/state.js');
  const year=(year:number,salary:number)=>({year,kind:'active' as const,base_salary:salary,guaranteed_salary:0,other_cash:0,guaranteed_other_cash:0,incentives_cap_charge:0,incentives_cash:0,salary_paid_by_prior_team:0,other_cash_paid_by_prior_team:0});
  const prior={schema_version:1 as const,team_id:'NYG',season:2026,timing:'post_june_1' as const,budget:{type:'cap' as const,amount:3e6,reserve:1e6},protected_player_ids:['Brian Burns'],moves:[{player_id:'Jakobi Meyers',action:'acquire' as const,illustrative_terms:{basis:'user_supplied_illustrative' as const,label:'Continuity test',user_input:'Original accepted illustration',terms_complete:true as const,signing_bonus:2e6,years:[year(2026,2e6),year(2027,4.5e6)],prior_team_obligations:[],guarantee_note:'Explicit zero guarantees'}}]};
  const first=await executeCapStrategy({},prior,undefined,undefined,'Continue the exact prior funding scenario.');
  const state=updateNflConversationState({objective:'contract',budget:prior.budget,protected_player_names:['Brian Burns']},undefined,'Use a $3 million cap budget and $1 million reserve. Protect Brian Burns.');
  const history=[{question:'Original accepted illustration',body:{...first.body,conversation_state:state}},...Array.from({length:10},(_,i)=>({question:'Continue discussion '+i,body:{...evidence.body,conversation_state:structuredClone(state)}}))];
  let round=0;
  const result=await buildNflAiAnswer('Keep the same terms, budget, reserve and protected player. Recalculate minimum funding.',{history,loadData:async()=>({seed:await seed,source_mode:'supabase_current_views',fallback_reason:null}),reviewDraft:async()=>[],callModel:async params=>{
    if(round++===0){const context=JSON.parse(String(params.messages[0].content));assert.equal(context.conversation.length,8);assert.equal(context.previous_contract_scenario.moves[0].illustrative_terms.years[1].base_salary,4.5e6);assert.equal(context.scenario_state.active.budget.reserve,1e6);return response('find_minimum_cap_funding',{});}
    return response('finish_analysis',{answer_paragraphs:[{text:'The calculation retains the accepted compensation and current funding constraints. The protected player remains excluded.',source_refs:[1]}],evidence_id:'lookup_1',continuation_query_id:'lookup_1'});
  }});
  assert.equal(result.body.ai_analysis?.outcome,'complete');
  const args=result.body.contract_scenario!.args as typeof prior;
  assert.deepEqual(args.budget,prior.budget);assert.deepEqual(args.protected_player_ids,['Brian Burns']);assert.deepEqual(args.moves[0].illustrative_terms.years,prior.moves[0].illustrative_terms.years);
});
