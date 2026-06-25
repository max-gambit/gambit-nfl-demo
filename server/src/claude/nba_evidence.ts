import type { BriefSource, DataAnalystTrace, EffectiveTeamContext } from '@shared/types';
import {
  getEffectiveTeamContext,
  type TeamPreferenceStoreOptions,
} from '../context_graph/preferences.js';
import { db } from '../db/client.js';
import type {
  CurrentCapSheetPlayerRowRecord,
  CurrentCapSheetSalaryCellRow,
  CurrentCapSheetViewRow,
} from '../nba_cap_sheets/seed.js';
import type { CurrentPlayerStatViewRow } from '../nba_player_stats/seed.js';
import type { CurrentRosterViewRow } from '../nba_rosters/seed.js';

export type CurrentNbaEvidenceScope = 'roster_only' | 'transaction_full';

const TRANSACTION_NBA_EVIDENCE_RE =
  /\b(3-team|three-team|three team|multi-team|trade|trades|trading|acquire|acquisition|send|sending|receive|salary|cap|apron|tax|contract|contracts|extension|extensions|free agent|free agency|sign-and-trade|sign and trade|bird rights|mle|aggregate salaries?)\b/i;

const ROSTER_NBA_EVIDENCE_RE =
  /\b(roster|current players?|current .{0,40} players?|still have|do we have|who do we have|on our team|team members?|player-team membership|guards?|wings?|bigs?|centers?|depth chart|lineups?|starting lineup|rotation|starters?|backups?|two-way|two way|active roster)\b/i;

export const DEFAULT_NBA_EVIDENCE_TEAM_ID = 'GSW';

const NBA_EVIDENCE_TEAM_IDS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
] as const;

type NbaEvidenceTeamId = typeof NBA_EVIDENCE_TEAM_IDS[number];

const NBA_EVIDENCE_TEAM_ID_SET = new Set<string>(NBA_EVIDENCE_TEAM_IDS);

