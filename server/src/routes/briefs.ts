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
  isSubmitDataAnalysisInput,
  recommendationBriefCbaCitationSources,
  submitDataAnalysisTool,
} from '../claude/data_analyst.js';
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
  defaultNbaEvidenceTeamId,
  reserveGeneratedSourceRefs,
} from '../claude/nba_evidence.js';
import {
  enrichSpecificMoveCandidates,
  sanitizeSubmitBriefMoveCandidates,
} from '../claude/move_candidates.js';
import { buildSubmitBriefTool } from '../claude/tools.js';
import { buildMessagesWithContextGraphLookups } from '../claude/tool_loop.js';
import { stripBriefModePrefix } from '@shared/briefMode';
import {
  BRIEF_TEMPLATE_DEFINITIONS,
  briefModeForTemplate,
  parseBriefTemplateSelection,
  parseSavedBriefTemplateInput,
  templateSelectionFromBrief,
} from '@shared/briefTemplates';
import { db } from '../db/client.js';
import type {
  AddBriefShareRecipientRequest, Brief, BriefMode, BriefProgress, BriefProgressEventKind, BriefProgressPhase, BriefProgressStreamEvent, BriefShare, BriefShareLink, BriefShareLinkResponse,
  BriefShareRecipientResponse, BriefShareSnapshot, CreateBriefRequest, CreateBriefResponse,
  CreateSavedBriefTemplateResponse, ListBriefTemplatesResponse, RegenerateBriefRequest,
  ResolveBriefShareLinkResponse, SavedBriefTemplate, SubmitBriefInput, TeamMember, CbaArticle,
} from '@shared/types';

