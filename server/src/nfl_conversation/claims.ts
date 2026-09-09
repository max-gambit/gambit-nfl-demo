import { createHash } from 'node:crypto';
import type { DataAnalysisBriefBody } from '@shared/types';
import type { FactualAnswer } from '../nfl_facts/answer.js';

export interface EvidenceFact {
  id: string;
  subject: string;
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

export function numericMentions(text: string): Array<{ raw: string; value: number; unit: EvidenceFact['unit']; index: number; precision: number; after: string }> {
  const expanded = text.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](one|two|three|four|five|six|seven|eight|nine))?\s+(billion|million|thousand|dollars|percent|yards|receptions|games|snaps|years)\b/gi,
    (_all, first: string, second: string | undefined, unit: string) => `${words[first.toLowerCase()] + (second ? words[second.toLowerCase()] : 0)} ${unit}`);
  return [...expanded.matchAll(amountPattern)].flatMap(match => {
    const raw = match[0].trim();
    const digits = raw.match(/\d[\d,]*(?:\.\d+)?/)?.[0];
    if (!digits) return [];
    const scale = /billion|b\b/i.test(raw) ? 1e9 : /million|m\b/i.test(raw) ? 1e6 : /thousand|k\b/i.test(raw) ? 1e3 : 1;
    const value = Number(digits.replaceAll(',', '')) * scale * (/^[-−]/.test(raw) ? -1 : 1);
    const tail = expanded.slice(match.index! + match[0].length, match.index! + match[0].length + 16);
    const unit = /\$/.test(raw) || /^\s*dollars\b/i.test(tail) ? 'USD' : /%/.test(raw) || /^\s*percent\b/i.test(tail) ? 'percent' : 'number';
    return [{ raw, value, unit: unit as EvidenceFact['unit'], index: match.index!, after:expanded.slice(match.index!+match[0].length).split(/\d/)[0].slice(0,35), precision: scale / 10 ** (digits.split('.')[1]?.length ?? 0) }];
  });
}

function scalar(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || /unknown|not recorded|conflict|unavailable/i.test(value)) return undefined;
  const clean = value.trim();
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
      const yearColumn = table.columns.findIndex(c => /^(year|season|period)$/i.test(c));
      for (const [ri, row] of table.rows.entries()) {
        const subject = (subjectColumns.length ? subjectColumns.map(i => String(row[i])).join(' · ') : String(row[0] ?? table.title));
        for (const [ci, cell] of row.entries()) {
          const value = scalar(cell);
          if (value == null) continue;
          const metric = table.columns[ci];
          const period = yearColumn >= 0 ? String(row[yearColumn]) : metric.match(/20\d{2}/)?.[0] ?? table.title.match(/20\d{2}/)?.[0] ?? '';
          const unit = /\$/.test(String(cell)) || /cap|cash|salary|bonus|guarantee|dead money|savings|reserve|funding|budget|cost/i.test(metric) && !/years|status|source|basis|method|rank|fit/i.test(metric) ? 'USD' : /%|percent|rate|share/i.test(metric) ? 'percent' : 'number';
          add({ subject, metric, period, unit, basis: table.title, value, source_refs: ti === 0 && item.rowRefs?.[ri] ? item.rowRefs[ri] : table.source_refs });
        }
      }
    }
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
  if (mention.value === fact.value) return true;
  // Rounding is at the explicitly written precision, not an arbitrary tolerance.
  return mention.precision > 1 && Math.sign(mention.value) === Math.sign(fact.value)
    && Math.abs(Math.round(fact.value / mention.precision) * mention.precision - mention.value) < 1e-6;
}

function metricCompatible(mention: ReturnType<typeof numericMentions>[number], fact: EvidenceFact): boolean {
  const nearby = mention.after.toLowerCase();
  const metric = fact.metric.toLowerCase();
  const domains = [['receiving yards','yards'],['receptions','reception'],['touchdowns','touchdown'],['offensive snaps','offensive snap'],['snaps','snap'],['games','game']];
  for (const [plural, singular] of domains) {
    if (new RegExp(`\\b${plural}|\\b${singular}s?\\b`).test(nearby) && !new RegExp(plural === 'touchdowns' ? 'touchdown|\\btd\\b' : singular === 'reception' ? 'reception|\\brec\\b' : singular).test(metric)) return false;
  }
  return true;
}

/** Preserve prose verbatim. Invalid claims become actionable repair errors. */
export function validateSourcedParagraphs(paragraphs: SourcedParagraph[], facts: EvidenceFact[], validRefs: Set<number>): SourcedParagraph[] {
  const byId = new Map(facts.map(f => [f.id, f]));
  return paragraphs.map(paragraph => {
    if (paragraph.source_refs.some(ref => !validRefs.has(ref))) throw new Error('Unknown paragraph source reference.');
    const explicit = (paragraph.fact_ids ?? []).map(id => {
      const fact = byId.get(id); if (!fact) throw new Error(`Unknown numerical fact ${id}.`); return fact;
    });
    const eligible = facts.filter(f => explicit.some(e=>e.id===f.id) || f.source_refs.some(ref => paragraph.source_refs.includes(ref)));
    const used = new Set(explicit.map(f => f.id));
    for (const sentence of paragraph.text.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      for (const mention of numericMentions(sentence)) {
        // Down names, draft-round labels and a numbered list are nomenclature;
        // their football meaning is checked with the semantic evidence review.
        if (/^(?:[1-4](?:st|nd|rd|th)?[- ]down|[1-7](?:st|nd|rd|th)?[- ]round)/i.test(sentence.slice(mention.index).trim()) || /^\s*\d+[.)]\s/.test(sentence) && mention.index < 3) continue;
        const mentionedSubjects = facts.filter(f => f.subject && normalize(f.subject.split(' · ')[0]).split(' ').length >= 2 && normalize(sentence).includes(normalize(f.subject.split(' · ')[0]))).map(f => normalize(f.subject.split(' · ')[0]));
        const matched = eligible.filter(f => {
          if (f.statement) return normalize(f.statement).includes(normalize(sentence)) || normalize(sentence).includes(normalize(f.statement));
          // Period labels are part of the bound record even when not a value cell.
          if (/^20\d{2}$/.test(mention.raw) && f.period.includes(mention.raw)) return true;
          const years=sentence.match(/\b20\d{2}\b/g)??[];
          if(years.length&&f.period&&!years.some(year=>f.period.includes(year)))return false;
          if(/incoming|acquir(?:ing|er)|Giants(?:'|’) cost/i.test(sentence)&&/current.team|original.team/i.test(f.metric+' '+f.basis)&&!/\bnot\b|does not|isn't|isn’t/i.test(sentence))return false;
          if (mentionedSubjects.length && f.subject && !mentionedSubjects.includes(normalize(f.subject.split(' · ')[0]))) return false;
          return matches(mention, f) && metricCompatible(mention, f);
        });
        if (!matched.length) throw new Error(`Unsupported quantity "${mention.raw}" in "${sentence}". Bind the right subject, metric, period and unit to a retrieved fact or copy its reviewed statement; do not invent arithmetic.`);
        matched.forEach(f => used.add(f.id));
      }
    }
    return { text: paragraph.text, source_refs: [...new Set([...paragraph.source_refs, ...[...used].flatMap(id => byId.get(id)!.source_refs)])], fact_ids: [...used] };
  });
}

export function evidenceFingerprint(facts: EvidenceFact[]): string {
  return createHash('sha256').update(JSON.stringify(facts.map(f => f.id).sort())).digest('hex');
}
