import { createHash } from 'node:crypto';
import type { DataAnalysisBriefBody } from '@shared/types';
import type { FactualAnswer } from '../nfl_facts/answer.js';

export interface EvidenceFact {
  id: string;
  subject: string;
  subject_kind?: 'player';
  metric: string;
  period: string;
  unit: 'USD' | 'percent' | 'number';
  basis: string;
  value?: number;
  statement?: string;
  source_refs: number[];
}
export type SourcedParagraph = NonNullable<DataAnalysisBriefBody['answer_paragraphs']>[number];
type Evidence = FactualAnswer & { id: string; rowRefs?: number[][] };
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const normalize = (v: string) => v.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const words: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const amountPattern = /(?:[-−+]\s*)?\$?\s*\d[\d,]*(?:\.\d+)?\s*(?:billion|million|thousand|[mkb](?![a-z]))?\s*%?/gi;

export function numericMentions(text: string): Array<{ raw: string; value: number; unit: EvidenceFact['unit']; index: number; precision: number; after: string; comparison?: 'gt'|'gte'|'lt'|'lte' }> {
  const dateSpans=[...text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?[ -]+\d{1,2}(?:[–-]\d{1,2})?(?:,?\s+20\d{2})?/gi)].map(m=>[m.index!,m.index!+m[0].length]);
  for(const match of text.matchAll(/(?<![$\d])\b20\d{2}[–-](?:20)?\d{2}\b|\b(?:No\.\s*|WR|QB|TE|RB|OT|IOL|EDGE)[1-9]\b/gi))dateSpans.push([match.index!,match.index!+match[0].length]);
  for(const match of text.matchAll(/\bon\s+\d{1,2}\/\d{1,2}(?:\s*(?:and|,)\s*\d{1,2}\/\d{1,2})*/gi))dateSpans.push([match.index!,match.index!+match[0].length]);
  for(const match of text.matchAll(/\b(?:on\s+)?the\s+(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)(?:\s*(?:and|,)\s*(?:the\s+)?(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th))*/gi))dateSpans.push([match.index!,match.index!+match[0].length]);
  const spelled=/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?\s+(billion|million|thousand|dollars|percent|yards|receptions|games|snaps|years)\b/gi;
  const mentions=[...text.matchAll(amountPattern),...text.matchAll(spelled)].flatMap(match=>{
    const raw=match[0].trim();
    const index=match.index!+match[0].indexOf(raw);
    if(dateSpans.some(([from,to])=>index>=from&&index<to))return [];
    const digitText=raw.match(/\d[\d,]*(?:\.\d+)?/)?.[0];
    const digits=digitText??String(words[match[1]?.toLowerCase()] + (match[2]?words[match[2].toLowerCase()]:0));
    const scale=/billion|b\b/i.test(raw)?1e9:/million|m\b/i.test(raw)?1e6:/thousand|k\b/i.test(raw)?1e3:1;
    const value=Number(digits.replaceAll(',',''))*scale*(/^[-−]/.test(raw)&&!/[a-z0-9]$/i.test(text.slice(0,index))?-1:1);
    if(!Number.isFinite(value))return [];
    const following=text.slice(match.index!+match[0].length);
    const unit:EvidenceFact['unit']=/\$|dollars/i.test(raw)||/^\s*dollars\b/i.test(following)?'USD':/%|percent/i.test(raw)||/^\s*percent\b/i.test(following)?'percent':'number';
    const prefix=text.slice(0,index);
    const comparison=/^[-–]?plus\b|^\+/.test(following)?'gte' as const:/\b(?:cleared|exceeded|above|more than|over)\s*$/i.test(prefix)?'gt' as const:/\bat least\s*$/i.test(prefix)?'gte' as const:/\b(?:under|below|less than)\s*$/i.test(prefix)?'lt' as const:/\bat most\s*$/i.test(prefix)?'lte' as const:undefined;
    return [{raw,value,unit,index,comparison,after:following.split(/\d/)[0].slice(0,35),precision:scale/10**(digits.split('.')[1]?.length??0)}];
  }).sort((a,b)=>a.index-b.index);
  return mentions.map((mention,i)=>{
    const next=mentions[i+1];
    const between=next?text.slice(mention.index+mention.raw.length,next.index+Number(/^[-−]/.test(next.raw))).trim():'';
    // A range's endpoints share the unit following its second endpoint.
    const after=next&&/^(?:[–-]|to)$/.test(between)?text.slice(next.index+next.raw.length,mentions[i+2]?.index):text.slice(mention.index+mention.raw.length,next?.index);
    return {...mention,after:after.slice(0,35)};
  });
}

