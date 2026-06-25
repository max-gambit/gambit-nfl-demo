import { useEffect } from 'react';
import { F } from '../theme/fenway';

interface KeyboardHelpProps {
  open: boolean;
  onClose: () => void;
}

export function KeyboardHelp({ open, onClose }: KeyboardHelpProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const sections: Array<{
    title: string;
    items: Array<{ keys: string[]; label: string; muted?: boolean; asNote?: boolean }>;
  }> = [
    {
      title: 'Navigation',
      items: [
        { keys: ['⌘', 'K'], label: 'Open command palette' },
        { keys: ['⌘', '1'], label: 'Jump to brief 1' },
        { keys: ['⌘', '2'], label: 'Jump to brief 2', muted: true },
        { keys: ['⌘', '…'], label: 'up to ⌘9', muted: true, asNote: true },
        { keys: ['⌘', '['], label: 'Previous brief' },
        { keys: ['⌘', ']'], label: 'Next brief' },
        { keys: ['⌘', '⇧', 'K'], label: 'Reopen most recent brief' },
      ],
    },
    {
      title: 'Authoring',
      items: [
        { keys: ['⌘', 'J'], label: 'Focus composer' },
        { keys: ['⌘', '↵'], label: 'Send to assistant' },
        { keys: ['⌘', '/'], label: 'Toggle this help' },
      ],
    },
  ];

  return (
    <div onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(20, 18, 14, 0.42)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'help-fade 140ms ease-out',
      }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{
          width: 460, background: F.paper,
          border: `1px solid ${F.borderStrong}`,
          borderRadius: 10, boxShadow: F.shadowChat,
          overflow: 'hidden',
        }}>
        <div style={{
          height: 36, padding: '0 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${F.border}`,
          background: F.cream50,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase', color: F.fgMuted,
          }}>Keyboard shortcuts</span>
          <button onClick={onClose} style={{
            width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: F.fgMuted, borderRadius: 4,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div style={{ padding: '14px 18px 18px' }}>
          {sections.map((sec, si) => (
            <div key={sec.title} style={{ marginTop: si === 0 ? 0 : 16 }}>
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 600,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                color: F.fenway, marginBottom: 8,
              }}>{sec.title}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sec.items.map((it, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '4px 0',
                  }}>
                    <span style={{
                      fontSize: 13, fontFamily: 'var(--font-sans)',
                      color: it.muted ? F.fgMuted : F.fg,
                      fontStyle: it.asNote ? 'italic' : 'normal',
                    }}>{it.label}</span>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {it.keys.map((k, ki) => (
                        <kbd key={ki} style={{
                          minWidth: 22, height: 22, padding: '0 6px',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
                          color: F.ink,
                          background: F.surface,
                          border: `1px solid ${F.border}`,
                          borderBottomColor: F.borderStrong,
                          borderRadius: 4,
                          boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.04)',
                        }}>{k}</kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{
            marginTop: 16, paddingTop: 12,
            borderTop: `1px dashed ${F.border}`,
            fontFamily: 'var(--font-mono)', fontSize: 10, color: F.fgMuted,
            letterSpacing: '0.04em',
          }}>
            Press <kbd style={{
              padding: '1px 5px', fontFamily: 'var(--font-mono)', fontSize: 10,
              background: F.surface, border: `1px solid ${F.border}`, borderRadius: 3,
            }}>esc</kbd> to dismiss
          </div>
        </div>
      </div>
    </div>
  );
}
