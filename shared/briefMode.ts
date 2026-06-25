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
  if (ACTION_PATTERNS.some((re) => re.test(q))) return 'brief';
  return ANALYTIC_PATTERNS.some((re) => re.test(q)) ? 'data_analyst' : 'brief';
}
