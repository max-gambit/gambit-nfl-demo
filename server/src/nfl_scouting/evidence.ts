import { RECEIVER_COMPARISON_METHODS } from '@shared/nflReceiverPresentation';
import capturedReceiving from '../../../data/nfl-scouting/receiving.json';
import { getNflContractDossier } from '../nfl_contracts/index.js';
import { readFile } from 'node:fs/promises';
import type Anthropic from '@anthropic-ai/sdk';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import type { NflDemoSeed } from '../nfl_data/seed.js';
export interface SuppliedEvaluation { player_name:string; author:string; date:string; observation:string; source_url?:string; kind:string; scope:string }
interface ReceivingRecord { player_name:string; source_url:string; captured_at:string; source_sha256:string; season:number; season_type:string; table:{columns:string[];rows:string[][]} }
const load = async <T>(name:string):Promise<T> => JSON.parse(await readFile(new URL('../../../data/nfl-scouting/'+name,import.meta.url),'utf8'));
export function officialReceivingTotals(name:string) {
  const record=capturedReceiving.records.find(r=>r.player_name===name);
  if(!record)return null;
  const at=(column:string)=>record.table.columns.indexOf(column);
  const total=(column:string)=>record.table.rows.reduce((sum,row)=>sum+Number(row[at(column)].replaceAll(',','')),0);
  return {games:total('G'),receptions:total('REC'),yards:total('YDS'),touchdowns:total('TD'),source_url:record.source_url,captured_at:record.captured_at};
}
export function suppliedEvaluations(question:string):SuppliedEvaluation[] {
  return [...question.matchAll(/\[Evaluation\]\s*\nPlayer: ([^\n]+)\nAuthor: ([^\n]+)\nDate: (\d{4}-\d{2}-\d{2})\nObservation: ([\s\S]*?)\n\[\/Evaluation\]/g)].map(m=>{
    if (m[1].length>100||m[2].length>160||m[4].length>2000||!Number.isFinite(Date.parse(m[3]))) throw new Error('Invalid supplied evaluation.');
    return {player_name:m[1].trim(),author:m[2].trim(),date:m[3],observation:m[4].trim(),kind:'user-supplied evaluation',scope:'Supplied in this conversation; attribution and observation are not independently verified.'};
  });
}
export async function buildNflReceiverComparison(input:unknown, seed:NflDemoSeed, userText:string):Promise<FactualAnswer> {
  const args=input as {priority?:string;candidate_scope?:string;player_names?:string[];assumed_unavailable_names?:string[]};
  if (!args||typeof args!=='object'||Object.keys(args).some(k=>!['priority','candidate_scope','player_names','assumed_unavailable_names'].includes(k))) throw new Error('Invalid receiver comparison arguments.');
  const priority=args.priority??'receiving_production',scope=args.candidate_scope??'both';
  if (!['receiving_production','contract_horizon','inside_role'].includes(priority)||!['external','internal','both'].includes(scope))throw new Error('Unsupported comparison scope.');
  const data=await load<{records:ReceivingRecord[]}>('receiving.json');
  const reports=[...(await load<{reports:SuppliedEvaluation[]}>('reports.json')).reports,...suppliedEvaluations(userText)];
  const internalNames=seed.roster_entries.filter(r=>r.team_id==='NYG'&&r.position==='WR').map(r=>r.player_name);
  const activeInternalNames=seed.roster_entries.filter(r=>r.team_id==='NYG'&&r.position==='WR'&&r.roster_status==='active').map(r=>r.player_name);
  const canonical=(name:string)=>{const normalized=(v:string)=>v.toLowerCase().replace(/\b(jr|iii|ii)\b\.?/g,'').replace(/[^a-z0-9]/g,'');const hits=seed.roster_entries.filter(r=>normalized(r.player_name)===normalized(name));return hits.length===1?hits[0].player_name:name;};
  const selectedNames=args.player_names?.map(canonical)??(scope==='internal'?activeInternalNames:['Courtland Sutton','Jakobi Meyers','Christian Kirk','Darnell Mooney','Malik Nabers']);
  const recordNames=new Set(data.records.map(r=>r.player_name));
  for(const name of selectedNames.filter(n=>internalNames.includes(n)&&!recordNames.has(n))){const roster=seed.roster_entries.find(r=>r.player_name===name)!;data.records.push({player_name:name,source_url:roster.source_url??'',captured_at:seed.as_of_date,source_sha256:'No receiving source captured',season:2025,season_type:'regular',table:{columns:[],rows:[]}});}
  if(!Array.isArray(selectedNames)||selectedNames.length>8||selectedNames.some(n=>!data.records.some(r=>r.player_name===n))) throw new Error('This deep comparison covers Sutton, Meyers, Kirk, Mooney and Nabers. Use search_player_records for the wider cohort.');
  const missing=args.assumed_unavailable_names??[];
  if(!Array.isArray(missing)||missing.some(n=>!seed.roster_entries.some(r=>r.player_name===n)))throw new Error('Unknown scenario player.');
  for(const name of missing){const nameParts=name.split(' ');const alias=nameParts.at(-1)!;const escaped=alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(!new RegExp('(?:'+escaped+'.{0,100}(?:unavailable|miss|injur|out|doubt)|(?:unavailable|miss|injur|out|doubt).{0,100}'+escaped+')','i').test(userText))throw new Error('No user supplied unavailable scenario for '+name+'.');}
  const sources:FactualAnswer['sources']=[];
  const add=(title:string,source:string,updated_at:string,data:Record<string,unknown>)=>{const ref=sources.length+1;sources.push({kind:'table',ref_index:ref,title,source,updated_at,data});return ref;};
  const candidates=data.records.filter(r=>selectedNames.includes(r.player_name)).flatMap(r=>{
    const roster=seed.roster_entries.find(p=>p.player_name===r.player_name);
    if(!roster||(scope==='external'&&roster.team_id==='NYG')||(scope==='internal'&&roster.team_id!=='NYG'))return [];
    const dossier=getNflContractDossier(r.player_name);
    const activeYears=dossier?.reported_years.filter(y=>!y.is_void).map(y=>y.year)??[];
    const cap=seed.cap_rows.find(p=>p.player_name===r.player_name&&p.team_id===roster.team_id);
    const table=r.table;
    const col=(name:string)=>table.columns.indexOf(name);
    // Multi-team seasons sum team stints only; a published total takes priority.
    const totals=table.rows.filter(v=>/total|\d+TM|---/i.test(v[col('TEAM')]??''));
    const stints=totals.length?totals:table.rows;
    const total=(name:string)=>!stints.length?null:stints.reduce((sum,row)=>sum+Number(row[col(name)].replaceAll(',','')),0);
    const playerReports=reports.filter(p=>p.player_name===r.player_name);
    const statRef=add(r.player_name+' · official receiving record',stints.length?'Official club career statistics':'Recorded roster identity; receiving production unavailable',r.captured_at,{source_url:r.source_url,rows:[{k:'Scope',v:stints.length?'2025 regular season; team stints summed if no total row':'No like-for-like receiving source captured for this player; blank values are unknown'},{k:'Original table',v:JSON.stringify(r.table)},{k:'Captured page SHA256',v:r.source_sha256}]});
    const capRef=add(r.player_name+' · dated roster and contract snapshot','Public roster / Over the Cap',seed.as_of_date,{source_url:cap?.source_url,rows:[{k:'Roster status code',v:roster.roster_status},{k:'Source note',v:roster.source_note},{k:'Contract end field',v:String(cap?.contract_end_year??'Not recorded')},{k:'Boundary',v:'Snapshot contract-end fields may include void years. Current-team cap is not incoming cost.'}]});
    const dossierRefs=dossier?[add(r.player_name+' · inspected active and void contract years','OverTheCap public contract dossier',dossier.inspected_at,{source_url:dossier.source_url,source_tables:dossier.source_tables,rows:[{k:'Source status',v:dossier.source_status},{k:'Active years',v:activeYears.join(', ')||'None established'},{k:'Void years',v:dossier.reported_years.filter(y=>y.is_void).map(y=>y.year).join(', ')||'None reported'},{k:'Conflicts',v:dossier.conflicts.join(' ')||'None identified'},{k:'Captured page SHA256',v:dossier.source_sha256},{k:'Boundary',v:'The displayed dossier horizon uses active years only. A snapshot contract-end field can include void years.'}]})]:[];
    const reportRefs=playerReports.map(p=>add(r.player_name+' · '+p.author,p.kind,p.date,{source_url:p.source_url,rows:[{k:'Author',v:p.author},{k:'Assessment',v:p.observation},{k:'Scope',v:p.scope}]}));
    return [{r,roster,cap,dossier,activeEnd:activeYears.length?Math.max(...activeYears):cap?.contract_end_year,games:total('G'),rec:total('REC'),yards:total('YDS'),td:total('TD'),reports:playerReports,refs:[statRef,capRef,...dossierRefs,...reportRefs]}];
  });
  candidates.sort((a,b)=>priority==='contract_horizon'?((a.activeEnd??9999)-(b.activeEnd??9999)||(b.yards??-1)-(a.yards??-1)):priority==='inside_role'?(Number(b.reports.some(r=>/between the hashes/i.test(r.observation)))-Number(a.reports.some(r=>/between the hashes/i.test(r.observation)))||(b.yards??-1)-(a.yards??-1)):(b.yards??-1)-(a.yards??-1));
  const money=(v:number|null|undefined)=>v==null?'Not recorded':'$'+v.toLocaleString('en-US');
  const method=RECEIVER_COMPARISON_METHODS[priority as keyof typeof RECEIVER_COMPARISON_METHODS];
  const observed=candidates.slice(0,3).map(p=>p.yards==null?p.r.player_name+': no comparable receiving record is captured.':p.r.player_name+' recorded '+p.rec+' receptions for '+p.yards!.toLocaleString('en-US')+' yards and '+p.td+(p.td===1?' touchdown in ':' touchdowns in ')+p.games+' games.').join(' ');
  return {body:{kind:'data_analysis',language_policy:'facts_only_v1',receiver_query:{...args,priority,candidate_scope:scope},answer:observed,supporting_details:[{label:'Comparison method',body:method,source_refs:sources.map(s=>s.ref_index)}],key_findings:[{label:'Decision basis',body:'Compare production, public evaluations and contract horizon separately. The internal alternative avoids an acquisition transaction; any role allocation remains a football decision.',source_refs:sources.map(s=>s.ref_index)}],tables:[{title:'Receiver contribution and contract context · 2025 production / dated 2026 snapshot',columns:['Player','Team / scope','Recorded status / scenario','2025 games','2025 receptions','2025 receiving yards','2025 receiving TD','Current-team cap','Last active year / basis','Attributed assessment'],rows:candidates.map(p=>[p.r.player_name,p.roster.team_id+(p.roster.team_id==='NYG'?' · internal':' · external'),missing.includes(p.r.player_name)?'Assumed unavailable by user':p.roster.roster_status,p.games,p.rec,p.yards,p.td,p.dossier?.source_status==='source_conflict'?'Source conflict: blocked':money(p.cap?.source_status==='captured'?p.cap.cap_number_2026:null),p.dossier?.source_status==='source_conflict'?'Source conflict':p.activeEnd==null?'Not recorded':String(p.activeEnd)+(p.dossier?' · dossier':' · snapshot; voids unverified'),p.reports.map(r=>(r.kind==='user-supplied evaluation'?'User supplied; attribution unverified — ':'')+r.author+' ('+r.date+'): '+r.observation).join(' | ')||'No comparable assessment captured']),source_refs:sources.map(s=>s.ref_index)}],calculations:[],caveats:['These players are a bounded evidence comparison, not a confirmed available-player list. Availability, acquisition compensation and incoming obligations are not established.','Historical production is not a prediction. Current-team cap and snapshot contract end do not establish transferred guarantees or future Giants cost.'],followups:['Prioritize next-year flexibility in this comparison.','Use players already on our roster instead.','Inspect the contract dossiers for the outside options.']},sources};
}
export const nflReceiverTool:Anthropic.Tool={name:'compare_receivers',description:'Deep receiver comparison using official full-season receiving records, separately attributed public/supplied assessments, dated current-team cap and status. Three outside candidates plus internal options; changes ordering when priorities change. Not confirmed available players or Giants-specific grades. Wider cohorts use search_player_records. Supplied evaluations in the conversation are attached by code, never authored by this tool.',input_schema:{type:'object',properties:{priority:{type:'string',enum:['receiving_production','contract_horizon','inside_role']},candidate_scope:{type:'string',enum:['external','internal','both']},player_names:{type:'array',items:{type:'string'}},assumed_unavailable_names:{type:'array',items:{type:'string'}}},additionalProperties:false}};
