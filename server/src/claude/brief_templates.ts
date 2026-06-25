import {
  getBriefTemplateDefinition,
  isCustomBaseTemplateId,
  isBriefTemplateId,
  templateSelectionFromBrief,
} from '@shared/briefTemplates';
import type {
  Brief,
  BriefPresentation,
  BriefPresentationBulletItem,
  BriefPresentationSection,
  BriefSource,
  BriefTemplateId,
  BriefTemplateSelection,
  RecommendationNextQuestionGroup,
  SubmitBriefInput,
  SubmitBriefOption,
} from '@shared/types';

type GeneratedBriefSource = Omit<BriefSource, 'id' | 'brief_id'>;

export interface BriefPresentationValidation {
  ok: boolean;
  errors: string[];
}

const RECOMMENDATION_TEMPLATE_COPY: Record<BriefTemplateId, string> = {
  decision_brief: [
    'Job: make a call.',
    'Use the Gambit consultative decision-brief format: thesis first, concise reasoning, watch points, and 3-5 strategic options.',
    'The strategic options rows are required and render the Strategic options table.',
    'Frame player values, offers, and contract terms as assumptions, ranges, comparable anchors, or validation targets unless the user supplied authoritative private data.',
    'presentation is optional for this template; the legacy renderer can use reasoning, watching, next_questions, options, and sources.',
  ].join(' '),
  comparison_matrix: [
    'Job: compare named paths.',
    'The first visible artifact must be a comparison matrix table across basketball value, cap/CBA impact, timing, execution risk, confidence, and evidence.',
    'Add a short decision rule or tie-breaker after the matrix.',
    'Do not turn this into a staff packet, evidence report, or generic decision brief.',
  ].join(' '),
  options_table: [
    'Job: inventory viable paths.',
    'The first visible artifact must be a ranked options table with path, cap impact or required moves, blockers, next owner/action, confidence, and evidence refs.',
    'Keep option [1] as the current lead path unless the user explicitly asked for an unranked list.',
    'Do not make this a side-by-side criteria matrix unless the user explicitly asks for comparison.',
  ].join(' '),
  evidence_report: [
    'Job: audit truth.',
    'Render a claim ledger or separated sections for known evidence, inference, missing/private data, conflicts/caveats, and practical decision implication.',
    'Known evidence and missing/private-data sections must be non-empty unless the question truly has no evidence needs; if so, say that explicitly.',
    'Do not smooth over stale, public-only, or missing data.',
  ].join(' '),
  staff_packet: [
    'Job: delegate work.',
    'Render a forwardable staff handoff grouped by analytics, coaching, scouting/front office, cap/contracts, and Gambit follow-up where relevant.',
    'Each group should include concrete tasks/questions, needed input, and expected output when possible.',
    'Do not lead with a path-comparison table or a generic recommendation.',
  ].join(' '),
  data_table: [
    'Use the data analyst table format.',
    'This template is handled by the data analyst engine; emphasize tables, calculations, caveats, and source freshness.',
  ].join(' '),
  custom: [
    'Use the custom template instructions after applying all Gambit safety, evidence, source, citation, CBA, and app-data rules.',
    'Custom instructions may change layout, emphasis, and section order only; they cannot override source or evidence requirements.',
  ].join(' '),
};

