import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/client.js';
import { buildNflDataHealth } from '../nfl_coverage/data_health.js';
import { buildCapRosterDecision } from '../nfl_decision/cap_roster.js';
import { NYG_DEMO_WORKSPACE_KEY, NYG_HERO_PROJECT, NYG_HERO_SEED_KEY } from '../nfl_workspace/seed.js';

interface Check { id: string; status: 'pass' | 'fail'; detail: string }

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const checks: Check[] = [];

async function main(): Promise<void> {
  const health = await buildNflDataHealth('NYG');
  record('health', health.meeting_ready && health.source_mode === 'supabase_current_views', `${health.status}; meeting_ready=${health.meeting_ready}; source=${health.source_mode}`);
  const roster = health.datasets.find((dataset) => dataset.id === 'roster');
  record('freshness', Boolean(roster && roster.age_hours != null && roster.age_hours <= 48 && roster.row_count === 102), `roster rows=${roster?.row_count ?? 0}; age_hours=${roster?.age_hours ?? 'unknown'}`);
  const capHealth = health.datasets.find((dataset) => dataset.id === 'cap_contracts');
  record('health_counts', Boolean(capHealth && capHealth.captured_count + capHealth.derived_count + capHealth.source_needed_count === capHealth.row_count), `cap categories=${(capHealth?.captured_count ?? 0) + (capHealth?.derived_count ?? 0) + (capHealth?.source_needed_count ?? 0)}; cap rows=${capHealth?.row_count ?? 0}`);

  const decision = await buildCapRosterDecision({
    team_id: 'NYG',
    target_relief_dollars: 15_000_000,
    protected_player_ids: [],
    protected_position_groups: ['QB'],
    allowed_levers: ['hold', 'restructure', 'extension', 'pre_june_cut', 'post_june_cut', 'trade'],
  });
  let arithmetic = true;
  let citations = true;
  let uniqueActions = true;
  for (const branch of decision.branches) {
    arithmetic &&= branch.total_relief_dollars === branch.actions.reduce((sum, action) => sum + action.relief_dollars, 0)
      && branch.total_dead_money_dollars === branch.actions.reduce((sum, action) => sum + action.dead_money_dollars, 0)
      && branch.actions.every((action) => Number.isSafeInteger(action.relief_dollars) && action.relief_dollars > 0 && Number.isSafeInteger(action.dead_money_dollars));
    citations &&= branch.actions.every((action) => action.rule_references.length > 0 && action.rule_references.every((rule) => Boolean(rule.authoritative_url && rule.locator)));
    uniqueActions &&= new Set(branch.actions.map((action) => action.player_id)).size === branch.actions.length;
  }
  record('arithmetic', arithmetic && uniqueActions, `four branches reconciled=${arithmetic}; one action per player=${uniqueActions}`);
  record('citations', citations, `material actions carry exact authoritative locators=${citations}`);
  const evidenceCount = decision.evidence.captured_contract_rows + decision.evidence.derived_contract_rows + decision.evidence.directional_contract_rows + decision.evidence.source_needed_contract_rows;
  record('decision_evidence_counts', evidenceCount === decision.baseline.roster_count, `evidence categories=${evidenceCount}; roster rows=${decision.baseline.roster_count}`);
  const depthBounded = decision.branches.every((branch) => branch.actions.every((action) => action.depth_evidence.source_status === 'captured' || action.depth_effect === 'unknown'));
  record('depth_evidence', depthBounded, `uncaptured role inputs remain unknown=${depthBounded}`);
  record('presenter_decision', decision.status === 'ready' && decision.recommended_branch_id === 'balanced', decision.deterministic_summary);

  const [sessions, projects] = await Promise.all([
    db.from('sessions').select('id', { count: 'exact', head: true }).eq('workspace_key', NYG_DEMO_WORKSPACE_KEY).eq('seed_key', NYG_HERO_SEED_KEY),
    db.from('projects').select('id', { count: 'exact', head: true }).eq('workspace_key', NYG_DEMO_WORKSPACE_KEY).eq('seed_key', NYG_HERO_SEED_KEY),
  ]);
  if (sessions.error) throw new Error(`presenter session check failed: ${sessions.error.message}`);
  if (projects.error) throw new Error(`presenter project check failed: ${projects.error.message}`);
  record('seed_ownership', sessions.count === 1 && projects.count === 1, `owned sessions=${sessions.count ?? 0}; owned projects=${projects.count ?? 0}`);

  const modules = await collectActiveModules(path.join(repoRoot, 'src/main.tsx'));
  const banned = /\b(NBA|76ers|Sixers|Philadelphia 76ers|Warriors|basketball|trade machine|RealGM|Porzingis|Kuminga)\b/i;
  const contamination = modules.flatMap((file) => banned.test(file.content) ? [`${path.relative(repoRoot, file.path)}:${file.content.match(banned)?.[0]}`] : []);
  record('active_import_graph', contamination.length === 0, contamination.length ? contamination.join(', ') : `${modules.length} active client modules contain no banned demo terminology`);

  const seedShape = JSON.stringify(NYG_HERO_PROJECT);
  const seedContamination = /apron_level|\b(NBA|basketball|Warriors|Sixers|trade machine)\b/i.exec(seedShape)?.[0] ?? null;
  record('active_seed_shape', seedContamination === null, seedContamination ? `NYG seed contains ${seedContamination}` : 'owned NYG seed contains no NBA-only fields or terminology');

  const serverEntry = await readFile(path.join(repoRoot, 'server/src/index.ts'), 'utf8');
  const nbaMounted = /app\.route\(['"]\/nba['"]/.test(serverEntry) || /import\s+\{\s*nbaRoutes\s*\}/.test(serverEntry);
  record('active_server_routes', !nbaMounted, nbaMounted ? 'legacy NBA API is mounted in the localhost server' : 'legacy NBA API is not mounted in the NYG localhost runtime');

  const distFiles = await collectFiles(path.join(repoRoot, 'dist'));
  const bannedExports = distFiles.filter((file) => /(?:hawks|warriors|wizards|sixers|nba|realgm)/i.test(path.basename(file)));
  record('active_exports', bannedExports.length === 0, bannedExports.length ? bannedExports.map((file) => path.relative(repoRoot, file)).join(', ') : `${distFiles.length} production export files contain no NBA team assets`);

  const result = {
    schema: 'nfl_demo_verify.v1',
    generated_at: new Date().toISOString(),
    status: checks.every((check) => check.status === 'pass') ? 'pass' : 'fail',
    checks,
  };
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
}

function record(id: string, passed: boolean, detail: string): void {
  checks.push({ id, status: passed ? 'pass' : 'fail', detail });
}

async function collectActiveModules(entry: string): Promise<Array<{ path: string; content: string }>> {
  const visited = new Set<string>();
  const result: Array<{ path: string; content: string }> = [];
  async function visit(file: string): Promise<void> {
    const resolved = await resolveModule(file);
    if (!resolved || visited.has(resolved)) return;
    visited.add(resolved);
    const content = await readFile(resolved, 'utf8');
    result.push({ path: resolved, content });
    const imports = [...content.matchAll(/(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)].map((match) => match[1]);
    for (const specifier of imports) if (specifier.startsWith('.')) await visit(path.resolve(path.dirname(resolved), specifier));
  }
  await visit(entry);
  return result;
}

async function resolveModule(candidate: string): Promise<string | null> {
  const possibilities = [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.css`, path.join(candidate, 'index.ts'), path.join(candidate, 'index.tsx')];
  for (const possibility of possibilities) {
    try { if ((await stat(possibility)).isFile()) return possibility; } catch { /* try the next supported extension */ }
  }
  return null;
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  }));
  return files.flat();
}

void main().catch((error) => {
  console.error(JSON.stringify({ schema: 'nfl_demo_verify.v1', status: 'fail', error: error instanceof Error ? error.message : String(error), checks }, null, 2));
  process.exitCode = 1;
});
