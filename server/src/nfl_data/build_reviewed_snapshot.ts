import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_NFL_DEMO_SEED_PATH,
  type NflCapRow,
  type NflDemoSeed,
  type NflDemoTeam,
  type NflPlayerMetricRow,
  type NflRosterEntry,
  validateNflDemoSeed,
} from './seed.js';

const AS_OF_DATE = '2026-06-25';
const RETRIEVED_AT = '2026-06-25T11:45:00.000Z';
const DEFAULT_NFL_PLAYER_METRICS_FIXTURE_PATH = fileURLToPath(
  new URL('../../../data/nfl-player-metrics/reviewed-2025.json', import.meta.url),
);
const DEFAULT_NFL_CONTRACT_LEDGER_REPORT_PATH = fileURLToPath(
  new URL('../../../data/nfl-demo/contract-ledger-source-report.json', import.meta.url),
);
const NFLVERSE_STATS_PLAYER_2025_URL = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_2025.csv';
const NFLVERSE_SNAP_COUNTS_2025_URL = 'https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2025.csv';

interface TeamConfig extends NflDemoTeam {
  nfl_slug: string;
  otc_slug: string;
}

const TEAMS: TeamConfig[] = [
  { team_id: 'ARI', abbreviation: 'ARI', full_name: 'Arizona Cardinals', conference: 'NFC', division: 'NFC West', source_url: 'https://www.nfl.com/teams/arizona-cardinals/roster', nfl_slug: 'arizona-cardinals', otc_slug: 'arizona-cardinals' },
  { team_id: 'ATL', abbreviation: 'ATL', full_name: 'Atlanta Falcons', conference: 'NFC', division: 'NFC South', source_url: 'https://www.nfl.com/teams/atlanta-falcons/roster', nfl_slug: 'atlanta-falcons', otc_slug: 'atlanta-falcons' },
  { team_id: 'BAL', abbreviation: 'BAL', full_name: 'Baltimore Ravens', conference: 'AFC', division: 'AFC North', source_url: 'https://www.nfl.com/teams/baltimore-ravens/roster', nfl_slug: 'baltimore-ravens', otc_slug: 'baltimore-ravens' },
  { team_id: 'BUF', abbreviation: 'BUF', full_name: 'Buffalo Bills', conference: 'AFC', division: 'AFC East', source_url: 'https://www.nfl.com/teams/buffalo-bills/roster', nfl_slug: 'buffalo-bills', otc_slug: 'buffalo-bills' },
  { team_id: 'CAR', abbreviation: 'CAR', full_name: 'Carolina Panthers', conference: 'NFC', division: 'NFC South', source_url: 'https://www.nfl.com/teams/carolina-panthers/roster', nfl_slug: 'carolina-panthers', otc_slug: 'carolina-panthers' },
  { team_id: 'CHI', abbreviation: 'CHI', full_name: 'Chicago Bears', conference: 'NFC', division: 'NFC North', source_url: 'https://www.nfl.com/teams/chicago-bears/roster', nfl_slug: 'chicago-bears', otc_slug: 'chicago-bears' },
  { team_id: 'CIN', abbreviation: 'CIN', full_name: 'Cincinnati Bengals', conference: 'AFC', division: 'AFC North', source_url: 'https://www.nfl.com/teams/cincinnati-bengals/roster', nfl_slug: 'cincinnati-bengals', otc_slug: 'cincinnati-bengals' },
  { team_id: 'CLE', abbreviation: 'CLE', full_name: 'Cleveland Browns', conference: 'AFC', division: 'AFC North', source_url: 'https://www.nfl.com/teams/cleveland-browns/roster', nfl_slug: 'cleveland-browns', otc_slug: 'cleveland-browns' },
  { team_id: 'DAL', abbreviation: 'DAL', full_name: 'Dallas Cowboys', conference: 'NFC', division: 'NFC East', source_url: 'https://www.nfl.com/teams/dallas-cowboys/roster', nfl_slug: 'dallas-cowboys', otc_slug: 'dallas-cowboys' },
  { team_id: 'DEN', abbreviation: 'DEN', full_name: 'Denver Broncos', conference: 'AFC', division: 'AFC West', source_url: 'https://www.nfl.com/teams/denver-broncos/roster', nfl_slug: 'denver-broncos', otc_slug: 'denver-broncos' },
  { team_id: 'DET', abbreviation: 'DET', full_name: 'Detroit Lions', conference: 'NFC', division: 'NFC North', source_url: 'https://www.nfl.com/teams/detroit-lions/roster', nfl_slug: 'detroit-lions', otc_slug: 'detroit-lions' },
  { team_id: 'GB', abbreviation: 'GB', full_name: 'Green Bay Packers', conference: 'NFC', division: 'NFC North', source_url: 'https://www.nfl.com/teams/green-bay-packers/roster', nfl_slug: 'green-bay-packers', otc_slug: 'green-bay-packers' },
  { team_id: 'HOU', abbreviation: 'HOU', full_name: 'Houston Texans', conference: 'AFC', division: 'AFC South', source_url: 'https://www.nfl.com/teams/houston-texans/roster', nfl_slug: 'houston-texans', otc_slug: 'houston-texans' },
  { team_id: 'IND', abbreviation: 'IND', full_name: 'Indianapolis Colts', conference: 'AFC', division: 'AFC South', source_url: 'https://www.nfl.com/teams/indianapolis-colts/roster', nfl_slug: 'indianapolis-colts', otc_slug: 'indianapolis-colts' },
  { team_id: 'JAX', abbreviation: 'JAX', full_name: 'Jacksonville Jaguars', conference: 'AFC', division: 'AFC South', source_url: 'https://www.nfl.com/teams/jacksonville-jaguars/roster', nfl_slug: 'jacksonville-jaguars', otc_slug: 'jacksonville-jaguars' },
  { team_id: 'KC', abbreviation: 'KC', full_name: 'Kansas City Chiefs', conference: 'AFC', division: 'AFC West', source_url: 'https://www.nfl.com/teams/kansas-city-chiefs/roster', nfl_slug: 'kansas-city-chiefs', otc_slug: 'kansas-city-chiefs' },
  { team_id: 'LAC', abbreviation: 'LAC', full_name: 'Los Angeles Chargers', conference: 'AFC', division: 'AFC West', source_url: 'https://www.nfl.com/teams/los-angeles-chargers/roster', nfl_slug: 'los-angeles-chargers', otc_slug: 'los-angeles-chargers' },
  { team_id: 'LAR', abbreviation: 'LAR', full_name: 'Los Angeles Rams', conference: 'NFC', division: 'NFC West', source_url: 'https://www.nfl.com/teams/los-angeles-rams/roster', nfl_slug: 'los-angeles-rams', otc_slug: 'los-angeles-rams' },
  { team_id: 'LV', abbreviation: 'LV', full_name: 'Las Vegas Raiders', conference: 'AFC', division: 'AFC West', source_url: 'https://www.nfl.com/teams/las-vegas-raiders/roster', nfl_slug: 'las-vegas-raiders', otc_slug: 'las-vegas-raiders' },
  { team_id: 'MIA', abbreviation: 'MIA', full_name: 'Miami Dolphins', conference: 'AFC', division: 'AFC East', source_url: 'https://www.nfl.com/teams/miami-dolphins/roster', nfl_slug: 'miami-dolphins', otc_slug: 'miami-dolphins' },
  { team_id: 'MIN', abbreviation: 'MIN', full_name: 'Minnesota Vikings', conference: 'NFC', division: 'NFC North', source_url: 'https://www.nfl.com/teams/minnesota-vikings/roster', nfl_slug: 'minnesota-vikings', otc_slug: 'minnesota-vikings' },
  { team_id: 'NE', abbreviation: 'NE', full_name: 'New England Patriots', conference: 'AFC', division: 'AFC East', source_url: 'https://www.nfl.com/teams/new-england-patriots/roster', nfl_slug: 'new-england-patriots', otc_slug: 'new-england-patriots' },
  { team_id: 'NO', abbreviation: 'NO', full_name: 'New Orleans Saints', conference: 'NFC', division: 'NFC South', source_url: 'https://www.nfl.com/teams/new-orleans-saints/roster', nfl_slug: 'new-orleans-saints', otc_slug: 'new-orleans-saints' },
  { team_id: 'NYG', abbreviation: 'NYG', full_name: 'New York Giants', conference: 'NFC', division: 'NFC East', source_url: 'https://www.nfl.com/teams/new-york-giants/roster', nfl_slug: 'new-york-giants', otc_slug: 'new-york-giants' },
  { team_id: 'NYJ', abbreviation: 'NYJ', full_name: 'New York Jets', conference: 'AFC', division: 'AFC East', source_url: 'https://www.nfl.com/teams/new-york-jets/roster', nfl_slug: 'new-york-jets', otc_slug: 'new-york-jets' },
  { team_id: 'PHI', abbreviation: 'PHI', full_name: 'Philadelphia Eagles', conference: 'NFC', division: 'NFC East', source_url: 'https://www.nfl.com/teams/philadelphia-eagles/roster', nfl_slug: 'philadelphia-eagles', otc_slug: 'philadelphia-eagles' },
  { team_id: 'PIT', abbreviation: 'PIT', full_name: 'Pittsburgh Steelers', conference: 'AFC', division: 'AFC North', source_url: 'https://www.nfl.com/teams/pittsburgh-steelers/roster', nfl_slug: 'pittsburgh-steelers', otc_slug: 'pittsburgh-steelers' },
  { team_id: 'SEA', abbreviation: 'SEA', full_name: 'Seattle Seahawks', conference: 'NFC', division: 'NFC West', source_url: 'https://www.nfl.com/teams/seattle-seahawks/roster', nfl_slug: 'seattle-seahawks', otc_slug: 'seattle-seahawks' },
  { team_id: 'SF', abbreviation: 'SF', full_name: 'San Francisco 49ers', conference: 'NFC', division: 'NFC West', source_url: 'https://www.nfl.com/teams/san-francisco-49ers/roster', nfl_slug: 'san-francisco-49ers', otc_slug: 'san-francisco-49ers' },
  { team_id: 'TB', abbreviation: 'TB', full_name: 'Tampa Bay Buccaneers', conference: 'NFC', division: 'NFC South', source_url: 'https://www.nfl.com/teams/tampa-bay-buccaneers/roster', nfl_slug: 'tampa-bay-buccaneers', otc_slug: 'tampa-bay-buccaneers' },
  { team_id: 'TEN', abbreviation: 'TEN', full_name: 'Tennessee Titans', conference: 'AFC', division: 'AFC South', source_url: 'https://www.nfl.com/teams/tennessee-titans/roster', nfl_slug: 'tennessee-titans', otc_slug: 'tennessee-titans' },
  { team_id: 'WAS', abbreviation: 'WAS', full_name: 'Washington Commanders', conference: 'NFC', division: 'NFC East', source_url: 'https://www.nfl.com/teams/washington-commanders/roster', nfl_slug: 'washington-commanders', otc_slug: 'washington-commanders' },
];

