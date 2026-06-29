import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import Anthropic from '@anthropic-ai/sdk';
import { CHAT_MODEL } from '../claude/client.js';
import {
  buildContextGraphSystemBlock,
  contextGraphTracesToToolCalls,
} from '../claude/context_graph.js';
import {
  DATA_ANALYST_CHAT_SYSTEM,
  dataAnalystTracesToToolCalls,
  streamMessageWithDataAnalystTools,
} from '../claude/data_analyst.js';
import { CHAT_SYSTEM, buildBriefContext } from '../claude/prompts.js';
import { streamMessageWithGambitTools } from '../claude/tool_loop.js';
import {
  buildCurrentNbaEvidence,
  currentNbaEvidenceScopeForQuestion,
  currentNbaEvidenceTeamIds,
  currentNbaEvidenceToDataAnalystTrace,
} from '../claude/nba_evidence.js';
import {
  buildCurrentNflEvidence,
  currentNflEvidenceScopeForQuestion,
  currentNflEvidenceTeamIds,
  currentNflEvidenceToDataAnalystTrace,
  defaultNflEvidenceTeamId,
} from '../claude/nfl_evidence.js';
import { db } from '../db/client.js';
import type {
  Brief, BriefSource, BriefOption, ChatStreamEvent, ChatTurn, ContextGraphTrace, DataAnalystTrace, ToolCall,
} from '@shared/types';

export const chatRoutes = new Hono();

interface ChatRequest {
  briefId: string;
  message: string;
}

