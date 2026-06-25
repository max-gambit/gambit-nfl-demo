import type { BriefMode } from './types';

const DATA_PREFIX_RE = /^\/data(?:\s+|$)/i;

const ANALYTIC_PATTERNS = [
  /\bwhat does the data\b/i,
  /\bdata says?\b/i,
  /\bwhich players?\b/i,
  /\brank\b/i,
  /\bhighest\b/i,
  /\blowest\b/i,
  /\bweakest\b/i,
  /\busage\b/i,
  /\bnet rating\b/i,
  /\btrue shooting\b/i,
  /\btable\b/i,
  /\bcompare\b/i,
];

const NFL_DATA_ACTION_PATTERNS = [
  /\b(restructure|restructure candidate|convert salary|signing bonus)\b/i,
  /\b(cut|release|post[-\s]?june 1|dead money|cut savings)\b/i,
  /\b(franchise tag|transition tag|tag eligible|tender)\b/i,
  /\b(cap room|cap space|cap sheet|contract lever|guarantees?)\b/i,
];

const ACTION_PATTERNS = [
  /\bshould\b/i,
  /\brecommend\b/i,
  /\bpursue\b/i,
  /\bsign\b/i,
  /\btrade for\b/i,
  /\bextend\b/i,
  /\bcall\b/i,
];

export function stripBriefModePrefix(question: string): { mode: BriefMode | null; question: string } {
  const trimmed = question.trim();
  if (!DATA_PREFIX_RE.test(trimmed)) return { mode: null, question: trimmed };
  return {
    mode: 'data_analyst',
    question: trimmed.replace(DATA_PREFIX_RE, '').trim(),
  };
}

export function inferBriefModeFromQuestion(question: string): BriefMode {
  const parsed = stripBriefModePrefix(question);
  if (parsed.mode) return parsed.mode;
  const q = parsed.question.trim();
  if (!q) return 'brief';
  if (NFL_DATA_ACTION_PATTERNS.some((re) => re.test(q))) return 'data_analyst';
  if (ACTION_PATTERNS.some((re) => re.test(q))) return 'brief';
  return ANALYTIC_PATTERNS.some((re) => re.test(q)) ? 'data_analyst' : 'brief';
}
