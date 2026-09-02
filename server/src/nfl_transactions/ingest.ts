import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import type {
  NflPositionMarketGroup,
  NflTradeCompensationBand,
  NflTransactionMarketSourceRef,
  NflTransactionType,
} from '@shared/types';
import type {
  NflTransactionLeagueCap,
  NflTransactionMarketEvent,
  NflTransactionMarketSnapshot,
  NflTransactionRosterPlayerSeason,
} from './analyze.js';

const TRANSFORMATION_VERSION = 'nfl-transaction-normalization.v5';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'data/nfl-transactions');
const COMPLETED_YEARS = Array.from({ length: 10 }, (_, index) => 2016 + index);
const MATERIAL_CONTRACT_TYPES = new Set(['SFA', 'UFA', 'RFA', 'ERFA', 'Extension', 'Franchise', 'Transition']);

const SOURCE_DICTIONARIES = {
  trades: 'https://nflreadr.nflverse.com/articles/dictionary_trades.html',
  players: 'https://nflreadr.nflverse.com/articles/dictionary_players.html',
  contracts: 'https://nflreadr.nflverse.com/articles/dictionary_contracts.html',
  project: 'https://nflverse.nflverse.com/index.html',
};

interface ReleaseAsset {
  tag: string;
  name: string;
  url: string;
  updated_at: string;
  size: number;
  local_path: string;
  sha256: string;
}

interface CsvRow { [column: string]: string }

interface PlayerLookupRow extends CsvRow {
  gsis_id: string;
  display_name: string;
  pfr_id: string;
  otc_id: string;
  position_group: string;
  position: string;
  pff_position: string;
}

interface ContractHistoryRow {
  team?: string | null;
  contract_type?: string | null;
  status?: string | null;
  year_signed?: number | null;
  yrs?: number | null;
  total?: number | null;
  apy?: number | null;
  guarantees?: number | null;
}

interface ContractParquetRow {
  player?: string | null;
  position?: string | null;
  team?: string | null;
  year_signed?: number | null;
  years?: number | null;
  value?: number | null;
  apy?: number | null;
  guaranteed?: number | null;
  apy_cap_pct?: number | null;
  player_page?: string | null;
  otc_id?: number | null;
  gsis_id?: string | null;
  contract_history?: ContractHistoryRow[] | null;
}

export interface NflTradeAssetRow {
  asset_id: string;
  trade_id: string;
  event_year: number;
  trade_date: string;
  gave_team_id: string;
  received_team_id: string;
  asset_type: 'player' | 'draft_pick';
  pfr_id: string | null;
  pfr_name: string | null;
  pick_season: number | null;
  pick_round: number | null;
  pick_number: number | null;
  conditional: boolean | null;
  raw_source_record: CsvRow;
  source_ref_id: string;
}

export interface NflContractTermRow {
  event_id: string;
  player_id: string;
  player_name: string;
  team_id: string | null;
  raw_team: string;
  raw_position: string;
  normalized_position_group: NflPositionMarketGroup | null;
  raw_contract_type: string;
  raw_status: string | null;
  transaction_type: NflTransactionType;
  year_signed: number;
  years: number;
  value_dollars: number;
  apy_dollars: number;
  guaranteed_dollars: number;
  apy_cap_basis_points: number;
  source_url: string | null;
  normalization_basis: string;
  raw_source_record: Record<string, unknown>;
}

export interface NflPlayerExternalIdMatchRow {
  event_id: string;
  player_id: string | null;
  player_name: string;
  pfr_id: string | null;
  gsis_id: string | null;
  otc_id: string | null;
  raw_position: string | null;
  normalized_position_group: NflPositionMarketGroup | null;
  match_confidence: 'matched' | 'directional' | 'unmatched';
  normalization_basis: string;
}

export interface NflTransactionSnapshotCoverage {
  start_year: number;
  end_year: number;
  event_count: number;
  trade_event_count: number;
  contract_event_count: number;
  trade_asset_count: number;
  contract_term_count: number;
  matched_position_count: number;
  directional_position_count: number;
  unmatched_position_count: number;
  position_match_basis_points: number;
  compensation_coverage_basis_points: number;
  contract_term_coverage_basis_points: number;
  transaction_types: Partial<Record<NflTransactionType, number>>;
}

export interface ReviewedNflTransactionSnapshot extends NflTransactionMarketSnapshot {
  schema_version: 'nfl_transaction_snapshot.v1';
  generated_at: string;
  retrieved_at: string;
  as_of_date: string;
  transformation_version: typeof TRANSFORMATION_VERSION;
  trade_assets: NflTradeAssetRow[];
  contract_terms: NflContractTermRow[];
  player_matches: NflPlayerExternalIdMatchRow[];
  coverage: NflTransactionSnapshotCoverage;
}