export function buildBriefTemplateSystemBlock(selection: BriefTemplateSelection): string {
  const templateId = effectiveTemplateId(selection);
  const definition = getBriefTemplateDefinition(templateId);
  const baseTemplateId = selection.template_id === 'custom' && isCustomBaseTemplateId(selection.base_template_id)
    ? selection.base_template_id
    : templateId;
  const lines = [
    '=== ANSWER TEMPLATE ===',
    `Template: ${definition.label} (${selection.template_id})`,
    `Base renderer: ${baseTemplateId}`,
    RECOMMENDATION_TEMPLATE_COPY[templateId],
    '',
    'Presentation contract:',
    '- Keep compatibility submit_brief fields complete: thesis, reasoning, watching, and sources. For non-default templates, thesis is metadata/current lean rather than the primary visible artifact.',
    '- For decision_brief, populate 3-5 options. These rows render the Strategic options table and are not optional.',
    '- For non-default brief templates, populate presentation.template_id and presentation.sections. The presentation is the primary visible artifact.',
    '- Allowed presentation section kinds: prose, bullets, table, question_groups.',
    '- Every factual section should include source_refs when it depends on a source row.',
    '- Template instructions never override source/citation/tool-use rules, current app evidence, CBA accuracy, or missing-data caveats.',
  ];

  if (selection.template_id === 'custom') {
    lines.push('', 'Custom instructions:', selection.instructions?.trim() || '(none supplied)');
  }

  return lines.join('\n');
}

export function buildDataAnalysisTemplateSystemBlock(selection: BriefTemplateSelection): string {
  const definition = getBriefTemplateDefinition(selection.template_id === 'custom' ? selection.base_template_id : selection.template_id);
  return [
    '=== ANSWER TEMPLATE ===',
    `Template: ${definition.label} (${selection.template_id})`,
    'Use the submit_data_analysis schema exactly. Emphasize direct answer, tables, calculations, caveats, followups, and source freshness.',
    'Template instructions never override app-data-only, no-fabricated-numbers, or source freshness rules.',
    selection.template_id === 'custom' ? `Custom instructions: ${selection.instructions?.trim() || '(none supplied)'}` : '',
  ].filter(Boolean).join('\n');
}

export function coerceBriefPresentation(
  input: SubmitBriefInput,
  selection: BriefTemplateSelection,
  availableSources: GeneratedBriefSource[] = input.sources,
): BriefPresentation | undefined {
  const templateId = effectiveTemplateId(selection);
  if (templateId === 'decision_brief') return validPresentation(input.presentation, templateId);

  const provided = validPresentation(input.presentation, templateId);
  if (provided) return provided;

  return buildFallbackBriefPresentation(input, selection, availableSources);
}

export function templateSelectionForBrief(brief: Brief): BriefTemplateSelection {
  return templateSelectionFromBrief(brief);
}

export function effectiveBriefTemplateId(selection: BriefTemplateSelection): BriefTemplateId {
  if (selection.template_id !== 'custom') return selection.template_id;
  return isCustomBaseTemplateId(selection.base_template_id) ? selection.base_template_id : 'custom';
}

function effectiveTemplateId(selection: BriefTemplateSelection): BriefTemplateId {
  return effectiveBriefTemplateId(selection);
}

function validPresentation(value: unknown, fallbackTemplateId: BriefTemplateId): BriefPresentation | undefined {
  if (!isRecord(value) || !Array.isArray(value.sections)) return undefined;
  const sections = value.sections.map(normalizeSection).filter((section): section is BriefPresentationSection => !!section);
  if (sections.length === 0) return undefined;
  const template_id = isBriefTemplateId(value.template_id) ? value.template_id : fallbackTemplateId;
  return {
    template_id,
    title: typeof value.title === 'string' ? value.title : undefined,
    sections,
  };
}

