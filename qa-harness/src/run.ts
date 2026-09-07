import 'dotenv/config';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import type {
  NflSellerMoveOptionsResponse,
  NflTransactionMarketAnalysis,
  NflTransactionMarketRequest,
} from '../../shared/types.js';
import { ADVERSARIAL_FLOW_NAMES, CANONICAL_FLOW_NAMES, type QaMode } from './flows.js';
import { PERSONA } from './persona.js';
import { runModelMoveSmoke } from './model-move-smoke.js';

interface FlowResult {
  name: string;
  status: 'passed' | 'failed';
  detail: string;
}

const sourceFile = fileURLToPath(import.meta.url);
const harnessDir = path.resolve(path.dirname(sourceFile), '..');
const repoRoot = path.resolve(harnessDir, '..');
dotenv.config({ path: path.join(repoRoot, 'server', '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local') });

const appUrl = process.env.QA_APP_URL ?? 'http://localhost:5173';
const serverUrl = process.env.QA_SERVER_URL ?? 'http://localhost:8790';
const mode = parseMode(process.argv);
const results: FlowResult[] = [];

async function main(): Promise<void> {
  if (mode === 'canonical') {
    await check('Live seller-move flow at meeting viewport', () => runModelMoveSmoke({ width: 1440, height: 900 }));
    await check('Live seller-move flow at narrow viewport', () => runModelMoveSmoke({ width: 1024, height: 768 }));
  } else {
    await adversarialChecks();
  }

  const report = {
    schema: 'nfl_analysis_qa_report.v2',
    mode,
    generated_at: new Date().toISOString(),
    persona: PERSONA,
    expected_flows: mode === 'canonical' ? CANONICAL_FLOW_NAMES : ADVERSARIAL_FLOW_NAMES,
    results,
    passed: results.every((result) => result.status === 'passed'),
  };
  const runDir = path.join(harnessDir, 'runs', `${report.generated_at.replace(/[:.]/g, '-')}-${mode}`);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[qa] ${mode}: ${report.passed ? 'PASS' : 'FAIL'} · ${results.filter((result) => result.status === 'passed').length}/${results.length} checks · ${runDir}`);
  if (!report.passed) process.exitCode = 1;
}

async function adversarialChecks(): Promise<void> {
  let analysis: NflTransactionMarketAnalysis | null = null;
  let options: NflSellerMoveOptionsResponse | null = null;

  await check('Fresh market result is required', async () => {
    analysis = await post<NflTransactionMarketAnalysis>('/nfl/transaction-market/analyze', {
      analysis_mode: 'ten_year_trend',
      start_year: 2016,
      end_year: 2025,
      position_groups: ['CB'],
      include_ytd: false,
      max_comparables: 8,
    } satisfies NflTransactionMarketRequest);
    options = await get<NflSellerMoveOptionsResponse>('/nfl/transaction-market/move-options?team_id=NYG&position_groups=CB');
    assert(options.positions[0]?.players[0], 'No eligible current Giants CB contract was available for the check.');
    const response = await fetch(`${serverUrl}/nfl/transaction-market/model-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        team_id: 'NYG',
        player_id: options.positions[0].players[0].player_id,
        position_group: 'CB',
        pick_year: options.current_year + 1,
        pick_round: 3,
        market_scope: { snapshot_id: 'stale-snapshot', start_year: 2016, end_year: 2025, include_ytd: false, team_ids: [] },
      }),
    });
    assert.equal(response.status, 400);
  });

  await check('Invalid proposed pick is rejected', async () => {
    assert(analysis && options, 'The market and contract checks did not initialize.');
    const player = options.positions[0]?.players[0];
    assert(player, 'No eligible current Giants CB contract was available for the check.');
    const response = await fetch(`${serverUrl}/nfl/transaction-market/model-move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        team_id: 'NYG',
        player_id: player.player_id,
        position_group: 'CB',
        pick_year: options.current_year + 1,
        pick_round: 0,
        market_scope: { snapshot_id: analysis.snapshot_id, start_year: 2016, end_year: 2025, include_ytd: false, team_ids: [] },
      }),
    });
    assert.equal(response.status, 400);
  });

  await check('Retired cap room is unreachable', async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    try {
      await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
      await page.getByText('What do you want to analyze?', { exact: true }).waitFor({ timeout: 20_000 });
      assert.equal(await page.getByText('Cap analysis', { exact: true }).count(), 0);
      assert.equal(await page.getByText('Analyze 10-year position markets', { exact: true }).count(), 0);
      assert.equal(await page.getByText('answer format', { exact: true }).count(), 0);
      assert.equal(await page.locator('.branch-card').count(), 0);
    } finally {
      await context.close();
      await browser.close();
    }
  });
}

async function check(name: string, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
    results.push({ name, status: 'passed', detail: 'verified' });
    console.log(`[qa] PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, status: 'failed', detail });
    console.error(`[qa] FAIL ${name}: ${detail}`);
  }
}

async function get<T>(route: string): Promise<T> {
  const response = await fetch(`${serverUrl}${route}`);
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

async function post<T>(route: string, body: unknown): Promise<T> {
  const response = await fetch(`${serverUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

function parseMode(args: string[]): QaMode {
  const index = args.indexOf('--mode');
  const value = index >= 0 ? args[index + 1] : 'canonical';
  if (value !== 'canonical' && value !== 'adversarial') throw new Error(`unsupported QA mode: ${value}`);
  return value;
}

void main().catch((error) => {
  console.error('[qa] fatal:', error);
  process.exitCode = 2;
});
