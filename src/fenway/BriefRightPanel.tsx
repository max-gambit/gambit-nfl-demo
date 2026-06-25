import { useEffect, useMemo, useRef, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { BriefThread } from './BriefThread';
import { useBriefs, useMonitors, useSessions, useUi } from '../store';
import {
  RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH,
} from '../store/ui';
import type { Brief } from '@shared/types';

const COLLAPSED_HANDLE_WIDTH = 18;

/**
 * Phase 9 — Slack-style master/detail right panel for the Analyze surface.
 *
 *   - List mode (default): TOC of briefs in the active session. Click → switches
 *     to thread mode + expands that brief in the main pane.
 *   - Thread mode: brief summary header + replies + composer (BriefThread).
 *     "← Briefs" returns to list mode (main-pane expansion stays put).
 *
 * Resizable via a draggable left-edge divider; persisted width in the UI store.
 * Collapses to a thin 18px handle via the channel header toggle (or by dragging
 * to the minimum and toggling). Hidden entirely when there are no briefs in
 * the active channel (the cold-start composer or empty channel handles UX).
 */
export function BriefRightPanel() {
  const { briefs } = useBriefs();
  const { activeSessionId } = useSessions();
  const { monitors } = useMonitors();
  const {
    expandedBriefId, rightPanelMode, rightPanelWidth, rightPanelOpen,
    setExpandedBrief, setRightPanelMode, setRightPanelWidth, setRightPanelOpen,
  } = useUi();

  const [dragging, setDragging] = useState(false);

  // Drag-to-resize: capture viewport-wide mouse events while dragging.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const next = window.innerWidth - e.clientX;
      setRightPanelWidth(next);
    };
    const onUp = () => setDragging(false);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, setRightPanelWidth]);

  const channelBriefs = useMemo(
    () => briefs
      .filter((b) => b.session_id === activeSessionId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [briefs, activeSessionId],
  );

  const focusedBrief = useMemo(() => {
    if (!expandedBriefId) return null;
    return briefs.find((b) => b.id === expandedBriefId) ?? null;
  }, [briefs, expandedBriefId]);

  // Thread mode requires a focused brief — fall back to list if it goes missing.
  useEffect(() => {
    if (rightPanelMode === 'thread' && !focusedBrief) {
      setRightPanelMode('list');
    }
  }, [rightPanelMode, focusedBrief, setRightPanelMode]);

  // Hide the panel entirely when there are no briefs in this channel.
  if (channelBriefs.length === 0) return null;

  // Collapsed handle — thin vertical strip with a chevron to reopen.
  if (!rightPanelOpen) {
    return (
      <button onClick={() => setRightPanelOpen(true)} title="Open right panel"
        aria-label="Open right panel"
        style={{
          width: COLLAPSED_HANDLE_WIDTH, flexShrink: 0,
          background: F.paper, border: 'none',
          borderLeft: `1px solid ${F.border}`,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: F.fgMuted,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = F.cream50; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = F.paper; }}>
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
    );
  }

  return (
    <div style={{
      width: rightPanelWidth, flexShrink: 0,
      background: F.paper,
      borderLeft: `1px solid ${F.border}`,
      display: 'flex', flexDirection: 'column',
      minHeight: 0, position: 'relative',
    }}>
      {/* Drag handle — sits flush on the left edge of the panel */}
      <div
        onMouseDown={(e) => { e.preventDefault(); setDragging(true); }}
        title="Drag to resize"
        style={{
          position: 'absolute', left: -3, top: 0, bottom: 0,
          width: 6, cursor: 'col-resize',
          background: dragging ? F.fenwaySoft : 'transparent',
          zIndex: 10,
          transition: 'background 0.12s ease',
        }}
        onMouseEnter={(e) => { if (!dragging) e.currentTarget.style.background = F.cream100; }}
        onMouseLeave={(e) => { if (!dragging) e.currentTarget.style.background = 'transparent'; }}
      />

      {rightPanelMode === 'list' ? (
        <ListMode
          briefs={channelBriefs}
          expandedBriefId={expandedBriefId}
          monitors={monitors}
          onSelect={(id) => { setExpandedBrief(id); setRightPanelMode('thread'); }}
          onCollapse={() => setRightPanelOpen(false)}
        />
      ) : (
        focusedBrief && (
          <ThreadMode
            brief={focusedBrief}
            onBack={() => setRightPanelMode('list')}
            onCollapse={() => setRightPanelOpen(false)}
          />
        )
      )}
    </div>
  );
}

interface ListModeProps {
  briefs: Brief[];
  expandedBriefId: string | null;
  monitors: ReturnType<typeof useMonitors>['monitors'];
  onSelect: (id: string) => void;
  onCollapse: () => void;
}