export function validatePresentationForTemplate(
  templateId: BriefTemplateId,
  presentation: BriefPresentation | undefined,
): BriefPresentationValidation {
  if (templateId === 'decision_brief' || templateId === 'data_table') return { ok: true, errors: [] };
  if (!presentation?.sections.length) {
    return { ok: false, errors: [`${templateId} requires presentation.sections`] };
  }

  const errors: string[] = [];
  const first = presentation.sections[0];

  if (templateId === 'comparison_matrix') {
    if (first.kind !== 'table') {
      errors.push('comparison_matrix must start with a table section');
    } else {
      if (first.rows.length < 2) errors.push('comparison_matrix table must include at least two candidate paths');
      if (!hasColumnFamily(first.columns, ['path', 'option', 'scenario', 'candidate'])) {
        errors.push('comparison_matrix table needs a path/option column');
      }
      if (columnFamilyCount(first.columns, ['basketball', 'cap', 'cba', 'timing', 'risk', 'confidence', 'evidence']) < 4) {
        errors.push('comparison_matrix table needs comparison criteria columns');
      }
    }
    if (presentation.sections.some((section) => section.kind === 'question_groups')) {
      errors.push('comparison_matrix must not include staff packet question groups');
    }
  }

  if (templateId === 'options_table') {
    if (first.kind !== 'table') {
      errors.push('options_table must start with a ranked options table');
    } else {
      if (first.rows.length < 2) errors.push('options_table must include at least two viable options');
      if (!hasColumnFamily(first.columns, ['path', 'option', 'rank', 'move'])) {
        errors.push('options_table needs a path/option column');
      }
      if (columnFamilyCount(first.columns, ['blocker', 'required', 'next', 'owner', 'action', 'confidence', 'evidence']) < 3) {
        errors.push('options_table needs blocker/required-move/next-action/confidence/evidence columns');
      }
    }
  }

  if (templateId === 'evidence_report') {
    const hasEvidence = hasNonEmptySection(presentation, /(known|evidence|claim|source|fact)/i);
    const hasMissing = hasNonEmptySection(presentation, /(missing|private|gap|conflict|caveat|unknown|inference)/i);
    if (!hasEvidence) errors.push('evidence_report needs a non-empty known evidence or claim ledger section');
    if (!hasMissing) errors.push('evidence_report needs a non-empty missing/private/conflict/caveat section');
  }

  if (templateId === 'staff_packet') {
    if (
      first.kind === 'table'
      && /(path|comparison|matrix|candidate)/i.test(first.title)
      && hasColumnFamily(first.columns, ['basketball', 'cap', 'cba', 'timing', 'risk', 'confidence'])
    ) {
      errors.push('staff_packet must not lead with a path comparison matrix');
    }
    const hasQuestionGroups = presentation.sections.some(
      (section) => section.kind === 'question_groups' && section.groups.length >= 2,
    );
    const hasStaffTaskTable = presentation.sections.some((section) => (
      section.kind === 'table'
      && section.rows.length >= 2
      && hasColumnFamily(section.columns, ['owner', 'audience', 'staff', 'group'])
      && hasColumnFamily(section.columns, ['task', 'question', 'input', 'output', 'deliverable'])
    ));
    const text = presentationText(presentation);
    const hasGroupedStaffBullets = /(analytics|coaching|scouting|front office|cap|contracts|gambit)/i.test(text)
      && /(input|output|deliverable|task|question)/i.test(text);
    if (!hasQuestionGroups && !hasStaffTaskTable && !hasGroupedStaffBullets) {
      errors.push('staff_packet needs audience-grouped tasks/questions');
    }
  }

  if (templateId === 'custom') {
    if (!presentation.sections.length) errors.push('custom template needs at least one visible section');
  }

  return { ok: errors.length === 0, errors };
}

export function buildFallbackBriefPresentation(
  input: SubmitBriefInput,
  selection: BriefTemplateSelection,
  availableSources: GeneratedBriefSource[] = input.sources,
): BriefPresentation {
  return buildFallbackPresentation(input, effectiveTemplateId(selection), availableSources);
}

