import { useCallback, useEffect, useRef, useState } from 'react';
import { F, SPACE, TYPE } from '../theme/fenway';
import { Composer } from './Composer';
import { UserTurnView, AssistantTurnView, ThinkingIndicator } from './ChatTurnViews';
import { DataAnalystTrustStrip } from './DataAnalystTrustStrip';
import { useBriefs, useToasts } from '../store';
import { streamChat } from '../api/chat';
import { runAgent } from '../api/agent';
import { regenerateBrief } from '../api/briefs';
import { ContextGraphActivityDrawer } from '../war-room/ContextGraphActivityDrawer';
import { on as onEvt } from '../lib/events';
import type { AgentKind, Brief, ChatTurn, ContextGraphTrace, DataAnalystTrace, ToolCall } from '@shared/types';

interface Props {
  brief: Brief;
  /** When true, this thread's composer subscribes to the ⌘B reply-focus event. */
  bindReplyFocus?: boolean;
  /** When true, focus the composer textarea on mount — used when the thread
   *  is being opened in response to an explicit user action (e.g. Reply). */
  autoFocus?: boolean;
}

/**
 * Phase 9 — pure chat surface for one brief: replies + composer + streaming +
 * slash commands + agent dispatch. No surrounding chrome — the parent (e.g.
 * `BriefRightPanel`) provides the frame. Replaces the inline `BriefThreadStrip`.
 *
 * All operations (stream, agent dispatch, regenerate) are scoped to `brief.id`
 * so multiple instances can coexist without fighting over a global active brief.
 */
