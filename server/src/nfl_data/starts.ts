import { readFile } from 'node:fs/promises';
import type { NflDemoSeed } from './seed.js';
import { nameLookupKeys, normalizeName } from './player_names.js';

interface GameRow { week: number; date: string; games: number; starts: number }
export interface NflStartsRecord {
  player_id: string;
  player_name: string;
  source_url: string;
  captured_at: string;
  sha256: string;
  games_2025: number;
  starts_2025: number;
  game_rows: GameRow[];
}
export interface NflStartsSnapshot {
  schema: 'nfl_regular_season_starts.v1';
  season: 2025;
  records: NflStartsRecord[];
}

let snapshotPromise: Promise<NflStartsSnapshot> | null = null;
interface ReviewedSnapRow {
  player_name: string; team_ids: string[]; position: string | null;
  offense_snaps_2025: number; defense_snaps_2025: number; special_teams_snaps_2025: number;
  snap_share_2025: number | null; source_families: string[];
}
let reviewedSnapsPromise: Promise<{ rows: ReviewedSnapRow[] }> | null = null;
export const SNAP_SOURCE = 'https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_2025.csv';

export function applyReviewedIolSnaps(seed: NflDemoSeed, reviewed: { rows: ReviewedSnapRow[] }): NflDemoSeed {
  if (!Array.isArray(reviewed.rows)) throw new Error('Missing reviewed snap rows');
  const names = new Map<string, number>();
  for (const row of seed.roster_entries) names.set(row.player_name, (names.get(row.player_name) ?? 0) + 1);
  return { ...seed, player_metrics: seed.player_metrics.map(metric => {
    if (!['G','C','OG','OC','IOL'].includes(metric.position ?? '') || metric.metric_families?.includes('nflverse_snap_counts')) return metric;
    const keys = nameLookupKeys(metric.player_name);
    const matches = reviewed.rows.filter(row => keys.includes(normalizeName(row.player_name)) && row.source_families.includes('nflverse_snap_counts') && ['G','C','OG','OC','IOL','OL'].includes(row.position ?? ''));
    const row = names.get(metric.player_name) === 1 && matches.length === 1 ? matches[0] : null;
    if (!row) {
      // A depth-chart or incidental box-score row is not a captured zero.
      return { ...metric, snaps_2025: null, offense_snaps_2025: null, defense_snaps_2025: null, special_teams_snaps_2025: null, snap_share_2025: null };
    }
    if (![row.offense_snaps_2025, row.defense_snaps_2025, row.special_teams_snaps_2025].every(value => Number.isInteger(value) && value >= 0)) throw new Error('Invalid reviewed IOL snap count');
    const total = row.offense_snaps_2025 + row.defense_snaps_2025 + row.special_teams_snaps_2025;
    const families = [...new Set([...(metric.metric_families ?? []), 'nflverse_snap_counts'])].sort();
    const sourceUrls = Array.isArray(metric.source_data?.source_urls) ? metric.source_data.source_urls as string[] : [];
    return {
      ...metric,
      snaps_2025: total,
      offense_snaps_2025: row.offense_snaps_2025, defense_snaps_2025: row.defense_snaps_2025, special_teams_snaps_2025: row.special_teams_snaps_2025,
      snap_share_2025: row.snap_share_2025,
      source_url: SNAP_SOURCE,
      metric_families: families,
      metric_source_family: families.join('+'),
      metric_note: `${total} recorded 2025 snaps for ${row.team_ids.join(', ')} from the reviewed nflverse snap-count data. No reviewed public blocking grade is supplied.`,
      source_data: {
        ...metric.source_data, matched_player_name: row.player_name, matched_2025_team_ids: row.team_ids,
        source_families: families, source_urls: [...new Set([...sourceUrls, SNAP_SOURCE])],
        snaps_2025_source: { source_url: SNAP_SOURCE, player_name: row.player_name, team_ids: row.team_ids, offense_snaps: row.offense_snaps_2025, defense_snaps: row.defense_snaps_2025, special_teams_snaps: row.special_teams_snaps_2025 },
      },
    };
  }) };
}

