import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import {
  NFL_RELIABILITY_DETERMINISTIC_CASE_COUNT,
  NFL_RELIABILITY_LIVE_SCENARIOS,
  buildNflReliabilityConversationCases,
  buildNflReliabilityIntentCases,
} from '../../shared/nflReliabilityCases.js';
import type {
  Brief,
  BriefSource,
  CreateBriefResponse,
  DataAnalysisBriefBody,
} from '../../shared/types.js';
import {
  NFL_RELIABILITY_JUDGE_MODEL,
  NFL_RELIABILITY_MAX_JUDGE_CALLS,
  NFL_RELIABILITY_MAX_JUDGE_OUTPUT_TOKENS,
  judgeNflReliabilityCases,
  type NflReliabilityJudgeCase,
  type NflReliabilityJudgeVerdict,
} from './terra-judge.js';

type AssertionReport = { name: string; passed: boolean; detail: string };
type JudgeReport = {
  status: 'passed' | 'failed' | 'inconclusive' | 'skipped_no_openai_key' | 'not_run' | 'not_requested';
  violations?: string[];
};
type CaseReport = {
  id: string;
  lane: 'deterministic' | 'live_current' | 'live_seller' | 'system';
  status: 'passed' | 'failed' | 'skipped';
  duration_ms?: number;
  assertions: AssertionReport[];
  judge?: JudgeReport;
};
type CleanupReport = { seed_key: string; verified_zero_rows: boolean };

const sourceFile = fileURLToPath(import.meta.url);
const harnessDir = path.resolve(path.dirname(sourceFile), '..');
const repoRoot = path.resolve(harnessDir, '..');
dotenv.config({ path: path.join(repoRoot, 'server', '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local') });

const serverUrl = process.env.QA_SERVER_URL ?? 'http://localhost:8790';
const appUrl = process.env.QA_APP_URL ?? 'http://localhost:5173';
const live = process.argv.includes('--live') || process.env.NFL_RELIABILITY_LIVE === '1';
const judgeRequested = process.argv.includes('--judge') || process.env.NFL_RELIABILITY_JUDGE === '1';
const requireLive = process.env.NFL_RELIABILITY_REQUIRE_LIVE === '1';
const requireJudge = process.env.NFL_RELIABILITY_REQUIRE_JUDGE === '1';
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const runId = randomUUID();
const cases: CaseReport[] = [];
const cleanup: CleanupReport[] = [];
const createdSeeds: string[] = [];
const judgeCases: NflReliabilityJudgeCase[] = [];
const liveBriefIds: Partial<Record<'current' | 'seller', string>> = {};
let database: SupabaseClient | null = null;
let terraUsage: { input_tokens: number | null; output_tokens: number | null } | null = null;

