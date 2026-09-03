import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import Anthropic from '@anthropic-ai/sdk';
import { BRIEF_MODEL, createClaudeMessage } from '../claude/client.js';
import { BRIEF_SYSTEM } from '../claude/prompts.js';
import {
  DATA_ANALYST_SYSTEM,
  buildMessagesWithDataAnalystLookups,
  dataAnalysisCbaCitationSources,
  dataAnalystTracesToBriefSources,
  handleDataAnalystToolUse,
  isSubmitDataAnalysisInput,
  recommendationBriefCbaCitationSources,
  submitDataAnalysisTool,
} from '../claude/data_analyst.js';
import {
  buildDeterministicNflTransactionMarketFallback,
  buildNflTransactionMarketSystemBlock,
  deterministicMarketEventSourceRows,
  deterministicMarketSourceRows,
  evaluateNflTransactionMarketDraft,
  latestNflTransactionMarketAnalysis,
} from '../claude/nfl_transaction_market_guardrails.js';
import {
  buildFallbackBriefPresentation,
  buildBriefTemplateSystemBlock,
  buildDataAnalysisTemplateSystemBlock,
  coerceBriefPresentation,
  effectiveBriefTemplateId,
  templateSelectionForBrief,
  validatePresentationForTemplate,
} from '../claude/brief_templates.js';
import {
  buildContextGraphSystemBlock,
  contextGraphTracesToBriefSources,
} from '../claude/context_graph.js';
import {
  buildCurrentNbaEvidence,
  currentNbaEvidenceScopeForQuestion,
  currentNbaEvidenceTeamIds as resolveCurrentNbaEvidenceTeamIds,
  reserveGeneratedSourceRefs,
} from '../claude/nba_evidence.js';
import {
  buildCurrentNflEvidence,
  currentNflEvidenceScopeForQuestion,
  currentNflEvidenceTeamIds as resolveCurrentNflEvidenceTeamIds,
  defaultNflEvidenceTeamId,
  isNflTradeGoalQuestion,
} from '../claude/nfl_evidence.js';
import {
  buildNflContextComposerForDataAnalyst,
  buildNflContextComposerForEvidence,
  type ComposedNflContext,
} from '../claude/nfl_context_composer.js';
import {
  buildNflPrivateCriticRevisionBlock,
  runNflPrivateCritic,
} from '../claude/private_critic.js';
import {
  enrichSpecificMoveCandidates,
  sanitizeSubmitBriefMoveCandidates,
} from '../claude/move_candidates.js';
import { buildSubmitBriefTool } from '../claude/tools.js';
import { buildMessagesWithContextGraphLookups } from '../claude/tool_loop.js';
import { inferBriefModeFromQuestion, stripBriefModePrefix } from '@shared/briefMode';
import {
  latestSellerMoveScenarioForSession,
  nflTransactionMarketFootballRead,
  sellerMoveScenarioFromBrief,
  transactionMarketAnalysisFromBrief,
} from '@shared/nflTransactionMarket';
import {
  BRIEF_TEMPLATE_DEFINITIONS,
  briefModeForTemplate,
  parseBriefTemplateSelection,
  parseSavedBriefTemplateInput,
  templateSelectionFromBrief,
} from '@shared/briefTemplates';
import { db } from '../db/client.js';
import {
  isNflTransactionMarketQuestion,
  transactionMarketRequestFromQuestion,
} from '../nfl_transactions/question.js';
import { runNflSellerMoveConversationTurn } from '../nfl_transactions/seller_move_conversation.js';
import { classifyNflAnalysisTurn } from '../nfl_transactions/intent.js';
import { buildNflRuleAnswer } from '../nfl_rules/analysis.js';
import type {
  AddBriefShareRecipientRequest, Brief, BriefMode, BriefProgress, BriefProgressEventKind, BriefProgressPhase, BriefProgressStreamEvent, BriefShare, BriefShareLink, BriefShareLinkResponse, BriefSource,
  BriefShareRecipientResponse, BriefShareSnapshot, CreateBriefRequest, CreateBriefResponse,
  CreateSavedBriefTemplateResponse, ListBriefTemplatesResponse, RegenerateBriefRequest,
  ResolveBriefShareLinkResponse, SavedBriefTemplate, SubmitBriefInput, TeamMember, CbaArticle, DataAnalystTrace,
  DataAnalysisBriefBody, NflSellerMoveConversationArtifact, NflTransactionMarketAnalysis, SubmitDataAnalysisInput,
} from '@shared/types';

export const briefRoutes = new Hono();
const DEFAULT_SHARE_TEAM_ID = 'GSW';
const BRIEF_GENERATION_HEARTBEAT_MS = 60_000;
export const BRIEF_GENERATION_DEADLINE_MS = 14_000;
const MAX_BRIEF_PROGRESS_EVENTS = 12;
type DataAnalysisLookup = { messages: Anthropic.MessageParam[]; traces: DataAnalystTrace[] };
export type BriefGenerationGuard = { isActive: () => boolean };
const ALWAYS_ACTIVE_GENERATION: BriefGenerationGuard = { isActive: () => true };
const activeBriefGenerations = new Map<string, symbol>();

export function beginBriefGeneration(briefId: string): BriefGenerationGuard & { stop: () => void } {
  const token = Symbol(briefId);
  activeBriefGenerations.set(briefId, token);
  return {
    isActive: () => activeBriefGenerations.get(briefId) === token,
    stop: () => {
      if (activeBriefGenerations.get(briefId) === token) activeBriefGenerations.delete(briefId);
    },
  };
}

function invalidateActiveBriefGeneration(briefId: string): void {
  activeBriefGenerations.delete(briefId);
}

/**
 * POST /briefs
 *
 * Body: { session_id, question }
 *
 * 1. Insert a brief row with status='generating'.
 * 2. Return the brief id immediately so the UI can navigate.
 * 3. Asynchronously call Claude with `submit_brief` forced via tool_choice.
 *    The tool input is the brief shape; we parse and persist body + options
 *    + sources, then flip status='ready'. On error, status='failed'.
 *
 * The client polls (or subscribes via Realtime) until status flips.
 */
briefRoutes.post('/', async (c) => {
  let body: CreateBriefRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const { session_id } = body;
  if (!session_id || typeof session_id !== 'string') {
    return c.json({ error: 'session_id required' }, 400);
  }
  if (!isUuid(session_id)) {
    return c.json({ error: 'invalid_session_id' }, 400);
  }
  if (!body.question || typeof body.question !== 'string' || !body.question.trim()) {
    return c.json({ error: 'question required' }, 400);
  }
  const parsedQuestion = stripBriefModePrefix(body.question);
  const question = parsedQuestion.question;
  if (!question) {
    return c.json({ error: 'question required' }, 400);
  }
  const sessionRes = await db
    .from('sessions')
    .select('id')
    .eq('id', session_id)
    .maybeSingle();
  if (sessionRes.error) {
    return c.json({ error: 'load_session_failed', detail: sessionRes.error.message }, 500);
  }
  if (!sessionRes.data) {
    return c.json({ error: 'session_not_found' }, 404);
  }
  const contextRes = await db
    .from('briefs')
    .select('body, session_id')
    .eq('session_id', session_id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (contextRes.error) {
    return c.json({ error: 'load_analysis_context_failed', detail: 'The prior conversation could not be loaded.' }, 500);
  }
  const contextBriefs = (contextRes.data ?? []) as Array<Pick<Brief, 'body' | 'session_id'>>;
  const latestMarketAnalysis = contextBriefs
    .map((prior) => transactionMarketAnalysisFromBrief(prior))
    .find((analysis): analysis is NflTransactionMarketAnalysis => Boolean(analysis)) ?? null;
  const latestSellerMove = latestSellerMoveScenarioForSession(contextBriefs, session_id);
  const intent = classifyNflAnalysisTurn(question, {
    market_query: latestMarketAnalysis?.query ?? null,
    seller_scenario: latestSellerMove,
  });
  const preparedSellerTurn = intent.kind === 'seller_move'
    ? await runNflSellerMoveConversationTurn(question, latestMarketAnalysis, latestSellerMove).catch(() => null)
    : null;
  const preparedSellerMove = preparedSellerTurn?.artifact ?? null;
  const preparedRuleAnswer = intent.kind === 'rules'
    ? await buildNflRuleAnswer(question).catch(() => ({
      body: unavailableRuleAnswerBody(),
      sources: [],
    }))
    : null;
  const explicitMode = normalizeBriefMode(body.mode);
  const transactionMarketQuestion = intent.kind === 'transaction_market';
  const immediateClarification = intent.kind === 'seller_modifier_without_context';
  const marketContextActive = intent.kind === 'seller_move'
    || transactionMarketQuestion
    || Boolean(preparedRuleAnswer)
    || immediateClarification;
  const requestedMode = marketContextActive
    ? 'data_analyst'
    : parsedQuestion.mode ?? explicitMode ?? inferBriefModeFromQuestion(question);
  const templateParse = parseBriefTemplateSelection(body.template, body.question);
  if (templateParse.errors.length > 0) {
    return c.json({ error: 'invalid_template', detail: templateParse.errors }, 400);
  }
  const templateSelection = marketContextActive || requestedMode === 'data_analyst'
    ? { template_id: 'data_table' as const }
    : templateParse.selection;
  const mode = briefModeForTemplate(templateSelection)
    ?? requestedMode
    ?? 'brief';

  // Deterministic market, seller, and rule answers are complete before insert,
  // so the POST response itself is renderable and never waits on model prose.
  let preparedMarketBody: DataAnalysisBriefBody | null = null;
  let preparedProgress: BriefProgress | null = null;
  let preparedSources: Array<Omit<BriefSource, 'id' | 'brief_id'>> = [];
  if (intent.kind === 'seller_move' && !preparedSellerTurn) {
    preparedMarketBody = unavailableSellerAnswerBody();
    preparedProgress = readyBriefProgress('Trade check unavailable', 'The public contract or transaction source could not be loaded.');
  } else if (preparedSellerMove && preparedSellerTurn) {
    preparedMarketBody = sellerMoveArtifactBody(preparedSellerTurn.market, preparedSellerMove);
    preparedProgress = sellerMoveBriefProgress(preparedSellerMove);
    preparedSources = deterministicSellerMoveEvidenceRows(preparedSellerMove);
  } else if (immediateClarification) {
    preparedMarketBody = sellerModifierClarificationBody();
    preparedProgress = readyBriefProgress('Clarification ready', 'The proposed trade needs a player, draft year, and round.');
  } else if (preparedRuleAnswer) {
    preparedMarketBody = preparedRuleAnswer.body;
    preparedProgress = readyBriefProgress('Rule answer ready', 'The controlling public rule and exact source location are ready.');
    preparedSources = preparedRuleAnswer.sources;
  } else if (transactionMarketQuestion) {
    try {
      const preparedMarketLookup = await ensureNflTransactionMarketLookup(
        question,
        { messages: [{ role: 'user', content: question }], traces: [] },
        intent.inherited_query,
      );
      const analysis = latestNflTransactionMarketAnalysis(preparedMarketLookup.traces);
      if (!analysis) throw new Error('Required NFL transaction-market analysis was not returned.');
      preparedMarketBody = transactionMarketArtifactBody(analysis);
      preparedProgress = readyBriefProgress('Market answer ready', 'The live calculation, comparison, transactions, and sources are ready.');
      preparedSources = deterministicMarketEvidenceRows(analysis, 1);
    } catch (error) {
      return c.json({
        error: 'transaction_market_analysis_failed',
        detail: briefGenerationErrorMessage(error),
      }, 503);
    }
  }

  // Insert generating brief.
  const insert = await db
    .from('briefs')
    .insert({
      session_id,
      question,
      mode,
      template_id: templateSelection.template_id,
      template_base_id: templateSelection.base_template_id ?? null,
      custom_template_id: templateSelection.custom_template_id ?? null,
      template_instructions: templateSelection.instructions ?? null,
      thesis: preparedMarketBody?.answer ?? null,
      body: preparedMarketBody,
      progress: preparedProgress ?? initialBriefProgress(),
      status: preparedMarketBody ? 'ready' : 'generating',
    })
    .select()
    .single();

  if (insert.error || !insert.data) {
    return c.json({ error: 'persist_brief_failed', detail: insert.error?.message }, 500);
  }

  const brief = insert.data as Brief;

  // Persist direct-answer sources before returning so every visible source or
  // comparable is drillable on the same clock as the answer.
  if (preparedSources.length > 0) {
    const immediateSources = preparedSources.map((source) => ({ ...source, brief_id: brief.id }));
    try {
      await insertMissingBriefSources(brief.id, immediateSources);
    } catch (error) {
      const progress = failedBriefProgress(error);
      const detail = briefGenerationErrorMessage(error);
      await db
        .from('briefs')
        .update({ status: 'failed', error: detail, progress, updated_at: progress.updated_at })
        .eq('id', brief.id);
      return c.json({ error: 'persist_market_sources_failed', detail }, 500);
    }
  }

  // Deterministic answers are complete before this response. They do not wait
  // for or invite a model to reinterpret sourced rules, terms, or calculations.
  if (preparedMarketBody) {
    const response: CreateBriefResponse = { brief };
    return c.json(response, 201);
  }

  // Kick off generation in the background — the route returns immediately.
  // Errors are caught and persisted as `status='failed'` rather than crashing.
  void generateBriefWithDeadline(brief).catch(async (err) => {
    console.error('[briefs] generate failed', brief.id, err);
    const errorMessage = briefGenerationErrorMessage(err);
    const progress = failedBriefProgress(err);
    await db
      .from('briefs')
      .update({ status: 'failed', error: errorMessage, progress, updated_at: progress.updated_at })
      .eq('id', brief.id)
      .eq('status', 'generating');
    publishBriefProgress(briefProgressStreamPayload({
      id: brief.id,
      status: 'failed',
      error: errorMessage,
      progress,
      updated_at: progress.updated_at,
    }));
  });

  const response: CreateBriefResponse = { brief };
  return c.json(response, 201);
});

briefRoutes.get('/:id/progress-stream', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);
  if (!isUuid(id)) return c.json({ error: 'invalid_brief_id' }, 400);

  let initial: BriefProgressStreamEvent | null;
  try {
    initial = await loadBriefProgressStreamPayload(id);
  } catch (err) {
    return c.json({ error: 'load_brief_progress_failed', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
  if (!initial) return c.json({ error: 'brief_not_found' }, 404);

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let keepAlive: NodeJS.Timeout | null = null;
  let closed = false;
  let lastSentKey = '';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        if (keepAlive) clearInterval(keepAlive);
        keepAlive = null;
        try {
          controller.close();
        } catch {
          // The client already closed the EventSource.
        }
      };

      const send = (payload: BriefProgressStreamEvent) => {
        if (closed) return;
        const key = `${payload.status}:${payload.updated_at}:${payload.progress?.updated_at ?? ''}`;
        if (key === lastSentKey) return;
        lastSentKey = key;
        try {
          controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          close();
        }
      };

      unsubscribe = subscribeBriefProgress(id, (payload) => {
        send(payload);
        if (payload.status !== 'generating') close();
      });

      void loadBriefProgressStreamPayload(id)
        .then((payload) => {
          if (!payload) {
            close();
            return;
          }
          send(payload);
          if (payload.status !== 'generating') close();
        })
        .catch(() => {
          send(initial);
          if (initial.status !== 'generating') close();
        });

      keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          close();
        }
      }, 15_000);
    },
    cancel() {
      closed = true;
      unsubscribe();
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

briefRoutes.get('/templates', async (c) => {
  const saved = await db
    .from('saved_brief_templates')
    .select('*')
    .order('created_at', { ascending: false });

  if (saved.error) {
    return c.json({ error: 'load_templates_failed', detail: saved.error.message }, 500);
  }

  const response: ListBriefTemplatesResponse = {
    curated_templates: BRIEF_TEMPLATE_DEFINITIONS,
    saved_templates: (saved.data ?? []) as SavedBriefTemplate[],
  };
  return c.json(response);
});

briefRoutes.post('/templates', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const parsed = parseSavedBriefTemplateInput(body);
  if (parsed.errors.length > 0) {
    return c.json({ error: 'invalid_template', detail: parsed.errors }, 400);
  }

  const insert = await db
    .from('saved_brief_templates')
    .insert({
      name: parsed.name,
      base_template_id: parsed.base_template_id,
      instructions: parsed.instructions,
    })
    .select()
    .single();

  if (insert.error || !insert.data) {
    return c.json({ error: 'save_template_failed', detail: insert.error?.message }, 500);
  }

  const response: CreateSavedBriefTemplateResponse = { template: insert.data as SavedBriefTemplate };
  return c.json(response, 201);
});

