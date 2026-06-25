import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  ContextGraphConfidence,
  ContextGraphWarRoomResponse,
  DeleteTeamMemoryResponse,
  GetTeamMemoryResponse,
  TeamMemoryAssessmentStatus,
  TeamMemoryCard,
  TeamMemoryCardKind,
  TeamMemoryGeneratedOption,
  TeamMemoryIntakeResponse,
  TeamMemoryInterviewSelection,
  TeamMemoryInterviewStage,
  TeamMemoryOptionsRequest,
  TeamMemoryOptionsResponse,
  TeamMemoryPlayerSignal,
  TeamMemoryProfile,
  TeamMemorySourceType,
  TeamMemoryTraceSummary,
  UpdateTeamMemoryResponse,
} from '@shared/types';
import { CHAT_MODEL, createClaudeMessage } from '../claude/client.js';
import { DEFAULT_TEAM_MEMORY_FILE } from './paths.js';
import { isNbaTeamId } from './schema.js';

export interface TeamMemoryStoreOptions {
  teamMemoryFile?: string;
  now?: () => Date;
}

export type TeamMemoryExtractionRunner = (request: {
  teamId: string;
  teamName: string;
  input: string;
}) => Promise<unknown>;

export type TeamMemoryOptionsRunner = (request: {
  teamId: string;
  teamName: string;
  warRoom: ContextGraphWarRoomResponse;
  stage: TeamMemoryInterviewStage;
  selections: TeamMemoryInterviewSelection[];
  traits: string[];
  acceptedOptions: TeamMemoryGeneratedOption[];
  note: string;
}) => Promise<unknown>;

interface TeamMemoryFile {
  schema_version: 1;
  updated_at: string | null;
  teams: Record<string, TeamMemoryProfile>;
}

interface RawExtraction {
  summary?: unknown;
  cards?: unknown;
  player_signals?: unknown;
  warnings?: unknown;
}

interface RawOptions {
  options?: unknown;
  follow_up_questions?: unknown;
  warnings?: unknown;
}

const EMPTY_TEAM_MEMORY_FILE: TeamMemoryFile = {
  schema_version: 1,
  updated_at: null,
  teams: {},
};

const PRIVACY_NOTE = 'Prototype-local private team memory. Subjective context from user review; not public evidence, not model training material, and not a raw transcript store.';
const COMPLETED_SECTIONS = ['roster_soft_context'];
const DEFERRED_SECTIONS = [
  'org_decision_context',
  'owner_risk_posture',
  'staff_workflows',
  'wnba_shared_org_needs',
  'security_boundaries',
];
const CARD_KINDS = new Set<TeamMemoryCardKind>([
  'player_soft_context',
  'pairing_context',
  'coach_gut_hypothesis',
  'roster_decision_context',
  'full_assessment_placeholder',
]);
const SOURCE_TYPES = new Set<TeamMemorySourceType>([
  'private_intake',
  'edited_by_user',
  'system_placeholder',
]);
const CONFIDENCE = new Set<ContextGraphConfidence>(['high', 'medium', 'low']);
const INTERVIEW_STAGES = new Set<TeamMemoryInterviewStage>(['player', 'pairing', 'decision', 'room_belief']);

export async function getTeamMemoryResponse(
  teamIdInput: string,
  options: TeamMemoryStoreOptions = {},
): Promise<GetTeamMemoryResponse> {
  return { profile: await getTeamMemoryProfile(teamIdInput, options) };
}

export async function getTeamMemoryProfile(
  teamIdInput: string,
  options: TeamMemoryStoreOptions = {},
): Promise<TeamMemoryProfile | null> {
  const teamId = normalizeTeamId(teamIdInput);
  const file = await loadTeamMemoryFile(options);
  return file.teams[teamId] ? deepClone(file.teams[teamId]) : null;
}