function scalar(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || /unknown|not recorded|conflict|unavailable/i.test(value)) return undefined;
  const clean = value.trim();
  const quantities=numericMentions(clean);
  if(quantities.length===1&&quantities[0].unit==='USD')return quantities[0].value;
  if (!/^[-−+]?\$?[\d,]+(?:\.\d+)?\s*%?(?:\s*·\s*(?:dossier|snapshot).*)?$/.test(clean)) return undefined;
  return numericMentions(clean)[0]?.value;
}

/** IDs bind the labelled record and its source, not a bare reusable number. */
export function collectEvidenceFacts(evidence: Iterable<Evidence>): EvidenceFact[] {
  const facts = new Map<string, EvidenceFact>();
  for (const item of evidence) {
    const add = (fact: Omit<EvidenceFact, 'id'>) => {
      const sourceIdentity = fact.source_refs.map(ref => {
        const source = item.sources.find(s => s.ref_index === ref);
        return source ? [source.title, source.updated_at, source.data?.source_url] : ref;
      });
      const id = 'fact_' + digest({ ...fact, source_refs: sourceIdentity });
      const prior = facts.get(id);
      facts.set(id, { ...fact, id, source_refs: [...new Set([...(prior?.source_refs ?? []), ...fact.source_refs])] });
    };
    for (const [ti, table] of item.body.tables.entries()) {
      const subjectColumns = table.columns.map((c, i) => /^(player|name|team|option|alternative|scenario|move|year|season|period|position|status|metric|measure|basis)$/i.test(c) ? i : -1).filter(i => i >= 0);
      const measureColumn=table.columns.findIndex(c=>/^(measure|metric)$/i.test(c));
      const yearColumn = table.columns.findIndex(c => /^(year|season|period)$/i.test(c));
      for (const [ri, row] of table.rows.entries()) {
        const playerColumn=table.columns.findIndex(c=>/^(player|name)$/i.test(c));
        const subject = playerColumn>=0?String(row[playerColumn]):(subjectColumns.length ? subjectColumns.map(i => String(row[i])).join(' · ') : String(row[0] ?? table.title));
        for (const [ci, cell] of row.entries()) {
          const value = scalar(cell);
          if (value == null) {
            if(typeof cell==='string')for(const quantity of numericMentions(cell))add({subject,...(playerColumn>=0?{subject_kind:'player' as const}:{}),metric:table.columns[ci]+': '+cell,period:table.columns[ci].match(/20\d{2}/)?.[0]??'',unit:quantity.unit,basis:table.title,value:quantity.value,source_refs:table.source_refs});
            continue;
          }
          const metric = measureColumn>=0&&ci!==measureColumn?String(row[measureColumn])+' · '+table.columns[ci]:table.columns[ci];
          const period = yearColumn >= 0 ? String(row[yearColumn]) : metric.match(/20\d{2}(?:[–-]20\d{2})?/)?.[0] ?? (/cap|cash|salary|bonus|guarantee|budget|cost/i.test(metric)?table.title.match(/dated (20\d{2})/)?.[1]:undefined) ?? table.title.match(/20\d{2}/)?.[0] ?? '';
          const unit = /\$/.test(String(cell)) || /cap|cash|salary|bonus|guarantee|dead money|savings|reserve|funding|budget|cost/i.test(metric) && !/years|status|source|basis|method|rank|fit/i.test(metric) ? 'USD' : /%/.test(String(cell)) || /percent|rate|share/i.test(metric) ? 'percent' : 'number';
          add({ subject,...(playerColumn>=0?{subject_kind:'player' as const}:{}), metric, period, unit, basis: table.title, value, source_refs: ti === 0 && item.rowRefs?.[ri] ? item.rowRefs[ri] : table.source_refs });
        }
      }
    }
    const market=item.body.market_analysis;
    if(market)for(const [metric,value] of Object.entries(market.coverage))if(typeof value==='number')add({subject:'Executed historical cohort',metric,period:market.query.start_year+'–'+market.query.end_year,unit:'number',basis:'Executed historical coverage',value,source_refs:item.sources.map(s=>s.ref_index)});
    const evaluation=item.body.evaluation_query as {rules?:Array<{criterion:string;weight?:number}>}|undefined;
    for(const rule of evaluation?.rules??[])if(rule.weight!=null){
      add({subject:rule.criterion,metric:'User supplied weight fraction',period:'',unit:'number',basis:'Executed user evaluation',value:rule.weight,source_refs:item.sources.map(s=>s.ref_index)});
      add({subject:rule.criterion,metric:'User supplied weight percent',period:'',unit:'percent',basis:'Executed user evaluation',value:100*rule.weight,source_refs:item.sources.map(s=>s.ref_index)});
    }
    const contract=item.body.contract_scenario?.args as {season?:number;moves?:Array<{player_id:string;unpaid_salary_available?:number}>}|undefined;
    for(const move of contract?.moves??[])if(move.unpaid_salary_available!=null)add({subject:move.player_id,subject_kind:'player',metric:'Validated unpaid salary available',period:String(contract?.season??''),unit:'USD',basis:'Executed contract input',value:move.unpaid_salary_available,source_refs:item.sources.map(s=>s.ref_index)});
    for(const calculation of item.body.calculations){
      const value=scalar(calculation.value);if(value==null){
        for(const quantity of numericMentions(String(calculation.value)))add({subject:calculation.label,metric:calculation.label,period:calculation.label.match(/20\d{2}/)?.[0]??'',unit:quantity.unit,basis:'Executed calculation: '+calculation.formula,value:quantity.value,source_refs:calculation.source_refs});
        continue;
      }
      add({subject:calculation.label,metric:calculation.label,period:calculation.label.match(/20\d{2}/)?.[0]??'',unit:/\$/.test(String(calculation.value))?'USD':/%/.test(String(calculation.value))?'percent':'number',basis:'Executed calculation: '+calculation.formula,value,source_refs:calculation.source_refs});
    }
    const modeledYears=[...new Set(item.body.tables.flatMap(t=>{const i=t.columns.findIndex(c=>/^(year|season)$/i.test(c));return i<0?[]:t.rows.map(r=>String(r[i])).filter(y=>/^20\d{2}$/.test(y));}))];
    if(modeledYears.length)add({subject:'Executed scenario',metric:'Displayed years',period:'',unit:'number',basis:'Executed year coverage',value:modeledYears.length,source_refs:item.sources.map(s=>s.ref_index)});
    if(item.body.population){
      for(const [metric,value] of Object.entries(item.body.population).filter(([,v])=>typeof v==='number'))add({subject:'Recorded population',metric,period:'',unit:'number',basis:'Executed population metadata',value:value as number,source_refs:item.sources.map(s=>s.ref_index)});
    }
    for(const filter of item.body.factual_query?.numeric_filters??[])add({subject:'User screen',metric:filter.field+' '+filter.operator,period:filter.field.match(/20\d{2}/)?.[0]??'',unit:filter.field==='cap_2026'?'USD':'number',basis:'Executed explicit current-team screen',value:filter.value,source_refs:item.sources.map(s=>s.ref_index)});
    // Rule statements and calculated summaries are code-owned evidence too.
    for (const statement of [{ body: item.body.answer, source_refs: item.sources.map(s => s.ref_index) }, ...item.body.key_findings, ...item.body.calculations.map(c => ({body: `${c.label}: ${c.formula} = ${c.value}`, source_refs:c.source_refs}))]) {
      if (!statement.body || !numericMentions(statement.body).length) continue;
      add({ subject: '', metric: 'Reviewed statement', period: '', unit: 'number', basis: item.id, statement: statement.body, source_refs: statement.source_refs });
    }
  }
  return [...facts.values()];
}

