import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NflTransactionMarketSnapshot } from './analyze.js';
import type { ReviewedNflTransactionSnapshot } from './ingest.js';
import { validateReviewedSnapshot } from './ingest.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const DEFAULT_NFL_TRANSACTION_MANIFEST_PATH = path.join(REPO_ROOT, 'data/nfl-transactions/manifest.json');

export interface NflTransactionSnapshotManifest {
  schema_version: 'nfl_transaction_snapshot_manifest.v1';
  snapshot_id: string;
  snapshot_file: string;
  snapshot_checksum_sha256: string;
  generated_at: string;
  retrieved_at: string;
  as_of_date: string;
  transformation_version: string;
  coverage: ReviewedNflTransactionSnapshot['coverage'];
  sources: ReviewedNflTransactionSnapshot['source_refs'];
  licensing_boundary: string;
}

export interface NflTransactionMarketDataHealth {
  source_mode: 'supabase_current_views' | 'checked_in_snapshot';
  snapshot_id: string;
  as_of_date: string;
  retrieved_at: string;
  row_count: number;
  coverage: ReviewedNflTransactionSnapshot['coverage'];
  sources: ReviewedNflTransactionSnapshot['source_refs'];
  fallback_reason: string | null;
}

export async function loadReviewedNflTransactionSnapshot(
  manifestPath = DEFAULT_NFL_TRANSACTION_MANIFEST_PATH,
): Promise<{ snapshot: ReviewedNflTransactionSnapshot; manifest: NflTransactionSnapshotManifest }> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as NflTransactionSnapshotManifest;
  if (manifest.schema_version !== 'nfl_transaction_snapshot_manifest.v1') throw new Error('unsupported NFL transaction manifest');
  const snapshotPath = path.resolve(path.dirname(manifestPath), manifest.snapshot_file);
  const compressed = await readFile(snapshotPath);
  const checksum = createHash('sha256').update(compressed).digest('hex');
  if (checksum !== manifest.snapshot_checksum_sha256) throw new Error('NFL transaction snapshot checksum mismatch');
  const snapshot = JSON.parse(gunzipSync(compressed).toString('utf8')) as ReviewedNflTransactionSnapshot;
  validateReviewedSnapshot(snapshot);
  if (snapshot.snapshot_id !== manifest.snapshot_id) throw new Error('NFL transaction snapshot identity does not match manifest');
  return { snapshot, manifest };
}

