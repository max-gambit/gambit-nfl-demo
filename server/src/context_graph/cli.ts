import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContextGraph, validateContextGraph } from './build.js';
import { DEFAULT_DERIVED_DIR, DEFAULT_TEAMS_DIR } from './paths.js';

interface CliOptions {
  command: string;
  teamsDir: string;
  outputDir: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.command === 'validate') {
    const result = await validateContextGraph({ teamsDir: options.teamsDir, outputDir: options.outputDir });
    process.stdout.write(result.reportMarkdown);
    if (!result.report.passed) process.exitCode = 1;
    return;
  }

  if (options.command === 'build') {
    const result = await buildContextGraph({ teamsDir: options.teamsDir, outputDir: options.outputDir });
    process.stdout.write(`Built Intel from ${result.teams.length} teams.\n`);
    process.stdout.write(`Wrote teams.json, edges.json, and validation_report.md to ${options.outputDir}.\n`);
    process.stdout.write(`Validation status: ${result.report.passed ? 'PASS' : 'FAIL'} (${result.report.totalErrors} errors, ${result.report.totalWarnings} warnings).\n`);
    if (!result.report.passed) process.exitCode = 1;
    return;
  }

  if (options.command === 'report') {
    process.stdout.write(await readFile(path.join(options.outputDir, 'validation_report.md'), 'utf8'));
    return;
  }

  usage();
  process.exitCode = 1;
}

function parseArgs(args: string[]): CliOptions {
  const command = args[0] ?? 'validate';
  let teamsDir = DEFAULT_TEAMS_DIR;
  let outputDir = DEFAULT_DERIVED_DIR;

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--teams-dir' && next) {
      teamsDir = path.resolve(next);
      i += 1;
    } else if ((arg === '--output-dir' || arg === '--derived-dir') && next) {
      outputDir = path.resolve(next);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
  }

  return { command, teamsDir, outputDir };
}

function usage(): void {
  process.stdout.write(`Gambit NFL Intel CLI\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  tsx src/context_graph/cli.ts validate [--teams-dir <dir>]\n`);
  process.stdout.write(`  tsx src/context_graph/cli.ts build [--teams-dir <dir>] [--output-dir <dir>]\n`);
  process.stdout.write(`  tsx src/context_graph/cli.ts report [--output-dir <dir>]\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
