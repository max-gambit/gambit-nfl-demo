import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import dotenv from 'dotenv';
import {NFL_QUALITY_CASES,NFL_QUALITY_SEQUENCES} from './nfl-quality-cases.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
dotenv.config({path:path.join(root,'server/.env')});
// Evaluations always read checked-in public records. No presenter session writes.
delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg=(name:string,fallback:string)=>process.argv[process.argv.indexOf(name)+1]??fallback;
const phase=process.argv.includes('--phase')?arg('--phase','probe'):'probe';
const out=path.resolve(root,process.argv.includes('--out')?arg('--out',''):'test-results/analyst-restoration');
await fs.mkdir(out,{recursive:true});
const moduleAt=async(p:string)=>import(pathToFileURL(path.join(root,p)).href);
const api=await moduleAt('server/src/nfl_facts/ai_answer.ts');
const client=await moduleAt('server/src/claude/client.ts');
const trades=await moduleAt('server/src/nfl_transactions/seed.ts');
const savedContracts=await moduleAt('server/src/nfl_contracts/saved.ts');
const fixtureYear=(year:number,salary:number)=>({year,kind:'active',base_salary:salary,guaranteed_salary:0,other_cash:0,guaranteed_other_cash:0,incentives_cap_charge:0,incentives_cash:0,salary_paid_by_prior_team:0,other_cash_paid_by_prior_team:0});
const savedRows=[{id:'00000000-0000-4000-8000-000000000001',session_id:'00000000-0000-4000-8000-000000000002',created_at:'2026-09-08T19:00:00Z',contract_args:{schema_version:1,season:2026,team_id:'NYG',timing:'post_june_1',moves:[{player_id:'Jakobi Meyers',action:'acquire',illustrative_terms:{basis:'user_supplied_illustrative',label:'QA illustration only',terms_complete:true,user_input:'For this explicitly illustrative QA acquisition, use $9 million unpaid 2026 salary, $12 million 2027 salary, a $2 million new signing bonus, no guaranteed compensation, other cash, incentives, prior-team obligations, paid compensation or void years.',signing_bonus:2000000,years:[fixtureYear(2026,9000000),fixtureYear(2027,12000000)],prior_team_obligations:[],guarantee_note:'Explicitly illustrative zero guarantees'}}]}}];
await saveFixture();
async function saveFixture(){await fs.writeFile(path.join(out,'saved-contract-fixture.json'),JSON.stringify(savedRows,null,2));}

