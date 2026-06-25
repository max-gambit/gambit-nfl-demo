// Finding types + markdown serializer.
//
// The persona instructs Claude to emit a fenced JSON block at the end of the
// run with one entry per finding. We parse that into Finding[] and render it
// to a human-readable report.

import { promises as fs } from 'node:fs';
import path from 'node:path';

export type Category = 'BUG' | 'UX' | 'PRODUCT';
export type Severity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Finding {
  id: number;
  category: Category;
  severity: Severity;
  flow: string;
  title: string;
  observed: string;
  expected: string;
  /** Path relative to the run directory, e.g. "screenshots/03.png". */
  screenshot?: string;
}

export interface FlowOutcome {
  name: string;
  status: 'completed' | 'partial' | 'blocked' | 'skipped';
  findings: number;
}

export interface RunMetrics {
  startedAt: string;
  finishedAt: string;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  model: string;
  /** USD estimate based on Opus 4.7 pricing — illustrative, not authoritative. */
  estimatedCostUsd: number;
}

const SEVERITY_ORDER: Severity[] = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'];
const CATEGORIES: Category[] = ['BUG', 'UX', 'PRODUCT'];

/**
 * Extracts the ```findings ... ``` JSON block from Claude's final assistant
 * content. Returns an empty array (and logs a warning) if no block is found
 * or it doesn't parse — we never want a malformed payload to nuke the run.
 */
export function parseFindingsBlock(text: string): Finding[] {
  const fenceRegex = /```findings\s*\n([\s\S]*?)\n```/;
  const match = text.match(fenceRegex);
  if (!match) {
    console.warn('[report] no ```findings``` block found in final assistant content');
    return [];
  }
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) {
      console.warn('[report] findings block is not an array');
      return [];
    }
    // Trust the model on shape but coerce id to number defensively.
    return parsed.map((f, i) => ({ ...f, id: typeof f.id === 'number' ? f.id : i + 1 })) as Finding[];
  } catch (err) {
    console.warn('[report] findings block did not parse as JSON:', err);
    return [];
  }
}

export function parseFlowOutcomes(text: string): FlowOutcome[] {
  const fenceRegex = /```flows\s*\n([\s\S]*?)\n```/;
  const match = text.match(fenceRegex);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return [];
    return parsed as FlowOutcome[];
  } catch {
    return [];
  }
}

interface RenderOptions {
  findings: Finding[];
  flowOutcomes: FlowOutcome[];
  metrics: RunMetrics;
  runDir: string;
}

export async function writeReport(opts: RenderOptions): Promise<string> {
  const { findings, flowOutcomes, metrics, runDir } = opts;
  const md = renderMarkdown(findings, flowOutcomes, metrics);
  const reportPath = path.join(runDir, 'report.md');
  await fs.writeFile(reportPath, md, 'utf-8');
  return reportPath;
}

function renderMarkdown(findings: Finding[], flowOutcomes: FlowOutcome[], metrics: RunMetrics): string {
  const lines: string[] = [];

  lines.push('# Gambit QA run');
  lines.push('');
  lines.push(`- **Started**: ${metrics.startedAt}`);
  lines.push(`- **Finished**: ${metrics.finishedAt}`);
  lines.push(`- **Model**: \`${metrics.model}\``);
  lines.push(`- **Iterations**: ${metrics.iterations}`);
  lines.push(`- **Tokens**: ${metrics.inputTokens.toLocaleString()} in (${metrics.cacheReadTokens.toLocaleString()} cached) / ${metrics.outputTokens.toLocaleString()} out`);
  lines.push(`- **Estimated cost**: $${metrics.estimatedCostUsd.toFixed(2)}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(renderSummaryTable(findings));
  lines.push('');

  if (flowOutcomes.length > 0) {
    lines.push('## Flow coverage');
    lines.push('');
    lines.push('| Flow | Status | Findings |');
    lines.push('|---|---|---:|');
    for (const f of flowOutcomes) {
      lines.push(`| ${f.name} | ${f.status} | ${f.findings} |`);
    }
    lines.push('');
  }

  lines.push('## Findings');
  lines.push('');
  if (findings.length === 0) {
    lines.push('_No findings reported._');
  } else {
    const sorted = [...findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    for (const f of sorted) {
      lines.push(renderFinding(f));
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderSummaryTable(findings: Finding[]): string {
  const counts: Record<Category, Record<Severity, number>> = {
    BUG: { BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    UX: { BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    PRODUCT: { BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  };
  for (const f of findings) counts[f.category][f.severity] += 1;
  const lines: string[] = [];
  lines.push(`| Category | ${SEVERITY_ORDER.join(' | ')} | **Total** |`);
  lines.push(`|---|${SEVERITY_ORDER.map(() => '---:').join('|')}|---:|`);
  for (const cat of CATEGORIES) {
    const row = SEVERITY_ORDER.map((s) => String(counts[cat][s]));
    const total = SEVERITY_ORDER.reduce((acc, s) => acc + counts[cat][s], 0);
    lines.push(`| ${cat} | ${row.join(' | ')} | **${total}** |`);
  }
  return lines.join('\n');
}

function renderFinding(f: Finding): string {
  const lines: string[] = [];
  lines.push(`### #${f.id} · [${f.severity}] [${f.category}] ${f.title}`);
  lines.push('');
  lines.push(`- **Flow**: ${f.flow}`);
  lines.push(`- **Observed**: ${f.observed}`);
  lines.push(`- **Expected**: ${f.expected}`);
  if (f.screenshot) {
    lines.push(`- **Screenshot**: \`${f.screenshot}\``);
    lines.push('');
    lines.push(`![${f.title}](${f.screenshot})`);
  }
  return lines.join('\n');
}

/**
 * Opus 4.7 pricing: $5/MTok input, $25/MTok output, $0.50/MTok cached read
 * (90% off list). Hard-coded — adjust if pricing shifts or the harness
 * model changes.
 */
export function estimateCost(input: number, output: number, cacheRead: number): number {
  const PER_MTOK_INPUT = 5;
  const PER_MTOK_OUTPUT = 25;
  const PER_MTOK_CACHE_READ = 0.5;
  return (
    (input - cacheRead) / 1_000_000 * PER_MTOK_INPUT
    + cacheRead / 1_000_000 * PER_MTOK_CACHE_READ
    + output / 1_000_000 * PER_MTOK_OUTPUT
  );
}
