import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type {
  NbaCapSheetMetric,
  NbaCapSheetPlayerRow,
  NbaCapSheetSalaryCell,
  NbaCapSheetSection,
  NbaCapSheetSourceRef,
  NbaTeam,
} from '@shared/types';
import type { NbaRosterSeed, NbaRosterSeedEntry, NbaRosterSeedPlayer } from '../nba_rosters/seed.js';
import { DEFAULT_NBA_ROSTER_SEED_PATH } from '../nba_rosters/seed.js';
import type { NbaCapSheetSeed, NbaCapSheetSeedTeam } from './seed.js';
import { validateNbaCapSheetSeed } from './seed.js';

const DEFAULT_CONTEXT_GRAPH_PATH = fileURLToPath(
  new URL('../../../data/nba-context-graph/derived/teams.json', import.meta.url),
);

const DEFAULT_OUT_PATH = fileURLToPath(
  new URL('../../../data/nba-cap-sheets/2026-05-03.public-sources.json', import.meta.url),
);

const SALARY_SEASONS = ['2025-26', '2026-27', '2027-28', '2028-29', '2029-30', '2030-31'];

const NBA_2025_26_THRESHOLDS = {
  salaryCap: 154_647_000,
  luxuryTax: 187_895_000,
  firstApron: 195_945_000,
  secondApron: 207_824_000,
  capSource: 'https://www.spotrac.com/nba/golden-state-warriors/cap/_/year/2025',
  taxSource: 'https://www.spotrac.com/nba/golden-state-warriors/tax',
};

interface BuildOptions {
  rosterPath: string;
  contextGraphPath: string;
  outPath: string;
}

interface ContextTeam {
  team_id: string;
  as_of_date?: string;
  last_updated?: string;
  identity?: { name?: string };
  cap_situation?: {
    current_status?: string;
    current_payroll_estimate?: number;
    hard_capped?: string | boolean;
    hard_cap_reason?: string;
    exceptions_available?: string[];
    source?: string;
    source_fallbacks_used?: string[];
    confidence?: string;
  };
  roster?: ContextRosterPlayer[];
  pending_free_agents?: Record<string, unknown>[];
  known_target_history?: Record<string, unknown>[];
  key_assets?: {
    draft_picks_owned?: Record<string, unknown>[];
    draft_picks_owed?: Record<string, unknown>[];
    trade_exceptions?: Record<string, unknown>[];
  };
  trade_dna?: {
    recent_significant_trades?: Record<string, unknown>[];
  };
  g_league_and_stash?: Record<string, unknown>;
  sources_used?: string[];
  fields_marked_unknown?: string[];
}

