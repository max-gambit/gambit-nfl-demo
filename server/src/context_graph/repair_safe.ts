import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { SAFE_VOCAB_REPAIRS } from './cleanup_policy.js';
import { discoverTeamFiles } from './parser.js';
import { DEFAULT_TEAMS_DIR } from './paths.js';
import { normalizeTeamAlias, VOCAB } from './schema.js';

interface RepairOptions {
  teamsDir: string;
  dryRun: boolean;
}

interface FileRepairResult {
  filePath: string;
  changed: boolean;
  changes: string[];
}

const PRE_PARSE_LINE_REPAIRS: Record<string, Array<[string, string]>> = {
  'det.yaml': [
    [
      '      - "Control every variable that we possibly can" (philosophy learned from David Griffin at Pelicans)',
      '      - \'"Control every variable that we possibly can" (philosophy learned from David Griffin at Pelicans)\'',
    ],
  ],
  'ind.yaml': [
    [
      '      - "We don\'t break it down, tear it up" — avoids full rebuilds',
      '      - \'"We don\'\'t break it down, tear it up" — avoids full rebuilds\'',
    ],
  ],
  'mia.yaml': [
    [
      '      - "We\'re going to be aggressive as hell to make the team better" (2026 exit presser, cbssports.com)',
      '      - \'"We\'\'re going to be aggressive as hell to make the team better" (2026 exit presser, cbssports.com)\'',
    ],
    [
      '      - "I want to build this around Bam" – declares Adebayo untouchable; prioritizes availability and consistency',
      '      - \'"I want to build this around Bam" – declares Adebayo untouchable; prioritizes availability and consistency\'',
    ],
    [
      '      summary: Five-team trade: Heat send Jimmy Butler to Golden State, receive Andrew Wiggins, Davion Mitchell, Kyle Anderson, protected 1st; also send Josh Richardson to Utah, cash to Toronto.',
      '      summary: "Five-team trade: Heat send Jimmy Butler to Golden State, receive Andrew Wiggins, Davion Mitchell, Kyle Anderson, protected 1st; also send Josh Richardson to Utah, cash to Toronto."',
    ],
  ],
  'min.yaml': [
    [
      '      - "Timberwolves need to be \'creative as possible\' with roster" (June 2025 statement, per Yardbarker)',
      '      - \'"Timberwolves need to be creative as possible with roster" (June 2025 statement, per Yardbarker)\'',
    ],
  ],
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const files = await discoverTeamFiles(options.teamsDir);
  const results = await Promise.all(files.map((filePath) => repairFile(filePath, options)));
  const changed = results.filter((result) => result.changed);

  for (const result of changed) {
    process.stdout.write(`${options.dryRun ? 'Would update' : 'Updated'} ${path.basename(result.filePath)}\n`);
    for (const change of result.changes) process.stdout.write(`  - ${change}\n`);
  }
  process.stdout.write(`${options.dryRun ? 'Dry run complete' : 'Safe repair complete'}: ${changed.length} file${changed.length === 1 ? '' : 's'} ${options.dryRun ? 'would change' : 'changed'}.\n`);
}

async function repairFile(filePath: string, options: RepairOptions): Promise<FileRepairResult> {
  const fileName = path.basename(filePath);
  let text = await readFile(filePath, 'utf8');
  const changes: string[] = [];

  for (const [from, to] of PRE_PARSE_LINE_REPAIRS[fileName] ?? []) {
    if (text.includes(from)) {
      text = text.replace(from, to);
      changes.push('fixed YAML scalar quoting');
    }
  }

  const parsed = YAML.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`${fileName}: expected YAML root object.`);
  }

  repairTeamDocument(parsed, changes);
  const nextText = YAML.stringify(parsed, { lineWidth: 0 });
  const normalizedNextText = nextText.endsWith('\n') ? nextText : `${nextText}\n`;

  if (changes.length > 0) {
    if (!options.dryRun) await writeFile(filePath, normalizedNextText, 'utf8');
    return { filePath, changed: true, changes: unique(changes) };
  }

  return { filePath, changed: false, changes: [] };
}

function repairTeamDocument(root: Record<string, unknown>, changes: string[]): void {
  normalizeDateField(root, 'as_of_date', changes);
  normalizeDateField(root, 'last_updated', changes);
  normalizeDateField(recordAt(root, 'strategic_posture'), 'last_reviewed', changes);
  normalizeSources(root, changes);
  normalizeTradeDna(root, changes);
  normalizeStrategicPosture(root, changes);
  normalizeCulturalSignals(root, changes);
  normalizeRoster(root, changes);
  normalizeKnownTargets(root, changes);
  normalizeKeyAssets(root, changes);
  normalizeTeamRelationships(root, changes);
  normalizeGLeagueAndStash(root, changes);
}

