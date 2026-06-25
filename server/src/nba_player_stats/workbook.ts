import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

export type WorkbookCellValue = string | number | boolean | null;

export interface AdvancedStatsWorkbookRow {
  player_name: string;
  team_id: string;
  position: string | null;
  age: number;
  games_played: number;
  minutes: number;
  points_per_game: number;
  rebounds_per_game: number;
  assists_per_game: number;
  true_shooting_pct: number;
  effective_fg_pct: number;
  usage_pct: number;
  three_point_attempt_rate: number;
  free_throw_rate: number;
  offensive_rebound_pct: number;
  defensive_rebound_pct: number;
  rebound_pct: number;
  assist_pct: number;
  turnover_pct: number;
  offensive_rating: number;
  defensive_rating: number;
  net_rating: number;
  player_impact_estimate: number;
  defensive_win_shares: number;
  source_row: Record<string, WorkbookCellValue>;
}

export interface ParsedAdvancedStatsWorkbook {
  headers: string[];
  rows: AdvancedStatsWorkbookRow[];
  notes_rows: { label: string; value: string | null }[];
  glossary: Record<string, string>;
  metadata: {
    title: string;
    players_included: string;
    season_label: string;
    season: string;
    season_type: string;
    pulled: string;
    source: string;
  };
}

const EXPECTED_HEADERS = [
  'Player',
  'Team',
  'Pos',
  'Age',
  'GP',
  'MP',
  'PTS/G',
  'REB/G',
  'AST/G',
  'TS%',
  'eFG%',
  'USG%',
  '3PAr',
  'FTr',
  'ORB%',
  'DRB%',
  'REB%',
  'AST%',
  'TOV%',
  'ORtg',
  'DRtg',
  'NetRtg',
  'PIE',
  'DWS',
];

export async function parseAdvancedStatsWorkbook(path: string): Promise<ParsedAdvancedStatsWorkbook> {
  const sheets = await readXlsxSheets(path);
  const statsRows = sheets['Advanced Stats'];
  const notesRows = sheets.Notes;
  if (!statsRows) throw new Error('NBA advanced stats workbook is missing "Advanced Stats" sheet');
  if (!notesRows) throw new Error('NBA advanced stats workbook is missing "Notes" sheet');

  const headers = statsRows[0]?.map((value) => stringValue(value)) ?? [];
  if (headers.join('|') !== EXPECTED_HEADERS.join('|')) {
    throw new Error(`Unexpected NBA advanced stats headers: ${headers.join(', ')}`);
  }

  const rows = statsRows.slice(1)
    .filter((row) => row.some((value) => value !== null && value !== ''))
    .map((row) => parseStatsRow(headers, row));

  const parsedNotes = notesRows
    .filter((row) => row.some((value) => value !== null && value !== ''))
    .map((row) => ({
      label: stringValue(row[0]).trim(),
      value: row[1] === null || row[1] === undefined ? null : stringValue(row[1]).trim(),
    }));

  return {
    headers,
    rows,
    notes_rows: parsedNotes,
    glossary: extractGlossary(parsedNotes),
    metadata: extractMetadata(parsedNotes),
  };
}

function parseStatsRow(headers: string[], row: WorkbookCellValue[]): AdvancedStatsWorkbookRow {
  const raw = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])) as Record<string, WorkbookCellValue>;
  return {
    player_name: requiredString(raw.Player, 'Player'),
    team_id: requiredString(raw.Team, 'Team'),
    position: optionalPosition(raw.Pos),
    age: requiredNumber(raw.Age, 'Age'),
    games_played: requiredNumber(raw.GP, 'GP'),
    minutes: requiredNumber(raw.MP, 'MP'),
    points_per_game: requiredNumber(raw['PTS/G'], 'PTS/G'),
    rebounds_per_game: requiredNumber(raw['REB/G'], 'REB/G'),
    assists_per_game: requiredNumber(raw['AST/G'], 'AST/G'),
    true_shooting_pct: requiredNumber(raw['TS%'], 'TS%'),
    effective_fg_pct: requiredNumber(raw['eFG%'], 'eFG%'),
    usage_pct: requiredNumber(raw['USG%'], 'USG%'),
    three_point_attempt_rate: requiredNumber(raw['3PAr'], '3PAr'),
    free_throw_rate: requiredNumber(raw.FTr, 'FTr'),
    offensive_rebound_pct: requiredNumber(raw['ORB%'], 'ORB%'),
    defensive_rebound_pct: requiredNumber(raw['DRB%'], 'DRB%'),
    rebound_pct: requiredNumber(raw['REB%'], 'REB%'),
    assist_pct: requiredNumber(raw['AST%'], 'AST%'),
    turnover_pct: requiredNumber(raw['TOV%'], 'TOV%'),
    offensive_rating: requiredNumber(raw.ORtg, 'ORtg'),
    defensive_rating: requiredNumber(raw.DRtg, 'DRtg'),
    net_rating: requiredNumber(raw.NetRtg, 'NetRtg'),
    player_impact_estimate: requiredNumber(raw.PIE, 'PIE'),
    defensive_win_shares: requiredNumber(raw.DWS, 'DWS'),
    source_row: raw,
  };
}