export async function seedNflTransactionMarketData(
  snapshot: ReviewedNflTransactionSnapshot,
  manifest: NflTransactionSnapshotManifest,
  client?: SupabaseClient,
): Promise<{ snapshot_id: string; inserted_counts: Record<string, number> }> {
  const database = client ?? (await import('../db/client.js')).db;
  validateReviewedSnapshot(snapshot);
  if (snapshot.snapshot_id !== manifest.snapshot_id) throw new Error('manifest and transaction snapshot IDs differ');

  const existing = await database
    .from('nfl_transaction_dataset_snapshots')
    .select('snapshot_id,snapshot_checksum_sha256')
    .eq('snapshot_id', snapshot.snapshot_id)
    .maybeSingle();
  throwIfError(existing, 'transaction snapshot lookup');
  if (existing.data && existing.data.snapshot_checksum_sha256 !== manifest.snapshot_checksum_sha256) {
    throw new Error(`immutable transaction snapshot ${snapshot.snapshot_id} has a different checksum`);
  }
  if (!existing.data) {
    throwIfError(await database.from('nfl_transaction_dataset_snapshots').insert({
      snapshot_id: snapshot.snapshot_id,
      schema_version: snapshot.schema_version,
      transformation_version: snapshot.transformation_version,
      generated_at: snapshot.generated_at,
      retrieved_at: snapshot.retrieved_at,
      as_of_date: snapshot.as_of_date,
      snapshot_checksum_sha256: manifest.snapshot_checksum_sha256,
      snapshot_file: manifest.snapshot_file,
      coverage: snapshot.coverage,
      licensing_boundary: manifest.licensing_boundary,
    }), 'transaction snapshot insert');
  }

  const tables: Array<[string, Record<string, unknown>[]]> = [
    ['nfl_transaction_source_manifests', snapshot.source_refs.map((source) => ({
      snapshot_id: snapshot.snapshot_id,
      source_ref_id: source.id,
      source_name: source.name,
      source_url: source.url,
      upstream_attribution: source.upstream_attribution,
      retrieved_at: source.retrieved_at,
      as_of_date: source.as_of_date,
      checksum_sha256: source.checksum_sha256,
      coverage_note: source.coverage_note,
    }))],
    ['nfl_transaction_events', snapshot.events.map((event) => ({ snapshot_id: snapshot.snapshot_id, ...event }))],
    ['nfl_trade_assets', snapshot.trade_assets.map((asset) => ({ snapshot_id: snapshot.snapshot_id, ...asset }))],
    ['nfl_contract_terms', snapshot.contract_terms.map((term) => ({ snapshot_id: snapshot.snapshot_id, ...term }))],
    ['nfl_player_external_id_matches', snapshot.player_matches.map((match) => ({ snapshot_id: snapshot.snapshot_id, ...match }))],
    ['nfl_position_year_populations', snapshot.roster_player_seasons.map((population) => ({
      snapshot_id: snapshot.snapshot_id,
      ...population,
      team_id: population.team_id ?? '__LEAGUE__',
    }))],
    ['nfl_transaction_league_caps', snapshot.league_caps.map((cap) => ({ snapshot_id: snapshot.snapshot_id, ...cap }))],
  ];
  const insertedCounts: Record<string, number> = {};
  for (const [table, rows] of tables) {
    await upsertChunks(database, table, rows);
    insertedCounts[table] = rows.length;
  }
  return { snapshot_id: snapshot.snapshot_id, inserted_counts: insertedCounts };
}

export async function loadCurrentNflTransactionMarketSnapshot(
  client?: SupabaseClient,
): Promise<NflTransactionMarketSnapshot> {
  const database = client ?? (await import('../db/client.js')).db;
  const snapshotResult = await database.from('nfl_current_transaction_dataset_snapshot').select('*').single();
  throwIfError(snapshotResult, 'current transaction snapshot');
  const snapshotRow = snapshotResult.data as Record<string, unknown>;
  const [events, populations, caps, sources] = await Promise.all([
    selectAll(database, 'nfl_current_transaction_events'),
    selectAll(database, 'nfl_current_position_year_populations'),
    selectAll(database, 'nfl_current_transaction_league_caps'),
    selectAll(database, 'nfl_current_transaction_source_manifests'),
  ]);
  if (!events.length) throw new Error('current transaction snapshot has no events');
  return {
    snapshot_id: String(snapshotRow.snapshot_id),
    events: events.map((row) => ({
      event_id: String(row.event_id),
      event_year: Number(row.event_year),
      event_date: nullableString(row.event_date),
      date_precision: row.date_precision as 'day' | 'year',
      transaction_type: row.transaction_type as NflTransactionMarketSnapshot['events'][number]['transaction_type'],
      player_id: nullableString(row.player_id),
      player_name: String(row.player_name),
      raw_position: nullableString(row.raw_position),
      position_group: row.position_group as NflTransactionMarketSnapshot['events'][number]['position_group'],
      normalization_basis: nullableString(row.normalization_basis),
      from_team_id: nullableString(row.from_team_id),
      to_team_id: nullableString(row.to_team_id),
      contract_value_dollars: nullableNumber(row.contract_value_dollars),
      contract_apy_dollars: nullableNumber(row.contract_apy_dollars),
      guaranteed_dollars: nullableNumber(row.guaranteed_dollars),
      league_cap_dollars: nullableNumber(row.league_cap_dollars),
      compensation_pick_rounds: Array.isArray(row.compensation_pick_rounds) ? row.compensation_pick_rounds.map(Number) : [],
      compensation_includes_player: row.compensation_includes_player == null ? undefined : Boolean(row.compensation_includes_player),
      trade_player_asset_count: nullableNumber(row.trade_player_asset_count),
      compensation_band: row.compensation_band as NflTransactionMarketSnapshot['events'][number]['compensation_band'],
      compensation_summary: nullableString(row.compensation_summary),
      identity_confidence: row.identity_confidence as NflTransactionMarketSnapshot['events'][number]['identity_confidence'],
      source_ref_ids: stringArray(row.source_ref_ids),
      raw_source_record: isRecord(row.raw_source_record) ? row.raw_source_record : null,
    })),
    roster_player_seasons: populations.map((row) => ({
      year: Number(row.year),
      team_id: row.team_id === '__LEAGUE__' ? null : String(row.team_id),
      position_group: row.position_group as NflTransactionMarketSnapshot['roster_player_seasons'][number]['position_group'],
      roster_player_seasons: Number(row.roster_player_seasons),
      source_ref_ids: stringArray(row.source_ref_ids),
    })),
    league_caps: caps.map((row) => ({
      year: Number(row.year),
      league_cap_dollars: Number(row.league_cap_dollars),
      source_ref_ids: stringArray(row.source_ref_ids),
    })),
    source_refs: sources.map((row) => ({
      id: String(row.source_ref_id),
      name: String(row.source_name),
      url: String(row.source_url),
      upstream_attribution: String(row.upstream_attribution),
      retrieved_at: String(row.retrieved_at),
      as_of_date: String(row.as_of_date),
      checksum_sha256: String(row.checksum_sha256),
      coverage_note: String(row.coverage_note),
    })),
  };
}

