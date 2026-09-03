import type { BriefSource, DataAnalysisBriefBody } from '@shared/types';
import { loadNflRulesCorpus, type NflRuleRow } from './seed.js';

export interface PreparedNflRuleAnswer {
  body: DataAnalysisBriefBody;
  sources: Array<Omit<BriefSource, 'id' | 'brief_id'>>;
}

export async function buildNflRuleAnswer(question: string): Promise<PreparedNflRuleAnswer> {
  const corpus = await loadNflRulesCorpus();
  const matches = corpus.rules
    .map((rule) => ({ rule, score: scoreRule(rule, question) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.rule.title.localeCompare(right.rule.title))
    .slice(0, 3);

  if (matches.length === 0 || matches[0].score < 4) {
    return {
      body: {
        kind: 'data_analysis',
        answer: 'The loaded public rulebook does not have a strong match for that question.',
        key_findings: [],
        tables: [],
        calculations: [],
        caveats: ['No rule claim is being made. Try naming the transaction, roster designation, or contract mechanism you want explained.'],
        followups: [],
      },
      sources: [],
    };
  }

  const primary = matches[0].rule;
  const answer = primary.rule_family === 'post_june_1_accounting'
    ? 'For a trade completed after June 1, the original club generally carries the current-year bonus charge and moves acceleration tied to future years into the following league year. An advance post-June 1 designation is a release mechanism, not a way to designate a trade early. The exact cap result still depends on the player’s bonus schedule, guarantees, and the actual trade date.'
    : `${primary.summary} ${plainBoundary(primary)}`;

  const selected = [primary];
  const sources = selected.map((rule, index): Omit<BriefSource, 'id' | 'brief_id'> => ({
    ref_index: index + 1,
    kind: 'CBA',
    source: rule.source_document,
    title: rule.title,
    updated_at: rule.effective_date,
    data: {
      source_url: rule.source_url,
      authority_label: 'Executed NFL-NFLPA collective bargaining agreement',
      contribution: `${rule.source_locator} supports the rule stated in this answer.`,
      rows: [
        { k: 'Rule', v: rule.title },
        { k: 'Authority', v: rule.source_document },
        { k: 'Exact location', v: rule.source_locator },
        { k: 'Effective date', v: rule.effective_date },
        { k: 'What it says', v: rule.summary },
        { k: 'What still needs checking', v: plainBoundary(rule) },
      ],
      rule_family: rule.rule_family,
    },
  }));

  return {
    body: {
      kind: 'data_analysis',
      answer,
      key_findings: [{
        label: 'Controlling rule',
        body: `${primary.source_document}, ${primary.source_locator}.`,
        source_refs: [1],
      }],
      tables: [],
      calculations: [],
      caveats: [plainBoundary(primary)],
      followups: [],
    },
    sources,
  };
}

function scoreRule(rule: NflRuleRow, question: string): number {
  const text = question.toLowerCase();
  let score = 0;
  const terms = [
    ...rule.rule_family.split('_'),
    ...rule.title.toLowerCase().split(/\W+/),
  ].filter((term) => term.length > 3);
  for (const term of new Set(terms)) if (text.includes(term)) score += 1;
  if (/post[- ]?june|dead money|release|cut/.test(text) && rule.rule_family === 'post_june_1_accounting') score += 10;
  if (/trade|assignment/.test(text) && rule.rule_family === 'trades') score += 5;
  if (/restructure|convert|bonus/.test(text) && rule.rule_family === 'restructure_conversion') score += 8;
  if (/franchise|transition|tag|tender/.test(text) && rule.rule_family === 'franchise_transition_tag') score += 8;
  if (/rookie|fifth[- ]year|option/.test(text) && rule.rule_family === 'rookie_contract_options') score += 8;
  if (/practice squad/.test(text) && rule.rule_family === 'practice_squad_roster_management') score += 8;
  if (/waiver/.test(text) && rule.rule_family === 'waivers') score += 8;
  if (/\b(?:pup|nfi|injur(?:y|ed)|reserve list)\b/.test(text) && rule.rule_family === 'injury_lists') score += 8;
  if (/\b(?:extensions?|extend|extended)\b/.test(text) && rule.rule_family === 'extensions') score += 8;
  if (/\bcompensatory\s+pick|\bcomp\s+pick|compensation formula/.test(text) && rule.rule_family === 'compensatory_picks') score += 8;
  if (/cap|team salary|accounting/.test(text) && rule.rule_family === 'salary_cap_accounting') score += 4;
  return score;
}

function plainBoundary(rule: NflRuleRow): string {
  switch (rule.rule_family) {
    case 'restructure_conversion':
      return 'The CBA rule does not show whether a specific player can be restructured or how much room that contract could create.';
    case 'post_june_1_accounting':
      return 'Before acting, confirm the player’s bonus schedule, guarantees, transaction date, and whether the proposed designation is available.';
    case 'franchise_transition_tag':
      return 'Confirm the current league-year tender amount and the player’s eligibility before using this rule in a decision.';
    case 'rookie_contract_options':
      return 'Confirm the player’s draft round, accrued contract year, option tier, and current deadline before acting.';
    case 'practice_squad_roster_management':
      return 'Confirm the current league memo, player eligibility, prior elevations, and active-roster limits before acting.';
    case 'injury_lists':
      return 'A public roster label does not establish a medical prognosis, return date, or guaranteed-salary treatment.';
    case 'waivers':
      return 'Confirm credited seasons, transaction timing, and the live waiver order before acting.';
    case 'compensatory_picks':
      return 'This section does not establish the free-agent compensatory formula, so no compensatory-pick projection is being made.';
    case 'trades':
      return 'Before acting, confirm league approval, the acquiring club’s obligations, contract guarantees, and the current trade deadline.';
    case 'salary_cap_accounting':
      return 'This public material is not a club cap certification; exact room and league adjustments still require current club and league records.';
    case 'extensions':
      return 'Without sourced proposed terms, no exact extension savings are being claimed.';
    default:
      return rule.analysis_boundary;
  }
}