export interface BuildReviewedSnapshotOptions {
  raw_dir: string;
  assets: ReleaseAsset[];
  retrieved_at?: string;
}

export async function buildReviewedNflTransactionSnapshot(
  options: BuildReviewedSnapshotOptions,
): Promise<ReviewedNflTransactionSnapshot> {
  const retrievedAt = new Date(options.retrieved_at ?? Date.now()).toISOString();
  const asset = assetLookup(options.assets);
  const [tradeRows, playerRows, rosterRows, contractRows] = await Promise.all([
    readCsv(path.join(options.raw_dir, 'trades.csv')),
    readGzipCsv(path.join(options.raw_dir, 'players.csv.gz')),
    Promise.all(COMPLETED_YEARS.map((year) => readCsv(path.join(options.raw_dir, 'rosters', `roster_${year}.csv`)))),
    readContractParquet(path.join(options.raw_dir, 'historical_contracts.parquet')),
  ]);
  const players = playerLookup(playerRows as PlayerLookupRow[]);
  const tradeAssets = normalizeTradeAssets(tradeRows);
  const { events: tradeEvents, matches: tradeMatches } = normalizeTradeEvents(tradeAssets, players);
  const { events: contractEvents, terms: contractTerms, matches: contractMatches } = normalizeContractEvents(contractRows, players);
  const rosterPlayerSeasons = normalizeRosterPopulations(rosterRows.flat(), players);
  const leagueCaps = deriveLeagueCaps(contractEvents);
  // Individual OTC-derived cap percentages can be rounded or inconsistent on
  // historical rows. Use their robust yearly median as the governed cap
  // denominator and do not attach a noisy row-level cap to each event.
  const governedContractEvents = contractEvents.map((event) => ({ ...event, league_cap_dollars: null }));
  const events = [...tradeEvents, ...governedContractEvents].sort(compareEvents);
  const sourceRefs = sourceReferences(options.assets, retrievedAt);
  const snapshotId = `nfltm_${hashJson({
    transformation: TRANSFORMATION_VERSION,
    retrieved_at: retrievedAt,
    sources: options.assets.map((row) => [row.tag, row.name, row.sha256]).sort(),
  }).slice(0, 24)}`;
  const latestSourceAt = options.assets.map((row) => row.updated_at).sort().at(-1) ?? retrievedAt;
  const snapshot: ReviewedNflTransactionSnapshot = {
    schema_version: 'nfl_transaction_snapshot.v1',
    snapshot_id: snapshotId,
    generated_at: retrievedAt,
    retrieved_at: retrievedAt,
    as_of_date: latestSourceAt.slice(0, 10),
    transformation_version: TRANSFORMATION_VERSION,
    events,
    roster_player_seasons: rosterPlayerSeasons,
    league_caps: leagueCaps,
    source_refs: sourceRefs,
    trade_assets: tradeAssets,
    contract_terms: contractTerms,
    player_matches: [...tradeMatches, ...contractMatches],
    coverage: buildSnapshotCoverage(events, tradeAssets, contractTerms),
  };
  validateReviewedSnapshot(snapshot);
  return snapshot;
}

export async function writeReviewedNflTransactionSnapshot(
  snapshot: ReviewedNflTransactionSnapshot,
  outputDir = DEFAULT_OUTPUT_DIR,
): Promise<{ snapshot_path: string; manifest_path: string; checksum_sha256: string }> {
  await mkdir(outputDir, { recursive: true });
  const snapshotFile = `nfl-transaction-market-${snapshot.as_of_date}.json.gz`;
  const snapshotPath = path.join(outputDir, snapshotFile);
  const bytes = gzipSync(Buffer.from(JSON.stringify(snapshot)), { level: 9 });
  const checksum = sha256(bytes);
  const manifest = {
    schema_version: 'nfl_transaction_snapshot_manifest.v1',
    snapshot_id: snapshot.snapshot_id,
    snapshot_file: snapshotFile,
    snapshot_checksum_sha256: checksum,
    generated_at: snapshot.generated_at,
    retrieved_at: snapshot.retrieved_at,
    as_of_date: snapshot.as_of_date,
    transformation_version: snapshot.transformation_version,
    coverage: snapshot.coverage,
    sources: snapshot.source_refs,
    licensing_boundary: 'Public-data prototype. nflverse attribution and upstream ownership caveats apply; review production data rights before commercial database use.',
  };
  const manifestPath = path.join(outputDir, 'manifest.json');
  await writeFile(snapshotPath, bytes);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { snapshot_path: snapshotPath, manifest_path: manifestPath, checksum_sha256: checksum };
}

