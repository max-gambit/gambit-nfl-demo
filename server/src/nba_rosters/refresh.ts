import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { NbaRosterSeed, NbaRosterSeedEntry, NbaRosterSeedPlayer, NbaRosterSeedTeam } from './seed.js';
import { validateNbaRosterSeed } from './seed.js';

interface TeamMeta {
  team_id: string;
  nba_team_id: number;
  abbreviation: string;
  city: string;
  name: string;
  full_name: string;
  conference: string;
  division: string;
}

const NBA_TEAMS: TeamMeta[] = [
  { team_id: 'ATL', nba_team_id: 1610612737, abbreviation: 'ATL', city: 'Atlanta', name: 'Hawks', full_name: 'Atlanta Hawks', conference: 'East', division: 'Southeast' },
  { team_id: 'BOS', nba_team_id: 1610612738, abbreviation: 'BOS', city: 'Boston', name: 'Celtics', full_name: 'Boston Celtics', conference: 'East', division: 'Atlantic' },
  { team_id: 'BKN', nba_team_id: 1610612751, abbreviation: 'BKN', city: 'Brooklyn', name: 'Nets', full_name: 'Brooklyn Nets', conference: 'East', division: 'Atlantic' },
  { team_id: 'CHA', nba_team_id: 1610612766, abbreviation: 'CHA', city: 'Charlotte', name: 'Hornets', full_name: 'Charlotte Hornets', conference: 'East', division: 'Southeast' },
  { team_id: 'CHI', nba_team_id: 1610612741, abbreviation: 'CHI', city: 'Chicago', name: 'Bulls', full_name: 'Chicago Bulls', conference: 'East', division: 'Central' },
  { team_id: 'CLE', nba_team_id: 1610612739, abbreviation: 'CLE', city: 'Cleveland', name: 'Cavaliers', full_name: 'Cleveland Cavaliers', conference: 'East', division: 'Central' },
  { team_id: 'DAL', nba_team_id: 1610612742, abbreviation: 'DAL', city: 'Dallas', name: 'Mavericks', full_name: 'Dallas Mavericks', conference: 'West', division: 'Southwest' },
  { team_id: 'DEN', nba_team_id: 1610612743, abbreviation: 'DEN', city: 'Denver', name: 'Nuggets', full_name: 'Denver Nuggets', conference: 'West', division: 'Northwest' },
  { team_id: 'DET', nba_team_id: 1610612765, abbreviation: 'DET', city: 'Detroit', name: 'Pistons', full_name: 'Detroit Pistons', conference: 'East', division: 'Central' },
  { team_id: 'GSW', nba_team_id: 1610612744, abbreviation: 'GSW', city: 'Golden State', name: 'Warriors', full_name: 'Golden State Warriors', conference: 'West', division: 'Pacific' },
  { team_id: 'HOU', nba_team_id: 1610612745, abbreviation: 'HOU', city: 'Houston', name: 'Rockets', full_name: 'Houston Rockets', conference: 'West', division: 'Southwest' },
  { team_id: 'IND', nba_team_id: 1610612754, abbreviation: 'IND', city: 'Indiana', name: 'Pacers', full_name: 'Indiana Pacers', conference: 'East', division: 'Central' },
  { team_id: 'LAC', nba_team_id: 1610612746, abbreviation: 'LAC', city: 'LA', name: 'Clippers', full_name: 'LA Clippers', conference: 'West', division: 'Pacific' },
  { team_id: 'LAL', nba_team_id: 1610612747, abbreviation: 'LAL', city: 'Los Angeles', name: 'Lakers', full_name: 'Los Angeles Lakers', conference: 'West', division: 'Pacific' },
  { team_id: 'MEM', nba_team_id: 1610612763, abbreviation: 'MEM', city: 'Memphis', name: 'Grizzlies', full_name: 'Memphis Grizzlies', conference: 'West', division: 'Southwest' },
  { team_id: 'MIA', nba_team_id: 1610612748, abbreviation: 'MIA', city: 'Miami', name: 'Heat', full_name: 'Miami Heat', conference: 'East', division: 'Southeast' },
  { team_id: 'MIL', nba_team_id: 1610612749, abbreviation: 'MIL', city: 'Milwaukee', name: 'Bucks', full_name: 'Milwaukee Bucks', conference: 'East', division: 'Central' },
  { team_id: 'MIN', nba_team_id: 1610612750, abbreviation: 'MIN', city: 'Minnesota', name: 'Timberwolves', full_name: 'Minnesota Timberwolves', conference: 'West', division: 'Northwest' },
  { team_id: 'NOP', nba_team_id: 1610612740, abbreviation: 'NOP', city: 'New Orleans', name: 'Pelicans', full_name: 'New Orleans Pelicans', conference: 'West', division: 'Southwest' },
  { team_id: 'NYK', nba_team_id: 1610612752, abbreviation: 'NYK', city: 'New York', name: 'Knicks', full_name: 'New York Knicks', conference: 'East', division: 'Atlantic' },
  { team_id: 'OKC', nba_team_id: 1610612760, abbreviation: 'OKC', city: 'Oklahoma City', name: 'Thunder', full_name: 'Oklahoma City Thunder', conference: 'West', division: 'Northwest' },
  { team_id: 'ORL', nba_team_id: 1610612753, abbreviation: 'ORL', city: 'Orlando', name: 'Magic', full_name: 'Orlando Magic', conference: 'East', division: 'Southeast' },
  { team_id: 'PHI', nba_team_id: 1610612755, abbreviation: 'PHI', city: 'Philadelphia', name: '76ers', full_name: 'Philadelphia 76ers', conference: 'East', division: 'Atlantic' },
  { team_id: 'PHX', nba_team_id: 1610612756, abbreviation: 'PHX', city: 'Phoenix', name: 'Suns', full_name: 'Phoenix Suns', conference: 'West', division: 'Pacific' },
  { team_id: 'POR', nba_team_id: 1610612757, abbreviation: 'POR', city: 'Portland', name: 'Trail Blazers', full_name: 'Portland Trail Blazers', conference: 'West', division: 'Northwest' },
  { team_id: 'SAC', nba_team_id: 1610612758, abbreviation: 'SAC', city: 'Sacramento', name: 'Kings', full_name: 'Sacramento Kings', conference: 'West', division: 'Pacific' },
  { team_id: 'SAS', nba_team_id: 1610612759, abbreviation: 'SAS', city: 'San Antonio', name: 'Spurs', full_name: 'San Antonio Spurs', conference: 'West', division: 'Southwest' },
  { team_id: 'TOR', nba_team_id: 1610612761, abbreviation: 'TOR', city: 'Toronto', name: 'Raptors', full_name: 'Toronto Raptors', conference: 'East', division: 'Atlantic' },
  { team_id: 'UTA', nba_team_id: 1610612762, abbreviation: 'UTA', city: 'Utah', name: 'Jazz', full_name: 'Utah Jazz', conference: 'West', division: 'Northwest' },
  { team_id: 'WAS', nba_team_id: 1610612764, abbreviation: 'WAS', city: 'Washington', name: 'Wizards', full_name: 'Washington Wizards', conference: 'East', division: 'Southeast' },
];