async function main(): Promise<void> {
  let fatal: unknown = null;
  try {
    await runServerReliabilityMatrix();
    addDeterministicContractResult();
    if (judgeRequested && !live) {
      throw new Error('The Terra judge requires --live because it judges completed production answers.');
    }
    if (live) {
      assert(supabaseUrl && serviceRoleKey, 'Local Supabase credentials are required for the live reliability gate.');
      database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
      await requireHealthyLocalStack();
      await runLiveCase('current-followup-scope', () => runCurrentFollowupScenario(database!));
      await runLiveCase('seller-interpretation-grounding', () => runSellerScenario(database!));
      if (liveBriefIds.current && liveBriefIds.seller) {
        await runLiveCase('browser-rendering', verifyRenderedResults);
      }
      if (judgeCases.length === NFL_RELIABILITY_LIVE_SCENARIOS.length
        && cases.filter((entry) => entry.lane === 'live_current' || entry.lane === 'live_seller')
          .every((entry) => entry.status === 'passed')) {
        await runLiveCase('terra-judge', runJudge);
      }
    } else if (requireLive) {
      throw new Error('NFL_RELIABILITY_REQUIRE_LIVE=1 requires --live.');
    }
  } catch (error) {
    fatal = error;
    cases.push({
      id: 'reliability-runner',
      lane: 'system',
      status: 'failed',
      assertions: [{
        name: 'runner_completed',
        passed: false,
        detail: safeError(error),
      }],
    });
  } finally {
    if (database) {
      for (const seedKey of createdSeeds) {
        cleanup.push(await cleanupExactSession(database, seedKey));
      }
    }
  }

  const report = {
    schema: 'nfl_answer_reliability_report.v1',
    run_id: runId,
    mode: live ? 'live' : 'deterministic',
    generated_at: new Date().toISOString(),
    budgets: {
      deterministic_cases: NFL_RELIABILITY_DETERMINISTIC_CASE_COUNT,
      max_live_scenarios: NFL_RELIABILITY_LIVE_SCENARIOS.length,
      max_live_turns: NFL_RELIABILITY_LIVE_SCENARIOS.reduce((sum, scenario) => sum + scenario.turns.length, 0),
      max_judge_calls: NFL_RELIABILITY_MAX_JUDGE_CALLS,
      max_judge_output_tokens: NFL_RELIABILITY_MAX_JUDGE_OUTPUT_TOKENS,
      judge_model: NFL_RELIABILITY_JUDGE_MODEL,
      judge_enabled: judgeRequested,
    },
    judge_usage: terraUsage,
    cases,
    cleanup,
    passed: fatal == null
      && cases.every((entry) => entry.status !== 'failed')
      && cleanup.every((entry) => entry.verified_zero_rows),
  };
  const runDir = path.join(harnessDir, 'runs', report.generated_at.replace(/[:.]/g, '-') + '-answer-reliability');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    '[qa] NFL answer reliability: '
    + (report.passed ? 'PASS' : 'FAIL')
    + ' · ' + NFL_RELIABILITY_DETERMINISTIC_CASE_COUNT + ' deterministic cases'
    + (live ? ' · 2 live scenarios / 3 production prompts' : ' · no model calls')
    + (judgeRequested ? ' · Terra judge requested' : '')
    + ' · ' + runDir,
  );
  if (!report.passed) process.exitCode = 1;
}

async function runServerReliabilityMatrix(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(command, ['run', 'test:reliability'], {
      cwd: path.join(repoRoot, 'server'),
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error('Deterministic reliability matrix failed with ' + (signal ? 'signal ' + signal : 'exit ' + code) + '.'));
    });
  });
}

function addDeterministicContractResult(): void {
  const conversationCases = buildNflReliabilityConversationCases();
  const intentCases = buildNflReliabilityIntentCases();
  const allIds = [...conversationCases, ...intentCases].map((entry) => entry.id);
  const liveTurns = NFL_RELIABILITY_LIVE_SCENARIOS.reduce((sum, scenario) => sum + scenario.turns.length, 0);
  const assertions: AssertionReport[] = [
    checkValue('case_count_matches_contract', allIds.length === NFL_RELIABILITY_DETERMINISTIC_CASE_COUNT, String(allIds.length)),
    checkValue('case_ids_are_unique', new Set(allIds).size === allIds.length, String(new Set(allIds).size)),
    checkValue('broad_zero_cost_coverage', allIds.length >= 150, String(allIds.length)),
    checkValue('live_scenarios_are_capped', NFL_RELIABILITY_LIVE_SCENARIOS.length === 2, String(NFL_RELIABILITY_LIVE_SCENARIOS.length)),
    checkValue('live_turns_are_capped', liveTurns === 3 && liveTurns <= 12, String(liveTurns)),
  ];
  cases.push({
    id: 'deterministic-contract-matrix',
    lane: 'deterministic',
    status: assertions.every((entry) => entry.passed) ? 'passed' : 'failed',
    assertions,
  });
}

async function requireHealthyLocalStack(): Promise<void> {
  const response = await fetch(serverUrl + '/health');
  if (!response.ok) throw new Error('Local server health check failed with HTTP ' + response.status + '.');
  const health = await response.json() as { ok?: boolean; anthropic?: boolean; supabase?: boolean };
  if (!health.ok || !health.anthropic || !health.supabase) {
    throw new Error('The local server is missing its production answer model or database connection.');
  }
}