chatRoutes.post('/', async (c) => {
  let body: ChatRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const { briefId, message } = body;
  if (!briefId || typeof briefId !== 'string') {
    return c.json({ error: 'briefId required' }, 400);
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ error: 'message required' }, 400);
  }

  // Load brief + context. Bail early with HTTP error if the brief doesn't
  // exist — the client should not have called us with a bogus id.
  const briefRes = await db.from('briefs').select('*').eq('id', briefId).maybeSingle();
  if (briefRes.error || !briefRes.data) {
    return c.json({ error: 'brief_not_found', detail: briefRes.error?.message }, 404);
  }
  const brief = briefRes.data as Brief;

  const [sourcesRes, optionsRes, priorTurnsRes] = await Promise.all([
    db.from('brief_sources').select('*').eq('brief_id', briefId).order('ref_index'),
    db.from('brief_options').select('*').eq('brief_id', briefId).order('ref_index'),
    db.from('chat_turns').select('*').eq('brief_id', briefId).order('created_at', { ascending: true }),
  ]);

  const sources = (sourcesRes.data ?? []) as BriefSource[];
  const options = (optionsRes.data ?? []) as BriefOption[];
  const priorTurns = (priorTurnsRes.data ?? []) as ChatTurn[];

  // Insert the user turn immediately so even a mid-stream failure preserves
  // the question. The server-side row gives us the `id` we'll echo back via
  // turn_start.
  const userInsert = await db
    .from('chat_turns')
    .insert({ brief_id: briefId, role: 'user', content: message })
    .select()
    .single();
  if (userInsert.error || !userInsert.data) {
    return c.json({ error: 'persist_user_turn_failed', detail: userInsert.error?.message }, 500);
  }
  const userTurnId = userInsert.data.id as string;

  // Build messages array — prior turns + the new user turn we just inserted.
  const messages: Anthropic.MessageParam[] = [
    ...priorTurns.map((t) => ({
      role: t.role,
      content: t.content,
    })),
    { role: 'user', content: message },
  ];

  // System prompt: frozen prefix + per-brief context, both with cache_control
  // ephemeral so a multi-turn conversation only pays the prefix tokens once.
  // Claude minimum cacheable prefix is large enough that frozen system + brief
  // context will clear that on most briefs.
  const briefContext = buildBriefContext(brief, sources, options);
  const systemBlocks: Anthropic.TextBlockParam[] = brief.mode === 'data_analyst'
    ? [
      { type: 'text', text: DATA_ANALYST_CHAT_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: briefContext, cache_control: { type: 'ephemeral' } },
    ]
    : [
      { type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: await buildContextGraphSystemBlock(), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: briefContext, cache_control: { type: 'ephemeral' } },
    ];

  return streamSSE(c, async (stream) => {
    const writeEvent = (event: ChatStreamEvent) =>
      stream.writeSSE({ data: JSON.stringify(event) });

    let assistantText = '';
    let turnCreated = false;
    let assistantToolCalls: ToolCall[] = [];

    try {
      await writeEvent({ type: 'turn_start', turn_id: userTurnId });
      turnCreated = true;

      if (brief.mode === 'data_analyst') {
        const streamResult = await streamMessageWithDataAnalystTools({
          model: CHAT_MODEL,
          max_tokens: 16384,
          thinking: { type: 'adaptive' },
          system: systemBlocks,
          messages,
        }, {
          onText: async (text) => {
            assistantText += text;
            await writeEvent({ type: 'token', text });
          },
          onDataAnalystToolUse: async (toolUse) => {
            await writeEvent({
              type: 'tool_use',
              tool: {
                id: toolUse.id,
                name: toolUse.name,
                input: toolUse.input as Record<string, unknown>,
              },
            });
          },
          onDataAnalystTrace: async (trace) => {
            assistantToolCalls = dataAnalystTracesToToolCalls([...extractExistingDataAnalystTraces(assistantToolCalls), trace]);
            await writeEvent({ type: 'tool_result', tool_use_id: trace.tool_use_id, result: trace });
          },
        });
        assistantText = streamResult.text;
        assistantToolCalls = dataAnalystTracesToToolCalls(streamResult.traces);
      } else {
        const preload = await preloadCurrentAppEvidenceForChat(message, systemBlocks, userTurnId);
        if (preload.trace) {
          assistantToolCalls = toolCallsFromTraces([], [preload.trace]);
          const toolCall = assistantToolCalls[0];
          await writeEvent({ type: 'tool_use', tool: toolCall });
          await writeEvent({
            type: 'tool_result',
            tool_use_id: preload.trace.tool_use_id,
            result: preload.trace,
          });
        }

        const streamResult = await streamMessageWithGambitTools({
          model: CHAT_MODEL,
          max_tokens: 16384,
          thinking: { type: 'adaptive' },
          system: preload.systemBlocks,
          messages,
        }, {
          onText: async (text) => {
            assistantText += text;
            await writeEvent({ type: 'token', text });
          },
          onContextGraphToolUse: async (toolUse) => {
            await writeEvent({
              type: 'tool_use',
              tool: {
                id: toolUse.id,
                name: toolUse.name,
                input: toolUse.input as Record<string, unknown>,
              },
            });
          },
          onContextGraphTrace: async (trace) => {
            assistantToolCalls = toolCallsFromTraces(
              [...extractExistingContextGraphTraces(assistantToolCalls), trace],
              extractExistingDataAnalystTraces(assistantToolCalls),
            );
            await writeEvent({ type: 'tool_result', tool_use_id: trace.tool_use_id, result: trace });
          },
          onDataAnalystToolUse: async (toolUse) => {
            await writeEvent({
              type: 'tool_use',
              tool: {
                id: toolUse.id,
                name: toolUse.name,
                input: toolUse.input as Record<string, unknown>,
              },
            });
          },
          onDataAnalystTrace: async (trace) => {
            assistantToolCalls = toolCallsFromTraces(
              extractExistingContextGraphTraces(assistantToolCalls),
              [...extractExistingDataAnalystTraces(assistantToolCalls), trace],
            );
            await writeEvent({ type: 'tool_result', tool_use_id: trace.tool_use_id, result: trace });
          },
        });
        assistantText = streamResult.text;
        assistantToolCalls = toolCallsFromTraces(
          streamResult.contextGraphTraces,
          [
            ...extractExistingDataAnalystTraces(assistantToolCalls).filter((trace) => (
              trace.tool_use_id.startsWith('preloaded_current_nba_evidence_') ||
              trace.tool_use_id.startsWith('preloaded_current_nfl_evidence_')
            )),
            ...streamResult.dataAnalystTraces,
          ],
        );
      }

      // Persist the assistant turn before signaling end so the client can
      // safely refetch and find the durable row.
      const assistantInsert = await db
        .from('chat_turns')
        .insert({
          brief_id: briefId,
          role: 'assistant',
          content: assistantText,
          tool_calls: assistantToolCalls.length ? assistantToolCalls : null,
        })
        .select('id')
        .single();

      const assistantTurnId =
        assistantInsert.error || !assistantInsert.data
          ? userTurnId
          : (assistantInsert.data.id as string);

      await writeEvent({ type: 'turn_end', turn_id: assistantTurnId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const recoverable =
        err instanceof Anthropic.RateLimitError ||
        err instanceof Anthropic.InternalServerError;

      // If we already streamed tokens or looked up context, persist what we
      // have as a partial assistant turn so the trust trail survives reloads.
      if (turnCreated && (assistantText.length > 0 || assistantToolCalls.length > 0)) {
        await db
          .from('chat_turns')
          .insert({
            brief_id: briefId,
            role: 'assistant',
            content: assistantText,
            tool_calls: assistantToolCalls.length ? assistantToolCalls : null,
          });
      }

      await writeEvent({
        type: 'error',
        message,
        recoverable,
      });
    }
  });
});