export function BriefThread({ brief, bindReplyFocus = true, autoFocus = false }: Props) {
  const [pendingUser, setPendingUser] = useState<{ q: string; ts: Date } | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [liveToolCalls, setLiveToolCalls] = useState<ToolCall[]>([]);

  const {
    turnsByBrief, loadingTurnsFor,
    appendTurn, setLastAssistantContent, setLastAssistantToolCalls,
    loadTurns, setActiveBrief,
  } = useBriefs();
  const { pushToast } = useToasts();
  const scrollRef = useRef<HTMLDivElement>(null);

  const turns = turnsByBrief[brief.id] ?? [];
  const loading = loadingTurnsFor.has(brief.id);
  const liveHasDataTrace = liveToolCalls.some((toolCall) => Boolean(toolCall.data_analyst_trace));
  const liveHasContextTrace = liveToolCalls.some((toolCall) => Boolean(toolCall.context_graph_trace));

  // Lazy-load this brief's chat history when the thread mounts. Channel feed
  // doesn't pre-fetch every brief's turns to keep first paint cheap.
  useEffect(() => {
    void loadTurns(brief.id);
  }, [brief.id, loadTurns]);

  // Auto-scroll on new content.
  useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, [turns.length, pendingUser, streaming]);

  const submit = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || streaming) return;
    // Composer interaction implies "this is the brief I'm working with" —
    // sync activeBriefId so OptionsTable / cap strip / header signals follow.
    setActiveBrief(brief.id);

    const ts = new Date();
    setPendingUser({ q, ts });
    setStreaming(true);
    setLiveToolCalls([]);

    const optimisticUser: ChatTurn = {
      id: `pending-user-${Date.now()}`,
      brief_id: brief.id,
      role: 'user',
      content: q,
      tool_calls: null,
      created_at: ts.toISOString(),
    };
    appendTurn(brief.id, optimisticUser);

    let partial = '';
    let streamToolCalls: ToolCall[] = [];
    try {
      for await (const event of streamChat(brief.id, q)) {
        if (event.type === 'token') {
          partial += event.text;
          setLastAssistantContent(brief.id, partial);
          if (streamToolCalls.length) setLastAssistantToolCalls(brief.id, streamToolCalls);
        } else if (event.type === 'tool_result') {
          const toolCall = toolCallFromTraceEvent(event.tool_use_id, event.result);
          if (toolCall) {
            streamToolCalls = mergeToolCall(streamToolCalls, toolCall);
            setLiveToolCalls(streamToolCalls);
            setLastAssistantToolCalls(brief.id, streamToolCalls);
          }
        } else if (event.type === 'error') {
          pushToast({
            tone: 'error',
            message: 'Reply failed',
            detail: 'Streaming hit an error mid-flight.',
          });
          break;
        }
      }
    } catch (err) {
      console.error('[brief-thread] stream error', err);
      pushToast({
        tone: 'error',
        message: 'Reply failed',
        detail: err instanceof Error ? err.message : 'Network error.',
      });
    } finally {
      setStreaming(false);
      setPendingUser(null);
      setLiveToolCalls([]);
    }
  }, [brief.id, streaming, appendTurn, setLastAssistantContent, setLastAssistantToolCalls, setActiveBrief, pushToast]);

  useEffect(() => onEvt('v6d3cf:submit-chat', ({ text }) => {
    void submit(text);
  }), [submit]);

  const dispatchAgent = useCallback(async (kind: AgentKind, label: string) => {
    try {
      await runAgent({ brief_id: brief.id, kind, config: {}, query: '' });
      pushToast({
        tone: 'info',
        message: `${label} dispatched`,
        detail: 'Watch the puck in the header — it pulses when finished.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t start agent',
        detail: err instanceof Error ? err.message : 'Server unreachable.',
      });
    }
  }, [brief.id, pushToast]);

  const onRegenerate = useCallback(async () => {
    try {
      await regenerateBrief(brief.id);
      pushToast({
        tone: 'info',
        message: 'Regenerating brief',
        detail: 'Sources, options, and reasoning will refresh in ~30–60s.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t regenerate brief',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    }
  }, [brief.id, pushToast]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      <div ref={scrollRef} className="gd-scroll" style={{
        flex: 1, overflowY: 'auto',
        padding: `${SPACE.md}px ${SPACE.lg}px ${SPACE['4xl'] * 2 + SPACE.lg}px`,
        display: 'flex', flexDirection: 'column',
      }}>
        {loading && turns.length === 0 && (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgFaint,
            padding: `${SPACE.sm}px 0`,
          }}>Loading replies…</div>
        )}
        {streaming && liveToolCalls.length > 0 && (
          <div style={{ marginBottom: SPACE.md }}>
            {liveHasContextTrace && (
              <ContextGraphActivityDrawer title="Live context lookup" mode="live" toolCalls={liveToolCalls} />
            )}
            {liveHasDataTrace && (
              <DataAnalystTrustStrip toolCalls={liveToolCalls} />
            )}
          </div>
        )}
        {!loading && turns.length === 0 && (
          <div style={{
            padding: `${SPACE.md}px 0`,
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.fgMuted,
            fontStyle: 'italic',
          }}>No replies yet — start the conversation below.</div>
        )}
        {turns.map((t, i) => {
          const isLast = i === turns.length - 1;
          return t.role === 'user'
            ? <UserTurnView key={t.id} content={t.content} ts={new Date(t.created_at)} />
            : <AssistantTurnView
                key={t.id}
                content={t.content}
                toolCalls={t.tool_calls}
                label={brief.mode === 'data_analyst' ? 'data analyst' : 'analyst'}
                streaming={streaming && isLast && t.id.startsWith('pending-')}
              />;
        })}
        {pendingUser && streaming && turns[turns.length - 1]?.role !== 'assistant' && (
          <ThinkingIndicator />
        )}
      </div>

      {/* Floating composer with a fader above the input. */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
        <div aria-hidden="true" style={{
          position: 'absolute', left: 0, right: 0,
          top: -SPACE['2xl'], height: SPACE['2xl'],
          background: `linear-gradient(to bottom, ${F.paper}00, ${F.paper})`,
        }} />
        <div style={{
          padding: `${SPACE.sm}px ${SPACE.lg}px ${SPACE.lg}px`,
          background: F.paper, pointerEvents: 'auto',
        }}>
          <Composer
            onSubmit={submit}
            disabled={streaming}
            onSlashCommand={dispatchAgent}
            onRegenerate={onRegenerate}
            placeholder="Reply to this brief…"
            focusBinding={bindReplyFocus ? 'reply' : null}
            autoFocus={autoFocus}
          />
        </div>
      </div>
    </div>
  );
}

function toolCallFromTraceEvent(toolUseId: string, result: unknown): ToolCall | null {
  if (isDataAnalystTrace(result)) {
    return {
      id: toolUseId,
      name: result.tool_name,
      input: {
        datasets: result.datasets.map((dataset) => dataset.dataset_id),
        team_ids: [...new Set(result.datasets.flatMap((dataset) => dataset.team_ids))],
      },
      data_analyst_trace: result,
    };
  }
  if (!isContextGraphTrace(result)) return null;
  return {
    id: toolUseId,
    name: result.tool_name,
    input: { team_ids: result.teams.map((team) => team.team_id) },
    context_graph_trace: result,
  };
}

function mergeToolCall(toolCalls: ToolCall[], next: ToolCall): ToolCall[] {
  const withoutNext = toolCalls.filter((toolCall) => toolCall.id !== next.id);
  return [...withoutNext, next];
}

function isContextGraphTrace(value: unknown): value is ContextGraphTrace {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tool_name' in value &&
    (value as { tool_name?: unknown }).tool_name === 'lookup_context_graph_teams' &&
    Array.isArray((value as { teams?: unknown }).teams)
  );
}

function isDataAnalystTrace(value: unknown): value is DataAnalystTrace {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tool_name' in value &&
    ['list_available_datasets', 'query_nfl_data', 'query_nba_data', 'query_brief_workspace'].includes(String((value as { tool_name?: unknown }).tool_name)) &&
    Array.isArray((value as { datasets?: unknown }).datasets)
  );
}
