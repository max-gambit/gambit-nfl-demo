import { useState } from 'react';
import { F } from '../theme/fenway';
import { regenerateBrief } from '../api/briefs';
import { useToasts } from '../store';

interface Props {
  briefId: string;
  question: string;
  errorMessage: string | null;
}

/**
 * Rendered when a brief's status has flipped to 'failed' — usually because the
 * server crashed mid-generation or the stale-brief sweeper aged out a stuck
 * row. Preserves the original question and offers a one-click Regenerate so
 * the user doesn't have to re-type or re-create a session.
 */
export function FailedBriefCard({ briefId, question, errorMessage }: Props) {
  const [retrying, setRetrying] = useState(false);
  const { pushToast } = useToasts();

  const onRegenerate = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await regenerateBrief(briefId);
      pushToast({
        tone: 'info',
        message: 'Retrying brief',
        detail: 'Generation restarted. Sources, options, and reasoning will land in ~30–60s.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t restart generation',
        detail: err instanceof Error ? err.message : 'Server unreachable.',
      });
      setRetrying(false);
    }
    // On success the brief flips back to status='generating' via Realtime,
    // which unmounts this card and renders GeneratingBriefCard. So we leave
    // `retrying` true — there's no UI to flip back to.
  };

  return (
    <div style={{
      background: F.surface, border: `1px solid ${F.red}`,
      borderRadius: 12, padding: '22px 26px', marginBottom: 18,
      boxShadow: F.shadowChat,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 28, height: 28, background: F.red, color: '#FFFFFF',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700,
          borderRadius: 999,
        }}>!</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: F.ink }}>
            Brief generation failed
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: F.fgMuted, marginTop: 1 }}>
            Your question is preserved — retry to start a fresh run.
          </div>
        </div>
      </div>

      <div style={{
        fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 600,
        color: F.fgMuted, letterSpacing: '0.08em', textTransform: 'uppercase',
        marginBottom: 7,
      }}>
        Question
      </div>
      <p style={{
        margin: 0, fontFamily: 'var(--font-display)', fontSize: 17, lineHeight: 1.45,
        color: F.fgMuted, fontWeight: 500, letterSpacing: '-0.005em', fontStyle: 'italic',
      }}>
        {question}
      </p>

      {errorMessage && (
        <div style={{
          marginTop: 12, padding: '8px 12px',
          borderLeft: `3px solid ${F.red}`,
          background: 'rgba(184,59,46,0.08)',
          fontFamily: 'var(--font-mono)', fontSize: 11.5, color: F.ink, lineHeight: 1.45,
          borderRadius: '0 6px 6px 0',
        }}>
          {errorMessage}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <button onClick={() => void onRegenerate()} disabled={retrying} style={{
          padding: '8px 16px',
          background: retrying ? F.cream100 : F.fenway,
          color: retrying ? F.fgMuted : '#FFFFFF',
          border: 'none', borderRadius: 7,
          fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600,
          cursor: retrying ? 'wait' : 'pointer',
          letterSpacing: '0.005em',
        }}>
          {retrying ? 'Restarting…' : '↻ Regenerate brief'}
        </button>
      </div>
    </div>
  );
}