const runtimePaths=execFileSync('git',['ls-files','server/src','shared'],{cwd:root,encoding:'utf8'}).trim().split('\n');
const runtimeHashes=await Promise.all(runtimePaths.map(async p=>({path:p,sha256:createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex')})));
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const save=async(name:string,value:unknown)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const read=async(name:string)=>JSON.parse(await fs.readFile(path.join(out,name),'utf8'));
const exists=async(name:string)=>fs.access(path.join(out,name)).then(()=>true,()=>false);
if(['writing','e2e','judge'].includes(phase)){
 const manifest=await read('manifest.json');
 if(hash(runtimeHashes)!==hash(manifest.runtimeHashes))throw new Error('Runtime changed since evidence freeze. Start a versioned comparison directory.');
 for(const file of manifest.files){const digest=createHash('sha256').update(await fs.readFile(path.join(root,file.path))).digest('hex');if(digest!==file.sha256)throw new Error('Public evidence changed since freeze: '+file.path);}
}

async function pool<T>(jobs:(()=>Promise<T>)[]){let index=0;const results:T[]=[];await Promise.all([0,1].map(async()=>{while(index<jobs.length){const at=index++;results[at]=await jobs[at]();}}));return results;}
async function runTurn(id:string,question:string,pipeline:string,history:unknown[]=[]){
 const events:unknown[]=[];let evidence:unknown[]=[];const started=Date.now();
 const callModel=async(params:any,options:any)=>{events.push({request:params});try{const result=await client.createClaudeMessage(params,options);events.push({response:result});return result;}catch(error){events.push({provider_error:String(error)});throw error;}};
 try{const result=await api.buildNflAiAnswer(question,{pipeline,deadlineMs:120000,history,callModel,sessionId:'00000000-0000-4000-8000-000000000003',readSavedContract:async(request:any,context:any)=>savedContracts.selectSavedNflContract(savedRows,request,context),loadTradeSnapshot:async()=>(await trades.loadReviewedNflTransactionSnapshot()).snapshot,onEvidence:(e:unknown[])=>{evidence=e;},onTrace:(e:unknown)=>events.push(e)});const record={id,question,pipeline,history,runtime_hash:hash(runtimeHashes),result,evidence,events,elapsed_ms:Date.now()-started,evidence_hash:hash(evidence)};await save(id+'.json',record);console.log(id,result.body.ai_analysis?.outcome,record.elapsed_ms);return record;}
 catch(error){const record={id,question,pipeline,history,runtime_hash:hash(runtimeHashes),error:String(error),evidence,events,elapsed_ms:Date.now()-started};await save(id+'.json',record);console.log(id,'ERROR',String(error));return record;}
}
if(phase==='probe'){const selected=process.argv.includes('--case')?arg('--case','receiver_flexibility').split(','):['receiver_flexibility'];await pool(NFL_QUALITY_CASES.filter(c=>selected.includes(c.id)).map(c=>()=>runTurn('probe-'+c.id+'-'+Date.now(),c.question,'candidate')));}
if(phase==='freeze'){
 const paths=execFileSync('git',['ls-files','data'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>p.includes('/nfl'));
 const files=await Promise.all(paths.map(async p=>{const contents=await fs.readFile(path.join(root,p));const frozen=path.join(out,'frozen-data',p);await fs.mkdir(path.dirname(frozen),{recursive:true});await fs.writeFile(frozen,contents);return {path:p,sha256:createHash('sha256').update(contents).digest('hex')};}));
 if(!files.length)throw new Error('No frozen public evidence files found.');
 await save('manifest.json',{created_at:new Date().toISOString(),saved_contract_fixture_hash:hash(savedRows),candidate_revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),baseline_revision:'e16ec81',historical_revisions:['32722f3','7c740fc'],model:client.BRIEF_MODEL,effort:'low',concurrency:2,deadline_ms:120000,latency_policy:'Quality is the release priority; elapsed time is reported as a tradeoff per user direction.',runtimeHashes,files,question_bank:NFL_QUALITY_CASES,sequences:NFL_QUALITY_SEQUENCES});
 await pool(NFL_QUALITY_CASES.map(c=>async()=>{if(await exists('evidence-'+c.id+'.json'))return;const r=await runTurn('capture-'+c.id,c.question,'candidate');await save('evidence-'+c.id+'.json',{question:c.question,heldOut:c.heldOut,evidence:r.evidence,evidence_hash:hash(r.evidence)});}));
}
if(phase==='e2e')await pool(NFL_QUALITY_SEQUENCES.flatMap(sequence=>['legacy','candidate'].flatMap(pipeline=>[1,2].map(trial=>async()=>{const history:unknown[]=[];for(const [i,q] of sequence.questions.entries()){const id=`e2e-${sequence.id}-${pipeline}-${trial}-${i+1}`;const r=await exists(id+'.json')?await read(id+'.json'):await runTurn(id,q,pipeline,history);history.push({question:q,body:r.result?.body??null});}}))));
function historicalPrompt(rev:string,file:string,name:string){const code=execFileSync('git',['show',rev+':'+file],{cwd:root,encoding:'utf8'});const start=code.indexOf('const '+name+' = `');if(start<0)throw new Error('Missing historical prompt '+name);const from=start+('const '+name+' = `').length;return code.slice(from,code.indexOf('`;',from)).replaceAll('\\`','`');}
if(phase==='writing'){
 const variants={original:historicalPrompt('32722f3','server/src/claude/prompts.ts','BRIEF_SYSTEM'),september8:historicalPrompt('7c740fc','server/src/nfl_facts/ai_answer.ts','NFL_ANALYST_SYSTEM'),current:(await moduleAt('server/src/nfl_facts/ai_answer_v1.ts')).NFL_ANALYST_SYSTEM,candidate:api.NFL_ANALYST_SYSTEM};
 await save('writer-prompts.json',variants);
 await save('writer-context.json',{runtimeHashes,model:client.BRIEF_MODEL,effort:'low',max_tokens:4500});
 await pool(NFL_QUALITY_CASES.flatMap(c=>Object.entries(variants).flatMap(([variant,prompt])=>[1,2].map(trial=>async()=>{
 const id=`writing-${c.id}-${variant}-${trial}`;if(await exists(id+'.json'))return;const bundle=await read('evidence-'+c.id+'.json');const start=Date.now();
 try{const response=await client.createClaudeMessage({model:client.BRIEF_MODEL,max_tokens:4500,output_config:{effort:'low'},system:String(prompt)+'\n\nCONTROLLED WRITING REPLAY: All investigation has already run. Use only the identical supplied evidence and context. Adapt output format only: return the answer as prose with [source-ref] citations, alternatives and follow-ups when your writing contract requests them. No tools are available. Do not describe this evaluation. This is a historical-prompt replay, not the original application.',messages:[{role:'user',content:JSON.stringify(bundle)}]},{timeout:60000,maxRetries:0});await save(id+'.json',{id,variant,trial,question:c.question,evidence_hash:bundle.evidence_hash,answer:response.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'),elapsed_ms:Date.now()-start,model:response.model,usage:response.usage,stop_reason:response.stop_reason});console.log(id,'done',Date.now()-start);}
 catch(error){await save(id+'.json',{id,variant,trial,question:c.question,evidence_hash:bundle.evidence_hash,error:String(error),elapsed_ms:Date.now()-start});console.log(id,'ERROR');}
 }))));
}
if(phase==='judge'){
 const {judgeNflAnswerQuality}=await import('./terra-judge.js');
 async function judge(id:string,question:string,records:any[],evidence:unknown,context:unknown){
  if(await exists(id+'.json'))return;
  const ordered=records.slice().sort((a,b)=>hash(id+a.id).localeCompare(hash(id+b.id)));
  const labels=Object.fromEntries(ordered.map((r,i)=>[String.fromCharCode(65+i),r.id]));
  const answers=ordered.map((r,i)=>{
    const body=r.result?.body;
    const rendered=body?JSON.stringify({answer:body.answer_paragraphs?.length?body.answer_paragraphs.map((p:any)=>p.text+' ['+p.source_refs.join(', ')+']').join('\n\n'):body.answer,findings:body.key_findings,tables:body.tables,calculations:body.calculations,supporting_details:body.supporting_details,followups:body.followups,caveats:body.caveats,scenario_state:body.conversation_state,historical_selection:body.historical_selection}):'INCOMPLETE';
    return {label:String.fromCharCode(65+i),answer:r.error?'INCOMPLETE: '+r.error:r.answer??rendered};
  });
  try{const result=await judgeNflAnswerQuality({apiKey:process.env.OPENAI_API_KEY,anthropicCall:client.createClaudeMessage,anthropicModel:client.BRIEF_MODEL,question,context,evidence,answers});await save(id+'.json',{id,labels,...result});console.log(id,'done');}
  catch(error){await save(id+'.json',{id,labels,error:String(error)});console.log(id,'ERROR',String(error));}
 }
 const jobs:(()=>Promise<void>)[]=[];
 for(const c of NFL_QUALITY_CASES)for(const trial of [1,2])jobs.push(async()=>{const records=await Promise.all(['original','september8','current','candidate'].map(v=>read(`writing-${c.id}-${v}-${trial}.json`)));const bundle=await read('evidence-'+c.id+'.json');await judge(`judge-writing-${c.id}-${trial}`,c.question,records,bundle.evidence,[]);});
 for(const seq of NFL_QUALITY_SEQUENCES)for(const trial of [1,2])for(const [i,q] of seq.questions.entries())jobs.push(async()=>{const records=await Promise.all(['legacy','candidate'].map(v=>read(`e2e-${seq.id}-${v}-${trial}-${i+1}.json`)));const evidence=records.flatMap(r=>r.evidence?.length?r.evidence:r.events.flatMap((e:any)=>e.request?.messages?.flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((b:any)=>b.type==='tool_result').map((b:any)=>b.content):[])??[]));await judge(`judge-e2e-${seq.id}-${trial}-${i+1}`,q,records,evidence,records[0].history.map((t:any)=>t.question));});
 await pool(jobs);
}
if(phase==='report'){
 const files=await fs.readdir(out);const judgments=await Promise.all(files.filter(f=>f.startsWith('judge-')&&f.endsWith('.json')).map(read));
 const scores:any[]=[];const prefs:any[]=[];
 for(const j of judgments){if(j.error)continue;for(const a of j.verdict.answers)scores.push({...a,id:j.labels[a.label],judge:j.id});for(const p of j.verdict.preferences)prefs.push({...p,a:j.labels[p.a],b:j.labels[p.b],winner:p.winner==='tie'?'tie':j.labels[p.winner],judge:j.id});}
 const averages=(rows:any[])=>Object.fromEntries(['relevance','depth','alternatives','uncertainty','decision_usefulness','followup_usefulness'].map(k=>[k,rows.reduce((s,r)=>s+r[k],0)/Math.max(1,rows.length)]));
 const byVariant=Object.fromEntries(['original','september8','current','candidate'].map(v=>[v,averages(scores.filter(s=>s.id.startsWith('writing-')&&s.id.includes('-'+v+'-')))]));
 const pairs=prefs.filter(p=>[p.a,p.b].some(id=>id.includes('-candidate-'))&&[p.a,p.b].some(id=>id.includes('-current-')||id.includes('-legacy-')));
 const prefScore=(rows:any[])=>rows.reduce((s,p)=>s+(p.winner==='tie'?0.5:p.winner.includes('-candidate-')?1:0),0)/Math.max(1,rows.length);
 const candidate=scores.filter(s=>s.id.includes('-candidate-'));const materialErrors=candidate.flatMap(s=>s.material_errors.map((error:string)=>({id:s.id,error})));
 const runs=await Promise.all(files.filter(f=>f.startsWith('e2e-')&&f.includes('-candidate-')&&f.endsWith('.json')).map(read));
 const latencies=runs.map(r=>r.elapsed_ms).sort((a,b)=>a-b);
 const captures=await Promise.all(files.filter(f=>f.startsWith('capture-')&&f.endsWith('.json')).map(read));
 const ordinary=[...captures.filter(r=>NFL_QUALITY_CASES.some(c=>!c.complex&&r.id==='capture-'+c.id)),...runs.filter(r=>/^e2e-scope-candidate-[12]-[23]$|^e2e-saved-candidate-[12]-2$/.test(r.id))].map(r=>r.elapsed_ms).sort((a,b)=>a-b);
 const median=(values:number[])=>values.length?(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2:null;
 const summary={sample:'Bounded historical prompt replays and actual tool pipelines; not universal reliability',judges:judgments.length,judge_errors:judgments.filter(j=>j.error),writing_scores:byVariant,candidate_scores:averages(candidate),pair_count:pairs.length,pairwise_preference:prefScore(pairs),writing_preference:prefScore(pairs.filter(p=>p.judge.startsWith('judge-writing'))),e2e_preference:prefScore(pairs.filter(p=>p.judge.startsWith('judge-e2e'))),complete_fraction:candidate.filter(s=>s.complete_or_useful_input).length/Math.max(1,candidate.length),material_errors:materialErrors,ordinary_sample_count:ordinary.length,ordinary_median_ms:median(ordinary),e2e_candidate_median_ms:median(latencies),e2e_candidate_max_ms:Math.max(0,...latencies),direct_claim_review:await exists('direct-claim-review.json')?await read('direct-claim-review.json'):null,
 expected_counts:{writing:96,e2e:48,judgments:48},
 actual_counts:{writing:files.filter(f=>f.startsWith('writing-')&&f.endsWith('.json')).length,e2e:files.filter(f=>f.startsWith('e2e-')&&f.endsWith('.json')).length,judgments:judgments.filter(j=>!j.error).length},
 judge_models:[...new Set(judgments.filter(j=>!j.error).map(j=>j.model))],
 judge_limitation:'A separate blinded configured-model call substitutes for the unavailable OpenAI judge credential. Same-family bias is possible; scores are accompanied by direct review.',
 e2e_complete_fraction:runs.filter(r=>['complete','needs_input'].includes(r.result?.body?.ai_analysis?.outcome)).length/Math.max(1,runs.length),
 held_out_scores:averages(candidate.filter(s=>NFL_QUALITY_CASES.some(c=>c.heldOut&&s.id.includes(c.id))))};
 const gates={comparison_complete:summary.actual_counts.writing===96&&summary.actual_counts.e2e===48&&summary.actual_counts.judgments===48,
 pairwise_preference:summary.pairwise_preference>=0.7,
 relevance_depth_decision:['relevance','depth','decision_usefulness'].every(k=>summary.candidate_scores[k]>=4),
 historical_writing_quality:['relevance','depth','decision_usefulness'].every(k=>byVariant.candidate[k]>=Math.max(byVariant.original[k],byVariant.september8[k])),
 completion:summary.complete_fraction>=0.9&&summary.e2e_complete_fraction>=0.9,
 no_material_errors:materialErrors.length===0,
 direct_review:summary.direct_claim_review?.passed===true,
 bounded_deadline:summary.e2e_candidate_max_ms<=121000};
 await save('gates.json',{...gates,accepted:Object.values(gates).every(Boolean)});
 await save('summary.json',summary);console.log(JSON.stringify(summary,null,2));
 const report=['# Giants analyst restoration comparison','',JSON.stringify(summary,null,2),'','## Anonymous judgments and source records',...judgments.map(j=>`- [${j.id}](${j.id}.json)`)].join('\n');await fs.writeFile(path.join(out,'comparison.md'),report);
}
