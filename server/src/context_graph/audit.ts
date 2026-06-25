import path from 'node:path';
import { validateContextGraph } from './build.js';
import { SCHEMA_DRIFT_CANDIDATES } from './cleanup_policy.js';
import { DEFAULT_DERIVED_DIR, DEFAULT_TEAMS_DIR } from './paths.js';
import type { EdgeGraph, TeamDocument, ValidationMessage } from './schema.js';

interface AuditOptions {
  teamsDir: string;
  outputDir: string;
}

interface AuditMessage {
  section: 'schema_error' | 'cross_team_error' | 'cross_team_warning' | 'audit_info';
  team_id: string;
  path: string;
  class: string;
  value: string | null;
  message: ValidationMessage;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await validateContextGraph({
    teamsDir: options.teamsDir,
    outputDir: options.outputDir,
  });
  const messages = [
    ...result.report.schemaErrors.map((message) => auditMessage('schema_error', message)),
    ...result.report.crossTeamErrors.map((message) => auditMessage('cross_team_error', message)),
    ...result.report.crossTeamWarnings.map((message) => auditMessage('cross_team_warning', message)),
    ...auditOnlyRelationshipMessages(result.teams, result.edges),
  ];
  process.stdout.write(renderAudit(messages, result.report.passed));
}

function auditMessage(section: AuditMessage['section'], message: ValidationMessage): AuditMessage {
  return {
    section,
    team_id: teamIdForFile(message.file),
    path: compactPath(message.path),
    class: classify(message),
    value: invalidValue(message.message),
    message,
  };
}

