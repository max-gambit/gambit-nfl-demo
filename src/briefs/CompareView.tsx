import { useEffect, useMemo } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { Cite } from '../ds/Cite';
import { useBriefs, useUi } from '../store';
import type { Brief, BriefOption, BriefSource } from '@shared/types';

/**
 * Phase 7b — side-by-side compare. Renders the active brief on the left and
 * `compareTargetBriefId`'s brief on the right, surfacing thesis, top option,
 * and source overlap. Source IDs cited by both briefs get highlighted at the
 * bottom — that's the "do these analyses agree on the underlying facts?" gut
 * check the GM is reaching for.
 */
export function CompareView() {
  const { briefs, activeBriefId, sourcesByBrief, optionsByBrief, loadBriefData } = useBriefs();
  const { compareTargetBriefId, setCompareTargetBriefId } = useUi();

  const activeBrief = briefs.find((b) => b.id === activeBriefId) ?? null;
  const targetBrief = briefs.find((b) => b.id === compareTargetBriefId) ?? null;

  // Eagerly load both briefs' data so source/option arrays land. Active is
  // already loaded by App.tsx; the target needs a kick.
  useEffect(() => {
    if (compareTargetBriefId) void loadBriefData(compareTargetBriefId);
  }, [compareTargetBriefId, loadBriefData]);

  const leftSources = activeBriefId ? sourcesByBrief[activeBriefId] ?? [] : [];
  const rightSources = compareTargetBriefId ? sourcesByBrief[compareTargetBriefId] ?? [] : [];
  const leftOptions = activeBriefId ? optionsByBrief[activeBriefId] ?? [] : [];
  const rightOptions = compareTargetBriefId ? optionsByBrief[compareTargetBriefId] ?? [] : [];

  // Sources cited by both briefs — match on title (since IDs are per-brief).
  // Title is canonical enough at the prototype scale; a future iteration can
  // do exact normalization (kind + source + title).
  const sharedTitles = useMemo(() => {
    const left = new Set(leftSources.map((s) => s.title.trim().toLowerCase()));
    return new Set(rightSources.filter((s) => left.has(s.title.trim().toLowerCase())).map((s) => s.title.trim().toLowerCase()));
  }, [leftSources, rightSources]);

  if (!activeBrief) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: F.paper }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: TYPE.body.sm, color: F.fgFaint }}>
          No active thread.
        </div>
      </div>
    );
  }

  const candidates = briefs.filter((b) => b.id !== activeBriefId && b.status === 'ready');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: F.paper, minHeight: 0 }}>
      <div style={{
        padding: `${SPACE.md - 2}px ${SPACE.lg}px`, borderBottom: `1px solid ${F.border}`,
        display: 'flex', alignItems: 'center', gap: SPACE.md,
        background: F.cream50,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 700,
          color: F.fenway, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
        }}>Compare</span>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.ink, fontWeight: 500,
          maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{activeBrief.thesis ?? activeBrief.question}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgMuted }}>↔</span>
        {targetBrief ? (
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.ink, fontWeight: 500,
            maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{targetBrief.thesis ?? targetBrief.question}</span>
        ) : (
          <select
            value=""
            onChange={(e) => setCompareTargetBriefId(e.target.value || null)}
            style={{
              padding: `${SPACE.xs}px ${SPACE.sm + 2}px`, borderRadius: RADIUS.md,
              border: `1px solid ${F.border}`, background: F.surface,
              fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.ink,
              minWidth: 240,
            }}>
            <option value="" disabled>Pick a thread to compare with…</option>
            {candidates.map((b) => (
              <option key={b.id} value={b.id}>{b.thesis ?? b.question}</option>
            ))}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setCompareTargetBriefId(null)}
          style={{
            padding: `${SPACE.xs}px ${SPACE.sm + 2}px`, background: 'transparent',
            border: `1px solid ${F.border}`, borderRadius: RADIUS.md,
            fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 500,
            color: F.fgMuted, cursor: 'pointer',
          }}>Close compare</button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <BriefColumn brief={activeBrief} sources={leftSources} options={leftOptions} sharedTitles={sharedTitles} side="left" />
        <BriefColumn brief={targetBrief} sources={rightSources} options={rightOptions} sharedTitles={sharedTitles} side="right" />
      </div>
    </div>
  );
}

function BriefColumn({ brief, sources, options, sharedTitles, side }: {
  brief: Brief | null;
  sources: BriefSource[];
  options: BriefOption[];
  sharedTitles: Set<string>;
  side: 'left' | 'right';
}) {
  const topOption = useMemo(() => {
    if (options.length === 0) return null;
    return [...options].sort((a, b) => b.likelihood_pct - a.likelihood_pct)[0];
  }, [options]);

  return (
    <div style={{
      flex: 1, minWidth: 0,
      borderRight: side === 'left' ? `1px solid ${F.border}` : 'none',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
    }}>
      {!brief ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: SPACE['3xl'],
          fontFamily: 'var(--font-mono)', fontSize: TYPE.body.sm, color: F.fgFaint,
          textAlign: 'center',
        }}>
          {side === 'right' ? 'Pick a thread above to compare' : '—'}
        </div>
      ) : (
        <div style={{ padding: `${SPACE.xl}px ${SPACE.xl + 2}px` }}>
          <div style={{
            fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.sm, fontWeight: 600,
            color: F.fenway, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
            marginBottom: SPACE.sm,
          }}>Working thesis</div>
          <p style={{
            margin: 0,
            fontFamily: 'var(--font-display)', fontSize: TYPE.display.md, lineHeight: 1.4,
            color: F.ink, fontWeight: 600, letterSpacing: TRACKING.tight,
          }}>{brief.thesis ?? brief.question}</p>

          {topOption && (
            <div style={{
              marginTop: SPACE.lg, padding: `${SPACE.md - 2}px ${SPACE.md}px`,
              background: F.cream50, border: `1px solid ${F.border}`,
              borderRadius: RADIUS.md,
            }}>
              <div style={{
                fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.sm, fontWeight: 600,
                color: F.fgMuted, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
                marginBottom: SPACE.xs,
              }}>Lead option · {topOption.likelihood_pct}%</div>
              <div style={{
                fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md, color: F.ink, fontWeight: 500,
              }}>{topOption.title}</div>
              {topOption.subtitle && (
                <div style={{
                  fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.fgMuted, marginTop: 2,
                }}>{topOption.subtitle}</div>
              )}
            </div>
          )}

          <div style={{
            marginTop: SPACE.lg + 2,
            fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.sm, fontWeight: 600,
            color: F.fgMuted, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
            marginBottom: SPACE.sm,
          }}>Sources · {sources.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs + 1 }}>
            {sources.slice(0, 12).map((s) => {
              const titleKey = s.title.trim().toLowerCase();
              const shared = sharedTitles.has(titleKey);
              return (
                <div key={s.id} style={{
                  padding: `${SPACE.xs + 2}px ${SPACE.sm + 2}px`,
                  background: shared ? F.fenwaySoft : F.surface,
                  border: `1px solid ${shared ? F.fenway : F.border}`,
                  borderRadius: RADIUS.md,
                  display: 'flex', alignItems: 'center', gap: SPACE.sm,
                }}>
                  <Cite n={s.ref_index} />
                  <span style={{
                    fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.ink,
                    flex: 1, minWidth: 0,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{s.title}</span>
                  {shared && (
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
                      color: F.fenway, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
                    }}>shared</span>
                  )}
                </div>
              );
            })}
            {sources.length > 12 && (
              <div style={{
                padding: SPACE.xs, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgFaint,
              }}>+{sources.length - 12} more</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
