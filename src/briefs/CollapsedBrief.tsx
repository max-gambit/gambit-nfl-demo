import { F } from '../theme/fenway';
import type { Brief } from '@shared/types';

interface CollapsedBriefProps {
  brief: Brief;
  onJump?: () => void;
}

export function CollapsedBrief({ brief, onJump }: CollapsedBriefProps) {
  const time = brief.when ? (brief.when.split(' · ')[1] || brief.when) : '';
  return (
    <div style={{ marginBottom: 14 }}>
      {/* User question — quieted */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <div style={{ maxWidth: '70%', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 9.5, color: F.fgFaint,
              marginBottom: 2, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>You · {time}</div>
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: 13, lineHeight: 1.5,
              color: F.fgMuted, fontWeight: 500,
            }}>{brief.question}</div>
          </div>
          <div style={{ width: 2, alignSelf: 'stretch', background: F.border, borderRadius: 1, marginTop: 14 }} />
        </div>
      </div>

      <div onClick={onJump} style={{
        background: F.surface, border: `1px solid ${F.border}`,
        borderRadius: 10, padding: '10px 16px',
        boxShadow: F.shadowSoft,
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 12,
        transition: 'all .15s',
      }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={F.fgMuted} strokeWidth="2.25" strokeLinecap="round" style={{ flexShrink: 0 }}>
          <path d="M9 6l6 6-6 6" />
        </svg>
        <div style={{
          width: 22, height: 22, background: F.ink, color: F.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
          borderRadius: 999, flexShrink: 0,
        }}>G</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600, color: F.fgMuted,
            letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0,
          }}>
            Working thesis
          </span>
          <span style={{
            fontFamily: 'var(--font-display)', fontSize: 13.5, color: F.ink, fontWeight: 500,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: 1, minWidth: 0,
          }}>{brief.thesis}</span>
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, color: F.fgFaint,
          fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em',
          flexShrink: 0,
        }}>
          {brief.sources} sources · {brief.duration}
        </span>
      </div>
    </div>
  );
}