function normalizeTradeDna(root: Record<string, unknown>, changes: string[]): void {
  const tradeDna = recordAt(root, 'trade_dna');
  const partners = arrayAt(tradeDna, 'frequent_partners');
  for (let index = 0; index < partners.length; index += 1) {
    const normalized = normalizedTeamId(partners[index]);
    if (normalized && partners[index] !== normalized) {
      partners[index] = normalized;
      changes.push('normalized trade partner team ids');
    }
  }
  for (const trade of recordsAt(tradeDna, 'recent_significant_trades')) {
    normalizeDateField(trade, 'date', changes);
  }
}

function normalizeStrategicPosture(root: Record<string, unknown>, changes: string[]): void {
  for (const constraint of recordsAt(root, 'strategic_posture.constraints')) {
    replaceValue(constraint, 'reason_code', safeVocabTo('strategic_posture.constraints[].reason_code', constraint.reason_code), changes, 'mapped safe strategic posture vocabulary');
  }
}

function normalizeCulturalSignals(root: Record<string, unknown>, changes: string[]): void {
  const signals = recordAt(root, 'cultural_signals');
  const traits = arrayAt(signals, 'notable_traits');
  for (let index = 0; index < traits.length; index += 1) {
    if (traits[index] === 'recent_playoff_success') {
      traits[index] = 'process_driven';
      changes.push('mapped safe cultural trait vocabulary');
      continue;
    }
    const mapped = safeVocabTo('cultural_signals.notable_traits[]', traits[index]);
    if (mapped) {
      traits[index] = mapped;
      changes.push('mapped safe cultural trait vocabulary');
    }
  }
}

function normalizeRoster(root: Record<string, unknown>, changes: string[]): void {
  for (const player of recordsAt(root, 'roster')) {
    normalizeArchetype(player, changes);
    const contract = asRecord(player.contract);
    if (contract) {
      replaceValue(contract, 'years_remaining', normalizeNumber(contract.years_remaining), changes, 'normalized numeric contract fields');
      replaceValue(contract, 'player_option', normalizeOptionYear(contract.player_option), changes, 'normalized option years');
      replaceValue(contract, 'team_option', normalizeOptionYear(contract.team_option), changes, 'normalized option years');
      replaceValue(contract, 'contract_through', normalizeContractThrough(contract.contract_through), changes, 'normalized contract-through years');
      replaceValue(contract, 'bird_rights', safeVocabTo('roster[].contract.bird_rights', contract.bird_rights), changes, 'mapped safe bird-rights vocabulary');
    }

    const movement = asRecord(player.movement_constraints);
    const status = typeof movement?.status === 'string' ? movement.status : null;
    for (const reason of recordsAt(player, 'movement_constraints.reasons')) {
      const mapped = safeVocabTo('roster[].movement_constraints.reasons[].reason_code', reason.reason_code);
      if (mapped && canUseRecentlyAcquired(status, mapped)) {
        replaceValue(reason, 'reason_code', mapped, changes, 'mapped safe movement reason vocabulary');
      }
    }
  }
}

function normalizeArchetype(player: Record<string, unknown>, changes: string[]): void {
  const secondary = arrayAt(player, 'archetype.offensive_role.secondary');
  const specialTraits = arrayAt(player, 'archetype.special_traits');
  for (let index = secondary.length - 1; index >= 0; index -= 1) {
    const value = secondary[index];
    if (
      typeof value === 'string'
      && (VOCAB.specialTraits as readonly string[]).includes(value)
      && !(VOCAB.offensiveRole as readonly string[]).includes(value)
    ) {
      secondary.splice(index, 1);
      if (!specialTraits.includes(value)) specialTraits.push(value);
      changes.push('moved special traits out of offensive role arrays');
    }
  }
}

function normalizeKnownTargets(root: Record<string, unknown>, changes: string[]): void {
  for (const target of recordsAt(root, 'known_target_history')) {
    replaceValue(target, 'year', normalizeInteger(target.year), changes, 'normalized known-target years');
  }
}

function normalizeKeyAssets(root: Record<string, unknown>, changes: string[]): void {
  for (const pick of recordsAt(root, 'key_assets.draft_picks_owed')) {
    const normalized = normalizedTeamId(pick.to_team);
    if (normalized && pick.to_team !== normalized) {
      pick.to_team = normalized;
      changes.push('normalized owed-pick team ids');
    }
  }
}