const TEAM_BY_ID = new Map(NBA_TEAMS.map((team) => [team.nba_team_id, team]));
const TEAM_BY_ABBR = new Map(NBA_TEAMS.map((team) => [team.abbreviation, team]));

interface RefreshOptions {
  asOfDate: string;
  season: string;
  outPath: string;
  htmlPath: string | null;
}

interface NbaLeaguePlayerRow {
  PERSON_ID: number;
  PLAYER_LAST_NAME: string;
  PLAYER_FIRST_NAME: string;
  PLAYER_SLUG: string | null;
  TEAM_ID: number;
  TEAM_CITY: string;
  TEAM_NAME: string;
  TEAM_ABBREVIATION: string;
  JERSEY_NUMBER: string | null;
  POSITION: string | null;
  HEIGHT: string | null;
  WEIGHT: string | number | null;
  COLLEGE: string | null;
  COUNTRY: string | null;
  ROSTER_STATUS: number;
  IS_DEFUNCT: number;
  HISTORIC: boolean;
  [key: string]: unknown;
}

interface CommonTeamRosterRow {
  TeamID: number;
  SEASON: string;
  LeagueID: string;
  PLAYER: string;
  NICKNAME: string | null;
  PLAYER_SLUG: string | null;
  NUM: string | null;
  POSITION: string | null;
  HEIGHT: string | null;
  WEIGHT: string | number | null;
  BIRTH_DATE: string | null;
  AGE: number | null;
  EXP: string | null;
  SCHOOL: string | null;
  PLAYER_ID: number;
  HOW_ACQUIRED: string | null;
  [key: string]: unknown;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let seed: NbaRosterSeed | null = null;