function matches(mention: ReturnType<typeof numericMentions>[number], fact: EvidenceFact): boolean {
  if (fact.value == null) return false;
  if (mention.unit !== 'number' && fact.unit !== mention.unit) return false;
  if(fact.metric.startsWith('Flip condition:')&&mention.value===fact.value)return true;
  if(mention.comparison)return mention.comparison==='gt'?fact.value>mention.value:mention.comparison==='gte'?fact.value>=mention.value:mention.comparison==='lt'?fact.value<mention.value:fact.value<=mention.value;
  if (mention.value === fact.value) return true;
  // Rounding is at the explicitly written precision, not an arbitrary tolerance.
  return mention.precision !== 1 && Math.sign(mention.value) === Math.sign(fact.value)
    && Math.abs(Math.round(fact.value / mention.precision) * mention.precision - mention.value) < 1e-6;
}

function metricCompatible(mention: ReturnType<typeof numericMentions>[number], fact: EvidenceFact): boolean {
  const spelledUnit=mention.raw.match(/\b(yards|receptions|games|snaps)\s*$/i)?.[1];
  const direct=spelledUnit??mention.after.trimStart().match(/^(?:[-–]\s*)?(?:(?:receiving|offensive|defensive)\s+)?(yards?|receptions?|catches|touchdowns?|TD|snaps?|games?|starts?)\b/i)?.[1];
  if(!direct)return true;
  const metric=fact.metric.toLowerCase();
  const unit=direct.toLowerCase();
  const pattern=/reception|catches/.test(unit)?/reception|\brec\b/:/touchdown|^td$/.test(unit)?/touchdown|\btd\b/:unit.startsWith('yard')?/yards?/:unit.startsWith('snap')?/snaps?/:unit.startsWith('game')?/games?/:/starts?/;
  return pattern.test(metric);
}