const NBA_EVIDENCE_TEAM_ALIASES: Record<string, NbaEvidenceTeamId> = {
  ATL: 'ATL', HAWKS: 'ATL', ATLANTA: 'ATL', 'ATLANTA HAWKS': 'ATL',
  BOS: 'BOS', CELTICS: 'BOS', BOSTON: 'BOS', 'BOSTON CELTICS': 'BOS',
  BKN: 'BKN', NETS: 'BKN', BROOKLYN: 'BKN', 'BROOKLYN NETS': 'BKN',
  CHA: 'CHA', HORNETS: 'CHA', CHARLOTTE: 'CHA', 'CHARLOTTE HORNETS': 'CHA',
  CHI: 'CHI', BULLS: 'CHI', CHICAGO: 'CHI', 'CHICAGO BULLS': 'CHI',
  CLE: 'CLE', CAVALIERS: 'CLE', CAVS: 'CLE', CLEVELAND: 'CLE', 'CLEVELAND CAVALIERS': 'CLE',
  DAL: 'DAL', MAVERICKS: 'DAL', MAVS: 'DAL', DALLAS: 'DAL', 'DALLAS MAVERICKS': 'DAL',
  DEN: 'DEN', NUGGETS: 'DEN', DENVER: 'DEN', 'DENVER NUGGETS': 'DEN',
  DET: 'DET', PISTONS: 'DET', DETROIT: 'DET', 'DETROIT PISTONS': 'DET',
  GSW: 'GSW', WARRIORS: 'GSW', 'GOLDEN STATE': 'GSW', 'GOLDEN STATE WARRIORS': 'GSW',
  HOU: 'HOU', ROCKETS: 'HOU', HOUSTON: 'HOU', 'HOUSTON ROCKETS': 'HOU',
  IND: 'IND', PACERS: 'IND', INDIANA: 'IND', 'INDIANA PACERS': 'IND',
  LAC: 'LAC', CLIPPERS: 'LAC', 'LA CLIPPERS': 'LAC', 'LOS ANGELES CLIPPERS': 'LAC',
  LAL: 'LAL', LAKERS: 'LAL', 'LOS ANGELES LAKERS': 'LAL',
  MEM: 'MEM', GRIZZLIES: 'MEM', MEMPHIS: 'MEM', 'MEMPHIS GRIZZLIES': 'MEM',
  MIA: 'MIA', HEAT: 'MIA', MIAMI: 'MIA', 'MIAMI HEAT': 'MIA',
  MIL: 'MIL', BUCKS: 'MIL', MILWAUKEE: 'MIL', 'MILWAUKEE BUCKS': 'MIL',
  MIN: 'MIN', TIMBERWOLVES: 'MIN', WOLVES: 'MIN', MINNESOTA: 'MIN', 'MINNESOTA TIMBERWOLVES': 'MIN',
  NOP: 'NOP', PELICANS: 'NOP', 'NEW ORLEANS': 'NOP', 'NEW ORLEANS PELICANS': 'NOP',
  NYK: 'NYK', KNICKS: 'NYK', 'NEW YORK KNICKS': 'NYK',
  OKC: 'OKC', THUNDER: 'OKC', OKLAHOMA: 'OKC', 'OKLAHOMA CITY': 'OKC', 'OKLAHOMA CITY THUNDER': 'OKC',
  ORL: 'ORL', MAGIC: 'ORL', ORLANDO: 'ORL', 'ORLANDO MAGIC': 'ORL',
  PHI: 'PHI', SIXERS: 'PHI', '76ERS': 'PHI', PHILADELPHIA: 'PHI', 'PHILADELPHIA 76ERS': 'PHI',
  PHX: 'PHX', SUNS: 'PHX', PHOENIX: 'PHX', 'PHOENIX SUNS': 'PHX',
  POR: 'POR', BLAZERS: 'POR', PORTLAND: 'POR', 'PORTLAND TRAIL BLAZERS': 'POR', 'TRAIL BLAZERS': 'POR',
  SAC: 'SAC', KINGS: 'SAC', SACRAMENTO: 'SAC', 'SACRAMENTO KINGS': 'SAC',
  SAS: 'SAS', SPURS: 'SAS', 'SAN ANTONIO': 'SAS', 'SAN ANTONIO SPURS': 'SAS',
  TOR: 'TOR', RAPTORS: 'TOR', TORONTO: 'TOR', 'TORONTO RAPTORS': 'TOR',
  UTA: 'UTA', JAZZ: 'UTA', UTAH: 'UTA', 'UTAH JAZZ': 'UTA',
  WAS: 'WAS', WIZARDS: 'WAS', WASHINGTON: 'WAS', 'WASHINGTON WIZARDS': 'WAS',
};

export class AppDataRequiredError extends Error {
  readonly code = 'app_data_required';

  constructor(message: string) {
    super(`app_data_required: ${message}`);
    this.name = 'AppDataRequiredError';
  }
}

export interface CurrentNbaEvidenceContextTeam {
  team_id: string;
  name: string;
  validation_status: 'pass' | 'fail';
  source_as_of_date: string | null;
  source_last_updated: string | null;
  strategic_posture: string | null;
  trade_dna: string | null;
  near_term_priorities: string[];
  relationship_notes: string[];
  source_roster_names: string[];
}

export interface CurrentNbaEvidenceDataSource {
  rosterRows(teamIds: string[]): Promise<CurrentRosterViewRow[]>;
  capSheetRows(teamIds: string[]): Promise<CurrentCapSheetViewRow[]>;
  capPlayerRows(teamIds: string[]): Promise<CurrentCapSheetPlayerRowRecord[]>;
  salaryCells(teamIds: string[]): Promise<CurrentCapSheetSalaryCellRow[]>;
  playerStats(teamIds: string[]): Promise<CurrentPlayerStatViewRow[]>;
  contextTeams(teamIds: string[]): Promise<CurrentNbaEvidenceContextTeam[]>;
}

export interface CurrentNbaEvidenceOptions {
  teamIds?: string[];
  scope?: CurrentNbaEvidenceScope;
  consumer?: 'brief' | 'chat';
  dataSource?: CurrentNbaEvidenceDataSource;
  contextGraphOptions?: TeamPreferenceStoreOptions;
}

export interface CurrentNbaEvidenceConflict {
  team_id: string;
  source: 'context_graph_roster';
  names: string[];
}

export interface CurrentNbaEvidencePack {
  team_ids: string[];
  scope: CurrentNbaEvidenceScope;
  systemBlock: string;
  sources: Omit<BriefSource, 'id' | 'brief_id'>[];
  conflicts: CurrentNbaEvidenceConflict[];
  reserved_max_ref_index: number;
}

