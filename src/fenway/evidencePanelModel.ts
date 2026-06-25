import type {
  Brief,
  BriefBody,
  BriefOption,
  BriefOptionDetails,
  BriefPresentationSection,
  BriefSource,
  RecommendationBriefBody,
} from '@shared/types';

export type EvidenceUsage = 'used' | 'background' | 'option_focus';

export type EvidenceRole =
  | 'current_team_data'
  | 'roster'
  | 'cap'
  | 'stats'
  | 'cba'
  | 'context'
  | 'contract'
  | 'market'
  | 'supporting';

export type EvidenceItemType = 'claim' | 'option' | 'background';
export type EvidenceAuditStatus = 'checked' | 'background';

export interface EvidenceCheckRow {
  key: string;
  refIndex: number;
  title: string;
  proof: string;
  meta: string;
  freshness: string | null;
  role: EvidenceRole;
  teamLabel: string | null;
  source: BriefSource;
}

export interface EvidencePackItem {
  key: string;
  role: EvidenceRole;
  usage: EvidenceUsage;
  type: EvidenceItemType;
  status: EvidenceAuditStatus;
  title: string;
  claim: string | null;
  proof: string;
  icon: string;
  refs: number[];
  rows: EvidenceCheckRow[];
  meta: string;
  freshness: string | null;
}

export interface EvidencePackModel {
  title: string;
  subtitle: string;
  sectionTitle: string;
  totalRefs: number;
  usedRefs: number;
  statusChips: string[];
  checkedItems: EvidencePackItem[];
  backgroundItems: EvidencePackItem[];
  refToItemKey: Record<number, string>;
}

export interface EvidenceSourceClassification {
  role: EvidenceRole;
  groupRole: EvidenceRole;
  groupKey: string;
  title: string;
  proof: string;
  icon: string;
  teamLabel: string | null;
}

interface MutableEvidencePackItem {
  key: string;
  role: EvidenceRole;
  usage: EvidenceUsage;
  type: EvidenceItemType;
  status: EvidenceAuditStatus;
  title: string;
  claim: string | null;
  proof: string;
  icon: string;
  rows: EvidenceCheckRow[];
}

interface AuditClaimSpec {
  key: string;
  type: EvidenceItemType;
  title: string;
  proof: string;
  refs: number[];
  icon?: string;
}

const ROLE_ORDER: EvidenceRole[] = [
  'current_team_data',
  'roster',
  'cap',
  'stats',
  'cba',
  'context',
  'contract',
  'market',
  'supporting',
];

export function buildEvidencePackModel(
  activeBrief: Brief | null,
  sources: BriefSource[],
  options: BriefOption[],
  sourceFilterRefs: number[] | null,
  selectedOptionRef: number | null,
): EvidencePackModel {
  const sourceRows = sources.map((source) => {
    const classification = classifyEvidenceSource(source);
    return evidenceRowForSource(source, classification);
  });
  const rowsByRef = new Map(sourceRows.map((row) => [row.refIndex, row]));
  const sourceGroups = buildBackgroundSourceGroups(sources);
  const focusRefs = new Set((sourceFilterRefs ?? []).filter((ref) => Number.isInteger(ref) && ref > 0));
  const hasFocus = focusRefs.size > 0;

  const claimSpecs = hasFocus
    ? focusedClaimSpecs(activeBrief, options, focusRefs, selectedOptionRef)
    : defaultClaimSpecs(activeBrief, options);
  const checkedItems = claimSpecs
    .map((spec) => auditItemFromSpec(spec, rowsByRef, hasFocus, focusRefs))
    .filter((item): item is EvidencePackItem => item !== null)
    .sort(compareItems);

  const coveredRefs = new Set(checkedItems.flatMap((item) => item.refs));
  const backgroundItems = hasFocus
    ? []
    : sourceGroups.filter((item) => !item.refs.some((ref) => coveredRefs.has(ref)));

  const modelItems = [...checkedItems, ...backgroundItems];
  const refToItemKey = refMapForItems(checkedItems, backgroundItems);
  const usedRefs = uniqueSorted(checkedItems.flatMap((item) => item.refs)).length;
  const backgroundRefCount = uniqueSorted(backgroundItems.flatMap((item) => item.refs)).length;
  const sectionTitle = hasFocus
    ? selectedOptionRef !== null ? `Audit for option [${selectedOptionRef}]` : 'Focused audit'
    : 'Claims checked for this answer';

  return {
    title: 'Evidence Pack',
    subtitle: subtitleForModel(hasFocus, selectedOptionRef, checkedItems.length, backgroundRefCount),
    sectionTitle,
    totalRefs: sources.length,
    usedRefs,
    statusChips: statusChipsForItems(modelItems),
    checkedItems,
    backgroundItems,
    refToItemKey,
  };
}