briefRoutes.get('/share/:token', async (c) => {
  const token = c.req.param('token')?.trim();
  if (!token) return c.json({ error: 'token required' }, 400);

  const linkRes = await db
    .from('brief_share_links')
    .select('*')
    .eq('token', token)
    .is('revoked_at', null)
    .maybeSingle();

  if (linkRes.error) {
    return c.json({ error: 'resolve_share_link_failed', detail: linkRes.error.message }, 500);
  }
  if (!linkRes.data) {
    return c.json({ error: 'share_link_not_found' }, 404);
  }

  const link = linkRes.data as BriefShareLink;
  const briefRes = await db
    .from('briefs')
    .select('id, session_id')
    .eq('id', link.brief_id)
    .maybeSingle();

  if (briefRes.error) {
    return c.json({ error: 'resolve_share_link_failed', detail: briefRes.error.message }, 500);
  }
  if (!briefRes.data || typeof briefRes.data.session_id !== 'string') {
    return c.json({ error: 'brief_not_found' }, 404);
  }

  const response: ResolveBriefShareLinkResponse = {
    brief_id: link.brief_id,
    session_id: briefRes.data.session_id,
    link,
  };
  return c.json(response);
});

briefRoutes.get('/:id/share', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);
  const teamId = (c.req.query('team_id') || DEFAULT_SHARE_TEAM_ID).trim().toUpperCase();

  const briefRes = await db
    .from('briefs')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (briefRes.error) {
    return c.json({ error: 'load_share_failed', detail: briefRes.error.message }, 500);
  }
  if (!briefRes.data) return c.json({ error: 'brief_not_found' }, 404);

  const [membersRes, sharesRes, linkRes] = await Promise.all([
    db
      .from('team_members')
      .select('*')
      .eq('team_id', teamId)
      .order('name', { ascending: true }),
    db
      .from('brief_shares')
      .select('*')
      .eq('brief_id', id)
      .is('revoked_at', null)
      .order('created_at', { ascending: true }),
    db
      .from('brief_share_links')
      .select('*')
      .eq('brief_id', id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (membersRes.error) return c.json({ error: 'load_team_members_failed', detail: membersRes.error.message }, 500);
  if (sharesRes.error) return c.json({ error: 'load_brief_shares_failed', detail: sharesRes.error.message }, 500);
  if (linkRes.error) return c.json({ error: 'load_share_link_failed', detail: linkRes.error.message }, 500);

  const response: BriefShareSnapshot = {
    team_members: (membersRes.data ?? []) as TeamMember[],
    recipient_shares: (sharesRes.data ?? []) as BriefShare[],
    link: (linkRes.data as BriefShareLink | null) ?? null,
  };
  return c.json(response);
});

briefRoutes.post('/:id/share/recipients', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);

  let body: AddBriefShareRecipientRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!isRecord(body) || typeof body.team_member_id !== 'string' || !body.team_member_id.trim()) {
    return c.json({ error: 'team_member_id required' }, 400);
  }

  const memberRes = await db
    .from('team_members')
    .select('*')
    .eq('id', body.team_member_id)
    .maybeSingle();
  if (memberRes.error) return c.json({ error: 'load_team_member_failed', detail: memberRes.error.message }, 500);
  if (!memberRes.data) return c.json({ error: 'team_member_not_found' }, 404);
  const member = memberRes.data as TeamMember;

  const existingRes = await db
    .from('brief_shares')
    .select('*')
    .eq('brief_id', id)
    .eq('team_member_id', member.id)
    .is('revoked_at', null)
    .maybeSingle();
  if (existingRes.error) {
    return c.json({ error: 'load_brief_share_failed', detail: existingRes.error.message }, 500);
  }
  if (existingRes.data) {
    const response: BriefShareRecipientResponse = { share: existingRes.data as BriefShare };
    return c.json(response);
  }

  const insert = await db
    .from('brief_shares')
    .insert({
      brief_id: id,
      team_member_id: member.id,
      recipient_name: member.name,
      access_level: 'view',
    })
    .select()
    .single();

  if (insert.error || !insert.data) {
    return c.json({ error: 'create_brief_share_failed', detail: insert.error?.message }, 500);
  }

  const response: BriefShareRecipientResponse = { share: insert.data as BriefShare };
  return c.json(response, 201);
});

briefRoutes.delete('/:id/share/recipients/:shareId', async (c) => {
  const id = c.req.param('id');
  const shareId = c.req.param('shareId');
  if (!id || !shareId) return c.json({ error: 'id and shareId required' }, 400);

  const now = new Date().toISOString();
  const update = await db
    .from('brief_shares')
    .update({ revoked_at: now, updated_at: now })
    .eq('id', shareId)
    .eq('brief_id', id)
    .is('revoked_at', null)
    .select()
    .maybeSingle();

  if (update.error) {
    return c.json({ error: 'revoke_brief_share_failed', detail: update.error.message }, 500);
  }
  if (!update.data) return c.json({ error: 'brief_share_not_found' }, 404);

  const response: BriefShareRecipientResponse = { share: update.data as BriefShare };
  return c.json(response);
});

briefRoutes.post('/:id/share/link', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);

  const existing = await db
    .from('brief_share_links')
    .select('*')
    .eq('brief_id', id)
    .is('revoked_at', null)
    .maybeSingle();

  if (existing.error) {
    return c.json({ error: 'load_share_link_failed', detail: existing.error.message }, 500);
  }
  if (existing.data) {
    const response: BriefShareLinkResponse = { link: existing.data as BriefShareLink };
    return c.json(response);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const insert = await db
      .from('brief_share_links')
      .insert({
        brief_id: id,
        token: createBriefShareToken(),
        access_level: 'view',
      })
      .select()
      .single();

    if (!insert.error && insert.data) {
      const response: BriefShareLinkResponse = { link: insert.data as BriefShareLink };
      return c.json(response, 201);
    }
    if (insert.error?.message.toLowerCase().includes('duplicate')) {
      const raced = await db
        .from('brief_share_links')
        .select('*')
        .eq('brief_id', id)
        .is('revoked_at', null)
        .maybeSingle();
      if (raced.error) return c.json({ error: 'load_share_link_failed', detail: raced.error.message }, 500);
      if (raced.data) {
        const response: BriefShareLinkResponse = { link: raced.data as BriefShareLink };
        return c.json(response);
      }
      continue;
    }
    if (insert.error) {
      return c.json({ error: 'create_share_link_failed', detail: insert.error?.message }, 500);
    }
  }

  return c.json({ error: 'create_share_link_failed', detail: 'token collision retry limit exceeded' }, 500);
});

/**
 * POST /briefs/:id/regenerate
 *
 * Re-runs `generateBrief` for an existing brief: deletes the prior
 * options/sources, clears thesis/body, sets status='generating', then dispatches
 * the same Claude tool call. Chat history (chat_turns) is preserved; the
 * recommendation card just rebuilds from scratch.
 */
briefRoutes.post('/:id/regenerate', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'id required' }, 400);
  let body: RegenerateBriefRequest = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const fresh = await regenerateBriefById(id, body.template);
  if (fresh === 'invalid_template') return c.json({ error: 'invalid_template' }, 400);
  if (fresh === 'seller_move_regeneration_unsupported') {
    return c.json({ error: 'seller_move_regeneration_unsupported', detail: 'Continue the trade conversation with a new question instead.' }, 409);
  }
  if (!fresh) return c.json({ error: 'brief_not_found' }, 404);
  return c.json({ brief: fresh }, 202);
});

/**
 * Resets a brief to status='generating', wipes its options/sources, and kicks
 * off the same Claude tool call as initial creation. Used by the route handler
 * and by the monitor scheduler for `rerun` monitors. Returns the fresh row, or
 * null when the brief id doesn't exist.
 */
