import assert from 'node:assert/strict';
import test from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { buildNflExampleEvidence } from '../../src/nfl_examples/evidence.js';
import { categoricalGroundingIssues, reviewNflAnalystSemantics, type AnalystAuthoredProse } from '../../src/nfl_conversation/semantic_grounding.js';
import { buildNflAiAnswer } from '../../src/nfl_facts/ai_answer.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';
import { buildNflReceiverComparison } from '../../src/nfl_scouting/evidence.js';
import { executeContractComparison } from '../../src/nfl_conversation/contract_tools.js';

const prose = (answer: string): AnalystAuthoredProse => ({ answer, findings: [], caveats: [], assumptions: [], followups: [] });
const message = (name: string, input: unknown): Anthropic.Message => ({ id: 'fixture', type: 'message', role: 'assistant', model: 'fixture', stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 }, content: [{type:'tool_use', id:'fixture-tool', name, input}] } as Anthropic.Message);

test('conversion accounting cannot invent a new guarantee on already guaranteed salary', async () => {
  const evidence = [await executeContractComparison({schema_version:1,season:2026,team_id:'NYG',timing:'post_june_1',moves:[{player_id:'Paulson Adebo',action:'restructure',conversion_amount:6_000_000}]},'Convert $6 million of Paulson Adebo’s 2026 salary after June 1.',undefined,undefined)];
  assert.ok(categoricalGroundingIssues(prose('The conversion turns previously unguaranteed money into guaranteed money.'),evidence).some(issue=>issue.includes('guaranteed compensation')));
  assert.deepEqual(categoricalGroundingIssues(prose('The conversion shifts cap recognition into next year and preserves annual cash. Salary may already be guaranteed; this comparison does not calculate a change in guarantees.'),evidence),[]);
  assert.ok(evidence[0].comparison_result.mechanisms.some(m=>m.limitations.includes('salary may already be guaranteed')));
});

test('unknown incoming price cannot become a cheaper-player assertion', async () => {
  const evidence = [await buildNflReceiverComparison({},await loadNflDemoSeed(),'Compare receiver options.')];
  assert.ok(categoricalGroundingIssues(prose('Treat Kirk as a lower-cost dice-roll.'),evidence).some(issue=>issue.includes('incoming price')));
  assert.deepEqual(categoricalGroundingIssues(prose('If an acceptable price is confirmed, investigate Kirk as a short-horizon alternative. Current-team cap does not establish a cheaper acquisition.'),evidence),[]);
});

test('actual report rejects the observed full-practice premise and unsupported workload decline', async () => {
  const evidence = [await buildNflExampleEvidence({domain:'availability',question:'Show the historical Andrew Thomas report.',playerName:'Andrew Thomas'})];
  assert.ok(categoricalGroundingIssues(prose('Andrew Thomas was a full participant all week.'), evidence).some(i => i.includes('Andrew Thomas')));
  assert.ok(categoricalGroundingIssues(prose('Prioritize Thomas because his snaps dropped sharply.'), evidence).some(i => i.includes('baseline')));
  assert.deepEqual(categoricalGroundingIssues(prose('Thomas stayed limited in practice. His observed game workload needs context; there is no prior baseline to establish a decline.'), evidence), []);
});

test('review fails closed on malformed or inconsistent verdicts and passes specific evidence issues through', async () => {
  const input = {question:'What should we inspect?',authored:prose('Thomas was fully healthy.'),selected_answer:'Thomas was fully healthy.',selected_tables:[],evidence:[],tool_coverage:{}};
  for (const bad of [{pass:true,issues:['Contradiction']},{pass:false,issues:[]},{issues:[]}]) {
    await assert.rejects(reviewNflAnalystSemantics(input,{callModel:async()=>message('review_answer',bad)}),/valid result/);
  }
  assert.deepEqual(await reviewNflAnalystSemantics(input,{callModel:async()=>message('review_answer',{pass:false,issues:['The practice label does not certify health.']})}),['The practice label does not certify health.']);
  assert.deepEqual(await reviewNflAnalystSemantics(input,{callModel:async()=>message('review_answer',{pass:true,issues:[]})}),[]);
});

test('a rejected factual premise must be repaired before the saved answer is complete', async () => {
  let count = 0;
  const result = await buildNflAiAnswer('Use the historical report to prioritize investigation of Andrew Thomas.', {
    prefetch:false, loadData:async()=>({seed:await loadNflDemoSeed(),source_mode:'supabase_current_views',fallback_reason:null}), reviewDraft:async()=>[],
    callModel:async params => {
      if (!count++) return message('get_nfl_example_evidence',{domain:'availability',playerName:'Andrew Thomas'});
      if (count === 2) return message('finish_analysis',{answer:'Andrew Thomas was a full participant all week, so the game workload is unexpected.',evidence_id:'lookup_1',continuation_query_id:'lookup_1'});
      assert.match(JSON.stringify(params.messages.at(-1)), /limited or missed practice/);
      return message('finish_analysis',{answer:'Thomas stayed limited in practice. Review the workload plan with the staff; the report does not explain the reason for his usage.',evidence_id:'lookup_1',continuation_query_id:'lookup_1'});
    },
  });
  assert.equal(count,3);
  assert.equal(result.body.ai_analysis?.outcome,'complete');
  assert.doesNotMatch(result.body.answer,/full participant/);
});