interface TeamEvidence {
  team_id: string;
  scope: CurrentNbaEvidenceScope;
  rosterRows: CurrentRosterViewRow[];
  capSheet: CurrentCapSheetViewRow | null;
  capPlayerRows: CurrentCapSheetPlayerRowRecord[];
  salaryCells: CurrentCapSheetSalaryCellRow[];
  playerStats: CurrentPlayerStatViewRow[];
  contextTeam: CurrentNbaEvidenceContextTeam | null;
  conflictNames: string[];
  appRefIndex: number;
  contextRefIndex: number;
}

export function requiresCurrentNbaEvidence(question: string): boolean {
  return hasCurrentNbaEvidenceTrigger(question) && extractNbaTeamIds(question).length > 0;
}

export function hasCurrentNbaEvidenceTrigger(question: string): boolean {
  return currentNbaEvidenceScopeForQuestion(question) !== null;
}

export function currentNbaEvidenceScopeForQuestion(question: string): CurrentNbaEvidenceScope | null {
  if (TRANSACTION_NBA_EVIDENCE_RE.test(question)) return 'transaction_full';
  if (ROSTER_NBA_EVIDENCE_RE.test(question)) return 'roster_only';
  return null;
}

export function currentNbaEvidenceTeamIds(question: string, defaultTeamId: string | null): string[] {
  if (!hasCurrentNbaEvidenceTrigger(question)) return [];
  const explicitTeamIds = extractNbaTeamIds(question);
  if (!defaultTeamId || !isFirstPersonTeamQuestion(question)) return explicitTeamIds;
  if (explicitTeamIds.length === 0) return [defaultTeamId];
  if (explicitTeamIds.includes(defaultTeamId)) return explicitTeamIds;
  return [defaultTeamId, ...explicitTeamIds];
}

export function defaultNbaEvidenceTeamId(env: Record<string, string | undefined> = process.env): string | null {
  void env;
  return DEFAULT_NBA_EVIDENCE_TEAM_ID;
}

export function isFirstPersonTeamQuestion(question: string): boolean {
  return /\b(we|our|ours|us)\b/i.test(question);
}