function normalizeTeamRelationships(root: Record<string, unknown>, changes: string[]): void {
  if (!isRecord(root.team_team_relationships)) {
    root.team_team_relationships = {
      rivalries: [],
      notable_personnel_connections: [],
    };
    changes.push('created missing team relationship collections');
  }

  for (const rivalry of recordsAt(root, 'team_team_relationships.rivalries')) {
    const normalized = normalizedTeamId(rivalry.team_id);
    if (normalized && rivalry.team_id !== normalized) {
      rivalry.team_id = normalized;
      changes.push('normalized rivalry team ids');
    }
    replaceValue(rivalry, 'type', safeVocabTo('team_team_relationships.rivalries[].type', rivalry.type), changes, 'mapped safe rivalry vocabulary');
  }
}

function normalizeGLeagueAndStash(root: Record<string, unknown>, changes: string[]): void {
  const gLeague = recordAt(root, 'g_league_and_stash');
  if (typeof gLeague.international_stash === 'string') {
    const value = gLeague.international_stash.trim();
    gLeague.international_stash = emptyLike(value) ? [] : [value];
    changes.push('normalized international stash array shape');
  }
}

function normalizeSources(value: unknown, changes: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => normalizeSources(item, changes));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'source' && typeof child === 'string' && child !== 'unknown' && !/^https?:\/\//.test(child)) {
      value[key] = 'unknown';
      changes.push('normalized invalid source fields to unknown');
    } else {
      normalizeSources(child, changes);
    }
  }
}

function normalizeDateField(record: Record<string, unknown>, key: string, changes: string[]): void {
  replaceValue(record, key, normalizeDateLike(record[key]), changes, 'normalized date fields');
}

function normalizedTeamId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidates = [
    value,
    value.replace(/\s*\(.*/, ''),
    value.replace(/\s+[—–-]\s+.*/, ''),
  ].map((candidate) => candidate.trim()).filter(Boolean);
  for (const candidate of candidates) {
    const normalized = normalizeTeamAlias(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function safeVocabTo(pathName: string, value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = SAFE_VOCAB_REPAIRS.find((repair) => repair.path === pathName && repair.from === value);
  return match?.to ?? null;
}

function normalizeDateLike(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(20\d{2})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, year, rawMonth, rawDay] = match;
  const month = rawMonth.padStart(2, '0');
  const day = rawDay?.padStart(2, '0');
  return day ? `${year}-${month}-${day}` : `${year}-${month}`;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return Number(trimmed);
}

function normalizeInteger(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function normalizeOptionYear(value: unknown): string | null {
  if (emptyLike(value)) return 'none';
  if (typeof value !== 'string') return null;
  return normalizeSeasonToEndYear(value);
}

function normalizeContractThrough(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.trim().toLowerCase() === 'unknown') return 'uncertain';
  if (value.trim().toLowerCase() === 'expired') return 'expired_pending_decision';
  return normalizeSeasonToEndYear(value);
}

function normalizeSeasonToEndYear(value: string): string | null {
  const trimmed = value.trim();
  const fullYear = /^(20\d{2})$/.exec(trimmed);
  if (fullYear) return fullYear[1];
  const season = /^(20\d{2})[-/](\d{2})(?:\s+season)?$/i.exec(trimmed);
  if (season) return `20${season[2]}`;
  const fullSeason = /^(20\d{2})[-/](20\d{2})(?:\s+season)?$/i.exec(trimmed);
  if (fullSeason) return fullSeason[2];
  return null;
}

function replaceValue(record: Record<string, unknown>, key: string, next: unknown, changes: string[], note: string): void {
  if (next === null || next === undefined || record[key] === next) return;
  record[key] = next;
  changes.push(note);
}

function canUseRecentlyAcquired(status: string | null, mapped: string): boolean {
  if (mapped !== 'recently_acquired') return true;
  return status !== 'available' && status !== 'shopped' && status !== 'actively_traded';
}

function emptyLike(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  return ['none', 'no', 'n/a', 'na', 'unknown', ''].includes(value.trim().toLowerCase());
}

function recordAt(root: Record<string, unknown>, pathName: string): Record<string, unknown> {
  const value = getAt(root, pathName);
  return isRecord(value) ? value : {};
}

function arrayAt(root: Record<string, unknown>, pathName: string): unknown[] {
  const value = getAt(root, pathName);
  return Array.isArray(value) ? value : [];
}

function recordsAt(root: Record<string, unknown>, pathName: string): Record<string, unknown>[] {
  return arrayAt(root, pathName).filter(isRecord);
}

function getAt(root: Record<string, unknown>, pathName: string): unknown {
  let cursor: unknown = root;
  for (const part of pathName.split('.')) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function parseArgs(args: string[]): RepairOptions {
  let teamsDir = DEFAULT_TEAMS_DIR;
  let dryRun = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--teams-dir' && next) {
      teamsDir = path.resolve(next);
      i += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }
  return { teamsDir, dryRun };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