interface ContextRosterPlayer {
  player_id?: string;
  name?: string;
  age?: number;
  position_listed?: string;
  contract_type?: string;
  availability_status?: string;
  tier?: string;
  trajectory?: string;
  confidence?: string;
  source?: string;
  contract?: {
    years_remaining?: number | string | null;
    total_value_remaining?: number | null;
    annual_value_current_season?: number | null;
    annual_value_next_season?: number | null;
    no_trade_clause?: string | null;
    trade_kicker?: number | string | null;
    player_option?: number | string | null;
    team_option?: number | string | null;
    bird_rights?: string | null;
    contract_through?: number | string | null;
    source?: string | null;
  };
  movement_constraints?: {
    status?: string;
    signal_strength?: string;
    reasons?: Record<string, unknown>[];
  };
  team_relationship?: {
    homegrown?: string | boolean;
    tenure_with_team?: number | string | null;
    contract_leverage?: Record<string, unknown>;
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rosterSeed = JSON.parse(await readFile(opts.rosterPath, 'utf8')) as NbaRosterSeed;
  const contextTeams = JSON.parse(await readFile(opts.contextGraphPath, 'utf8')) as ContextTeam[];
  const seed = buildCapSheetSeed(rosterSeed, contextTeams);
  validateNbaCapSheetSeed(seed);
  await writeFile(opts.outPath, `${JSON.stringify(seed, null, 2)}\n`);
  console.log(`wrote ${opts.outPath}`);
  console.log(`teams=${seed.cap_sheets.length} rows=${seed.cap_sheets.reduce((sum, team) => sum + team.player_rows.length, 0)}`);
}

export function buildCapSheetSeed(rosterSeed: NbaRosterSeed, contextTeams: ContextTeam[]): NbaCapSheetSeed {
  const contextByTeam = new Map(contextTeams.map((team) => [team.team_id, team]));
  const playersById = new Map(rosterSeed.players.map((player) => [player.nba_player_id, player]));
  const entriesByTeam = new Map<string, NbaRosterSeedEntry[]>();
  for (const entry of rosterSeed.entries) {
    if (!entriesByTeam.has(entry.team_id)) entriesByTeam.set(entry.team_id, []);
    entriesByTeam.get(entry.team_id)!.push(entry);
  }

  const capSheets = rosterSeed.teams.map((team) => buildTeamSheet({
    team,
    rosterEntries: entriesByTeam.get(team.team_id) ?? [],
    playersById,
    contextTeam: contextByTeam.get(team.team_id) ?? null,
    rosterSource: rosterSeed.source_url,
    rosterRetrievedAt: rosterSeed.retrieved_at,
    asOfDate: rosterSeed.as_of_date,
    season: rosterSeed.season,
  }));

  return {
    schema_version: 1,
    season: rosterSeed.season,
    as_of_date: rosterSeed.as_of_date,
    source_name: 'Reviewed NBA cap sheet snapshot',
    source_url: 'data/nba-cap-sheets/2026-05-03.public-sources.json',
    retrieved_at: rosterSeed.retrieved_at,
    source_policy: {
      mode: 'gated_public_refresh',
      default_seed: 'reviewed_snapshot',
      notes: [
        'Default seed is generated from checked-in official roster data plus existing public-source Intel captures.',
        'Public web refresh is intentionally gated and must record source/terms/robots status before writing a new snapshot.',
        'Missing cap-sheet sections are preserved as source-needed instead of inferred.',
      ],
    },
    teams: rosterSeed.teams,
    cap_sheets: capSheets,
    notes: [
      'All 30 teams are represented.',
      'Player identity and roster counts come from the official NBA roster seed.',
      'Contract and cap facts are included only where Intel had captured source-backed values.',
      'The attached GSW PDF was used as layout guidance, not as the data source for this seed.',
    ],
    source_meta: {
      roster_snapshot: {
        source_name: rosterSeed.source_name,
        source_url: rosterSeed.source_url,
        as_of_date: rosterSeed.as_of_date,
        retrieved_at: rosterSeed.retrieved_at,
      },
      context_graph: {
        path: 'data/nba-context-graph/derived/teams.json',
        team_count: contextTeams.length,
      },
    },
  };
}

function buildTeamSheet(args: {
  team: NbaTeam;
  rosterEntries: NbaRosterSeedEntry[];
  playersById: Map<number, NbaRosterSeedPlayer>;
  contextTeam: ContextTeam | null;
  rosterSource: string;
  rosterRetrievedAt: string;
  asOfDate: string;
  season: string;
}): NbaCapSheetSeedTeam {
  const contextRosterByName = new Map<string, ContextRosterPlayer>();
  for (const player of args.contextTeam?.roster ?? []) {
    if (player.name) contextRosterByName.set(normalizeName(player.name), player);
  }

  const rosterEntries = [...args.rosterEntries].sort((a, b) => a.source_order - b.source_order);
  const playerRows = rosterEntries.map((entry, index) => {
    const player = args.playersById.get(entry.nba_player_id);
    if (!player) throw new Error(`missing roster player ${entry.nba_player_id}`);
    const contextPlayer = contextRosterByName.get(normalizeName(player.full_name)) ?? null;
    return buildPlayerRow({
      teamId: args.team.team_id,
      asOfDate: args.asOfDate,
      entry,
      player,
      contextPlayer,
      sourceOrder: index + 1,
    });
  });

  const cap = args.contextTeam?.cap_situation;
  const sourceRefs = buildSourceRefs(args.contextTeam, args.rosterSource, args.rosterRetrievedAt);
  const sections = buildSections({
    team: args.team,
    rosterEntries,
    playersById: args.playersById,
    contextTeam: args.contextTeam,
    playerRows,
    rosterSource: args.rosterSource,
  });
  const missingSections = sections
    .filter((section) => section.source_status === 'source-needed')
    .map((section) => section.key);

  return {
    team_id: args.team.team_id,
    official_roster_count: rosterEntries.length,
    cap_status: stringOrSourceNeeded(cap?.current_status),
    tax_status: 'Source needed',
    apron_status: cap?.hard_capped
      ? `Hard-capped: ${String(cap.hard_capped)}`
      : stringOrSourceNeeded(cap?.current_status),
    payroll_amount: numberOrNull(cap?.current_payroll_estimate),
    source_status: cap?.source || playerRows.some((row) => row.source_status === 'captured') ? 'captured' : 'source-needed',
    missing_sections: missingSections,
    source_refs: sourceRefs,
    metrics: buildMetrics(args.team, rosterEntries.length, args.contextTeam, playerRows),
    player_rows: playerRows,
    sections,
    source_meta: {
      context_graph_as_of_date: args.contextTeam?.as_of_date ?? null,
      context_graph_last_updated: args.contextTeam?.last_updated ?? null,
      context_graph_fields_marked_unknown: args.contextTeam?.fields_marked_unknown ?? [],
    },
  };
}

function buildPlayerRow(args: {
  teamId: string;
  asOfDate: string;
  entry: NbaRosterSeedEntry;
  player: NbaRosterSeedPlayer;
  contextPlayer: ContextRosterPlayer | null;
  sourceOrder: number;
}): NbaCapSheetPlayerRow {
  const contract = args.contextPlayer?.contract ?? null;
  const sourceUrl = contract?.source ?? args.contextPlayer?.source ?? args.entry.source_url;
  const captured = Boolean(contract?.source || contract?.annual_value_current_season || contract?.annual_value_next_season);
  const rowId = [
    'cap',
    args.asOfDate,
    args.teamId,
    String(args.sourceOrder).padStart(2, '0'),
    String(args.entry.nba_player_id),
  ].join('-');

  return {
    id: rowId,
    nba_player_id: args.entry.nba_player_id,
    player_name: args.player.full_name,
    source_order: args.sourceOrder,
    position: args.entry.position ?? args.player.position,
    age: numberOrNull(args.contextPlayer?.age),
    dob: null,
    yos: null,
    roster_status: args.contextPlayer?.contract_type ?? 'official roster',
    fa_status: contract?.contract_through ? `Contract through ${contract.contract_through}` : null,
    fa_year: contract?.contract_through == null ? null : String(contract.contract_through),
    bird_rights: stringOrNull(contract?.bird_rights),
    restrictions: restrictionsFromContext(args.contextPlayer),
    how_acquired: args.contextPlayer?.team_relationship?.homegrown ? 'Homegrown' : null,
    agent: null,
    total_amount: numberOrNull(contract?.total_value_remaining),
    source_status: captured ? 'captured' : 'source-needed',
    source_url: sourceUrl ?? null,
    source_data: {
      official_roster_row: args.entry.source_row,
      context_graph_player: args.contextPlayer ?? null,
      missing_fields: [
        !captured ? 'multi_year_salary' : null,
        'dob',
        'yos',
        'agent',
        'cap_sheet_how_acquired',
      ].filter(Boolean),
    },
    salary_cells: SALARY_SEASONS.map((season, index) => salaryCellForSeason(season, index, contract)),
  };
}

function salaryCellForSeason(
  season: string,
  index: number,
  contract: ContextRosterPlayer['contract'] | null,
): NbaCapSheetSalaryCell {
  const amount = index === 0
    ? numberOrNull(contract?.annual_value_current_season)
    : index === 1
      ? numberOrNull(contract?.annual_value_next_season)
      : null;
  const optionType = optionTypeForSeason(season, contract);
  const captured = amount != null;
  return {
    season,
    amount,
    label: captured ? money(amount) : 'Source needed',
    option_type: optionType,
    is_guaranteed: captured ? optionType === null : null,
    source_status: captured ? 'captured' : 'source-needed',
    source_url: contract?.source ?? null,
    source_data: captured ? { contract } : { missing_field: 'season_salary' },
  };
}

function buildMetrics(
  team: NbaTeam,
  rosterCount: number,
  contextTeam: ContextTeam | null,
  playerRows: NbaCapSheetPlayerRow[],
): NbaCapSheetMetric[] {
  const cap = contextTeam?.cap_situation;
  const capturedContracts = playerRows.filter((row) => row.source_status === 'captured').length;
  const payroll = numberOrNull(cap?.current_payroll_estimate);
  const secondApron = parseMoneyFromText(cap?.hard_cap_reason) ?? NBA_2025_26_THRESHOLDS.secondApron;
  return [
    metric('payroll', 'Payroll estimate', payroll ? money(payroll) : 'Source needed', payroll, cap?.source, 'Intel payroll estimate.'),
    metric('cap_status', 'Cap status', stringOrSourceNeeded(cap?.current_status), null, cap?.source, capStatusNote(cap?.current_status)),
    metric('second_apron_room', '2nd apron room', moneyDelta(secondApron, payroll, 'below', 'over'), secondApron != null && payroll != null ? secondApron - payroll : null, cap?.source, `Measured against the ${money(secondApron)} second-apron hard cap.`),
    metric('luxury_tax_overage', 'Tax overage', moneyDelta(payroll, NBA_2025_26_THRESHOLDS.luxuryTax, 'over', 'below'), payroll == null ? null : payroll - NBA_2025_26_THRESHOLDS.luxuryTax, NBA_2025_26_THRESHOLDS.taxSource, `2025-26 tax line: ${money(NBA_2025_26_THRESHOLDS.luxuryTax)}.`),
    metric('first_apron_overage', '1st apron overage', moneyDelta(payroll, NBA_2025_26_THRESHOLDS.firstApron, 'over', 'below'), payroll == null ? null : payroll - NBA_2025_26_THRESHOLDS.firstApron, NBA_2025_26_THRESHOLDS.capSource, `2025-26 first apron: ${money(NBA_2025_26_THRESHOLDS.firstApron)}.`),
    metric('hard_cap', 'Hard cap', hardCapMetricValue(cap?.hard_cap_reason), null, cap?.source, hardCapMetricNote(cap?.hard_cap_reason)),
    metric('captured_contract_rows', 'Captured contract rows', `${capturedContracts} / ${rosterCount}`, capturedContracts, cap?.source),
    metric('official_roster_rows', 'Official roster rows', String(rosterCount), rosterCount, 'https://www.nba.com/players'),
    metric('pending_free_agents', 'Pending free agents', String(contextTeam?.pending_free_agents?.length ?? 0), contextTeam?.pending_free_agents?.length ?? 0, firstSource(contextTeam?.pending_free_agents)),
    metric('salary_cap', 'Salary cap', money(NBA_2025_26_THRESHOLDS.salaryCap), NBA_2025_26_THRESHOLDS.salaryCap, NBA_2025_26_THRESHOLDS.capSource, payroll == null ? null : `${money(Math.abs(payroll - NBA_2025_26_THRESHOLDS.salaryCap))} ${payroll >= NBA_2025_26_THRESHOLDS.salaryCap ? 'over' : 'below'} the cap.`),
    metric('luxury_tax', 'Luxury tax line', money(NBA_2025_26_THRESHOLDS.luxuryTax), NBA_2025_26_THRESHOLDS.luxuryTax, NBA_2025_26_THRESHOLDS.taxSource, payroll == null ? null : `${money(Math.abs(payroll - NBA_2025_26_THRESHOLDS.luxuryTax))} ${payroll >= NBA_2025_26_THRESHOLDS.luxuryTax ? 'over' : 'below'} the tax line.`),
    metric('first_apron', 'First apron', money(NBA_2025_26_THRESHOLDS.firstApron), NBA_2025_26_THRESHOLDS.firstApron, NBA_2025_26_THRESHOLDS.capSource, payroll == null ? null : `${money(Math.abs(payroll - NBA_2025_26_THRESHOLDS.firstApron))} ${payroll >= NBA_2025_26_THRESHOLDS.firstApron ? 'over' : 'below'} the first apron.`),
    metric('second_apron', 'Second apron', money(secondApron), secondApron, cap?.source ?? NBA_2025_26_THRESHOLDS.capSource, payroll == null ? null : `${money(Math.abs(secondApron - payroll))} ${payroll <= secondApron ? 'below' : 'over'} the second apron.`),
    metric('team', 'Team', team.full_name, null, null),
  ];
}

function buildSections(args: {
  team: NbaTeam;
  rosterEntries: NbaRosterSeedEntry[];
  playersById: Map<number, NbaRosterSeedPlayer>;
  contextTeam: ContextTeam | null;
  playerRows: NbaCapSheetPlayerRow[];
  rosterSource: string;
}): NbaCapSheetSection[] {
  const cap = args.contextTeam?.cap_situation;
  const exceptions = cap?.exceptions_available ?? [];
  const draftOwned = args.contextTeam?.key_assets?.draft_picks_owned ?? [];
  const draftOwed = args.contextTeam?.key_assets?.draft_picks_owed ?? [];
  const tradeExceptions = args.contextTeam?.key_assets?.trade_exceptions ?? [];
  const trades = [
    ...(args.contextTeam?.trade_dna?.recent_significant_trades ?? []),
    ...(args.contextTeam?.known_target_history ?? []).filter((row) => String(row.outcome ?? '').toLowerCase() === 'acquired'),
  ];
  const freeAgents = args.contextTeam?.pending_free_agents ?? [];
  const tradeBonusRows = args.playerRows
    .filter((row) => {
      const data = row.source_data.context_graph_player as ContextRosterPlayer | undefined;
      return data?.contract?.trade_kicker && data.contract.trade_kicker !== 'none';
    })
    .map((row) => ({
      player: row.player_name,
      trade_bonus: (row.source_data.context_graph_player as ContextRosterPlayer).contract?.trade_kicker,
      source: row.source_url,
    }));

  return [
    capturedSection('team_totals', 'Team Totals', [
      { label: 'Payroll estimate', value: cap?.current_payroll_estimate ? money(cap.current_payroll_estimate) : 'Source needed', source: cap?.source ?? null },
      { label: 'Cap status', value: cap?.current_status ?? 'Source needed', source: cap?.source ?? null },
      { label: 'Hard cap reason', value: cap?.hard_cap_reason ?? 'Source needed', source: cap?.source ?? null },
    ], cap?.source, ['Team totals are limited to captured context-graph values in this seed.']),
    capturedSection('depth_chart', 'Depth Chart', depthRows(args.rosterEntries, args.playersById), args.rosterSource, ['Roster-position grouping from the official NBA roster seed; not an inferred depth chart.']),
    sourceNeededSection('contract_incentives', 'Contract Incentives', 'No reviewed incentive table was captured for this team.'),
    sourceNeededSection('cash_trades', 'Cash In Trades', 'No reviewed cash-trade table was captured for this team.'),
    capturedOrNeededSection('restrictions', 'Restrictions', restrictionRows(cap), cap?.source, 'No reviewed signing/aggregation/reacquisition restriction table was captured for this team.'),
    capturedOrNeededSection('injury_report', 'Current Injury Report', injuryRows(args.contextTeam), firstRosterSource(args.contextTeam), 'No reviewed injury report was captured for this team.'),
    capturedOrNeededSection('future_draft_selections', 'Future NBA Draft Selections', [
      ...draftOwned.map((row) => ({ direction: 'owned', ...row })),
      ...draftOwed.map((row) => ({ direction: 'owed', ...row })),
    ], firstSource([...draftOwned, ...draftOwed]), 'No reviewed future draft selection table was captured for this team.'),
    capturedOrNeededSection('last_transactions', 'Last 5 Transactions', trades.slice(0, 5), firstSource(trades), 'No reviewed recent transaction table was captured for this team.'),
    capturedOrNeededSection('trade_disabled_exceptions', 'Trade & Disabled Exceptions', [
      ...tradeExceptions.map((row) => ({ type: 'trade_exception', ...row })),
      ...exceptions.map((value) => ({ type: 'cap_exception_note', value, source: cap?.source ?? null })),
    ], firstSource(tradeExceptions) ?? cap?.source, 'No reviewed trade or disabled-player exception table was captured for this team.'),
    capturedOrNeededSection('trade_bonuses', 'Trade Bonuses', tradeBonusRows, firstSource(tradeBonusRows), 'No reviewed trade-bonus table was captured for this team.'),
    capturedOrNeededSection('mid_level_exceptions', 'Mid-Level Exceptions', exceptions
      .filter((value) => /MLE|mid-level/i.test(value))
      .map((value) => ({ value, source: cap?.source ?? null })), cap?.source, 'No reviewed mid-level exception table was captured for this team.'),
    capturedOrNeededSection('bi_annual_exceptions', 'Bi-Annual Exceptions', exceptions
      .filter((value) => /BAE|bi-annual/i.test(value))
      .map((value) => ({ value, source: cap?.source ?? null })), cap?.source, 'No reviewed bi-annual exception table was captured for this team.'),
    capturedOrNeededSection('current_free_agents', 'Current Free Agents', freeAgents, firstSource(freeAgents), 'No reviewed current free-agent/cap-hold table was captured for this team.'),
    capturedOrNeededSection('future_free_agents', 'Future Free Agents', freeAgents.map((row) => ({ ...row, section_note: 'Pending FA row reused until a dedicated future-FA table is captured.' })), firstSource(freeAgents), 'No reviewed future free-agent/cap-hold table was captured for this team.'),
    capturedOrNeededSection('draft_rights', 'Draft Rights', draftRightsRows(args.contextTeam), null, 'No reviewed draft-rights table was captured for this team.'),
  ];
}

function depthRows(entries: NbaRosterSeedEntry[], playersById: Map<number, NbaRosterSeedPlayer>): Record<string, unknown>[] {
  return entries.map((entry) => {
    const player = playersById.get(entry.nba_player_id);
    return {
      position: entry.position ?? player?.position ?? 'Unknown',
      player: player?.full_name ?? String(entry.nba_player_id),
      jersey: entry.jersey_number,
      nba_player_id: entry.nba_player_id,
      source: entry.source_url,
    };
  });
}

function restrictionRows(cap?: ContextTeam['cap_situation']): Record<string, unknown>[] {
  if (!cap?.hard_cap_reason) return [];
  return [{
    restriction: 'Hard cap',
    detail: cap.hard_cap_reason,
    status: cap.hard_capped ?? 'captured',
    source: cap.source ?? null,
  }];
}

function injuryRows(contextTeam: ContextTeam | null): Record<string, unknown>[] {
  return (contextTeam?.roster ?? [])
    .filter((player) => player.name && player.availability_status)
    .map((player) => ({
      player: player.name,
      status: player.availability_status,
      confidence: player.confidence ?? null,
      source: player.source ?? player.contract?.source ?? null,
    }));
}

function draftRightsRows(contextTeam: ContextTeam | null): Record<string, unknown>[] {
  const stash = contextTeam?.g_league_and_stash;
  if (!stash) return [];
  return [{
    affiliate_team: stash.affiliate_team ?? 'Source needed',
    international_stash: stash.international_stash ?? 'Source needed',
    notable_affiliate_players: stash.notable_affiliate_players ?? [],
    source: 'data/nba-context-graph/derived/teams.json',
  }];
}

function buildSourceRefs(
  contextTeam: ContextTeam | null,
  rosterSource: string,
  rosterRetrievedAt: string,
): NbaCapSheetSourceRef[] {
  const refs: NbaCapSheetSourceRef[] = [
    {
      name: 'NBA.com League Roster',
      url: rosterSource,
      source_type: 'public_page',
      retrieved_at: rosterRetrievedAt,
      terms_status: 'reviewed',
      robots_status: 'unknown',
      notes: ['Official roster identity and roster-count source.'],
    },
    {
      name: 'Gambit Intel reviewed public-source capture',
      url: 'data/nba-context-graph/derived/teams.json',
      source_type: 'local_context_graph',
      retrieved_at: contextTeam?.last_updated ?? null,
      terms_status: 'not-applicable',
      robots_status: 'not-applicable',
      notes: ['Local reviewed artifact used only for fields already captured with sources.'],
    },
  ];

  const publicSources = [
    contextTeam?.cap_situation?.source,
    ...(contextTeam?.cap_situation?.source_fallbacks_used ?? []),
    ...(contextTeam?.sources_used ?? []),
  ].filter((url): url is string => Boolean(url && url !== 'unknown'));

  for (const url of Array.from(new Set(publicSources)).slice(0, 8)) {
    refs.push({
      name: sourceName(url),
      url,
      source_type: 'public_page',
      retrieved_at: contextTeam?.last_updated ?? null,
      terms_status: /salaryswish/i.test(url) ? 'restricted' : 'unknown',
      robots_status: 'unknown',
      notes: ['Referenced by the reviewed Intel capture; live refresh remains gated.'],
    });
  }
  return refs;
}

function restrictionsFromContext(player: ContextRosterPlayer | null): string[] {
  if (!player) return [];
  const restrictions = [];
  if (player.contract?.no_trade_clause && player.contract.no_trade_clause !== 'none') {
    restrictions.push(`No-trade clause: ${player.contract.no_trade_clause}`);
  }
  if (player.contract?.trade_kicker && player.contract.trade_kicker !== 'none') {
    restrictions.push(`Trade kicker: ${player.contract.trade_kicker}`);
  }
  if (player.movement_constraints?.status) {
    restrictions.push(`Movement status: ${player.movement_constraints.status}`);
  }
  return restrictions;
}

function metric(
  key: string,
  label: string,
  value: string,
  amount: number | null,
  sourceUrl: string | null | undefined,
  note: string | null = null,
): NbaCapSheetMetric {
  return {
    key,
    label,
    value,
    amount,
    source_status: value === 'Source needed' ? 'source-needed' : 'captured',
    source_url: sourceUrl ?? null,
    note,
  };
}

function moneyDelta(
  lhs: number | null,
  rhs: number | null,
  positiveWord: string,
  negativeWord: string,
): string {
  if (lhs == null || rhs == null) return 'Source needed';
  const delta = lhs - rhs;
  return `${money(Math.abs(delta))} ${delta >= 0 ? positiveWord : negativeWord}`;
}

function hardCapMetricValue(reason: string | undefined): string {
  if (!reason) return 'Source needed';
  if (/^none$/i.test(reason.trim())) return 'No hard cap';
  if (/second apron/i.test(reason)) return '2nd apron hard cap';
  if (/first apron/i.test(reason)) return '1st apron hard cap';
  return 'Hard-capped';
}

function hardCapMetricNote(reason: string | undefined): string | null {
  if (!reason) return null;
  if (/^none$/i.test(reason.trim())) return null;
  if (/horford/i.test(reason) && /(taxpayer mid-level|tmle)/i.test(reason)) {
    return 'TMLE used on Al Horford.';
  }
  return reason;
}

function capStatusNote(status: string | undefined): string | null {
  if (!status) return null;
  if (status === 'between_aprons') return 'Above the first apron and below the second apron.';
  if (status === 'second_apron') return 'At or above the second apron.';
  if (status === 'above_first_apron') return 'Above the first apron.';
  if (status === 'below_first_apron') return 'Below the first apron.';
  if (status === 'below_apron') return 'Below the apron.';
  if (status === 'below_cap') return 'Below the salary cap.';
  return null;
}

function sourceNeededMetric(key: string, label: string): NbaCapSheetMetric {
  return {
    key,
    label,
    value: 'Source needed',
    amount: null,
    source_status: 'source-needed',
    source_url: null,
    note: 'No reviewed source field was captured in the seed artifact.',
  };
}

function capturedSection(
  key: string,
  title: string,
  rows: Record<string, unknown>[],
  sourceUrl: string | null | undefined,
  notes: string[] = [],
): NbaCapSheetSection {
  return {
    key,
    title,
    source_status: rows.length > 0 && rows.some((row) => !String(row.value ?? '').includes('Source needed')) ? 'captured' : 'source-needed',
    source_url: sourceUrl ?? null,
    notes,
    rows,
  };
}

function capturedOrNeededSection(
  key: string,
  title: string,
  rows: Record<string, unknown>[],
  sourceUrl: string | null | undefined,
  missingNote: string,
): NbaCapSheetSection {
  if (rows.length === 0) return sourceNeededSection(key, title, missingNote);
  return {
    key,
    title,
    source_status: 'captured',
    source_url: sourceUrl ?? null,
    notes: [],
    rows,
  };
}

function sourceNeededSection(key: string, title: string, note: string): NbaCapSheetSection {
  return {
    key,
    title,
    source_status: 'source-needed',
    source_url: null,
    notes: [note],
    rows: [{ status: 'Source needed', detail: note }],
  };
}

function optionTypeForSeason(season: string, contract: ContextRosterPlayer['contract'] | null): string | null {
  const seasonEnd = season.split('-')[0] === '2025' ? '2026' : `20${season.split('-')[1]}`;
  if (contract?.player_option != null && String(contract.player_option) === seasonEnd) return 'player';
  if (contract?.team_option != null && String(contract.team_option) === seasonEnd) return 'team';
  return null;
}

function firstSource(rows: Record<string, unknown>[] | undefined): string | null {
  const row = rows?.find((item) => typeof item.source === 'string' && item.source && item.source !== 'unknown');
  return typeof row?.source === 'string' ? row.source : null;
}

function firstRosterSource(contextTeam: ContextTeam | null): string | null {
  return firstSource((contextTeam?.roster ?? []) as unknown as Record<string, unknown>[]) ?? null;
}

function sourceName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('spotrac')) return 'Spotrac';
    if (host.includes('salaryswish')) return 'SalarySwish';
    if (host.includes('realgm')) return 'RealGM';
    if (host.includes('nba.com')) return 'NBA.com';
    return host;
  } catch {
    return 'Public source';
  }
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stringOrSourceNeeded(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : 'Source needed';
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function parseSecondApron(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/second apron\s*\(\$?([0-9.]+)M\)/i);
  return match ? `$${match[1]}M` : null;
}

function parseMoneyFromText(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\$([0-9.]+)M/i);
  return match ? Math.round(Number(match[1]) * 1_000_000) : null;
}

function parseArgs(args: string[]): BuildOptions {
  const opts: BuildOptions = {
    rosterPath: DEFAULT_NBA_ROSTER_SEED_PATH,
    contextGraphPath: DEFAULT_CONTEXT_GRAPH_PATH,
    outPath: DEFAULT_OUT_PATH,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--roster' && args[i + 1]) opts.rosterPath = args[++i];
    else if (arg === '--context-graph' && args[i + 1]) opts.contextGraphPath = args[++i];
    else if (arg === '--out' && args[i + 1]) opts.outPath = args[++i];
  }
  return opts;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((err) => {
    console.error('NBA cap sheet snapshot build failed:', err);
    process.exit(1);
  });
}