export function extractBriefSourceRefs(body: BriefBody | null): Set<number> {
  const refs = new Set<number>();
  if (!body) return refs;

  if (body.kind === 'data_analysis') {
    for (const finding of body.key_findings) addRefs(refs, finding.source_refs);
    for (const table of body.tables) addRefs(refs, table.source_refs);
    for (const calculation of body.calculations) addRefs(refs, calculation.source_refs);
    return refs;
  }

  const brief = body as RecommendationBriefBody;
  addBracketRefs(refs, brief.reasoning);
  if (brief.blockquote?.cite_ref) refs.add(brief.blockquote.cite_ref);
  for (const item of brief.watching ?? []) addBracketRefs(refs, item.body);
  for (const section of brief.presentation?.sections ?? []) addPresentationRefs(refs, section);
  return refs;
}

export function classifyEvidenceSource(source: BriefSource): EvidenceSourceClassification {
  const rows = dataRows(source);
  const text = `${source.kind} ${source.source ?? ''} ${source.title} ${rows.map((row) => `${row.k} ${row.v}`).join(' ')}`.toLowerCase();
  const teamLabel = teamLabelForSource(source, rows);

  if (source.kind === 'CBA' || /\bcba\b|cba_articles|article [ivx]+|section/.test(text)) {
    return classification(source, 'cba', 'cba', 'CBA constraint check', 'Flags transaction-rule constraints that affect execution.', 'shield', teamLabel);
  }
  if (source.kind === 'ANALYST_DATA' && currentNbaEvidence(source)) {
    return classification(source, 'current_team_data', 'current_team_data', 'Current team data', 'Confirms roster, cap posture, and player-stat baseline.', 'clipboard', teamLabel);
  }
  if (source.kind === 'CONTEXT_GRAPH') {
    return classification(source, 'context', 'context', 'Team context', 'Adds strategic posture, priorities, and team priorities.', 'link', teamLabel);
  }
  if (source.kind === 'CONTRACT') {
    return classification(source, 'contract', 'contract', 'Contract mechanics', 'Shows salary structure, guarantees, and contract-specific constraints.', 'doc', teamLabel);
  }
  if (source.kind === 'NEWS' || source.kind === 'PROJECTION') {
    return classification(source, 'market', 'market', 'Market signal', 'Adds reporting, projection, or market context around the decision.', 'search', teamLabel);
  }
  if (source.kind === 'CAP' || /\bcap\b|apron|payroll|salary|guarantee|nba_cap_sheet|cap_sheet/.test(text)) {
    return classification(source, 'cap', groupForAppData(source, teamLabel), 'Cap sheet and apron position', 'Shows payroll, salary guarantees, and constraint posture.', 'clipboard', teamLabel);
  }
  if (/\bstats?\b|player_stat|usage|efficiency|net rating|true shooting|epm/.test(text)) {
    return classification(source, 'stats', groupForAppData(source, teamLabel), 'Player performance', 'Supports usage, efficiency, and role comparisons.', 'pulse', teamLabel);
  }
  if (/\broster\b|position|active players?|nba_rosters?/.test(text)) {
    return classification(source, 'roster', groupForAppData(source, teamLabel), 'Roster snapshot', 'Confirms active players, positions, and roster status.', 'clipboard', teamLabel);
  }
  if (source.kind === 'ANALYST_DATA') {
    return classification(source, 'current_team_data', groupForAppData(source, teamLabel), 'Current team data', 'Confirms roster, cap posture, and player-stat baseline.', 'clipboard', teamLabel);
  }

  return classification(source, 'supporting', 'supporting', cleanTitle(source.title) || 'Supporting source', 'Supports the reasoning behind this answer.', 'doc', teamLabel);
}

