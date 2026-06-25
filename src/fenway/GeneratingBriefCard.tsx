import { useEffect, useState } from 'react';
import { F } from '../theme/fenway';
import type { BriefProgress, BriefProgressEvent } from '@shared/types';

interface Props {
  question: string;
  startedAt: string; // ISO timestamp
  progress?: BriefProgress | null;
}

function fallbackPct(elapsed: number): number {
  if (elapsed < 5) return 4;
  if (elapsed < 15) return 8;
  return 12;
}

function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
}

function eventTone(kind: BriefProgressEvent['kind']): string {
  switch (kind) {
    case 'data': return F.positive;
    case 'tool': return F.accent;
    case 'model': return F.fenway;
    case 'write': return F.fg;
    case 'error': return F.red;
    case 'stage':
    default: return F.fgMuted;
  }
}

export function GeneratingBriefCard({ question, startedAt, progress }: Props) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.round((Date.now() - start) / 1000)));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, [startedAt]);

  const pct = progress ? Math.max(0, Math.min(99, progress.pct)) : fallbackPct(elapsed);
  const currentLabel = progress?.label ?? 'Starting analyst job';
  const currentDetail = progress?.detail ?? 'Waiting for the first live progress signal from the backend.';
  const events = progress?.events ?? [];
  const visibleEvents = events.slice(-6);

  return (
    <div style={{
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
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: F.ink }}>
            Gambit Analyst
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: F.fgMuted, marginTop: 1 }}>
            Opus 4.7 · {elapsed}s · {pct}%
          </div>
        </div>
        <span style={{
          width: 8, height: 8, borderRadius: 999, background: F.fenway,
          animation: 'dot-pulse 1.2s ease-in-out infinite',
        }} />
      </div>

      <div style={{
        fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 600,
        color: F.fenway, letterSpacing: '0.08em', textTransform: 'uppercase',
        marginBottom: 7,
      }}>
        {currentLabel}
      </div>

      <p style={{
        margin: 0, fontFamily: 'var(--font-display)', fontSize: 17, lineHeight: 1.45,
        color: F.fgMuted, fontWeight: 500, letterSpacing: '-0.005em', fontStyle: 'italic',
      }}>
        {question}
      </p>

      <div style={{
        marginTop: 16,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, marginBottom: 6,
          fontFamily: 'var(--font-mono)', fontSize: 10.5, color: F.fgMuted,
        }}>
          <span>{currentDetail}</span>
          <span style={{ color: F.ink, fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
        </div>
        <div style={{ height: 6, background: F.cream100, borderRadius: 999, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            minWidth: pct > 0 ? 8 : 0,
            background: F.fenway,
            borderRadius: 999,
            transition: 'width 420ms ease',
          }} />
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gap: 7 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 10,
          color: F.fgMuted, letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          Live work log
        </div>
        {visibleEvents.length ? (
          <div style={{ display: 'grid', gap: 6 }}>
            {visibleEvents.map((event, index) => (
              <div key={`${event.at}-${event.phase}-${event.label}-${index}`} style={{
                display: 'grid',
                gridTemplateColumns: '54px 8px minmax(0, 1fr)',
                gap: 8,
                alignItems: 'baseline',
                fontFamily: 'var(--font-sans)',
                fontSize: 12,
                color: F.inkSoft,
                lineHeight: 1.35,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: F.fgMuted,
                  fontVariantNumeric: 'tabular-nums',
                }}>{formatEventTime(event.at)}</span>
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: eventTone(event.kind),
                  alignSelf: 'center',
                }} />
                <span>
                  <span style={{ fontWeight: 600, color: F.ink }}>{event.label}</span>
                  {event.detail ? <span style={{ color: F.fgMuted }}> · {event.detail}</span> : null}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 10.5,
            color: F.fgFaint, letterSpacing: '0.02em',
          }}>
            Sources, options, and watch-points will land in this card when the analyst finishes.
          </div>
        )}
      </div>
    </div>
  );
}