export async function fetchNflTransactionSources(rawDir: string): Promise<ReleaseAsset[]> {
  await mkdir(path.join(rawDir, 'rosters'), { recursive: true });
  const requested = [
    { tag: 'trades', name: 'trades.csv', relative: 'trades.csv' },
    { tag: 'players', name: 'players.csv.gz', relative: 'players.csv.gz' },
    { tag: 'contracts', name: 'historical_contracts.parquet', relative: 'historical_contracts.parquet' },
    ...COMPLETED_YEARS.map((year) => ({ tag: 'rosters', name: `roster_${year}.csv`, relative: `rosters/roster_${year}.csv` })),
  ];
  const releases = new Map<string, Map<string, { browser_download_url: string; updated_at: string; size: number }>>();
  for (const tag of [...new Set(requested.map((item) => item.tag))]) {
    const response = await fetch(`https://api.github.com/repos/nflverse/nflverse-data/releases/tags/${tag}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'gambit-public-data-prototype' },
    });
    if (!response.ok) throw new Error(`nflverse ${tag} release metadata failed: ${response.status}`);
    const release = await response.json() as { assets?: Array<{ name: string; browser_download_url: string; updated_at: string; size: number }> };
    releases.set(tag, new Map((release.assets ?? []).map((item) => [item.name, item])));
  }
  const assets: ReleaseAsset[] = [];
  for (const item of requested) {
    const metadata = releases.get(item.tag)?.get(item.name);
    if (!metadata) throw new Error(`nflverse ${item.tag} release is missing ${item.name}`);
    const response = await fetch(metadata.browser_download_url, { headers: { 'User-Agent': 'gambit-public-data-prototype' } });
    if (!response.ok) throw new Error(`nflverse asset download failed for ${item.name}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== metadata.size) throw new Error(`nflverse asset size mismatch for ${item.name}`);
    const localPath = path.join(rawDir, item.relative);
    await writeFile(localPath, bytes);
    assets.push({
      tag: item.tag,
      name: item.name,
      url: metadata.browser_download_url,
      updated_at: metadata.updated_at,
      size: metadata.size,
      local_path: item.relative,
      sha256: sha256(bytes),
    });
  }
  await writeFile(path.join(rawDir, 'source-assets.json'), `${JSON.stringify({ assets }, null, 2)}\n`, 'utf8');
  return assets;
}

export function validateReviewedSnapshot(snapshot: ReviewedNflTransactionSnapshot): void {
  if (!snapshot.snapshot_id || snapshot.schema_version !== 'nfl_transaction_snapshot.v1') throw new Error('invalid transaction snapshot identity');
  if (!snapshot.events.length || !snapshot.contract_terms.length || !snapshot.trade_assets.length) throw new Error('transaction snapshot is empty');
  if (snapshot.coverage.start_year > 2016 || snapshot.coverage.end_year < 2025) throw new Error('transaction snapshot does not cover 2016-2025');
  const years = new Set(snapshot.roster_player_seasons.map((row) => row.year));
  for (const year of COMPLETED_YEARS) if (!years.has(year)) throw new Error(`missing roster denominator year ${year}`);
  const sourceIds = new Set(snapshot.source_refs.map((source) => source.id));
  for (const event of snapshot.events) {
    if (!Number.isSafeInteger(event.event_year)) throw new Error(`invalid event year ${event.event_id}`);
    for (const value of [event.contract_value_dollars, event.contract_apy_dollars, event.guaranteed_dollars, event.league_cap_dollars]) {
      if (value != null && !Number.isSafeInteger(value)) throw new Error(`non-integer dollar value ${event.event_id}`);
    }
    if (event.source_ref_ids.some((id) => !sourceIds.has(id))) throw new Error(`unknown source reference ${event.event_id}`);
  }
  if (snapshot.coverage.position_match_basis_points < 8_500) throw new Error('position identity coverage is below the directional floor');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rawDir = argument(args, '--raw-dir') ?? path.join('/tmp', `gambit-nfl-transactions-${Date.now()}`);
  const outputDir = argument(args, '--output-dir') ?? DEFAULT_OUTPUT_DIR;
  const assets = args.includes('--download')
    ? await fetchNflTransactionSources(rawDir)
    : await loadAssetManifest(path.join(rawDir, 'source-assets.json'));
  const snapshot = await buildReviewedNflTransactionSnapshot({ raw_dir: rawDir, assets });
  const written = await writeReviewedNflTransactionSnapshot(snapshot, outputDir);
  console.log(JSON.stringify({
    schema: 'nfl_transaction_ingest.v1',
    status: 'pass',
    snapshot_id: snapshot.snapshot_id,
    coverage: snapshot.coverage,
    ...written,
  }, null, 2));
}