async function runCurrentFollowupScenario(db: SupabaseClient): Promise<void> {
  const startedAt = Date.now();
  const report: CaseReport = {
    id: 'current-followup-scope',
    lane: 'live_current',
    status: 'failed',
    assertions: [],
    judge: { status: judgeRequested ? 'not_run' : 'not_requested' },
  };
  cases.push(report);
  const seedKey = 'qa:answer-reliability:' + runId + ':current-followup-scope';
  createdSeeds.push(seedKey);
  const sessionId = await createQaSession(db, seedKey, 'QA reliability · current follow-up');
  const scenario = NFL_RELIABILITY_LIVE_SCENARIOS[0];
  const initial = await createAndWaitForBrief(db, sessionId, scenario.turns[0].question, 55_000);
  verifyReadyDataBrief(initial, 'decision_brief', report.assertions, 'initial');
  const followup = await createAndWaitForBrief(db, sessionId, scenario.turns[1].question, 55_000);
  verifyReadyDataBrief(followup, 'decision_brief', report.assertions, 'followup');
  const body = dataBody(followup);
  record(report.assertions, 'followup_answer_is_present', body.answer.trim().length >= 80, String(body.answer.trim().length));
  record(report.assertions, 'followup_retains_giants_nabers_scope', /\b(?:Giants|Nabers)\b/i.test(body.answer), 'semantic scope marker present');
  record(report.assertions, 'followup_uses_nfl_deadline_budget', (followup.duration_ms ?? 0) > 0 && (followup.duration_ms ?? Infinity) <= 45_000, String(followup.duration_ms));
  const sourceCount = await briefSourceCount(db, followup.id);
  record(report.assertions, 'followup_has_source_rows', sourceCount > 0, String(sourceCount));
  report.duration_ms = Date.now() - startedAt;
  report.status = report.assertions.every((entry) => entry.passed) ? 'passed' : 'failed';
  liveBriefIds.current = followup.id;
  judgeCases.push({
    id: report.id,
    answer: body.answer,
    facts: {
      expected_team: 'NYG',
      expected_player: 'Malik Nabers',
      expected_template: 'decision_brief',
      expected_mode: 'data_analyst',
      source_count: sourceCount,
    },
  });
  assert.equal(report.status, 'passed', 'Current-NFL follow-up scenario failed a hard assertion.');
}

async function runSellerScenario(db: SupabaseClient): Promise<void> {
  const startedAt = Date.now();
  const report: CaseReport = {
    id: 'seller-interpretation-grounding',
    lane: 'live_seller',
    status: 'failed',
    assertions: [],
    judge: { status: judgeRequested ? 'not_run' : 'not_requested' },
  };
  cases.push(report);
  const seedKey = 'qa:answer-reliability:' + runId + ':seller-interpretation-grounding';
  createdSeeds.push(seedKey);
  const sessionId = await createQaSession(db, seedKey, 'QA reliability · seller interpretation');
  const scenario = NFL_RELIABILITY_LIVE_SCENARIOS[1];
  const brief = await createAndWaitForBrief(db, sessionId, scenario.turns[0].question, 40_000);
  verifyReadyDataBrief(brief, 'data_table', report.assertions, 'seller');
  const body = dataBody(brief);
  const artifact = body.seller_move_analysis;
  const result = artifact?.result;
  record(report.assertions, 'seller_artifact_is_present', Boolean(result), result ? 'present' : 'missing');
  record(report.assertions, 'seller_player_is_brian_burns', result?.player.player_name === 'Brian Burns', result?.player.player_name ?? 'missing');
  record(report.assertions, 'seller_pick_is_2027_round_2', result?.proposal.pick_year === 2027 && result.proposal.pick_round === 2, result ? String(result.proposal.pick_year) + '/R' + result.proposal.pick_round : 'missing');
  record(report.assertions, 'seller_interpretation_passed_server_guardrails', body.analysis_interpretation_status === 'ready' && body.answer.trim().length > 0, body.analysis_interpretation_status ?? 'missing');
  record(report.assertions, 'seller_uses_interpretation_deadline_budget', (brief.duration_ms ?? 0) > 0 && (brief.duration_ms ?? Infinity) <= 30_000, String(brief.duration_ms));
  const sources = await briefSources(db, brief.id);
  const sourceFlags = new Set(sources.flatMap((source) => {
    const data = source.data ?? {};
    return [
      data.seller_move_contract === true ? 'contract' : '',
      data.seller_move_role === true ? 'role' : '',
      data.seller_move_rule === true ? 'rule' : '',
      data.seller_move_comparable === true ? 'comparable' : '',
    ].filter(Boolean);
  }));
  record(report.assertions, 'seller_has_contract_role_rule_and_comparable_sources', ['contract', 'role', 'rule', 'comparable'].every((kind) => sourceFlags.has(kind)), [...sourceFlags].sort().join(','));
  report.duration_ms = Date.now() - startedAt;
  report.status = report.assertions.every((entry) => entry.passed) ? 'passed' : 'failed';
  liveBriefIds.seller = brief.id;
  judgeCases.push({
    id: report.id,
    answer: body.answer,
    facts: {
      expected_team: 'NYG',
      expected_player: 'Brian Burns',
      expected_pick_year: 2027,
      expected_pick_round: 2,
      historical_range: result?.market.range ?? null,
      cap_space_created_dollars: result?.cap.current_year_cap_space_created_dollars ?? null,
      dead_money_dollars: result?.cap.current_year_dead_money_dollars ?? null,
      interpretation_status: body.analysis_interpretation_status ?? null,
    },
  });
  assert.equal(report.status, 'passed', 'Seller interpretation scenario failed a hard assertion.');
}

