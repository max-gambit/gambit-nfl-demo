import { useEffect, useMemo, useRef, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { fire } from '../lib/events';
import { useBriefs, useMonitors, useSessions, useUi } from '../store';
import { renameSession } from '../api/sessions';

/**
 * Phase 9 — channel header strip at the top of the Analyze surface. Replaces
 * the old "open briefs working set" tabs (BriefTabs.tsx). Shows:
 *   - `# {channel.label}` (click to rename)
 *   - brief count
 *   - active monitor count for this channel
 *   - "+ New brief" shortcut (focuses the channel composer)
 *   - "⇉ Toggle right panel" affordance
 */
export function ChannelHeader() {
  const { briefs } = useBriefs();
  const { sessions, activeSessionId, patchSessionLabel } = useSessions();
  const { monitors } = useMonitors();
  const { rightPanelOpen, setRightPanelOpen } = useUi();

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;

  const channelBriefIds = useMemo(
    () => new Set(briefs.filter((b) => b.session_id === activeSessionId).map((b) => b.id)),
    [briefs, activeSessionId],
  );
  const channelMonitorCount = useMemo(
    () => monitors.filter((m) => !m.paused && m.brief_id && channelBriefIds.has(m.brief_id)).length,
    [monitors, channelBriefIds],
  );

  if (!session) return null;

  return (
    <div style={{
      height: 40,
      padding: `0 ${SPACE.lg}px`,
      background: F.paper,
      borderBottom: `1px solid ${F.border}`,
      display: 'flex', alignItems: 'center', gap: SPACE.md,
      flexShrink: 0,
    }}>
      <span aria-hidden="true" style={{
        fontFamily: 'var(--font-mono)', fontSize: TYPE.body.md, fontWeight: 600, color: F.fenway,
      }}>#</span>

      <EditableLabel
        sessionId={session.id}
        label={session.label}
        onRename={(next) => {
          patchSessionLabel(session.id, next);
          renameSession(session.id, next).catch((err) => {
            console.warn('[channel-header] rename failed', err);
          });
        }}
      />

      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgMuted,
        letterSpacing: TRACKING.caps,
      }}>· {channelBriefIds.size} brief{channelBriefIds.size === 1 ? '' : 's'}</span>

      {channelMonitorCount > 0 && (
        <span title={`${channelMonitorCount} active monitor${channelMonitorCount === 1 ? '' : 's'} on briefs in this channel`}
          style={{
            display: 'flex', alignItems: 'center', gap: SPACE.xs,
            padding: `2px ${SPACE.sm}px`,
            background: F.fenwaySoft, color: F.fenway,
            borderRadius: RADIUS.pill,
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 600,
            letterSpacing: TRACKING.caps,
          }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {channelMonitorCount}
        </span>
      )}

      <div style={{ flex: 1 }} />

      <button onClick={() => fire('v6d3cf:focus-composer')}
        title="Ask a new question in this channel (focuses composer)"
        style={{
          padding: `0 ${SPACE.md}px`, height: 28,
          background: F.fenway, color: F.surface,
          border: 'none', borderRadius: RADIUS.md,
          fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 600,
          cursor: 'pointer', letterSpacing: TRACKING.body,
          display: 'flex', alignItems: 'center', gap: SPACE.xs + 2,
        }}>
        <span style={{ fontSize: TYPE.body.md, lineHeight: 1 }}>+</span>
        New brief
      </button>

      <button onClick={() => setRightPanelOpen(!rightPanelOpen)}
        title={rightPanelOpen ? 'Hide right panel' : 'Show right panel'}
        aria-label={rightPanelOpen ? 'Hide right panel' : 'Show right panel'}
        style={{
          padding: 0, width: 28, height: 28,
          background: rightPanelOpen ? F.cream100 : 'transparent',
          border: `1px solid ${F.border}`, borderRadius: RADIUS.md,
          cursor: 'pointer', color: F.fgMuted,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="15" y1="4" x2="15" y2="20" />
        </svg>
      </button>
    </div>
  );
}

interface EditableLabelProps {
  sessionId: string;
  label: string;
  onRename: (next: string) => void;
}

/**
 * Click-to-edit channel label. Renders as a static span until clicked, then
 * swaps to an inline input with the same typography. Enter / blur saves;
 * Escape cancels. Empty/whitespace-only inputs are ignored (label stays put).
 * Resets editing state when the active session changes.
 */
function EditableLabel({ sessionId, label, onRename }: EditableLabelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset editing state when the user navigates to a different channel.
  useEffect(() => {
    setEditing(false);
    setDraft(label);
  }, [sessionId, label]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== label) onRename(next);
    setEditing(false);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(label);
      setEditing(false);
    }
  };

  // Shared typography between view + edit modes so swapping doesn't shift the
  // baseline.
  const sharedStyle: React.CSSProperties = {
    fontFamily: 'var(--font-display)', fontSize: TYPE.body.lg, fontWeight: 600,
    color: F.ink, letterSpacing: TRACKING.tight,
    lineHeight: '20px',
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
        maxLength={80}
        style={{
          ...sharedStyle,
          padding: `2px ${SPACE.sm}px`,
          border: `1px solid ${F.fenway}`,
          background: F.surface,
          borderRadius: RADIUS.sm,
          outline: 'none',
          width: Math.min(420, Math.max(120, draft.length * 9 + 32)),
          maxWidth: 480,
        }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      title="Click to rename channel"
      style={{
        ...sharedStyle,
        padding: `2px ${SPACE.sm}px`,
        margin: `-2px -${SPACE.sm}px`,
        background: 'transparent', border: '1px solid transparent',
        cursor: 'text', borderRadius: RADIUS.sm,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        maxWidth: 360, textAlign: 'left',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = F.cream50; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      {label}
    </button>
  );
}