function normalizeTradeAssets(rows: CsvRow[]): NflTradeAssetRow[] {
  return rows.flatMap((row, index) => {
    const year = integer(row.season);
    const tradeDate = row.trade_date;
    if (year == null || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return [];
    const isPick = integer(row.pick_round) != null;
    if (!isPick && !row.pfr_name) return [];
    return [{
      asset_id: `trade-${row.trade_id}-asset-${index}`,
      trade_id: row.trade_id,
      event_year: year,
      trade_date: tradeDate,
      gave_team_id: row.gave,
      received_team_id: row.received,
      asset_type: isPick ? 'draft_pick' as const : 'player' as const,
      pfr_id: row.pfr_id || null,
      pfr_name: isPick ? null : row.pfr_name || null,
      pick_season: integer(row.pick_season),
      pick_round: integer(row.pick_round),
      pick_number: integer(row.pick_number),
      conditional: row.conditional === '' ? null : row.conditional === '1',
      raw_source_record: row,
      source_ref_id: 'trades',
    }];
  });
}

function normalizeTradeEvents(
  assets: NflTradeAssetRow[],
  players: ReturnType<typeof playerLookup>,
): { events: NflTransactionMarketEvent[]; matches: NflPlayerExternalIdMatchRow[] } {
  const byTrade = groupBy(assets, (asset) => asset.trade_id);
  const events: NflTransactionMarketEvent[] = [];
  const matches: NflPlayerExternalIdMatchRow[] = [];
  for (const [tradeId, tradeAssets] of byTrade) {
    const playerAssets = tradeAssets.filter((asset) => asset.asset_type === 'player');
    for (const playerAsset of playerAssets) {
      const player = playerAsset.pfr_id ? players.byPfr.get(playerAsset.pfr_id) : undefined;
      const position = normalizePosition(player?.pff_position, player?.position, player?.position_group);
      const confidence = player && position.group ? 'matched' : player ? 'directional' : 'unmatched';
      const oppositeAssets = tradeAssets.filter((asset) => (
        asset.gave_team_id === playerAsset.received_team_id
        && asset.received_team_id === playerAsset.gave_team_id
      ));
      const pickRounds = oppositeAssets.flatMap((asset) => asset.pick_round == null ? [] : [asset.pick_round]);
      const compensationIncludesPlayer = oppositeAssets.some((asset) => asset.asset_type === 'player');
      const band = compensationBand(pickRounds, compensationIncludesPlayer);
      const eventId = `trade-${tradeId}-${playerAsset.asset_id}`;
      const sourceRefIds = player ? ['trades', 'players'] : ['trades'];
      events.push({
        event_id: eventId,
        event_year: playerAsset.event_year,
        event_date: playerAsset.trade_date,
        date_precision: 'day',
        transaction_type: 'trade',
        player_id: player?.gsis_id || player?.pfr_id || playerAsset.pfr_id,
        player_name: playerAsset.pfr_name ?? player?.display_name ?? 'Unknown player',
        raw_position: player?.position || null,
        position_group: position.group,
        normalization_basis: position.basis,
        from_team_id: playerAsset.gave_team_id,
        to_team_id: playerAsset.received_team_id,
        contract_value_dollars: null,
        contract_apy_dollars: null,
        guaranteed_dollars: null,
        compensation_pick_rounds: pickRounds,
        compensation_includes_player: compensationIncludesPlayer,
        trade_player_asset_count: playerAssets.length,
        compensation_band: band,
        compensation_summary: compensationSummary(oppositeAssets, playerAssets.length),
        identity_confidence: confidence,
        source_ref_ids: sourceRefIds,
        raw_source_record: playerAsset.raw_source_record,
      });
      matches.push({
        event_id: eventId,
        player_id: player?.gsis_id || player?.pfr_id || playerAsset.pfr_id,
        player_name: playerAsset.pfr_name ?? player?.display_name ?? 'Unknown player',
        pfr_id: playerAsset.pfr_id,
        gsis_id: player?.gsis_id || null,
        otc_id: player?.otc_id || null,
        raw_position: player?.position || null,
        normalized_position_group: position.group,
        match_confidence: confidence,
        normalization_basis: position.basis,
      });
    }
  }
  return { events, matches };
}

function normalizeContractEvents(
  rows: ContractParquetRow[],
  players: ReturnType<typeof playerLookup>,
): { events: NflTransactionMarketEvent[]; terms: NflContractTermRow[]; matches: NflPlayerExternalIdMatchRow[] } {
  const events: NflTransactionMarketEvent[] = [];
  const terms: NflContractTermRow[] = [];
  const matches: NflPlayerExternalIdMatchRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const year = row.year_signed ?? null;
    if (year == null || year < 2016 || year > 2026 || row.apy == null || row.value == null || row.guaranteed == null || row.apy_cap_pct == null) continue;
    const history = matchingContractHistory(row);
    const rawType = history?.contract_type ?? '';
    if (!MATERIAL_CONTRACT_TYPES.has(rawType)) continue;
    const transactionType = normalizeContractType(rawType);
    const player = row.gsis_id ? players.byGsis.get(row.gsis_id) : row.otc_id != null ? players.byOtc.get(String(row.otc_id)) : undefined;
    const rawPosition = player?.position || row.position || '';
    const position = normalizePosition(player?.pff_position, rawPosition, player?.position_group);
    const confidence = position.group && (row.gsis_id || row.otc_id != null) ? 'matched' : position.group ? 'directional' : 'unmatched';
    const playerId = row.gsis_id || (row.otc_id != null ? `otc:${row.otc_id}` : `name:${slug(row.player ?? 'unknown')}`);
    const valueDollars = millionsToDollars(row.value);
    const apyDollars = millionsToDollars(row.apy);
    const rawGuaranteedDollars = millionsToDollars(row.guaranteed);
    // A small number of upstream historical rows report a guarantee above the
    // row's current contract value. Preserve the raw term row, but do not use
    // that inconsistent pair in the deterministic guarantee-share statistic.
    const guaranteedDollars = rawGuaranteedDollars <= valueDollars ? rawGuaranteedDollars : null;
    const capBasisPoints = Math.round(row.apy_cap_pct * 10_000);
    const leagueCap = row.apy_cap_pct > 0 ? Math.round(apyDollars / row.apy_cap_pct) : null;
    const dedupe = [playerId, year, row.team, rawType, valueDollars, apyDollars, guaranteedDollars].join('|');
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const eventId = `contract-${hashText(dedupe).slice(0, 24)}`;
    const teamId = normalizeTeam(row.team ?? history?.team ?? '');
    const sourceRefIds = player ? ['contracts', 'players'] : ['contracts'];
    events.push({
      event_id: eventId,
      event_year: year,
      event_date: null,
      date_precision: 'year',
      transaction_type: transactionType,
      player_id: playerId,
      player_name: row.player ?? player?.display_name ?? 'Unknown player',
      raw_position: rawPosition,
      position_group: position.group,
      normalization_basis: position.basis,
      from_team_id: null,
      to_team_id: teamId,
      contract_value_dollars: valueDollars,
      contract_apy_dollars: apyDollars,
      guaranteed_dollars: guaranteedDollars,
      league_cap_dollars: leagueCap,
      trade_player_asset_count: null,
      compensation_band: null,
      compensation_summary: null,
      identity_confidence: confidence,
      source_ref_ids: sourceRefIds,
      raw_source_record: {
        player: row.player,
        position: row.position,
        team: row.team,
        year_signed: row.year_signed,
        years: row.years,
        value_millions: row.value,
        apy_millions: row.apy,
        guaranteed_millions: row.guaranteed,
        apy_cap_pct: row.apy_cap_pct,
      },
    });
    terms.push({
      event_id: eventId,
      player_id: playerId,
      player_name: row.player ?? player?.display_name ?? 'Unknown player',
      team_id: teamId,
      raw_team: row.team ?? history?.team ?? '',
      raw_position: rawPosition,
      normalized_position_group: position.group,
      raw_contract_type: rawType,
      raw_status: history?.status ?? null,
      transaction_type: transactionType,
      year_signed: year,
      years: Math.round(row.years ?? history?.yrs ?? 0),
      value_dollars: valueDollars,
      apy_dollars: apyDollars,
      guaranteed_dollars: rawGuaranteedDollars,
      apy_cap_basis_points: capBasisPoints,
      source_url: row.player_page ?? null,
      normalization_basis: position.basis,
      raw_source_record: {
        player: row.player,
        position: row.position,
        team: row.team,
        year_signed: row.year_signed,
        years: row.years,
        value_millions: row.value,
        apy_millions: row.apy,
        guaranteed_millions: row.guaranteed,
        guarantee_share_eligible: guaranteedDollars != null,
        apy_cap_pct: row.apy_cap_pct,
        contract_history_match: history ?? null,
      },
    });
    matches.push({
      event_id: eventId,
      player_id: playerId,
      player_name: row.player ?? player?.display_name ?? 'Unknown player',
      pfr_id: player?.pfr_id || null,
      gsis_id: row.gsis_id ?? player?.gsis_id ?? null,
      otc_id: row.otc_id == null ? null : String(row.otc_id),
      raw_position: rawPosition || null,
      normalized_position_group: position.group,
      match_confidence: confidence,
      normalization_basis: position.basis,
    });
  }
  return { events, terms, matches };
}