export async function regenerateBriefById(
  id: string,
  templateOverride?: RegenerateBriefRequest['template'],
): Promise<Brief | null | 'invalid_template' | 'seller_move_regeneration_unsupported'> {
  const briefRes = await db.from('briefs').select('*').eq('id', id).maybeSingle();
  if (briefRes.error || !briefRes.data) return null;
  const existingBrief = briefRes.data as Brief;
  if (sellerMoveScenarioFromBrief(existingBrief)) return 'seller_move_regeneration_unsupported';
  const inheritedMarketQuery = transactionMarketAnalysisFromBrief(existingBrief)?.query ?? null;
  const preservingTemplate = templateOverride === undefined;
  const templateParse = preservingTemplate
    ? { selection: templateSelectionFromBrief(existingBrief), errors: [] as string[] }
    : parseBriefTemplateSelection(templateOverride, existingBrief.question);
  if (templateParse.errors.length > 0) return 'invalid_template';
  const mode = preservingTemplate
    ? existingBrief.mode
    : (briefModeForTemplate(templateParse.selection) ?? 'brief');

  // A retry owns the brief from this point forward. Any older provider task
  // may finish, but its generation guard will prevent or roll back child rows.
  invalidateActiveBriefGeneration(id);

  // Wipe prior options/sources so the regenerated brief doesn't accumulate
  // duplicate ref_indexes; the foreign-key cascade isn't enough on its own.
  await db.from('brief_options').delete().eq('brief_id', id);
  await db.from('brief_sources').delete().eq('brief_id', id);

  const reset = await db
    .from('briefs')
    .update({
      thesis: null,
      body: null,
      mode,
      template_id: templateParse.selection.template_id,
      template_base_id: templateParse.selection.base_template_id ?? null,
      custom_template_id: templateParse.selection.custom_template_id ?? null,
      template_instructions: templateParse.selection.instructions ?? null,
      progress: initialBriefProgress('Regeneration queued'),
      status: 'generating',
      error: null,
      duration_ms: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (reset.error || !reset.data) return null;
  const fresh = reset.data as Brief;

  void generateBriefWithDeadline(fresh, inheritedMarketQuery).catch(async (err) => {
    console.error('[briefs] regenerate failed', fresh.id, err);
    const errorMessage = briefGenerationErrorMessage(err);
    const progress = failedBriefProgress(err);
    await db
      .from('briefs')
      .update({ status: 'failed', error: errorMessage, progress, updated_at: progress.updated_at })
      .eq('id', fresh.id)
      .eq('status', 'generating');
    publishBriefProgress(briefProgressStreamPayload({
      id: fresh.id,
      status: 'failed',
      error: errorMessage,
      progress,
      updated_at: progress.updated_at,
    }));
  });

  return fresh;
}

export async function generateBriefForMode(
  brief: Brief,
  inheritedMarketQuery: NflTransactionMarketAnalysis['query'] | null = null,
  preparedMarketLookup: DataAnalysisLookup | null = null,
  generation: BriefGenerationGuard = ALWAYS_ACTIVE_GENERATION,
) {
  if (brief.mode === 'data_analyst') return generateDataAnalysisBrief(brief, inheritedMarketQuery, preparedMarketLookup, generation);
  return generateBrief(brief, generation);
}

async function generateBriefWithDeadline(
  brief: Brief,
  inheritedMarketQuery: NflTransactionMarketAnalysis['query'] | null = null,
  preparedMarketLookup: DataAnalysisLookup | null = null,
): Promise<void> {
  let timer: NodeJS.Timeout | null = null;
  const generation = beginBriefGeneration(brief.id);
  try {
    await Promise.race([
      generateBriefForMode(brief, inheritedMarketQuery, preparedMarketLookup, generation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            generation.stop();
            reject(new Error('brief_generation_deadline_exceeded'));
          },
          BRIEF_GENERATION_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    generation.stop();
  }
}

export async function generateBrief(
  brief: Brief,
  generation: BriefGenerationGuard = ALWAYS_ACTIVE_GENERATION,
) {
  const startedAt = Date.now();
  const heartbeat = startBriefGenerationHeartbeat(brief);
  const progress = createBriefProgressTracker(brief, heartbeat);
  const defaultTeamId = defaultBriefTeamId();
  const nflEvidenceTeamIds = currentNflEvidenceTeamIds(brief.question, defaultTeamId);
  const nflEvidenceScope = currentNflEvidenceScopeForQuestion(brief.question);
  const nbaEvidenceTeamIds = nflEvidenceTeamIds.length > 0
    ? []
    : currentNbaEvidenceTeamIds(brief.question, null);
  const nbaEvidenceScope = currentNbaEvidenceScopeForQuestion(brief.question);
  const templateSelection = templateSelectionForBrief(brief);

  // Let Claude gather Intel tool results first, then force the final
  // structured payload through `submit_brief`. Keeping submission in its own
  // forced call avoids partial `submit_brief` payloads when multiple tools are
  // available in one turn.
  try {
    await progress.mark(
      'collecting_evidence',
      8,
      'Collecting current app evidence',
      nflEvidenceTeamIds.length
        ? `Loading ${nflEvidenceScope ?? 'transaction'} NFL evidence for ${nflEvidenceTeamIds.join(', ')}.`
        : nbaEvidenceTeamIds.length
          ? `Loading ${nbaEvidenceScope ?? 'transaction'} NBA evidence for ${nbaEvidenceTeamIds.join(', ')}.`
          : 'No current app evidence scope was detected for this prompt.',
      'data',
    );
    const currentNflEvidence = nflEvidenceTeamIds.length > 0
      ? await buildCurrentNflEvidence(brief.question, {
        teamIds: nflEvidenceTeamIds,
        scope: nflEvidenceScope ?? 'transaction_full',
      })
      : null;
    const currentNbaEvidence = !currentNflEvidence && nbaEvidenceTeamIds.length > 0
      ? await buildCurrentNbaEvidence(brief.question, {
        teamIds: nbaEvidenceTeamIds,
        scope: nbaEvidenceScope ?? 'transaction_full',
      })
      : null;
    const currentAppEvidence = currentNflEvidence ?? currentNbaEvidence;
    const composedNflContext = currentNflEvidence
      ? buildNflContextComposerForEvidence(brief.question, currentNflEvidence)
      : null;
    const runContextGraphLookup = shouldRunContextGraphLookup(brief.question, !!currentAppEvidence);
    const currentEvidenceSourceCount = currentAppEvidence?.sources.length ?? 0;
    await progress.mark(
      'context_lookup',
      currentAppEvidence ? 18 : 14,
      currentAppEvidence ? 'Current evidence loaded' : 'Checking team context',
      currentAppEvidence
        ? `${currentEvidenceSourceCount} current-data source ${currentEvidenceSourceCount === 1 ? 'ref' : 'refs'} reserved${runContextGraphLookup ? '; Intel lookup also requested.' : '; enough to cover the team context layer.'}`
        : 'Preparing Intel lookup.',
      currentAppEvidence ? 'data' : 'tool',
    );
    const contextGraphBlock = runContextGraphLookup ? await buildContextGraphSystemBlock() : null;
    const system: Anthropic.TextBlockParam[] = [
      ...(defaultTeamId ? [{ type: 'text' as const, text: buildDemoTeamPerspectiveBlock(defaultTeamId) }] : []),
      { type: 'text', text: BRIEF_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildBriefTemplateSystemBlock(templateSelection), cache_control: { type: 'ephemeral' } },
      ...(currentAppEvidence
        ? [{ type: 'text' as const, text: currentAppEvidence.systemBlock }]
        : []),
      ...(composedNflContext
        ? [{ type: 'text' as const, text: composedNflContext.system_block }]
        : []),
      ...(contextGraphBlock
        ? [{ type: 'text' as const, text: contextGraphBlock, cache_control: { type: 'ephemeral' as const } }]
        : []),
    ];
    const userMessages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildBriefUserPrompt(brief.question, defaultTeamId, templateSelection) },
    ];
    const contextGraphLookup = runContextGraphLookup
      ? await buildMessagesWithContextGraphLookups({
        model: BRIEF_MODEL,
        max_tokens: 2048,
        system,
        messages: userMessages,
      })
      : { messages: userMessages, traces: [] };
    await progress.mark(
      'drafting',
      runContextGraphLookup ? 32 : 28,
      runContextGraphLookup ? 'Intel lookup complete' : 'Team context covered by current evidence',
      runContextGraphLookup
        ? `${contextGraphLookup.traces.length} context tool ${contextGraphLookup.traces.length === 1 ? 'call' : 'calls'} completed.`
        : 'Using current app evidence in the drafting prompt; no separate Intel call needed.',
      runContextGraphLookup ? 'tool' : 'data',
    );

    await progress.mark(
      'drafting',
      40,
      'Drafting structured answer',
      'Asking the model for thesis, reasoning, options, watch-points, and source refs.',
      'model',
    );

    const response = await createClaudeMessage({
      model: BRIEF_MODEL,
      max_tokens: 16384,
      system,
      tools: [buildSubmitBriefTool(templateSelection)],
      tool_choice: { type: 'tool', name: 'submit_brief' },
      messages: contextGraphLookup.messages,
    });

    // Find the tool_use block.
    const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_brief');
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== 'submit_brief') {
      throw missingForcedToolError(response, 'submit_brief');
    }
    await progress.mark(
      'validating',
      78,
      'Structured draft received',
      'Validating required fields and answer-template shape.',
      'model',
    );

    const reservedSourceCount = currentAppEvidence?.sources.length ?? 0;
    const allowServerProvidedSources = reservedSourceCount > 0 || contextGraphLookup.traces.length > 0;
    let input = normalizeSubmitBriefInput(
      toolUse.input,
      allowServerProvidedSources,
    );

    if (!(await heartbeat.isCurrent())) return;

    const reservedSources = currentAppEvidence?.sources ?? [];
    let generatedSources = reserveGeneratedSourceRefs(
      Array.isArray(input.sources) ? input.sources : [],
      currentAppEvidence?.reserved_max_ref_index ?? 0,
    );
    let maxSourceRefIndex = [...reservedSources, ...generatedSources].reduce(
      (max, source) => Math.max(max, source.ref_index),
      0,
    );
    let contextGraphSources = currentAppEvidence
      ? []
      : contextGraphTracesToBriefSources(
        contextGraphLookup.traces,
        maxSourceRefIndex + 1,
      );
    let existingSources = [...reservedSources, ...generatedSources, ...contextGraphSources];

    // Validate the bare minimum so we fail loudly here instead of mid-render.
    // Decision briefs still require strategic option rows, but model drift
    // should get one structural repair pass before the user sees a failure.
    let missing = missingSubmitBriefFields(input, templateSelection);
    let structuralRepairAttempted = false;
    if (shouldRepairMissingSubmitBriefFields(missing, templateSelection)) {
      structuralRepairAttempted = true;
      const repaired = await repairSubmitBriefTemplate({
        originalInput: input,
        templateSelection,
        system,
        messages: contextGraphLookup.messages,
        allowServerProvidedSources,
        validationErrors: [`submit_brief input missing required fields: ${missing.join(', ')}`],
        availableSources: existingSources,
      });

      if (repaired) {
        input = repaired.input;
        generatedSources = reserveGeneratedSourceRefs(
          Array.isArray(input.sources) ? input.sources : [],
          currentAppEvidence?.reserved_max_ref_index ?? 0,
        );
        maxSourceRefIndex = [...reservedSources, ...generatedSources].reduce(
          (max, source) => Math.max(max, source.ref_index),
          0,
        );
        contextGraphSources = currentAppEvidence
          ? []
          : contextGraphTracesToBriefSources(
            contextGraphLookup.traces,
            maxSourceRefIndex + 1,
          );
        existingSources = [...reservedSources, ...generatedSources, ...contextGraphSources];
        missing = missingSubmitBriefFields(input, templateSelection);
      }
    }

    const onlyMissingTemplatePresentation = missing.length === 1 && missing[0] === 'presentation';
    if (missing.length > 0 && !onlyMissingTemplatePresentation) {
      await persistEvidenceBoundGenerationFallback({
        brief,
        heartbeat,
        generation,
        progress,
        sources: [...reservedSources, ...contextGraphSources],
        startedAt,
      });
      return;
    }

    // Persist brief body + thesis + status atomically (best-effort — Supabase
    // doesn't expose multi-table txns to the JS client; we order writes so a
    // partial failure leaves status='generating' for retry).
    let presentation = coerceBriefPresentation(input, templateSelection, existingSources);
    let presentationValidation = validatePresentationForTemplate(
      effectiveBriefTemplateId(templateSelection),
      presentation,
    );
    if (!presentationValidation.ok || onlyMissingTemplatePresentation) {
      await progress.mark(
        'repairing',
        84,
        'Repairing template structure',
        'The draft had valid substance but needed renderer-compatible structure.',
        'model',
      );
      const repaired = structuralRepairAttempted ? null : await repairSubmitBriefTemplate({
          originalInput: input,
          templateSelection,
          system,
          messages: contextGraphLookup.messages,
          allowServerProvidedSources,
          validationErrors: presentationValidation.errors.length
            ? presentationValidation.errors
            : ['selected template requires presentation.sections'],
          availableSources: existingSources,
        });
      structuralRepairAttempted = true;

      if (repaired) {
        input = repaired.input;
        generatedSources = reserveGeneratedSourceRefs(
          input.sources,
          currentAppEvidence?.reserved_max_ref_index ?? 0,
        );
        maxSourceRefIndex = [...reservedSources, ...generatedSources].reduce(
          (max, source) => Math.max(max, source.ref_index),
          0,
        );
        contextGraphSources = currentAppEvidence
          ? []
          : contextGraphTracesToBriefSources(
            contextGraphLookup.traces,
            maxSourceRefIndex + 1,
          );
        existingSources = [...reservedSources, ...generatedSources, ...contextGraphSources];
        presentation = coerceBriefPresentation(input, templateSelection, existingSources);
        presentationValidation = validatePresentationForTemplate(
          effectiveBriefTemplateId(templateSelection),
          presentation,
        );
      }

      if (!presentationValidation.ok) {
        presentation = buildFallbackBriefPresentation(input, templateSelection, existingSources);
        input = withTemplateFallbackWatch(input);
      }
    }

    await progress.mark(
      'enriching_candidates',
      86,
      'Finding named candidate moves',
      'Checking current roster, salary, and player-stat rows for specific player/team constructions.',
      'data',
    );
    const enrichedCandidates = await enrichSpecificMoveCandidates({
      input,
      existingSources,
      subjectTeamId: defaultTeamId,
    });
    input = enrichedCandidates.input;
    if (enrichedCandidates.candidatePoolSource) {
      existingSources = [...existingSources, enrichedCandidates.candidatePoolSource];
    }

    const criticResult = await maybeRunNflBriefPrivateCritic({
      brief,
      input,
      composedNflContext,
      templateSelection,
      system,
      messages: contextGraphLookup.messages,
      allowServerProvidedSources,
      availableSources: existingSources,
    });
    if (criticResult?.input) {
      const supplementalSources = enrichedCandidates.candidatePoolSource ? [enrichedCandidates.candidatePoolSource] : [];
      input = criticResult.input;
      generatedSources = reserveGeneratedSourceRefs(
        input.sources,
        currentAppEvidence?.reserved_max_ref_index ?? 0,
      );
      maxSourceRefIndex = [...reservedSources, ...generatedSources].reduce(
        (max, source) => Math.max(max, source.ref_index),
        0,
      );
      contextGraphSources = currentAppEvidence
        ? []
        : contextGraphTracesToBriefSources(
          contextGraphLookup.traces,
          maxSourceRefIndex + 1,
        );
      existingSources = [...reservedSources, ...generatedSources, ...contextGraphSources, ...supplementalSources];
      presentation = coerceBriefPresentation(input, templateSelection, existingSources);
      presentationValidation = validatePresentationForTemplate(
        effectiveBriefTemplateId(templateSelection),
        presentation,
      );
      if (!presentationValidation.ok) {
        presentation = buildFallbackBriefPresentation(input, templateSelection, existingSources);
        input = withTemplateFallbackWatch(input);
      }
    }

    const optionRows = input.options.map((o) => ({ ...o, brief_id: brief.id }));
    await progress.mark(
      'matching_sources',
      89,
      'Matching CBA/source references',
      `${optionRows.length} strategic ${optionRows.length === 1 ? 'option' : 'options'} prepared for persistence.`,
      'tool',
    );
    const maxExistingSourceRefIndex = existingSources.reduce(
      (max, source) => Math.max(max, source.ref_index),
      0,
    );
    const cbaSources = recommendationBriefCbaCitationSources(
      brief.question,
      input,
      await loadCbaArticlesForAnalysis(),
      maxExistingSourceRefIndex + 1,
      existingSources,
    );
    const sourceRows = [...existingSources, ...cbaSources].map((s) => ({ ...s, brief_id: brief.id }));
    await progress.mark(
      'saving',
      94,
      'Saving answer assets',
      `${sourceRows.length} source ${sourceRows.length === 1 ? 'card' : 'cards'} and ${optionRows.length} option ${optionRows.length === 1 ? 'row' : 'rows'} will land with the brief.`,
      'write',
    );

    if (!(await heartbeat.isCurrent()) || !generation.isActive()) return;
    const insertedOptionIds = optionRows.length > 0
      ? await insertBriefOptionsForGeneration(optionRows, generation)
      : [];
    if (!insertedOptionIds) return;
    const insertedSourceIds = sourceRows.length > 0
      ? await insertMissingBriefSources(brief.id, sourceRows, generation)
      : [];
    if (!insertedSourceIds) {
      await removeInsertedBriefRows('brief_options', insertedOptionIds);
      return;
    }
    if (!generation.isActive()) {
      await Promise.all([
        removeInsertedBriefRows('brief_options', insertedOptionIds),
        removeInsertedBriefRows('brief_sources', insertedSourceIds),
      ]);
      return;
    }

    // Conditional write: only flip to 'ready' if the brief is still in
    // 'generating' state. Guards against a slow successful generation
    // overriding a failed state already set by the stale-brief sweeper. If
    // the row's status changed under us (sweeper marked it failed, or the
    // user regenerated), we leave it alone — the user's view wins.
    const readyProgress = progress.complete();
    const updated = await db
      .from('briefs')
      .update({
        thesis: input.thesis,
        body: {
          kind: 'brief',
          reasoning: input.reasoning,
          blockquote: input.blockquote,
          watching: input.watching ?? [],
          next_questions: input.next_questions ?? [],
          presentation,
        },
        status: 'ready',
        progress: readyProgress,
        duration_ms: Date.now() - startedAt,
        updated_at: readyProgress.updated_at,
      })
      .eq('id', brief.id)
      .eq('status', 'generating')
      .eq('updated_at', heartbeat.currentUpdatedAt())
      .select('updated_at')
      .maybeSingle();
    if (updated.error) {
      await Promise.all([
        removeInsertedBriefRows('brief_options', insertedOptionIds),
        removeInsertedBriefRows('brief_sources', insertedSourceIds),
      ]);
      throw new Error(`brief update failed: ${updated.error.message}`);
    }
    if (!updated.data) {
      await Promise.all([
        removeInsertedBriefRows('brief_options', insertedOptionIds),
        removeInsertedBriefRows('brief_sources', insertedSourceIds),
      ]);
      return;
    }
    publishBriefProgress(briefProgressStreamPayload({
      id: brief.id,
      status: 'ready',
      error: null,
      progress: readyProgress,
      updated_at: (updated.data as Pick<Brief, 'updated_at'>).updated_at,
    }));
  } finally {
    heartbeat.stop();
  }
}

async function repairSubmitBriefTemplate(args: {
  originalInput: SubmitBriefInput;
  templateSelection: ReturnType<typeof templateSelectionForBrief>;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  allowServerProvidedSources: boolean;
  validationErrors: string[];
  availableSources: SubmitBriefInput['sources'];
}): Promise<{ input: SubmitBriefInput } | null> {
  try {
    const response = await createClaudeMessage({
      model: BRIEF_MODEL,
      max_tokens: 8192,
      system: [
        ...args.system,
        {
          type: 'text',
          text: [
            '=== TEMPLATE REPAIR ===',
            'The prior submit_brief payload had valid substance but invalid structure for the selected answer template.',
            `Validation errors: ${args.validationErrors.join('; ')}`,
            'Fix structure only. Preserve the thesis, reasoning, watch points, source refs, option refs, and factual claims unless they are structurally malformed.',
            'If a required compatibility field is missing, reconstruct that field from the previous payload, the user question, and available source refs. Do not introduce unsupported facts.',
            'Do not add new factual claims, new source claims, or unsupported numbers. If evidence is missing, preserve that as a missing-data caveat.',
            'Return exactly one corrected submit_brief tool call.',
            '',
            'Available source refs:',
            JSON.stringify(args.availableSources.map((source) => ({
              ref_index: source.ref_index,
              kind: source.kind,
              title: source.title,
              source: source.source,
            })).slice(0, 16)),
          ].join('\n'),
        },
      ],
      tools: [buildSubmitBriefTool(args.templateSelection, { repair: true })],
      tool_choice: { type: 'tool', name: 'submit_brief' },
      messages: [
        ...args.messages,
        {
          role: 'user',
          content: [
            'Repair this submit_brief payload for the selected template.',
            'Previous payload:',
            JSON.stringify(args.originalInput),
          ].join('\n\n'),
        },
      ],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_brief');
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== 'submit_brief') return null;
    const input = normalizeSubmitBriefInput(toolUse.input, args.allowServerProvidedSources);
    const missing = missingSubmitBriefFields(input, args.templateSelection);
    if (missing.length > 0) return null;
    const presentation = coerceBriefPresentation(input, args.templateSelection, args.availableSources);
    const validation = validatePresentationForTemplate(effectiveBriefTemplateId(args.templateSelection), presentation);
    if (!validation.ok) return null;
    return { input };
  } catch (err) {
    console.warn('[briefs] template repair failed; falling back to deterministic sections', err);
    return null;
  }
}

async function persistEvidenceBoundGenerationFallback(args: {
  brief: Brief;
  heartbeat: BriefGenerationHeartbeat;
  generation: BriefGenerationGuard;
  progress: ReturnType<typeof createBriefProgressTracker>;
  sources: Array<Omit<BriefSource, 'id' | 'brief_id'>>;
  startedAt: number;
}): Promise<void> {
  if (!(await args.heartbeat.isCurrent()) || !args.generation.isActive()) return;
  let insertedSourceIds: string[] = [];
  if (args.sources.length > 0) {
    const inserted = await insertMissingBriefSources(
      args.brief.id,
      args.sources.map((source) => ({ ...source, brief_id: args.brief.id })),
      args.generation,
    );
    if (!inserted) return;
    insertedSourceIds = inserted;
  }
  const body: DataAnalysisBriefBody = {
    kind: 'data_analysis',
    answer: 'I could not complete a source-supported answer from the available public information.',
    key_findings: [],
    tables: [],
    calculations: [],
    caveats: [
      args.sources.length > 0
        ? 'The sources that were successfully checked remain attached. No unsupported conclusion has been filled in.'
        : 'No usable public source was returned, so no football conclusion is being inferred.',
    ],
    followups: [],
  };
  const readyProgress = args.progress.complete(
    'Source-limited answer ready',
    'The supported source material is preserved without filling in missing claims.',
  );
  if (!args.generation.isActive()) {
    await removeInsertedBriefRows('brief_sources', insertedSourceIds);
    return;
  }
  const updated = await db
    .from('briefs')
    .update({
      mode: 'data_analyst',
      thesis: body.answer,
      body,
      status: 'ready',
      progress: readyProgress,
      duration_ms: Date.now() - args.startedAt,
      updated_at: readyProgress.updated_at,
    })
    .eq('id', args.brief.id)
    .eq('status', 'generating')
    .eq('updated_at', args.heartbeat.currentUpdatedAt())
    .select('updated_at')
    .maybeSingle();
  if (updated.error) {
    await removeInsertedBriefRows('brief_sources', insertedSourceIds);
    throw new Error(`brief fallback update failed: ${updated.error.message}`);
  }
  if (!updated.data) {
    await removeInsertedBriefRows('brief_sources', insertedSourceIds);
    return;
  }
  publishBriefProgress(briefProgressStreamPayload({
    id: args.brief.id,
    status: 'ready',
    error: null,
    progress: readyProgress,
    updated_at: (updated.data as Pick<Brief, 'updated_at'>).updated_at,
    body,
  }));
}

async function maybeRunNflBriefPrivateCritic(args: {
  brief: Brief;
  input: SubmitBriefInput;
  composedNflContext: ComposedNflContext | null;
  templateSelection: ReturnType<typeof templateSelectionForBrief>;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  allowServerProvidedSources: boolean;
  availableSources: SubmitBriefInput['sources'];
}): Promise<{ input: SubmitBriefInput } | null> {
  if (!args.composedNflContext) return null;
  try {
    const critique = await runNflPrivateCritic({
      question: args.brief.question,
      composedContext: args.composedNflContext,
      draftKind: 'brief',
      draft: args.input,
    });
    if (critique.verdict !== 'revise') return null;

    const response = await createClaudeMessage({
      model: BRIEF_MODEL,
      max_tokens: 8192,
      system: [
        ...args.system,
        { type: 'text', text: buildNflPrivateCriticRevisionBlock(critique) },
      ],
      tools: [buildSubmitBriefTool(args.templateSelection, { repair: true })],
      tool_choice: { type: 'tool', name: 'submit_brief' },
      messages: [
        ...args.messages,
        {
          role: 'user',
          content: [
            'Revise this submit_brief payload using the private critic instructions.',
            'Return exactly one corrected submit_brief tool call.',
            'Previous payload:',
            JSON.stringify(args.input),
          ].join('\n\n'),
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use' && block.name === 'submit_brief');
    if (!toolUse || toolUse.type !== 'tool_use') return null;
    const input = normalizeSubmitBriefInput(toolUse.input, args.allowServerProvidedSources);
    const missing = missingSubmitBriefFields(input, args.templateSelection);
    if (missing.length > 0) return null;
    const presentation = coerceBriefPresentation(input, args.templateSelection, args.availableSources);
    const validation = validatePresentationForTemplate(effectiveBriefTemplateId(args.templateSelection), presentation);
    if (!validation.ok) return null;
    return { input };
  } catch (error) {
    if (process.env.NFL_PRIVATE_CRITIC_STRICT === '1') throw error;
    console.warn('[briefs] NFL private critic failed open for brief', args.brief.id, error);
    return null;
  }
}

async function maybeRunNflDataAnalysisPrivateCritic(args: {
  brief: Brief;
  input: SubmitDataAnalysisInput;
  composedNflContext: ComposedNflContext | null;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  transactionMarketAnalysis: NflTransactionMarketAnalysis | null;
}): Promise<{ input: SubmitDataAnalysisInput } | null> {
  if (!args.composedNflContext && !args.transactionMarketAnalysis) return null;
  try {
    const critique = await runNflPrivateCritic({
      question: args.brief.question,
      composedContext: args.composedNflContext,
      draftKind: 'data_analysis',
      draft: args.input,
      transactionMarketAnalysis: args.transactionMarketAnalysis,
    });
    if (critique.verdict !== 'revise') return null;

    const response = await createClaudeMessage({
      model: BRIEF_MODEL,
      max_tokens: 8192,
      system: [
        ...args.system,
        { type: 'text', text: buildNflPrivateCriticRevisionBlock(critique) },
      ],
      tools: [submitDataAnalysisTool],
      tool_choice: { type: 'tool', name: 'submit_data_analysis' },
      messages: [
        ...args.messages,
        {
          role: 'user',
          content: [
            'Revise this submit_data_analysis payload using the private critic instructions.',
            'Return exactly one corrected submit_data_analysis tool call.',
            'Previous payload:',
            JSON.stringify(args.input),
          ].join('\n\n'),
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === 'tool_use' && block.name === 'submit_data_analysis');
    if (!toolUse || toolUse.type !== 'tool_use') return null;
    const input = normalizeSubmitDataAnalysisInput(toolUse.input);
    if (!input) {
      return args.transactionMarketAnalysis
        ? { input: buildDeterministicNflTransactionMarketFallback(args.transactionMarketAnalysis) }
        : null;
    }
    if (args.transactionMarketAnalysis) {
      const validation = evaluateNflTransactionMarketDraft(input, args.transactionMarketAnalysis);
      if (!validation.ok) return { input: buildDeterministicNflTransactionMarketFallback(args.transactionMarketAnalysis) };
    }
    return { input };
  } catch (error) {
    if (args.transactionMarketAnalysis) {
      console.warn('[briefs] transaction-market critic failed closed with deterministic fallback', args.brief.id, error);
      return { input: buildDeterministicNflTransactionMarketFallback(args.transactionMarketAnalysis) };
    }
    if (process.env.NFL_PRIVATE_CRITIC_STRICT === '1') throw error;
    console.warn('[briefs] NFL private critic failed open for data analysis', args.brief.id, error);
    return null;
  }
}

export async function generateDataAnalysisBrief(
  brief: Brief,
  inheritedMarketQuery: NflTransactionMarketAnalysis['query'] | null = null,
  preparedMarketLookup: DataAnalysisLookup | null = null,
  generation: BriefGenerationGuard = ALWAYS_ACTIVE_GENERATION,
) {
  const startedAt = Date.now();
  const heartbeat = startBriefGenerationHeartbeat(brief);
  const progress = createBriefProgressTracker(brief, heartbeat);
  const templateSelection = templateSelectionForBrief(brief);
  try {
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: DATA_ANALYST_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildDataAnalysisTemplateSystemBlock(templateSelection), cache_control: { type: 'ephemeral' } },
    ];

    const baseMessages: Anthropic.MessageParam[] = [{ role: 'user', content: brief.question }];
    const needsTransactionMarket = isNflTransactionMarketQuestion(brief.question) || Boolean(inheritedMarketQuery);
    if (!preparedMarketLookup) {
      await progress.mark(
        'collecting_evidence',
        12,
        'Querying app data',
        'Running bounded roster, cap, stats, context, or CBA lookups before answering.',
        'data',
      );
    }
    let dataLookup: DataAnalysisLookup;
    if (needsTransactionMarket) {
      dataLookup = preparedMarketLookup ?? await ensureNflTransactionMarketLookup(
          brief.question,
          { messages: baseMessages, traces: [] },
          inheritedMarketQuery,
        );
      const immediateMarketAnalysis = latestNflTransactionMarketAnalysis(dataLookup.traces);
      if (!immediateMarketAnalysis) {
        throw new Error('Required NFL transaction-market analysis was not returned.');
      }
      if (!preparedMarketLookup) {
        const artifactProgress = await progress.mark(
          'drafting',
          36,
          'Market calculation ready',
          'Rendering the executed scope, series, comparables, methodology, and limitations while the interpretation is drafted.',
          'data',
        );
        const provisionalBody = transactionMarketArtifactBody(immediateMarketAnalysis);
        const persisted = await heartbeat.update({ body: provisionalBody });
        if (!persisted) return;
        const sourcesPersisted = await insertMissingBriefSources(
          brief.id,
          deterministicMarketEvidenceRows(immediateMarketAnalysis, 1)
            .map((source) => ({ ...source, brief_id: brief.id })),
          generation,
        );
        if (!sourcesPersisted) return;
        publishBriefProgress(briefProgressStreamPayload({
          id: brief.id,
          status: 'generating',
          error: null,
          progress: artifactProgress,
          updated_at: heartbeat.currentUpdatedAt(),
          body: provisionalBody,
        }));
      }

      const supplementalLookup = await buildMessagesWithDataAnalystLookups({
        model: BRIEF_MODEL,
        max_tokens: 8192,
        system,
        messages: dataLookup.messages,
      }, {
        excludeToolNames: ['analyze_nfl_transaction_market', 'query_nfl_transaction_comparables'],
      });
      dataLookup = {
        messages: supplementalLookup.messages,
        traces: [...dataLookup.traces, ...supplementalLookup.traces],
      };
    } else {
      dataLookup = await buildMessagesWithDataAnalystLookups({
        model: BRIEF_MODEL,
        max_tokens: 8192,
        system,
        messages: baseMessages,
      });
    }
    dataLookup = await ensureNflRosterCapDataLookup(brief.question, dataLookup);
    const transactionMarketAnalysis = latestNflTransactionMarketAnalysis(dataLookup.traces);
    const composedNflContext = buildNflContextComposerForDataAnalyst(brief.question, dataLookup.traces, dataLookup.messages);
    const finalSystem = [
      ...system,
      ...(composedNflContext ? [{ type: 'text' as const, text: composedNflContext.system_block }] : []),
      ...(transactionMarketAnalysis ? [{ type: 'text' as const, text: buildNflTransactionMarketSystemBlock(transactionMarketAnalysis) }] : []),
    ];
    if (dataLookup.traces.length === 0) {
      throw new Error('Data analyst generation did not call an app-data tool.');
    }
    await progress.mark(
      'drafting',
      40,
      'Data lookups complete',
      `${dataLookup.traces.length} app-data ${dataLookup.traces.length === 1 ? 'tool call' : 'tool calls'} completed; drafting the analysis.`,
      'tool',
    );

    const response = await createClaudeMessage({
      model: BRIEF_MODEL,
      max_tokens: 16384,
      system: finalSystem,
      tools: [submitDataAnalysisTool],
      tool_choice: { type: 'tool', name: 'submit_data_analysis' },
      messages: dataLookup.messages,
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use' && b.name === 'submit_data_analysis');
    if (!toolUse || toolUse.type !== 'tool_use' || toolUse.name !== 'submit_data_analysis') {
      throw missingForcedToolError(response, 'submit_data_analysis');
    }
    await progress.mark(
      'validating',
      78,
      'Structured analysis received',
      'Validating findings, tables, calculations, caveats, and follow-ups.',
      'model',
    );

    const normalizedInput = normalizeSubmitDataAnalysisInput(toolUse.input);
    if (!normalizedInput) {
      throw new Error('submit_data_analysis input missing required fields');
    }

    let input = normalizedInput;
    const criticResult = await maybeRunNflDataAnalysisPrivateCritic({
      brief,
      input,
      composedNflContext,
      system: finalSystem,
      messages: dataLookup.messages,
      transactionMarketAnalysis,
    });
    if (criticResult?.input) {
      input = criticResult.input;
    }
    if (transactionMarketAnalysis) {
      const validation = evaluateNflTransactionMarketDraft(input, transactionMarketAnalysis);
      if (!validation.ok) input = buildDeterministicNflTransactionMarketFallback(transactionMarketAnalysis);
      input = bindMarketSourceReferences(input, deterministicMarketEvidenceRows(transactionMarketAnalysis, 1));
    }
    await progress.mark(
      'matching_sources',
      88,
      'Matching source references',
      `${input.sources.length} model-provided source ${input.sources.length === 1 ? 'card' : 'cards'} plus app-data traces are being prepared.`,
      'tool',
    );
    const maxSourceRefIndex = input.sources.reduce((max, source) => Math.max(max, source.ref_index), 0);
    const traceSources = dataAnalystTracesToBriefSources(dataLookup.traces, maxSourceRefIndex + 1)
      .filter((source) => !transactionMarketAnalysis
        || (!source.title.startsWith('Source snapshot ·')
          && !source.title.startsWith('Transaction ·')
          && source.title !== 'App data · NFL historical transaction market'));
    const existingSources = [...input.sources, ...traceSources];
    const maxExistingSourceRefIndex = existingSources.reduce((max, source) => Math.max(max, source.ref_index), 0);
    const cbaSources = dataAnalysisCbaCitationSources(
      brief.question,
      input,
      await loadCbaArticlesForAnalysis(),
      maxExistingSourceRefIndex + 1,
      existingSources,
    );
    const sourcesToInsert = [...existingSources, ...cbaSources];
    const sourceRows = sourcesToInsert.map((s) => ({ ...s, brief_id: brief.id }));
    await progress.mark(
      'saving',
      94,
      'Saving data answer',
      `${sourceRows.length} source ${sourceRows.length === 1 ? 'card' : 'cards'} will land with the answer.`,
      'write',
    );

    // The channel can be removed while the optional interpretation is still
    // running (for example after an isolated headless rehearsal). Do not
    // write child evidence after its brief has gone away.
    if (!(await heartbeat.isCurrent()) || !generation.isActive()) return;
    const insertedSourceIds = sourceRows.length > 0
      ? await insertMissingBriefSources(brief.id, sourceRows, generation)
      : [];
    if (!insertedSourceIds) return;
    if (!generation.isActive()) {
      await removeInsertedBriefRows('brief_sources', insertedSourceIds);
      return;
    }

    const readyProgress = progress.complete('Analysis ready', 'Findings, tables, calculations, and source cards are ready.');
    const updated = await db
      .from('briefs')
      .update({
        thesis: input.answer,
        body: {
          kind: 'data_analysis',
          answer: input.answer,
          key_findings: input.key_findings,
          tables: input.tables,
          calculations: input.calculations,
          caveats: input.caveats,
          followups: input.followups,
          ...(transactionMarketAnalysis ? { market_analysis: transactionMarketAnalysis } : {}),
        },
        status: 'ready',
        progress: readyProgress,
        duration_ms: Date.now() - startedAt,
        updated_at: readyProgress.updated_at,
      })
      .eq('id', brief.id)
      .eq('status', 'generating')
      .eq('updated_at', heartbeat.currentUpdatedAt())
      .select('updated_at')
      .maybeSingle();
    if (updated.error) {
      await removeInsertedBriefRows('brief_sources', insertedSourceIds);
      throw new Error(`brief update failed: ${updated.error.message}`);
    }
    if (!updated.data) {
      await removeInsertedBriefRows('brief_sources', insertedSourceIds);
      return;
    }
    publishBriefProgress(briefProgressStreamPayload({
      id: brief.id,
      status: 'ready',
      error: null,
      progress: readyProgress,
      updated_at: (updated.data as Pick<Brief, 'updated_at'>).updated_at,
    }));
  } finally {
    heartbeat.stop();
  }
}

export async function ensureNflTransactionMarketLookup(
  question: string,
  lookup: { messages: Anthropic.MessageParam[]; traces: DataAnalystTrace[] },
  inherited: NflTransactionMarketAnalysis['query'] | null = null,
): Promise<{ messages: Anthropic.MessageParam[]; traces: DataAnalystTrace[] }> {
  if (!isNflTransactionMarketQuestion(question) && !inherited) return lookup;
  const request = transactionMarketRequestFromQuestion(question, inherited);
  const toolName = request.analysis_mode === 'comparables' || request.analysis_mode === 'recent_influence'
    ? 'query_nfl_transaction_comparables'
    : 'analyze_nfl_transaction_market';
  const toolUseId = `server_required_nfl_transaction_market_${randomBytes(6).toString('hex')}`;
  const result = await handleDataAnalystToolUse(toolName, request);
  if (!result.ok || !result.market_analysis) {
    throw new Error(result.errors.map((error) => `${error.scope}: ${error.error}`).join('; ') || 'NFL transaction-market analysis unavailable.');
  }
  const trace: DataAnalystTrace = {
    tool_use_id: toolUseId,
    tool_name: toolName,
    input: request as unknown as Record<string, unknown>,
    datasets: result.datasets,
    errors: result.errors,
    market_analysis: result.market_analysis,
  };
  return {
    messages: [
      ...lookup.messages,
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolUseId, name: toolName, input: request }] as Anthropic.ContentBlockParam[],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(result) }],
      },
    ],
    traces: [...lookup.traces, trace],
  };
}

export function transactionMarketArtifactBody(
  analysis: NflTransactionMarketAnalysis,
): DataAnalysisBriefBody {
  const read = Array.isArray(analysis.position_trends)
    ? nflTransactionMarketFootballRead(analysis)
    : {
      conclusion: 'The live market calculation is ready.',
      implication: 'For New York: review the executed position scope and supporting transactions before setting a trade posture.',
    };
  return {
    kind: 'data_analysis',
    answer: `${read.conclusion} ${read.implication}`,
    key_findings: [],
    tables: [],
    calculations: [],
    caveats: [],
    followups: [],
    market_analysis: analysis,
  };
}

function sellerModifierClarificationBody(): DataAnalysisBriefBody {
  return {
    kind: 'data_analysis',
    answer: 'I do not have an active proposed trade in this conversation. Name the Giants player, draft year, and round you want to test.',
    key_findings: [],
    tables: [],
    calculations: [],
    caveats: [],
    followups: [],
  };
}

function unavailableRuleAnswerBody(): DataAnalysisBriefBody {
  return {
    kind: 'data_analysis',
    answer: 'The public NFL rule source could not be loaded right now.',
    key_findings: [],
    tables: [],
    calculations: [],
    caveats: ['No rule or cap conclusion is being inferred. Try again after the rule source is available.'],
    followups: [],
  };
}

function unavailableSellerAnswerBody(): DataAnalysisBriefBody {
  return {
    kind: 'data_analysis',
    answer: 'I could not calculate that proposed trade because the current public contract or transaction source is unavailable.',
    key_findings: [],
    tables: [],
    calculations: [],
    caveats: ['No cap figure, market range, or depth conclusion is being inferred. Try again after the public data is available.'],
    followups: [],
  };
}

export function sellerMoveArtifactBody(
  market: NflTransactionMarketAnalysis,
  artifact: NflSellerMoveConversationArtifact,
): DataAnalysisBriefBody {
  const result = artifact.result;
  const comparableRefs = result?.comparables.map((_, index) => index + 3) ?? [];
  const answer = result
    ? `${result.player.player_name}: New York would receive ${result.proposal.label}. ${result.market.range_label}. The trade creates ${formatSellerMoveDollars(result.cap.current_year_cap_space_created_dollars)} of ${result.cap.current_year} cap space and leaves ${formatSellerMoveDollars(result.cap.current_year_dead_money_dollars)} in dead money.`
    : artifact.message ?? 'This trade cannot be calculated from the available public data.';
  return {
    kind: 'data_analysis',
    answer,
    key_findings: result ? [
      {
        label: 'Historical return',
        body: `${result.market.range_label}; ${result.market.sample_size} usable trades in the comparison.`,
        source_refs: comparableRefs,
      },
      {
        label: 'Cap consequence',
        body: `${formatSellerMoveDollars(result.cap.current_year_cap_space_created_dollars)} of current-year cap space and ${formatSellerMoveDollars(result.cap.current_year_dead_money_dollars)} of dead money.`,
        source_refs: [1],
      },
      {
        label: 'Depth consequence',
        body: `${result.depth.label}. ${result.depth.basis}`,
        source_refs: [2],
      },
    ] : [],
    tables: [],
    calculations: result ? [{
      label: `${result.cap.current_year} cap space created`,
      formula: result.cap.calculation,
      value: formatSellerMoveDollars(result.cap.current_year_cap_space_created_dollars),
      source_refs: [1],
    }] : [],
    caveats: result?.limitations ?? [],
    followups: result ? [
      `Make it a ${result.proposal.pick_round === 1 ? 'second' : 'first'}.`,
      `Use ${result.proposal.pick_year === result.cap.current_year + 1 ? result.cap.current_year + 2 : result.cap.current_year + 1}.`,
      'Show me the trades behind that.',
    ] : [],
    market_analysis: market,
    seller_move_analysis: artifact,
  };
}

export function deterministicSellerMoveEvidenceRows(
  artifact: NflSellerMoveConversationArtifact,
): Array<Omit<BriefSource, 'id' | 'brief_id'>> {
  const result = artifact.result;
  if (!result) return [];
  const contract: Omit<BriefSource, 'id' | 'brief_id'> = {
    ref_index: 1,
    kind: 'CONTRACT',
    source: 'OverTheCap',
    title: `Contract · ${result.player.player_name}`,
    updated_at: result.player.contract_as_of_date,
    data: {
      source_url: result.cap.contract_source_url,
      rows: [
        { k: 'Player', v: result.player.player_name },
        { k: 'As of', v: result.player.contract_as_of_date },
        { k: 'Current cap charge', v: formatSellerMoveDollars(result.cap.current_cap_number_dollars) },
        { k: 'Cap space created', v: formatSellerMoveDollars(result.cap.current_year_cap_space_created_dollars) },
        { k: 'Dead money', v: formatSellerMoveDollars(result.cap.current_year_dead_money_dollars) },
        { k: 'Accounting timing', v: result.cap.accounting_timing },
        { k: 'Used in this answer', v: 'Current-year cap and dead-money calculation' },
      ],
      seller_move_contract: true,
      player_id: result.player.player_id,
    },
  };
  const role: Omit<BriefSource, 'id' | 'brief_id'> = {
    ref_index: 2,
    kind: 'ANALYST_DATA',
    source: 'NFLVERSE',
    title: `Current role · ${result.player.player_name}`,
    updated_at: result.player.contract_as_of_date,
    data: {
      ...(result.depth.source_url ? { source_url: result.depth.source_url } : {}),
      rows: [
        { k: 'Player', v: result.player.player_name },
        { k: 'Position group', v: result.player.position_group },
        { k: 'Depth consequence', v: result.depth.label },
        { k: 'Basis', v: result.depth.basis },
        { k: 'Used in this answer', v: 'Current role and depth consequence' },
      ],
      seller_move_role: true,
      player_id: result.player.player_id,
    },
  };
  const comparables = result.comparables.map((row, index): Omit<BriefSource, 'id' | 'brief_id'> => ({
    ref_index: index + 3,
    kind: 'ANALYST_DATA',
    source: 'NFL_TRANSACTION_MARKET',
    title: `Transaction · ${row.player_name}`,
    updated_at: row.event_date ?? String(row.event_year),
    data: {
      source_url: row.source_url,
      rows: [
        { k: 'Date', v: row.event_date ?? String(row.event_year) },
        { k: 'Player', v: row.player_name },
        { k: 'Position', v: row.position_group },
        { k: 'Teams', v: `${row.from_team_id} → ${row.to_team_id}` },
        { k: 'Compensation', v: row.compensation_summary },
        { k: 'Compared with proposal', v: row.comparison_to_proposal },
        { k: 'Used in this answer', v: 'Historical seller-return comparison' },
      ],
      transaction: { event_id: row.event_id },
      seller_move_comparable: true,
    },
  }));
  return [contract, role, ...comparables];
}

function formatSellerMoveDollars(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function deterministicMarketEvidenceRows(
  analysis: NflTransactionMarketAnalysis,
  startRefIndex: number,
) {
  const snapshots = deterministicMarketSourceRows(analysis, startRefIndex);
  return [
    ...snapshots,
    ...deterministicMarketEventSourceRows(analysis, startRefIndex + snapshots.length),
  ];
}

async function insertMissingBriefSources(
  briefId: string,
  rows: Array<Omit<BriefSource, 'id'>>,
  generation: BriefGenerationGuard = ALWAYS_ACTIVE_GENERATION,
): Promise<string[] | null> {
  if (rows.length === 0) return [];
  if (!generation.isActive()) return null;
  const existing = await db.from('brief_sources').select('ref_index').eq('brief_id', briefId);
  if (existing.error) throw new Error(`brief_sources lookup failed: ${existing.error.message}`);
  if (!generation.isActive()) return null;
  const existingRefs = new Set((existing.data ?? []).map((row) => Number(row.ref_index)));
  const missing = rows.filter((row) => !existingRefs.has(row.ref_index));
  if (missing.length === 0) return [];
  const inserted = await db.from('brief_sources').insert(missing).select('id');
  if (inserted.error) {
    // A workspace may be deleted after the last heartbeat check but before
    // this child insert. Confirm that narrow race before treating the foreign
    // key failure as a real persistence error.
    if (inserted.error.code === '23503') {
      const parent = await db.from('briefs').select('id').eq('id', briefId).maybeSingle();
      if (!parent.error && !parent.data) return [];
    }
    throw new Error(`brief_sources insert failed: ${inserted.error.message}`);
  }
  const insertedIds = (inserted.data ?? []).map((row) => String(row.id));
  if (!generation.isActive()) {
    await removeInsertedBriefRows('brief_sources', insertedIds);
    return null;
  }
  return insertedIds;
}

async function insertBriefOptionsForGeneration(
  rows: Array<Record<string, unknown>>,
  generation: BriefGenerationGuard,
): Promise<string[] | null> {
  if (rows.length === 0) return [];
  if (!generation.isActive()) return null;
  const inserted = await db.from('brief_options').insert(rows).select('id');
  if (inserted.error) throw new Error(`brief_options insert failed: ${inserted.error.message}`);
  const insertedIds = (inserted.data ?? []).map((row) => String(row.id));
  if (!generation.isActive()) {
    await removeInsertedBriefRows('brief_options', insertedIds);
    return null;
  }
  return insertedIds;
}

async function removeInsertedBriefRows(
  table: 'brief_options' | 'brief_sources',
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const removed = await db.from(table).delete().in('id', ids);
  if (removed.error) throw new Error(`${table} stale-generation cleanup failed: ${removed.error.message}`);
}

function bindMarketSourceReferences(
  input: SubmitDataAnalysisInput,
  sources: SubmitDataAnalysisInput['sources'],
): SubmitDataAnalysisInput {
  const refs = sources.map((source) => source.ref_index);
  const fallbackRef = refs[0] ?? 1;
  const bind = (values: number[]) => values.filter((value) => refs.includes(value)).length
    ? values.filter((value) => refs.includes(value))
    : [fallbackRef];
  return {
    ...input,
    sources,
    key_findings: input.key_findings.map((item) => ({ ...item, source_refs: bind(item.source_refs) })),
    tables: input.tables.map((item) => ({ ...item, source_refs: bind(item.source_refs) })),
    calculations: input.calculations.map((item) => ({ ...item, source_refs: bind(item.source_refs) })),
  };
}

async function ensureNflRosterCapDataLookup(
  question: string,
  lookup: { messages: Anthropic.MessageParam[]; traces: DataAnalystTrace[] },
): Promise<{ messages: Anthropic.MessageParam[]; traces: DataAnalystTrace[] }> {
  if (!requiresNflRosterCapDataLookup(question)) return lookup;
  const teamIds = currentNflEvidenceTeamIds(question, defaultBriefTeamId());
  if (teamIds.length === 0) return lookup;
  const needsTradeScreen = isNflTradeGoalQuestion(question);
  if (
    hasRequiredNflRosterCapTrace(lookup.traces, teamIds)
    && hasNflCoverageTrace(lookup.traces, teamIds)
    && (!needsTradeScreen || (
      hasNflTradeScreenTrace(lookup.traces, teamIds[0])
      && hasNflTradeIntelTrace(lookup.traces, teamIds[0])
    ))
  ) {
    return lookup;
  }

  const repairLookups = await Promise.all(teamIds.map(async (teamId, index) => {
    const toolUseId = `server_required_nfl_roster_cap_${randomBytes(6).toString('hex')}`;
    const includeTradeScreen = needsTradeScreen && index === 0;
    const input = {
      team_ids: [teamId],
      datasets: ['rosters', 'cap_sheets', 'player_metrics', 'coverage', ...(index === 0 ? ['rules'] : []), ...(includeTradeScreen ? ['trade_screen'] : [])],
      limit: 100,
      ...(includeTradeScreen ? { trade_goal: question } : {}),
    };
    const result = await handleDataAnalystToolUse('query_nfl_data', input);
    const trace: DataAnalystTrace = {
      tool_use_id: toolUseId,
      tool_name: 'query_nfl_data',
      datasets: result.datasets,
      errors: result.errors,
    };
    return { toolUseId, input, result, trace };
  }));
  const repairTraces = repairLookups.map((item) => item.trace);

  if (!hasRequiredNflRosterCapTrace(repairTraces, teamIds)) {
    throw new Error('NFL roster/cap data analyst generation did not load nfl_rosters_current and nfl_cap_sheets_current.');
  }
  if (!hasNflCoverageTrace(repairTraces, teamIds)) {
    throw new Error('NFL roster/cap data analyst generation did not load nfl_coverage_current.');
  }
  if (needsTradeScreen && !hasNflTradeScreenTrace(repairTraces, teamIds[0])) {
    throw new Error('NFL trade-goal data analyst generation did not load nfl_trade_screen_current.');
  }
  if (needsTradeScreen && !hasNflTradeIntelTrace(repairTraces, teamIds[0])) {
    throw new Error('NFL trade-goal data analyst generation did not load nfl_context_graph trade Intel.');
  }

  return {
    messages: [
      ...lookup.messages,
      ...repairLookups.flatMap(({ toolUseId, input, result }) => [
        {
          role: 'assistant' as const,
          content: [{
            type: 'tool_use',
            id: toolUseId,
            name: 'query_nfl_data',
            input,
          }] as Anthropic.ContentBlockParam[],
        },
        {
          role: 'user' as const,
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: JSON.stringify(result),
            is_error: !result.ok,
          }] as Anthropic.ContentBlockParam[],
        },
      ]),
    ],
    traces: [...lookup.traces, ...repairTraces],
  };
}

export function requiresNflRosterCapDataLookup(question: string): boolean {
  return currentNflEvidenceScopeForQuestion(question) === 'transaction_full'
    && currentNflEvidenceTeamIds(question, defaultBriefTeamId()).length > 0;
}

export function hasRequiredNflRosterCapTrace(
  traces: DataAnalystTrace[],
  requiredTeamIds: string[] = [],
): boolean {
  return datasetCoversRequiredNflTeams(traces, 'nfl_rosters_current', requiredTeamIds)
    && datasetCoversRequiredNflTeams(traces, 'nfl_cap_sheets_current', requiredTeamIds);
}

export function hasNflTradeScreenTrace(
  traces: DataAnalystTrace[],
  requiredTeamId: string | null = null,
): boolean {
  return traces.some((trace) => {
    if (trace.errors.length > 0) return false;
    return trace.datasets.some((dataset) => (
      dataset.dataset_id === 'nfl_trade_screen_current'
      && dataset.row_count > 0
      && (!requiredTeamId || dataset.team_ids.includes(requiredTeamId))
    ));
  });
}

export function hasNflCounterpartyIntelTrace(
  traces: DataAnalystTrace[],
  requiredSubjectTeamId: string | null = null,
): boolean {
  return hasNflTradeIntelTrace(traces, requiredSubjectTeamId, 2);
}

export function hasNflTradeIntelTrace(
  traces: DataAnalystTrace[],
  requiredSubjectTeamId: string | null = null,
  minimumRowCount = 1,
): boolean {
  return traces.some((trace) => {
    if (trace.errors.length > 0) return false;
    return trace.datasets.some((dataset) => (
      dataset.dataset_id === 'nfl_context_graph'
      && dataset.row_count >= minimumRowCount
      && (!requiredSubjectTeamId || dataset.team_ids.includes(requiredSubjectTeamId))
    ));
  });
}

export function hasNflCoverageTrace(
  traces: DataAnalystTrace[],
  requiredTeamIds: string[] = [],
): boolean {
  const cleanDatasets = traces
    .filter((trace) => trace.errors.length === 0)
    .flatMap((trace) => trace.datasets)
    .filter((dataset) => dataset.dataset_id === 'nfl_coverage_current' && dataset.row_count > 0);
  if (requiredTeamIds.length === 0) return cleanDatasets.length > 0;

  const covered = new Set<string>();
  for (const dataset of cleanDatasets) {
    for (const teamId of requiredTeamIds) {
      if (dataset.team_ids.includes(teamId)) covered.add(teamId);
    }
  }
  return requiredTeamIds.every((teamId) => covered.has(teamId));
}

function datasetCoversRequiredNflTeams(
  traces: DataAnalystTrace[],
  datasetId: 'nfl_rosters_current' | 'nfl_cap_sheets_current',
  requiredTeamIds: string[],
): boolean {
  const cleanDatasets = traces
    .filter((trace) => trace.errors.length === 0)
    .flatMap((trace) => trace.datasets)
    .filter((dataset) => dataset.dataset_id === datasetId && dataset.row_count > 0);
  if (requiredTeamIds.length === 0) return cleanDatasets.length > 0;

  const covered = new Set<string>();
  for (const dataset of cleanDatasets) {
    const matchedTeamIds = requiredTeamIds.filter((teamId) => dataset.team_ids.includes(teamId));
    if (matchedTeamIds.length === 0) continue;
    const minimumRows = matchedTeamIds.length * 70;
    if (dataset.row_count < minimumRows) continue;
    for (const teamId of matchedTeamIds) covered.add(teamId);
  }
  return requiredTeamIds.every((teamId) => covered.has(teamId));
}

function normalizeBriefMode(mode: unknown): BriefMode | null {
  return mode === 'data_analyst' || mode === 'brief' ? mode : null;
}

export function defaultBriefTeamId(): string | null {
  return defaultNflEvidenceTeamId();
}

export function currentNbaEvidenceTeamIds(question: string, defaultTeamId: string | null = null): string[] {
  return resolveCurrentNbaEvidenceTeamIds(question, defaultTeamId);
}

export function currentNflEvidenceTeamIds(question: string, defaultTeamId = defaultBriefTeamId()): string[] {
  return resolveCurrentNflEvidenceTeamIds(question, defaultTeamId);
}

async function loadCbaArticlesForAnalysis(): Promise<CbaArticle[]> {
  const { data, error } = await db
    .from('cba_articles')
    .select('*')
    .order('id', { ascending: true });
  if (error) {
    console.warn('[briefs] load CBA articles failed', error);
    return [];
  }
  return (data ?? []) as CbaArticle[];
}

const CONTEXT_GRAPH_LOOKUP_RE =
  /\b(intel|context graph|onboarding|team preference|team preferences|private memory|team memory|working style|trust boundar(?:y|ies)|override|overrides)\b/i;

export function shouldRunContextGraphLookup(question: string, hasCurrentNbaEvidence = false): boolean {
  if (!hasCurrentNbaEvidence) return true;
  return CONTEXT_GRAPH_LOOKUP_RE.test(question);
}

export function buildDemoTeamPerspectiveBlock(teamId: string): string {
  return [
    '=== ACTIVE DEMO TEAM POV ===',
    `The current product tenant is ${teamId}. Treat first-person phrases like "we", "our", and "us" as the ${teamId} front office unless the user explicitly names a different subject front office.`,
    `For first-person roster, cap, contract, trade, extension, or free-agency questions, include ${teamId} app/context evidence before submitting the final brief. If counterparties are named, include them as counterparties rather than replacing ${teamId}.`,
    'If current app/context evidence is present below, it satisfies the context lookup requirement for the final submit_brief step. Do not return an empty tool input to request more context.',
  ].join('\n');
}

export function buildBriefUserPrompt(
  question: string,
  defaultTeamId: string | null,
  templateSelection: ReturnType<typeof templateSelectionForBrief> = { template_id: 'decision_brief' },
): string {
  if (!defaultTeamId || !isFirstPersonTeamQuestion(question)) return question;
  const templateId = effectiveBriefTemplateId(templateSelection);
  const submitInstruction = templateId === 'decision_brief'
    ? 'Return a complete submit_brief payload now: thesis, reasoning, watching, 3-5 options, and sources. Do not omit options; every decision_brief must include the Strategic options rows even when the recommendation is obvious. If reserved app/context source refs already cover the evidence, sources may be an empty array.'
    : 'Return a complete submit_brief payload now: thesis, reasoning, watching, sources, and the selected template presentation. Include options only if useful for downstream compatibility. If reserved app/context source refs already cover the evidence, sources may be an empty array.';
  return [
    `Subject team: ${defaultTeamId}.`,
    'Interpret first-person language in the question as coming from this front office.',
    '',
    `Question: ${question}`,
    '',
    submitInstruction,
  ].join('\n');
}

export function normalizeSubmitBriefInput(input: unknown, allowServerProvidedSources = false): SubmitBriefInput {
  const record = isRecord(input) ? { ...input } : {};
  if (!Array.isArray(record.sources) && allowServerProvidedSources) {
    record.sources = [];
  }
  if (!Array.isArray(record.watching)) {
    record.watching = [];
  }
  if (!Array.isArray(record.options)) {
    record.options = [];
  }
  return sanitizeSubmitBriefMoveCandidates(record as unknown as SubmitBriefInput);
}

export function normalizeSubmitDataAnalysisInput(input: unknown): SubmitDataAnalysisInput | null {
  if (isSubmitDataAnalysisInput(input)) return input;
  if (!isRecord(input)) return null;

  const answer = stringValue(input.answer)
    ?? stringValue(input.thesis)
    ?? stringValue(input.summary)
    ?? stringValue(input.recommendation);
  if (!answer) return null;

  return {
    answer,
    key_findings: normalizeDataAnalysisFindings(input.key_findings ?? input.findings, answer),
    tables: normalizeDataAnalysisTables(input.tables),
    calculations: normalizeDataAnalysisCalculations(input.calculations),
    sources: normalizeDataAnalysisSources(input.sources),
    caveats: normalizeStringArray(input.caveats, [
      'Player availability and counterparty willingness still require direct club validation before execution.',
    ]),
    followups: normalizeStringArray(input.followups ?? input.follow_ups, []),
  };
}

function normalizeDataAnalysisFindings(value: unknown, answer: string): SubmitDataAnalysisInput['key_findings'] {
  if (!Array.isArray(value)) {
    return [{ label: 'Current read', body: answer, source_refs: [1] }];
  }
  const findings = value
    .filter(isRecord)
    .map((item) => ({
      label: stringValue(item.label) ?? stringValue(item.title) ?? 'Current read',
      body: stringValue(item.body) ?? stringValue(item.text) ?? stringValue(item.finding) ?? '',
      source_refs: normalizeSourceRefs(item.source_refs),
    }))
    .filter((item) => item.body.length > 0);
  return findings.length ? findings : [{ label: 'Current read', body: answer, source_refs: [1] }];
}

function normalizeDataAnalysisTables(value: unknown): SubmitDataAnalysisInput['tables'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      title: stringValue(item.title) ?? 'Data table',
      columns: normalizeStringArray(item.columns, []),
      rows: Array.isArray(item.rows) ? item.rows.filter(Array.isArray).slice(0, 12) as (string | number | null)[][] : [],
      source_refs: normalizeSourceRefs(item.source_refs),
    }))
    .filter((item) => item.columns.length > 0);
}