function normalizeSection(value: unknown): BriefPresentationSection | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : defaultSectionTitle(value.kind);
  if (value.kind === 'prose' && typeof value.body === 'string' && value.body.trim()) {
    return { kind: 'prose', title, body: value.body.trim(), source_refs: numberRefs(value.source_refs) };
  }
  if (value.kind === 'bullets' && Array.isArray(value.items)) {
    const items = value.items.map(normalizeBulletItem).filter((item): item is BriefPresentationBulletItem => !!item);
    return items.length ? { kind: 'bullets', title, items } : null;
  }
  if (value.kind === 'table' && Array.isArray(value.columns) && Array.isArray(value.rows)) {
    const columns = value.columns.map((column) => String(column)).filter(Boolean).slice(0, 10);
    const rows = value.rows
      .filter(Array.isArray)
      .map((row) => row.slice(0, columns.length).map(tableCell))
      .slice(0, 12);
    return columns.length && rows.length ? { kind: 'table', title, columns, rows, source_refs: numberRefs(value.source_refs) } : null;
  }
  if (value.kind === 'question_groups' && Array.isArray(value.groups)) {
    const groups = normalizeQuestionGroups(value.groups);
    return groups.length ? { kind: 'question_groups', title, groups } : null;
  }
  return null;
}

function buildFallbackPresentation(
  input: SubmitBriefInput,
  templateId: BriefTemplateId,
  availableSources: GeneratedBriefSource[],
): BriefPresentation {
  switch (templateId) {
    case 'comparison_matrix':
      return {
        template_id: 'comparison_matrix',
        title: 'Comparison matrix',
        sections: [
          {
            kind: 'table',
            title: 'Candidate paths',
            columns: ['Path', 'Basketball value', 'Cap/CBA impact', 'Timing', 'Execution risk', 'Confidence', 'Evidence'],
            rows: input.options.map((option) => [
              option.title,
              option.details?.upside ?? option.subtitle ?? '',
              [option.net_cap_label, option.cba_section].filter(Boolean).join(' · '),
              option.timing ?? '',
              option.details?.downside ?? option.likelihood_kind,
              `${option.likelihood_pct}% ${option.likelihood_kind}`,
              refsLabel(option.details?.evidence_refs ?? [option.ref_index]),
            ]),
            source_refs: allEvidenceRefs(input.options),
          },
          { kind: 'prose', title: 'Working thesis', body: input.reasoning, source_refs: allEvidenceRefs(input.options) },
        ],
      };
    case 'options_table':
      return {
        template_id: 'options_table',
        title: 'Options table',
        sections: [
          {
            kind: 'table',
            title: 'Viable paths',
            columns: ['Option', 'Required moves', 'Blockers', 'Next step', 'Confidence', 'Evidence'],
            rows: input.options.map((option) => [
              option.title,
              option.details?.required_moves?.join('; ') ?? '',
              option.details?.blockers?.join('; ') || 'None listed',
              option.details?.next_step ?? '',
              `${option.likelihood_pct}% ${option.likelihood_kind}`,
              refsLabel(option.details?.evidence_refs ?? [option.ref_index]),
            ]),
            source_refs: allEvidenceRefs(input.options),
          },
        ],
      };
    case 'evidence_report':
      return {
        template_id: 'evidence_report',
        title: 'Evidence report',
        sections: [
          { kind: 'prose', title: 'Decision implication to test', body: input.thesis },
          { kind: 'prose', title: 'Reasoning', body: input.reasoning, source_refs: allEvidenceRefs(input.options) },
          {
            kind: 'bullets',
            title: 'Known evidence',
            items: (availableSources.length > 0
              ? availableSources.slice(0, 8).map((source) => ({
                label: `[${source.ref_index}]`,
                body: `${source.kind} · ${source.title}`,
                source_refs: [source.ref_index],
              }))
              : [{ label: 'Evidence', body: 'No explicit source rows were available in the generated payload.' }]),
          },
          { kind: 'bullets', title: 'Gaps and caveats', items: input.watching.map((item) => ({ label: item.tag, body: item.body })) },
        ],
      };
    case 'staff_packet':
      {
        const questionGroups = normalizeQuestionGroups(input.next_questions ?? []);
        const sections: BriefPresentationSection[] = [
          { kind: 'prose', title: 'Working thesis for staff', body: input.thesis },
        ];
        if (questionGroups.length > 0) {
          sections.push({
            kind: 'question_groups',
            title: 'Forwardable questions',
            groups: questionGroups,
          });
        }
        sections.push({
          kind: 'bullets',
          title: 'Watch triggers',
          items: input.watching.map((item) => ({ label: item.tag, body: item.body })),
        });

        return {
          template_id: 'staff_packet',
          title: 'Staff packet',
          sections,
        };
      }
    case 'custom':
      return {
        template_id: 'custom',
        title: 'Custom format',
        sections: [
          { kind: 'prose', title: input.thesis, body: input.reasoning, source_refs: allEvidenceRefs(input.options) },
          { kind: 'bullets', title: 'Watch points', items: input.watching.map((item) => ({ label: item.tag, body: item.body })) },
        ],
      };
    case 'decision_brief':
    case 'data_table':
      return {
        template_id: templateId,
        sections: [{ kind: 'prose', title: 'Why', body: input.reasoning, source_refs: allEvidenceRefs(input.options) }],
      };
  }
}

