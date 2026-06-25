import { useState } from 'react';
import { F, RADIUS } from '../theme/fenway';
import { fire } from '../lib/events';
import { useBriefs, useUi } from '../store';
import { classifyEvidenceSource, formatEvidenceFreshness } from '../fenway/evidencePanelModel';

interface CiteProps {
  n: number | string;
  label?: string;
}

/**
 * `[N]` citation chip.
 *
 * Hover: previews the evidence check + freshness + first data row, AND fires
 *   `v6d3cf:cite-hover` so LeftRail can glow the matching Evidence Pack card.
 * Click: scrolls the LeftRail to the matching Evidence Pack card and pulses it.
 * Cmd/Ctrl-click: opens the source URL in a new tab when the source carries
 *   a `url` field on its `data` payload (BriefSource.data is flexible JSON).
 */
export function Cite({ n, label }: CiteProps) {
  const refIndex = typeof n === 'number' ? n : Number(n);
  const { activeBriefId, sourcesByBrief } = useBriefs();
  const { setHighlightedSourceRef, setSourceFilterRef } = useUi();
  const [hovered, setHovered] = useState(false);

  const sources = activeBriefId ? (sourcesByBrief[activeBriefId] ?? []) : [];
  const source = Number.isFinite(refIndex) ? sources.find((s) => s.ref_index === refIndex) : undefined;

  const data = (source?.data && typeof source.data === 'object') ? source.data as Record<string, unknown> : {};
  const dataRows = (Array.isArray(data.rows) ? data.rows : []) as { k: string; v: string }[];
  const excerpt = typeof data.excerpt === 'string' ? data.excerpt : null;
  const url = typeof data.url === 'string' ? data.url : null;
  const isCba = source?.kind === 'CBA';
  const cbaArticle = isCba && typeof data.article === 'string' ? data.article : null;
  const cbaSection = isCba && typeof data.section === 'string' ? data.section : null;
  const evidence = source ? classifyEvidenceSource(source) : null;
  const freshness = source ? formatEvidenceFreshness(source) : null;

  const onMouseEnter = () => {
    setHovered(true);
    fire('v6d3cf:cite-hover', { ref: refIndex });
  };

  const onMouseLeave = () => {
    setHovered(false);
    fire('v6d3cf:cite-hover', { ref: null });
  };

  const onClick = (e: React.MouseEvent) => {
    if (!source) return;
    if ((e.metaKey || e.ctrlKey) && url) {
      e.preventDefault();
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    setSourceFilterRef(null);
    setHighlightedSourceRef(refIndex);
  };

  const onOpenInRail = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSourceFilterRef(refIndex);
    setHighlightedSourceRef(refIndex);
  };

  return (
    <span
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        verticalAlign: 'baseline',
        padding: '0 5px', height: 16,
        marginLeft: label ? 3 : 1,
        background: F.accentSoft, color: F.accent,
        fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
        borderRadius: 4, cursor: source ? 'pointer' : 'default',
        lineHeight: 1, position: 'relative', top: -1,
        boxShadow: hovered ? `0 0 0 3px ${F.accentSoft}` : 'none',
        transition: 'box-shadow 0.12s ease',
      }}>
      <span>{n}</span>
      {label && <span style={{ fontWeight: 500, opacity: 0.85 }}>{label}</span>}

      {hovered && source && (
        <span style={{
          // No gap between chip and popover so the mouse can travel down into
          // the popover without crossing dead space (which would dismiss it).
          position: 'absolute', top: '100%', left: -4, paddingTop: 6,
          minWidth: 280, maxWidth: 360, zIndex: 30,
          color: F.ink,
          fontFamily: 'var(--font-sans)', fontWeight: 500,
          textAlign: 'left',
        }}>
          <span style={{
            display: 'block',
            background: F.surface,
            border: `1px solid ${F.borderStrong}`,
            borderRadius: RADIUS.md, padding: '10px 12px',
          boxShadow: F.shadowPop,
          fontFamily: 'var(--font-sans)', fontWeight: 500,
          textAlign: 'left',
        }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6,
            marginBottom: 5,
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700,
              color: isCba ? '#FFFFFF' : F.fgMuted,
              background: isCba ? F.fenway : F.cream100,
              padding: '1px 6px', borderRadius: 4,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>{evidence?.title ?? source.kind}</span>
            {source.source && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5, color: F.fgMuted,
                letterSpacing: '0.04em',
              }}>{source.source}</span>
            )}
            {(freshness || source.updated_at) && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5, color: F.fgFaint,
                marginLeft: 'auto',
              }}>{freshness ?? source.updated_at}</span>
            )}
          </span>
          {isCba && (cbaArticle || cbaSection) && (
            <span style={{
              display: 'block',
              fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 600,
              color: F.fenway, marginBottom: 4,
              letterSpacing: '0.02em',
            }}>
              {cbaArticle ? `Art. ${cbaArticle}` : ''}{cbaArticle && cbaSection ? ' · ' : ''}{cbaSection ?? ''}
            </span>
          )}
          <span style={{
            display: 'block', fontSize: 13, color: F.ink, lineHeight: 1.4,
            marginBottom: evidence || excerpt || dataRows.length ? 7 : 0,
          }}>{evidence?.proof ?? source.title}</span>
          {evidence && source.title !== evidence.title && (
            <span style={{
              display: 'block',
              fontFamily: 'var(--font-sans)', fontSize: 11.5, color: F.fgMuted,
              lineHeight: 1.35, marginBottom: excerpt || dataRows.length ? 7 : 0,
            }}>{source.title}</span>
          )}
          {excerpt && (
            <span style={{
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontFamily: 'var(--font-sans)', fontSize: 12, color: F.inkSoft,
              lineHeight: 1.5, marginBottom: dataRows.length ? 7 : 0,
              fontStyle: 'italic',
            }}>"{excerpt}"</span>
          )}
          {dataRows.length > 0 && (
            <span style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 8, rowGap: 2,
              fontFamily: 'var(--font-mono)', fontSize: 10.5,
              marginBottom: 8,
            }}>
              {dataRows.slice(0, 4).map((r, i) => (
                <span key={i} style={{ display: 'contents' }}>
                  <span style={{ color: F.fgMuted }}>{r.k}</span>
                  <span style={{ color: F.ink, fontWeight: 600 }}>{r.v}</span>
                </span>
              ))}
            </span>
          )}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 8,
            paddingTop: 6, borderTop: `1px solid ${F.border}`,
          }}>
            <button onClick={onOpenInRail} style={{
              padding: '3px 9px', background: F.fenway, color: '#FFFFFF',
              border: 'none', borderRadius: 5,
              fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
              cursor: 'pointer',
            }}>Open Evidence Pack →</button>
            {url && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9.5, color: F.fgFaint,
                letterSpacing: '0.04em',
              }}>⌘-click for source</span>
            )}
          </span>
          </span>
        </span>
      )}
    </span>
  );
}
