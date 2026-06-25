import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { Icon } from '../ds/Icon';
import { useBriefs, useToasts, useTray } from '../store';
import { runAgent } from '../api/agent';
import { fire } from '../lib/events';
import type { AgentKind, AgentRun } from '@shared/types';

type RecentKind = 'agent' | 'monitor' | 'ask' | 'data';

interface PaletteItem {
  id: string;
  kind: RecentKind;
  icon: string;
  label: string;
  sub: string;
}

interface Intent {
  kind: RecentKind;
  label: string;
  detail: string;
}

function inferIntent(query: string): Intent {
  const q = (query || '').toLowerCase().trim();
  if (!q) return { kind: 'ask', label: 'Ask Gambit', detail: 'Draft an answer inline' };
  if (q.startsWith('/data') || q.includes('data analyst') || q.includes('what does the data')) {
    return { kind: 'data', label: 'Ask data analyst', detail: 'Tables, calculations, caveats, and app-data sources' };
  }
  const monitorVerbs = ['watch', 'monitor', 'alert', 'notify', 'track', 'every week', 'every day', 'when ', 'whenever', 'as soon as', 'rerun'];
  if (monitorVerbs.some((v) => q.includes(v))) {
    return { kind: 'monitor', label: 'Create monitor', detail: 'Coming in phase 5' };
  }
  if (q.includes('deck')) {
    return { kind: 'agent', label: 'Generate deck', detail: 'PPTX-shaped outline · ~30–60s' };
  }
  if (q.includes('memo') || q.includes('pdf')) {
    return { kind: 'agent', label: 'Draft memo', detail: 'Long-form prose · ~30–60s' };
  }
  if (q.includes('staff') || q.includes('protocol') || q.includes('packet') || q.includes('forward')) {
    return { kind: 'agent', label: 'Create staff packet', detail: 'Forwardable protocol · ~30–60s' };
  }
  if (q.includes('research') || q.includes('deep') || q.includes('comp') || q.includes('synthesize') || q.includes('build') || q.includes('find')) {
    return { kind: 'agent', label: 'Run agent', detail: 'Deep research · ~minutes' };
  }
  if (q.includes('export') || q.includes('summary')) {
    return { kind: 'agent', label: 'Run agent', detail: 'One-shot · attaches to source brief' };
  }
  return { kind: 'ask', label: 'Ask Gambit', detail: 'Draft an answer inline · ~seconds' };
}

interface AgentMatch extends PaletteItem {
  agentKind: AgentKind;
}

function matchesFor(query: string, intent: Intent): AgentMatch[] {
  const q = (query || '').toLowerCase();
  if (intent.kind !== 'agent') return [];
  if (q.includes('deck')) {
    return [
      { id: 'a1', kind: 'agent', icon: 'deck', label: 'Generate deck from current brief', sub: 'Markdown outline · 8–10 slides · ~30–60s', agentKind: 'deck' },
      { id: 'a2', kind: 'agent', icon: 'doc', label: 'Draft memo (PDF) instead', sub: 'Long-form prose · same source brief', agentKind: 'memo' },
    ];
  }
  if (q.includes('memo')) {
    return [
      { id: 'a2', kind: 'agent', icon: 'doc', label: 'Draft memo from current brief', sub: 'Long-form prose · ~30–60s', agentKind: 'memo' },
      { id: 'a1', kind: 'agent', icon: 'deck', label: 'Generate deck instead', sub: 'PPTX-shaped outline', agentKind: 'deck' },
    ];
  }
  if (q.includes('staff') || q.includes('protocol') || q.includes('packet') || q.includes('forward')) {
    return [
      { id: 'a6', kind: 'agent', icon: 'clipboard', label: 'Create staff protocol packet', sub: 'Questions for analytics, coaching, scouting, cap', agentKind: 'staff_protocol' },
      { id: 'a3', kind: 'agent', icon: 'search', label: 'Deep research first', sub: 'Gather supporting evidence', agentKind: 'research' },
    ];
  }
  return [
    { id: 'a3', kind: 'agent', icon: 'search', label: 'Deep research · multi-source synthesis', sub: 'One-shot · ~minutes', agentKind: 'research' },
    { id: 'a6', kind: 'agent', icon: 'clipboard', label: 'Create staff protocol packet', sub: 'Forwardable staff questions', agentKind: 'staff_protocol' },
    { id: 'a4', kind: 'agent', icon: 'grid', label: 'Build comp set', sub: 'Find players matching a profile', agentKind: 'comp_set' },
    { id: 'a5', kind: 'agent', icon: 'merge', label: 'Synthesize across briefs', sub: 'Cross-reference multiple briefs', agentKind: 'synthesize' },
  ];
}