export function validateStartsSnapshot(value: unknown): NflStartsSnapshot {
  const snapshot = value as NflStartsSnapshot;
  if (snapshot?.schema !== 'nfl_regular_season_starts.v1' || snapshot.season !== 2025 || !Array.isArray(snapshot.records)) throw new Error('Invalid NFL starts snapshot');
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const record of snapshot.records) {
    if (!record.player_id || !record.player_name || ids.has(record.player_id)) throw new Error('Missing or duplicate NFL starts identity');
    ids.add(record.player_id);
    if (!/^https:\/\/www\.nfl\.com\/players\/[a-z0-9-]+\/stats\/logs\/2025\/$/.test(record.source_url)
      || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isFinite(Date.parse(record.captured_at))) throw new Error('Invalid NFL starts provenance');
    if (urls.has(record.source_url)) throw new Error('Duplicate NFL starts source identity');
    urls.add(record.source_url);
    if (!Array.isArray(record.game_rows) || !record.game_rows.length || record.game_rows.length > 18) throw new Error('Missing regular-season game rows');
    const dates = new Set<string>();
    for (const row of record.game_rows) {
      if (!Number.isInteger(row.week) || row.week < 1 || row.week > 18 || ![0,1].includes(row.games) || ![0,1].includes(row.starts) || row.starts > row.games
        || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || row.date < '2025-09-01' || row.date > '2026-01-11' || !Number.isFinite(Date.parse(row.date)) || dates.has(row.date)) throw new Error('Invalid or duplicate regular-season game row');
      dates.add(row.date);
    }
    const games = record.game_rows.reduce((sum, row) => sum + row.games, 0);
    const starts = record.game_rows.reduce((sum, row) => sum + row.starts, 0);
    if (games > 17 || games !== record.games_2025 || starts !== record.starts_2025) throw new Error('NFL starts totals do not reconcile to game rows');
  }
  return snapshot;
}

export function applyStartsSnapshot(seed: NflDemoSeed, snapshot: NflStartsSnapshot): NflDemoSeed {
  validateStartsSnapshot(snapshot);
  const records = new Map(snapshot.records.map(record => [record.source_url, record]));
  const roster = new Map(seed.roster_entries.map(row => [row.player_id, row]));
  return {
    ...seed,
    player_metrics: seed.player_metrics.map(metric => {
      const player = roster.get(metric.player_id);
      const record = player?.source_url ? records.get(`${player.source_url.replace(/\/$/, '')}/stats/logs/2025/`) : undefined;
      // The join uses the captured NFL identity and URL, never a surname or
      // current-team guess. A moved player retains all 2025 log appearances.
      if (!record || !player || player.player_name !== record.player_name || `${player.source_url?.replace(/\/$/, '')}/stats/logs/2025/` !== record.source_url) return metric;
      if (metric.starts_2025 != null && metric.starts_2025 !== record.starts_2025) {
        return { ...metric, starts_2025: null, source_data: { ...metric.source_data, starts_2025_conflict: { previous: metric.starts_2025, official: record.starts_2025, source_url: record.source_url } } };
      }
      return {
        ...metric,
        starts_2025: record.starts_2025,
        games_2025: record.games_2025,
        source_data: {
          ...metric.source_data,
          starts_2025_source: record,
          ...(metric.games_2025 != null && metric.games_2025 !== record.games_2025 ? { prior_games_2025: metric.games_2025 } : {}),
        },
      };
    }),
  };
}

/** Historical augmentation applies to both DB and saved-snapshot readers.
 * It changes no roster, contract, snapshot date or existing stored answer.
 */
export async function withRecordedStarts(seed: NflDemoSeed): Promise<NflDemoSeed> {
  snapshotPromise ??= readFile(new URL('../../../data/nfl-player-metrics/starts-2025.json', import.meta.url), 'utf8')
    .then(text => validateStartsSnapshot(JSON.parse(text)));
  reviewedSnapsPromise ??= readFile(new URL('../../../data/nfl-player-metrics/reviewed-2025.json', import.meta.url), 'utf8').then(text => JSON.parse(text));
  const [starts, snaps] = await Promise.all([snapshotPromise, reviewedSnapsPromise]);
  return applyStartsSnapshot(applyReviewedIolSnaps(seed, snaps), starts);
}
