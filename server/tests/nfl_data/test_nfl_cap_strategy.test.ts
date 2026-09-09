import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCapStrategy,calculateMinimumFunding,buildCapStrategy,type CapStrategyArtifact} from '../../src/nfl_contracts/strategy.js';
import {calculateNflContractScenario,getNflContractDossier} from '../../src/nfl_contracts/index.js';
import {executeCapStrategy,executeContractComparison} from '../../src/nfl_conversation/contract_tools.js';
import type {NflContractScenarioArgs,NflIllustrativeContractYear} from '../../src/nfl_contracts/types.js';
import type Anthropic from '@anthropic-ai/sdk';
import {buildNflAiAnswer} from '../../src/nfl_facts/ai_answer.js';
import {loadNflDemoSeed} from '../../src/nfl_data/seed.js';
import {categoricalGroundingIssues} from '../../src/nfl_conversation/semantic_grounding.js';

const year=(year:number,base_salary:number,guaranteed_salary:number):NflIllustrativeContractYear=>({year,kind:'active',base_salary,guaranteed_salary,other_cash:0,guaranteed_other_cash:0,incentives_cap_charge:0,incentives_cash:0,salary_paid_by_prior_team:0,other_cash_paid_by_prior_team:0});
const fixture=():NflContractScenarioArgs=>({schema_version:1,season:2026,team_id:'NYG',timing:'post_june_1',protected_player_ids:['Brian Burns','Andrew Thomas'],budget:{type:'cap',amount:5_000_000,reserve:1_000_000},moves:[{player_id:'Jakobi Meyers',action:'acquire',illustrative_terms:{basis:'user_supplied_illustrative',label:'Rehearsal illustration',user_input:'Complete prior validated illustrative terms',terms_complete:true,signing_bonus:2_000_000,years:[year(2026,2_000_000,2_000_000),year(2027,4_500_000,0)],prior_team_obligations:[],guarantee_note:'Supplied outstanding guarantees'}},{player_id:'Paulson Adebo',action:'restructure',conversion_amount:6_000_000}]});

test('funding discovery preserves reserve and prefers no conversion when the acquisition fits',()=>{
  const input=fixture(),before=structuredClone(input), s=calculateCapStrategy(input);
  assert.equal(s.decision.kind,'no_funding');assert.equal(s.decision.funding_gap,0);assert.equal(s.decision.selected,null);
  assert.equal(s.decision.incoming_cap,3_000_000);assert.equal(s.decision.incoming_cash,4_000_000);
  assert.deepEqual(input,before);assert.deepEqual(s.discovery_inputs,input);
  assert.deepEqual(s.decision.scenario_args.moves.map(m=>m.action),['acquire']);
  assert.equal(s.thresholds.budget_without_funding,4_000_000);assert.equal(s.thresholds.max_reserve_without_funding,2_000_000);
  assert.equal(s.thresholds.max_modeled_signing_bonus_without_funding,4_000_000);
});

test('a smaller budget discovers a $2m Adebo conversion instead of reusing the prior $6m',()=>{
  const input=fixture();input.budget!.amount=3_000_000;const s=calculateCapStrategy(input),d=s.decision;
  assert.equal(d.kind,'minimum_conversion');assert.equal(d.funding_gap,1_000_000);
  assert.equal(d.selected!.player_name,'Paulson Adebo');assert.equal(d.selected!.conversion,2_000_000);
  assert.equal(d.selected!.relief,1_000_000);assert.equal(d.selected!.next_year_added_cap,1_000_000);
  const calculated=calculateNflContractScenario(d.scenario_args);
  assert.equal(calculated.budget!.after_reserve,0);assert.equal(calculated.budget!.fits,true);
  assert.deepEqual(calculated.years.map(y=>y.cap_relief),[-2_000_000,-6_500_000]);
  assert.deepEqual(calculated.years.map(y=>y.cash_relief),[-4_000_000,-4_500_000]);
  const less=structuredClone(d.scenario_args);less.moves.at(-1)!.conversion_amount!-=1_000;
  assert.equal(calculateNflContractScenario(less).budget!.fits,false);
  for(const name of ['Brian Burns','Andrew Thomas','Darius Slayton'])assert.equal(d.candidates.find(c=>c.player_name===name)!.eligible,false);
});

