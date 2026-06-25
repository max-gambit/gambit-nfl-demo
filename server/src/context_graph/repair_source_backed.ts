import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { mentionedTeams } from './edges.js';
import { discoverTeamFiles } from './parser.js';
import { DEFAULT_CONTEXT_GRAPH_DIR, REPO_ROOT } from './paths.js';
import { normalizeTeamAlias, TEAM_ID_SET } from './schema.js';

interface RepairOptions {
  teamsDir: string;
  dryRun: boolean;
  rosterPath: string;
  capSheetPath: string;
}

interface TeamRoot {
  filePath: string;
  teamId: string;
  data: Record<string, unknown>;
  changes: string[];
}

interface ReviewedSources {
  officialTeamByPlayerId: Map<string, string>;
  payrollByTeam: Map<string, number>;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const sources = await loadReviewedSources(options);
  const files = await discoverTeamFiles(options.teamsDir);
  const roots = await Promise.all(files.map((filePath) => loadTeamRoot(filePath)));

  for (const root of roots) repairTeamRoot(root, sources);
  repairDuplicateRosterPlayers(roots, sources);
  repairPendingFreeAgents(roots);
  repairPickReciprocity(roots);

  const changed = roots.filter((root) => root.changes.length > 0);
  for (const root of changed) {
    process.stdout.write(`${options.dryRun ? 'Would update' : 'Updated'} ${path.basename(root.filePath)}\n`);
    for (const change of unique(root.changes)) process.stdout.write(`  - ${change}\n`);
    if (!options.dryRun) {
      const text = YAML.stringify(root.data, { lineWidth: 0 });
      await writeFile(root.filePath, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    }
  }

  process.stdout.write(`${options.dryRun ? 'Dry run complete' : 'Source-backed repair complete'}: ${changed.length} file${changed.length === 1 ? '' : 's'} ${options.dryRun ? 'would change' : 'changed'}.\n`);
}

async function loadTeamRoot(filePath: string): Promise<TeamRoot> {
  const data = YAML.parse(await readFile(filePath, 'utf8'));
  if (!isRecord(data)) throw new Error(`${path.basename(filePath)}: expected YAML root object.`);
  const teamId = stringValue(data.team_id) ?? path.basename(filePath, '.yaml').toUpperCase();
  return { filePath, teamId, data, changes: [] };
}

async function loadReviewedSources(options: RepairOptions): Promise<ReviewedSources> {
  const roster = JSON.parse(await readFile(options.rosterPath, 'utf8')) as Record<string, unknown>;
  const capSheets = JSON.parse(await readFile(options.capSheetPath, 'utf8')) as Record<string, unknown>;
  const officialTeamByPlayerId = new Map<string, string>();
  for (const entry of arrayOfRecords(roster.entries)) {
    const teamId = stringValue(entry.team_id);
    const sourceRow = isRecord(entry.source_row) ? entry.source_row : {};
    const first = stringValue(sourceRow.PLAYER_FIRST_NAME);
    const last = stringValue(sourceRow.PLAYER_LAST_NAME);
    const fullName = [first, last].filter(Boolean).join(' ').trim();
    if (teamId && fullName) officialTeamByPlayerId.set(playerIdForName(fullName), teamId);
  }

  const payrollByTeam = new Map<string, number>();
  for (const sheet of arrayOfRecords(capSheets.cap_sheets)) {
    const teamId = stringValue(sheet.team_id);
    const payroll = sheet.payroll_amount;
    if (teamId && typeof payroll === 'number' && !Number.isNaN(payroll)) {
      payrollByTeam.set(teamId, payroll);
    }
  }

  return { officialTeamByPlayerId, payrollByTeam };
}

function repairTeamRoot(root: TeamRoot, sources: ReviewedSources): void {
  const payroll = sources.payrollByTeam.get(root.teamId);
  const capSituation = recordAt(root.data, 'cap_situation');
  if (payroll !== undefined && typeof capSituation.current_payroll_estimate !== 'number') {
    capSituation.current_payroll_estimate = payroll;
    root.changes.push('filled payroll estimate from reviewed cap-sheet snapshot');
  }

  for (const trade of recordsAt(root.data, 'trade_dna.recent_significant_trades')) {
    if (!Array.isArray(trade.counterparties)) {
      const teams = mentionedTeams(stringValue(trade.summary) ?? '', root.teamId);
      if (teams.length > 0) {
        trade.counterparties = teams;
        root.changes.push('structured recent trade counterparties');
      }
    }
  }

  for (const player of recordsAt(root.data, 'roster')) {
    repairContract(player, root);
    repairMovement(player, root);
  }

  for (const priority of recordsAt(root.data, 'near_term_priorities')) {
    if (priority.type === undefined) {
      priority.type = inferPriorityType(priority);
      root.changes.push('classified near-term priority type');
    }
  }

  for (const pick of recordsAt(root.data, 'key_assets.draft_picks_owed')) {
    structureConditionalPick(pick, root);
  }
}

function repairContract(player: Record<string, unknown>, root: TeamRoot): void {
  const contract = asRecord(player.contract);
  if (!contract) return;
  if (contract.player_option === true || stringValue(contract.player_option)?.toLowerCase() === 'yes') {
    contract.player_option = 'option_pending';
    root.changes.push('normalized option presence to option_pending');
  }
  if (contract.team_option === true || stringValue(contract.team_option)?.toLowerCase() === 'yes') {
    contract.team_option = 'option_pending';
    root.changes.push('normalized option presence to option_pending');
  }
  const contractThrough = stringValue(contract.contract_through);
  if (contractThrough && /traded|trade/i.test(contractThrough)) {
    contract.contract_through = 'uncertain';
    root.changes.push('normalized traded contract-through annotation to uncertain');
  }
}

function repairMovement(player: Record<string, unknown>, root: TeamRoot): void {
  const movement = asRecord(player.movement_constraints);
  if (!movement) return;
  if (movement.signal_strength === null) {
    movement.signal_strength = 'unknown';
    root.changes.push('filled unknown movement signal strength');
  }
  const status = stringValue(movement.status);
  if (status === 'available' || status === 'shopped' || status === 'actively_traded') {
    if (movement.signal_strength === undefined || movement.signal_strength === null) {
      movement.signal_strength = 'unknown';
      root.changes.push('filled unknown movement signal strength');
    }
    const falsification = Array.isArray(movement.falsification_conditions)
      ? movement.falsification_conditions
      : [];
    if (falsification.length === 0) {
      movement.falsification_conditions = ['Reviewed source evidence changes the current movement posture.'];
      root.changes.push('filled movement falsification condition');
    }
  }

  for (const reason of arrayOfRecords(movement.reasons)) {
    if (reason.weight === undefined) {
      reason.weight = 'low';
      root.changes.push('filled missing movement reason weight');
    }
  }
}

function inferPriorityType(priority: Record<string, unknown>): string {
  const text = `${stringValue(priority.priority) ?? ''} ${stringValue(priority.detail) ?? ''}`.toLowerCase();
  if (/coach|coaching/.test(text)) return 'coaching_decision';
  if (/draft|pick/.test(text)) return 'draft';
  if (/free agency|free-agent|ufa|rfa/.test(text)) return 'free_agency';
  if (/extend|extension|contract/.test(text)) return 'extension';
  if (/trade|call|market|shop/.test(text)) return 'trade';
  if (/roster|depth|rotation|player/.test(text)) return 'roster';
  return 'structural';
}

function structureConditionalPick(pick: Record<string, unknown>, root: TeamRoot): void {
  const rawToTeam = stringValue(pick.to_team);
  if (!rawToTeam || TEAM_ID_SET.has(rawToTeam)) return;
  const normalized = normalizeTeamAlias(rawToTeam);
  if (normalized) {
    pick.to_team = normalized;
    root.changes.push('normalized owed-pick team id from source text');
    return;
  }

  const options = rawToTeam.toLowerCase() === 'unknown'
    ? ['unknown']
    : mentionedTeams(rawToTeam);
  if (options.length === 0) return;
  delete pick.to_team;
  pick.to_team_options = options;
  if (typeof pick.condition !== 'string' || pick.condition.trim() === '') {
    pick.condition = rawToTeam.toLowerCase() === 'unknown'
      ? 'Unknown destination in reviewed source snapshot.'
      : rawToTeam;
  }
  root.changes.push('structured conditional or unknown owed-pick destination');
}

function repairDuplicateRosterPlayers(roots: TeamRoot[], sources: ReviewedSources): void {
  const rosterEntries = roots.flatMap((root) => recordsAt(root.data, 'roster').map((player, index) => ({
    root,
    player,
    index,
    playerId: stringValue(player.player_id) ?? playerIdForName(stringValue(player.name) ?? ''),
    officialTeam: sources.officialTeamByPlayerId.get(playerIdForName(stringValue(player.name) ?? '')),
  })));
  const byPlayer = new Map<string, typeof rosterEntries>();
  for (const entry of rosterEntries) {
    if (!entry.playerId) continue;
    const list = byPlayer.get(entry.playerId) ?? [];
    list.push(entry);
    byPlayer.set(entry.playerId, list);
  }

  for (const entries of byPlayer.values()) {
    const teams = [...new Set(entries.map((entry) => entry.root.teamId))];
    if (teams.length <= 1) continue;
    const official = entries.find((entry) => entry.officialTeam && entry.officialTeam === entry.root.teamId);
    const keeper = official ?? entries[0];
    for (const entry of entries) {
      if (entry === keeper) continue;
      const roster = arrayAt(entry.root.data, 'roster');
      const currentIndex = roster.indexOf(entry.player);
      if (currentIndex >= 0) {
        roster.splice(currentIndex, 1);
        entry.root.changes.push(`removed duplicate roster row for ${entry.playerId} using reviewed roster snapshot`);
      }
    }
  }
}

function repairPendingFreeAgents(roots: TeamRoot[]): void {
  for (const root of roots) {
    const rosterIds = new Set(recordsAt(root.data, 'roster').map((player) => stringValue(player.player_id)).filter(Boolean));
    const pending = arrayAt(root.data, 'pending_free_agents');
    const next = pending.filter((item) => {
      const player = asRecord(item);
      const playerId = stringValue(player?.player_id);
      return playerId !== undefined && playerId !== 'unknown' && rosterIds.has(playerId);
    });
    if (next.length !== pending.length) {
      root.data.pending_free_agents = next;
      root.changes.push('removed pending free agents absent from current roster snapshot');
    }
  }
}

function repairPickReciprocity(roots: TeamRoot[]): void {
  const byTeam = new Map(roots.map((root) => [root.teamId, root]));
  for (const root of roots) {
    for (const owed of recordsAt(root.data, 'key_assets.draft_picks_owed')) {
      const toTeam = stringValue(owed.to_team);
      if (!toTeam || !TEAM_ID_SET.has(toTeam)) continue;
      if (owed.condition !== undefined || Array.isArray(owed.to_team_options)) continue;
      const owner = byTeam.get(toTeam);
      if (!owner) continue;
      const owned = arrayAt(recordAt(owner.data, 'key_assets'), 'draft_picks_owned');
      const year = owed.year;
      const round = owed.round;
      const protections = stringValue(owed.protections) ?? 'unknown';
      const exists = owned.some((candidate) => {
        const pick = asRecord(candidate);
        if (!pick) return false;
        return pick.year === year
          && pick?.round === round
          && teamFromOwnedPick(pick) === root.teamId
          && (stringValue(pick.protections) ?? 'unknown') === protections;
      });
      if (exists) continue;
      owned.push({
        year,
        round,
        from_team: root.teamId,
        protections,
        source: stringValue(owed.source) ?? 'unknown',
      });
      owner.changes.push(`added reciprocal owned pick for ${root.teamId} ${String(year)} round ${String(round)}`);
    }
  }
}

function teamFromOwnedPick(pick: Record<string, unknown>): string | undefined {
  return stringValue(pick.from_team) ?? stringValue(pick.original_team) ?? stringValue(pick.team_id);
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

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function playerIdForName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function parseArgs(args: string[]): RepairOptions {
  let teamsDir = path.join(DEFAULT_CONTEXT_GRAPH_DIR, 'teams');
  let dryRun = false;
  let rosterPath = path.join(REPO_ROOT, 'data', 'nba-rosters', '2026-06-12.nba-official.json');
  let capSheetPath = path.join(REPO_ROOT, 'data', 'nba-cap-sheets', '2026-05-03.public-sources.json');
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--teams-dir' && next) {
      teamsDir = path.resolve(next);
      i += 1;
    } else if (arg === '--roster-path' && next) {
      rosterPath = path.resolve(next);
      i += 1;
    } else if (arg === '--cap-sheet-path' && next) {
      capSheetPath = path.resolve(next);
      i += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }
  return { teamsDir, dryRun, rosterPath, capSheetPath };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