export async function buildTeamMemoryIntake(
  teamIdInput: string,
  teamName: string,
  input: string,
  options: TeamMemoryStoreOptions & { extractor?: TeamMemoryExtractionRunner } = {},
): Promise<TeamMemoryIntakeResponse> {
  const teamId = normalizeTeamId(teamIdInput);
  const trimmed = input.trim();
  if (trimmed.length < 40) throw new Error('team memory intake input must be at least 40 characters.');

  const extraction = options.extractor
    ? await options.extractor({ teamId, teamName, input: trimmed })
    : await extractTeamMemoryWithClaude({ teamId, teamName, input: trimmed });
  const normalized = normalizeTeamMemoryProfile(teamId, teamName, extraction, {
    ...options,
    status: 'draft',
    sourceLabel: 'Tell me about your team intake',
  });
  const warnings = arrayOfStrings((extraction as RawExtraction | null)?.warnings).slice(0, 6);
  if (normalized.cards.filter((card) => card.kind !== 'full_assessment_placeholder').length === 0) {
    warnings.push('No roster soft-context cards were extracted; add more specific player, pairing, or coach-gut context.');
  }

  return {
    profile: normalized,
    discarded_raw_input_chars: trimmed.length,
    warnings,
  };
}

export async function buildTeamMemoryOptions(
  teamIdInput: string,
  warRoom: ContextGraphWarRoomResponse,
  request: TeamMemoryOptionsRequest,
  options: TeamMemoryStoreOptions & { generator?: TeamMemoryOptionsRunner } = {},
): Promise<TeamMemoryOptionsResponse> {
  const teamId = normalizeTeamId(teamIdInput);
  if (!warRoom || warRoom.subject.team_id !== teamId) {
    throw new Error(`team memory options require War Room context for ${teamId}.`);
  }
  const normalizedRequest = normalizeOptionsRequest(request);
  const generatorRequest = {
    teamId,
    teamName: warRoom.subject.name,
    warRoom,
    stage: normalizedRequest.stage,
    selections: normalizedRequest.selections,
    traits: normalizedRequest.traits,
    acceptedOptions: normalizedRequest.accepted_options,
    note: normalizedRequest.note ?? '',
  };
  const raw = options.generator
    ? await options.generator(generatorRequest)
    : await generateTeamMemoryOptionsWithClaude(generatorRequest);
  return normalizeOptionsResponse(raw, normalizedRequest);
}

export async function saveTeamMemoryProfile(
  teamIdInput: string,
  profile: TeamMemoryProfile,
  options: TeamMemoryStoreOptions = {},
): Promise<UpdateTeamMemoryResponse> {
  const teamId = normalizeTeamId(teamIdInput);
  if (!profile || typeof profile !== 'object') throw new Error('team memory profile object required.');
  if (profile.team_id !== teamId) throw new Error(`team memory profile team_id must be ${teamId}.`);

  const normalized = normalizeTeamMemoryProfile(teamId, profile.team_name || teamId, profile, {
    ...options,
    status: 'active',
    sourceLabel: profile.source_label || 'Reviewed team memory',
    createdAt: profile.created_at,
  });
  const file = await loadTeamMemoryFile(options);
  const updatedAt = normalized.updated_at;
  file.updated_at = updatedAt;
  file.teams[teamId] = normalized;
  await writeTeamMemoryFile(file, options);
  return { profile: deepClone(normalized) };
}

export async function deleteTeamMemoryProfile(
  teamIdInput: string,
  options: TeamMemoryStoreOptions = {},
): Promise<DeleteTeamMemoryResponse> {
  const teamId = normalizeTeamId(teamIdInput);
  const file = await loadTeamMemoryFile(options);
  delete file.teams[teamId];
  file.updated_at = nowIso(options);
  await writeTeamMemoryFile(file, options);
  return { profile: null };
}

export function teamMemoryTraceSummary(profile: TeamMemoryProfile | null): TeamMemoryTraceSummary | null {
  if (!profile || profile.cards.length === 0) return null;
  const cards = profile.cards.filter((card) => card.kind !== 'full_assessment_placeholder');
  return {
    status: profile.status,
    updated_at: profile.updated_at,
    card_count: cards.length,
    player_signal_count: profile.player_signals.length,
    summary: profile.summary,
    snippets: cards.slice(0, 6).map((card) => `${card.title}: ${card.body}`),
  };
}