export function formatEvidenceFreshness(source: BriefSource): string | null {
  const rows = dataRows(source);
  const asOf = rowValue(rows, 'As of') ?? rowValue(rows, 'Roster as of') ?? rowValue(rows, 'Cap as of') ?? rowValue(rows, 'Stats as of');
  return meaningful(asOf) ?? meaningful(source.updated_at);
}

function defaultClaimSpecs(activeBrief: Brief | null, options: BriefOption[]): AuditClaimSpec[] {
  const specs = briefClaimSpecs(activeBrief?.body ?? null);
  const optionSpecs = optionAuditSpecs(options, null).slice(0, specs.length > 0 ? 2 : 4);
  return uniqueSpecs([...specs, ...optionSpecs]);
}

function focusedClaimSpecs(
  activeBrief: Brief | null,
  options: BriefOption[],
  focusRefs: Set<number>,
  selectedOptionRef: number | null,
): AuditClaimSpec[] {
  const selectedOptionSpecs = optionAuditSpecs(options, selectedOptionRef);
  const focusedOptionSpecs = selectedOptionSpecs.length > 0
    ? selectedOptionSpecs
    : optionAuditSpecs(options, null).filter((spec) => spec.refs.some((ref) => focusRefs.has(ref)));
  const focusedBriefSpecs = briefClaimSpecs(activeBrief?.body ?? null)
    .filter((spec) => spec.refs.some((ref) => focusRefs.has(ref)));
  return uniqueSpecs([...focusedOptionSpecs, ...focusedBriefSpecs]);
}

function briefClaimSpecs(body: BriefBody | null): AuditClaimSpec[] {
  if (!body) return [];
  if (body.kind === 'data_analysis') {
    return [
      ...body.key_findings.map((finding, index) => ({
        key: `finding:${index}`,
        type: 'claim' as const,
        title: cleanClaimTitle(finding.label),
        proof: cleanBodyText(finding.body) || 'Finding is backed by the cited app data.',
        refs: uniqueSorted(finding.source_refs),
        icon: 'check',
      })),
      ...body.tables.map((table, index) => ({
        key: `table:${index}`,
        type: 'claim' as const,
        title: cleanClaimTitle(table.title),
        proof: 'Checks the table values used in the answer.',
        refs: uniqueSorted(table.source_refs),
        icon: 'grid',
      })),
      ...body.calculations.map((calculation, index) => ({
        key: `calculation:${index}`,
        type: 'claim' as const,
        title: cleanClaimTitle([calculation.label, calculation.value].filter(Boolean).join(': ')),
        proof: calculation.formula ? `Calculation: ${calculation.formula}.` : 'Checks the calculation used in the answer.',
        refs: uniqueSorted(calculation.source_refs),
        icon: 'pulse',
      })),
    ];
  }

  const brief = body as RecommendationBriefBody;
  const specs: AuditClaimSpec[] = [
    ...claimSpecsFromText(brief.reasoning, 'reasoning', 'Claim cited in reasoning'),
  ];
  if (brief.blockquote?.cite_ref) {
    specs.push({
      key: 'blockquote',
      type: 'claim',
      title: cleanClaimTitle(brief.blockquote.text),
      proof: `Rule quote attributed to ${brief.blockquote.source}.`,
      refs: [brief.blockquote.cite_ref],
      icon: 'shield',
    });
  }
  for (const [index, item] of (brief.watching ?? []).entries()) {
    const refs = refsFromText(item.body);
    if (refs.length) {
      specs.push({
        key: `watching:${index}`,
        type: 'claim',
        title: cleanClaimTitle(`${item.tag}: ${item.body}`),
        proof: 'Watch item depends on the cited evidence staying true.',
        refs,
        icon: 'bell',
      });
    }
  }
  for (const [index, section] of (brief.presentation?.sections ?? []).entries()) {
    specs.push(...claimSpecsFromPresentation(section, index));
  }
  return specs;
}