function normalizeRosterPopulations(
  rows: CsvRow[],
  players: ReturnType<typeof playerLookup>,
): NflTransactionRosterPlayerSeason[] {
  const unique = new Map<string, { year: number; team: string; position: NflPositionMarketGroup }>();
  for (const row of rows) {
    const year = integer(row.season);
    if (year == null || !COMPLETED_YEARS.includes(year)) continue;
    const player = row.gsis_id ? players.byGsis.get(row.gsis_id) : row.pfr_id ? players.byPfr.get(row.pfr_id) : undefined;
    const normalized = normalizePosition(player?.pff_position, player?.position || row.depth_chart_position || row.position, player?.position_group || row.position);
    if (!normalized.group) continue;
    const playerKey = row.gsis_id || row.pfr_id || `${row.full_name}|${row.birth_date}`;
    if (!playerKey || !row.team) continue;
    unique.set(`${year}|${row.team}|${playerKey}`, { year, team: row.team, position: normalized.group });
  }
  const teamCounts = new Map<string, number>();
  const leaguePlayers = new Map<string, Set<string>>();
  for (const [key, row] of unique) {
    const playerKey = key.split('|').slice(2).join('|');
    const teamKey = `${row.year}|${row.team}|${row.position}`;
    teamCounts.set(teamKey, (teamCounts.get(teamKey) ?? 0) + 1);
    const leagueKey = `${row.year}|${row.position}`;
    if (!leaguePlayers.has(leagueKey)) leaguePlayers.set(leagueKey, new Set());
    leaguePlayers.get(leagueKey)!.add(playerKey);
  }
  const result: NflTransactionRosterPlayerSeason[] = [];
  for (const [key, count] of teamCounts) {
    const [year, team, position] = key.split('|');
    result.push({ year: Number(year), team_id: team, position_group: position as NflPositionMarketGroup, roster_player_seasons: count, source_ref_ids: [`rosters-${year}`] });
  }
  for (const [key, playersForYear] of leaguePlayers) {
    const [year, position] = key.split('|');
    result.push({ year: Number(year), team_id: null, position_group: position as NflPositionMarketGroup, roster_player_seasons: playersForYear.size, source_ref_ids: [`rosters-${year}`] });
  }
  return result.sort((a, b) => a.year - b.year || (a.team_id ?? '').localeCompare(b.team_id ?? '') || a.position_group.localeCompare(b.position_group));
}