export function normalizeTeamMemoryProfile(
  teamIdInput: string,
  teamName: string,
  raw: unknown,
  options: TeamMemoryStoreOptions & {
    status?: TeamMemoryAssessmentStatus;
    sourceLabel?: string;
    createdAt?: string;
    updatedAt?: string;
  } = {},
): TeamMemoryProfile {
  const teamId = normalizeTeamId(teamIdInput);
  const record = isRecord(raw) ? raw : {};
  const existing = isTeamMemoryProfile(record) ? record : null;
  const timestamp = options.updatedAt || nowIso(options);
  const cards = [
    ...coerceCards(record.cards, timestamp),
  ];
  const playerSignals = coercePlayerSignals(record.player_signals ?? record.playerSignals);
  const cardsWithPlaceholder = ensureFullAssessmentPlaceholder(cards, timestamp);

  return {
    schema_version: 1,
    team_id: teamId,
    team_name: nonEmptyString(record.team_name) || teamName || teamId,
    status: options.status ?? coerceStatus(record.status) ?? existing?.status ?? 'draft',
    created_at: options.createdAt || nonEmptyString(record.created_at) || timestamp,
    updated_at: timestamp,
    source_label: options.sourceLabel || nonEmptyString(record.source_label) || 'Reviewed team memory',
    privacy_note: PRIVACY_NOTE,
    summary: clip(nonEmptyString(record.summary) || summarizeCards(cardsWithPlaceholder), 700),
    cards: cardsWithPlaceholder,
    player_signals: playerSignals,
    completed_sections: arrayOfStrings(record.completed_sections).length
      ? arrayOfStrings(record.completed_sections)
      : COMPLETED_SECTIONS,
    deferred_sections: arrayOfStrings(record.deferred_sections).length
      ? arrayOfStrings(record.deferred_sections)
      : DEFERRED_SECTIONS,
  };
}

async function extractTeamMemoryWithClaude(request: {
  teamId: string;
  teamName: string;
  input: string;
}): Promise<RawExtraction> {
  const response = await createClaudeMessage({
    model: CHAT_MODEL,
    max_tokens: 4096,
    system: TEAM_MEMORY_EXTRACTION_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `Team: ${request.teamName} (${request.teamId})`,
          '',
          'Roster download:',
          request.input,
        ].join('\n'),
      },
    ],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('team memory extraction returned no text.');
  return parseJsonObject(text);
}

async function generateTeamMemoryOptionsWithClaude(request: {
  teamId: string;
  teamName: string;
  warRoom: ContextGraphWarRoomResponse;
  stage: TeamMemoryInterviewStage;
  selections: TeamMemoryInterviewSelection[];
  traits: string[];
  acceptedOptions: TeamMemoryGeneratedOption[];
  note: string;
}): Promise<RawOptions> {
  const response = await createClaudeMessage({
    model: CHAT_MODEL,
    max_tokens: 3072,
    system: TEAM_MEMORY_OPTIONS_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `Team: ${request.teamName} (${request.teamId})`,
          `Active stage: ${request.stage}`,
          '',
          'Selection state JSON:',
          JSON.stringify({
            selections: request.selections,
            traits: request.traits,
            accepted_options: request.acceptedOptions,
            optional_note: request.note,
          }, null, 2),
          '',
          'Compact War Room context JSON:',
          JSON.stringify(compactWarRoomForOptions(request.warRoom), null, 2),
        ].join('\n'),
      },
    ],
  });
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('team memory option generation returned no text.');
  return parseJsonObject(text);
}

const TEAM_MEMORY_EXTRACTION_SYSTEM = `You extract private NFL team memory from a front-office user's natural-language roster download.

Return ONLY valid JSON. No markdown, no comments, no surrounding prose.

Schema:
{
  "summary": "one concise paragraph",
  "cards": [
    {
      "kind": "player_soft_context" | "pairing_context" | "coach_gut_hypothesis" | "roster_decision_context",
      "title": "short card title",
      "body": "what should be remembered, framed as subjective private context",
      "confidence": "high" | "medium" | "low",
      "evidence_snippet": "short snippet or paraphrase from the intake, not a full transcript",
      "player_names": ["optional player names"],
      "tags": ["glue", "leadership", "toughness", "pairing", "coach gut", "decision window"],
      "measurable_proxies": ["stats, film tags, lineup checks, or questions analysts could test"]
    }
  ],
  "player_signals": [
    {
      "player_name": "player",
      "role": "private soft-role description",
      "soft_traits": ["trait"],
      "context": "where this matters",
      "confidence": "high" | "medium" | "low",
      "evidence_snippet": "short snippet or paraphrase",
      "measurable_proxies": ["how to test or monitor"]
    }
  ],
  "warnings": ["uncertainty or missing context"]
}

Rules:
- Treat the content as subjective private user context, not public fact.
- Preserve uncertainty. Use low confidence when the user is speculating or when context is thin.
- Prefer roster soft context: glue players, leadership, toughness, chemistry, pairings, coach/player gut reads, and what public data misses.
- Include roster-decision context only when the intake mentions locked spots, open spots, cuts, camp, draft, or evaluation windows.
- Do not store the full raw transcript. Evidence snippets must be short.`;