function claimSpecsFromText(text: string | undefined, prefix: string, fallbackTitle: string): AuditClaimSpec[] {
  if (!text) return [];
  const compactText = text.replace(/\s+/g, ' ').trim();
  const segments = compactText.split(/(?:\.\s+|\?\s+|!\s+)/).map((part) => part.trim()).filter(Boolean);
  const specs: AuditClaimSpec[] = [];
  segments.forEach((segment, index) => {
    const refs = refsFromText(segment);
    if (!refs.length) return;
    specs.push({
      key: `${prefix}:${index}:${refs.join('-')}`,
      type: 'claim',
      title: cleanClaimTitle(segment) || fallbackTitle,
      proof: auditProofForClaim(segment),
      refs,
      icon: 'check',
    });
  });
  if (!specs.length) {
    const refs = refsFromText(compactText);
    if (refs.length) {
      specs.push({
        key: `${prefix}:all:${refs.join('-')}`,
        type: 'claim',
        title: cleanClaimTitle(compactText) || fallbackTitle,
        proof: auditProofForClaim(compactText),
        refs,
        icon: 'check',
      });
    }
  }
  return specs;
}

function claimSpecsFromPresentation(section: BriefPresentationSection, index: number): AuditClaimSpec[] {
  if (section.kind === 'prose') {
    const refs = uniqueSorted([...(section.source_refs ?? []), ...refsFromText(section.body)]);
    if (!refs.length) return [];
    return [{
      key: `presentation:${index}`,
      type: 'claim',
      title: cleanClaimTitle(section.title),
      proof: cleanBodyText(section.body) || 'Presentation section is backed by cited evidence.',
      refs,
      icon: 'doc',
    }];
  }
  if (section.kind === 'bullets') {
    return section.items.flatMap((item, itemIndex) => {
      const refs = uniqueSorted([...(item.source_refs ?? []), ...refsFromText(item.body)]);
      if (!refs.length) return [];
      return [{
        key: `presentation:${index}:bullet:${itemIndex}`,
        type: 'claim' as const,
        title: cleanClaimTitle(item.label ? `${item.label}: ${item.body}` : item.body),
        proof: 'Bullet depends on the cited evidence.',
        refs,
        icon: 'check',
      }];
    });
  }
  if (section.kind === 'table') {
    const refs = uniqueSorted(section.source_refs ?? []);
    if (!refs.length) return [];
    return [{
      key: `presentation:${index}:table`,
      type: 'claim',
      title: cleanClaimTitle(section.title),
      proof: 'Checks the table values used in the recommendation.',
      refs,
      icon: 'grid',
    }];
  }
  return [];
}

function optionAuditSpecs(options: BriefOption[], selectedOptionRef: number | null): AuditClaimSpec[] {
  return options
    .filter((option) => selectedOptionRef === null || option.ref_index === selectedOptionRef)
    .flatMap((option) => {
      const details = option.details;
      if (!details) return [];
      const refs = uniqueSorted(details.evidence_refs ?? []);
      const title = cleanClaimTitle(usefulOptionTitle(option, details));
      const proof = cleanBodyText(details.why_this)
        || cleanBodyText(option.subtitle ?? '')
        || 'Option is connected to the listed evidence.';
      return [{
        key: `option:${option.ref_index}`,
        type: 'option' as const,
        title,
        proof,
        refs,
        icon: option.likelihood_kind === 'executable' || option.likelihood_kind === 'plausible' ? 'check' : 'search',
      }];
    });
}

function auditItemFromSpec(
  spec: AuditClaimSpec,
  rowsByRef: Map<number, EvidenceCheckRow>,
  hasFocus: boolean,
  focusRefs: Set<number>,
): EvidencePackItem | null {
  const specRefs = uniqueSorted(spec.refs);
  const refs = hasFocus ? specRefs.filter((ref) => focusRefs.has(ref)) : specRefs;
  const rows = refs.map((ref) => rowsByRef.get(ref)).filter((row): row is EvidenceCheckRow => Boolean(row));
  if (!rows.length) return null;
  const role = dominantRole(rows);
  return {
    key: spec.key,
    role,
    usage: hasFocus ? 'option_focus' : 'used',
    type: spec.type,
    status: 'checked',
    title: compactAuditTitle(spec, rows),
    claim: fullClaimText(spec.title),
    proof: spec.proof,
    icon: spec.icon ?? groupIcon(role),
    refs,
    rows: sortRows(rows),
    meta: auditSupportMeta(rows),
    freshness: freshestLabel(rows.map((row) => row.freshness)),
  };
}