interface ParsedRosterRow {
  player_id: string;
  player_name: string;
  position: string | null;
  roster_status: string;
  source_order: number;
  source_url: string;
  jersey_number: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  experience: string | null;
  college: string | null;
}

export interface ParsedOtcYearRow {
  season: string;
  player_name: string;
  source_url: string;
  base_salary: number | null;
  signing_proration: number | null;
  option_proration: number | null;
  roster_bonus_regular: number | null;
  roster_bonus_per_game: number | null;
  workout_bonus: number | null;
  other_bonus: number | null;
  guaranteed_salary: number | null;
  cap_number: number | null;
  dead_money_cut: number | null;
  cut_savings: number | null;
  post_june_1_dead_money_cut: number | null;
  post_june_1_cut_savings: number | null;
  trade_dead_money: number | null;
  trade_savings: number | null;
  post_june_1_trade_dead_money: number | null;
  post_june_1_trade_savings: number | null;
  restructure_savings: number | null;
  extension_savings: number | null;
}

interface ParsedOtcLedger {
  player_name: string;
  source_team_id: string;
  source_url: string;
  current: ParsedOtcYearRow | null;
  rows: ParsedOtcYearRow[];
}

interface ContractLedgerSummary {
  contract_end_year: number | null;
  contract_years_remaining: number | null;
  void_year_count: number | null;
  void_years_source_status: NflCapRow['void_years_source_status'];
  total_value_remaining: number | null;
  contract_ledger_status: NflCapRow['contract_ledger_status'];
  contract_ledger_confidence: NflCapRow['contract_ledger_confidence'];
  contract_years: Record<string, unknown>[];
}

interface EstimatedContractLedger extends ContractLedgerSummary {
  cap_number_2026: number;
  cash_due_2026: number;
  guaranteed_remaining: number;
  dead_money_if_cut_2026: number;
  cut_savings_2026: number;
  post_june_1_dead_money_2026: number;
  post_june_1_cut_savings_2026: number;
  trade_dead_money_2026: number;
  trade_savings_2026: number;
  post_june_1_trade_dead_money_2026: number;
  post_june_1_trade_savings_2026: number;
  source_url: string;
  estimated_fields: string[];
}

interface PublicMetricAggregate {
  player_name: string;
  team_ids: string[];
  position: string | null;
  offense_snaps_2025: number;
  defense_snaps_2025: number;
  special_teams_snaps_2025: number;
  snap_share_samples: number[];
  games_2025: number | null;
  starts_2025: number | null;
  passing_yards_2025: number | null;
  rushing_yards_2025: number | null;
  receiving_yards_2025: number | null;
  scrimmage_yards_2025: number | null;
  tackles_2025: number | null;
  sacks_2025: number | null;
  interceptions_2025: number | null;
  touchdowns_2025: number | null;
  source_families: Set<string>;
  source_urls: Set<string>;
  source_rows: Record<string, unknown>[];
}

interface PublicMetricIndex {
  byTeamName: Map<string, PublicMetricAggregate>;
  byName: Map<string, PublicMetricAggregate[]>;
  fixture: Record<string, unknown>;
}