function normalizeDataAnalysisCalculations(value: unknown): SubmitDataAnalysisInput['calculations'] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((item) => ({
      label: stringValue(item.label) ?? 'Calculation',
      formula: stringValue(item.formula),
      value: stringValue(item.value) ?? '',
      source_refs: normalizeSourceRefs(item.source_refs),
    }))
    .filter((item) => item.value.length > 0);
}

function normalizeDataAnalysisSources(value: unknown): SubmitDataAnalysisInput['sources'] {
  if (!Array.isArray(value)) return [];
  const sources: SubmitDataAnalysisInput['sources'] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const refIndex = numberValue(item.ref_index);
    const title = stringValue(item.title);
    if (!refIndex || !title) continue;
    sources.push({
      ref_index: refIndex,
      kind: stringValue(item.kind) ?? 'ANALYST_DATA',
      source: stringValue(item.source) ?? null,
      title,
      updated_at: stringValue(item.updated_at) ?? null,
      data: isRecord(item.data) ? item.data : null,
    });
  }
  return sources;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return strings.length ? strings : fallback;
}

function normalizeSourceRefs(value: unknown): number[] {
  if (!Array.isArray(value)) return [1];
  const refs = value.filter((item): item is number => Number.isInteger(item) && item > 0).slice(0, 8);
  return refs.length ? refs : [1];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function missingSubmitBriefFields(
  input: SubmitBriefInput,
  templateSelection: ReturnType<typeof templateSelectionForBrief> = { template_id: 'decision_brief' },
): string[] {
  const missing: string[] = [];
  const templateId = effectiveBriefTemplateId(templateSelection);
  if (!input.thesis) missing.push('thesis');
  if (!input.reasoning) missing.push('reasoning');
  if (templateId === 'decision_brief' && (!Array.isArray(input.options) || input.options.length < 3)) {
    missing.push('options');
  }
  if (templateId !== 'decision_brief' && templateId !== 'data_table' && !input.presentation) {
    missing.push('presentation');
  }
  if (!Array.isArray(input.sources)) missing.push('sources');
  return missing;
}

export function shouldRepairMissingSubmitBriefFields(
  missing: string[],
  templateSelection: ReturnType<typeof templateSelectionForBrief> = { template_id: 'decision_brief' },
): boolean {
  void templateSelection;
  return missing.length > 0;
}

function withTemplateFallbackWatch(input: SubmitBriefInput): SubmitBriefInput {
  const watching = Array.isArray(input.watching) ? [...input.watching] : [];
  const fallbackNote = {
    tag: 'Format',
    body: 'Template sections were normalized into the closest valid format because the generated structure drifted.',
  };
  const withoutPriorFormat = watching.filter((item) => item.tag?.toLowerCase() !== 'format');
  return {
    ...input,
    watching: [...withoutPriorFormat.slice(0, 3), fallbackNote],
  };
}

export function briefGenerationErrorMessage(error: unknown): string {
  const providerMessage = providerErrorMessage(error);
  const raw = `${providerMessage ?? ''} ${error instanceof Error ? error.message : String(error)}`;
  if (/brief_generation_deadline_exceeded/i.test(raw)) {
    return 'This answer took too long to finish. Your question is saved; try again or ask it more narrowly.';
  }
  if (/credit balance|overloaded|rate limit|service unavailable|connection|fetch failed/i.test(raw)) {
    return 'Live interpretation is unavailable right now. Your question is saved; try again in a moment.';
  }
  if (/transaction.market|snapshot|roster|contract|source|dataset/i.test(raw)) {
    return 'The required public data could not be loaded. Your question is saved; check the data status and try again.';
  }
  return 'The answer could not be completed from the available sources. Your question is saved; try again.';
}

export function createBriefShareToken(random: (size: number) => Buffer = randomBytes): string {
  return `gbs_${random(18).toString('base64url')}`;
}

function missingForcedToolError(response: Anthropic.Message, toolName: string): Error {
  if (response.stop_reason === 'refusal') {
    return new Error(
      `Claude refused to complete the required ${toolName} submission after fallback. Regenerate or rephrase the brief prompt.`,
    );
  }
  return new Error(
    `Claude did not call ${toolName} (stop_reason=${response.stop_reason}, blocks=${response.content.map((b) => b.type).join(',')})`,
  );
}

function providerErrorMessage(error: unknown): string | null {
  if (isRecord(error)) {
    const nested = error.error;
    if (isRecord(nested)) {
      const nestedError = nested.error;
      if (isRecord(nestedError) && typeof nestedError.message === 'string') return nestedError.message;
      if (typeof nested.message === 'string') return nested.message;
    }
  }

  const raw = error instanceof Error ? error.message : String(error);
  const jsonStart = raw.indexOf('{');
  if (jsonStart < 0) return null;
  try {
    const parsed = JSON.parse(raw.slice(jsonStart));
    if (!isRecord(parsed)) return null;
    const nested = parsed.error;
    if (isRecord(nested)) {
      const nestedError = nested.error;
      if (isRecord(nestedError) && typeof nestedError.message === 'string') return nestedError.message;
      if (typeof nested.message === 'string') return nested.message;
    }
  } catch {
    return null;
  }
  return null;
}

function isFirstPersonTeamQuestion(question: string): boolean {
  return /\b(we|our|ours|us)\b/i.test(question);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type BriefProgressListener = (payload: BriefProgressStreamEvent) => void;

const briefProgressListeners = new Map<string, Set<BriefProgressListener>>();

export function briefProgressStreamPayload(
  brief: Pick<Brief, 'id' | 'status' | 'progress' | 'error' | 'updated_at'> & Partial<Pick<Brief, 'body'>>,
): BriefProgressStreamEvent {
  return {
    brief_id: brief.id,
    status: brief.status,
    progress: brief.progress,
    updated_at: brief.updated_at,
    error: brief.error ?? null,
    ...(brief.body !== undefined ? { body: brief.body } : {}),
  };
}

async function loadBriefProgressStreamPayload(briefId: string): Promise<BriefProgressStreamEvent | null> {
  const res = await db
    .from('briefs')
    .select('id, status, progress, error, updated_at, body')
    .eq('id', briefId)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) return null;
  return briefProgressStreamPayload(res.data as Pick<Brief, 'id' | 'status' | 'progress' | 'error' | 'updated_at' | 'body'>);
}

function subscribeBriefProgress(briefId: string, listener: BriefProgressListener): () => void {
  const listeners = briefProgressListeners.get(briefId) ?? new Set<BriefProgressListener>();
  listeners.add(listener);
  briefProgressListeners.set(briefId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) briefProgressListeners.delete(briefId);
  };
}