function buildBackgroundSourceGroups(sources: BriefSource[]): EvidencePackItem[] {
  const groups = new Map<string, MutableEvidencePackItem>();
  for (const source of sources) {
    const classification = classifyEvidenceSource(source);
    const key = classification.groupKey;
    const row = evidenceRowForSource(source, classification);
    const current = groups.get(key);
    if (current) {
      current.rows.push(row);
    } else {
      groups.set(key, {
        key,
        role: classification.groupRole,
        usage: 'background',
        type: 'background',
        status: 'background',
        title: groupTitle(classification),
        claim: null,
        proof: groupProof(classification.groupRole),
        icon: groupIcon(classification.groupRole),
        rows: [row],
      });
    }
  }
  return [...groups.values()].map((item): EvidencePackItem => ({
    ...item,
    refs: uniqueSorted(item.rows.map((row) => row.refIndex)),
    rows: sortRows(item.rows),
    meta: summarizeItemMeta(item.rows),
    freshness: freshestLabel(item.rows.map((row) => row.freshness)),
  })).sort(compareItems);
}

function classification(
  source: BriefSource,
  role: EvidenceRole,
  groupRole: EvidenceRole,
  title: string,
  proof: string,
  icon: string,
  teamLabel: string | null,
): EvidenceSourceClassification {
  return {
    role,
    groupRole,
    groupKey: groupKeyFor(source, groupRole, teamLabel),
    title,
    proof,
    icon,
    teamLabel,
  };
}

function groupForAppData(source: BriefSource, teamLabel: string | null): EvidenceRole {
  return source.kind === 'ANALYST_DATA' ? 'current_team_data' : classifyNonAnalystGroup(source);
}

function classifyNonAnalystGroup(source: BriefSource): EvidenceRole {
  if (source.kind === 'CAP') return 'cap';
  if (source.kind === 'CONTRACT') return 'contract';
  return 'current_team_data';
}

function groupKeyFor(source: BriefSource, groupRole: EvidenceRole, teamLabel: string | null): string {
  if (groupRole === 'current_team_data') return `current_team_data:${teamLabel ?? 'brief'}`;
  if (groupRole === 'cba') return 'cba';
  if (groupRole === 'context') return `context:${teamLabel ?? source.ref_index}`;
  if (groupRole === 'supporting') return `supporting:${source.kind}:${source.source ?? 'unknown'}:${source.ref_index}`;
  return `${groupRole}:${teamLabel ?? source.source ?? source.ref_index}`;
}

function groupTitle(classification: EvidenceSourceClassification): string {
  if (classification.groupRole === 'current_team_data') {
    return classification.teamLabel ? `${classification.teamLabel} current team data` : 'Current team data';
  }
  return classification.title;
}

function groupProof(role: EvidenceRole): string {
  switch (role) {
    case 'current_team_data': return 'Confirms roster, cap posture, and player-stat baseline.';
    case 'roster': return 'Confirms active players, positions, and roster status.';
    case 'cap': return 'Shows payroll, salary guarantees, and constraint posture.';
    case 'stats': return 'Supports usage, efficiency, and role comparisons.';
    case 'cba': return 'Flags transaction-rule constraints that affect execution.';
    case 'context': return 'Adds strategic posture, priorities, and team context.';
    case 'contract': return 'Shows salary structure, guarantees, and contract-specific constraints.';
    case 'market': return 'Adds reporting, projection, or market context around the decision.';
    case 'supporting': return 'Supports the reasoning behind this answer.';
  }
}

function groupIcon(role: EvidenceRole): string {
  switch (role) {
    case 'current_team_data':
    case 'roster':
    case 'cap':
      return 'clipboard';
    case 'stats':
      return 'pulse';
    case 'cba':
      return 'shield';
    case 'context':
      return 'link';
    case 'market':
      return 'search';
    default:
      return 'doc';
  }
}

function evidenceRowForSource(source: BriefSource, classification: EvidenceSourceClassification): EvidenceCheckRow {
  return {
    key: `${source.id}-${source.ref_index}`,
    refIndex: source.ref_index,
    title: classification.title,
    proof: classification.proof,
    meta: sourceMeta(source),
    freshness: formatEvidenceFreshness(source),
    role: classification.role,
    teamLabel: classification.teamLabel,
    source,
  };
}