const TEAM_MEMORY_OPTIONS_SYSTEM = `You generate selectable private-memory hypotheses for an NFL front-office onboarding prototype.

Return ONLY valid JSON. No markdown, no comments, no prose.

Schema:
{
  "options": [
    {
      "stage": "player" | "pairing" | "decision" | "room_belief",
      "title": "short option title",
      "body": "subjective memory hypothesis the user may accept or edit",
      "confidence": "high" | "medium" | "low",
      "player_names": ["optional player names"],
      "tags": ["glue", "toughness", "leadership", "screening", "coach gut"],
      "measurable_proxies": ["stats, film tags, lineup checks, or staff questions to test"],
      "caveat": "why this remains subjective/private or what is still missing",
      "follow_up_questions": ["short selectable next question"]
    }
  ],
  "follow_up_questions": ["2-4 short follow-up question options"],
  "warnings": ["uncertainty or missing context"]
}

Rules:
- Generate 3 to 5 options that feel clickable and specific, not generic.
- Use War Room roster/decision/tension context and the user's current selections.
- Treat output as subjective private team memory, not public fact.
- Never say the private hypothesis overrides public roster, cap, or stat evidence.
- Prefer concise hypothesis cards Michael can accept, dismiss, or edit.`;

function coerceCards(value: unknown, timestamp: string): TeamMemoryCard[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((card, index) => {
      const kind = coerceCardKind(card.kind);
      const title = clip(nonEmptyString(card.title) || defaultTitle(kind), 120);
      const body = clip(nonEmptyString(card.body) || nonEmptyString(card.detail), 900);
      if (!body) return null;
      return {
        id: nonEmptyString(card.id) || stableId(kind, title, index),
        kind,
        title,
        body,
        confidence: coerceConfidence(card.confidence),
        evidence_snippet: clip(nonEmptyString(card.evidence_snippet) || nonEmptyString(card.evidence) || body, 260),
        source_type: coerceSourceType(card.source_type),
        player_names: arrayOfStrings(card.player_names).slice(0, 6),
        tags: arrayOfStrings(card.tags).slice(0, 8),
        measurable_proxies: arrayOfStrings(card.measurable_proxies).slice(0, 8),
        updated_at: nonEmptyString(card.updated_at) || timestamp,
      } satisfies TeamMemoryCard;
    })
    .filter((card) => card !== null)
    .slice(0, 20);
}

function coercePlayerSignals(value: unknown): TeamMemoryPlayerSignal[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((signal, index) => {
      const playerName = clip(nonEmptyString(signal.player_name) || nonEmptyString(signal.playerName), 120);
      if (!playerName) return null;
      return {
        id: nonEmptyString(signal.id) || stableId('player', playerName, index),
        player_name: playerName,
        role: clip(nonEmptyString(signal.role) || 'private soft-context signal', 160),
        soft_traits: arrayOfStrings(signal.soft_traits).slice(0, 8),
        context: clip(nonEmptyString(signal.context), 500),
        confidence: coerceConfidence(signal.confidence),
        evidence_snippet: clip(nonEmptyString(signal.evidence_snippet) || nonEmptyString(signal.evidence), 260),
        measurable_proxies: arrayOfStrings(signal.measurable_proxies).slice(0, 8),
      } satisfies TeamMemoryPlayerSignal;
    })
    .filter((signal) => signal !== null)
    .slice(0, 24);
}