function extractExistingContextGraphTraces(
  toolCalls: ToolCall[],
) {
  return toolCalls.flatMap((toolCall) => (
    toolCall.context_graph_trace ? [toolCall.context_graph_trace] : []
  ));
}

function extractExistingDataAnalystTraces(toolCalls: ToolCall[]): DataAnalystTrace[] {
  return toolCalls.flatMap((toolCall) => (
    toolCall.data_analyst_trace ? [toolCall.data_analyst_trace] : []
  ));
}

function toolCallsFromTraces(
  contextGraphTraces: ContextGraphTrace[],
  dataAnalystTraces: DataAnalystTrace[],
): ToolCall[] {
  return [
    ...contextGraphTracesToToolCalls(contextGraphTraces),
    ...dataAnalystTracesToToolCalls(dataAnalystTraces),
  ];
}

async function preloadCurrentAppEvidenceForChat(
  message: string,
  baseSystemBlocks: Anthropic.TextBlockParam[],
  userTurnId: string,
): Promise<{ systemBlocks: Anthropic.TextBlockParam[]; trace: DataAnalystTrace | null }> {
  const nflTeamIds = currentNflEvidenceTeamIds(message, defaultNflEvidenceTeamId());
  const nflScope = currentNflEvidenceScopeForQuestion(message);
  if (nflTeamIds.length > 0 && nflScope) {
    const evidence = await buildCurrentNflEvidence(message, {
      teamIds: nflTeamIds,
      scope: nflScope,
      consumer: 'chat',
    });
    if (!evidence) return { systemBlocks: baseSystemBlocks, trace: null };
    return {
      systemBlocks: [
        ...baseSystemBlocks,
        { type: 'text', text: evidence.systemBlock },
      ],
      trace: currentNflEvidenceToDataAnalystTrace(
        evidence,
        `preloaded_current_nfl_evidence_${userTurnId}`,
      ),
    };
  }

  const teamIds = currentNbaEvidenceTeamIds(message, null);
  if (teamIds.length === 0) return { systemBlocks: baseSystemBlocks, trace: null };
  const scope = currentNbaEvidenceScopeForQuestion(message);
  if (!scope) return { systemBlocks: baseSystemBlocks, trace: null };
  const evidence = await buildCurrentNbaEvidence(message, {
    teamIds,
    scope,
    consumer: 'chat',
  });
  if (!evidence) return { systemBlocks: baseSystemBlocks, trace: null };

  return {
    systemBlocks: [
      ...baseSystemBlocks,
      { type: 'text', text: evidence.systemBlock },
    ],
    trace: currentNbaEvidenceToDataAnalystTrace(
      evidence,
      `preloaded_current_nba_evidence_${userTurnId}`,
    ),
  };
}