test('sensitivity changes one input at a time and leaves literal user terms intact',()=>{
  const input=fixture();input.budget!.amount=3_000_000;const s=calculateCapStrategy(input);
  assert.equal(s.sensitivity.find(r=>r.label==='Available budget +$1m')!.decision.kind,'no_funding');
  assert.equal(s.sensitivity.find(r=>r.label==='Reserve −$1m')!.decision.kind,'no_funding');
  const higher=s.sensitivity.find(r=>r.label==='Illustrative new signing bonus +$2,000,000')!;
  assert.equal(higher.decision.selected!.conversion,4_000_000);
  assert.equal(higher.decision.incoming_cap,4_000_000);assert.equal(higher.decision.incoming_cash,6_000_000);
  const calculated=calculateNflContractScenario(higher.decision.scenario_args);
  assert.equal(calculated.years.find(y=>y.year===2027)!.cap_relief,-8_500_000);
  assert.equal(s.discovery_inputs.moves[0].illustrative_terms!.signing_bonus,2_000_000);
  assert.equal(s.thresholds.max_modeled_signing_bonus_without_funding,0);
});

test('cash gaps cannot be solved by a cap conversion',()=>{
  const input=fixture();input.budget={type:'cash',amount:4_000_000,reserve:1_000_000};
  const d=calculateMinimumFunding(input);assert.equal(d.kind,'no_supported_fit');assert.equal(d.funding_gap,1_000_000);assert.equal(d.selected,null);assert.match(d.reason,/cannot close this cash-budget gap/);
});

test('missing incoming terms and protected acquisition remain unknown rather than feasible',()=>{
  const input=fixture();delete input.moves[0].illustrative_terms;assert.equal(calculateMinimumFunding(input).kind,'unresolved');
  const protectedInput=fixture();protectedInput.protected_player_ids!.push('Jakobi Meyers');const d=calculateMinimumFunding(protectedInput);assert.equal(d.kind,'unresolved');assert.equal(d.funding_gap,null);
});

test('unpaid-salary constraints and insufficient single-conversion capacity remain explicit',()=>{
  const input=fixture();input.budget!.amount=3_000_000;input.moves[1].unpaid_salary_available=1_000_000;
  const d=calculateMinimumFunding(input);assert.equal(d.kind,'no_supported_fit');assert.equal(d.candidates.find(c=>c.player_name==='Paulson Adebo')!.max_relief,500_000);
  input.moves[1].unpaid_salary_available=0;assert.equal(calculateMinimumFunding(input).candidates.find(c=>c.player_name==='Paulson Adebo')!.eligible,false);
});

test('ranking favors less next-year added cap while retaining all later allocations',()=>{
  const input=fixture();input.budget!.amount=3_000_000;
  const a=getNflContractDossier('Paulson Adebo')!;
  const b=structuredClone(a);b.player_id='synthetic-three-year';b.player_name='Synthetic Three Year';
  b.reported_years.push({...structuredClone(b.reported_years.at(-1)!),year:2028});
  const d=calculateMinimumFunding(input,[a,b]);assert.equal(d.selected!.player_name,b.player_name);
  assert.equal(d.selected!.conversion,1_500_000);assert.equal(d.selected!.next_year_added_cap,500_000);
  assert.deepEqual(d.selected!.later_added_cap,[{year:2027,amount:500_000},{year:2028,amount:500_000}]);
});

test('saved discovery rebinds changed budgets and preserves literal terms, protection and funding observations',async()=>{
  const prior=fixture(), first=await executeCapStrategy({},prior,undefined,undefined,'Find minimum funding and sensitivity using the same terms and constraints.');
  const second=await executeCapStrategy({},first.body.contract_scenario!.args as NflContractScenarioArgs,first.body.cap_strategy,undefined,'Use a $3 million available cap budget and keep the same reserve. Find minimum funding again.');
  const artifact=second.body.cap_strategy as unknown as CapStrategyArtifact;
  assert.equal(artifact.decision.selected!.conversion,2_000_000);
  assert.equal(artifact.discovery_inputs.moves[1].conversion_amount,6_000_000);
  assert.deepEqual(artifact.discovery_inputs.protected_player_ids,prior.protected_player_ids);
  assert.deepEqual(artifact.discovery_inputs.moves[0].illustrative_terms,first.body.cap_strategy!.discovery_inputs && (first.body.cap_strategy!.discovery_inputs as NflContractScenarioArgs).moves[0].illustrative_terms);
  assert.equal((second.body.contract_scenario!.args as NflContractScenarioArgs).moves[1].conversion_amount,2_000_000);
  const third=await executeCapStrategy({},second.body.contract_scenario!.args as NflContractScenarioArgs,second.body.cap_strategy,undefined,'Use a $5 million available cap budget and keep the same reserve.');
  assert.equal((third.body.cap_strategy as unknown as CapStrategyArtifact).decision.kind,'no_funding');
});