async function main() {
  const existing = await readExistingSeed();
  const existingCap = new Map(existing?.cap_rows.map((row) => [`${row.team_id}:${normalizeName(row.player_name)}`, row]) ?? []);
  const publicMetrics = await loadPublicMetricIndex();
  const teams = TEAMS.map(({ nfl_slug, otc_slug, ...team }) => team);
  const rosterEntries: NflRosterEntry[] = [];
  const capRows: NflCapRow[] = [];
  const metricRows: NflPlayerMetricRow[] = [];
  const teamSnapshots = await Promise.all(TEAMS.map(async (team) => {
    const [rosterRows, otcLedgers] = await Promise.all([
      fetchOfficialRoster(team),
      fetchOtcContractLedgers(team),
    ]);
    return { team, rosterRows, otcLedgers };
  }));
  const globalOtcByName = new Map<string, ParsedOtcLedger[]>();
  for (const snapshot of teamSnapshots) {
    for (const ledger of snapshot.otcLedgers) {
      const key = normalizeName(ledger.player_name);
      const rows = globalOtcByName.get(key) ?? [];
      rows.push(ledger);
      globalOtcByName.set(key, rows);
    }
  }

  for (const { team, rosterRows, otcLedgers } of teamSnapshots) {
    const otcByName = new Map<string, ParsedOtcLedger>();
    for (const ledger of otcLedgers) otcByName.set(normalizeName(ledger.player_name), ledger);

    for (const roster of rosterRows) {
      const rosterEntry: NflRosterEntry = {
        team_id: team.team_id,
        player_id: roster.player_id,
        player_name: roster.player_name,
        position: roster.position,
        age: null,
        roster_status: roster.roster_status,
        contract_status: 'offseason_roster',
        source_order: roster.source_order,
        source_url: roster.source_url,
        source_note: 'Captured from NFL.com official team roster table.',
        jersey_number: roster.jersey_number,
        height_inches: roster.height_inches,
        weight_lbs: roster.weight_lbs,
        experience: roster.experience,
        college: roster.college,
      };
      rosterEntries.push(rosterEntry);

      const teamOtcLedger = otcByName.get(normalizeName(roster.player_name)) ?? null;
      const globalOtcLedger = teamOtcLedger ?? uniqueGlobalOtcLedger(globalOtcByName, roster.player_name);
      const otcLedger = globalOtcLedger;
      const otcTeamMismatch = Boolean(otcLedger && !teamOtcLedger && otcLedger.source_team_id !== team.team_id);
      const otc = otcLedger?.current ?? null;
      const oldCap = existingCap.get(`${team.team_id}:${normalizeName(roster.player_name)}`) ?? null;
      const publicMetric = lookupPublicMetric(publicMetrics, team.team_id, roster);
      const estimatedLedger = otc || !shouldEstimateLowCapContract(roster, publicMetric)
        ? null
        : estimateLowCapContractLedger(roster, team);
      const sourceStatus: NflCapRow['source_status'] = otc ? 'captured' : estimatedLedger ? 'estimated' : 'source-needed';
      const ledger = otc ? summarizeContractLedger(otcLedger?.rows ?? []) : estimatedLedger ?? summarizeContractLedger([]);
      const cashDue = otc
        ? sumNumbers([otc.base_salary, otc.roster_bonus_regular, otc.roster_bonus_per_game, otc.workout_bonus, otc.other_bonus])
        : estimatedLedger?.cash_due_2026 ?? null;
      capRows.push({
        team_id: team.team_id,
        player_id: roster.player_id,
        player_name: roster.player_name,
        position: roster.position,
        cap_number_2026: otc?.cap_number ?? estimatedLedger?.cap_number_2026 ?? null,
        cash_due_2026: cashDue,
        total_value_remaining: ledger.total_value_remaining ?? oldCap?.total_value_remaining ?? null,
        years_remaining: ledger.contract_years_remaining,
        contract_end_year: ledger.contract_end_year,
        contract_years_remaining: ledger.contract_years_remaining,
        void_year_count: ledger.void_year_count,
        void_years_source_status: ledger.void_years_source_status,
        guaranteed_remaining: otc?.guaranteed_salary ?? estimatedLedger?.guaranteed_remaining ?? oldCap?.guaranteed_remaining ?? null,
        dead_money_if_cut_2026: otc?.dead_money_cut ?? estimatedLedger?.dead_money_if_cut_2026 ?? null,
        cut_savings_2026: otc?.cut_savings ?? estimatedLedger?.cut_savings_2026 ?? null,
        post_june_1_dead_money_2026: otc?.post_june_1_dead_money_cut ?? estimatedLedger?.post_june_1_dead_money_2026 ?? null,
        post_june_1_cut_savings_2026: otc?.post_june_1_cut_savings ?? estimatedLedger?.post_june_1_cut_savings_2026 ?? null,
        trade_dead_money_2026: otc?.trade_dead_money ?? estimatedLedger?.trade_dead_money_2026 ?? null,
        trade_savings_2026: otc?.trade_savings ?? estimatedLedger?.trade_savings_2026 ?? null,
        post_june_1_trade_dead_money_2026: otc?.post_june_1_trade_dead_money ?? estimatedLedger?.post_june_1_trade_dead_money_2026 ?? null,
        post_june_1_trade_savings_2026: otc?.post_june_1_trade_savings ?? estimatedLedger?.post_june_1_trade_savings_2026 ?? null,
        restructure_savings_estimate_2026: otc ? Math.max(otc.restructure_savings ?? 0, 0) : null,
        extension_savings_estimate_2026: otc ? Math.max(otc.extension_savings ?? 0, 0) : null,
        contract_ledger_status: ledger.contract_ledger_status,
        contract_ledger_confidence: ledger.contract_ledger_confidence,
        tag_eligible_2027: oldCap?.tag_eligible_2027 ?? false,
        contract_lever: oldCap?.contract_lever ?? contractLever(otc, estimatedLedger),
        source_url: otc?.source_url ?? estimatedLedger?.source_url ?? team.source_url,
        source_status: sourceStatus,
        source_order: roster.source_order,
        source_note: otc
          ? otcTeamMismatch
            ? `Captured from a unique OverTheCap ${otcLedger?.source_team_id} contract row and joined to NFL.com ${team.team_id} roster row; team/source mismatch needs review before external use.`
            : 'Captured from OverTheCap team salary-cap table Contract Ledger v1 and joined to NFL.com roster row.'
          : estimatedLedger
            ? 'Estimated low-cap/offseason contract placeholder from NFL.com roster row because no matching OverTheCap row was found; use for coverage and directional cap math, not exact legal modeling.'
            : 'Roster player present on NFL.com; matching OverTheCap row not found in this snapshot.',
        source_data: {
          otc_player_name: otc?.player_name ?? null,
          otc_source_team_id: otcLedger?.source_team_id ?? null,
          otc_team_mismatch: otcTeamMismatch,
          roster_player_name: roster.player_name,
          source_needed_fields: otc || estimatedLedger ? [] : [
            'cap_number_2026',
            'cash_due_2026',
            'contract_end_year',
            'contract_years_remaining',
            'void_year_count',
            'guaranteed_remaining',
            'dead_money_if_cut_2026',
            'cut_savings_2026',
            'post_june_1_dead_money_2026',
            'post_june_1_cut_savings_2026',
            'trade_dead_money_2026',
            'trade_savings_2026',
            'restructure_savings_estimate_2026',
          ],
          estimated_fields: estimatedLedger ? estimatedLedger.estimated_fields : [],
          contract_years: ledger.contract_years,
          contract_ledger: {
            status: ledger.contract_ledger_status,
            confidence: ledger.contract_ledger_confidence,
            void_years_source_status: ledger.void_years_source_status,
          },
        },
      });

      metricRows.push(buildMetricRow(team, roster, otc, estimatedLedger, publicMetric));
    }
    const sourceNeeded = capRows.filter((row) => row.team_id === team.team_id && row.source_status === 'source-needed').length;
    console.log(`${team.team_id}: roster=${rosterRows.length} otc=${otcLedgers.length} source_needed=${sourceNeeded}`);
  }

  const seed: NflDemoSeed = {
    schema_version: 1,
    season: '2026 offseason',
    as_of_date: AS_OF_DATE,
    source_name: 'NFL.com official roster pages + OverTheCap Contract Ledger v1',
    source_url: 'https://www.nfl.com/teams/',
    retrieved_at: RETRIEVED_AT,
    notes: [
      'Official offseason roster universe is captured from NFL.com team roster pages.',
      'Cap rows are joined from OverTheCap team salary-cap pages where names match the official roster row.',
      'Contract Ledger v1 captures 2026 cap mechanics, future-year contract rows, post-June-1/trade/restructure/extension values, void-year indicators, and confidence flags from team salary-cap pages.',
      'Every roster player has a cap row; unmatched low-cap/offseason rows are marked estimated with confidence flags, while unresolved rows stay source-needed.',
      'Player metric rows join public nflverse 2025 snap counts and player stats where a reviewed name/team or unique-name match exists; rookies and no-snap offseason bodies keep explicit gap reasons.',
    ],
    teams,
    roster_entries: rosterEntries,
    cap_rows: capRows,
    player_metrics: metricRows,
    source_refs: [
      { id: 'nfl_official_rosters', name: 'NFL.com official team roster pages', url: 'https://www.nfl.com/teams/' },
      { id: 'overthecap_contract_ledger_v1', name: 'OverTheCap team salary-cap pages - Contract Ledger v1', url: 'https://overthecap.com/salary-cap/' },
      { id: 'nflverse_snap_counts_2025', name: 'nflverse snap_counts 2025 regular season release', url: NFLVERSE_SNAP_COUNTS_2025_URL },
      { id: 'nflverse_stats_player_2025', name: 'nflverse stats_player 2025 regular season release', url: NFLVERSE_STATS_PLAYER_2025_URL },
    ],
  };

  const summary = validateNflDemoSeed(seed);
  await mkdir(dirname(DEFAULT_NFL_DEMO_SEED_PATH), { recursive: true });
  await writeFile(DEFAULT_NFL_DEMO_SEED_PATH, `${JSON.stringify(seed, null, 2)}\n`);
  await writePublicMetricFixture(publicMetrics);
  await writeContractLedgerReport(seed);
  console.log(`Wrote ${DEFAULT_NFL_DEMO_SEED_PATH}`);
  console.log(`Wrote ${DEFAULT_NFL_PLAYER_METRICS_FIXTURE_PATH}`);
  console.log(`Wrote ${DEFAULT_NFL_CONTRACT_LEDGER_REPORT_PATH}`);
  console.log(summary);
}

