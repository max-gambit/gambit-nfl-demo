import { F } from '../theme/fenway';
import type { Session } from '@shared/types';
import { useBookmarks, useBriefs } from '../store';

interface RailSessionsProps {
  sessions: Session[];
  expanded: boolean;
  onToggle: () => void;
  onNew: () => void;
  onSelect?: (id: string) => void;
}

export function RailSessions({ sessions, expanded, onToggle, onNew, onSelect }: RailSessionsProps) {
  const { bookmarkedBriefIds } = useBookmarks();
  const { briefs, setActiveBrief } = useBriefs();

  // Saved briefs: derive from the loaded briefs list. If a bookmarked brief
  // belongs to a session that hasn't been loaded yet, it just won't appear
  // until the user visits that session — Phase 5 doesn't cross-load briefs.
  const savedBriefs = briefs.filter((b) => bookmarkedBriefIds.has(b.id));

  return (
    <div style={{ borderBottom: `1px solid ${F.border}` }}>
      {savedBriefs.length > 0 && (
        <div style={{
          padding: '10px 12px 8px',
          borderBottom: `1px solid ${F.border}`,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
          }}>
            <span style={{ fontSize: 11, color: F.fenway, lineHeight: 1 }}>★</span>
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600,
              color: F.ink, letterSpacing: '0.01em',
            }}>Saved</span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: F.fgMuted,
              fontVariantNumeric: 'tabular-nums',
            }}>{savedBriefs.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 2 }}>
            {savedBriefs.map((b) => (
              <button key={b.id} onClick={() => setActiveBrief(b.id)}
                title={b.thesis ?? b.question}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px',
                  background: 'transparent', border: '1px solid transparent',
                  borderRadius: 6, cursor: 'pointer', textAlign: 'left',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = F.cream50; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <span style={{
                  fontFamily: 'var(--font-sans)', fontSize: 12,
                  color: F.fg, fontWeight: 400,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  flex: 1, minWidth: 0,
                }}>{b.label || b.thesis || b.question}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onToggle}
        style={{
          width: '100%', height: expanded ? 'auto' : 40,
          padding: expanded ? '12px 12px 10px' : '0 12px',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke={F.fgMuted} strokeWidth="2.25" strokeLinecap="round"
          style={{
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform .15s',
            flexShrink: 0,
          }}>
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 12, fontWeight: 600,
          color: F.ink, letterSpacing: '0.01em',
        }}>Sessions</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, color: F.fgMuted,
          fontVariantNumeric: 'tabular-nums',
        }}>{sessions.length}</span>
        <div style={{ flex: 1 }} />
        <span
          onClick={(e) => { e.stopPropagation(); onNew(); }}
          title="New session"
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '3px 8px',
            background: F.fenway, color: F.surface,
            border: 'none', borderRadius: 6,
            fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 500,
            cursor: 'pointer',
            boxShadow: F.shadowSoft,
          }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New
        </span>
      </button>

      {expanded && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {sessions.map((s) => (
            <button key={s.id} onClick={() => onSelect?.(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 10px',
                background: s.active ? F.surface : 'transparent',
                border: s.active ? `1px solid ${F.border}` : '1px solid transparent',
                borderLeft: s.active ? `2px solid ${F.fenway}` : '2px solid transparent',
                borderRadius: 6,
                boxShadow: s.active ? F.shadowSoft : 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}>
              {s.active && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9.5, color: F.fenway,
                  fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                  flexShrink: 0,
                }}>Active</span>
              )}
              <span style={{
                fontFamily: 'var(--font-sans)', fontSize: 12.5,
                color: s.active ? F.ink : F.fg,
                fontWeight: s.active ? 500 : 400,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                flex: 1, minWidth: 0,
              }}>{s.label}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 10, color: F.fgMuted,
                fontVariantNumeric: 'tabular-nums', flexShrink: 0,
              }}>{s.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
