import { useEffect, useMemo, useRef, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { useBriefs, useMonitors, useUi } from '../store';
import type { Monitor } from '@shared/types';

function relativeTime(d: Date): string {
  const ms = d.getTime() - Date.now();
  const future = ms > 0;
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60_000);
  if (m < 1) return future ? 'soon' : 'just now';
  if (m < 60) return future ? `in ${m}m` : `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return future ? `in ${h}h` : `${h}h ago`;
  const days = Math.round(h / 24);
  return future ? `in ${days}d` : `${days}d ago`;
}

/**
 * Persistent monitors panel — surfaced as a pill in Header. Click to open the
 * popover listing every monitor with: brief title, schedule, next-fire time,
 * last-fire timestamp, and a Pause/Resume toggle. Reuses the shared
 * `useMonitors` store; no new endpoints.
 */
export function MonitorsPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { monitors, pauseMonitor } = useMonitors();
  const { briefs, setActiveBrief } = useBriefs();
  const { setExpandedBrief, setRightPanelMode, setRightPanelOpen, setActiveNav } = useUi();

  // Close on outside click — same pattern as Header's search/avatar popovers.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const activeMonitors = useMemo(() => monitors.filter((m) => !m.paused), [monitors]);
  const totalAlerts = useMemo(
    () => monitors.reduce((acc, m) => acc + (m.alerts_count > 0 ? m.alerts_count : 0), 0),
    [monitors],
  );
  const hasAlerts = totalAlerts > 0;

  const briefTitleFor = (m: Monitor): string => {
    if (!m.brief_id) return '(no brief)';
    const b = briefs.find((x) => x.id === m.brief_id);
    return b?.thesis ?? b?.question ?? '(brief unavailable)';
  };

  const onJumpToBrief = (m: Monitor) => {
    if (!m.brief_id) return;
    setActiveBrief(m.brief_id);
    setExpandedBrief(m.brief_id);
    setRightPanelMode('thread');
    setRightPanelOpen(true);
    setActiveNav('analyze');
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} title="Active monitors"
        style={{
          height: 32, padding: `0 ${SPACE.md}px`,
          background: hasAlerts ? F.fenwaySoft : F.surface,
          color: hasAlerts ? F.fenway : F.fg,
          border: `1px solid ${hasAlerts ? F.fenway : F.border}`,
          fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 600,
          cursor: 'pointer', borderRadius: RADIUS.md,
          display: 'flex', alignItems: 'center', gap: SPACE.xs + 2,
          boxShadow: F.shadowSoft,
        }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
          {activeMonitors.length}
        </span>
        {hasAlerts && (
          <span style={{
            width: 8, height: 8, borderRadius: RADIUS.pill, background: F.red,
            marginLeft: 2,
            animation: 'dot-pulse 1.2s ease-in-out infinite',
          }} />
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: SPACE['3xl'] + SPACE.xs, right: 0,
          width: 380, maxHeight: 420, overflowY: 'auto',
          background: F.surface,
          border: `1px solid ${F.borderStrong}`, borderRadius: RADIUS.md,
          boxShadow: F.shadowPop,
          zIndex: 50,
        }}>
          <div style={{
            padding: `${SPACE.md}px ${SPACE.md}px`, borderBottom: `1px solid ${F.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md, fontWeight: 600, color: F.ink,
            }}>
              Monitors
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgMuted,
              letterSpacing: TRACKING.caps,
            }}>
              {activeMonitors.length} active
            </span>
          </div>
          {monitors.length === 0 && (
            <div style={{
              padding: `${SPACE.xl}px ${SPACE.md}px`, textAlign: 'center',
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgFaint,
            }}>
              No active monitors.
            </div>
          )}
          {monitors.map((m) => {
            const next = m.next_fire_at ? new Date(m.next_fire_at) : null;
            const last = m.last_fired ? new Date(m.last_fired) : null;
            const cadence = m.config.schedule ?? 'weekly';
            return (
              <div key={m.id}
                style={{
                  padding: `${SPACE.md}px ${SPACE.md}px`, borderBottom: `1px solid ${F.border}`,
                  display: 'flex', alignItems: 'flex-start', gap: SPACE.md,
                  background: m.alerts_count > 0 ? F.fenwaySoft : 'transparent',
                }}>
                <div style={{ flex: 1, minWidth: 0, cursor: m.brief_id ? 'pointer' : 'default' }} onClick={() => onJumpToBrief(m)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs + 2, marginBottom: 3 }}>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
                      color: m.kind === 'watch' ? F.fenway : F.accent,
                      background: m.kind === 'watch' ? F.fenwaySoft : F.accentSoft,
                      padding: `1px ${SPACE.xs + 2}px`, borderRadius: RADIUS.sm,
                      letterSpacing: TRACKING.micro, textTransform: 'uppercase',
                    }}>{m.kind === 'watch' ? 'WATCH' : 'RE-RUN'}</span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
                      letterSpacing: TRACKING.caps, textTransform: 'uppercase', fontWeight: 600,
                    }}>{cadence}</span>
                    {m.alerts_count > 0 && (
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
                        color: F.surface, background: F.fenway,
                        padding: `1px ${SPACE.xs + 2}px`, borderRadius: RADIUS.pill,
                        letterSpacing: TRACKING.caps,
                      }}>{m.alerts_count} alert{m.alerts_count === 1 ? '' : 's'}</span>
                    )}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 500, color: F.ink,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{briefTitleFor(m)}</div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
                  }}>
                    {m.paused
                      ? 'Paused'
                      : next ? `Next ${relativeTime(next)}` : 'Pending'}
                    {last && ` · last ${relativeTime(last)}`}
                  </div>
                </div>
                <button onClick={() => void pauseMonitor(m.id, !m.paused)}
                  style={{
                    padding: `${SPACE.xs}px ${SPACE.sm}px`, flexShrink: 0,
                    background: m.paused ? F.fenway : 'transparent',
                    color: m.paused ? F.surface : F.fgMuted,
                    border: `1px solid ${m.paused ? F.fenway : F.border}`,
                    borderRadius: RADIUS.sm,
                    fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 500,
                    cursor: 'pointer',
                  }}>{m.paused ? 'Resume' : 'Pause'}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