function ListMode({ briefs, expandedBriefId, monitors, onSelect, onCollapse }: ListModeProps) {
  // Per-brief reply-count placeholder: we don't pre-load all briefs' chat
  // history, so this is best-effort from the loaded `turnsByBrief` map.
  const { turnsByBrief } = useBriefs();
  const alertsByBrief = useMemo(() => {
    const m = new Map<string, number>();
    for (const mon of monitors) {
      if (!mon.brief_id || mon.alerts_count <= 0) continue;
      m.set(mon.brief_id, (m.get(mon.brief_id) ?? 0) + mon.alerts_count);
    }
    return m;
  }, [monitors]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: `${SPACE.md}px ${SPACE.md}px`, borderBottom: `1px solid ${F.border}`,
        display: 'flex', alignItems: 'center', gap: SPACE.sm,
      }}>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 600,
          color: F.ink, letterSpacing: TRACKING.body,
        }}>Briefs in channel</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgMuted,
          fontVariantNumeric: 'tabular-nums',
        }}>{briefs.length}</span>
        <div style={{ flex: 1 }} />
        <button onClick={onCollapse} title="Collapse panel" aria-label="Collapse panel"
          style={{
            padding: 0, width: 22, height: 22,
            background: 'transparent', border: `1px solid ${F.border}`,
            borderRadius: RADIUS.sm, cursor: 'pointer', color: F.fgMuted,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="gd-scroll" style={{ flex: 1, overflowY: 'auto', padding: `${SPACE.sm}px 0` }}>
        {briefs.map((b) => {
          const active = b.id === expandedBriefId;
          const replyCount = (turnsByBrief[b.id] ?? []).length;
          const alerts = alertsByBrief.get(b.id) ?? 0;
          const ago = relativeAgo(new Date(b.created_at));
          const isGenerating = b.status === 'generating';
          const isFailed = b.status === 'failed';
          return (
            <button key={b.id} onClick={() => onSelect(b.id)}
              style={{
                width: '100%',
                padding: `${SPACE.md}px ${SPACE.md}px`,
                background: active ? F.cream50 : 'transparent',
                borderLeft: active ? `2px solid ${F.fenway}` : '2px solid transparent',
                border: 'none',
                cursor: 'pointer', textAlign: 'left',
                display: 'flex', flexDirection: 'column', gap: SPACE.xs,
                borderBottom: `1px solid ${F.border}`,
                transition: 'background 120ms ease',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = F.cream50; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: SPACE.xs + 2,
                fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, color: F.fgMuted,
                letterSpacing: TRACKING.caps, textTransform: 'uppercase', fontWeight: 600,
              }}>
                {isGenerating && (
                  <span style={{
                    width: 8, height: 8, borderRadius: RADIUS.pill, background: F.fenway,
                    animation: 'dot-pulse 1.2s ease-in-out infinite',
                  }} />
                )}
                {isFailed && (
                  <span style={{ width: 8, height: 8, borderRadius: RADIUS.pill, background: F.red }} />
                )}
                <span>{ago}</span>
                <div style={{ flex: 1 }} />
                {alerts > 0 && (
                  <span title={`${alerts} alert${alerts === 1 ? '' : 's'}`}
                    style={{
                      minWidth: 14, height: 14, padding: `0 ${SPACE.xs}px`,
                      background: F.fenway, color: F.surface,
                      borderRadius: RADIUS.pill,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
                    }}>{alerts}</span>
                )}
                {replyCount > 0 && (
                  <span style={{ color: F.fgFaint }}>{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
                )}
              </div>
              <div style={{
                fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md,
                color: active ? F.ink : F.inkSoft,
                fontWeight: active ? 500 : 400,
                lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>{b.thesis ?? b.question}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ThreadMode({ brief, onBack, onCollapse }: { brief: Brief; onBack: () => void; onCollapse: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: `${SPACE.md}px`, borderBottom: `1px solid ${F.border}`,
        display: 'flex', alignItems: 'flex-start', gap: SPACE.sm,
      }}>
        <button onClick={onBack}
          style={{
            padding: `${SPACE.xs}px ${SPACE.sm}px`, flexShrink: 0,
            background: 'transparent', border: `1px solid ${F.border}`,
            borderRadius: RADIUS.md, cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 500, color: F.fgMuted,
            display: 'flex', alignItems: 'center', gap: SPACE.xs,
          }}>
          <span aria-hidden="true">←</span>
          Briefs
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
            color: F.fenway, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
            marginBottom: 2,
          }}>Thread</div>
          <div style={{
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.ink, fontWeight: 500,
            lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{brief.thesis ?? brief.question}</div>
        </div>
        <button onClick={onCollapse} title="Collapse panel" aria-label="Collapse panel"
          style={{
            padding: 0, width: 22, height: 22, flexShrink: 0,
            background: 'transparent', border: `1px solid ${F.border}`,
            borderRadius: RADIUS.sm, cursor: 'pointer', color: F.fgMuted,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {/* Key on brief.id so switching briefs remounts the thread — fresh
            streaming state + autoFocus refires on the new composer. */}
        <BriefThread key={brief.id} brief={brief} bindReplyFocus autoFocus />
      </div>
    </div>
  );
}

function relativeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return `${days}d ago`;
}

// Touch the constants so the import doesn't get tree-shaken away in dev.
void RIGHT_PANEL_MIN_WIDTH;
void RIGHT_PANEL_MAX_WIDTH;