function extractMetadata(notesRows: { label: string; value: string | null }[]) {
  const notes = new Map(notesRows.map((row) => [row.label, row.value]));
  const seasonLabel = notes.get('Season') ?? '';
  return {
    title: notesRows[0]?.label ?? 'NBA 2025-26 Advanced Stats',
    players_included: notes.get('Players included') ?? '',
    season_label: seasonLabel,
    season: seasonLabel.match(/\b\d{4}-\d{2}\b/)?.[0] ?? '2025-26',
    season_type: /regular season/i.test(seasonLabel) ? 'Regular Season' : seasonLabel || 'Regular Season',
    pulled: notes.get('Pulled') ?? '',
    source: notes.get('Source') ?? 'Attached workbook',
  };
}

function extractGlossary(notesRows: { label: string; value: string | null }[]): Record<string, string> {
  const glossary: Record<string, string> = {};
  let inGlossary = false;
  for (const row of notesRows) {
    if (row.label === 'Column glossary') {
      inGlossary = true;
      continue;
    }
    if (row.label === 'Note on missing metrics') break;
    if (!inGlossary || !row.value) continue;
    glossary[row.label.trim()] = row.value;
  }
  return glossary;
}

async function readXlsxSheets(path: string): Promise<Record<string, WorkbookCellValue[][]>> {
  const entries = readZipEntries(await readFile(path));
  const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8');
  const relsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
  if (!workbookXml || !relsXml) throw new Error('Invalid XLSX workbook structure');

  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '');
  const rels = parseRelationships(relsXml);
  const sheets: Record<string, WorkbookCellValue[][]> = {};
  for (const sheet of parseWorkbookSheets(workbookXml)) {
    const target = rels.get(sheet.relId);
    if (!target) continue;
    const normalized = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^xl\//, '')}`;
    const xml = entries.get(normalized)?.toString('utf8');
    if (!xml) continue;
    sheets[sheet.name] = parseSheetXml(xml, sharedStrings);
  }
  return sheets;
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Invalid XLSX central directory');
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid XLSX local header for ${name}`);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!data) throw new Error(`Unsupported XLSX compression method ${method} for ${name}`);
    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Invalid XLSX file: end of central directory not found');
}

function parseWorkbookSheets(xml: string): { name: string; relId: string }[] {
  const out: { name: string; relId: string }[] = [];
  for (const match of xml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0];
    const name = attr(tag, 'name');
    const relId = attr(tag, 'r:id');
    if (name && relId) out.push({ name: decodeXml(name), relId });
  }
  return out;
}

function parseRelationships(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = attr(tag, 'Id');
    const target = attr(tag, 'Target');
    if (id && target) out.set(id, target);
  }
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (part) => decodeXml(part[1]));
    strings.push(parts.join(''));
  }
  return strings;
}

function parseSheetXml(xml: string, sharedStrings: string[]): WorkbookCellValue[][] {
  const rows: WorkbookCellValue[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowTag = rowMatch[0].slice(0, rowMatch[0].indexOf('>') + 1);
    const rowIndex = Number(attr(rowTag, 'r') ?? rows.length + 1) - 1;
    const row: WorkbookCellValue[] = rows[rowIndex] ?? [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellTag = `<c${cellMatch[1]}>`;
      const ref = attr(cellTag, 'r');
      if (!ref) continue;
      row[columnIndex(ref)] = parseCellValue(cellTag, cellMatch[2] ?? '', sharedStrings);
    }
    rows[rowIndex] = row;
  }
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? null));
}

function parseCellValue(tag: string, body: string, sharedStrings: string[]): WorkbookCellValue {
  const type = attr(tag, 't');
  if (type === 'inlineStr') {
    return decodeXml(Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g), (match) => match[1]).join(''));
  }
  const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return null;
  if (type === 's') return sharedStrings[Number(raw)] ?? '';
  if (type === 'b') return raw === '1';
  if (type === 'str') return decodeXml(raw);
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : decodeXml(raw);
}

function attr(tag: string, name: string): string | null {
  const escaped = name.replace(':', '\\:');
  return tag.match(new RegExp(`\\b${escaped}="([^"]*)"`))?.[1] ?? null;
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  return letters.split('').reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stringValue(value: WorkbookCellValue | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function requiredString(value: WorkbookCellValue, label: string): string {
  const string = stringValue(value).trim();
  if (!string) throw new Error(`NBA advanced stats row is missing ${label}`);
  return string;
}

function optionalPosition(value: WorkbookCellValue): string | null {
  const string = stringValue(value).trim();
  if (!string) return null;
  if (!['G', 'F', 'C'].includes(string)) {
    throw new Error(`NBA advanced stats row has invalid Pos ${string}`);
  }
  return string;
}

function requiredNumber(value: WorkbookCellValue, label: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`NBA advanced stats row has invalid ${label}`);
  return number;
}

export const workbookParserTestInternals = {
  parseSheetXml,
};
