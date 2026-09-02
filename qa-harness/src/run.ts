import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chromium, type Page } from 'playwright';
import type { NflCapRosterDecisionRequest, NflCapRosterDecisionResponse, NflDataHealthResponse } from '../../shared/types.js';
import { ADVERSARIAL_FLOW_NAMES, CANONICAL_FLOW_NAMES, type QaMode } from './flows.js';
import { PERSONA } from './persona.js';
import { resetQaWorkspaceRows } from './reset.js';

type Severity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW';
type Status = 'passed' | 'failed';
interface FlowResult { name: string; status: Status; detail: string; screenshot?: string }
interface Finding { severity: Severity; flow: string; detail: string; screenshot?: string }

const sourceFile = fileURLToPath(import.meta.url);
const harnessDir = path.resolve(path.dirname(sourceFile), '..');
const repoRoot = path.resolve(harnessDir, '..');
dotenv.config({ path: path.join(repoRoot, 'server', '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local') });

const appUrl = process.env.QA_APP_URL ?? 'http://localhost:5173';
const serverUrl = process.env.QA_SERVER_URL ?? 'http://localhost:8790';
const mode = parseMode(process.argv);
const headless = process.env.QA_HEADLESS !== '0';
const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const runDir = path.join(harnessDir, 'runs', `${runStamp}-${mode}`);
const screenshotsDir = path.join(runDir, 'screenshots');
const results: FlowResult[] = [];
const findings: Finding[] = [];
let screenshotIndex = 0;

async function main(): Promise<void> {
  await fs.mkdir(screenshotsDir, { recursive: true });
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceRoleKey) {
    await resetQaWorkspaceRows({ supabaseUrl, serviceRoleKey });
  } else {
    console.warn('[qa] Supabase credentials absent; scoped QA-row reset skipped.');
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/i.test(message.text())) browserErrors.push(message.text());
  });

  try {
    if (mode === 'canonical') {
      const firstStart = findings.length;
      await canonicalRehearsal(page, 1, { width: 1440, height: 900 });
      const firstClean = findings.length === firstStart;
      const secondStart = findings.length;
      await canonicalRehearsal(page, 2, { width: 1280, height: 720 });
      const secondClean = findings.length === secondStart;
      results.push({ name: 'Two consecutive clean presenter rehearsals', status: firstClean && secondClean ? 'passed' : 'failed', detail: `rehearsal 1 ${firstClean ? 'clean' : 'failed'}; rehearsal 2 ${secondClean ? 'clean' : 'failed'}` });
    } else {
      await adversarialRun(page);
    }
    await check(page, 'Browser runtime errors', 'HIGH', async () => {
      assert(browserErrors.length === 0, browserErrors.join(' | '));
    });
  } finally {
    await context.close();
    await browser.close();
  }

  const report = {
    schema: 'nfl_demo_qa_report.v1',
    mode,
    generated_at: new Date().toISOString(),
    persona: PERSONA,
    expected_flows: mode === 'canonical' ? CANONICAL_FLOW_NAMES : ADVERSARIAL_FLOW_NAMES,
    results,
    findings,
    acceptance: {
      blocker_or_high_count: findings.filter((item) => item.severity === 'BLOCKER' || item.severity === 'HIGH').length,
      medium_count: findings.filter((item) => item.severity === 'MEDIUM').length,
      passed: findings.length === 0,
    },
  };
  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(runDir, 'report.md'), markdownReport(report));
  console.log(`[qa] ${mode}: ${report.acceptance.passed ? 'PASS' : 'FAIL'} · ${results.filter((item) => item.status === 'passed').length}/${results.length} checks · ${runDir}`);
  if (!report.acceptance.passed) process.exitCode = 1;
}

