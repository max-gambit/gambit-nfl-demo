import { useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import type { Artifact } from '@shared/types';
import { Icon } from '../ds/Icon';
import { getArtifactUrl } from '../api/agent';

interface ArtifactStripProps {
  artifacts: Artifact[];
}

const ICON_BY_KIND: Record<string, string> = {
  doc: 'doc',
  deck: 'deck',
  data: 'grid',
  staff_protocol: 'clipboard',
};

const KIND_LABEL: Record<string, string> = {
  doc: 'Memo',
  deck: 'Deck',
  data: 'Data',
  staff_protocol: 'Staff protocol',
};

function metaLabel(a: Artifact): string {
  const m = a.meta as Record<string, unknown> | null;
  const ts = new Date(a.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const parts: string[] = [];
  if (m && typeof m === 'object') {
    if (typeof m.slides === 'number') parts.push(`${m.slides} slides`);
    if (typeof m.pages === 'number') parts.push(`${m.pages} ${m.pages === 1 ? 'page' : 'pages'}`);
    if (typeof m.findings === 'number') parts.push(`${m.findings} findings`);
    if (typeof m.staff_questions === 'number') parts.push(`${m.staff_questions} questions`);
    if (typeof m.size_kb === 'number') parts.push(`${m.size_kb} KB`);
  }
  parts.push(ts);
  return parts.join(' · ');
}

/**
 * Phase 11 — Artifacts as an inline section of the brief recommendation card.
 * Dropped the outer card wrapper so it composes inside the parent card without
 * a box-in-box visual; matches the same eyebrow + rows idiom as
 * "Risks & what to watch" / "Strategic options".
 */
export function ArtifactStrip({ artifacts }: ArtifactStripProps) {
  const [openingId, setOpeningId] = useState<string | null>(null);

  const open = async (a: Artifact) => {
    setOpeningId(a.id);
    try {
      const { url } = await getArtifactUrl(a.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      console.error('[artifact] open failed', err);
    } finally {
      setOpeningId(null);
    }
  };

  if (artifacts.length === 0) return null;

  return (
    <div style={{
      marginTop: SPACE.xl,
      paddingTop: SPACE.md,
      borderTop: `1px solid ${F.border}`,
    }}>
      <div style={{
        fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 600,
        color: F.fgMuted, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
        marginBottom: SPACE.sm,
      }}>
        Generated outputs · {artifacts.length}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs + 2 }}>
        {artifacts.map((a) => {
          const icon = ICON_BY_KIND[a.kind] ?? 'doc';
          const kindLabel = KIND_LABEL[a.kind] ?? a.kind;
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: SPACE.sm + 2,
              padding: `${SPACE.sm}px ${SPACE.sm + 2}px`,
              background: F.cream50,
              border: `1px solid ${F.border}`,
              borderRadius: RADIUS.md,
            }}>
              <div style={{
                width: 32, height: 32,
                background: F.surface,
                border: `1px solid ${F.border}`,
                borderRadius: RADIUS.sm,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: F.fg, flexShrink: 0,
              }}>
                <Icon name={icon} size={15} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: SPACE.xs + 2,
                  whiteSpace: 'nowrap', overflow: 'hidden',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 700,
                    color: F.fenway, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
                    flexShrink: 0,
                  }}>{kindLabel}</span>
                  <span style={{
                    fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 500, color: F.ink,
                    overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{a.name}</span>
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
                  marginTop: 1, fontVariantNumeric: 'tabular-nums',
                }}>{metaLabel(a)}</div>
              </div>
              <button onClick={() => void open(a)} disabled={openingId === a.id} style={{
                padding: `${SPACE.xs}px ${SPACE.md}px`,
                background: F.surface, color: F.ink,
                border: `1px solid ${F.border}`,
                fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 500,
                borderRadius: RADIUS.md, cursor: openingId === a.id ? 'wait' : 'pointer',
                opacity: openingId === a.id ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}>{openingId === a.id ? 'Opening…' : 'Open'}</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
