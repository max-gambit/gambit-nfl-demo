const TEAM_NAME_IDS: Readonly<Record<string, string>> = {
  '49ers': 'SF',
  bears: 'CHI',
  bengals: 'CIN',
  bills: 'BUF',
  broncos: 'DEN',
  browns: 'CLE',
  buccaneers: 'TB',
  cardinals: 'ARI',
  chargers: 'LAC',
  chiefs: 'KC',
  colts: 'IND',
  commanders: 'WAS',
  cowboys: 'DAL',
  dolphins: 'MIA',
  eagles: 'PHI',
  falcons: 'ATL',
  giants: 'NYG',
  jaguars: 'JAX',
  jets: 'NYJ',
  lions: 'DET',
  packers: 'GB',
  panthers: 'CAR',
  patriots: 'NE',
  raiders: 'LV',
  rams: 'LAR',
  ravens: 'BAL',
  saints: 'NO',
  seahawks: 'SEA',
  steelers: 'PIT',
  texans: 'HOU',
  titans: 'TEN',
  vikings: 'MIN',
  redskins: 'WAS',
  'football team': 'WAS',
  oakland: 'LV',
  'st. louis': 'LAR',
  'san diego': 'LAC',
};

const HISTORICAL_TEAM_CODE_IDS: Readonly<Record<string, string>> = {
  LA: 'LAR',
  STL: 'LAR',
  OAK: 'LV',
  SD: 'LAC',
};

/**
 * Normalize provider names and historical franchise codes to the current team
 * identifiers used by questions and API requests. Raw source values remain in
 * each ingested row for provenance.
 */
export function canonicalNflTeamId(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || normalized.includes('/')) return null;
  const named = TEAM_NAME_IDS[normalized.toLowerCase()];
  if (named) return named;
  const code = normalized.toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(code)) return null;
  return HISTORICAL_TEAM_CODE_IDS[code] ?? code;
}
