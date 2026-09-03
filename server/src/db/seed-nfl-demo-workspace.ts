import { db } from './client.js';
import type { NflTransactionMarketAnalysis } from '@shared/types';
import {
  buildDeterministicNflTransactionMarketFallback,
  deterministicMarketEventSourceRows,
  deterministicMarketSourceRows,
} from '../claude/nfl_transaction_market_guardrails.js';
import { analyzeNflTransactionMarket } from '../nfl_transactions/analyze.js';
import { transactionMarketRequestFromQuestion } from '../nfl_transactions/question.js';
import { loadCurrentNflTransactionMarketSnapshot } from '../nfl_transactions/seed.js';
import {
  assertNygSeedOwnership,
  NYG_DEMO_WORKSPACE_KEY,
  NYG_HERO_PROJECT,
  NYG_HERO_SEED_KEY,
  NYG_HERO_SESSION_ID,
  NYG_STAGE_NOTES,
  NYG_TASKS,
  NYG_TRANSACTION_PRESENTER_BRIEF_IDS,
  NYG_TRANSACTION_PRESENTER_QUESTIONS,
  NYG_TRANSACTION_PRESENTER_SEED_KEY,
  NYG_TRANSACTION_PRESENTER_SESSION_ID,
} from '../nfl_workspace/seed.js';

export async function seedNygDemoWorkspace(now = new Date().toISOString()): Promise<void> {
  assertNygSeedOwnership();
  await checked(db.from('sessions').upsert({
    id: NYG_HERO_SESSION_ID,
    user_id: null,
    label: NYG_HERO_PROJECT.title,
    workspace_key: NYG_DEMO_WORKSPACE_KEY,
    seed_key: NYG_HERO_SEED_KEY,
    // The cap model remains available from Analysis, but it is not a second
    // presenter channel. Keep the owned support session out of the Analysis
    // channel rail so the transaction-market result opens cleanly.
    archived_at: now,
    updated_at: now,
  }, { onConflict: 'id' }), 'upsert Giants demo session');

  await seedTransactionMarketPresenter(now);

  await checked(db.from('projects').upsert({
    ...NYG_HERO_PROJECT,
    user_id: null,
    workspace_key: NYG_DEMO_WORKSPACE_KEY,
    seed_key: NYG_HERO_SEED_KEY,
    archived_at: null,
    updated_at: now,
  }, { onConflict: 'id' }), 'upsert Giants demo project');

  await checked(db.from('project_stage_notes').upsert(NYG_STAGE_NOTES.map((note) => ({
    ...note,
    project_id: NYG_HERO_PROJECT.id,
    citation_refs: [],
    updated_at: now,
  })), { onConflict: 'id' }), 'upsert Giants demo stage notes');

  await checked(db.from('project_tasks').upsert(NYG_TASKS.map((task) => ({
    id: task.id,
    project_id: NYG_HERO_PROJECT.id,
    step: task.step,
    label: task.label,
    required: task.required,
    completed_at: task.completed ? now : null,
    sort_order: task.sort_order,
    source: 'system',
    updated_at: now,
  })), { onConflict: 'id' }), 'upsert Giants demo tasks');
}

async function seedTransactionMarketPresenter(now: string): Promise<void> {
  const snapshot = await loadCurrentNflTransactionMarketSnapshot();
  const analyses: NflTransactionMarketAnalysis[] = [];
  let inheritedQuery: NflTransactionMarketAnalysis['query'] | null = null;
  for (const question of NYG_TRANSACTION_PRESENTER_QUESTIONS) {
    const request = transactionMarketRequestFromQuestion(question, inheritedQuery);
    const analysis = await analyzeNflTransactionMarket(request, { snapshot });
    analyses.push(analysis);
    inheritedQuery = analysis.query;
  }

  await checked(db.from('sessions').upsert({
    id: NYG_TRANSACTION_PRESENTER_SESSION_ID,
    user_id: null,
    label: NYG_TRANSACTION_PRESENTER_QUESTIONS[0],
    workspace_key: NYG_DEMO_WORKSPACE_KEY,
    seed_key: NYG_TRANSACTION_PRESENTER_SEED_KEY,
    archived_at: null,
    updated_at: now,
  }, { onConflict: 'id' }), 'upsert transaction-market presenter session');

  const briefRows = analyses.map((analysis, index) => {
    const fallback = buildDeterministicNflTransactionMarketFallback(analysis);
    const createdAt = new Date(Date.parse(now) - ((analyses.length - index - 1) * 1_000)).toISOString();
    return {
      id: NYG_TRANSACTION_PRESENTER_BRIEF_IDS[index],
      session_id: NYG_TRANSACTION_PRESENTER_SESSION_ID,
      question: NYG_TRANSACTION_PRESENTER_QUESTIONS[index],
      thesis: fallback.answer,
      body: {
        kind: 'data_analysis' as const,
        answer: fallback.answer,
        key_findings: fallback.key_findings,
        tables: fallback.tables,
        calculations: fallback.calculations,
        caveats: fallback.caveats,
        followups: fallback.followups,
        market_analysis: analysis,
      },
      mode: 'data_analyst',
      template_id: 'data_table',
      template_base_id: null,
      custom_template_id: null,
      template_instructions: null,
      progress: {
        phase: 'ready',
        pct: 100,
        label: 'Analysis ready',
        detail: 'Deterministic transaction-market calculation and governed presenter interpretation are ready.',
        updated_at: now,
        events: [],
      },
      status: 'ready',
      error: null,
      duration_ms: 0,
      created_at: createdAt,
      updated_at: now,
    };
  });
  await checked(db.from('briefs').upsert(briefRows, { onConflict: 'id' }), 'upsert transaction-market presenter briefs');

  await checked(
    db.from('brief_sources').delete().in('brief_id', [...NYG_TRANSACTION_PRESENTER_BRIEF_IDS]),
    'clear owned transaction-market presenter sources',
  );
  const sourceRows = analyses.flatMap((analysis, briefIndex) => {
    const snapshotRows = deterministicMarketSourceRows(analysis, 1);
    const eventRows = deterministicMarketEventSourceRows(analysis, snapshotRows.length + 1);
    return [...snapshotRows, ...eventRows].map((source, sourceIndex) => ({
      ...source,
      id: presenterSourceId(briefIndex, sourceIndex),
      brief_id: NYG_TRANSACTION_PRESENTER_BRIEF_IDS[briefIndex],
    }));
  });
  await checked(db.from('brief_sources').upsert(sourceRows, { onConflict: 'id' }), 'upsert transaction-market presenter sources');
}

function presenterSourceId(briefIndex: number, sourceIndex: number): string {
  const suffix = String(((briefIndex + 1) * 100) + sourceIndex + 1).padStart(12, '0');
  return `79000000-0000-4000-8000-${suffix}`;
}

async function checked(query: PromiseLike<{ error: { message: string } | null }>, label: string): Promise<void> {
  const result = await query;
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedNygDemoWorkspace()
    .then(() => console.log('Seeded owned nyg-demo workspace without touching legacy or user-created rows.'))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
