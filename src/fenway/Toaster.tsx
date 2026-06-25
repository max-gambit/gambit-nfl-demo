import { useEffect } from 'react';
import { F } from '../theme/fenway';
import { useToasts } from '../store';
import { setToastHandler } from '../store/toast-bus';
import type { Toast, ToastTone } from '../store/toasts';

const TONE: Record<ToastTone, { bg: string; border: string; accent: string; tag: string }> = {
  info:    { bg: F.surface, border: F.borderStrong, accent: F.fenway, tag: 'NOTE' },
  error:   { bg: F.surface, border: '#D14545',      accent: '#D14545', tag: 'ERROR' },
  success: { bg: F.surface, border: F.fenway,       accent: F.fenway, tag: 'OK' },
};

const DEFAULT_TTL = 4000;

function ToastRow({ toast }: { toast: Toast }) {
  const { dismissToast } = useToasts();
  const tone = TONE[toast.tone];

  useEffect(() => {
    const ttl = toast.ttl_ms ?? DEFAULT_TTL;
    const t = setTimeout(() => dismissToast(toast.id), ttl);
    return () => clearTimeout(t);
  }, [toast.id, toast.ttl_ms, dismissToast]);

  return (
    <div role="status" style={{
      minWidth: 280, maxWidth: 380,
      background: tone.bg, color: F.ink,
      border: `1px solid ${tone.border}`,
      borderLeft: `3px solid ${tone.accent}`,
      borderRadius: 8, padding: '10px 12px',
      boxShadow: '0 12px 32px rgba(20, 16, 8, 0.16), 0 1px 3px rgba(20, 16, 8, 0.06)',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700,
          color: tone.accent, letterSpacing: '0.06em',
        }}>{tone.tag}</span>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500,
          color: F.ink, flex: 1, lineHeight: 1.35,
        }}>{toast.message}</span>
        <button onClick={() => dismissToast(toast.id)} aria-label="Dismiss" style={{
          padding: 0, width: 18, height: 18,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: F.fgFaint,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 14, lineHeight: 1,
        }}>×</button>
      </div>
      {toast.detail && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, color: F.fgMuted,
          lineHeight: 1.4, paddingLeft: 28,
        }}>{toast.detail}</div>
      )}
    </div>
  );
}

export function Toaster() {
  const { toasts, pushToast } = useToasts();

  // Bridge: register a handler that non-UI code (slice actions, api wrappers)
  // can use via `toast()` from store/toast-bus. Idempotent — overwrite is fine.
  useEffect(() => {
    setToastHandler(pushToast);
    return () => setToastHandler(null);
  }, [pushToast]);

  if (toasts.length === 0) return null;
  return (
    <div style={{
      position: 'fixed', top: 64, right: 18, zIndex: 200,
      display: 'flex', flexDirection: 'column', gap: 8,
      pointerEvents: 'none',
    }}>
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <ToastRow toast={t} />
        </div>
      ))}
    </div>
  );
}