function deriveLeagueCaps(events: NflTransactionMarketEvent[]): NflTransactionLeagueCap[] {
  const byYear = new Map<number, number[]>();
  for (const event of events) {
    if (event.league_cap_dollars == null) continue;
    if (!byYear.has(event.event_year)) byYear.set(event.event_year, []);
    byYear.get(event.event_year)!.push(event.league_cap_dollars);
  }
  return [...byYear].map(([year, values]) => ({
    year,
    league_cap_dollars: median(values),
    source_ref_ids: ['contracts'],
  })).sort((a, b) => a.year - b.year);
}

function buildSnapshotCoverage(
  events: NflTransactionMarketEvent[],
  assets: NflTradeAssetRow[],
  terms: NflContractTermRow[],
): NflTransactionSnapshotCoverage {
  const scoped = events.filter((event) => event.event_year >= 2016 && event.event_year <= 2025);
  const matched = scoped.filter((event) => event.identity_confidence === 'matched').length;
  const directional = scoped.filter((event) => event.identity_confidence === 'directional').length;
  const trades = scoped.filter((event) => event.transaction_type === 'trade');
  const allocable = trades.filter((event) => event.trade_player_asset_count === 1 && compensationBand(event.compensation_pick_rounds ?? [], event.compensation_includes_player ?? false) !== 'unknown').length;
  const types: Partial<Record<NflTransactionType, number>> = {};
  for (const event of scoped) types[event.transaction_type] = (types[event.transaction_type] ?? 0) + 1;
  return {
    start_year: Math.min(...scoped.map((event) => event.event_year)),
    end_year: Math.max(...scoped.map((event) => event.event_year)),
    event_count: scoped.length,
    trade_event_count: trades.length,
    contract_event_count: scoped.length - trades.length,
    trade_asset_count: assets.filter((row) => row.event_year >= 2016 && row.event_year <= 2025).length,
    contract_term_count: terms.filter((row) => row.year_signed >= 2016 && row.year_signed <= 2025).length,
    matched_position_count: matched,
    directional_position_count: directional,
    unmatched_position_count: scoped.length - matched - directional,
    position_match_basis_points: scoped.length ? Math.round((matched / scoped.length) * 10_000) : 0,
    compensation_coverage_basis_points: trades.length ? Math.round((allocable / trades.length) * 10_000) : 0,
    contract_term_coverage_basis_points: terms.length
      ? Math.round((terms.filter((row) => row.guaranteed_dollars <= row.value_dollars).length / terms.length) * 10_000)
      : 0,
    transaction_types: types,
  };
}

