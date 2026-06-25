import { extractEdgeGraph } from './edges.js';
import { loadTeamFiles } from './parser.js';
import { DEFAULT_DERIVED_DIR, DEFAULT_TEAMS_DIR } from './paths.js';
import type { EdgeGraph, TeamDocument, ValidationReport } from './schema.js';
import { writeDerivedArtifacts } from './storage.js';
import {
  createValidationReport,
  renderValidationReport,
  validateCrossTeamConsistency,
  validateTeamDocuments,
} from './validator.js';

export interface BuildContextGraphOptions {
  teamsDir?: string;
  outputDir?: string;
  writeArtifacts?: boolean;
}

export interface BuildContextGraphResult {
  teams: TeamDocument[];
  edges: EdgeGraph;
  report: ValidationReport;
  reportMarkdown: string;
}

export async function buildContextGraph(options: BuildContextGraphOptions = {}): Promise<BuildContextGraphResult> {
  const teamsDir = options.teamsDir ?? DEFAULT_TEAMS_DIR;
  const outputDir = options.outputDir ?? DEFAULT_DERIVED_DIR;
  const teams = await loadTeamFiles({ teamsDir });
  const schemaErrors = validateTeamDocuments(teams);
  const edges = extractEdgeGraph(teams);
  const crossTeam = validateCrossTeamConsistency(teams, edges);
  const report = createValidationReport(schemaErrors, crossTeam.errors, crossTeam.warnings);
  const reportMarkdown = renderValidationReport(report);

  if (options.writeArtifacts ?? true) {
    await writeDerivedArtifacts({
      outputDir,
      teams,
      edges,
      validationReportMarkdown: reportMarkdown,
    });
  }

  return { teams, edges, report, reportMarkdown };
}

export async function validateContextGraph(options: BuildContextGraphOptions = {}): Promise<BuildContextGraphResult> {
  return buildContextGraph({ ...options, writeArtifacts: false });
}