async function loadPublicMetricIndex(): Promise<PublicMetricIndex> {
  try {
    const [statsCsv, snapCsv] = await Promise.all([
      fetchText(NFLVERSE_STATS_PLAYER_2025_URL),
      fetchText(NFLVERSE_SNAP_COUNTS_2025_URL),
    ]);
    return buildPublicMetricIndex(statsCsv, snapCsv);
  } catch (error) {
    const existingFixture = await readExistingMetricFixture();
    if (existingFixture) return existingFixture;
    throw error;
  }
}

export function buildPublicMetricIndex(statsPlayerCsv: string, snapCountsCsv: string): PublicMetricIndex {
  const aggregates = new Map<string, PublicMetricAggregate>();
  const byName = new Map<string, PublicMetricAggregate[]>();
  const byTeamName = new Map<string, PublicMetricAggregate>();

  for (const row of parseCsvRecords(snapCountsCsv)) {
    const teamId = normalizeMetricTeam(String(row.team ?? ''));
    const playerName = String(row.player ?? '').trim();
    if (!teamId || !playerName) continue;
    const aggregate = metricAggregate(aggregates, byTeamName, byName, teamId, playerName, String(row.position ?? '') || null);
    aggregate.offense_snaps_2025 += integer(row.offense_snaps) ?? 0;
    aggregate.defense_snaps_2025 += integer(row.defense_snaps) ?? 0;
    aggregate.special_teams_snaps_2025 += integer(row.st_snaps) ?? 0;
    const share = primarySnapShare(row, aggregate.position);
    if (share != null) aggregate.snap_share_samples.push(share);
    aggregate.source_families.add('nflverse_snap_counts');
    aggregate.source_urls.add(NFLVERSE_SNAP_COUNTS_2025_URL);
  }

  for (const row of parseCsvRecords(statsPlayerCsv)) {
    const teamId = normalizeMetricTeam(String(row.recent_team ?? row.team ?? ''));
    const playerName = String(row.player_display_name ?? row.player_name ?? '').trim();
    if (!teamId || !playerName) continue;
    const aggregate = metricAggregate(aggregates, byTeamName, byName, teamId, playerName, String(row.position ?? '') || null);
    aggregate.games_2025 = Math.max(aggregate.games_2025 ?? 0, integer(row.games) ?? 0);
    aggregate.starts_2025 = aggregate.starts_2025 ?? integer(row.starts);
    aggregate.passing_yards_2025 = sumMetric(aggregate.passing_yards_2025, integer(row.passing_yards));
    aggregate.rushing_yards_2025 = sumMetric(aggregate.rushing_yards_2025, integer(row.rushing_yards));
    aggregate.receiving_yards_2025 = sumMetric(aggregate.receiving_yards_2025, integer(row.receiving_yards));
    aggregate.scrimmage_yards_2025 = sumMetric(aggregate.scrimmage_yards_2025, sumNullable([integer(row.rushing_yards), integer(row.receiving_yards)]));
    aggregate.tackles_2025 = sumMetric(aggregate.tackles_2025, sumNullable([integer(row.def_tackles_solo), integer(row.def_tackles_with_assist)]));
    aggregate.sacks_2025 = sumMetric(aggregate.sacks_2025, number(row.def_sacks));
    aggregate.interceptions_2025 = sumMetric(aggregate.interceptions_2025, integer(row.def_interceptions));
    aggregate.touchdowns_2025 = sumMetric(aggregate.touchdowns_2025, sumNullable([
      integer(row.passing_tds),
      integer(row.rushing_tds),
      integer(row.receiving_tds),
      integer(row.def_tds),
    ]));
    aggregate.source_families.add('nflverse_stats_player');
    aggregate.source_urls.add(NFLVERSE_STATS_PLAYER_2025_URL);
  }

  return {
    byTeamName,
    byName,
    fixture: publicMetricFixture([...aggregates.values()]),
  };
}