const KIND_COLORS: Record<RecentKind, { tag: string; bg: string; label: string }> = {
  monitor: { tag: '#8A5710', bg: '#FFF7E8', label: 'Monitor' },
  agent: { tag: F.fenway, bg: F.fenwaySoft, label: 'Agent' },
  ask: { tag: F.fgMuted, bg: F.cream50, label: 'Ask' },
  data: { tag: F.positive, bg: F.positiveSoft, label: 'Data' },
};

const ICON_FOR_AGENT: Record<AgentKind, string> = {
  deck: 'deck',
  memo: 'doc',
  research: 'search',
  comp_set: 'grid',
  synthesize: 'merge',
  change_my_mind: 'spark',
  staff_protocol: 'clipboard',
};

function recentRowFor(run: AgentRun): PaletteItem & { runId: string } {
  const ago = relativeTimeShort(new Date(run.created_at));
  const status =
    run.status === 'running' ? 'Running…'
    : run.status === 'completed' ? 'Done'
    : run.status === 'failed' ? 'Failed'
    : run.status === 'needs_input' ? 'Needs input'
    : 'Queued';
  return {
    id: `recent-${run.id}`,
    runId: run.id,
    kind: 'agent',
    icon: ICON_FOR_AGENT[run.kind] ?? 'spark',
    label: run.title,
    sub: `${run.sub ?? ''}${run.sub ? ' · ' : ''}${status} · ${ago}`,
  };
}

function relativeTimeShort(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

function PaletteRow({ item, selected, leadingKind, onClick }: { item: PaletteItem; selected: boolean; leadingKind?: boolean; onClick?: () => void }) {
  const k = KIND_COLORS[item.kind] ?? KIND_COLORS.ask;
  return (
    <button onClick={onClick} style={{
      width: '100%',
      display: 'flex', alignItems: 'center', gap: SPACE.sm + 2,
      padding: `${SPACE.xs + 2}px ${SPACE.lg}px`,
      background: selected ? F.cream50 : 'transparent',
      border: 'none',
      borderLeft: selected ? `2px solid ${F.fenway}` : '2px solid transparent',
      cursor: 'pointer',
      textAlign: 'left',
    }}>
      <div style={{
        width: 26, height: 26,
        background: F.surface,
        border: `1px solid ${F.border}`,
        borderRadius: RADIUS.md,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: F.fg,
        flexShrink: 0,
      }}>
        <Icon name={item.icon} size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md, fontWeight: 500,
          color: F.ink,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{item.label}</div>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.fgMuted,
          marginTop: 1,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{item.sub}</div>
      </div>
      {leadingKind && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 600,
          color: k.tag, background: k.bg,
          padding: `2px ${SPACE.xs + 2}px`, borderRadius: RADIUS.pill,
          letterSpacing: TRACKING.micro, textTransform: 'uppercase',
          flexShrink: 0,
        }}>{k.label}</span>
      )}
      {selected && <Icon name="check" size={13} color={F.fenway} />}
    </button>
  );
}

interface PaletteProps {
  liveInput?: boolean;
  onClose?: () => void;
}

