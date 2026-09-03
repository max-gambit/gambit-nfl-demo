import { F } from '../theme/fenway';
import type { BriefProgress } from '@shared/types';

interface Props {
  question: string;
  startedAt: string;
  progress?: BriefProgress | null;
}

export function GeneratingBriefCard({ question }: Props) {
  return (
    <div role="status" aria-live="polite" style={{
      background: F.surface, border: `1px solid ${F.border}`,
      borderRadius: 12, padding: '22px 26px', marginBottom: 18,
      boxShadow: F.shadowChat,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 28, height: 28, background: F.ink, color: F.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700,
          borderRadius: 999,
        }}>G</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: F.ink }}>
            Reviewing the question…
          </div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: F.fgMuted, marginTop: 2 }}>
            Gathering the relevant evidence and preparing the answer.
          </div>
        </div>
        <span style={{
          width: 8, height: 8, borderRadius: 999, background: F.fenway,
          animation: 'dot-pulse 1.2s ease-in-out infinite',
        }} />
      </div>

      <p style={{
        margin: 0, fontFamily: 'var(--font-display)', fontSize: 17, lineHeight: 1.45,
        color: F.inkSoft, fontWeight: 500, letterSpacing: '-0.005em',
      }}>
        {question}
      </p>
    </div>
  );
}