export function extractNbaTeamIds(question: string): string[] {
  const hits = new Map<string, number>();
  const aliases = Object.keys(NBA_EVIDENCE_TEAM_ALIASES).sort((a, b) => b.length - a.length);

  for (const alias of aliases) {
    const teamId = normalizeNbaEvidenceTeamAlias(alias);
    if (!teamId) continue;
    const pattern = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegExp(alias)})(?=$|[^A-Za-z0-9])`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(question)) !== null) {
      const index = match.index + (match[1]?.length ?? 0);
      const current = hits.get(teamId);
      if (current === undefined || index < current) hits.set(teamId, index);
    }
  }

  return [...hits.entries()]
    .sort((a, b) => a[1] - b[1] || teamSortIndex(a[0]) - teamSortIndex(b[0]))
    .map(([teamId]) => teamId);
}

export async function buildCurrentNbaEvidence(
  question: string,
  options: CurrentNbaEvidenceOptions = {},
): Promise<CurrentNbaEvidencePack | null> {
  const teamIds = normalizeEvidenceTeamIds(options.teamIds ?? extractNbaTeamIds(question));
  if (teamIds.length === 0) return null;
  const scope = options.scope ?? currentNbaEvidenceScopeForQuestion(question) ?? 'transaction_full';

  const dataSource = options.dataSource ?? defaultCurrentNbaEvidenceDataSource(options.contextGraphOptions);
  let rosterRows: CurrentRosterViewRow[] = [];
  let capSheetRows: CurrentCapSheetViewRow[] = [];
  let capPlayerRows: CurrentCapSheetPlayerRowRecord[] = [];
  let salaryCells: CurrentCapSheetSalaryCellRow[] = [];
  let playerStats: CurrentPlayerStatViewRow[] = [];
  let contextTeams: CurrentNbaEvidenceContextTeam[] = [];

  try {
    if (scope === 'transaction_full') {
      [rosterRows, capSheetRows, capPlayerRows, salaryCells, playerStats, contextTeams] = await Promise.all([
        dataSource.rosterRows(teamIds),
        dataSource.capSheetRows(teamIds),
        dataSource.capPlayerRows(teamIds),
        dataSource.salaryCells(teamIds),
        dataSource.playerStats(teamIds),
        dataSource.contextTeams(teamIds),
      ]);
    } else {
      rosterRows = await dataSource.rosterRows(teamIds);
      try {
        contextTeams = await dataSource.contextTeams(teamIds);
      } catch (error) {
        console.warn('[nba-evidence] Intel unavailable for roster_only evidence:', error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    throw new AppDataRequiredError(error instanceof Error ? error.message : String(error));
  }

  const rosterByTeam = groupByTeam(rosterRows);
  const capSheetByTeam = new Map(capSheetRows.map((row) => [row.team_id, row]));
  const capPlayersByTeam = groupByTeam(capPlayerRows);
  const salaryCellsByTeam = groupByTeam(salaryCells);
  const statsByTeam = groupByTeam(playerStats);
  const contextByTeam = new Map(contextTeams.map((row) => [row.team_id, row]));

  const missing: string[] = [];
  for (const teamId of teamIds) {
    if ((rosterByTeam.get(teamId) ?? []).length === 0) missing.push(`${teamId} current roster rows`);
    if (scope === 'transaction_full') {
      if (!capSheetByTeam.has(teamId)) missing.push(`${teamId} current cap sheet`);
      if ((capPlayersByTeam.get(teamId) ?? []).length === 0) missing.push(`${teamId} cap player rows`);
      if ((salaryCellsByTeam.get(teamId) ?? []).length === 0) missing.push(`${teamId} cap salary cells`);
      if ((statsByTeam.get(teamId) ?? []).length === 0) missing.push(`${teamId} player stat rows`);
    }
  }
  if (missing.length > 0) {
    throw new AppDataRequiredError(`missing required current NBA app data (${missing.join('; ')})`);
  }

  let nextRefIndex = 1;
  const teamEvidence = teamIds.map((teamId): TeamEvidence => {
    const roster = rosterByTeam.get(teamId) ?? [];
    const contextTeam = contextByTeam.get(teamId) ?? null;
    return {
      team_id: teamId,
      scope,
      rosterRows: roster,
      capSheet: capSheetByTeam.get(teamId) ?? null,
      capPlayerRows: capPlayersByTeam.get(teamId) ?? [],
      salaryCells: salaryCellsByTeam.get(teamId) ?? [],
      playerStats: statsByTeam.get(teamId) ?? [],
      contextTeam,
      conflictNames: contextTeam ? contextRosterConflicts(contextTeam, roster) : [],
      appRefIndex: nextRefIndex++,
      contextRefIndex: nextRefIndex++,
    };
  });

  const conflicts = teamEvidence
    .filter((team) => team.conflictNames.length > 0)
    .map((team) => ({
      team_id: team.team_id,
      source: 'context_graph_roster' as const,
      names: team.conflictNames,
    }));

  return {
    team_ids: teamIds,
    scope,
    systemBlock: renderCurrentNbaEvidenceBlock(teamEvidence, options.consumer ?? 'brief'),
    sources: teamEvidence.flatMap((team) => evidenceSourcesForTeam(team)),
    conflicts,
    reserved_max_ref_index: nextRefIndex - 1,
  };
}

export function reserveGeneratedSourceRefs(
  sources: Omit<BriefSource, 'id' | 'brief_id'>[],
  reservedMaxRefIndex: number,
): Omit<BriefSource, 'id' | 'brief_id'>[] {
  if (reservedMaxRefIndex <= 0) return sources;
  const used = new Set<number>();
  for (let ref = 1; ref <= reservedMaxRefIndex; ref += 1) used.add(ref);
  let nextRef = reservedMaxRefIndex + 1;

  return sources.map((source) => {
    let refIndex = Number.isInteger(source.ref_index) ? source.ref_index : nextRef;
    if (refIndex <= reservedMaxRefIndex || used.has(refIndex)) {
      while (used.has(nextRef)) nextRef += 1;
      refIndex = nextRef;
      nextRef += 1;
    }
    used.add(refIndex);
    return { ...source, ref_index: refIndex };
  });
}

function renderCurrentNbaEvidenceBlock(
  teamEvidence: TeamEvidence[],
  consumer: 'brief' | 'chat',
): string {
  const sourceRefs = teamEvidence.flatMap((team) => [team.appRefIndex, team.contextRefIndex]);
  const scope = teamEvidence[0]?.scope ?? 'transaction_full';
  const lines: string[] = [
    '=== CURRENT NBA APP EVIDENCE (MANDATORY) ===',
    `This prompt is ${scope === 'roster_only' ? 'roster-sensitive' : 'roster/cap-sensitive'}. Reserved source refs: ${sourceRefs.map((ref) => `[${ref}]`).join(' ')}.`,
    scope === 'roster_only'
      ? 'Use current app roster rows as the authority for current player-team membership, listed positions, and roster status.'
      : 'Use current app roster, cap-sheet, salary-cell, and player-stat rows as the authority for current player-team membership, salaries, and roster status.',
    'Use Intel rows only for posture, trade DNA, relationships, priorities, and source-QA caveats. Do not use Intel roster narrative to override current app data.',
    scope === 'roster_only'
      ? 'If a player is absent from the current app roster rows below, do not describe that player as currently on that team.'
      : 'If a player is absent from the current app roster/cap rows below, do not describe that player as currently on that team.',
    'For starting-lineup or depth-chart questions, answer from roster membership and listed positions only, and caveat that the app roster snapshot does not verify coaching depth-chart order.',
    'Any context/app roster conflicts listed below are excluded from current-team evidence and must be caveated if relevant.',
    consumer === 'brief'
      ? 'The server will persist the reserved source refs automatically. Submit additional sources only for non-reserved external evidence.'
      : 'The server has already emitted this app roster lookup in the chat trust trail. Answer directly from it.',
    ...(consumer === 'brief'
      ? ['Any sources submitted through submit_brief must use ref_index values greater than the reserved refs above.']
      : []),
    '',
    `Required team_ids: ${teamEvidence.map((team) => team.team_id).join(', ')}`,
    '',
  ];

  for (const team of teamEvidence) {
    lines.push(renderTeamAppEvidence(team));
    lines.push(renderTeamContextEvidence(team));
    lines.push('');
  }

  return lines.join('\n');
}

function renderTeamAppEvidence(team: TeamEvidence): string {
  const rosterNames = team.rosterRows
    .slice()
    .sort((a, b) => a.source_order - b.source_order)
    .map((row) => row.player_full_name);
  const rosterPositionRows = team.rosterRows
    .slice()
    .sort((a, b) => a.source_order - b.source_order)
    .map((row) => `${row.player_full_name} (${row.position ?? 'position unknown'}${row.jersey_number ? `, #${row.jersey_number}` : ''})`);
  const capRows = team.capPlayerRows
    .slice()
    .sort((a, b) => a.source_order - b.source_order)
    .map((row) => {
      const cells = team.salaryCells
        .filter((cell) => cell.player_row_id === row.id)
        .sort((a, b) => a.season.localeCompare(b.season))
        .map((cell) => `${cell.season}=${cell.label ?? formatMoney(cell.amount) ?? 'Source needed'}`)
        .join(', ');
      return `${row.player_name} (${row.roster_status ?? 'status source needed'}; total=${formatMoney(row.total_amount) ?? 'Source needed'}; ${cells})`;
    });
  const statRows = team.playerStats
    .slice()
    .sort((a, b) => a.source_order - b.source_order)
    .map((row) => `${row.player_name} (${row.match_status}; GP=${row.games_played}; MPG=${minutesLabel(row.minutes, row.games_played)}; USG=${pctLabel(row.usage_pct)}; TS=${pctLabel(row.true_shooting_pct)}; NET=${numberLabel(row.net_rating)})`);

  const lines = [
    `[${team.appRefIndex}] ANALYST_DATA - ${team.team_id} current app data`,
    `Snapshot: roster_as_of=${firstString(team.rosterRows.map((row) => row.as_of_date)) ?? 'unknown'}; cap_as_of=${team.capSheet?.as_of_date ?? 'not required for roster_only'}; stats_as_of=${firstString(team.playerStats.map((row) => row.as_of_date)) ?? 'not required for roster_only'}`,
    `Current roster (${rosterNames.length}): ${rosterNames.join('; ')}`,
    `Roster position rows (${rosterPositionRows.length}): ${rosterPositionRows.join(' | ')}`,
  ];

  if (team.scope === 'transaction_full') {
    lines.push(`Team cap: ${teamFullName(team)}; payroll=${formatMoney(team.capSheet?.payroll_amount ?? null) ?? 'Source needed'}; cap_status=${team.capSheet?.cap_status ?? 'Source needed'}; tax_status=${team.capSheet?.tax_status ?? 'Source needed'}; apron_status=${team.capSheet?.apron_status ?? 'Source needed'}`);
    lines.push(`Cap player rows (${capRows.length}): ${capRows.join(' | ')}`);
    lines.push(`Player stats (${statRows.length}): ${statRows.join(' | ')}`);
  }

  return lines.join('\n');
}

function renderTeamContextEvidence(team: TeamEvidence): string {
  const context = team.contextTeam;
  const conflictLine = team.conflictNames.length
    ? `Context roster conflicts excluded from current-team evidence: ${team.conflictNames.join('; ')}`
    : 'Context roster conflicts excluded from current-team evidence: none detected';

  if (!context) {
    return [
      `[${team.contextRefIndex}] INTEL - ${team.team_id} Intel`,
      `Intel summary unavailable; rely on current app ${team.scope === 'roster_only' ? 'roster' : 'roster/cap'} data for current-team claims.`,
      conflictLine,
    ].join('\n');
  }

  return [
    `[${team.contextRefIndex}] INTEL - ${team.team_id} Intel`,
    `Freshness: as_of=${context.source_as_of_date ?? 'unknown'}; updated=${context.source_last_updated ?? 'unknown'}; validation=${context.validation_status}`,
    `Posture: ${context.strategic_posture ?? 'unknown'}`,
    `Trade DNA: ${context.trade_dna ?? 'unknown'}`,
    `Near-term priorities: ${context.near_term_priorities.length ? context.near_term_priorities.join('; ') : 'none captured'}`,
    `Relationships: ${context.relationship_notes.length ? context.relationship_notes.join('; ') : 'none captured'}`,
    conflictLine,
  ].join('\n');
}

function evidenceSourcesForTeam(team: TeamEvidence): Omit<BriefSource, 'id' | 'brief_id'>[] {
  const rosterNames = team.rosterRows
    .slice()
    .sort((a, b) => a.source_order - b.source_order)
    .map((row) => row.player_full_name);
  const rosterAsOf = firstString(team.rosterRows.map((row) => row.as_of_date)) ?? 'unknown';
  const fullName = teamFullName(team);
  const topCapRows = team.capPlayerRows
    .slice()
    .sort((a, b) => (b.total_amount ?? -1) - (a.total_amount ?? -1))
    .slice(0, 6)
    .map((row) => `${row.player_name} ${formatMoney(row.total_amount) ?? 'Source needed'}`);

  return [
    {
      ref_index: team.appRefIndex,
      kind: 'ANALYST_DATA',
      source: 'GAMBIT_APP_DATA',
      title: `Current NBA app data - ${team.team_id} - ${fullName}`,
      updated_at: rosterAsOf,
      data: {
        rows: [
          { k: 'Team', v: `${team.team_id} - ${fullName}` },
          { k: 'Evidence scope', v: team.scope },
          { k: 'Roster as of', v: rosterAsOf },
          { k: 'Cap as of', v: team.capSheet?.as_of_date ?? 'not required for roster_only' },
          { k: 'Stats as of', v: firstString(team.playerStats.map((row) => row.as_of_date)) ?? 'not required for roster_only' },
          { k: 'Current roster', v: rosterNames.join(', ') },
          { k: 'Top cap rows', v: team.scope === 'transaction_full' ? topCapRows.join(', ') : 'not requested for roster_only' },
        ],
        current_nba_evidence: {
          team_id: team.team_id,
          scope: team.scope,
          roster_as_of_date: rosterAsOf,
          roster_player_names: rosterNames,
          cap_player_names: team.capPlayerRows.map((row) => row.player_name),
          player_stat_names: team.playerStats.map((row) => row.player_name),
        },
      },
    },
    {
      ref_index: team.contextRefIndex,
      kind: 'CONTEXT_GRAPH',
      source: 'GAMBIT_CONTEXT_GRAPH',
      title: `Intel - ${team.team_id} - ${team.contextTeam?.name ?? fullName}`,
      updated_at: team.contextTeam?.source_last_updated ?? team.contextTeam?.source_as_of_date ?? null,
      data: {
        rows: [
          { k: 'Team', v: `${team.team_id} - ${team.contextTeam?.name ?? fullName}` },
          { k: 'Validation', v: team.contextTeam?.validation_status ?? 'unavailable' },
          { k: 'Source as of', v: team.contextTeam?.source_as_of_date ?? 'unknown' },
          { k: 'Source updated', v: team.contextTeam?.source_last_updated ?? 'unknown' },
          { k: 'Posture', v: team.contextTeam?.strategic_posture ?? 'unknown' },
          { k: 'Roster precedence', v: 'Current app roster rows override Intel roster narrative.' },
          { k: 'Context roster conflicts', v: team.conflictNames.length ? team.conflictNames.join(', ') : 'none detected' },
        ],
      },
    },
  ];
}

export function currentNbaEvidenceToDataAnalystTrace(
  evidence: CurrentNbaEvidencePack,
  toolUseId = 'preloaded_current_nba_evidence',
): DataAnalystTrace {
  return {
    tool_use_id: toolUseId,
    tool_name: 'query_nba_data',
    datasets: evidence.sources
      .filter((source) => source.kind === 'ANALYST_DATA')
      .map((source) => {
        const currentEvidence = isRecord(source.data)
          ? source.data.current_nba_evidence
          : null;
        const teamId = isRecord(currentEvidence) && typeof currentEvidence.team_id === 'string'
          ? currentEvidence.team_id
          : null;
        const rosterNames = isRecord(currentEvidence) && Array.isArray(currentEvidence.roster_player_names)
          ? currentEvidence.roster_player_names
          : [];
        return {
          dataset_id: evidence.scope === 'roster_only' ? 'nba_rosters_current' : 'nba_current_evidence',
          label: evidence.scope === 'roster_only' ? 'NBA current rosters' : 'NBA current roster/cap/stat evidence',
          source_name: source.source,
          as_of_date: source.updated_at,
          team_ids: teamId ? [teamId] : [],
          row_count: rosterNames.length,
        };
      }),
    errors: [],
  };
}

function teamFullName(team: TeamEvidence): string {
  return team.capSheet?.full_name
    ?? team.rosterRows[0]?.full_name
    ?? team.contextTeam?.name
    ?? team.team_id;
}

function defaultCurrentNbaEvidenceDataSource(
  contextGraphOptions: TeamPreferenceStoreOptions = {},
): CurrentNbaEvidenceDataSource {
  return {
    rosterRows: (teamIds) => queryCurrentRows<CurrentRosterViewRow>('nba_current_roster_entries', teamIds, ['team_id', 'source_order']),
    capSheetRows: (teamIds) => queryCurrentRows<CurrentCapSheetViewRow>('nba_current_cap_sheets', teamIds, ['team_id']),
    capPlayerRows: (teamIds) => queryCurrentRows<CurrentCapSheetPlayerRowRecord>('nba_current_cap_sheet_player_rows', teamIds, ['team_id', 'source_order']),
    salaryCells: (teamIds) => queryCurrentRows<CurrentCapSheetSalaryCellRow>('nba_current_cap_sheet_salary_cells', teamIds, ['team_id', 'season']),
    playerStats: (teamIds) => queryCurrentRows<CurrentPlayerStatViewRow>('nba_current_player_stats', teamIds, ['team_id', 'source_order']),
    contextTeams: async (teamIds) => Promise.all(teamIds.map((teamId) => queryContextTeam(teamId, contextGraphOptions))),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function queryCurrentRows<T>(
  table: string,
  teamIds: string[],
  orderColumns: string[],
): Promise<T[]> {
  let query = db.from(table).select('*').in('team_id', teamIds);
  for (const column of orderColumns) {
    query = query.order(column, { ascending: true });
  }
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as T[];
}

async function queryContextTeam(
  teamId: string,
  options: TeamPreferenceStoreOptions,
): Promise<CurrentNbaEvidenceContextTeam> {
  const effective = await getEffectiveTeamContext(teamId, options);
  return contextTeamFromEffective(effective);
}

function contextTeamFromEffective(effective: EffectiveTeamContext): CurrentNbaEvidenceContextTeam {
  return {
    team_id: effective.team_id,
    name: effective.name,
    validation_status: effective.validation.status,
    source_as_of_date: effective.metadata.source_as_of_date,
    source_last_updated: effective.metadata.source_last_updated,
    strategic_posture: compactRecordValue(effective.preferences.strategic_posture, ['timeframe', 'rationale']),
    trade_dna: compactRecordValue(effective.preferences.trade_dna, ['risk_profile', 'rationale']),
    near_term_priorities: effective.preferences.near_term_priorities.map((priority) => {
      const record = priority as unknown as Record<string, unknown>;
      return String(record.priority ?? record.type ?? JSON.stringify(priority));
    }).slice(0, 6),
    relationship_notes: [
      ...effective.relationship_summary.trade_partners.map((item) => `trade_partner:${item.team_id}`),
      ...effective.relationship_summary.rivalries.map((item) => `rivalry:${item.team_id}`),
      ...effective.relationship_summary.personnel_connections.map((item) => `personnel:${item.connected_team}`),
    ].slice(0, 8),
    source_roster_names: sourceRosterNames(effective.source_team),
  };
}

function contextRosterConflicts(
  contextTeam: CurrentNbaEvidenceContextTeam,
  rosterRows: CurrentRosterViewRow[],
): string[] {
  const appRosterNames = new Set(rosterRows.map((row) => normalizeName(row.player_full_name)));
  return contextTeam.source_roster_names
    .filter((name) => !appRosterNames.has(normalizeName(name)))
    .sort((a, b) => a.localeCompare(b));
}

function sourceRosterNames(sourceTeam: Record<string, unknown>): string[] {
  const roster = sourceTeam.roster;
  if (!Array.isArray(roster)) return [];
  return roster
    .map((row) => (typeof row === 'object' && row !== null && 'name' in row ? String((row as { name?: unknown }).name ?? '') : ''))
    .filter(Boolean);
}

function normalizeEvidenceTeamIds(teamIds: string[]): string[] {
  const out: string[] = [];
  for (const raw of teamIds) {
    const teamId = String(raw).trim().toUpperCase();
    if (isNbaEvidenceTeamId(teamId) && !out.includes(teamId)) out.push(teamId);
  }
  return out;
}

function groupByTeam<T extends { team_id: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const list = grouped.get(row.team_id) ?? [];
    list.push(row);
    grouped.set(row.team_id, list);
  }
  return grouped;
}

function compactRecordValue(record: unknown, keys: string[]): string | null {
  if (typeof record !== 'object' || record === null) return null;
  const values = keys
    .map((key) => (record as Record<string, unknown>)[key])
    .filter((value) => value !== null && value !== undefined && value !== '');
  return values.length ? values.map(String).join(' - ') : null;
}

function firstString(values: Array<string | null | undefined>): string | null {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0) ?? null;
}

function formatMoney(amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  const millions = amount / 1_000_000;
  const rounded = Math.abs(millions) >= 10 ? millions.toFixed(1) : millions.toFixed(2);
  return `$${rounded}M`;
}

function minutesLabel(minutes: number, gamesPlayed: number): string {
  if (!gamesPlayed) return '0.0';
  return (minutes / gamesPlayed).toFixed(1);
}

function pctLabel(value: number): string {
  if (!Number.isFinite(value)) return 'unknown';
  return value <= 1 ? `${(value * 100).toFixed(1)}%` : `${value.toFixed(1)}%`;
}

function numberLabel(value: number): string {
  if (!Number.isFinite(value)) return 'unknown';
  return value.toFixed(1);
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function teamSortIndex(teamId: string): number {
  return NBA_EVIDENCE_TEAM_IDS.indexOf(teamId as NbaEvidenceTeamId);
}

function isNbaEvidenceTeamId(teamId: string): teamId is NbaEvidenceTeamId {
  return NBA_EVIDENCE_TEAM_ID_SET.has(teamId);
}

function normalizeNbaEvidenceTeamAlias(alias: string): NbaEvidenceTeamId | null {
  return NBA_EVIDENCE_TEAM_ALIASES[alias.trim().toUpperCase()] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