test('model-supplied numbers cannot cross the discovery boundary as invented user inputs',async()=>{
  const prior=fixture(), invented=fixture();invented.moves[0].illustrative_terms!.signing_bonus=8_000_000;
  await assert.rejects(()=>executeCapStrategy({scenario:invented},prior,undefined,undefined,'Find minimum funding.'),/explicit user inputs/);
  await assert.rejects(()=>executeCapStrategy({conversion_amount:8_000_000},prior,undefined,undefined,'Find minimum funding.'),/does not accept/);
  const flat=await executeCapStrategy({schema_version:1,season:2026,team_id:'NYG',timing:'post_june_1',protected_player_ids:['Brian Burns','Andrew Thomas']},prior,undefined,undefined,'Find minimum funding for the same acquisition.');
  assert.equal((flat.body.cap_strategy as unknown as CapStrategyArtifact).decision.kind,'no_funding');
  await assert.rejects(()=>executeCapStrategy({budget:{type:'cap',amount:99_000_000,reserve:1_000_000}},prior,undefined,undefined,'Find minimum funding.'),/explicit user inputs/);
});

test('the analyst persists solver provenance and keeps both decision and sensitivity tables',async()=>{
  const prior=await buildCapStrategy(fixture());let calls=0;
  const message=(name:string,input:unknown)=>({id:'fixture',type:'message',role:'assistant',model:'fixture',stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0},content:[{type:'tool_use',id:'fixture-tool',name,input}]} as Anthropic.Message);
  const answer=await buildNflAiAnswer('Use a $3 million available cap budget and keep the same reserve. Find the minimum funding.',{
    history:[{question:'Find minimum funding.',body:prior.body}],prefetch:false,
    loadData:async()=>({seed:await loadNflDemoSeed(),source_mode:'supabase_current_views',fallback_reason:null}),reviewDraft:async()=>[],
    callModel:async()=>++calls===1?message('find_minimum_cap_funding',{}):message('finish_analysis',{evidence_id:'lookup_1',continuation_query_id:'lookup_1',answer:'The acquisition needs conditional funding under the smaller budget. The conversion preserves annual cash while adding future cap obligations.',answer_statements:['lookup_1:answer'],tables:[{table_id:'lookup_1:0'}]}),
  });
  assert.equal(calls,2);assert.equal(answer.body.ai_analysis!.outcome,'complete');
  const artifact=answer.body.cap_strategy as unknown as CapStrategyArtifact;
  assert.equal(artifact.decision.selected!.conversion,2_000_000);assert.equal(artifact.discovery_inputs.moves[1].conversion_amount,6_000_000);
  assert.equal(answer.body.tables[1].title,'Sensitivity: one input changed at a time');
  assert.deepEqual(answer.body.followups,['Find the minimum funding again with the same terms and constraints.','Show every later cap allocation for the recommended funding move.','Explain which funding candidates were excluded and why.']);
  assert.equal(answer.body.conversation_state!.active.budget!.amount,3_000_000);
  assert.deepEqual(answer.body.conversation_state!.active.protected_player_names,['Brian Burns','Andrew Thomas']);
  assert.ok(answer.body.conversation_state!.active.supplied_terms.some(s=>s.includes('Calculated minimum conversion for Paulson Adebo: $2,000,000')));
  const sources=new Set(answer.sources.map(s=>s.ref_index));for(const table of answer.body.contract_scenario!.tables!)for(const ref of table.source_refs)assert.ok(sources.has(ref));
});