function publishBriefProgress(payload: BriefProgressStreamEvent): void {
  const listeners = briefProgressListeners.get(payload.brief_id);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    listener(payload);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampProgressPct(pct: number): number {
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function briefProgressSnapshot(args: {
  phase: BriefProgressPhase;
  pct: number;
  label: string;
  detail?: string | null;
  kind: BriefProgressEventKind;
  priorEvents?: BriefProgress['events'];
  at?: string;
}): BriefProgress {
  const at = args.at ?? nowIso();
  const event = {
    at,
    phase: args.phase,
    pct: clampProgressPct(args.pct),
    label: args.label,
    detail: args.detail ?? null,
    kind: args.kind,
  };
  const events = [...(args.priorEvents ?? []), event].slice(-MAX_BRIEF_PROGRESS_EVENTS);
  return {
    phase: event.phase,
    pct: event.pct,
    label: event.label,
    detail: event.detail,
    updated_at: at,
    events,
  };
}

function initialBriefProgress(label = 'Brief queued'): BriefProgress {
  return briefProgressSnapshot({
    phase: 'queued',
    pct: 3,
    label,
    detail: 'Waiting for the analyst job to start.',
    kind: 'stage',
  });
}

export function marketArtifactBriefProgress(): BriefProgress {
  return briefProgressSnapshot({
    phase: 'ready',
    pct: 100,
    label: 'Market answer ready',
    detail: 'The live calculation, comparison, transactions, and sources are ready.',
    kind: 'data',
  });
}

function readyBriefProgress(label: string, detail: string): BriefProgress {
  return briefProgressSnapshot({
    phase: 'ready',
    pct: 100,
    label,
    detail,
    kind: 'data',
  });
}

function sellerMoveBriefProgress(artifact: NflSellerMoveConversationArtifact): BriefProgress {
  return briefProgressSnapshot({
    phase: 'ready',
    pct: 100,
    label: artifact.status === 'answered' ? 'Trade check ready' : 'Answer ready',
    detail: artifact.status === 'answered'
      ? 'The proposed return, historical trades, contract figures, and depth consequence are ready.'
      : artifact.message,
    kind: 'data',
  });
}

function failedBriefProgress(error: unknown): BriefProgress {
  return briefProgressSnapshot({
    phase: 'failed',
    pct: 100,
    label: 'Generation failed',
    detail: briefGenerationErrorMessage(error),
    kind: 'error',
  });
}

function createBriefProgressTracker(brief: Brief, heartbeat: BriefGenerationHeartbeat) {
  let current = brief.progress ?? initialBriefProgress();

  const mark = async (
    phase: BriefProgressPhase,
    pct: number,
    label: string,
    detail: string | null,
    kind: BriefProgressEventKind,
  ): Promise<BriefProgress> => {
    current = briefProgressSnapshot({
      phase,
      pct,
      label,
      detail,
      kind,
      priorEvents: current.events,
    });
    const persisted = await heartbeat.update({ progress: current });
    if (persisted) {
      publishBriefProgress(briefProgressStreamPayload({
        id: brief.id,
        status: 'generating',
        error: null,
        progress: current,
        updated_at: heartbeat.currentUpdatedAt(),
      }));
    }
    return current;
  };

  return {
    mark,
    snapshot: () => current,
    complete: (label = 'Brief ready', detail = 'Sources, options, and watch-points are ready.') => {
      current = briefProgressSnapshot({
        phase: 'ready',
        pct: 100,
        label,
        detail,
        kind: 'stage',
        priorEvents: current.events,
      });
      return current;
    },
  };
}

type BriefGenerationHeartbeat = {
  currentUpdatedAt: () => string;
  isCurrent: () => Promise<boolean>;
  update: (patch?: Record<string, unknown>) => Promise<boolean>;
  stop: () => void;
};

function startBriefGenerationHeartbeat(brief: Brief): BriefGenerationHeartbeat {
  let expectedUpdatedAt = brief.updated_at;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const update = async (patch: Record<string, unknown> = {}): Promise<boolean> => {
    if (stopped) return false;
    const nextUpdatedAt = nowIso();
    const res = await db
      .from('briefs')
      .update({ ...patch, updated_at: nextUpdatedAt })
      .eq('id', brief.id)
      .eq('status', 'generating')
      .eq('updated_at', expectedUpdatedAt)
      .select('updated_at')
      .maybeSingle();

    if (res.error) {
      console.warn('[briefs] generation heartbeat failed', brief.id, res.error);
      return false;
    }
    if (!res.data) return false;
    expectedUpdatedAt = (res.data as Pick<Brief, 'updated_at'>).updated_at;
    return true;
  };

  timer = setInterval(() => {
    void update().then((ok) => {
      if (!ok && timer) {
        clearInterval(timer);
        timer = null;
      }
    });
  }, BRIEF_GENERATION_HEARTBEAT_MS);

  return {
    currentUpdatedAt: () => expectedUpdatedAt,
    update,
    isCurrent: async () => {
      const res = await db
        .from('briefs')
        .select('status, updated_at')
        .eq('id', brief.id)
        .maybeSingle();
      if (res.error || !res.data) return false;
      const row = res.data as Pick<Brief, 'status' | 'updated_at'>;
      return row.status === 'generating' && row.updated_at === expectedUpdatedAt;
    },
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