function metricAggregate(
  aggregates: Map<string, PublicMetricAggregate>,
  byTeamName: Map<string, PublicMetricAggregate>,
  byName: Map<string, PublicMetricAggregate[]>,
  teamId: string,
  playerName: string,
  position: string | null,
): PublicMetricAggregate {
  const key = `${teamId}:${normalizeName(playerName)}`;
  let aggregate = aggregates.get(key);
  if (!aggregate) {
    aggregate = {
      player_name: playerName,
      team_ids: [teamId],
      position,
      offense_snaps_2025: 0,
      defense_snaps_2025: 0,
      special_teams_snaps_2025: 0,
      snap_share_samples: [],
      games_2025: null,
      starts_2025: null,
      passing_yards_2025: null,
      rushing_yards_2025: null,
      receiving_yards_2025: null,
      scrimmage_yards_2025: null,
      tackles_2025: null,
      sacks_2025: null,
      interceptions_2025: null,
      touchdowns_2025: null,
      source_families: new Set<string>(),
      source_urls: new Set<string>(),
      source_rows: [],
    };
    aggregates.set(key, aggregate);
    byTeamName.set(key, aggregate);
    const nameKey = normalizeName(playerName);
    const nameRows = byName.get(nameKey) ?? [];
    nameRows.push(aggregate);
    byName.set(nameKey, nameRows);
  }
  if (!aggregate.position && position) aggregate.position = position;
  if (!aggregate.team_ids.includes(teamId)) aggregate.team_ids.push(teamId);
  return aggregate;
}

function buildMetricRow(
  team: TeamConfig,
  roster: ParsedRosterRow,
  otc: ParsedOtcYearRow | null,
  estimatedLedger: EstimatedContractLedger | null,
  metric: PublicMetricAggregate | null,
): NflPlayerMetricRow {
  const snaps = metric
    ? metric.offense_snaps_2025 + metric.defense_snaps_2025 + metric.special_teams_snaps_2025
    : null;
  if (!metric) {
    const gapReason = roster.experience === 'R'
      ? 'rookie_or_no_2025_nfl_public_metric_sample'
      : 'no_unique_2025_public_metric_match';
    return {
      team_id: team.team_id,
      player_id: roster.player_id,
      player_name: roster.player_name,
      position: roster.position,
      snaps_2025: null,
      offense_snaps_2025: null,
      defense_snaps_2025: null,
      special_teams_snaps_2025: null,
      snap_share_2025: null,
      games_2025: null,
      starts_2025: null,
      passing_yards_2025: null,
      rushing_yards_2025: null,
      receiving_yards_2025: null,
      scrimmage_yards_2025: null,
      tackles_2025: null,
      sacks_2025: null,
      interceptions_2025: null,
      touchdowns_2025: null,
      availability_risk: 'no_2025_public_sample',
      role: rosterRole(otc, estimatedLedger),
      value_tier: valueTier(otc, estimatedLedger),
      metric_note: `No reviewed 2025 public snap/stat match in nflverse for this current-roster row (${gapReason}).`,
      metric_source_family: null,
      metric_gap_reason: gapReason,
      source_url: roster.source_url,
      source_status: 'source-needed',
      source_data: { match_status: 'missing', roster_player_name: roster.player_name, team_id: team.team_id },
    };
  }
  const sourceFamilies = [...metric.source_families].sort();
  const sourceUrls = [...metric.source_urls].sort();
  const snapShare = average(metric.snap_share_samples);
  return {
    team_id: team.team_id,
    player_id: roster.player_id,
    player_name: roster.player_name,
    position: roster.position,
    snaps_2025: snaps,
    offense_snaps_2025: metric.offense_snaps_2025,
    defense_snaps_2025: metric.defense_snaps_2025,
    special_teams_snaps_2025: metric.special_teams_snaps_2025,
    snap_share_2025: snapShare == null ? null : Number(snapShare.toFixed(3)),
    games_2025: metric.games_2025,
    starts_2025: metric.starts_2025,
    passing_yards_2025: metric.passing_yards_2025,
    rushing_yards_2025: metric.rushing_yards_2025,
    receiving_yards_2025: metric.receiving_yards_2025,
    scrimmage_yards_2025: metric.scrimmage_yards_2025,
    tackles_2025: metric.tackles_2025,
    sacks_2025: metric.sacks_2025,
    interceptions_2025: metric.interceptions_2025,
    touchdowns_2025: metric.touchdowns_2025,
    availability_risk: snaps && snaps > 0 ? 'played_2025_public_sample' : 'stats_only_public_sample',
    role: rosterRole(otc, estimatedLedger),
    value_tier: valueTier(otc, estimatedLedger),
    metric_note: `Captured 2025 public metrics from ${sourceFamilies.join(' + ')}; current team join may include prior-team 2025 production for offseason additions.`,
    metric_source_family: sourceFamilies.join('+'),
    metric_gap_reason: null,
    source_url: sourceUrls[0] ?? NFLVERSE_STATS_PLAYER_2025_URL,
    source_status: 'captured',
    source_data: {
      match_status: 'captured',
      matched_player_name: metric.player_name,
      matched_2025_team_ids: metric.team_ids,
      source_families: sourceFamilies,
      source_urls: sourceUrls,
    },
  };
}

function lookupPublicMetric(
  publicMetrics: PublicMetricIndex,
  teamId: string,
  roster: ParsedRosterRow,
): PublicMetricAggregate | null {
  const exact = publicMetrics.byTeamName.get(`${teamId}:${normalizeName(roster.player_name)}`);
  if (exact && positionsCompatible(roster.position, exact.position)) return exact;
  const candidates = publicMetrics.byName.get(normalizeName(roster.player_name)) ?? [];
  const compatible = candidates.filter((candidate) => positionsCompatible(roster.position, candidate.position));
  return compatible.length === 1 ? compatible[0] : null;
}