function sourceReferences(assets: ReleaseAsset[], retrievedAt: string): NflTransactionMarketSourceRef[] {
  const grouped = groupBy(assets, (asset) => asset.tag);
  const refs: NflTransactionMarketSourceRef[] = [];
  for (const [tag, rows] of grouped) {
    if (tag === 'rosters') {
      for (const row of rows) {
        const year = row.name.match(/(20\d{2})/)?.[1] ?? 'unknown';
        refs.push(sourceRef(`rosters-${year}`, `nflverse roster ${year}`, row, retrievedAt, `Season ${year} roster rows provide unique player-season position denominators. ${SOURCE_DICTIONARIES.project}`));
      }
      continue;
    }
    const row = rows[0];
    const dictionary = tag === 'trades' ? SOURCE_DICTIONARIES.trades : tag === 'players' ? SOURCE_DICTIONARIES.players : SOURCE_DICTIONARIES.contracts;
    const name = tag === 'contracts' ? 'nflverse historical contracts (OverTheCap-derived)' : `nflverse ${tag}`;
    refs.push(sourceRef(tag, name, row, retrievedAt, `Release asset dictionary: ${dictionary}. Public-data prototype; underlying data remains subject to upstream ownership terms.`));
  }
  return refs.sort((a, b) => a.id.localeCompare(b.id));
}

function sourceRef(id: string, name: string, asset: ReleaseAsset, retrievedAt: string, note: string): NflTransactionMarketSourceRef {
  return {
    id,
    name,
    url: asset.url,
    upstream_attribution: id === 'trades' ? 'nflverse; trade data credits Lee Sharpe and Pro Football Reference.' : id === 'contracts' ? 'nflverse; historical contract data derived from OverTheCap.' : 'nflverse public release; underlying data ownership terms apply.',
    retrieved_at: retrievedAt,
    as_of_date: asset.updated_at.slice(0, 10),
    checksum_sha256: asset.sha256,
    coverage_note: note,
  };
}

function matchingContractHistory(row: ContractParquetRow): ContractHistoryRow | null {
  const candidates = (row.contract_history ?? []).filter((history) => history.year_signed === row.year_signed);
  const exact = candidates.find((history) => numbersEqual(history.apy, row.apy) && teamNamesOverlap(history.team, row.team));
  return exact ?? candidates.find((history) => numbersEqual(history.apy, row.apy)) ?? null;
}

function normalizeContractType(value: string): NflTransactionType {
  if (value === 'Extension') return 'extension';
  if (value === 'Franchise' || value === 'Transition') return 'tag';
  if (value === 'RFA' || value === 'ERFA') return 're_signing';
  return 'free_agent_signing';
}

function playerLookup(rows: PlayerLookupRow[]) {
  const byPfr = new Map(rows.filter((row) => row.pfr_id).map((row) => [row.pfr_id, row]));
  const byGsis = new Map(rows.filter((row) => row.gsis_id).map((row) => [row.gsis_id, row]));
  const byOtc = new Map(rows.filter((row) => row.otc_id).map((row) => [String(row.otc_id), row]));
  return { byPfr, byGsis, byOtc };
}

function normalizePosition(pffPosition?: string | null, rawPosition?: string | null, rawGroup?: string | null): { group: NflPositionMarketGroup | null; basis: string } {
  const pff = (pffPosition ?? '').toUpperCase().trim();
  const pffMap: Record<string, NflPositionMarketGroup> = {
    QB: 'QB', HB: 'RB', FB: 'RB', RB: 'RB', WR: 'WR', TE: 'TE', T: 'OT', OT: 'OT',
    G: 'IOL', C: 'IOL', ED: 'EDGE', DI: 'IDL', LB: 'LB', CB: 'CB', S: 'S', K: 'ST', P: 'ST', LS: 'ST',
  };
  if (pffMap[pff]) return { group: pffMap[pff], basis: `stable provider role code pff_position=${pff}` };
  const raw = (rawPosition ?? '').toUpperCase().trim();
  const direct: Record<string, NflPositionMarketGroup> = {
    QB: 'QB', RB: 'RB', HB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', LT: 'OT', RT: 'OT', T: 'OT', OT: 'OT',
    LG: 'IOL', RG: 'IOL', G: 'IOL', C: 'IOL', OC: 'IOL', IOL: 'IOL', EDGE: 'EDGE', ED: 'EDGE',
    DT: 'IDL', NT: 'IDL', IDL: 'IDL', DI: 'IDL', ILB: 'LB', MLB: 'LB', LB: 'LB', CB: 'CB', FS: 'S', SS: 'S', S: 'S',
    K: 'ST', P: 'ST', LS: 'ST', ST: 'ST',
  };
  if (direct[raw]) return { group: direct[raw], basis: `provider position=${raw}` };
  const group = (rawGroup ?? '').toUpperCase().trim();
  if (group === 'OL') return { group: null, basis: 'ambiguous OL family excluded from precise OT/IOL comparison' };
  if (raw === 'DE' || raw === 'OLB' || group === 'DL') return { group: null, basis: 'ambiguous DE/OLB/DL mapping excluded from precise EDGE comparison' };
  return { group: null, basis: `unsupported or missing provider position ${raw || group || 'unknown'}` };
}