function ensureFullAssessmentPlaceholder(cards: TeamMemoryCard[], timestamp: string): TeamMemoryCard[] {
  if (cards.some((card) => card.kind === 'full_assessment_placeholder')) return cards;
  return [
    ...cards,
    {
      id: 'continue-full-team-assessment',
      kind: 'full_assessment_placeholder',
      title: 'Continue full team assessment',
      body: 'Deeper intake can capture org decision context, owner and risk posture, staff workflows, WNBA/shared-org needs, and security boundaries.',
      confidence: 'high',
      evidence_snippet: 'Deferred section, not extracted from private context yet.',
      source_type: 'system_placeholder',
      player_names: [],
      tags: ['deeper_assessment'],
      measurable_proxies: [],
      updated_at: timestamp,
    },
  ];
}

function normalizeOptionsRequest(request: TeamMemoryOptionsRequest): TeamMemoryOptionsRequest {
  if (!isRecord(request)) throw new Error('team memory options request object required.');
  const stage = coerceInterviewStage(request.stage);
  if (!stage) throw new Error('valid team memory interview stage required.');
  return {
    stage,
    selections: coerceSelections(request.selections).slice(0, 12),
    traits: arrayOfStrings(request.traits).slice(0, 12),
    accepted_options: coerceGeneratedOptions(request.accepted_options, stage).slice(0, 12),
    note: clip(nonEmptyString(request.note), 500),
  };
}

function normalizeOptionsResponse(raw: unknown, request: TeamMemoryOptionsRequest): TeamMemoryOptionsResponse {
  const record = isRecord(raw) ? raw : {};
  const options = coerceGeneratedOptions(record.options, request.stage);
  const normalizedOptions = options.length > 0 ? options : fallbackGeneratedOptions(request);
  const optionQuestions = normalizedOptions.flatMap((option) => option.follow_up_questions);
  return {
    options: normalizedOptions.slice(0, 5),
    follow_up_questions: [
      ...arrayOfStrings(record.follow_up_questions),
      ...optionQuestions,
    ].filter((question, index, values) => values.indexOf(question) === index).slice(0, 5),
    warnings: arrayOfStrings(record.warnings).slice(0, 5),
  };
}

function coerceGeneratedOptions(value: unknown, fallbackStage: TeamMemoryInterviewStage): TeamMemoryGeneratedOption[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((option, index) => {
      const stage = coerceInterviewStage(option.stage) ?? fallbackStage;
      const title = clip(nonEmptyString(option.title) || defaultOptionTitle(stage), 120);
      const body = clip(nonEmptyString(option.body) || nonEmptyString(option.detail), 800);
      if (!body) return null;
      return {
        id: nonEmptyString(option.id) || stableId(`option-${stage}`, title, index),
        stage,
        title,
        body,
        confidence: coerceConfidence(option.confidence),
        player_names: arrayOfStrings(option.player_names).slice(0, 6),
        tags: arrayOfStrings(option.tags).slice(0, 8),
        measurable_proxies: arrayOfStrings(option.measurable_proxies).slice(0, 8),
        caveat: clip(nonEmptyString(option.caveat) || 'Subjective private context; verify against public and internal evidence before using in a decision.', 260),
        follow_up_questions: arrayOfStrings(option.follow_up_questions).slice(0, 4),
      } satisfies TeamMemoryGeneratedOption;
    })
    .filter((option) => option !== null)
    .slice(0, 8);
}

function coerceSelections(value: unknown): TeamMemoryInterviewSelection[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((selection, index) => {
      const stage = coerceInterviewStage(selection.stage);
      const label = clip(nonEmptyString(selection.label) || nonEmptyString(selection.title), 140);
      if (!stage || !label) return null;
      return {
        id: nonEmptyString(selection.id) || stableId(`selection-${stage}`, label, index),
        stage,
        label,
        detail: clip(nonEmptyString(selection.detail) || nonEmptyString(selection.body), 700),
        source: coerceSelectionSource(selection.source),
        player_names: arrayOfStrings(selection.player_names).slice(0, 6),
        tags: arrayOfStrings(selection.tags).slice(0, 8),
      } satisfies TeamMemoryInterviewSelection;
    })
    .filter((selection): selection is TeamMemoryInterviewSelection => selection !== null);
}