async function canonicalRehearsal(page: Page, rehearsal: number, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  const prefix = `Rehearsal ${rehearsal}`;
  await check(page, `${prefix} · Presenter cold start`, 'BLOCKER', async () => {
    await openPresenter(page);
    await expectText(page, 'Create room. Preserve the football plan.');
    await expectText(page, 'Public demo data');
    assert(await page.locator('.branch-card').count() === 4, 'Expected four pre-seeded branches without a model call.');
    assert(await page.getByRole('tab', { name: 'Question workspace' }).count() === 0, 'Presenter mode exposed operator Analysis channels.');
    assert(await page.getByText('Channels', { exact: false }).count() === 0, 'Presenter mode loaded the operator channel rail.');
  });
  await check(page, `${prefix} · Primary Analysis workspace`, 'BLOCKER', async () => {
    await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Preflight passed', { exact: true }).waitFor({ timeout: 20_000 });
    await expectText(page, 'Analysis');
    await expectText(page, 'What do you want to analyze?');
    const composer = page.getByRole('textbox').first();
    await composer.fill('Which Giants roster decision has the largest evidence gap?');
    assert((await composer.inputValue()).startsWith('Which Giants roster decision'), 'Analysis composer did not accept a football question.');
    await page.getByRole('tab', { name: 'Reviewed cap analysis' }).click();
    await page.getByRole('heading', { name: 'Create room. Preserve the football plan.' }).waitFor({ timeout: 20_000 });
  });
  await check(page, `${prefix} · Data-health preflight`, 'BLOCKER', async () => {
    const health = await api<NflDataHealthResponse>('/nfl/data-health?team_id=NYG');
    assert(health.meeting_ready, health.blockers.join('; ') || 'meeting_ready is false');
    assert(health.source_mode === 'supabase_current_views', `unexpected source mode ${health.source_mode}`);
    assert(health.datasets.find((item) => item.id === 'roster')?.row_count === 102, 'Expected 102 current Giants roster rows.');
    await expectText(page, 'Preflight passed');
    await expectText(page, 'DB-backed');
  });
  await check(page, `${prefix} · Hero branch comparison`, 'HIGH', async () => {
    const labels = await page.locator('.branch-card strong').allTextContents();
    assert(labels.join('|') === 'Hold|Preserve depth|Balanced|Maximize relief', `unexpected branches: ${labels.join(', ')}`);
    assert(await page.locator('.branch-card', { hasText: 'Balanced' }).getByText('Target met', { exact: true }).isVisible(), 'Balanced branch did not visibly meet the default target.');
  });
  await check(page, `${prefix} · Changing target relief`, 'HIGH', async () => {
    const target = page.getByLabel('Target relief dollars');
    await target.fill('20000000');
    assert(await page.locator('.branch-card').count() === 0, 'Edited target left stale branch cards visible before recompute.');
    await page.getByRole('button', { name: 'Recompute branches' }).click();
    await page.locator('.branch-card').first().waitFor({ timeout: 15_000 });
    const response = await decision({ target_relief_dollars: 20_000_000, protected_position_groups: ['QB'] });
    assert(response.recommended_branch_id === 'balanced', `unexpected recommendation ${response.recommended_branch_id}`);
    assert(response.branches.find((item) => item.id === 'balanced')?.target_met === true, 'Balanced branch did not clear $20M.');
  });
  await check(page, `${prefix} · Protecting a position group`, 'HIGH', async () => {
    const response = await decision({ target_relief_dollars: 15_000_000, protected_position_groups: ['QB', 'OL'] });
    const forbidden = new Set(['T', 'OT', 'G', 'OG', 'C', 'OL']);
    assert(response.branches.every((branch) => branch.actions.every((action) => !forbidden.has((action.position ?? '').toUpperCase()))), 'Protected offensive-line player entered a transaction branch.');
    await openPresenter(page);
    await page.getByRole('button', { name: 'OL', exact: true }).click();
    await page.getByRole('button', { name: 'Recompute branches' }).click();
    await page.waitForTimeout(200);
    assert((await page.getByRole('button', { name: 'OL', exact: true }).getAttribute('class'))?.includes('active') === true, 'OL protection is not visibly active.');
  });
  await check(page, `${prefix} · Evidence and rule drilldown`, 'HIGH', async () => {
    await openPresenter(page);
    await page.locator('.action-table button.action-row').first().click();
    await expectText(page, 'Open player contract source');
    await expectText(page, 'Contract evidence');
    await expectText(page, '2025 public role evidence');
    await page.locator('.branch-card', { hasText: 'Hold' }).click();
    await expectText(page, 'Every number opens its proof.');
    await page.locator('.branch-card', { hasText: 'Balanced' }).click();
    await page.locator('.action-table button.action-row').first().click();
    await page.locator('.rule-link').first().click();
    await expectText(page, 'Official locator');
    assert(await page.locator('.rule-detail a.source-link').count() === 1, 'Rule detail lacks an authoritative source link.');
  });
  await check(page, `${prefix} · What changes the call`, 'MEDIUM', async () => {
    await openPresenter(page);
    assert(await page.locator('.trigger-grid article').count() === 4, 'Expected four decision-change triggers.');
  });
  await check(page, `${prefix} · Workspace handoff and client draft`, 'HIGH', async () => {
    await openPresenter(page);
    await page.getByRole('button', { name: 'Workspaces' }).click();
    await expectText(page, 'Reviewed fixture');
    for (const stage of ['Question', 'Evidence', 'Scenarios', 'Decision', 'Action Plan']) await expectText(page, stage);
    const before = await api<{ workspaces: unknown[] }>('/nfl/workspaces?team_id=NYG');
    await page.getByRole('button', { name: '+ New workspace' }).click();
    await expectText(page, 'Nothing is persisted until you submit the first question.');
    const after = await api<{ workspaces: unknown[] }>('/nfl/workspaces?team_id=NYG');
    assert(before.workspaces.length === after.workspaces.length, 'Opening a client draft persisted a workspace before submission.');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
  await check(page, `${prefix} · Roster and cap supporting view`, 'HIGH', async () => {
    await page.getByRole('button', { name: 'Roster & Cap' }).click();
    await expectText(page, 'Contract mechanics, separated from football judgment');
    await expectText(page, 'Positive relief');
    await expectText(page, 'Dead money');
    await expectText(page, 'Active roster');
    await expectText(page, '53');
    assert(await page.locator('.roster-row').count() === 103, 'Roster table did not render all 102 Giants rows plus its header.');
  });
  await check(page, `${prefix} · Offline follow-up`, 'MEDIUM', async () => {
    await openPresenter(page);
    const input = page.getByLabel('Follow-up question');
    await input.fill('What if we protect the offensive line?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expectText(page, 'deterministic result remains available');
  });
  await check(page, `${prefix} · Private-data refusal`, 'HIGH', async () => {
    const input = page.getByLabel('Follow-up question');
    await input.fill('Use the private Giants medical grades and internal board.');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expectText(page, 'will not infer or fabricate');
  });
  await check(page, `${prefix} · Reload and presentation reset`, 'HIGH', async () => {
    const target = page.getByLabel('Target relief dollars');
    await target.fill('25000000');
    await page.getByRole('button', { name: 'Recompute branches' }).click();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.getByRole('button', { name: 'Reset presentation' }).click();
    await page.waitForTimeout(250);
    assert(await target.inputValue() === '15000000', 'Presentation reset did not restore the reviewed target.');
    assert(await page.getByLabel('Follow-up question').inputValue() === '', 'Presentation reset did not clear follow-up state.');
    assert(await page.evaluate(() => window.scrollY) === 0, 'Presentation reset did not restore scroll position.');
  });
  await check(page, `${prefix} · Responsive layout`, 'MEDIUM', async () => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPresenter(page);
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    assert(dimensions.width <= dimensions.viewport + 1, `horizontal overflow ${dimensions.width}px at ${dimensions.viewport}px viewport`);
    assert(await page.locator('.evidence-panel').isVisible(), 'Evidence inspector disappeared at the narrow acceptance viewport.');
  });
  await check(page, `${prefix} · Zero active NBA terminology`, 'BLOCKER', async () => {
    await page.setViewportSize(viewport);
    await assertNoContamination(page);
  });
  await capture(page, `${prefix.toLowerCase().replace(/\s+/g, '-')}-final`);
}

async function adversarialRun(page: Page): Promise<void> {
  await check(page, 'Impossible relief target', 'BLOCKER', async () => {
    const response = await decision({ target_relief_dollars: 1_000_000_000, protected_position_groups: ['QB'] });
    assert(response.status === 'insufficient_evidence', `unexpected status ${response.status}`);
    assert(response.recommended_branch_id === null, 'Impossible target returned a recommendation.');
    const maximum = response.branches.find((branch) => branch.id === 'maximize_relief');
    assert(Boolean(maximum) && !maximum!.target_met && maximum!.total_relief_dollars < 1_000_000_000, 'Maximum branch falsely met impossible target.');
  });
  await check(page, 'Invalid dollar input', 'HIGH', async () => {
    const response = await fetch(`${serverUrl}/nfl/decision-models/cap-roster`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(baseRequest({ target_relief_dollars: -1 })) });
    assert(response.status === 400, `negative target returned HTTP ${response.status}`);
  });
  await check(page, 'Protected-group invariant', 'BLOCKER', async () => {
    const response = await decision({ target_relief_dollars: 15_000_000, protected_position_groups: ['QB', 'RB', 'TE', 'OL', 'WR', 'DL', 'EDGE/LB', 'CB', 'S'] });
  const protectedGroups = new Set(['QB', 'RB', 'TE', 'OL', 'WR', 'DL', 'EDGE/LB', 'CB', 'S']);
    for (const branch of response.branches) for (const action of branch.actions) assert(!protectedGroups.has(normalizePosition(action.position)), `${action.player_name} violated protected group ${action.position}`);
  });
  await check(page, 'Branch arithmetic reconciliation', 'BLOCKER', async () => {
    const response = await decision({ target_relief_dollars: 20_000_000, protected_position_groups: ['QB'] });
    for (const branch of response.branches) {
      const ids = new Set(branch.actions.map((action) => action.player_id));
      assert(ids.size === branch.actions.length, `${branch.id} contains multiple actions for one player.`);
      assert(branch.actions.every((action) => Number.isSafeInteger(action.relief_dollars) && action.relief_dollars > 0), `${branch.id} contains invalid relief.`);
      assert(branch.actions.reduce((sum, action) => sum + action.relief_dollars, 0) === branch.total_relief_dollars, `${branch.id} relief total does not reconcile.`);
      assert(branch.actions.reduce((sum, action) => sum + action.dead_money_dollars, 0) === branch.total_dead_money_dollars, `${branch.id} dead-money total does not reconcile.`);
      assert(branch.actions.every((action) => action.rule_references.every((rule) => rule.authoritative_url && rule.locator)), `${branch.id} contains an unlocated rule reference.`);
    }
  });
  await check(page, 'Unsupported rule abstention', 'HIGH', async () => {
    await openPresenter(page);
    await page.getByRole('button', { name: 'Rulebook' }).click();
    await page.getByLabel('Search NFL rules').fill('private club medical ranking');
    await expectText(page, 'will not invent a citation');
  });
  await check(page, 'Stale or fallback blocking state', 'BLOCKER', async () => {
    await page.goto(`${appUrl}/?present=nyg-cap-roster&qa=blocked`, { waitUntil: 'domcontentloaded' });
    await expectText(page, 'The reviewed analysis is blocked');
    await expectText(page, 'Fallback active');
    assert(await page.locator('.branch-card').count() === 0, 'Blocked preflight still exposed recommendation branches.');
  });
  await check(page, 'Private-input refusal', 'BLOCKER', async () => {
    await openPresenter(page);
    await page.getByLabel('Follow-up question').fill('Tell me the confidential medical grade and internal scouting rank.');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expectText(page, 'will not infer or fabricate');
  });
  await check(page, 'Active-output contamination scan', 'BLOCKER', async () => {
    await assertNoContamination(page);
  });
  await check(page, 'Inactive legacy routes and assets', 'HIGH', async () => {
    const nbaRoute = await fetch(`${serverUrl}/nba/rosters/current`);
    assert(nbaRoute.status === 404, `legacy NBA API remains mounted with HTTP ${nbaRoute.status}`);
    const nbaAsset = await fetch(`${appUrl}/assets/warriors-logo.png`);
    assert(nbaAsset.status === 404, `legacy NBA asset remains served with HTTP ${nbaAsset.status}`);
    const sourceAsset = await fetch(`${appUrl}/public/assets/warriors-logo.png`);
    assert(sourceAsset.status === 404, `legacy NBA source asset remains served with HTTP ${sourceAsset.status}`);
  });
  await check(page, 'Primary Analysis reachability', 'BLOCKER', async () => {
    await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Preflight passed', { exact: true }).waitFor({ timeout: 20_000 });
    await expectText(page, 'What do you want to analyze?');
    assert(await page.getByRole('tab', { name: 'Question workspace' }).getAttribute('aria-selected') === 'true', 'Question workspace is not the default Analysis mode.');
  });
}

async function assertNoContamination(page: Page): Promise<void> {
  await openPresenter(page);
  const banned = /\b(NBA|76ers|Sixers|Philadelphia 76ers|Warriors|basketball|trade machine|RealGM|Porzingis|Kuminga)\b/i;
  for (const label of ['Analysis', 'Briefing', 'Workspaces', 'Roster & Cap', 'Rulebook', 'Settings']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.waitForTimeout(100);
    const text = await page.locator('body').innerText();
    assert(!banned.test(text), `${label} contains banned active terminology: ${text.match(banned)?.[0]}`);
  }
}

async function openPresenter(page: Page): Promise<void> {
  await page.goto(`${appUrl}/?present=nyg-cap-roster`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Preflight passed', { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByRole('heading', { name: 'Create room. Preserve the football plan.' }).waitFor({ timeout: 20_000 });
}

async function check(page: Page, name: string, severity: Severity, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
    results.push({ name, status: 'passed', detail: 'verified' });
    console.log(`[qa] PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const screenshot = await capture(page, `failure-${slug(name)}`).catch(() => undefined);
    results.push({ name, status: 'failed', detail, screenshot });
    findings.push({ severity, flow: name, detail, screenshot });
    console.error(`[qa] FAIL ${name}: ${detail}`);
  }
}

async function capture(page: Page, label: string): Promise<string> {
  const file = `${String(screenshotIndex++).padStart(3, '0')}-${slug(label)}.png`;
  await page.screenshot({ path: path.join(screenshotsDir, file), fullPage: false });
  return `screenshots/${file}`;
}

async function api<T>(route: string): Promise<T> {
  const response = await fetch(`${serverUrl}${route}`);
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

async function decision(overrides: Partial<NflCapRosterDecisionRequest>): Promise<NflCapRosterDecisionResponse> {
  const response = await fetch(`${serverUrl}/nfl/decision-models/cap-roster`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(baseRequest(overrides)) });
  if (!response.ok) throw new Error(`decision model returned HTTP ${response.status}: ${await response.text()}`);
  return await response.json() as NflCapRosterDecisionResponse;
}

function baseRequest(overrides: Partial<NflCapRosterDecisionRequest>): NflCapRosterDecisionRequest {
  return {
    team_id: 'NYG',
    target_relief_dollars: 15_000_000,
    protected_player_ids: [],
    protected_position_groups: ['QB'],
    allowed_levers: ['hold', 'restructure', 'extension', 'pre_june_cut', 'post_june_cut', 'trade'],
    ...overrides,
  };
}

async function expectText(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: false }).first().waitFor({ timeout: 15_000 });
}

function normalizePosition(position: string | null): string {
  const value = (position ?? 'OTHER').toUpperCase();
  if (['T', 'OT', 'G', 'OG', 'C', 'OL'].includes(value)) return 'OL';
  if (['DE', 'OLB', 'EDGE', 'LB', 'MLB', 'ILB'].includes(value)) return 'EDGE/LB';
  if (['DT', 'NT', 'DL'].includes(value)) return 'DL';
  if (['FS', 'SS', 'S', 'SAF'].includes(value)) return 'S';
  if (['CB', 'DB'].includes(value)) return 'CB';
  if (['FB', 'HB', 'RB'].includes(value)) return 'RB';
  return value;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseMode(args: string[]): QaMode {
  const index = args.indexOf('--mode');
  const value = index >= 0 ? args[index + 1] : 'canonical';
  if (value !== 'canonical' && value !== 'adversarial') throw new Error(`unsupported QA mode: ${value}`);
  return value;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function markdownReport(report: { mode: QaMode; generated_at: string; results: FlowResult[]; findings: Finding[]; acceptance: { passed: boolean } }): string {
  const lines = [`# Giants demo QA — ${report.mode}`, '', `- Generated: ${report.generated_at}`, `- Result: ${report.acceptance.passed ? 'PASS' : 'FAIL'}`, '', '## Checks', '', '| Check | Result | Detail |', '|---|---|---|'];
  for (const result of report.results) lines.push(`| ${result.name} | ${result.status.toUpperCase()} | ${result.detail.replace(/\|/g, '\\|')} |`);
  lines.push('', '## Findings', '');
  if (report.findings.length === 0) lines.push('No findings.');
  for (const finding of report.findings) lines.push(`- **${finding.severity} — ${finding.flow}:** ${finding.detail}${finding.screenshot ? ` ([screenshot](${finding.screenshot}))` : ''}`);
  return `${lines.join('\n')}\n`;
}

void main().catch((error) => {
  console.error('[qa] fatal:', error);
  process.exitCode = 2;
});
