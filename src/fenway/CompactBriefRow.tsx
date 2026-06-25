import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { useBriefs } from '../store';
import type { Brief } from '@shared/types';

interface Props {
  brief: Brief;
  /** Click handler. Receives the event so callers can FLIP-anchor the row's
   *  pre-click bounding rect against the post-expand focused card. */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * Phase 9 — compact one-line summary for non-focused briefs in the channel
 * feed. Click to focus (expand). Status dots for `generating` / `failed`,
 * reply count pill on the right when there's chat history.
 */
export function CompactBriefRow({ brief, onClick }: Props) {
  const { turnsByBrief } = useBriefs();
  const replyCount = (turnsByBrief[brief.id] ?? []).length;
  const isGenerating = brief.status === 'generating';
  const isFailed = brief.status === 'failed';

  return (
    <button onClick={onClick} data-brief-id={brief.id}
      style={{
        width: '100%',
        marginBottom: SPACE.sm,
        padding: `${SPACE.md}px ${SPACE.lg}px`,
        background: F.surface,
        border: `1px solid ${F.border}`,
        borderRadius: RADIUS.md,
        boxShadow: F.shadowSoft,
        cursor: 'pointer', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: SPACE.md,
        transition: 'border-color 120ms ease, background 120ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = F.borderStrong;
        e.currentTarget.style.background = F.cream50;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = F.border;
        e.currentTarget.style.background = F.surface;
      }}>
      {isGenerating ? (
        <span title="Generating…" style={{
          width: 8, height: 8, borderRadius: RADIUS.pill,
          background: F.fenway, flexShrink: 0,
          animation: 'dot-pulse 1.2s ease-in-out infinite',
        }} />
      ) : isFailed ? (
        <span title="Failed" style={{
          width: 8, height: 8, borderRadius: RADIUS.pill,
          background: F.red, flexShrink: 0,
        }} />
      ) : (
        <span style={{
          width: 8, height: 8, borderRadius: RADIUS.pill,
          background: F.cream100, flexShrink: 0,
        }} />
      )}
      <span style={{
        flex: 1, minWidth: 0,
        fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md,
        color: F.inkSoft, fontWeight: 500,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{brief.thesis ?? brief.question}</span>
      {brief.mode === 'data_analyst' && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, color: F.positive,
          background: F.positiveSoft, padding: `2px ${SPACE.xs + 2}px`,
          borderRadius: RADIUS.pill, flexShrink: 0,
          letterSpacing: TRACKING.micro, textTransform: 'uppercase', fontWeight: 700,
        }}>Data</span>
      )}
      {replyCount > 0 && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
          fontVariantNumeric: 'tabular-nums', flexShrink: 0,
          letterSpacing: TRACKING.caps,
        }}>{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
      )}
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, color: F.fgFaint,
        flexShrink: 0, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
      }}>Expand ›</span>
    </button>
  );
}