export const briefRoutes = new Hono();
const DEFAULT_SHARE_TEAM_ID = 'GSW';
const BRIEF_GENERATION_HEARTBEAT_MS = 60_000;
const MAX_BRIEF_PROGRESS_EVENTS = 12;

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
  if (!body.question || typeof body.question !== 'string' || !body.question.trim()) {
    return c.json({ error: 'question required' }, 400);
  }
  const parsedQuestion = stripBriefModePrefix(body.question);
  const question = parsedQuestion.question;
  if (!question) {
    return c.json({ error: 'question required' }, 400);
  }
  const explicitMode = normalizeBriefMode(body.mode);
  const requestedMode = explicitMode ?? parsedQuestion.mode;
  const templateParse = parseBriefTemplateSelection(body.template, body.question);
  if (templateParse.errors.length > 0) {
    return c.json({ error: 'invalid_template', detail: templateParse.errors }, 400);
  }
  const templateSelection = body.template == null && requestedMode === 'data_analyst'
    ? { template_id: 'data_table' as const }
    : templateParse.selection;
  const mode = briefModeForTemplate(templateSelection)
    ?? requestedMode
    ?? 'brief';

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
      progress: initialBriefProgress(),
      status: 'generating',
    })
    .select()
    .single();

  if (insert.error || !insert.data) {
    return c.json({ error: 'persist_brief_failed', detail: insert.error?.message }, 500);
  }

  const brief = insert.data as Brief;

  // Kick off generation in the background — the route returns immediately.
  // Errors are caught and persisted as `status='failed'` rather than crashing.
  void generateBriefForMode(brief).catch(async (err) => {
    console.error('[briefs] generate failed', brief.id, err);
    const errorMessage = briefGenerationErrorMessage(err);
    const progress = failedBriefProgress(err);
    await db
      .from('briefs')
      .update({ status: 'failed', error: errorMessage, progress, updated_at: progress.updated_at })
      .eq('id', brief.id);
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
): Promise<Brief | null | 'invalid_template'> {
  const briefRes = await db.from('briefs').select('*').eq('id', id).maybeSingle();
  if (briefRes.error || !briefRes.data) return null;
  const existingBrief = briefRes.data as Brief;
  const preservingTemplate = templateOverride === undefined;
  const templateParse = preservingTemplate
    ? { selection: templateSelectionFromBrief(existingBrief), errors: [] as string[] }
    : parseBriefTemplateSelection(templateOverride, existingBrief.question);
  if (templateParse.errors.length > 0) return 'invalid_template';
  const mode = preservingTemplate
    ? existingBrief.mode
    : (briefModeForTemplate(templateParse.selection) ?? 'brief');

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

  void generateBriefForMode(fresh).catch(async (err) => {
    console.error('[briefs] regenerate failed', fresh.id, err);
    const errorMessage = briefGenerationErrorMessage(err);
    const progress = failedBriefProgress(err);
    await db
      .from('briefs')
      .update({ status: 'failed', error: errorMessage, progress, updated_at: progress.updated_at })
      .eq('id', fresh.id);
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

export async function generateBriefForMode(brief: Brief) {
  if (brief.mode === 'data_analyst') return generateDataAnalysisBrief(brief);
  return generateBrief(brief);
}

export async function generateBrief(brief: Brief) {
  const startedAt = Date.now();
  const heartbeat = startBriefGenerationHeartbeat(brief);
  const progress = createBriefProgressTracker(brief, heartbeat);
  const defaultTeamId = defaultBriefTeamId();
  const evidenceTeamIds = currentNbaEvidenceTeamIds(brief.question, defaultTeamId);
  const evidenceScope = currentNbaEvidenceScopeForQuestion(brief.question);
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
      evidenceTeamIds.length
        ? `Loading ${evidenceScope ?? 'transaction'} evidence for ${evidenceTeamIds.join(', ')}.`
        : 'No current NBA evidence scope was detected for this prompt.',
      'data',
    );
    const currentNbaEvidence = evidenceTeamIds.length > 0
      ? await buildCurrentNbaEvidence(brief.question, {
        teamIds: evidenceTeamIds,
        scope: evidenceScope ?? 'transaction_full',
      })
      : null;
    const runContextGraphLookup = shouldRunContextGraphLookup(brief.question, !!currentNbaEvidence);
    const currentEvidenceSourceCount = currentNbaEvidence?.sources.length ?? 0;
    await progress.mark(
      'context_lookup',
      currentNbaEvidence ? 18 : 14,
      currentNbaEvidence ? 'Current evidence loaded' : 'Checking team context',
      currentNbaEvidence
        ? `${currentEvidenceSourceCount} current-data source ${currentEvidenceSourceCount === 1 ? 'ref' : 'refs'} reserved${runContextGraphLookup ? '; Intel lookup also requested.' : '; enough to cover the team context layer.'}`
        : 'Preparing Intel lookup.',
      currentNbaEvidence ? 'data' : 'tool',
    );
    const contextGraphBlock = runContextGraphLookup ? await buildContextGraphSystemBlock() : null;
    const system: Anthropic.TextBlockParam[] = [
      ...(defaultTeamId ? [{ type: 'text' as const, text: buildDemoTeamPerspectiveBlock(defaultTeamId) }] : []),
      { type: 'text', text: BRIEF_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildBriefTemplateSystemBlock(templateSelection), cache_control: { type: 'ephemeral' } },
      ...(currentNbaEvidence
        ? [{ type: 'text' as const, text: currentNbaEvidence.systemBlock }]
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

    const reservedSourceCount = currentNbaEvidence?.sources.length ?? 0;
    const allowServerProvidedSources = reservedSourceCount > 0 || contextGraphLookup.traces.length > 0;
    let input = normalizeSubmitBriefInput(
      toolUse.input,
      allowServerProvidedSources,
    );

    if (!(await heartbeat.isCurrent())) return;

    const reservedSources = currentNbaEvidence?.sources ?? [];
    let generatedSources = reserveGeneratedSourceRefs(
      Array.isArray(input.sources) ? input.sources : [],
      currentNbaEvidence?.reserved_max_ref_index ?? 0,
    );
    let maxSourceRefIndex = [...reservedSources, ...generatedSources].reduce(
      (max, source) => Math.max(max, source.ref_index),
      0,
    );
    let contextGraphSources = currentNbaEvidence
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
    if (shouldRepairMissingSubmitBriefFields(missing, templateSelection)) {
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
          currentNbaEvidence?.reserved_max_ref_index ?? 0,
        );
        maxSourceRefIndex = [...reservedSources, ...generatedSources].reduce(
          (max, source) => Math.max(max, source.ref_index),
          0,
        );
        contextGraphSources = currentNbaEvidence
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
      throw new Error(`submit_brief input missing required fields: ${missing.join(', ')}`);
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
      const repaired = await repairSubmitBriefTemplate({
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

      if (repaired) {
        input = repaired.input;
        generatedSources = reserveGeneratedSourceRefs(
          input.sources,
          currentNbaEvidence?.reserved_max_ref_index ?? 0,
        );
        maxSourceRefIndex = [...reservedSources, ...generatedSources].reduce(
          (max, source) => Math.max(max, source.ref_index),
          0,
        );
        contextGraphSources = currentNbaEvidence
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

    if (optionRows.length > 0) {
      const optionsInsert = await db.from('brief_options').insert(optionRows);
      if (optionsInsert.error) throw new Error(`brief_options insert failed: ${optionsInsert.error.message}`);
    }
    if (sourceRows.length > 0) {
      const sourcesInsert = await db.from('brief_sources').insert(sourceRows);
      if (sourcesInsert.error) throw new Error(`brief_sources insert failed: ${sourcesInsert.error.message}`);
    }

    // Conditional write: only flip to 'ready' if the brief is still in
    // 'generating' state. Guards against a slow successful generation
    // overriding a failed state already set by the stale-brief sweeper. If
    // the row's status changed under us (sweeper marked it failed, or the
    // user regenerated), we leave it alone — the user's view wins. Persist
    // the options/sources rows we just wrote either way; a future regen will
    // wipe them.
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
    if (updated.error) throw new Error(`brief update failed: ${updated.error.message}`);
    if (!updated.data) return;
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

export async function generateDataAnalysisBrief(brief: Brief) {
  const startedAt = Date.now();
  const heartbeat = startBriefGenerationHeartbeat(brief);
  const progress = createBriefProgressTracker(brief, heartbeat);
  const templateSelection = templateSelectionForBrief(brief);
  try {
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: DATA_ANALYST_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: buildDataAnalysisTemplateSystemBlock(templateSelection), cache_control: { type: 'ephemeral' } },
    ];

    await progress.mark(
      'collecting_evidence',
      12,
      'Querying app data',
      'Running bounded roster, cap, stats, context, or CBA lookups before answering.',
      'data',
    );
    const dataLookup = await buildMessagesWithDataAnalystLookups({
      model: BRIEF_MODEL,
      max_tokens: 8192,
      system,
      messages: [
        { role: 'user', content: brief.question },
      ],
    });
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
      system,
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

    if (!isSubmitDataAnalysisInput(toolUse.input)) {
      throw new Error('submit_data_analysis input missing required fields');
    }

    const input = toolUse.input;
    await progress.mark(
      'matching_sources',
      88,
      'Matching source references',
      `${input.sources.length} model-provided source ${input.sources.length === 1 ? 'card' : 'cards'} plus app-data traces are being prepared.`,
      'tool',
    );
    const maxSourceRefIndex = input.sources.reduce((max, source) => Math.max(max, source.ref_index), 0);
    const traceSources = dataAnalystTracesToBriefSources(dataLookup.traces, maxSourceRefIndex + 1);
    const existingSources = [...input.sources, ...traceSources];
    const maxExistingSourceRefIndex = existingSources.reduce((max, source) => Math.max(max, source.ref_index), 0);
    const cbaSources = dataAnalysisCbaCitationSources(
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
      'Saving data answer',
      `${sourceRows.length} source ${sourceRows.length === 1 ? 'card' : 'cards'} will land with the answer.`,
      'write',
    );

    if (sourceRows.length > 0) {
      const sourcesInsert = await db.from('brief_sources').insert(sourceRows);
      if (sourcesInsert.error) throw new Error(`brief_sources insert failed: ${sourcesInsert.error.message}`);
    }

    if (!(await heartbeat.isCurrent())) return;

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
    if (updated.error) throw new Error(`brief update failed: ${updated.error.message}`);
    if (!updated.data) return;
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

function normalizeBriefMode(mode: unknown): BriefMode | null {
  return mode === 'data_analyst' || mode === 'brief' ? mode : null;
}

export function defaultBriefTeamId(): string | null {
  return defaultNbaEvidenceTeamId();
}

export function currentNbaEvidenceTeamIds(question: string, defaultTeamId = defaultBriefTeamId()): string[] {
  return resolveCurrentNbaEvidenceTeamIds(question, defaultTeamId);
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
  const templateId = effectiveBriefTemplateId(templateSelection);
  if (missing.length === 1 && missing[0] === 'options' && templateId === 'decision_brief') return true;
  return false;
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
  if (providerMessage && /credit balance is too low/i.test(providerMessage)) {
    return 'Anthropic API credit balance is too low. Add credits or switch ANTHROPIC_API_KEY, then regenerate this brief.';
  }
  if (providerMessage && /tool_choice forces tool use is not compatible/i.test(providerMessage)) {
    return 'Configured Anthropic model does not support forced tool submissions. Switch to a tool-capable brief model or fallback model, then regenerate this brief.';
  }
  if (providerMessage) return providerMessage;
  return error instanceof Error ? error.message : String(error);
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
  brief: Pick<Brief, 'id' | 'status' | 'progress' | 'error' | 'updated_at'>,
): BriefProgressStreamEvent {
  return {
    brief_id: brief.id,
    status: brief.status,
    progress: brief.progress,
    updated_at: brief.updated_at,
    error: brief.error ?? null,
  };
}

async function loadBriefProgressStreamPayload(briefId: string): Promise<BriefProgressStreamEvent | null> {
  const res = await db
    .from('briefs')
    .select('id, status, progress, error, updated_at')
    .eq('id', briefId)
    .maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) return null;
  return briefProgressStreamPayload(res.data as Pick<Brief, 'id' | 'status' | 'progress' | 'error' | 'updated_at'>);
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