export async function loadNflTransactionMarketDataHealth(
  client?: SupabaseClient,
): Promise<NflTransactionMarketDataHealth> {
  const database = client ?? (await import('../db/client.js')).db;
  const result = await database.from('nfl_current_transaction_dataset_snapshot').select('*').single();
  throwIfError(result, 'current transaction snapshot health');
  const row = result.data as Record<string, unknown>;
  const sources = await selectAll(database, 'nfl_current_transaction_source_manifests');
  return {
    source_mode: 'supabase_current_views',
    snapshot_id: String(row.snapshot_id),
    as_of_date: String(row.as_of_date),
    retrieved_at: String(row.retrieved_at),
    row_count: Number((row.coverage as ReviewedNflTransactionSnapshot['coverage']).event_count),
    coverage: row.coverage as ReviewedNflTransactionSnapshot['coverage'],
    sources: sources.map((source) => ({
      id: String(source.source_ref_id),
      name: String(source.source_name),
      url: String(source.source_url),
      upstream_attribution: String(source.upstream_attribution),
      retrieved_at: String(source.retrieved_at),
      as_of_date: String(source.as_of_date),
      checksum_sha256: String(source.checksum_sha256),
      coverage_note: String(source.coverage_note),
    })),
    fallback_reason: null,
  };
}

async function upsertChunks(client: SupabaseClient, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let index = 0; index < rows.length; index += 500) {
    const result = await client.from(table).upsert(rows.slice(index, index + 500), { ignoreDuplicates: true });
    throwIfError(result, `${table} seed`);
  }
}

async function selectAll(client: SupabaseClient, table: string): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = [];
  for (let start = 0; ; start += 1_000) {
    const response = await client.from(table).select('*').range(start, start + 999);
    throwIfError(response, `${table} load`);
    const rows = (response.data ?? []) as Record<string, unknown>[];
    result.push(...rows);
    if (rows.length < 1_000) return result;
  }
}

function throwIfError(result: { error: { message: string } | null }, label: string): void {
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`unsafe integer in transaction snapshot: ${String(value)}`);
  return parsed;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