function compensationBand(rounds: number[], includesPlayer: boolean): NflTradeCompensationBand {
  if (rounds.includes(1)) return 'round_1';
  if (rounds.some((round) => round === 2 || round === 3)) return 'rounds_2_3';
  if (rounds.some((round) => round >= 4 && round <= 7)) return 'rounds_4_7';
  if (includesPlayer) return 'player_only';
  return 'unknown';
}

function compensationSummary(assets: NflTradeAssetRow[], playerCount: number): string {
  const picks = assets.filter((asset) => asset.asset_type === 'draft_pick');
  const players = assets.filter((asset) => asset.asset_type === 'player');
  const pieces = [
    picks.length ? picks.map((pick) => `${pick.pick_season} R${pick.pick_round}${pick.conditional ? ' conditional' : ''}`).join(', ') : '',
    players.length ? `${players.length} player asset${players.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const summary = pieces.join(' plus ') || 'Compensation unavailable';
  return playerCount === 1 ? summary : `${summary}; multi-player trade, not allocated per player`;
}

async function readContractParquet(filePath: string): Promise<ContractParquetRow[]> {
  const file = await asyncBufferFromFile(filePath);
  return await parquetReadObjects({
    file,
    columns: ['player', 'position', 'team', 'year_signed', 'years', 'value', 'apy', 'guaranteed', 'apy_cap_pct', 'player_page', 'otc_id', 'gsis_id', 'contract_history'],
  }) as ContractParquetRow[];
}

async function readCsv(filePath: string): Promise<CsvRow[]> {
  return parseCsv(await readFile(filePath, 'utf8'));
}

async function readGzipCsv(filePath: string): Promise<CsvRow[]> {
  return parseCsv(gunzipSync(await readFile(filePath)).toString('utf8'));
}

export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const [header, ...data] = rows;
  if (!header?.length) return [];
  return data.filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(header.map((column, index) => [column, values[index] ?? ''])));
}

async function loadAssetManifest(filePath: string): Promise<ReleaseAsset[]> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as { assets?: ReleaseAsset[] };
  if (!Array.isArray(parsed.assets)) throw new Error('source-assets.json is missing assets');
  return parsed.assets;
}

function assetLookup(assets: ReleaseAsset[]): Map<string, ReleaseAsset> {
  const result = new Map(assets.map((asset) => [asset.local_path, asset]));
  for (const required of ['trades.csv', 'players.csv.gz', 'historical_contracts.parquet', ...COMPLETED_YEARS.map((year) => `rosters/roster_${year}.csv`)]) {
    if (!result.has(required)) throw new Error(`source manifest is missing ${required}`);
  }
  return result;
}

function normalizeTeam(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || normalized.includes('/')) return null;
  const map: Record<string, string> = {
    '49ers': 'SF', Bears: 'CHI', Bengals: 'CIN', Bills: 'BUF', Broncos: 'DEN', Browns: 'CLE', Buccaneers: 'TB',
    Cardinals: 'ARI', Chargers: 'LAC', Chiefs: 'KC', Colts: 'IND', Commanders: 'WAS', Cowboys: 'DAL', Dolphins: 'MIA',
    Eagles: 'PHI', Falcons: 'ATL', Giants: 'NYG', Jaguars: 'JAX', Jets: 'NYJ', Lions: 'DET', Packers: 'GB',
    Panthers: 'CAR', Patriots: 'NE', Raiders: 'LV', Rams: 'LAR', Ravens: 'BAL', Saints: 'NO', Seahawks: 'SEA',
    Steelers: 'PIT', Texans: 'HOU', Titans: 'TEN', Vikings: 'MIN', Redskins: 'WAS', 'Football Team': 'WAS',
    Oakland: 'LV', 'St. Louis': 'LAR', 'San Diego': 'LAC',
  };
  return map[normalized] ?? (/^[A-Z]{2,3}$/.test(normalized) ? normalized : null);
}

function millionsToDollars(value: number): number {
  return Math.round(value * 1_000_000);
}

function integer(value: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[midpoint] : Math.round((ordered[midpoint - 1] + ordered[midpoint]) / 2);
}

function numbersEqual(a?: number | null, b?: number | null): boolean {
  return a != null && b != null && Math.abs(a - b) < 0.000001;
}

function teamNamesOverlap(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a === b || b.split('/').includes(a) || a.split('/').includes(b);
}

function compareEvents(a: NflTransactionMarketEvent, b: NflTransactionMarketEvent): number {
  return a.event_year - b.event_year || (a.event_date ?? '').localeCompare(b.event_date ?? '') || a.event_id.localeCompare(b.event_id);
}

function groupBy<T, K>(rows: T[], key: (row: T) => K): Map<K, T[]> {
  const result = new Map<K, T[]>();
  for (const row of rows) {
    const value = key(row);
    if (!result.has(value)) result.set(value, []);
    result.get(value)!.push(row);
  }
  return result;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value));
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function argument(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(JSON.stringify({ schema: 'nfl_transaction_ingest.v1', status: 'fail', error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
