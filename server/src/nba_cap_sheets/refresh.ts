import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_AUDIT_PATH = fileURLToPath(
  new URL('../../../data/nba-cap-sheets/refresh-audit.latest.json', import.meta.url),
);

interface SourceAdapter {
  name: string;
  base_url: string;
  terms_url: string;
  robots_url: string;
  notes: string[];
}

const SOURCES: SourceAdapter[] = [
  {
    name: 'Spotrac',
    base_url: 'https://www.spotrac.com/nba/',
    terms_url: 'https://www.spotrac.com/terms',
    robots_url: 'https://www.spotrac.com/robots.txt',
    notes: ['Relevant cap, tax, apron, roster, transaction, draft, and free-agent pages may exist by team.'],
  },
  {
    name: 'SalarySwish',
    base_url: 'https://www.salaryswish.com/teams',
    terms_url: 'https://www.salaryswish.com/terms',
    robots_url: 'https://www.salaryswish.com/robots.txt',
    notes: ['Layout is close to the attached cap-sheet example, but automated extraction must remain gated by source review.'],
  },
  {
    name: 'RealGM',
    base_url: 'https://basketball.realgm.com/nba/teams',
    terms_url: 'https://basketball.realgm.com/info/terms',
    robots_url: 'https://basketball.realgm.com/robots.txt',
    notes: ['Useful for transactions, future picks, free agents, and team salary subpages when accessible.'],
  },
];

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const enabled = process.env.NBA_CAP_SHEETS_REFRESH === '1';
  const accepted = process.env.NBA_CAP_SHEETS_ACCEPT_PUBLIC_TERMS === '1';
  const audit = {
    created_at: new Date().toISOString(),
    enabled,
    accepted_public_terms: accepted,
    mode: 'gated_public_refresh',
    status: enabled && accepted ? 'ready_for_adapter_implementation' : 'skipped',
    skip_reason: enabled
      ? accepted ? null : 'NBA_CAP_SHEETS_ACCEPT_PUBLIC_TERMS must be set after source-policy review.'
      : 'NBA_CAP_SHEETS_REFRESH=1 is required before any public-source fetch is attempted.',
    sources: SOURCES.map((source) => ({
      ...source,
      adapter_status: enabled && accepted ? 'not_implemented' : 'not_run',
      terms_status: accepted ? 'accepted_by_operator' : 'review_required',
      robots_status: 'not_checked_without_refresh_gate',
    })),
  };

  if (opts.auditPath) {
    await writeFile(opts.auditPath, `${JSON.stringify(audit, null, 2)}\n`);
  }

  console.log(JSON.stringify(audit, null, 2));
  if (enabled && accepted) {
    console.warn('[nba-cap-sheets] Source adapters are intentionally not live yet; seed from reviewed snapshots until adapters are reviewed per source.');
  }
}

function parseArgs(args: string[]): { auditPath: string | null } {
  let auditPath: string | null = DEFAULT_AUDIT_PATH;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--no-write') auditPath = null;
    else if (args[i] === '--audit' && args[i + 1]) auditPath = args[++i];
  }
  return { auditPath };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  main().catch((err) => {
    console.error('NBA cap sheet refresh failed:', err);
    process.exit(1);
  });
}
