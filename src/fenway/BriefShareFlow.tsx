import { useEffect, useMemo, useRef, useState } from 'react';
import { createBriefShareLink, getBriefShareSnapshot, revokeBriefShare, shareBriefWithRecipient } from '../api/briefs';
import { Icon } from '../ds/Icon';
import { useToasts } from '../store';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import type { BriefShare, BriefShareLink, BriefShareSnapshot, TeamMember } from '@shared/types';

interface BriefShareFlowProps {
  briefId: string | null;
}

export function BriefShareFlow({ briefId }: BriefShareFlowProps) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<BriefShareSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pushToast } = useToasts();

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current && !ref.current.contains(target)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!open || !briefId) return;
    let cancelled = false;
    setLoading(true);
    getBriefShareSnapshot(briefId)
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch((err) => {
        if (!cancelled) {
          pushToast({
            tone: 'error',
            message: 'Couldn’t load share settings',
            detail: err instanceof Error ? err.message : 'Server error.',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [briefId, open, pushToast]);

  const sharedByMember = useMemo(() => {
    const map = new Map<string, BriefShare>();
    for (const share of snapshot?.recipient_shares ?? []) {
      if (share.team_member_id) map.set(share.team_member_id, share);
    }
    return map;
  }, [snapshot]);

  const members = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const all = snapshot?.team_members ?? [];
    if (!normalized) return all;
    return all.filter((member) => (
      member.name.toLowerCase().includes(normalized) ||
      (member.role ?? '').toLowerCase().includes(normalized) ||
      (member.email ?? '').toLowerCase().includes(normalized)
    ));
  }, [query, snapshot]);

  const addRecipient = async (member: TeamMember) => {
    if (!briefId || sharedByMember.has(member.id)) return;
    setBusyId(member.id);
    try {
      const share = await shareBriefWithRecipient(briefId, { team_member_id: member.id });
      setSnapshot((current) => current && {
        ...current,
        recipient_shares: mergeShare(current.recipient_shares, share),
      });
      pushToast({
        tone: 'success',
        message: `Shared with ${member.name}`,
        detail: 'They now appear in this brief’s share list.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t share brief',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const removeRecipient = async (share: BriefShare) => {
    if (!briefId) return;
    setBusyId(share.id);
    try {
      await revokeBriefShare(briefId, share.id);
      setSnapshot((current) => current && {
        ...current,
        recipient_shares: current.recipient_shares.filter((item) => item.id !== share.id),
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t remove access',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const copyLink = async () => {
    if (!briefId) return;
    setBusyId('link');
    try {
      const link = snapshot?.link ?? await createBriefShareLink(briefId);
      setSnapshot((current) => current && { ...current, link });
      await navigator.clipboard.writeText(shareUrl(link));
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1600);
      pushToast({
        tone: 'success',
        message: 'Share link copied',
        detail: 'Anyone with the prototype link can open this brief.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t copy link',
        detail: err instanceof Error ? err.message : 'Clipboard or server error.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const exportPdf = () => {
    if (!briefId) return;
    const target = document.querySelector<HTMLElement>(
      `[data-brief-id="${briefId}"] [data-recommendation-card="true"]`,
    );
    if (!target) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t prepare PDF',
        detail: 'Open the brief card in the feed, then try export again.',
      });
      return;
    }

    const cleanup = () => {
      target.removeAttribute('data-print-target');
      document.body.classList.remove('gambit-printing');
    };
    target.setAttribute('data-print-target', 'true');
    document.body.classList.add('gambit-printing');
    window.addEventListener('afterprint', cleanup, { once: true });
    requestAnimationFrame(() => {
      window.print();
      window.setTimeout(cleanup, 1000);
    });
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((next) => !next)}
        disabled={!briefId}
        title="Share this brief"
        style={actionButtonStyle(open)}
        onMouseEnter={(event) => { if (briefId) event.currentTarget.style.background = F.cream50; }}
        onMouseLeave={(event) => { event.currentTarget.style.background = open ? F.cream50 : 'transparent'; }}
      >
        <Icon name="share" size={13} />
        Share
      </button>
      {open && briefId && (
        <div style={popoverStyle} onClick={(event) => event.stopPropagation()}>
          <SectionHeader icon="user-plus" label="People" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a teammate..."
            style={searchInputStyle}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs, minHeight: 92 }}>
            {loading && (
              <div style={emptyStyle}>Loading team...</div>
            )}
            {!loading && members.map((member) => {
              const share = sharedByMember.get(member.id) ?? null;
              const busy = busyId === member.id || busyId === share?.id;
              return (
                <div key={member.id} style={memberRowStyle(Boolean(share))}>
                  <div style={avatarStyle}>{member.avatar_initials ?? initials(member.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={memberNameStyle}>{member.name}</div>
                    <div style={memberMetaStyle}>{member.role ?? member.email ?? 'Team member'}</div>
                  </div>
                  {share ? (
                    <button
                      onClick={() => void removeRecipient(share)}
                      disabled={busy}
                      style={smallButtonStyle(false)}
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={() => void addRecipient(member)}
                      disabled={busy}
                      style={smallButtonStyle(true)}
                    >
                      Add
                    </button>
                  )}
                </div>
              );
            })}
            {!loading && members.length === 0 && (
              <div style={emptyStyle}>No teammates match that search.</div>
            )}
          </div>

          <div style={dividerStyle} />
          <SectionHeader icon="link" label="Link" />
          <div style={linkRowStyle}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={linkTitleStyle}>Share link</div>
              <div style={linkTextStyle}>{snapshot?.link ? shareUrl(snapshot.link) : 'Create a link to this brief.'}</div>
            </div>
            <button onClick={() => void copyLink()} disabled={busyId === 'link'} style={smallButtonStyle(true)}>
              {linkCopied ? 'Copied' : 'Copy link'}
            </button>
          </div>

          <div style={dividerStyle} />
          <SectionHeader icon="file-down" label="Export" />
          <button onClick={exportPdf} style={exportButtonStyle}>
            Export PDF
          </button>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: SPACE.xs + 2,
      fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
      color: F.fgMuted, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
      marginBottom: SPACE.xs + 2,
    }}>
      <Icon name={icon} size={12} />
      {label}
    </div>
  );
}

function mergeShare(shares: BriefShare[], share: BriefShare): BriefShare[] {
  if (shares.some((item) => item.id === share.id)) return shares;
  return [...shares, share];
}

function shareUrl(link: BriefShareLink): string {
  return `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(link.token)}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function actionButtonStyle(on: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 28,
    padding: '0 9px',
    background: on ? F.cream50 : 'transparent',
    border: `1px solid ${on ? F.borderStrong : F.border}`,
    borderRadius: 6,
    fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 600,
    color: on ? F.fenway : F.inkSoft,
    cursor: 'pointer',
    opacity: 1,
    whiteSpace: 'nowrap',
  };
}

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  zIndex: 40,
  width: 340,
  background: F.surface,
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.md,
  boxShadow: F.shadowPop,
  padding: SPACE.md,
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  height: 30,
  padding: `0 ${SPACE.sm}px`,
  marginBottom: SPACE.sm,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  outline: 'none',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.ink,
};

function memberRowStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: SPACE.sm,
    padding: SPACE.sm,
    background: active ? F.fenwaySoft : F.cream50,
    border: `1px solid ${active ? F.fenway : F.border}`,
    borderRadius: RADIUS.md,
  };
}

const avatarStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: RADIUS.pill,
  background: F.surface,
  border: `1px solid ${F.border}`,
  color: F.fenway,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.md,
  fontWeight: 700,
};

const memberNameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.ink,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const memberMetaStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
  marginTop: 1,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

function smallButtonStyle(primary: boolean): React.CSSProperties {
  return {
    padding: `${SPACE.xs}px ${SPACE.sm + 2}px`,
    background: primary ? F.fenway : F.surface,
    color: primary ? F.surface : F.fg,
    border: `1px solid ${primary ? F.fenway : F.border}`,
    borderRadius: RADIUS.md,
    fontFamily: 'var(--font-sans)',
    fontSize: TYPE.body.sm,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

const emptyStyle: React.CSSProperties = {
  padding: `${SPACE.md}px ${SPACE.sm}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.fgMuted,
  textAlign: 'center',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: F.border,
  margin: `${SPACE.md}px 0`,
};

const linkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.sm,
  padding: SPACE.sm,
  background: F.cream50,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
};

const linkTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.ink,
  fontWeight: 600,
};

const linkTextStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
  marginTop: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const exportButtonStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  background: F.surface,
  color: F.ink,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 600,
  cursor: 'pointer',
};
