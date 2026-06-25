import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EdgeGraph, TeamDocument } from './schema.js';

export interface DerivedArtifacts {
  teams: Record<string, unknown>[];
  edges: EdgeGraph;
}

export interface WriteDerivedOptions {
  outputDir: string;
  teams: TeamDocument[];
  edges: EdgeGraph;
  validationReportMarkdown: string;
}

export async function writeDerivedArtifacts(options: WriteDerivedOptions): Promise<void> {
  await mkdir(options.outputDir, { recursive: true });
  const teams = options.teams.map((team) => team.data).sort((a, b) => String(a.team_id).localeCompare(String(b.team_id)));
  await Promise.all([
    writeJson(path.join(options.outputDir, 'teams.json'), teams),
    writeJson(path.join(options.outputDir, 'edges.json'), options.edges),
    writeFile(path.join(options.outputDir, 'validation_report.md'), options.validationReportMarkdown, 'utf8'),
  ]);
}

export async function loadDerivedArtifacts(inputDir: string): Promise<DerivedArtifacts> {
  const [teams, edges] = await Promise.all([
    readJson<Record<string, unknown>[]>(path.join(inputDir, 'teams.json')),
    readJson<EdgeGraph>(path.join(inputDir, 'edges.json')),
  ]);
  return { teams, edges };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text) as T;
}

