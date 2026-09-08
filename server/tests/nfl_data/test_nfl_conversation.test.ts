import assert from 'node:assert/strict';
import test from 'node:test';
import { updateNflConversationState } from '../../src/nfl_conversation/state.js';
import { resolveEvidenceProse } from '../../src/nfl_conversation/grounding.js';
import { buildNflReceiverComparison,suppliedEvaluations } from '../../src/nfl_scouting/evidence.js';
import { loadNflDemoSeed } from '../../src/nfl_data/seed.js';

test('objective change clears incompatible constraints; explicit restore returns the exact earlier scenario',()=>{
 const first=updateNflConversationState({objective:'acquisition',candidate_scope:'external',budget:{type:'cap',amount:5e6,reserve:1e6},transaction:'trade',protected_player_names:['Malik Nabers']},undefined,'Use a $5 million cap budget with $1 million reserve. Keep Malik Nabers.');
 const second=updateNflConversationState({objective:'internal_roster',candidate_scope:'internal'},first,'Use our roster instead.');
 assert.equal(second.active.budget,null);assert.equal(second.active.transaction,'none');assert.deepEqual(second.active.protected_player_names,[]);
 const restored=updateNflConversationState({operation:'restore',restore_id:first.active.id},second,'Compare with the earlier trade option.');
 assert.deepEqual(restored.active,first.active);
 assert.throws(()=>updateNflConversationState({objective:'acquisition',budget:{type:'cap',amount:2026,reserve:0}},undefined,'Compare the options for 2026.'),/invent/);
 assert.throws(()=>updateNflConversationState({objective:'acquisition',budget:{type:'cap',amount:8e6,reserve:0}},undefined,'Affordable, please.'),/invent/);
});
test('numbers cannot acquire new meaning in model prose; tool tables own quantities',()=>{
 const evidence=new Map([['lookup_1',{body:{tables:[{rows:[['Courtland Sutton','$13,975,000']]}]} as any}]]);
 assert.equal(resolveEvidenceProse('The current-team charge is shown in the table.',evidence),'The current-team charge is shown in the table.');
 for(const value of ['His charge is $13 million.','He has 1234 yards.','He earns five million dollars.','Charge {{lookup_1:0:r9:c1}}.','Offer eleven million dollars guaranteed.','A twenty percent risk.','There is a {{lookup_1:0:r0:c1}} percent injury probability.'])assert.throws(()=>resolveEvidenceProse(value,evidence));
});
test('receiver priorities change evidence order and multi-team totals use the whole regular season',async()=>{
 const seed=await loadNflDemoSeed();
 const production=await buildNflReceiverComparison({priority:'receiving_production'},seed,'');
 const flexibility=await buildNflReceiverComparison({priority:'contract_horizon'},seed,'');
 const inside=await buildNflReceiverComparison({priority:'inside_role'},seed,'');
 assert.equal(production.body.tables[0].rows[0][0],'Courtland Sutton');
 assert.notEqual(flexibility.body.tables[0].rows[0][0],'Courtland Sutton');
 assert.equal(inside.body.tables[0].rows[0][0],'Jakobi Meyers');
 const meyers=production.body.tables[0].rows.find(r=>r[0]==='Jakobi Meyers')!;
 assert.deepEqual(meyers.slice(3,7),[16,75,835,3]);
 const internal=await buildNflReceiverComparison({candidate_scope:'internal'},seed,'');
 assert.ok(internal.body.tables[0].rows.every(r=>String(r[1]).startsWith('NYG')));
});
test('an added evaluation retains exact attribution and cannot masquerade as a verified public source',async()=>{
 const text='[Evaluation]\nPlayer: Christian Kirk\nAuthor: Example evaluator v1\nDate: 2026-09-08\nObservation: Illustrative review: investigate the inside role.\n[/Evaluation]';
 assert.equal(suppliedEvaluations(text)[0].author,'Example evaluator v1');
 const answer=await buildNflReceiverComparison({},await loadNflDemoSeed(),text);
 assert.ok(answer.sources.some(s=>s.source==='user-supplied evaluation'&&JSON.stringify(s.data).includes('not independently verified')));
});


test('financial refinements retain a separately bound budget and reject swapped budget/reserve fields',()=>{
 const question='Use a $5 million cap budget and a $1 million reserve. Keep Brian Burns.';
 const first=updateNflConversationState({objective:'acquisition',budget:{type:'cap',amount:5e6,reserve:1e6},protected_player_names:['Brian Burns']},undefined,question);
 const next=updateNflConversationState({objective:'contract'},first,'Calculate the proposed acquisition.');
 assert.deepEqual(next.active.budget,first.active.budget);assert.deepEqual(next.active.protected_player_names,['Brian Burns']);
 assert.throws(()=>updateNflConversationState({objective:'acquisition',budget:{type:'cap',amount:1e6,reserve:5e6}},undefined,question),/separately/);
 assert.throws(()=>updateNflConversationState({objective:'contract',budget:null},first,'Calculate the proposed acquisition.'),/Retain/);
});
