import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import { NBA_TEAM_IDS, type TeamDocument, type ValidationMessage } from './schema.js';

type PathLineMap = Map<string, number>;

const TEAM_FILE_STEMS = new Set(NBA_TEAM_IDS.map((id) => id.toLowerCase()));

export interface LoadTeamsOptions {
  teamsDir: string;
}

export async function discoverTeamFiles(teamsDir: string): Promise<string[]> {
  const entries = await readdir(teamsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .filter((name) => !name.startsWith('_'))
    .filter((name) => TEAM_FILE_STEMS.has(path.basename(name, path.extname(name)).toLowerCase()))
    .sort()
    .map((name) => path.join(teamsDir, name));
}

export async function loadTeamFiles(options: LoadTeamsOptions): Promise<TeamDocument[]> {
  const files = await discoverTeamFiles(options.teamsDir);
  return Promise.all(files.map(loadTeamFile));
}

export async function loadTeamFile(filePath: string): Promise<TeamDocument> {
  const text = await readFile(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const parseErrors: ValidationMessage[] = [];
  const doc = parseDocument(text, { prettyErrors: false });
  const lineStarts = buildLineStarts(text);
  const lineMap: PathLineMap = new Map();

  for (const error of doc.errors) {
    parseErrors.push({
      severity: 'error',
      file: filePath,
      path: '<yaml>',
      message: error.message,
      line: offsetToLine(lineStarts, error.pos?.[0] ?? 0),
    });
  }

  if (doc.contents) {
    mapYamlLines(doc.contents, '', lineMap, lineStarts);
  }

  let data: Record<string, unknown> = {};
  if (doc.errors.length === 0) {
    const parsed = doc.toJSON();
    if (isRecord(parsed)) {
      data = parsed;
    } else {
      parseErrors.push({
        severity: 'error',
        file: filePath,
        path: '<root>',
        message: 'YAML root must be a mapping/object.',
        line: 1,
      });
    }
  }

  const teamId = typeof data.team_id === 'string'
    ? data.team_id
    : path.basename(fileName, path.extname(fileName)).toUpperCase();

  return {
    filePath,
    fileName,
    teamId,
    data,
    parseErrors,
    lineForPath: (pathName: string) => lineMap.get(pathName) ?? nearestParentLine(pathName, lineMap),
  };
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Math.max(1, high + 1);
}

function nodeLine(node: unknown, lineStarts: number[]): number | undefined {
  const range = getRange(node);
  return range ? offsetToLine(lineStarts, range[0]) : undefined;
}

function getRange(node: unknown): [number, number, number] | undefined {
  if (typeof node !== 'object' || node === null || !('range' in node)) return undefined;
  const range = (node as { range?: unknown }).range;
  if (!Array.isArray(range) || typeof range[0] !== 'number') return undefined;
  return range as [number, number, number];
}

function mapYamlLines(node: unknown, currentPath: string, lineMap: PathLineMap, lineStarts: number[]): void {
  const line = nodeLine(node, lineStarts);
  if (currentPath && line !== undefined && !lineMap.has(currentPath)) {
    lineMap.set(currentPath, line);
  }

  if (isMap(node)) {
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key ?? '');
      if (!key) continue;
      const childPath = currentPath ? `${currentPath}.${key}` : key;
      const keyLine = nodeLine(pair.key, lineStarts);
      if (keyLine !== undefined) lineMap.set(childPath, keyLine);
      if (pair.value) mapYamlLines(pair.value, childPath, lineMap, lineStarts);
    }
    return;
  }

  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      mapYamlLines(item, `${currentPath}[${index}]`, lineMap, lineStarts);
    });
  }
}

function nearestParentLine(pathName: string, lineMap: PathLineMap): number | undefined {
  let cursor = pathName;
  while (cursor.includes('.') || cursor.includes('[')) {
    cursor = cursor.replace(/(?:\.[^.[]+|\[\d+\])$/, '');
    const line = lineMap.get(cursor);
    if (line !== undefined) return line;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