function sourceMeta(source: BriefSource): string {
  const rows = dataRows(source);
  const dataset = rowValue(rows, 'Dataset');
  const sourceName = rowValue(rows, 'Source') ?? source.source;
  const team = rowValue(rows, 'Team') ?? rowValue(rows, 'Teams');
  return [humanSource(sourceName), meaningful(dataset), meaningful(team)].filter(Boolean).join(' · ');
}

function humanSource(value: string | null | undefined): string | null {
  const raw = meaningful(value);
  if (!raw) return null;
  if (raw === 'GAMBIT_APP_DATA') return 'Gambit app data';
  if (raw === 'CBA REFERENCE') return 'CBA reference';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function teamLabelForSource(source: BriefSource, rows: { k: string; v: string }[]): string | null {
  const evidence = currentNbaEvidence(source);
  if (typeof evidence?.team_id === 'string') return evidence.team_id;

  const teamValue = rowValue(rows, 'Team') ?? rowValue(rows, 'Teams');
  const teamMatch = teamValue?.match(/\b[A-Z]{3}\b/);
  if (teamMatch) return teamMatch[0];

  const titleMatch = source.title.match(/\b[A-Z]{3}\b/);
  return titleMatch?.[0] ?? null;
}

function currentNbaEvidence(source: BriefSource): Record<string, unknown> | null {
  const data = source.data;
  if (!data || typeof data !== 'object') return null;
  const evidence = data.current_nba_evidence;
  return evidence && typeof evidence === 'object' ? evidence as Record<string, unknown> : null;
}

function dataRows(source: BriefSource): { k: string; v: string }[] {
  const data = source.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.rows)) return [];
  return data.rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const k = 'k' in row ? String(row.k) : null;
    const v = 'v' in row ? String(row.v) : null;
    return k && v ? [{ k, v }] : [];
  });
}

function rowValue(rows: { k: string; v: string }[], key: string): string | null {
  const row = rows.find((candidate) => candidate.k.toLowerCase() === key.toLowerCase());
  return row?.v ?? null;
}

function addPresentationRefs(refs: Set<number>, section: BriefPresentationSection) {
  if ('source_refs' in section) addRefs(refs, section.source_refs);
  if (section.kind === 'prose') {
    addBracketRefs(refs, section.body);
  } else if (section.kind === 'bullets') {
    for (const item of section.items) {
      addRefs(refs, item.source_refs);
      addBracketRefs(refs, item.body);
    }
  }
}

function addRefs(refs: Set<number>, values: number[] | undefined) {
  for (const value of values ?? []) {
    if (Number.isInteger(value) && value > 0) refs.add(value);
  }
}

function refsFromText(text: string | undefined): number[] {
  const refs = new Set<number>();
  addBracketRefs(refs, text);
  return uniqueSorted([...refs]);
}

function addBracketRefs(refs: Set<number>, text: string | undefined) {
  if (!text) return;
  const re = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    refs.add(Number(match[1]));
  }
}

function usefulOptionTitle(option: BriefOption, details: BriefOptionDetails): string {
  const question = meaningful(details.decision_question);
  if (question && !/should we pursue option/i.test(question)) return question;
  return option.title;
}

function auditProofForClaim(text: string): string {
  const body = cleanBodyText(text).toLowerCase();
  if (!body) return 'Backed by the cited evidence.';
  if (/\bunverified|cannot verify|premise|confirm|confirmed|refutation|source needed\b/.test(body)) {
    return 'Keeps the answer grounded in connected evidence.';
  }
  if (/\bcap|apron|salary|hard-capped|payroll|aggregation|matching\b/.test(body)) {
    return 'Tests execution under cap and matching rules.';
  }
  if (/\bpick|draft|stepien|asset|liquidity|first-round\b/.test(body)) {
    return 'Checks which future assets are movable.';
  }
  if (/\broster|player|usage|efficiency|stat|rotation\b/.test(body)) {
    return 'Grounds the basketball baseline.';
  }
  if (/\bcontext|priority|posture|contend|window\b/.test(body)) {
    return 'Adds team posture around the recommendation.';
  }
  return 'Supports this part of the current lean.';
}

function auditSupportMeta(rows: EvidenceCheckRow[]): string {
  if (!rows.length) return 'No source records';
  const roleText = friendlyRoleList(rows);
  const teams = uniqueStrings(rows.map((row) => row.teamLabel)).slice(0, 3).join(', ');
  return [teams, roleText].filter(Boolean).join(' · ');
}

