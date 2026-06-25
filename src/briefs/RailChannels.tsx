import { useEffect, useMemo, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { useBriefs, useSessions, useToasts, useUi } from '../store';
import { useNewChannel } from '../lib/useNewChannel';
import type { Session } from '@shared/types';
import { archiveSession, deleteSession } from '../api/sessions';
import { Icon } from '../ds/Icon';

/**
 * Phase 9 — sessions sidebar. Sessions are channels; clicking one opens its
 * channel feed in the main pane.
 * "+ New" creates an Untitled channel directly (no modal) — composer in the
 * main pane gets focus, ready for the first question.
 */
export function RailChannels() {
  const { briefs, activeBriefId, setActiveBrief, removeBriefsForSession } = useBriefs();
  const { sessions, activeSessionId, setActiveSession, removeSession } = useSessions();
  const { setExpandedBrief, setRightPanelMode, setRightPanelOpen, setActiveNav, expandedBriefId } = useUi();
  const { pushToast } = useToasts();
  const startNewChannel = useNewChannel();
  const [openActionsFor, setOpenActionsFor] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

  const countBySession = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of briefs) {
      if (b.session_id) m.set(b.session_id, (m.get(b.session_id) ?? 0) + 1);
    }
    return m;
  }, [briefs]);

  const sortedSessions = useMemo(() => {
    const lastTouched = new Map<string, number>();
    for (const b of briefs) {
      if (!b.session_id) continue;
      const t = new Date(b.created_at).getTime();
      const prev = lastTouched.get(b.session_id) ?? 0;
      if (t > prev) lastTouched.set(b.session_id, t);
    }
    return [...sessions].sort((a, b) => {
      const at = lastTouched.get(a.id) ?? new Date(a.created_at).getTime();
      const bt = lastTouched.get(b.id) ?? new Date(b.created_at).getTime();
      return bt - at;
    });
  }, [sessions, briefs]);

  useEffect(() => {
    if (!openActionsFor) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-channel-actions="true"]')) return;
      setOpenActionsFor(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenActionsFor(null);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openActionsFor]);

  const onSelectSession = (s: Session) => {
    setActiveSession(s.id);
    setExpandedBrief(null);
    setRightPanelMode('list');
    setActiveNav('analyze');
  };

  const onManageSession = async (session: Session, action: 'archive' | 'delete') => {
    if (busySessionId) return;
    const count = countBySession.get(session.id) ?? 0;
    const actionLabel = action === 'archive' ? 'Archive' : 'Delete';
    const confirmed = window.confirm(
      action === 'archive'
        ? `${actionLabel} "${session.label}"?\n\nIt will disappear from Channels, but its briefs stay in the database.`
        : `${actionLabel} "${session.label}" and ${count} brief${count === 1 ? '' : 's'}?\n\nThis cannot be undone.`,
    );
    if (!confirmed) return;

    const fallbackId = sortedSessions.find((candidate) => candidate.id !== session.id)?.id ?? null;
    const removingFocusedBrief = briefs.some((brief) =>
      brief.session_id === session.id && (brief.id === activeBriefId || brief.id === expandedBriefId),
    );
    const shouldResetFocus = session.id === activeSessionId || removingFocusedBrief;

    setOpenActionsFor(null);
    setBusySessionId(session.id);
    try {
      if (action === 'archive') {
        await archiveSession(session.id);
      } else {
        await deleteSession(session.id);
      }
      removeBriefsForSession(session.id);
      removeSession(session.id, fallbackId);
      if (shouldResetFocus) {
        setActiveBrief(null);
        setExpandedBrief(null);
        setRightPanelMode('list');
        setRightPanelOpen(true);
        setActiveNav('analyze');
      }
      pushToast({
        tone: 'success',
        message: action === 'archive' ? 'Channel archived' : 'Channel deleted',
        detail: session.label,
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: action === 'archive' ? 'Couldn’t archive channel' : 'Couldn’t delete channel',
        detail: err instanceof Error ? err.message : 'Supabase request failed.',
      });
    } finally {
      setBusySessionId(null);
    }
  };

  return (
    <div style={{ borderBottom: `1px solid ${F.border}` }}>
      {/* Channels (sessions) */}
      <div style={{
        padding: `${SPACE.md}px ${SPACE.md}px ${SPACE.md}px`,
        borderTop: 'none',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: SPACE.xs + 2,
          padding: `0 ${SPACE.xs}px ${SPACE.xs + 2}px`,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
            color: F.fgMuted, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
          }}>Channels · {sessions.length}</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => void startNewChannel()} title="New channel (⌘N)"
            style={{
              padding: `2px ${SPACE.sm}px`,
              background: 'transparent', color: F.fenway,
              border: `1px solid ${F.fenway}`, borderRadius: RADIUS.sm,
              fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.sm, fontWeight: 600,
              cursor: 'pointer', letterSpacing: TRACKING.body,
              display: 'flex', alignItems: 'center', gap: 3,
            }}>
            <span style={{ fontSize: TYPE.meta.md, lineHeight: 1 }}>+</span>
            New
          </button>
        </div>
        {sortedSessions.length === 0 && (
          <div style={{
            padding: `${SPACE.xl}px ${SPACE.xs}px`, textAlign: 'center',
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgFaint,
          }}>
            No channels yet. Click <span style={{ color: F.fenway, fontWeight: 600 }}>+ New</span> to make one.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {sortedSessions.map((s) => {
            const active = s.id === activeSessionId && expandedBriefId === null;
            const count = countBySession.get(s.id) ?? 0;
            const actionsOpen = openActionsFor === s.id;
            const busy = busySessionId === s.id;
            return (
              <div key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: SPACE.sm,
                  padding: `${SPACE.xs + 2}px ${SPACE.xs}px ${SPACE.xs + 2}px ${SPACE.sm}px`,
                  background: active ? F.surface : 'transparent',
                  border: active ? `1px solid ${F.border}` : '1px solid transparent',
                  borderLeft: active ? `2px solid ${F.fenway}` : '2px solid transparent',
                  borderRadius: RADIUS.md,
                  boxShadow: active ? F.shadowSoft : 'none',
                  position: 'relative',
                  transition: 'background 120ms ease',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = F.cream50; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                <button type="button" onClick={() => onSelectSession(s)}
                  title={s.label}
                  style={{
                    display: 'flex', alignItems: 'center', gap: SPACE.sm,
                    flex: 1, minWidth: 0, padding: 0,
                    background: 'transparent', border: 'none',
                    cursor: 'pointer', textAlign: 'left',
                  }}>
                  <span aria-hidden="true" style={{
                    fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md,
                    color: active ? F.fenway : F.fgMuted,
                    fontWeight: 600, flexShrink: 0,
                  }}>#</span>
                  <span style={{
                    fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm,
                    color: active ? F.ink : F.fg,
                    fontWeight: active ? 500 : 400,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    flex: 1, minWidth: 0,
                  }}>{s.label}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
                    fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                  }}>{count}</span>
                </button>
                <div data-channel-actions="true" style={{ position: 'relative', flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-label={`Channel actions for ${s.label}`}
                    title="Channel actions"
                    disabled={busy}
                    onClick={() => setOpenActionsFor((current) => (current === s.id ? null : s.id))}
                    style={{
                      width: 22, height: 22,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: actionsOpen ? F.cream100 : 'transparent',
                      border: `1px solid ${actionsOpen ? F.borderStrong : 'transparent'}`,
                      borderRadius: RADIUS.sm,
                      color: active ? F.fenway : F.fgMuted,
                      cursor: busy ? 'wait' : 'pointer',
                      opacity: busy ? 0.55 : 1,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = F.cream100; }}
                    onMouseLeave={(e) => { if (!actionsOpen) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Icon name="more-horizontal" size={14} />
                  </button>
                  {actionsOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
                      width: 180, padding: `${SPACE.xs}px`,
                      background: F.surface,
                      border: `1px solid ${F.borderStrong}`,
                      borderRadius: RADIUS.md,
                      boxShadow: F.shadowPop,
                    }}>
                      <ChannelActionButton
                        icon="archive"
                        label="Archive channel"
                        disabled={busy}
                        onClick={() => void onManageSession(s, 'archive')}
                      />
                      <ChannelActionButton
                        icon="trash"
                        label="Delete channel"
                        tone="danger"
                        disabled={busy}
                        onClick={() => void onManageSession(s, 'delete')}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ChannelActionButton({
  icon,
  label,
  tone = 'default',
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}) {
  const color = tone === 'danger' ? F.red : F.inkSoft;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: SPACE.sm,
        padding: `${SPACE.sm}px ${SPACE.sm}px`,
        background: 'transparent',
        border: 'none',
        borderRadius: RADIUS.sm,
        color,
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        fontWeight: 500,
        cursor: disabled ? 'wait' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.55 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = tone === 'danger' ? F.redSoft : F.cream50; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Icon name={icon} size={14} />
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
    </button>
  );
}