async function verifyRenderedResults(): Promise<void> {
  assert(liveBriefIds.current && liveBriefIds.seller, 'Both live briefs are required for browser verification.');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const page = await context.newPage();
  try {
    await page.goto(appUrl + '?brief=' + encodeURIComponent(liveBriefIds.current), { waitUntil: 'domcontentloaded' });
    const currentCard = page.locator('[data-brief-id=\"' + liveBriefIds.current + '\"] [data-recommendation-card=\"true\"]');
    await currentCard.waitFor({ timeout: 20_000 });
    assert.match(await currentCard.innerText(), /\b(?:Giants|Nabers)\b/i);
    appendBrowserAssertion('current-followup-scope', 'current_answer_renders_in_browser');

    await page.goto(appUrl + '?brief=' + encodeURIComponent(liveBriefIds.seller), { waitUntil: 'domcontentloaded' });
    const sellerResult = page.getByTestId('nfl-seller-move-result');
    await sellerResult.waitFor({ timeout: 20_000 });
    await sellerResult.getByText(/2027 round 2 pick \(Day 2\) for Brian Burns/i).waitFor();
    appendBrowserAssertion('seller-interpretation-grounding', 'seller_answer_renders_in_browser');
  } finally {
    await context.close();
    await browser.close();
  }
}

async function runJudge(): Promise<void> {
  if (!judgeRequested) return;
  const result = await judgeNflReliabilityCases({
    apiKey: process.env.OPENAI_API_KEY,
    cases: judgeCases,
  });
  if (result.status === 'skipped_no_openai_key') {
    for (const report of cases.filter((entry) => entry.lane === 'live_current' || entry.lane === 'live_seller')) {
      report.judge = { status: 'skipped_no_openai_key' };
      if (requireJudge) {
        report.status = 'failed';
        report.assertions.push(checkValue('terra_judge_required', false, 'OPENAI_API_KEY is not configured'));
      }
    }
    return;
  }
  terraUsage = result.usage;
  for (const verdict of result.verdicts) applyJudgeVerdict(verdict);
}

async function runLiveCase(caseId: string, operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const report = cases.find((entry) => entry.id === caseId);
    if (report) {
      report.status = 'failed';
      report.assertions.push(checkValue('scenario_completed', false, safeError(error)));
      return;
    }
    cases.push({
      id: caseId,
      lane: 'system',
      status: 'failed',
      assertions: [checkValue('scenario_completed', false, safeError(error))],
    });
  }
}

function applyJudgeVerdict(verdict: NflReliabilityJudgeVerdict): void {
  const report = cases.find((entry) => entry.id === verdict.id);
  if (!report) throw new Error('Terra returned a verdict for an unknown case.');
  report.judge = {
    status: verdict.verdict === 'pass' ? 'passed' : verdict.verdict === 'fail' ? 'failed' : 'inconclusive',
    violations: verdict.violations,
  };
  if (verdict.verdict === 'fail' || (verdict.verdict === 'inconclusive' && requireJudge)) {
    report.status = 'failed';
    report.assertions.push(checkValue('terra_semantic_judgment', false, verdict.verdict));
  } else {
    report.assertions.push(checkValue('terra_semantic_judgment', true, verdict.verdict));
  }
}