function fallbackGeneratedOptions(request: TeamMemoryOptionsRequest): TeamMemoryGeneratedOption[] {
  const selected = request.selections[0];
  const traitText = request.traits.length > 0 ? request.traits.slice(0, 4).join(', ') : 'soft context';
  const label = selected?.label ?? defaultOptionTitle(request.stage);
  const detail = selected?.detail || request.note || `The room may value ${label} differently than public evidence captures.`;
  return [{
    id: stableId(`option-${request.stage}`, label, 0),
    stage: request.stage,
    title: `Pressure-test ${label}`,
    body: `Capture whether ${detail} reflects private team context around ${traitText}, then test the hypothesis against current roster, lineup, and film evidence.`,
    confidence: 'low',
    player_names: selected?.player_names ?? [],
    tags: [...new Set([...request.traits, ...(selected?.tags ?? [])])].slice(0, 8),
    measurable_proxies: defaultMeasurableProxies(request.stage),
    caveat: 'Generated as a fallback from selected context; user should edit before saving.',
    follow_up_questions: defaultFollowUps(request.stage),
  }];
}

function compactWarRoomForOptions(warRoom: ContextGraphWarRoomResponse): Record<string, unknown> {
  return {
    subject: {
      team_id: warRoom.subject.team_id,
      name: warRoom.subject.name,
      posture: warRoom.subject.preferences.strategic_posture.timeframe,
      spending_posture: warRoom.subject.preferences.ownership.spending_posture,
    },
    roster_pressure: warRoom.roster_pressure.slice(0, 10).map((player) => ({
      name: player.name,
      tier: player.tier,
      movement_status: player.movement_status,
      availability_status: player.availability_status,
      trajectory: player.trajectory,
      action: player.action,
      rationale: player.rationale,
    })),
    decision_cards: warRoom.executive_summary.decision_cards.map((card) => ({
      title: card.title,
      signal: card.signal,
      recommendation: card.recommendation,
      action: card.action,
      severity: card.severity,
    })),
    strategic_tensions: warRoom.strategic_tensions.map((tension) => ({
      title: tension.title,
      signal: tension.signal,
      why_it_matters: tension.why_it_matters,
      winger_question: tension.winger_question,
      severity: tension.severity,
    })),
    top_calls: warRoom.executive_summary.top_calls.slice(0, 5).map((call) => ({
      name: call.name,
      priority: call.priority,
      trade_lane: call.trade_lane,
      caveats: call.caveats,
    })),
  };
}

async function loadTeamMemoryFile(options: TeamMemoryStoreOptions): Promise<TeamMemoryFile> {
  const filePath = options.teamMemoryFile ?? DEFAULT_TEAM_MEMORY_FILE;
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<TeamMemoryFile>;
    if (parsed.schema_version !== 1 || !isRecord(parsed.teams)) return deepClone(EMPTY_TEAM_MEMORY_FILE);
    return {
      schema_version: 1,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : null,
      teams: Object.fromEntries(
        Object.entries(parsed.teams)
          .filter(([teamId]) => isNbaTeamId(teamId))
          .map(([teamId, profile]) => [teamId, normalizeTeamMemoryProfile(teamId, teamId, profile, {
            ...options,
            status: isRecord(profile) ? coerceStatus(profile.status) ?? 'active' : 'active',
            createdAt: isRecord(profile) ? nonEmptyString(profile.created_at) : undefined,
            updatedAt: isRecord(profile) ? nonEmptyString(profile.updated_at) : undefined,
          })]),
      ),
    };
  } catch (error) {
    if (isMissingFileError(error)) return deepClone(EMPTY_TEAM_MEMORY_FILE);
    throw error;
  }
}