export function Palette({ liveInput = true, onClose }: PaletteProps) {
  const [liveQuery, setLiveQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { activeBriefId } = useBriefs();
  const { trayItems } = useTray();
  const { pushToast } = useToasts();

  useEffect(() => {
    if (liveInput) inputRef.current?.focus();
  }, [liveInput]);

  const query = liveQuery;
  const intent = inferIntent(query);
  const matches = matchesFor(query, intent);
  const recents = useMemo(
    () => trayItems.filter((r) => r.kind && r.title).slice(0, 4).map(recentRowFor),
    [trayItems],
  );
  const showMatches = matches.length > 0;
  const showRecents = !query || query.length < 4;
  const visibleMatches = showMatches ? matches : [];
  const visibleRecents = showRecents ? recents : [];
  const totalRows = visibleMatches.length + visibleRecents.length;

  // Reset selection when the row set changes shape.
  useEffect(() => {
    setSelectedIdx((cur) => Math.min(cur, Math.max(0, totalRows - 1)));
  }, [totalRows]);

  const dispatch = useCallback(async (overrideKind?: AgentKind) => {
    // Resolve the agent kind from an explicit override, the selected suggestion,
    // or the first match. An override means the user picked a row directly
    // (a recent or an explicit suggestion click) so it must win over the
    // text-inferred intent — otherwise clicking a recent with an empty query
    // silently does nothing because `intent.kind` is 'ask'.
    const kindToRun: AgentKind | undefined =
      overrideKind ?? visibleMatches[selectedIdx]?.agentKind ?? (intent.kind === 'agent' ? matches[0]?.agentKind : undefined);

    if (kindToRun) {
      if (!activeBriefId) {
        console.warn('[palette] dispatch skipped — no active brief');
        pushToast({
          tone: 'info',
          message: 'Pick a brief first',
          detail: 'Agents attach their output to the active brief — open one before running an agent.',
        });
        onClose?.();
        return;
      }
      onClose?.();
      try {
        await runAgent({ brief_id: activeBriefId, kind: kindToRun, config: {}, query });
        const label =
          kindToRun === 'deck' ? 'Deck'
          : kindToRun === 'memo' ? 'Memo'
          : kindToRun === 'staff_protocol' ? 'Staff protocol'
          : 'Agent';
        pushToast({
          tone: 'info',
          message: `${label} dispatched`,
          detail: 'Watch the puck in the header — it pulses when finished.',
        });
      } catch (err) {
        console.error('[palette] runAgent failed', err);
        pushToast({
          tone: 'error',
          message: 'Couldn’t start agent',
          detail: err instanceof Error ? err.message : 'Server unreachable.',
        });
      }
      return;
    }

    if (intent.kind === 'data') {
      const text = query.replace(/^\/data(?:\s+|$)/i, '').trim();
      if (!text) {
        onClose?.();
        return;
      }
      onClose?.();
      fire('v6d3cf:submit-data-brief', { text });
      return;
    }

    if (intent.kind === 'ask') {
      if (!query.trim()) {
        onClose?.();
        return;
      }
      onClose?.();
      fire('v6d3cf:submit-chat', { text: query });
      return;
    }

    // monitor — phase 5
    onClose?.();
  }, [intent.kind, activeBriefId, query, visibleMatches, selectedIdx, matches, onClose]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && onClose) {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((cur) => Math.min(totalRows - 1, cur + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((cur) => Math.max(0, cur - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // If the user has selected a recent that points at a finished run, the
      // simplest behavior is "re-run the same kind". Hop into agent dispatch
      // with that kind.
      if (selectedIdx >= visibleMatches.length) {
        const recent = visibleRecents[selectedIdx - visibleMatches.length];
        if (recent) {
          const sourceRun = trayItems.find((r) => r.id === recent.runId);
          if (sourceRun) {
            void dispatch(sourceRun.kind);
            return;
          }
        }
      }
      void dispatch();
    }
  };

  const intentColor =
    intent.kind === 'monitor'
      ? { c: '#8A5710', bg: '#FFF7E8' }
      : intent.kind === 'agent'
        ? { c: F.fenway, bg: F.fenwaySoft }
        : intent.kind === 'data'
          ? { c: F.positive, bg: F.positiveSoft }
          : { c: F.fgMuted, bg: F.cream50 };

  return (
    <div style={{
      width: 640,
      background: F.surface,
      border: `1px solid ${F.borderStrong}`,
      borderRadius: RADIUS.lg,
      boxShadow: F.shadowPop,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: SPACE.sm + 2,
        padding: `${SPACE.lg}px ${SPACE.xl}px`,
        borderBottom: `1px solid ${F.border}`,
      }}>
        <span aria-hidden="true" style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.display.sm, fontWeight: 600, color: F.fenway,
        }}>›</span>
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', minHeight: 18 }}>
          <input
            ref={inputRef}
            type="text"
            value={liveQuery}
            onChange={(e) => setLiveQuery(e.target.value)}
            onKeyDown={onKeyDown}
            style={{
              flex: 1, width: '100%', border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'var(--font-mono)', fontSize: TYPE.body.lg, color: F.ink,
              padding: 0,
              caretColor: liveQuery ? F.fenway : 'transparent',
            }}
          />
          {!liveQuery && (
            <div style={{
              position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
              pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: SPACE.sm,
            }}>
              <span style={{
                display: 'inline-block', width: 7, height: 14, background: F.fenway,
                animation: 'cursor-blink 1.06s steps(2, start) infinite',
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: TYPE.body.lg, color: F.fgFaint,
              }}>Ask, run an agent, or set up a monitor…</span>
            </div>
          )}
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgFaint,
          letterSpacing: TRACKING.caps, flexShrink: 0,
        }}>⌘K</span>
      </div>

      {query && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: SPACE.sm,
          padding: `${SPACE.sm}px ${SPACE.xl}px`,
          background: intentColor.bg,
          borderBottom: `1px solid ${F.border}`,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
            letterSpacing: TRACKING.micro, textTransform: 'uppercase', fontWeight: 600,
          }}>↵ on enter:</span>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 600,
            color: intentColor.c,
          }}>{intent.label}</span>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.fgMuted,
          }}>· {intent.detail}</span>
          <div style={{ flex: 1 }} />
          {intent.kind === 'monitor' && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: '#8A5710',
              letterSpacing: TRACKING.caps, textTransform: 'uppercase', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: SPACE.xs,
            }}>
              <Icon name="bell" size={10} color="#8A5710" />
              persistent
            </span>
          )}
          {intent.kind === 'agent' && !activeBriefId && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: '#8A5710',
              letterSpacing: TRACKING.caps, textTransform: 'uppercase', fontWeight: 600,
            }}>no active brief</span>
          )}
        </div>
      )}

      <div className="gd-scroll" style={{ maxHeight: 360, overflowY: 'auto', padding: `${SPACE.xs + 2}px 0` }}>
        {showMatches && (
          <>
            <div style={{
              padding: `${SPACE.sm}px ${SPACE.xl}px ${SPACE.xs}px`,
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 600,
              color: F.fgMuted, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
            }}>Suggested</div>
            {visibleMatches.map((m, i) => (
              <PaletteRow
                key={m.id}
                item={m}
                selected={i === selectedIdx}
                leadingKind
                onClick={() => { setSelectedIdx(i); void dispatch(m.agentKind); }}
              />
            ))}
          </>
        )}
        {showRecents && visibleRecents.length > 0 && (
          <>
            <div style={{
              padding: showMatches ? `${SPACE.md}px ${SPACE.xl}px ${SPACE.xs}px` : `${SPACE.sm}px ${SPACE.xl}px ${SPACE.xs}px`,
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 600,
              color: F.fgMuted, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
            }}>Recents</div>
            {visibleRecents.map((r, i) => {
              const idx = visibleMatches.length + i;
              return (
                <PaletteRow
                  key={r.id}
                  item={r}
                  selected={idx === selectedIdx}
                  leadingKind
                  onClick={() => {
                    setSelectedIdx(idx);
                    const sourceRun = trayItems.find((run) => run.id === (r as PaletteItem & { runId: string }).runId);
                    if (sourceRun) void dispatch(sourceRun.kind);
                  }}
                />
              );
            })}
          </>
        )}
        {!showMatches && (!showRecents || visibleRecents.length === 0) && (
          <div style={{
            padding: `${SPACE['2xl']}px ${SPACE.xl}px`,
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgFaint,
            textAlign: 'center',
          }}>
            {query ? `Press ↵ to ${intent.label.toLowerCase()}` : 'Start typing to search agents'}
          </div>
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: SPACE.md + 2,
        padding: `${SPACE.sm}px ${SPACE.lg}px`,
        background: F.paper,
        borderTop: `1px solid ${F.border}`,
        fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
        letterSpacing: TRACKING.caps,
      }}>
        <span><span style={{ color: F.fenway }}>↑↓</span> navigate</span>
        <span><span style={{ color: F.fenway }}>↵</span> {query ? intent.label.toLowerCase() : 'select'}</span>
        <span><span style={{ color: F.fenway }}>tab</span> autocomplete</span>
        <div style={{ flex: 1 }} />
        <span>esc to close</span>
      </div>
    </div>
  );
}