/** Preserve prose verbatim. Invalid claims become actionable repair errors. */
export function validateSourcedParagraphs(paragraphs: SourcedParagraph[], facts: EvidenceFact[], validRefs: Set<number>): SourcedParagraph[] {
  const byId = new Map(facts.map(f => [f.id, f]));
  const issues:string[]=[];
  const validated=paragraphs.map(paragraph => {
    if (paragraph.source_refs.some(ref => !validRefs.has(ref))) issues.push('Unknown paragraph source reference.');
    const explicit = (paragraph.fact_ids ?? []).map(id => {
      const fact = byId.get(id); if (!fact) issues.push(`Unknown numerical fact ${id}.`); return fact;
    }).filter((f):f is EvidenceFact=>!!f);
    const eligible = facts.filter(f => explicit.some(e=>e.id===f.id) || f.source_refs.some(ref => paragraph.source_refs.includes(ref)));
    const used = new Set(explicit.map(f => f.id));
    for (const sentence of paragraph.text.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      for (const mention of numericMentions(sentence)) {
        // Calendar labels are context. Any quantified fact in this sentence must
        // still match that period below; contract-horizon assertions also receive semantic review.
        if (mention.unit==='number' && /^20\d{2},?$/.test(mention.raw) && (/(?:\bin|\bduring|\bfor)\s*$/.test(sentence.slice(0,mention.index)) || /^\s*(?:and beyond|flexibility|production|season|regular[- ]season|snapshot|cap(?:[ /]|$)|budget|[–-]|EDGE|seller|second|third|fourth|fifth|sixth|seventh)/i.test(mention.after))) continue;
        if(mention.unit==='number'&&/^20\d{2}$/.test(mention.raw)&&/20\d{2}[–-]\s*$/.test(sentence.slice(0,mention.index)))continue;
        if(mention.unit==='number'&&/\(\s*$/.test(sentence.slice(0,mention.index))&&/^\)\s/.test(sentence.slice(mention.index+mention.raw.length)))continue;
        if(mention.unit==='number'&&/round(?:[- ]\d[- ]to)?$/i.test(sentence.slice(0,mention.index))&&Math.abs(mention.value)>=1&&Math.abs(mention.value)<=7)continue;
        // Down names, draft-round labels and a numbered list are nomenclature;
        // their football meaning is checked with the semantic evidence review.
        if (/^\s*Day\s*$/i.test(sentence.slice(0,mention.index))&&mention.value>=1&&mention.value<=3) continue;
        if (/^(?:[1-4](?:st|nd|rd|th)?[- ]down|[1-7](?:st|nd|rd|th)?[- ]round)/i.test(sentence.slice(mention.index).trim()) || /^\s*\d+[.)]\s/.test(sentence) && mention.index < 3) continue;
        const subjectNames=[...new Set(facts.filter(f=>f.subject_kind==='player').map(f=>f.subject.split(' · ')[0]).filter(name=>normalize(name).split(' ').length>=2))];
        const occurrences=subjectNames.flatMap(name=>{const full=normalize(name);const alias=full.split(' ').at(-1)!;const variants=subjectNames.filter(n=>normalize(n).split(' ').at(-1)===alias).length===1?[full,alias]:[full];return variants.flatMap(v=>[...sentence.toLowerCase().matchAll(new RegExp('\\b'+v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','g'))].map(m=>({subject:full,index:m.index!})));});
        const prefix=sentence.slice(0,mention.index);
        const clause=prefix.split(/;|—|,(?!\d)|\b(?:while|versus|but|then|ahead of)\b/i).at(-1)??prefix;
        const clauseStart=prefix.length-clause.length;
        const actors=occurrences.filter(o=>o.index>=clauseStart&&o.index<mention.index);
        const nearest=actors.sort((a,b)=>b.index-a.index)[0];
        const nextAmount=numericMentions(sentence).find(m=>m.index>mention.index)?.index??sentence.length;
        const namedAfter=occurrences.find(o=>o.index>mention.index&&o.index<nextAmount&&/^\s*(?:(?:receiving )?yards?|receptions?|catches|games?|snaps?|starts?)?\s*(?:for|by)\s*$/i.test(sentence.slice(mention.index+mention.raw.length,o.index)));
        const allAmounts=numericMentions(sentence).filter(m=>!/^20\d{2}$/.test(m.raw));
        const orderedSubjects=[...new Set(occurrences.filter(o=>o.index<(allAmounts[0]?.index??0)).sort((a,b)=>a.index-b.index).map(o=>o.subject))];
        const ordinal=/\brespectively\b/i.test(sentence)&&orderedSubjects.length===allAmounts.length?orderedSubjects[allAmounts.findIndex(m=>m.index===mention.index)]:undefined;
        const mentionedSubjects=mention.comparison&&/\beach\b/i.test(prefix)?[...new Set(occurrences.filter(o=>o.index<mention.index).map(o=>o.subject))]:namedAfter?[namedAfter.subject]:ordinal?[ordinal]:nearest?[nearest.subject]:[];
        const matchFact = (f:EvidenceFact) => {
          if (f.statement) return normalize(f.statement).includes(normalize(sentence)) || normalize(sentence).includes(normalize(f.statement));
          // Period labels are part of the bound record even when not a value cell.
          if (/^20\d{2}$/.test(mention.raw) && f.period.includes(mention.raw)) return true;
          const before=sentence.slice(0,mention.index).split(/[.,;]/).at(-1)??'';
          const after=sentence.slice(mention.index+mention.raw.length);
          const priorPeriod=before.match(/\b(20\d{2})\s+([^\d.,;$]{0,45})$/);
          const beforeYear=priorPeriod&&/receiv|yards|reception|salary|base|cap|cash|games|snaps|starts|budget|bonus|production/.test(priorPeriod[2])?priorPeriod[1]:undefined;
          const afterYear=after.match(/^\s*(?:(?:receiving )?yards|receptions|catches|games|snaps|salary|base(?: salary)?|cash|cap charge)?\s*(?:in|during|for)\s+(20\d{2})\b/)?.[1];
          const years=[afterYear??beforeYear].filter((y):y is string=>!!y);
          if(years.length&&f.period&&!years.some(year=>f.period.includes(year)))return false;
          if(/incoming|acquir(?:ing|er)|Giants(?:'|’) cost/i.test(sentence)&&/current.team|original.team/i.test(f.metric+' '+f.basis)&&!/\bnot\b|does not|isn't|isn’t/i.test(sentence))return false;
          if (mentionedSubjects.length && f.subject_kind==='player' && !/^Executed /.test(f.basis) && !mentionedSubjects.includes(normalize(f.subject.split(' · ')[0]))) return false;
          return matches(mention, f) && metricCompatible(mention, f);
        };
        let matched=eligible.filter(matchFact);
        // Attach an omitted citation only when retrieved evidence uniquely binds the claim.
        if(!matched.length&&!explicit.length){
          const other=facts.filter(f=>f.value!=null&&matchFact(f));
          const bindings=new Set(other.map(f=>JSON.stringify([f.subject,f.metric,f.period,f.unit,f.value])));
          if(bindings.size===1)matched=other;
        }
        if(mention.comparison&&/\beach\b/i.test(prefix)){
          const named=[...new Set(occurrences.filter(o=>o.index<mention.index).map(o=>o.subject))];
          if(named.some(subject=>!matched.some(f=>normalize(f.subject)===subject)))matched=[];
        }
        if (!matched.length) issues.push(`Unsupported quantity "${mention.raw}" in "${sentence}". Bind the right subject, metric, period and unit to a retrieved fact or copy its reviewed statement; do not invent arithmetic.`);
        matched.forEach(f => used.add(f.id));
      }
    }
    return { text: paragraph.text, source_refs: [...new Set([...paragraph.source_refs, ...[...used].flatMap(id => byId.get(id)!.source_refs)])], fact_ids: [...used] };
  });
  if(issues.length)throw new Error([...new Set(issues)].join(' | '));
  return validated;
}

export function evidenceFingerprint(facts: EvidenceFact[]): string {
  return createHash('sha256').update(JSON.stringify(facts.map(f => f.id).sort())).digest('hex');
}