async function writeTeamMemoryFile(file: TeamMemoryFile, options: TeamMemoryStoreOptions): Promise<void> {
  const filePath = options.teamMemoryFile ?? DEFAULT_TEAM_MEMORY_FILE;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`);
}

function parseJsonObject(text: string): RawExtraction {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(trimmed) as unknown;
  if (!isRecord(parsed)) throw new Error('team memory extraction JSON must be an object.');
  return parsed;
}

function normalizeTeamId(teamIdInput: string): string {
  const teamId = String(teamIdInput ?? '').trim().toUpperCase();
  if (!isNbaTeamId(teamId)) throw new Error(`Unknown Intel team_id ${teamId}.`);
  return teamId;
}

function coerceCardKind(value: unknown): TeamMemoryCardKind {
  const kind = String(value ?? '').trim();
  return CARD_KINDS.has(kind as TeamMemoryCardKind) ? kind as TeamMemoryCardKind : 'player_soft_context';
}

function coerceSourceType(value: unknown): TeamMemorySourceType {
  const sourceType = String(value ?? '').trim();
  return SOURCE_TYPES.has(sourceType as TeamMemorySourceType) ? sourceType as TeamMemorySourceType : 'private_intake';
}

function coerceConfidence(value: unknown): ContextGraphConfidence {
  const confidence = String(value ?? '').trim();
  return CONFIDENCE.has(confidence as ContextGraphConfidence) ? confidence as ContextGraphConfidence : 'low';
}

function coerceStatus(value: unknown): TeamMemoryAssessmentStatus | null {
  if (value === 'not_started' || value === 'draft' || value === 'active') return value;
  return null;
}

function coerceInterviewStage(value: unknown): TeamMemoryInterviewStage | null {
  const stage = String(value ?? '').trim();
  return INTERVIEW_STAGES.has(stage as TeamMemoryInterviewStage) ? stage as TeamMemoryInterviewStage : null;
}

function coerceSelectionSource(value: unknown): TeamMemoryInterviewSelection['source'] {
  if (value === 'war_room' || value === 'saved_memory' || value === 'generated_option' || value === 'user') return value;
  return 'user';
}

function defaultTitle(kind: TeamMemoryCardKind): string {
  if (kind === 'pairing_context') return 'Player pairing context';
  if (kind === 'coach_gut_hypothesis') return 'Coach gut hypothesis';
  if (kind === 'roster_decision_context') return 'Roster decision context';
  if (kind === 'full_assessment_placeholder') return 'Continue full team assessment';
  return 'Player soft context';
}

function defaultOptionTitle(stage: TeamMemoryInterviewStage): string {
  if (stage === 'pairing') return 'Pairing hypothesis';
  if (stage === 'decision') return 'Roster decision hypothesis';
  if (stage === 'room_belief') return 'Room belief hypothesis';
  return 'Player soft-context hypothesis';
}

function defaultMeasurableProxies(stage: TeamMemoryInterviewStage): string[] {
  if (stage === 'pairing') return ['lineup net rating', 'screen assists', 'entry-pass turnovers', 'film tags'];
  if (stage === 'decision') return ['rotation minutes', 'replacement options', 'contract leverage', 'coach trust notes'];
  if (stage === 'room_belief') return ['staff notes', 'player comments', 'film-review tags', 'model disagreement review'];
  return ['lineup stability', 'teammate comments', 'coach trust notes', 'practice participation'];
}

function defaultFollowUps(stage: TeamMemoryInterviewStage): string[] {
  if (stage === 'pairing') return ['What action makes this pairing work?', 'What would disprove the fit?'];
  if (stage === 'decision') return ['What decision deadline matters?', 'What would change the roster call?'];
  if (stage === 'room_belief') return ['Who in the room believes this?', 'What public model misses it?'];
  return ['Where does this player create hidden value?', 'Who would disagree with this read?'];
}

function summarizeCards(cards: TeamMemoryCard[]): string {
  const liveCards = cards.filter((card) => card.kind !== 'full_assessment_placeholder');
  if (liveCards.length === 0) return 'No reviewed private roster context has been captured yet.';
  return liveCards.slice(0, 3).map((card) => card.title).join('; ');
}

function stableId(prefix: string, label: string, index: number): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'memory';
  return `${prefix}-${slug}-${index + 1}`;
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trim()}...` : value;
}

function nowIso(options: TeamMemoryStoreOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function isTeamMemoryProfile(value: unknown): value is TeamMemoryProfile {
  return isRecord(value) && value.schema_version === 1 && typeof value.team_id === 'string' && Array.isArray(value.cards);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
