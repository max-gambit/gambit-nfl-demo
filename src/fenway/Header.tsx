import { useEffect, useRef, useState, type ReactNode } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { useUi } from '../store';
import type { NavTab } from '../store/ui';
import { fire } from '../lib/events';
import { MonitorsPanel } from '../agents/MonitorsPanel';

interface HeaderProps {
  trayBetween?: ReactNode;
}

const TEAM_NAME = 'Golden State Warriors';
const TEAM_LOGO = '/assets/warriors-logo.png';
const USER_NAME = 'Golden State Warriors Front Office';
const USER_INITIALS = 'GSW';

export function Header({ trayBetween }: HeaderProps) {
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);

  const { activeNav, setActiveNav } = useUi();

  const navItems: { id: NavTab; label: string }[] = [
    { id: 'dashboard', label: 'League' },
    { id: 'analyze', label: 'Analyze' },
    { id: 'projects', label: 'Projects' },
    { id: 'database', label: 'Database' },
    { id: 'cba', label: 'CBA' },
  ];
  // Close the avatar popover on outside click.
  useEffect(() => {
    if (!avatarOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (avatarRef.current && !avatarRef.current.contains(t)) setAvatarOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [avatarOpen]);

  return (
    <header style={{
      height: 52,
      padding: `0 ${SPACE.xl}px`,
      background: F.paper,
      borderBottom: `1px solid ${F.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: SPACE.md,
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: SPACE.md,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: `${SPACE.xs}px` }}>
          <img src={TEAM_LOGO} alt={TEAM_NAME} style={{ height: 22, width: 22 }} />
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md, fontWeight: 600,
            color: F.ink, letterSpacing: TRACKING.tight,
          }}>{TEAM_NAME}</span>
        </div>

        <div style={{ width: 1, height: 18, background: F.border, marginLeft: SPACE.xs }} />

        <nav style={{
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          {navItems.map((it) => {
            const isActive = it.id === activeNav;
            return (
              <button key={it.id} onClick={() => setActiveNav(it.id)}
                style={{
                  height: 30, padding: `0 ${SPACE.md}px`,
                  background: 'transparent',
                  color: isActive ? F.ink : F.fg,
                  border: 'none',
                  cursor: 'pointer', borderRadius: RADIUS.md,
                  display: 'flex', alignItems: 'center', gap: SPACE.xs + 2,
                  fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md,
                  fontWeight: isActive ? 600 : 400,
                  position: 'relative',
                }}>
                <span>{it.label}</span>
                {isActive && (
                  <span style={{
                    position: 'absolute', left: SPACE.sm, right: SPACE.sm, bottom: -12,
                    height: 2, background: F.fenway, borderRadius: 1,
                  }} />
                )}
              </button>
            );
          })}
        </nav>

        {trayBetween && (
          <>
            <div style={{
              width: 1, height: 18, background: F.border,
              marginLeft: SPACE.sm, marginRight: SPACE.xs,
            }} />
            {trayBetween}
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
        {/* Persistent ⌘K hint — fires the palette open event so ⌘K stays
            visually anchored even for users who don't know the shortcut. */}
        <button onClick={() => fire('v6d3cf:open-palette')} title="Ask Gambit · run agents · find sources"
          style={{
            height: 32, padding: `0 ${SPACE.md}px`,
            background: F.fenwaySoft, color: F.fenway,
            border: `1px solid ${F.fenway}`,
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 600,
            cursor: 'pointer', borderRadius: RADIUS.md,
            display: 'flex', alignItems: 'center', gap: SPACE.sm,
            boxShadow: F.shadowSoft, letterSpacing: TRACKING.body,
          }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs + 2 }}>
            <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)', fontSize: TYPE.body.md }}>›</span>
            Ask Gambit
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 700,
            color: F.fenway, background: F.surface,
            padding: `2px ${SPACE.xs + 1}px`, borderRadius: RADIUS.sm,
            border: `1px solid ${F.fenway}`,
            letterSpacing: TRACKING.caps,
          }}>⌘K</span>
        </button>
        <MonitorsPanel />
        <div ref={avatarRef} style={{ position: 'relative' }}>
          <button onClick={() => setAvatarOpen((o) => !o)} aria-label="Account menu"
            style={{
              width: 28, height: 28, padding: 0,
              background: F.accent, color: F.surface,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 600,
              border: 'none', borderRadius: RADIUS.pill, cursor: 'pointer',
            }}>{USER_INITIALS}</button>
          {avatarOpen && (
            <div style={{
              position: 'absolute', top: SPACE['3xl'] + 4, right: 0, minWidth: 200,
              background: F.surface,
              border: `1px solid ${F.borderStrong}`, borderRadius: RADIUS.md,
              boxShadow: F.shadowPop,
              padding: `${SPACE.xs}px 0`, zIndex: 50,
            }}>
              <div style={{
                padding: `${SPACE.sm}px ${SPACE.md}px`, borderBottom: `1px solid ${F.border}`,
              }}>
                <div style={{
                  fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md, fontWeight: 600, color: F.ink,
                }}>
                  {USER_NAME}
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgMuted, marginTop: 1,
                }}>
                  Single-tenant prototype
                </div>
              </div>
              <button
                onClick={() => {
                  setActiveNav('settings');
                  setAvatarOpen(false);
                }}
                style={MenuItemStyle}
              >
                Settings
              </button>
              <button disabled style={MenuItemDisabledStyle}>Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const MenuItemDisabledStyle: React.CSSProperties = {
  width: '100%', textAlign: 'left',
  padding: `${SPACE.sm}px ${SPACE.md}px`, background: 'transparent',
  border: 'none', cursor: 'not-allowed',
  fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md,
  color: F.fgFaint,
};

const MenuItemStyle: React.CSSProperties = {
  width: '100%', textAlign: 'left',
  padding: `${SPACE.sm}px ${SPACE.md}px`, background: 'transparent',
  border: 'none', cursor: 'pointer',
  fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md,
  color: F.ink,
};