  if (!opts.htmlPath && process.env.NBA_SKIP_STATS !== '1') {
    seed = await tryBuildFromStats(opts);
  }
  if (!seed) {
    seed = await buildFromLeaguePlayersPage(opts);
  }

  validateNbaRosterSeed(seed);
  await writeFile(opts.outPath, `${JSON.stringify(seed, null, 2)}\n`);
  console.log(`wrote ${opts.outPath}`);
  console.log(`teams=${seed.teams.length} players=${seed.players.length} entries=${seed.entries.length}`);
}

async function tryBuildFromStats(opts: RefreshOptions): Promise<NbaRosterSeed | null> {
  try {
    const rows: CommonTeamRosterRow[] = [];
    for (const team of NBA_TEAMS) {
      const url = new URL('https://stats.nba.com/stats/commonteamroster');
      url.searchParams.set('LeagueID', '00');
      url.searchParams.set('Season', opts.season);
      url.searchParams.set('TeamID', String(team.nba_team_id));
      const json = await fetchJson(url.toString(), 5000);
      const resultSet = Array.isArray(json.resultSets)
        ? json.resultSets.find((set: { name?: string }) => set.name === 'CommonTeamRoster') ?? json.resultSets[0]
        : null;
      if (!resultSet?.headers || !resultSet?.rowSet) {
        throw new Error(`CommonTeamRoster response missing rows for ${team.abbreviation}`);
      }
      rows.push(...rowsFromResultSet(resultSet.headers, resultSet.rowSet) as CommonTeamRosterRow[]);
    }
    return buildSeedFromStatsRows(rows, opts);
  } catch (err) {
    console.warn('[nba-rosters] CommonTeamRoster refresh failed; falling back to NBA.com /players:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function buildFromLeaguePlayersPage(opts: RefreshOptions): Promise<NbaRosterSeed> {
  const sourceUrl = 'https://www.nba.com/players';
  const fetched = opts.htmlPath
    ? { text: await readFile(opts.htmlPath, 'utf8'), url: 'https://cdn-uat.nba.com/players' }
    : await fetchTextWithFallback([
      'https://www.nba.com/players',
      'https://cdn-uat.nba.com/players',
    ]);
  const players = parseNextPlayers(fetched.text);
  return buildSeedFromLeagueRows(players, {
    ...opts,
    sourceName: 'NBA.com League Roster',
    sourceUrl,
    sourceRetrievedFrom: fetched.url,
    sourceKind: 'nba.com/players#__NEXT_DATA__',
  });
}

function buildSeedFromLeagueRows(
  rows: NbaLeaguePlayerRow[],
  opts: RefreshOptions & { sourceName: string; sourceUrl: string; sourceRetrievedFrom: string; sourceKind: string },
): NbaRosterSeed {
  const active = rows
    .filter((row) => row.ROSTER_STATUS === 1 && row.IS_DEFUNCT === 0 && !row.HISTORIC && row.TEAM_ABBREVIATION)
    .sort((a, b) => (
      a.TEAM_ABBREVIATION.localeCompare(b.TEAM_ABBREVIATION)
      || a.PLAYER_LAST_NAME.localeCompare(b.PLAYER_LAST_NAME)
      || a.PLAYER_FIRST_NAME.localeCompare(b.PLAYER_FIRST_NAME)
    ));

  const teams = teamRows(active);
  const players: NbaRosterSeedPlayer[] = [];
  const entries: NbaRosterSeedEntry[] = [];
  const teamCounts: Record<string, number> = {};

  for (const row of active) {
    const team = TEAM_BY_ABBR.get(row.TEAM_ABBREVIATION);
    if (!team) continue;
    teamCounts[team.team_id] = (teamCounts[team.team_id] ?? 0) + 1;
    const fullName = `${row.PLAYER_FIRST_NAME} ${row.PLAYER_LAST_NAME}`.trim();
    const playerUrl = playerUrlFor(row.PERSON_ID, row.PLAYER_SLUG);
    const player = {
      nba_player_id: row.PERSON_ID,
      slug: row.PLAYER_SLUG,
      full_name: fullName,
      first_name: row.PLAYER_FIRST_NAME,
      last_name: row.PLAYER_LAST_NAME,
      position: row.POSITION,
      height: row.HEIGHT,
      weight_lbs: numberOrNull(row.WEIGHT),
      last_attended: row.COLLEGE,
      country: row.COUNTRY,
      jersey_number: row.JERSEY_NUMBER,
      source_url: playerUrl,
      source_row: row,
    };
    players.push(player);
    entries.push({
      team_id: team.team_id,
      nba_player_id: row.PERSON_ID,
      season: opts.season,
      source_order: teamCounts[team.team_id],
      jersey_number: row.JERSEY_NUMBER,
      position: row.POSITION,
      height: row.HEIGHT,
      weight_lbs: numberOrNull(row.WEIGHT),
      last_attended: row.COLLEGE,
      country: row.COUNTRY,
      source_url: playerUrl,
      source_row: row,
    });
  }

  return {
    schema_version: 1,
    season: opts.season,
    as_of_date: opts.asOfDate,
    source_name: opts.sourceName,
    source_url: opts.sourceUrl,
    retrieved_at: new Date().toISOString(),
    source_retrieved_from: opts.sourceRetrievedFrom,
    teams,
    players,
    entries,
    team_counts: teamCounts,
    notes: [
      'Captured from the official NBA League Roster listing.',
      'Rows use ROSTER_STATUS=1 and preserve official NBA listing counts, including two-way or inactive extras where NBA.com lists them.',
    ],
    source_meta: {
      parser: opts.sourceKind,
      official_listing_total_rows: rows.length,
      active_listing_rows: active.length,
      official_team_count: teams.length,
    },
  };
}

function buildSeedFromStatsRows(rows: CommonTeamRosterRow[], opts: RefreshOptions): NbaRosterSeed {
  const active = rows.sort((a, b) => (
    String(a.TeamID).localeCompare(String(b.TeamID))
    || String(a.PLAYER ?? '').localeCompare(String(b.PLAYER ?? ''))
  ));
  const teams = NBA_TEAMS.map((team) => ({ ...team }));
  const players: NbaRosterSeedPlayer[] = [];
  const entries: NbaRosterSeedEntry[] = [];
  const teamCounts: Record<string, number> = {};

  for (const row of active) {
    const team = TEAM_BY_ID.get(row.TeamID);
    if (!team) continue;
    const [firstName, ...rest] = String(row.PLAYER ?? '').split(' ');
    const lastName = rest.join(' ') || null;
    const playerUrl = playerUrlFor(row.PLAYER_ID, row.PLAYER_SLUG);
    teamCounts[team.team_id] = (teamCounts[team.team_id] ?? 0) + 1;
    players.push({
      nba_player_id: row.PLAYER_ID,
      slug: row.PLAYER_SLUG,
      full_name: row.PLAYER,
      first_name: firstName || null,
      last_name: lastName,
      position: row.POSITION,
      height: row.HEIGHT,
      weight_lbs: numberOrNull(row.WEIGHT),
      last_attended: row.SCHOOL,
      country: null,
      jersey_number: row.NUM,
      source_url: playerUrl,
      source_row: row,
    });
    entries.push({
      team_id: team.team_id,
      nba_player_id: row.PLAYER_ID,
      season: opts.season,
      source_order: teamCounts[team.team_id],
      jersey_number: row.NUM,
      position: row.POSITION,
      height: row.HEIGHT,
      weight_lbs: numberOrNull(row.WEIGHT),
      last_attended: row.SCHOOL,
      country: null,
      source_url: playerUrl,
      source_row: row,
    });
  }

  return {
    schema_version: 1,
    season: opts.season,
    as_of_date: opts.asOfDate,
    source_name: 'NBA Stats CommonTeamRoster',
    source_url: 'https://stats.nba.com/stats/commonteamroster',
    retrieved_at: new Date().toISOString(),
    source_retrieved_from: 'https://stats.nba.com/stats/commonteamroster',
    teams,
    players,
    entries,
    team_counts: teamCounts,
    notes: [
      'Captured from the NBA Stats CommonTeamRoster endpoint.',
      'Official endpoint counts are preserved without forcing each team to 15 players.',
    ],
    source_meta: {
      parser: 'stats.nba.com/stats/commonteamroster',
      official_listing_total_rows: rows.length,
      active_listing_rows: rows.length,
      official_team_count: teams.length,
    },
  };
}

function teamRows(activeRows: NbaLeaguePlayerRow[]): NbaRosterSeedTeam[] {
  const activeTeamIds = new Set(activeRows.map((row) => row.TEAM_ABBREVIATION));
  return NBA_TEAMS
    .filter((team) => activeTeamIds.has(team.abbreviation))
    .map((team) => ({ ...team }));
}

function parseNextPlayers(html: string): NbaLeaguePlayerRow[] {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
  if (!match) throw new Error('NBA players page did not include __NEXT_DATA__');
  const nextData = JSON.parse(match[1]);
  const players = nextData?.props?.pageProps?.players;
  if (!Array.isArray(players)) throw new Error('NBA players page __NEXT_DATA__ did not include players[]');
  return players as NbaLeaguePlayerRow[];
}

async function fetchTextWithFallback(urls: string[]): Promise<{ text: string; url: string }> {
  const errors: string[] = [];
  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, 15000);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return { text: await res.text(), url };
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`NBA players page fetch failed: ${errors.join('; ')}`);
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const res = await fetchWithTimeout(url, timeoutMs, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://www.nba.com',
      Referer: 'https://www.nba.com/',
      'User-Agent': 'Mozilla/5.0 (Gambit roster seed refresh)',
      'x-nba-stats-origin': 'stats',
      'x-nba-stats-token': 'true',
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchWithTimeout(url: string, timeoutMs: number, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function rowsFromResultSet(headers: string[], rowSet: unknown[][]): Record<string, unknown>[] {
  return rowSet.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function parseArgs(argv: string[]): RefreshOptions {
  const defaultOut = fileURLToPath(new URL('../../../data/nba-rosters/2026-06-12.nba-official.json', import.meta.url));
  const opts: RefreshOptions = {
    asOfDate: '2026-06-12',
    season: '2025-26',
    outPath: defaultOut,
    htmlPath: process.env.NBA_PLAYERS_HTML_PATH ?? null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--as-of' && next) {
      opts.asOfDate = next;
      i += 1;
    } else if (arg === '--season' && next) {
      opts.season = next;
      i += 1;
    } else if (arg === '--out' && next) {
      opts.outPath = next;
      i += 1;
    } else if (arg === '--html' && next) {
      opts.htmlPath = next;
      i += 1;
    }
  }
  return opts;
}

function playerUrlFor(playerId: number, slug: string | null): string {
  return slug
    ? `https://www.nba.com/player/${playerId}/${slug}`
    : `https://www.nba.com/player/${playerId}`;
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