test('saved strategy contains the decision, sensitivity, mechanisms and resolvable references',async()=>{
  const input=fixture();input.budget!.amount=3_000_000;const answer=await buildCapStrategy(input);
  assert.equal(answer.body.tables[0].rows.length,3);assert.equal(answer.body.tables[1].rows.length,7);
  assert.ok(answer.body.tables.some(t=>t.title.includes('Controlling CBA')));
  assert.match(answer.sources.find(s=>s.title?.includes('Jakobi Meyers'))!.source!,/User-supplied illustrative/);
  const refs=new Set(answer.sources.map(s=>s.ref_index));for(const table of answer.body.tables)for(const ref of table.source_refs)assert.ok(refs.has(ref));
  assert.match(answer.body.answer,/calculator derives a \$2,000,000 conversion/);
});

test('a new unpaid-salary limit needs no conversion target and omission cannot remove it',async()=>{
  const prior=fixture();prior.moves=prior.moves.filter(m=>m.action==='acquire');prior.budget!.amount=3_000_000;
  const question='Paulson Adebo has unpaid salary available of $1 million. Find minimum funding for the same acquisition.';
  const first=await executeCapStrategy({funding_observations:[{player_id:'Paulson Adebo',unpaid_salary_available:1_000_000}]},prior,undefined,undefined,question);
  assert.equal((first.body.cap_strategy as unknown as CapStrategyArtifact).decision.kind,'no_supported_fit');
  assert.deepEqual(first.body.funding_observations!.observations,[{player_id:'Paulson Adebo',unpaid_salary_available:1_000_000}]);
  const replacement=structuredClone(prior);replacement.moves=prior.moves.filter(m=>m.action==='acquire');
  const second=await executeCapStrategy({scenario:replacement,funding_observations:[]},first.body.contract_scenario!.args as NflContractScenarioArgs,first.body.cap_strategy,undefined,'Keep the same terms and limits. Find minimum funding again.');
  assert.equal((second.body.cap_strategy as unknown as CapStrategyArtifact).decision.kind,'no_supported_fit');
  assert.deepEqual(second.body.funding_observations,first.body.funding_observations);
  const automatic=await executeCapStrategy({},prior,undefined,undefined,question);
  assert.deepEqual(automatic.body.funding_observations,first.body.funding_observations);
});

test('funding observations survive ordinary comparisons and constrain a later funding search',async()=>{
  const input=fixture();input.moves[1].unpaid_salary_available=1_000_000;
  const first=await buildCapStrategy(input);
  const plain=await executeContractComparison(first.body.contract_scenario!.args,'Compare acquisition alone with hold.',first.body.contract_scenario!.args as NflContractScenarioArgs,undefined,'Compare acquisition alone with hold.',[first.body.funding_observations!]);
  assert.equal(plain.body.cap_strategy,undefined);assert.deepEqual(plain.body.funding_observations,first.body.funding_observations);
  // Only the latest answer is required after the observation is carried forward.
  let calls=0;const message=(name:string,input:unknown)=>({id:'fixture',type:'message',role:'assistant',model:'fixture',stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:0,output_tokens:0},content:[{type:'tool_use',id:'fixture-tool',name,input}]} as Anthropic.Message);
  const answer=await buildNflAiAnswer('Use a $3 million available cap budget and keep the same reserve. Find minimum funding again.',{
    history:[{question:'Compare acquisition alone with hold.',body:plain.body}],prefetch:false,loadData:async()=>({seed:await loadNflDemoSeed(),source_mode:'supabase_current_views',fallback_reason:null}),reviewDraft:async()=>[],
    callModel:async()=>++calls===1?message('find_minimum_cap_funding',{}):message('finish_analysis',{evidence_id:'lookup_1',continuation_query_id:'lookup_1',answer:'The retained unpaid-salary limit prevents a supported single conversion from closing the gap.',answer_statements:['lookup_1:answer']}),
  });
  assert.equal(answer.body.ai_analysis!.outcome,'complete');assert.equal((answer.body.cap_strategy as unknown as CapStrategyArtifact).decision.kind,'no_supported_fit');
  assert.equal(answer.body.funding_observations!.observations[0].unpaid_salary_available,1_000_000);
});