test('selecting a comparison with a dossier primary still persists the displayed requested moves', async () => {
  let count = 0;
  const result = await buildNflAiAnswer('Convert $6 million of Paulson Adebo’s 2026 salary after June 1. Compare hold and conversion.', {
    prefetch:false, loadData:async()=>({seed:await loadNflDemoSeed(),source_mode:'supabase_current_views',fallback_reason:null}), reviewDraft:async()=>[],
    callModel:async()=> ++count === 1 ? message('read_contract_dossiers',{player_names:['Paulson Adebo']})
      : count === 2 ? message('nfl_contract_comparison',{schema_version:1,season:2026,team_id:'NYG',timing:'post_june_1',moves:[{player_id:'Paulson Adebo',action:'restructure',conversion_amount:6_000_000}]})
      : message('finish_analysis',{answer:'The conversion shifts cap recognition into the following season while preserving annual cash under these assumptions.',tables:[{table_id:'lookup_2:0'}],answer_statements:['lookup_2:answer'],evidence_id:'lookup_1',continuation_query_id:'lookup_1'}),
  });
  assert.equal(result.body.ai_analysis?.outcome,'complete');
  assert.equal((result.body.contract_scenario?.args as any).moves[0].conversion_amount,6_000_000);
  assert.ok((result.body.contract_scenario?.result as any).comparison);
});

test('unreviewed scenario assertions do not survive an interpretation-review outage', async () => {
  let count = 0;
  const result = await buildNflAiAnswer('Show the historical Andrew Thomas report.', {
    prefetch:false, loadData:async()=>({seed:await loadNflDemoSeed(),source_mode:'supabase_current_views',fallback_reason:null}),
    reviewDraft:async draft=> { assert.match(JSON.stringify(draft.body.conversation_state),/club has medically cleared/); throw new Error('review unavailable'); },
    callModel:async()=> ++count === 1 ? message('set_scenario',{operation:'update',objective:'availability',supplied_terms:['The club has medically cleared Thomas for unrestricted work.']})
      : count === 2 ? message('get_nfl_example_evidence',{domain:'availability',playerName:'Andrew Thomas'})
      : message('finish_analysis',{answer:'Thomas remained limited in the captured practices. The report does not establish current availability.',evidence_id:'lookup_1',continuation_query_id:'lookup_1'}),
  });
  assert.equal(result.body.ai_analysis?.outcome,'evidence_only');
  assert.doesNotMatch(JSON.stringify(result.body),/club has medically cleared/);
});

test('named workflow facts retain their own source references after another evidence pack is registered', async () => {
  let count = 0;
  const result = await buildNflAiAnswer('Review the historical Andrew Thomas report with source evidence.', {
    prefetch:false, loadData:async()=>({seed:await loadNflDemoSeed(),source_mode:'supabase_current_views',fallback_reason:null}), reviewDraft:async()=>[],
    callModel:async()=> ++count === 1 ? message('read_giants_cap',{})
      : count === 2 ? message('get_nfl_example_evidence',{domain:'availability',playerName:'Andrew Thomas'})
      : message('finish_analysis',{answer:'Thomas stayed limited in the recorded practices. Verify the staff workload plan before drawing a conclusion about his game usage.',evidence_id:'lookup_2',continuation_query_id:'lookup_2'}),
  });
  const source = result.sources.find(s => s.kind === 'AVAILABILITY' && s.data?.factual_assertions)!;
  assert.ok(source.ref_index > 1);
  const claims = source.data!.factual_assertions as Array<{source_refs:number[]}>;
  assert.ok(claims.length);
  for (const claim of claims) for (const ref of claim.source_refs) assert.equal(result.sources.find(s => s.ref_index === ref)?.kind,'AVAILABILITY');
});

test('a withheld opening premise keeps the executed summary ahead of dependent prose', async () => {
  let count = 0;
  const result = await buildNflAiAnswer('Use the historical Giants availability report to prioritize investigation.', {
    prefetch:false, loadData:async()=>({seed:await loadNflDemoSeed(),source_mode:'supabase_current_views',fallback_reason:null}), reviewDraft:async()=>[],
    callModel:async()=> ++count === 1 ? message('get_nfl_example_evidence',{domain:'availability'})
      : message('finish_analysis',{answer:'Start with the players who changed from limited to DNP on September 19. That directional change is a participation flag and warrants checking the next dated report.',evidence_id:'lookup_1',continuation_query_id:'lookup_1'}),
  });
  assert.equal(result.body.ai_analysis?.outcome,'complete');
  assert.equal(result.body.ai_analysis?.withheld_numeric_sentences,1);
  assert.ok(!result.body.answer.startsWith('That directional change'));
  assert.ok(result.body.answer.indexOf('Olszewski') < result.body.answer.indexOf('That directional change'));
});