function friendlyRoleList(rows: EvidenceCheckRow[]): string {
  const labels = uniqueStrings(rows.map((row) => roleMetaLabel(row.role)));
  return labels.slice(0, 4).join(', ');
}

function roleMetaLabel(role: EvidenceRole): string {
  switch (role) {
    case 'current_team_data': return 'roster/cap/stats';
    case 'roster': return 'roster';
    case 'cap': return 'cap';
    case 'stats': return 'player stats';
    case 'cba': return 'CBA';
    case 'context': return 'context';
    case 'contract': return 'contract';
    case 'market': return 'market';
    case 'supporting': return 'supporting';
  }
}

function statusChipsForItems(items: EvidencePackItem[]): string[] {
  const rows = items.flatMap((item) => item.rows);
  const chips: string[] = [];
  for (const row of rows) {
    const team = row.teamLabel;
    if (row.role === 'current_team_data' && team) chips.push(`${team} current data`);
    else if (row.role === 'cap' && team) chips.push(`${team} cap current`);
    else if (row.role === 'stats' && team) chips.push(`${team} stats checked`);
    else if (row.role === 'cba') chips.push('CBA trade rule linked');
    else if (row.role === 'context' && team) chips.push(`${team} context loaded`);
    else if (row.role === 'contract' && team) chips.push(`${team} contract checked`);
    else if (row.role === 'market') chips.push('Market signal checked');
  }
  return uniqueStrings(chips).slice(0, 6);
}

function subtitleForModel(
  hasFocus: boolean,
  selectedOptionRef: number | null,
  checkedCount: number,
  backgroundRefCount: number,
): string {
  if (hasFocus) {
    const scope = selectedOptionRef !== null ? `option [${selectedOptionRef}]` : 'focused refs';
    return `Audit: ${scope} · ${checkedCount} ${checkedCount === 1 ? 'check' : 'checks'}`;
  }
  return `Audit: ${checkedCount} ${checkedCount === 1 ? 'claim' : 'claims'} checked · ${backgroundRefCount} background refs`;
}

function dominantRole(rows: EvidenceCheckRow[]): EvidenceRole {
  if (!rows.length) return 'supporting';
  return [...rows].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))[0].role;
}

function refMapForItems(checkedItems: EvidencePackItem[], backgroundItems: EvidencePackItem[]): Record<number, string> {
  const refToItemKey: Record<number, string> = {};
  for (const item of checkedItems) {
    for (const ref of item.refs) {
      if (!refToItemKey[ref]) refToItemKey[ref] = item.key;
    }
  }
  for (const item of backgroundItems) {
    for (const ref of item.refs) {
      if (!refToItemKey[ref]) refToItemKey[ref] = item.key;
    }
  }
  return refToItemKey;
}