function uniqueGlobalOtcLedger(
  globalOtcByName: Map<string, ParsedOtcLedger[]>,
  playerName: string,
): ParsedOtcLedger | null {
  const matches = globalOtcByName.get(normalizeName(playerName)) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

function shouldEstimateLowCapContract(
  roster: ParsedRosterRow,
  metric: PublicMetricAggregate | null,
): boolean {
  const snaps = metric
    ? metric.offense_snaps_2025 + metric.defense_snaps_2025 + metric.special_teams_snaps_2025
    : 0;
  if (snaps > 0 || (metric?.games_2025 ?? 0) > 0) return false;
  const position = String(roster.position ?? '').toUpperCase();
  if (['K', 'P', 'LS'].includes(position)) return true;
  if (roster.experience === 'R') return false;
  const experience = Number(roster.experience);
  return Number.isFinite(experience) && experience <= 3;
}

function estimateLowCapContractLedger(roster: ParsedRosterRow, team: TeamConfig): EstimatedContractLedger {
  const cap = estimateMinimumSalary2026(roster.experience);
  const contractYear = {
    season: '2026',
    cap_number: cap,
    cash_due: cap,
    guaranteed_salary: 0,
    dead_money_cut: 0,
    post_june_1_dead_money_cut: 0,
    cut_savings: cap,
    post_june_1_cut_savings: cap,
    trade_dead_money: 0,
    trade_savings: cap,
    post_june_1_trade_dead_money: 0,
    post_june_1_trade_savings: cap,
    restructure_savings: 0,
    extension_savings: 0,
    void_year_candidate: false,
    source_url: team.source_url ?? 'https://www.nfl.com/teams/',
    estimate_basis: `NFL.com roster row; no OverTheCap ${team.team_id} match in this snapshot.`,
  };
  return {
    contract_end_year: 2026,
    contract_years_remaining: 1,
    void_year_count: 0,
    void_years_source_status: 'derived',
    total_value_remaining: cap,
    contract_ledger_status: 'captured',
    contract_ledger_confidence: 'estimated',
    contract_years: [contractYear],
    cap_number_2026: cap,
    cash_due_2026: cap,
    guaranteed_remaining: 0,
    dead_money_if_cut_2026: 0,
    cut_savings_2026: cap,
    post_june_1_dead_money_2026: 0,
    post_june_1_cut_savings_2026: cap,
    trade_dead_money_2026: 0,
    trade_savings_2026: cap,
    post_june_1_trade_dead_money_2026: 0,
    post_june_1_trade_savings_2026: cap,
    source_url: team.source_url ?? 'https://www.nfl.com/teams/',
    estimated_fields: [
      'cap_number_2026',
      'cash_due_2026',
      'contract_end_year',
      'contract_years_remaining',
      'dead_money_if_cut_2026',
      'cut_savings_2026',
      'post_june_1_cut_savings_2026',
      'trade_savings_2026',
    ],
  };
}

function estimateMinimumSalary2026(experience: string | null): number {
  const years = experience === 'R' || experience == null ? 0 : Number(experience);
  if (!Number.isFinite(years) || years <= 0) return 860_000;
  if (years === 1) return 960_000;
  if (years === 2) return 1_030_000;
  if (years === 3) return 1_100_000;
  if (years <= 6) return 1_185_000;
  return 1_255_000;
}

async function writePublicMetricFixture(publicMetrics: PublicMetricIndex) {
  await mkdir(dirname(DEFAULT_NFL_PLAYER_METRICS_FIXTURE_PATH), { recursive: true });
  await writeFile(DEFAULT_NFL_PLAYER_METRICS_FIXTURE_PATH, `${JSON.stringify(publicMetrics.fixture, null, 2)}\n`);
}

async function writeContractLedgerReport(seed: NflDemoSeed) {
  const sourceNeededRows = seed.cap_rows.filter((row) => row.source_status === 'source-needed');
  const estimatedRows = seed.cap_rows.filter((row) => row.source_status === 'estimated');
  const report = {
    generated_at: RETRIEVED_AT,
    as_of_date: seed.as_of_date,
    totals: {
      source_needed: sourceNeededRows.length,
      estimated: estimatedRows.length,
      source_needed_above_5m: sourceNeededRows.filter((row) => (row.cap_number_2026 ?? 0) > 5_000_000).length,
    },
    source_needed_rows: sourceNeededRows.map(contractReportRow),
    estimated_rows: estimatedRows.map(contractReportRow),
  };
  await mkdir(dirname(DEFAULT_NFL_CONTRACT_LEDGER_REPORT_PATH), { recursive: true });
  await writeFile(DEFAULT_NFL_CONTRACT_LEDGER_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

function contractReportRow(row: NflCapRow): Record<string, unknown> {
  return {
    team_id: row.team_id,
    player_id: row.player_id,
    player_name: row.player_name,
    position: row.position,
    cap_number_2026: row.cap_number_2026,
    source_status: row.source_status,
    contract_ledger_confidence: row.contract_ledger_confidence,
    source_note: row.source_note,
    source_url: row.source_url,
  };
}

async function fetchOfficialRoster(team: TeamConfig): Promise<ParsedRosterRow[]> {
  const url = `https://www.nfl.com/teams/${team.nfl_slug}/roster`;
  const html = await fetchText(url);
  const body = firstMatch(html, /<table summary="Roster"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/);
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((match, index) => rosterRow(match[1], team, index + 1))
    .filter((row): row is ParsedRosterRow => Boolean(row));
  if (rows.length < 70) throw new Error(`${team.team_id} official roster scrape returned ${rows.length} rows`);
  return rows;
}

function rosterRow(rowHtml: string, team: TeamConfig, sourceOrder: number): ParsedRosterRow | null {
  const nameMatch = rowHtml.match(/<a[^>]*class="[^"]*nfl-o-roster__player-name[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  if (!nameMatch) return null;
  const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => cleanText(match[1]));
  const href = nameMatch[1];
  const playerName = cleanText(nameMatch[2]);
  return {
    player_id: `nfl:${team.team_id}:${playerSlug(href, playerName)}`,
    player_name: playerName,
    position: emptyToNull(cells[2]),
    roster_status: normalizeRosterStatus(cells[3]),
    source_order: sourceOrder,
    source_url: href.startsWith('http') ? href : `https://www.nfl.com${href}`,
    jersey_number: emptyToNull(cells[1]),
    height_inches: numberOrNull(cells[4]),
    weight_lbs: numberOrNull(cells[5]),
    experience: emptyToNull(cells[6]),
    college: emptyToNull(cells[7]),
  };
}

async function fetchOtcContractLedgers(team: TeamConfig): Promise<ParsedOtcLedger[]> {
  const url = `https://overthecap.com/salary-cap/${team.otc_slug}`;
  const html = await fetchText(url);
  const rows = parseOtcCapYearsFromHtml(html, url);
  const currentRows = rows.filter((row) => row.season === '2026');
  if (currentRows.length === 0) throw new Error(`${team.team_id} OverTheCap page missing y2026 contracted player rows`);

  const byName = new Map<string, ParsedOtcYearRow[]>();
  for (const row of rows) {
    const key = normalizeName(row.player_name);
    const existing = byName.get(key) ?? [];
    existing.push(row);
    byName.set(key, existing);
  }

  return [...byName.values()].map((playerRows) => {
    const sorted = playerRows.slice().sort((a, b) => Number(a.season) - Number(b.season));
    const current = sorted.find((row) => row.season === '2026') ?? null;
    return {
      player_name: current?.player_name ?? sorted[0]?.player_name ?? 'Unknown',
      source_team_id: team.team_id,
      source_url: current?.source_url ?? sorted[0]?.source_url ?? url,
      current,
      rows: sorted,
    };
  }).filter((ledger) => ledger.current !== null);
}

export function parseOtcCapYearsFromHtml(html: string, teamUrl: string): ParsedOtcYearRow[] {
  const sectionMatches = [...html.matchAll(/<div class="salary-cap-container"\s+id="y(\d{4})">/g)];
  const rows: ParsedOtcYearRow[] = [];
  for (let index = 0; index < sectionMatches.length; index += 1) {
    const match = sectionMatches[index];
    const season = match[1];
    const start = match.index ?? 0;
    const end = sectionMatches[index + 1]?.index ?? html.length;
    const section = html.slice(start, end);
    const table = section.match(/<table class="salary-cap-table contracted-players">([\s\S]*?)<\/table>/)?.[1];
    if (!table) continue;
    const tbody = table.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1];
    if (!tbody) continue;
    rows.push(...[...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map((rowMatch) => otcYearRow(rowMatch[1], teamUrl, season))
      .filter((row): row is ParsedOtcYearRow => Boolean(row)));
  }
  return rows;
}

function otcYearRow(rowHtml: string, teamUrl: string, season: string): ParsedOtcYearRow | null {
  const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
  const nameMatch = cells[0]?.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  if (!nameMatch) return null;
  const sourceUrl = nameMatch[1].startsWith('http') ? nameMatch[1] : `https://overthecap.com${nameMatch[1]}`;
  return {
    season,
    player_name: cleanText(nameMatch[2]),
    source_url: sourceUrl || teamUrl,
    base_salary: money(cells[1]),
    signing_proration: money(cells[2]),
    option_proration: money(cells[3]),
    roster_bonus_regular: money(cells[4]),
    roster_bonus_per_game: money(cells[5]),
    workout_bonus: money(cells[6]),
    other_bonus: money(cells[7]),
    guaranteed_salary: money(cells[9]),
    cap_number: money(cells[11]),
    dead_money_cut: hiddenMoney(cells[13], 'cut'),
    cut_savings: hiddenMoney(cells[14], 'cut'),
    post_june_1_dead_money_cut: hiddenMoney(cells[13], 'june_1_cut'),
    post_june_1_cut_savings: hiddenMoney(cells[14], 'june_1_cut'),
    trade_dead_money: hiddenMoney(cells[13], 'trade'),
    trade_savings: hiddenMoney(cells[14], 'trade'),
    post_june_1_trade_dead_money: hiddenMoney(cells[13], 'june_1_trade'),
    post_june_1_trade_savings: hiddenMoney(cells[14], 'june_1_trade'),
    restructure_savings: hiddenMoney(cells[14], 'restructure'),
    extension_savings: hiddenMoney(cells[14], 'extension'),
  };
}

export function summarizeContractLedger(rows: ParsedOtcYearRow[]): ContractLedgerSummary {
  const sorted = rows
    .filter((row) => Number(row.season) >= 2026)
    .slice()
    .sort((a, b) => Number(a.season) - Number(b.season));
  const current = sorted.find((row) => row.season === '2026') ?? null;
  if (!current) {
    return {
      contract_end_year: null,
      contract_years_remaining: null,
      void_year_count: null,
      void_years_source_status: 'source-needed',
      total_value_remaining: null,
      contract_ledger_status: 'source-needed',
      contract_ledger_confidence: 'source-needed',
      contract_years: [],
    };
  }

  const contractRows = sorted.filter(hasContractYearSignal);
  const voidRows = contractRows.filter(isVoidYearCandidate);
  const nonVoidRows = contractRows.filter((row) => !isVoidYearCandidate(row));
  const countableRows = nonVoidRows.length > 0 ? nonVoidRows : contractRows;
  const contractYearsRemaining = countableRows.length > 0 ? countableRows.length : 1;
  const contractEndYear = countableRows.length > 0
    ? Math.max(...countableRows.map((row) => Number(row.season)))
    : 2026;
  const totalValueRemaining = sumNumbers(countableRows.map(cashDueForYear));
  const confidence = ledgerConfidence(current, countableRows.length, sorted.length);

  return {
    contract_end_year: contractEndYear,
    contract_years_remaining: contractYearsRemaining,
    void_year_count: voidRows.length,
    void_years_source_status: 'captured',
    total_value_remaining: totalValueRemaining,
    contract_ledger_status: 'captured',
    contract_ledger_confidence: confidence,
    contract_years: sorted.map(compactContractYear),
  };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'gambit-nfl-demo-reviewed-snapshot/1.0' } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.text();
}

async function readExistingSeed(): Promise<NflDemoSeed | null> {
  try {
    return JSON.parse(await readFile(DEFAULT_NFL_DEMO_SEED_PATH, 'utf8')) as NflDemoSeed;
  } catch {
    return null;
  }
}

function firstMatch(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (!match) throw new Error(`pattern not found: ${pattern.source.slice(0, 60)}`);
  return match[1];
}

function hiddenMoney(cell: string | undefined, className: string): number | null {
  if (!cell) return null;
  const match = cell.match(new RegExp(`<div class="${className}"[^>]*>([\\s\\S]*?)<\\/div>`));
  return match ? money(match[1]) : null;
}

function money(text: string | undefined): number | null {
  if (!text) return null;
  const cleaned = cleanText(text).replace(/[,$]/g, '').replace(/\s/g, '');
  if (!cleaned || cleaned === '-') return null;
  const negative = cleaned.includes('(') || cleaned.startsWith('-');
  const parsed = Number(cleaned.replace(/[()]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function playerSlug(href: string, playerName: string): string {
  const parts = href.split('/').filter(Boolean);
  return parts.at(-1) ?? normalizeName(playerName);
}

function contractLever(row: ParsedOtcYearRow | null, estimatedLedger: EstimatedContractLedger | null = null): string {
  if (estimatedLedger) return 'estimated_low_cap';
  if (!row) return 'source_needed';
  const restructure = row.restructure_savings ?? 0;
  const cut = row.cut_savings ?? 0;
  const cap = row.cap_number ?? 0;
  if (restructure >= 5_000_000) return 'restructure_candidate';
  if (cut >= 5_000_000) return 'cut_candidate';
  if ((row.extension_savings ?? 0) >= 5_000_000) return 'extension_candidate';
  if (cap >= 10_000_000) return 'core_contract';
  return 'depth_contract';
}

function rosterRole(row: ParsedOtcYearRow | null, estimatedLedger: EstimatedContractLedger | null = null): string {
  const cap = row?.cap_number ?? estimatedLedger?.cap_number_2026 ?? 0;
  if (cap >= 10_000_000) return 'core_or_high_cap';
  if (cap >= 2_000_000) return 'rotation_or_specialist';
  return 'depth_or_development';
}

function valueTier(row: ParsedOtcYearRow | null, estimatedLedger: EstimatedContractLedger | null = null): string {
  const cap = row?.cap_number ?? estimatedLedger?.cap_number_2026 ?? 0;
  if (!row && !estimatedLedger) return 'source_needed';
  if (cap >= 10_000_000) return 'premium_contract';
  if (cap >= 2_000_000) return 'standard_contract';
  return estimatedLedger ? 'estimated_minimum_or_low_cap' : 'minimum_or_low_cap';
}

function hasContractYearSignal(row: ParsedOtcYearRow): boolean {
  return [
    row.base_salary,
    row.signing_proration,
    row.option_proration,
    row.roster_bonus_regular,
    row.roster_bonus_per_game,
    row.workout_bonus,
    row.other_bonus,
    row.guaranteed_salary,
    row.cap_number,
  ].some((value) => value != null && value !== 0);
}

function isVoidYearCandidate(row: ParsedOtcYearRow): boolean {
  const cashDue = cashDueForYear(row) ?? 0;
  const proration = sumNumbers([row.signing_proration, row.option_proration]) ?? 0;
  const cap = row.cap_number ?? 0;
  return cashDue === 0 && proration > 0 && cap > 0;
}

function cashDueForYear(row: ParsedOtcYearRow): number | null {
  return sumNumbers([
    row.base_salary,
    row.roster_bonus_regular,
    row.roster_bonus_per_game,
    row.workout_bonus,
    row.other_bonus,
  ]);
}

function ledgerConfidence(
  current: ParsedOtcYearRow,
  countableYearCount: number,
  capturedYearCount: number,
): NflCapRow['contract_ledger_confidence'] {
  if (capturedYearCount > 1) return 'captured';
  if ((current.cap_number ?? 0) <= 2_000_000 && countableYearCount <= 1) return 'estimated';
  return 'derived';
}

function compactContractYear(row: ParsedOtcYearRow): Record<string, unknown> {
  const cashDue = cashDueForYear(row);
  return {
    season: row.season,
    cap_number: row.cap_number,
    cash_due: cashDue,
    guaranteed_salary: row.guaranteed_salary,
    dead_money_cut: row.dead_money_cut,
    post_june_1_dead_money_cut: row.post_june_1_dead_money_cut,
    cut_savings: row.cut_savings,
    post_june_1_cut_savings: row.post_june_1_cut_savings,
    trade_dead_money: row.trade_dead_money,
    trade_savings: row.trade_savings,
    post_june_1_trade_dead_money: row.post_june_1_trade_dead_money,
    post_june_1_trade_savings: row.post_june_1_trade_savings,
    restructure_savings: row.restructure_savings,
    extension_savings: row.extension_savings,
    void_year_candidate: isVoidYearCandidate(row),
    source_url: row.source_url,
  };
}

function sumNumbers(values: Array<number | null>): number | null {
  const captured = values.filter((value): value is number => typeof value === 'number');
  if (captured.length === 0) return null;
  return captured.reduce((sum, value) => sum + value, 0);
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  const captured = values.filter((value): value is number => typeof value === 'number');
  if (captured.length === 0) return null;
  return captured.reduce((sum, value) => sum + value, 0);
}

function sumMetric(current: number | null, next: number | null): number | null {
  if (current == null) return next;
  if (next == null) return current;
  return current + next;
}

function integer(value: unknown): number | null {
  const parsed = number(value);
  return parsed == null ? null : Math.round(parsed);
}

function number(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).replace(/,/g, '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercent(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const parsed = Number(text.replace('%', ''));
  if (!Number.isFinite(parsed)) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function primarySnapShare(row: Record<string, unknown>, position: string | null): number | null {
  const pos = String(position ?? '').toUpperCase();
  if (['QB', 'RB', 'FB', 'WR', 'TE', 'C', 'G', 'OG', 'OT', 'T', 'OL'].includes(pos)) {
    return parsePercent(row.offense_pct);
  }
  if (['DT', 'NT', 'DL', 'DE', 'EDGE', 'OLB', 'LB', 'ILB', 'MLB', 'CB', 'S', 'FS', 'SS', 'DB'].includes(pos)) {
    return parsePercent(row.defense_pct);
  }
  return parsePercent(row.st_pct) ?? parsePercent(row.offense_pct) ?? parsePercent(row.defense_pct);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeMetricTeam(team: string): string | null {
  const normalized = team.trim().toUpperCase();
  if (!normalized) return null;
  const aliases: Record<string, string> = {
    ARZ: 'ARI',
    JAC: 'JAX',
    LA: 'LAR',
    LAR: 'LAR',
    STL: 'LAR',
    OAK: 'LV',
    SD: 'LAC',
    WSH: 'WAS',
  };
  return aliases[normalized] ?? normalized;
}

function positionsCompatible(rosterPosition: string | null, metricPosition: string | null): boolean {
  if (!metricPosition || !rosterPosition) return true;
  const roster = positionFamily(rosterPosition);
  const metric = positionFamily(metricPosition);
  return roster === metric || rosterPosition.toUpperCase() === metricPosition.toUpperCase();
}

function positionFamily(position: string): string {
  const pos = position.toUpperCase().replace(/[^A-Z]/g, '');
  if (['QB'].includes(pos)) return 'QB';
  if (['RB', 'FB'].includes(pos)) return 'RB';
  if (['WR'].includes(pos)) return 'WR';
  if (['TE'].includes(pos)) return 'TE';
  if (['C', 'G', 'OG', 'OT', 'T', 'OL'].includes(pos)) return 'OL';
  if (['DT', 'NT', 'DL'].includes(pos)) return 'DL';
  if (['DE', 'EDGE', 'OLB'].includes(pos)) return 'EDGE';
  if (['LB', 'ILB', 'MLB'].includes(pos)) return 'LB';
  if (['CB'].includes(pos)) return 'CB';
  if (['S', 'FS', 'SS', 'DB'].includes(pos)) return 'DB';
  if (['K', 'P', 'LS'].includes(pos)) return 'ST';
  return pos;
}

function parseCsvRecords(csv: string): Record<string, string>[] {
  const rows = parseCsvRows(csv);
  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => Object.fromEntries(header.map((column, index) => [column, row[index] ?? ''])));
}

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function publicMetricFixture(aggregates: PublicMetricAggregate[]): Record<string, unknown> {
  return {
    schema_version: 1,
    season: 2025,
    source_refs: [
      { id: 'nflverse_snap_counts_2025', url: NFLVERSE_SNAP_COUNTS_2025_URL },
      { id: 'nflverse_stats_player_2025', url: NFLVERSE_STATS_PLAYER_2025_URL },
    ],
    row_count: aggregates.length,
    rows: aggregates.map((row) => ({
      player_name: row.player_name,
      team_ids: row.team_ids,
      position: row.position,
      offense_snaps_2025: row.offense_snaps_2025,
      defense_snaps_2025: row.defense_snaps_2025,
      special_teams_snaps_2025: row.special_teams_snaps_2025,
      games_2025: row.games_2025,
      source_families: [...row.source_families].sort(),
    })),
  };
}

async function readExistingMetricFixture(): Promise<PublicMetricIndex | null> {
  try {
    const parsed = JSON.parse(await readFile(DEFAULT_NFL_PLAYER_METRICS_FIXTURE_PATH, 'utf8')) as {
      rows?: Array<{
        player_name?: string;
        team_ids?: string[];
        position?: string | null;
        offense_snaps_2025?: number;
        defense_snaps_2025?: number;
        special_teams_snaps_2025?: number;
        games_2025?: number | null;
        source_families?: string[];
      }>;
    };
    const aggregates = new Map<string, PublicMetricAggregate>();
    const byTeamName = new Map<string, PublicMetricAggregate>();
    const byName = new Map<string, PublicMetricAggregate[]>();
    for (const row of parsed.rows ?? []) {
      const playerName = row.player_name ?? '';
      for (const teamId of row.team_ids ?? []) {
        const aggregate = metricAggregate(aggregates, byTeamName, byName, teamId, playerName, row.position ?? null);
        aggregate.offense_snaps_2025 = row.offense_snaps_2025 ?? 0;
        aggregate.defense_snaps_2025 = row.defense_snaps_2025 ?? 0;
        aggregate.special_teams_snaps_2025 = row.special_teams_snaps_2025 ?? 0;
        aggregate.games_2025 = row.games_2025 ?? null;
        for (const family of row.source_families ?? []) aggregate.source_families.add(family);
        if (aggregate.source_families.has('nflverse_snap_counts')) aggregate.source_urls.add(NFLVERSE_SNAP_COUNTS_2025_URL);
        if (aggregate.source_families.has('nflverse_stats_player')) aggregate.source_urls.add(NFLVERSE_STATS_PLAYER_2025_URL);
      }
    }
    return { byTeamName, byName, fixture: parsed as Record<string, unknown> };
  } catch {
    return null;
  }
}

function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRosterStatus(status: string): string {
  if (status === 'ACT') return 'active';
  if (!status) return 'unknown';
  return status.toLowerCase();
}

function emptyToNull(value: string | undefined): string | null {
  if (!value || value === '-') return null;
  return value;
}

function numberOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

if (process.argv[1]?.endsWith('build_reviewed_snapshot.ts')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
