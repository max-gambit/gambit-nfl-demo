import type {
  Brief,
  BriefMode,
  BriefTemplateDefinition,
  BriefTemplateId,
  BriefTemplateSelection,
} from './types';

export const MAX_CUSTOM_TEMPLATE_INSTRUCTIONS = 2000;
export const MAX_SAVED_TEMPLATE_NAME = 60;

export const BRIEF_TEMPLATE_DEFINITIONS: BriefTemplateDefinition[] = [
  {
    id: 'decision_brief',
    label: 'Decision brief',
    short_label: 'Brief',
    description: 'Working thesis, concise reasoning, watch points, and options.',
    renderer: 'recommendation',
  },
  {
    id: 'comparison_matrix',
    label: 'Comparison matrix',
    short_label: 'Compare',
    description: 'Side-by-side evaluation of candidate paths and tradeoffs.',
    renderer: 'recommendation',
  },
  {
    id: 'options_table',
    label: 'Options table',
    short_label: 'Options',
    description: 'Table-first list of viable paths, blockers, and next steps.',
    renderer: 'recommendation',
  },
  {
    id: 'evidence_report',
    label: 'Evidence report',
    short_label: 'Evidence',
    description: 'Known facts, inference, gaps, caveats, and decision implication.',
    renderer: 'recommendation',
  },
  {
    id: 'staff_packet',
    label: 'Staff packet',
    short_label: 'Staff',
    description: 'Forwardable questions and tasks by front-office audience.',
    renderer: 'recommendation',
  },
  {
    id: 'data_table',
    label: 'Data table',
    short_label: 'Data',
    description: 'Tables, calculations, caveats, and source freshness.',
    renderer: 'data_analysis',
  },
  {
    id: 'custom',
    label: 'Custom',
    short_label: 'Custom',
    description: 'User-described format constrained by Gambit evidence rules.',
    renderer: 'recommendation',
  },
];

export const CUSTOM_BASE_TEMPLATE_IDS: BriefTemplateId[] = [
  'decision_brief',
  'comparison_matrix',
  'options_table',
  'evidence_report',
  'staff_packet',
];

const TEMPLATE_IDS = new Set(BRIEF_TEMPLATE_DEFINITIONS.map((template) => template.id));
const CUSTOM_BASE_IDS = new Set(CUSTOM_BASE_TEMPLATE_IDS);