function uniqueSpecs(specs: AuditClaimSpec[]): AuditClaimSpec[] {
  const seen = new Set<string>();
  const result: AuditClaimSpec[] = [];
  for (const spec of specs) {
    const key = `${spec.title.toLowerCase()}|${spec.refs.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...spec, refs: uniqueSorted(spec.refs) });
  }
  return result.slice(0, 8);
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((a, b) => a - b);
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.map(meaningful).filter((value): value is string => Boolean(value)))];
}

function sortRows(rows: EvidenceCheckRow[]): EvidenceCheckRow[] {
  return rows.slice().sort((a, b) => {
    const roleCompare = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    return roleCompare || a.refIndex - b.refIndex;
  });
}

function compareItems(a: EvidencePackItem, b: EvidencePackItem): number {
  if (a.usage !== b.usage) return a.usage === 'background' ? 1 : -1;
  if (a.type !== b.type) return itemTypeOrder(a.type) - itemTypeOrder(b.type);
  const roleCompare = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
  return roleCompare || (a.refs[0] ?? 999) - (b.refs[0] ?? 999);
}

function itemTypeOrder(type: EvidenceItemType): number {
  switch (type) {
    case 'claim': return 0;
    case 'option': return 1;
    case 'background': return 3;
  }
}

function summarizeItemMeta(rows: EvidenceCheckRow[]): string {
  const parts = rows.flatMap((row) => row.meta.split(' · ')).filter(Boolean);
  return [...new Set(parts)].slice(0, 3).join(' · ');
}

function freshestLabel(labels: (string | null)[]): string | null {
  const useful = labels.map(meaningful).filter((label): label is string => Boolean(label));
  return useful[0] ?? null;
}

function compactAuditTitle(spec: AuditClaimSpec, rows: EvidenceCheckRow[]): string {
  if (spec.type === 'option') return compactOptionTitle(spec.title, rows);

  const body = `${cleanBodyText(spec.title)} ${cleanBodyText(spec.proof)}`.toLowerCase();
  const team = compactTeamPrefix(rows);
  if (/\bcba\b|trade rule|aggregation|salary-matching|salary matching|exception\b/.test(body)) {
    return `${team}trade-rule mechanics`.trim();
  }
  if (/\bapron|hard-capped|hard capped|payroll\b/.test(body)) {
    return `${team}apron position`.trim();
  }
  if (/\bsalary|contract|\$\d|curry|butler|green\b/.test(body)) {
    return `${team}salary stack`.trim();
  }
  if (/\bpick|draft|stepien|first-round|first round|asset\b/.test(body)) {
    return `${team}draft-pick flexibility`.trim();
  }
  if (/\broster|rotation|player|usage|efficiency|stat\b/.test(body)) {
    return `${team}player baseline`.trim();
  }
  if (/\bcontext|priority|posture|contend|window|direction\b/.test(body)) {
    return `${team}team posture`.trim();
  }

  const dominant = dominantRole(rows);
  if (dominant === 'cba') return 'CBA rule check';
  if (dominant === 'context') return `${team}team posture`.trim();
  if (dominant === 'cap' || dominant === 'current_team_data') return `${team}cap position`.trim();
  return clampHeadline(spec.title, 46);
}

function compactOptionTitle(title: string, rows: EvidenceCheckRow[]): string {
  const body = cleanBodyText(title).toLowerCase();
  const team = teamPrefixFromText(title) ?? compactTeamPrefix(rows);
  if (/\b2030\b.*\b(first|pick)\b|\b(first|pick)\b.*\b2030\b/.test(body)) {
    return `${team}2030 pick check`.trim();
  }
  if (/\bowe|owed|obligation|connection|premise|actually\b/.test(body)) {
    return `${team}premise check`.trim();
  }
  if (/\bcap|apron|salary|matching|payroll\b/.test(body)) {
    return `${team}cap hinge`.trim();
  }
  if (/\bprice|ask|cost|asset|sweetener\b/.test(body)) {
    return `${team}asset price`.trim();
  }
  return clampHeadline(title, 34);
}

function teamPrefixFromText(value: string): string | null {
  const match = value.match(/\b(ATL|BKN|BOS|CHA|CHI|CLE|DAL|DEN|DET|GSW|HOU|IND|LAC|LAL|MEM|MIA|MIL|MIN|NOP|NYK|OKC|ORL|PHI|PHX|POR|SAC|SAS|TOR|UTA|WAS)\b/);
  return match ? `${match[1]} ` : null;
}

function compactTeamPrefix(rows: EvidenceCheckRow[]): string {
  const teams = uniqueStrings(rows.map((row) => row.teamLabel));
  if (teams.length === 1) return `${teams[0]} `;
  if (teams.length === 2) return `${teams.join('/')} `;
  return '';
}

function fullClaimText(value: string): string | null {
  const claim = cleanBodyText(value);
  if (!claim || claim.length < 36) return null;
  return claim;
}

function clampHeadline(value: string, max: number): string {
  return clampText(cleanBodyText(value).replace(/^["']|["']$/g, ''), max);
}

function cleanClaimTitle(value: string): string {
  return clampText(cleanBodyText(value).replace(/^["']|["']$/g, ''), 120);
}

function cleanBodyText(value: string | undefined): string {
  return (value ?? '')
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  const truncated = value.slice(0, max - 1).trimEnd();
  const lastSpace = truncated.lastIndexOf(' ');
  return `${truncated.slice(0, lastSpace > 80 ? lastSpace : truncated.length)}...`;
}

function cleanTitle(title: string): string {
  return title
    .replace(/^App data\s*[·-]\s*/i, '')
    .replace(/current_/g, 'current ')
    .replace(/_/g, ' ')
    .trim();
}

function meaningful(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'unknown' || trimmed.startsWith('not required')) return null;
  return trimmed;
}