function renderAudit(messages: AuditMessage[], passed: boolean): string {
  const lines: string[] = [
    '# Gambit NBA Intel Validation Audit',
    '',
    `- Status: ${passed ? 'PASS' : 'FAIL'}`,
    `- Total findings: ${messages.length}`,
    `- Schema errors: ${messages.filter((message) => message.section === 'schema_error').length}`,
    `- Cross-team errors: ${messages.filter((message) => message.section === 'cross_team_error').length}`,
    `- Cross-team warnings: ${messages.filter((message) => message.section === 'cross_team_warning').length}`,
    `- Audit-only infos: ${messages.filter((message) => message.section === 'audit_info').length}`,
    '',
    '## Finding Classes',
    '',
    ...renderCountTable(countBy(messages, (message) => message.class), ['Class', 'Count']),
    '',
    '## Teams With Most Findings',
    '',
    ...renderCountTable(countBy(messages.filter((message) => message.team_id !== 'UNKNOWN'), (message) => message.team_id), ['Team', 'Count'], 15),
    '',
    '## Top Invalid Vocabulary Values',
    '',
    ...renderCountTable(countBy(
      messages.filter((message) => message.class === 'invalid_vocab' && message.value),
      (message) => `${message.path} = ${message.value}`,
    ), ['Field / value', 'Count'], 25),
    '',
    '## Schema v2.2.2 Resolution Log',
    '',
    ...SCHEMA_DRIFT_CANDIDATES.map((candidate) => (
      `- \`${candidate.path}\` value \`${candidate.value}\` — ${candidate.recommendation}; ${candidate.note}`
    )),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

function auditOnlyRelationshipMessages(teams: TeamDocument[], graph: EdgeGraph): AuditMessage[] {
  const messages: AuditMessage[] = [];
  const teamById = new Map(teams.map((team) => [String(team.data.team_id ?? team.teamId), team]));

  for (const rivalry of graph.rivalries) {
    if (rivalry.requires_reciprocal) continue;
    const reciprocal = graph.rivalries.some((candidate) => (
      candidate.team_a === rivalry.team_b && candidate.team_b === rivalry.team_a
    ));
    if (!reciprocal) {
      const team = teamById.get(rivalry.team_a);
      messages.push(infoMessage(
        team,
        rivalry.source_path.replace(`${rivalry.team_a}.`, ''),
        'rivalry_reciprocity_audit',
        `Audit-only: ${rivalry.team_a} lists ${rivalry.team_b} as a rivalry, but ${rivalry.team_b} does not list ${rivalry.team_a}.`,
      ));
    }
  }

  for (const team of teams) {
    const teamId = String(team.data.team_id ?? team.teamId);
    for (const [index, trade] of recordsAt(team.data, 'trade_dna.recent_significant_trades').entries()) {
      const date = stringValue(trade.date);
      for (const otherTeam of valuesAt(trade, 'counterparties').filter(isTeamIdLike)) {
        const otherDoc = teamById.get(otherTeam);
        if (!otherDoc) continue;
        const reciprocal = recordsAt(otherDoc.data, 'trade_dna.recent_significant_trades').some((otherTrade) => (
          stringValue(otherTrade.date) === date
          && valuesAt(otherTrade, 'counterparties').includes(teamId)
        ));
        if (!reciprocal) {
          messages.push(infoMessage(
            team,
            `trade_dna.recent_significant_trades[${index}]`,
            'trade_reciprocity_audit',
            `Audit-only: ${teamId} trade on ${date || 'unknown date'} lists ${otherTeam}; no matching reciprocal structured trade entry was found.`,
          ));
        }
      }
    }
  }

  for (const connection of graph.personnelConnections) {
    const reciprocal = graph.personnelConnections.some((candidate) => (
      candidate.team_with_entry === connection.connected_team
      && candidate.connected_team === connection.team_with_entry
      && candidate.person_name === connection.person_name
    ));
    if (!reciprocal) {
      const team = teamById.get(connection.team_with_entry);
      messages.push(infoMessage(
        team,
        connection.source_path.replace(`${connection.team_with_entry}.`, ''),
        'personnel_reverse_link_audit',
        `Audit-only: Personnel connection for ${connection.person_name} points to ${connection.connected_team}; no corresponding reverse entry found.`,
      ));
    }
  }

  return messages;
}

function infoMessage(team: TeamDocument | undefined, pathName: string, className: string, messageText: string): AuditMessage {
  const message: ValidationMessage = {
    severity: 'warning',
    file: team?.filePath ?? '<audit>',
    path: pathName,
    message: messageText,
    line: team?.lineForPath(pathName),
  };
  return {
    section: 'audit_info',
    team_id: teamIdForFile(message.file),
    path: compactPath(message.path),
    class: className,
    value: null,
    message,
  };
}

function classify(message: ValidationMessage): string {
  const text = message.message;
  if (message.path === '<yaml>') return 'yaml_parse';
  if (text.includes('Invalid vocabulary value')) return 'invalid_vocab';
  if (text.includes('Missing required controlled-vocabulary field')) return 'missing_required_vocab';
  if (text.includes('Expected URL string')) return 'source_url_shape';
  if (text.includes('Expected date')) return 'date_shape';
  if (text.includes('Expected year')) return 'year_shape';
  if (text.includes('Expected number')) return 'number_shape';
  if (text.includes('Expected array')) return 'array_shape';
  if (text.includes('Expected string')) return 'string_shape';
  if (text.includes('Expected object')) return 'object_shape';
  if (text.includes('not a known standard team_id') || text.includes('unknown team_id')) return 'team_id_shape';
  if (text.includes('Missing reciprocal draft_picks')) return 'pick_reciprocity';
  if (text.includes('Missing reciprocal rivalry')) return 'rivalry_reciprocity';
  if (text.includes('does not list a matching reciprocal trade')) return 'trade_reciprocity';
  if (text.includes('Pending free agent')) return 'pending_free_agent_roster_mismatch';
  if (text.includes('Personnel connection')) return 'personnel_reverse_link';
  if (text.includes('appears on multiple rosters')) return 'duplicate_player_roster';
  if (text.includes('falsification condition')) return 'missing_falsification_condition';
  return 'other';
}

function valuesAt(root: Record<string, unknown>, pathName: string): unknown[] {
  const value = getAt(root, pathName);
  return Array.isArray(value) ? value : [];
}

function recordsAt(root: Record<string, unknown>, pathName: string): Record<string, unknown>[] {
  return valuesAt(root, pathName).filter(isRecord);
}

function getAt(root: Record<string, unknown>, pathName: string): unknown {
  let cursor: unknown = root;
  for (const part of pathName.split('.')) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

function isTeamIdLike(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

function invalidValue(message: string): string | null {
  const match = /Invalid vocabulary value (.+?)\. Expected/.exec(message);
  return match?.[1] ?? null;
}

function teamIdForFile(filePath: string): string {
  const stem = path.basename(filePath, path.extname(filePath));
  return /^[a-z]{3}$/i.test(stem) ? stem.toUpperCase() : 'UNKNOWN';
}

function compactPath(pathName: string): string {
  return pathName.replace(/\[\d+\]/g, '[]');
}

function countBy<T>(items: T[], keyFor: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function renderCountTable(counts: Map<string, number>, headers: [string, string], limit = Number.POSITIVE_INFINITY): string[] {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  if (rows.length === 0) return ['- None'];
  return [
    `| ${headers[0]} | ${headers[1]} |`,
    '| --- | ---: |',
    ...rows.map(([key, count]) => `| \`${key}\` | ${count} |`),
  ];
}

function parseArgs(args: string[]): AuditOptions {
  let teamsDir = DEFAULT_TEAMS_DIR;
  let outputDir = DEFAULT_DERIVED_DIR;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--teams-dir' && next) {
      teamsDir = path.resolve(next);
      i += 1;
    } else if ((arg === '--output-dir' || arg === '--derived-dir') && next) {
      outputDir = path.resolve(next);
      i += 1;
    }
  }
  return { teamsDir, outputDir };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