const DATA_PREFIX_RE = /^\/data(?:\s+|$)/i;
const DATA_PATTERNS = [
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
  /\b(cap\s+)?audit\b/i,
  /\bposition[-\s]?group\b/i,
  /\bcap ledger\b/i,
  /\bspend share\b/i,
  /\bover[-\s]?invested\b/i,
  /\bunder[-\s]?invested\b/i,
];
const STAFF_PATTERNS = [
  /\bstaff\b/i,
  /\bquestions?\b/i,
  /\bask (analytics|coaching|scouting|cap|contracts)\b/i,
  /\bforward(?:able)?\b/i,
];
const EVIDENCE_PATTERNS = [
  /\bsource\b/i,
  /\bsources\b/i,
  /\bcba\b/i,
  /\bprove\b/i,
  /\bvalidate\b/i,
  /\bevidence\b/i,
  /\bwhat is missing\b/i,
  /\bmissing data\b/i,
];
const OPTIONS_PATTERNS = [
  /\boptions?\b/i,
  /\bpaths\b/i,
  /\btable of\b/i,
  /\brank possible\b/i,
];
const COMPARISON_PATTERNS = [
  /\bcompare\b/i,
  /\bversus\b/i,
  /\bvs\.?\b/i,
  /\bbetween\b/i,
  /\bside[- ]by[- ]side\b/i,
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
const NBA_TEAM_ID_RE = /\b(ATL|BOS|BKN|CHA|CHI|CLE|DAL|DEN|DET|GSW|HOU|IND|LAC|LAL|MEM|MIA|MIL|MIN|NOP|NYK|OKC|ORL|PHI|PHX|POR|SAC|SAS|TOR|UTA|WAS)\b/g;

interface TemplateParseResult {
  selection: BriefTemplateSelection;
  errors: string[];
}

export function isBriefTemplateId(value: unknown): value is BriefTemplateId {
  return typeof value === 'string' && TEMPLATE_IDS.has(value as BriefTemplateId);
}

export function isCustomBaseTemplateId(value: unknown): value is BriefTemplateId {
  return typeof value === 'string' && CUSTOM_BASE_IDS.has(value as BriefTemplateId);
}

export function getBriefTemplateDefinition(id: BriefTemplateId | null | undefined): BriefTemplateDefinition {
  return BRIEF_TEMPLATE_DEFINITIONS.find((template) => template.id === (id ?? 'decision_brief'))
    ?? BRIEF_TEMPLATE_DEFINITIONS[0];
}

export function inferBriefTemplateFromQuestion(question: string): BriefTemplateId {
  const q = question.trim();
  if (!q) return 'decision_brief';
  if (DATA_PREFIX_RE.test(q) || DATA_PATTERNS.some((re) => re.test(q))) return 'data_table';
  if (COMPARISON_PATTERNS.some((re) => re.test(q)) || countTeamIds(q) >= 2) return 'comparison_matrix';
  if (OPTIONS_PATTERNS.some((re) => re.test(q))) return 'options_table';
  if (STAFF_PATTERNS.some((re) => re.test(q))) return 'staff_packet';
  if (EVIDENCE_PATTERNS.some((re) => re.test(q))) return 'evidence_report';
  if (ACTION_PATTERNS.some((re) => re.test(q))) return 'decision_brief';
  return 'decision_brief';
}

export function briefModeForTemplate(selection: BriefTemplateSelection): BriefMode | null {
  return selection.template_id === 'data_table' ? 'data_analyst' : null;
}

export function parseBriefTemplateSelection(raw: unknown, question: string): TemplateParseResult {
  if (raw === undefined || raw === null) {
    return {
      selection: { template_id: inferBriefTemplateFromQuestion(question) },
      errors: [],
    };
  }

  if (typeof raw === 'string') {
    if (!isBriefTemplateId(raw)) {
      return {
        selection: { template_id: inferBriefTemplateFromQuestion(question) },
        errors: ['template_id unsupported'],
      };
    }
    return normalizeKnownTemplate({ template_id: raw }, question);
  }

  if (!isRecord(raw)) {
    return {
      selection: { template_id: inferBriefTemplateFromQuestion(question) },
      errors: ['template must be an object or template id'],
    };
  }

  const rawTemplateId = raw.template_id ?? raw.id;
  if (!isBriefTemplateId(rawTemplateId)) {
    return {
      selection: { template_id: inferBriefTemplateFromQuestion(question) },
      errors: ['template_id unsupported'],
    };
  }

  return normalizeKnownTemplate({
    template_id: rawTemplateId,
    base_template_id: raw.base_template_id,
    custom_template_id: raw.custom_template_id,
    instructions: raw.instructions,
  }, question);
}

export function parseSavedBriefTemplateInput(raw: unknown): {
  name: string;
  base_template_id: BriefTemplateId;
  instructions: string;
  errors: string[];
} {
  const errors: string[] = [];
  const record = isRecord(raw) ? raw : {};
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const instructions = typeof record.instructions === 'string' ? record.instructions.trim() : '';
  const base_template_id = isCustomBaseTemplateId(record.base_template_id)
    ? record.base_template_id
    : 'decision_brief';

  if (!name) errors.push('name required');
  if (name.length > MAX_SAVED_TEMPLATE_NAME) errors.push(`name must be ${MAX_SAVED_TEMPLATE_NAME} characters or fewer`);
  if (!instructions) errors.push('instructions required');
  if (instructions.length > MAX_CUSTOM_TEMPLATE_INSTRUCTIONS) {
    errors.push(`instructions must be ${MAX_CUSTOM_TEMPLATE_INSTRUCTIONS} characters or fewer`);
  }
  if (record.base_template_id !== undefined && !isCustomBaseTemplateId(record.base_template_id)) {
    errors.push('base_template_id unsupported');
  }

  return { name, base_template_id, instructions, errors };
}

export function templateSelectionFromBrief(
  brief: Pick<Brief, 'template_id' | 'template_base_id' | 'custom_template_id' | 'template_instructions'> & Partial<Pick<Brief, 'mode'>>,
): BriefTemplateSelection {
  const template_id = isBriefTemplateId(brief.template_id)
    ? brief.template_id
    : (brief.mode === 'data_analyst' ? 'data_table' : 'decision_brief');
  return {
    template_id,
    base_template_id: template_id === 'custom' && isCustomBaseTemplateId(brief.template_base_id)
      ? brief.template_base_id
      : (template_id === 'custom' ? 'decision_brief' : null),
    custom_template_id: brief.custom_template_id ?? null,
    instructions: brief.template_instructions ?? null,
  };
}

export function templateLabelForBrief(brief: Pick<Brief, 'template_id'>): string {
  return getBriefTemplateDefinition(isBriefTemplateId(brief.template_id) ? brief.template_id : 'decision_brief').short_label;
}

function normalizeKnownTemplate(raw: {
  template_id: BriefTemplateId;
  base_template_id?: unknown;
  custom_template_id?: unknown;
  instructions?: unknown;
}, question: string): TemplateParseResult {
  const errors: string[] = [];
  if (raw.template_id !== 'custom') {
    return {
      selection: { template_id: raw.template_id },
      errors,
    };
  }

  const instructions = typeof raw.instructions === 'string' ? raw.instructions.trim() : '';
  const custom_template_id = typeof raw.custom_template_id === 'string' && raw.custom_template_id.trim()
    ? raw.custom_template_id.trim()
    : null;
  const inferred = inferBriefTemplateFromQuestion(question);
  const base_template_id = isCustomBaseTemplateId(raw.base_template_id)
    ? raw.base_template_id
    : (isCustomBaseTemplateId(inferred) ? inferred : 'decision_brief');

  if (raw.base_template_id !== undefined && !isCustomBaseTemplateId(raw.base_template_id)) {
    errors.push('base_template_id unsupported');
  }
  if (!instructions) errors.push('instructions required for custom template');
  if (instructions.length > MAX_CUSTOM_TEMPLATE_INSTRUCTIONS) {
    errors.push(`instructions must be ${MAX_CUSTOM_TEMPLATE_INSTRUCTIONS} characters or fewer`);
  }

  return {
    selection: {
      template_id: 'custom',
      base_template_id,
      custom_template_id,
      instructions,
    },
    errors,
  };
}

function countTeamIds(question: string): number {
  return new Set(question.match(NBA_TEAM_ID_RE) ?? []).size;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