async function createQaSession(db: SupabaseClient, seedKey: string, label: string): Promise<string> {
  const id = randomUUID();
  const created = await db.from('sessions').insert({
    id,
    user_id: null,
    label,
    workspace_key: 'nyg-demo',
    seed_key: seedKey,
  });
  if (created.error) throw new Error('Could not create the exact QA-owned session: ' + created.error.message);
  return id;
}

async function createAndWaitForBrief(
  db: SupabaseClient,
  sessionId: string,
  question: string,
  timeoutMs: number,
): Promise<Brief> {
  const response = await fetch(serverUrl + '/briefs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, question }),
  });
  if (!response.ok) throw new Error('POST /briefs failed with HTTP ' + response.status + '.');
  const created = await response.json() as CreateBriefResponse;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const current = await db.from('briefs').select('*').eq('id', created.brief.id).maybeSingle();
    if (current.error) throw new Error('Brief polling failed: ' + current.error.message);
    if (!current.data) throw new Error('The live brief disappeared before completion.');
    const brief = current.data as Brief;
    if (brief.status === 'ready') return brief;
    if (brief.status === 'failed' || brief.status === 'partial') {
      throw new Error('The live brief reached terminal status ' + brief.status + '.');
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('The live brief exceeded its bounded polling window.');
}

function verifyReadyDataBrief(
  brief: Brief,
  expectedTemplate: 'decision_brief' | 'data_table',
  assertions: AssertionReport[],
  prefix: string,
): void {
  record(assertions, prefix + '_status_ready', brief.status === 'ready', brief.status);
  record(assertions, prefix + '_mode_data_analyst', brief.mode === 'data_analyst', brief.mode);
  record(assertions, prefix + '_template_correct', brief.template_id === expectedTemplate, brief.template_id ?? 'missing');
  record(assertions, prefix + '_body_data_analysis', brief.body?.kind === 'data_analysis', brief.body?.kind ?? 'missing');
  record(assertions, prefix + '_progress_ready', brief.progress?.phase === 'ready', brief.progress?.phase ?? 'missing');
}

function dataBody(brief: Brief): DataAnalysisBriefBody {
  assert(brief.body?.kind === 'data_analysis', 'Expected a data-analysis answer body.');
  return brief.body;
}

async function briefSourceCount(db: SupabaseClient, briefId: string): Promise<number> {
  const result = await db.from('brief_sources').select('id', { count: 'exact', head: true }).eq('brief_id', briefId);
  if (result.error) throw new Error('Brief source count failed: ' + result.error.message);
  return result.count ?? 0;
}

async function briefSources(db: SupabaseClient, briefId: string): Promise<BriefSource[]> {
  const result = await db.from('brief_sources').select('*').eq('brief_id', briefId).order('ref_index');
  if (result.error) throw new Error('Brief source lookup failed: ' + result.error.message);
  return (result.data ?? []) as BriefSource[];
}

async function cleanupExactSession(db: SupabaseClient, seedKey: string): Promise<CleanupReport> {
  const deleted = await db.from('sessions')
    .delete()
    .eq('workspace_key', 'nyg-demo')
    .eq('seed_key', seedKey);
  if (deleted.error) {
    console.error('[qa] exact cleanup failed for ' + seedKey + ': ' + deleted.error.message);
    return { seed_key: seedKey, verified_zero_rows: false };
  }
  const remaining = await db.from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_key', 'nyg-demo')
    .eq('seed_key', seedKey);
  return {
    seed_key: seedKey,
    verified_zero_rows: !remaining.error && remaining.count === 0,
  };
}

function appendBrowserAssertion(caseId: string, name: string): void {
  const report = cases.find((entry) => entry.id === caseId);
  assert(report, 'Browser assertion case was not initialized.');
  report.assertions.push(checkValue(name, true, 'rendered'));
}

function record(assertions: AssertionReport[], name: string, passed: boolean, detail: string): void {
  assertions.push(checkValue(name, passed, detail));
}

function checkValue(name: string, passed: boolean, detail: string): AssertionReport {
  return { name, passed, detail: detail.slice(0, 180) };
}

function safeError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.replace(/\s+/g, ' ').slice(0, 240);
}

if (path.resolve(process.argv[1] ?? '') === sourceFile) {
  void main().catch((error) => {
    console.error('[qa] NFL answer reliability report failed:', safeError(error));
    process.exitCode = 1;
  });
}