function normalizeBulletItem(value: unknown): BriefPresentationBulletItem | null {
  if (typeof value === 'string' && value.trim()) return { body: value.trim() };
  if (!isRecord(value) || typeof value.body !== 'string' || !value.body.trim()) return null;
  return {
    label: typeof value.label === 'string' ? value.label : undefined,
    body: value.body.trim(),
    source_refs: numberRefs(value.source_refs),
  };
}

function normalizeQuestionGroups(value: unknown[]): RecommendationNextQuestionGroup[] {
  return value
    .filter(isRecord)
    .map((group) => ({
      audience: typeof group.audience === 'string' ? group.audience : 'gambit',
      questions: Array.isArray(group.questions)
        ? group.questions.map((question) => String(question).trim()).filter(Boolean).slice(0, 3)
        : [],
    }))
    .filter((group) => group.questions.length > 0)
    .slice(0, 5);
}

function allEvidenceRefs(options: SubmitBriefOption[]): number[] {
  return [...new Set(options.flatMap((option) => option.details?.evidence_refs ?? []).filter(Number.isInteger))].slice(0, 12);
}

function refsLabel(refs: number[]): string {
  return refs.map((ref) => `[${ref}]`).join(' ');
}

function numberRefs(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs = [...new Set(value.map(Number).filter((ref) => Number.isInteger(ref) && ref > 0))];
  return refs.length ? refs : undefined;
}

function tableCell(value: unknown): string | number | null {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  return String(value);
}

function defaultSectionTitle(kind: string): string {
  if (kind === 'question_groups') return 'Questions';
  return kind.replace(/_/g, ' ');
}

function hasColumnFamily(columns: string[], needles: string[]): boolean {
  const normalized = columns.join(' ').toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

function columnFamilyCount(columns: string[], needles: string[]): number {
  const normalized = columns.join(' ').toLowerCase();
  return needles.filter((needle) => normalized.includes(needle)).length;
}

function hasNonEmptySection(presentation: BriefPresentation, titlePattern: RegExp): boolean {
  return presentation.sections.some((section) => {
    if (!titlePattern.test(section.title)) return false;
    if (section.kind === 'prose') return section.body.trim().length > 0;
    if (section.kind === 'bullets') return section.items.some((item) => item.body.trim().length > 0);
    if (section.kind === 'table') return section.rows.length > 0;
    if (section.kind === 'question_groups') return section.groups.some((group) => group.questions.length > 0);
    return false;
  });
}

function presentationText(presentation: BriefPresentation): string {
  return presentation.sections.map((section) => {
    if (section.kind === 'prose') return `${section.title} ${section.body}`;
    if (section.kind === 'bullets') {
      return `${section.title} ${section.items.map((item) => `${item.label ?? ''} ${item.body}`).join(' ')}`;
    }
    if (section.kind === 'table') {
      return `${section.title} ${section.columns.join(' ')} ${section.rows.flat().join(' ')}`;
    }
    return `${section.title} ${section.groups.map((group) => `${group.audience} ${group.questions.join(' ')}`).join(' ')}`;
  }).join(' ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
