import { F } from '../theme/fenway';

interface BriefBannerProps {
  state: 'partial' | 'failed';
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function BriefBanner({ state, onRetry, onDismiss }: BriefBannerProps) {
  const isFailed = state === 'failed';
  const accent = isFailed ? F.red : F.amber;
  const accentSoft = isFailed ? 'rgba(184,59,46,0.08)' : 'rgba(198,138,26,0.10)';
  const tag = isFailed ? 'BRIEF INCOMPLETE' : '1 SOURCE UNAVAILABLE';
  const headline = isFailed
    ? 'Connection to the cap-data feed dropped mid-stream.'
    : 'Cap data is live, but the 2024 CBA snapshot did not load in time.';
  const detail = isFailed
    ? "We've kept what was generated so far below — treat it as draft. The full brief needs a re-run."
    : 'The working thesis still has support in current cap data, but two CBA citations are unverified. Re-run to refresh.';
  const detailMuted = isFailed
    ? 'Spotrac · partial · 13:42'
    : 'CBA Article VII §7.1 · expected from CBA Reference';

  return (
    <div style={{
      marginBottom: 16,
      borderLeft: `3px solid ${accent}`,
      background: accentSoft,
      borderRadius: '0 8px 8px 0',
      padding: '11px 14px 12px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700,
          letterSpacing: '0.10em', color: accent,
        }}>{tag}</span>
        <span style={{ flex: 1 }} />
        <button onClick={onRetry} style={{
          padding: '3px 9px', background: 'transparent',
          border: `1px solid ${accent}`, borderRadius: 999,
          fontFamily: 'var(--font-sans)', fontSize: 11, color: accent,
          fontWeight: 600, cursor: 'pointer',
        }}>↻ Retry</button>
        {!isFailed && (
          <button onClick={onDismiss} style={{
            padding: '3px 9px', background: 'transparent', border: 'none',
            fontFamily: 'var(--font-sans)', fontSize: 11, color: F.fgMuted,
            fontWeight: 500, cursor: 'pointer',
          }}>Dismiss</button>
        )}
      </div>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: F.ink, fontWeight: 500, lineHeight: 1.45 }}>
        {headline}
      </div>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: F.inkSoft, marginTop: 3, lineHeight: 1.5 }}>
        {detail}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: F.fgMuted, marginTop: 6, letterSpacing: '0.02em' }}>
        {detailMuted}
      </div>
    </div>
  );
}