test('candidate limit revisions bind to the exact player and persist independently of the selected move',async()=>{
  const input=fixture();input.budget!.amount=3_000_000;input.moves=input.moves.filter(m=>m.action==='acquire');
  const first=await executeCapStrategy({},input,undefined,undefined,'Paulson Adebo unpaid salary available: $1 million. Find minimum funding.');
  const changed=await executeCapStrategy({funding_observations:[{player_id:'Paulson Adebo',unpaid_salary_available:2_000_000}]},first.body.contract_scenario!.args as NflContractScenarioArgs,first.body.cap_strategy,undefined,'Paulson Adebo unpaid salary available: $2 million. Keep the same acquisition terms.');
  assert.equal((changed.body.cap_strategy as unknown as CapStrategyArtifact).decision.selected!.conversion,2_000_000);
  await assert.rejects(()=>executeCapStrategy({funding_observations:[{player_id:'Paulson Adebo',unpaid_salary_available:9_000_000}]},input,undefined,undefined,'Brian Burns unpaid salary available: $9 million.'),/explicit player-bound/);
  await assert.rejects(()=>executeCapStrategy({funding_observations:[{player_id:'Paulson Adebo',unpaid_salary_available:9_000_000}]},input,undefined,undefined,'Find minimum funding.'),/explicit player-bound/);
});

test('ordinary requested conversions also apply retained unpaid-salary constraints',async()=>{
  const input=fixture();input.moves=input.moves.filter(m=>m.action==='acquire');
  const first=await executeCapStrategy({},input,undefined,undefined,'Paulson Adebo unpaid salary available: $1 million. Find minimum funding.');
  const proposed=structuredClone(input);proposed.moves.push({player_id:'Paulson Adebo',action:'restructure',conversion_amount:2_000_000});
  const question='Convert $2 million of Paulson Adebo’s salary and compare with acquisition alone.';
  const compared=await executeContractComparison(proposed,question,input,undefined,question,[first.body.funding_observations!]);
  assert.equal(compared.scenario_result.status,'blocked');assert.ok(compared.scenario_result.issues.some(i=>i.code==='UNPAID_SALARY_LIMIT'));
});

test('funding discovery normalizes equivalent and complementary input forms before literal validation',async()=>{
  const input=fixture();
  const answer=await executeCapStrategy({scenario:{moves:input.moves,budget:{type:'cap',reserve:1_000_000}},moves:structuredClone(input.moves),budget:{type:'cap',amount:3_000_000}},input,undefined,undefined,'Use a $3 million available cap budget and keep the same reserve. Find minimum funding.');
  const strategy=answer.body.cap_strategy as unknown as CapStrategyArtifact;
  assert.equal(strategy.decision.selected!.conversion,2_000_000);
  assert.deepEqual(strategy.discovery_inputs.budget,{type:'cap',amount:3_000_000,reserve:1_000_000});
  assert.deepEqual(strategy.discovery_inputs.protected_player_ids,input.protected_player_ids);
  await assert.rejects(()=>executeCapStrategy({scenario:{budget:{amount:5_000_000}},budget:{amount:3_000_000}},input,undefined,undefined,'Find minimum funding.'),/Conflicting nested and flat values for scenario.budget.amount/);
  await assert.rejects(()=>executeCapStrategy({scenario:{},budget:{type:'cap',amount:9_000_000,reserve:1_000_000}},input,undefined,undefined,'Find minimum funding.'),/explicit user inputs/);
  await assert.rejects(()=>executeCapStrategy({scenario:[]},input,undefined,undefined,'Find minimum funding.'),/scenario must be an object/);
});

test('a single-conversion result cannot promise fit through uncalculated roster moves',async()=>{
  const answer=await buildCapStrategy(fixture());
  const prose=(text:string)=>({answer:text,findings:[],caveats:[],assumptions:[],followups:[]});
  assert.ok(categoricalGroundingIssues(prose('The plan would fit if the reserve came down, or via tools outside this single-conversion search (multiple conversions, a release/trade, or an extension).'),[answer]).some(i=>i.includes('single conversions only')));
  assert.ok(categoricalGroundingIssues(prose('Multiple conversions could bridge the gap.'),[answer]).some(i=>i.includes('single conversions only')));
  assert.deepEqual(categoricalGroundingIssues(prose('Multiple conversions or a release/trade need a separate calculation; their fit is unknown. The tested budget increase removes the funding need.'),[answer]),[]);
});
