import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../ds/Icon';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { on as onEvt } from '../lib/events';
import { useBriefs, useUi } from '../store';
import { SourceDetail } from './SourceDetail';
import {
  buildEvidencePackModel,
  type EvidenceCheckRow,
  type EvidencePackItem,
} from './evidencePanelModel';

interface LeftRailProps {
  extra?: ReactNode;
  contentOverride?: ReactNode;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function LeftRail({ extra = null, contentOverride = null, collapsed = false, onToggle }: LeftRailProps) {
  const [hoverRef, setHoverRef] = useState<number | null>(null);
  const [showBackground, setShowBackground] = useState(false);
  const [expandedEvidenceKeys, setExpandedEvidenceKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => onEvt('v6d3cf:cite-hover', ({ ref }) => setHoverRef(ref)), []);

  const { briefs, activeBriefId, sourcesByBrief, optionsByBrief } = useBriefs();
  const {
    sourceFilterRefs, highlightedSourceRef,
    setSourceFilterRefs, setHighlightedSourceRef,
    selectedSourceRef, setSelectedSourceRef,
    selectedOptionRef,
  } = useUi();

  const activeBrief = useMemo(
    () => briefs.find((brief) => brief.id === activeBriefId) ?? null,
    [briefs, activeBriefId],
  );
  const rawSources = activeBriefId ? (sourcesByBrief[activeBriefId] ?? []) : [];
  const options = activeBriefId ? (optionsByBrief[activeBriefId] ?? []) : [];
  const evidenceModel = useMemo(
    () => buildEvidencePackModel(activeBrief, rawSources, options, sourceFilterRefs, selectedOptionRef),
    [activeBrief, rawSources, options, sourceFilterRefs, selectedOptionRef],
  );
  const focusActive = sourceFilterRefs !== null && sourceFilterRefs.length > 0;
  const primaryItems = evidenceModel.checkedItems.length > 0 || focusActive
    ? evidenceModel.checkedItems
    : evidenceModel.backgroundItems;
  const backgroundItems = evidenceModel.checkedItems.length > 0 ? evidenceModel.backgroundItems : [];

  // Refs by source ref_index so Cite-click scroll-spy can target grouped cards.
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    setShowBackground(false);
    setExpandedEvidenceKeys(new Set());
  }, [activeBriefId]);

  useEffect(() => {
    if (highlightedSourceRef === null) return;
    const node = cardRefs.current[highlightedSourceRef];
    if (node) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const itemKey = evidenceModel.refToItemKey[highlightedSourceRef];
    if (itemKey) {
      setExpandedEvidenceKeys((current) => {
        if (current.has(itemKey)) return current;
        const next = new Set(current);
        next.add(itemKey);
        return next;
      });
    }
    const t = setTimeout(() => setHighlightedSourceRef(null), 1500);
    return () => clearTimeout(t);
  }, [highlightedSourceRef, setHighlightedSourceRef, evidenceModel.refToItemKey]);

  const toggleExpanded = (key: string) => {
    setExpandedEvidenceKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (collapsed) {
    return (
      <nav style={{
        width: 36, background: F.paper,
        borderRight: `1px solid ${F.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        flexShrink: 0, paddingTop: 10, position: 'relative', overflow: 'visible',
      }}>
        <RailToggle collapsed onToggle={onToggle} />
      </nav>
    );
  }

  if (contentOverride) {
    return (
      <nav className="gd-scroll" style={{
        width: 296, background: F.paper,
        borderRight: `1px solid ${F.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        overflow: 'visible', position: 'relative',
      }}>
        <RailToggle onToggle={onToggle} />
        {contentOverride}
      </nav>
    );
  }

  const selectedSource = selectedSourceRef !== null
    ? rawSources.find((s) => s.ref_index === selectedSourceRef) ?? null
    : null;
  if (selectedSource) {
    return (
      <nav style={{
        width: 420, background: F.paper,
        borderRight: `1px solid ${F.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        position: 'relative', minHeight: 0,
      }}>
        <SourceDetail source={selectedSource} onBack={() => setSelectedSourceRef(null)} />
      </nav>
    );
  }

  return (
    <nav className="gd-scroll" style={{
      width: 320, background: F.paper,
      borderRight: `1px solid ${F.border}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      overflow: 'visible', position: 'relative',
    }}>
      <RailToggle onToggle={onToggle} />
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {extra}
        <EvidencePackHeader model={evidenceModel} />

        {focusActive && (
          <div style={{
            margin: `0 ${SPACE.md}px ${SPACE.md}px`,
            padding: `${SPACE.xs + 2}px ${SPACE.md}px`,
            background: F.fenwaySoft, border: `1px solid ${F.fenway}`,
            borderRadius: RADIUS.md, display: 'flex', alignItems: 'center', gap: SPACE.sm,
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 600,
              color: F.fenway, letterSpacing: TRACKING.caps, textTransform: 'uppercase',
            }}>
              {selectedOptionRef !== null ? `Option [${selectedOptionRef}] evidence` : 'Focused evidence'} · {sourceFilterRefs.map((ref) => `[${ref}]`).join(' ')}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setSourceFilterRefs(null)} style={{
              padding: `2px ${SPACE.sm}px`, background: 'transparent',
              border: `1px solid ${F.fenway}`, color: F.fenway,
              fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 500,
              borderRadius: RADIUS.sm, cursor: 'pointer',
            }}>Clear</button>
          </div>
        )}

        <EvidenceSectionHead>{primarySectionTitle(evidenceModel.sectionTitle, focusActive, primaryItems.length, evidenceModel.totalRefs)}</EvidenceSectionHead>
        <div style={{ padding: `0 ${SPACE.md}px ${SPACE.md}px` }}>
          {primaryItems.length === 0 && (
            <EmptyEvidenceState focusActive={focusActive} />
          )}
          {primaryItems.map((item) => (
            <EvidenceCard
              key={item.key}
              item={item}
              expanded={expandedEvidenceKeys.has(item.key)}
              isHighlighted={item.refs.some((ref) => highlightedSourceRef === ref || !!sourceFilterRefs?.includes(ref))}
              isHovered={item.refs.some((ref) => hoverRef === ref)}
              cardRefs={cardRefs}
              onOpenSource={setSelectedSourceRef}
              onToggleExpanded={() => toggleExpanded(item.key)}
            />
          ))}
        </div>

        {backgroundItems.length > 0 && (
          <div style={{ padding: `0 ${SPACE.md}px ${SPACE.lg}px` }}>
            <button onClick={() => setShowBackground((value) => !value)} style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: `${SPACE.sm}px ${SPACE.md}px`,
              border: `1px solid ${F.border}`,
              borderRadius: RADIUS.md,
              background: showBackground ? F.surface : 'transparent',
              cursor: 'pointer',
              color: F.fgMuted,
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
              fontWeight: 600,
            }}>
              <span>{showBackground ? 'Hide background evidence' : 'Show background evidence'}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md }}>{backgroundItems.length}</span>
            </button>
            {showBackground && (
              <div style={{ marginTop: SPACE.sm }}>
                {backgroundItems.map((item) => (
                  <EvidenceCard
                    key={item.key}
                    item={item}
                    expanded={expandedEvidenceKeys.has(item.key)}
                    isHighlighted={item.refs.some((ref) => highlightedSourceRef === ref || !!sourceFilterRefs?.includes(ref))}
                    isHovered={item.refs.some((ref) => hoverRef === ref)}
                    cardRefs={cardRefs}
                    onOpenSource={setSelectedSourceRef}
                    onToggleExpanded={() => toggleExpanded(item.key)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

function RailToggle({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  return (
    <button onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      style={{
        position: 'absolute', top: 14, right: -8, zIndex: 5,
        width: 16, height: 16, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: F.surface, border: `1px solid ${F.border}`,
        borderRadius: 999, cursor: 'pointer', color: F.fgMuted,
        boxShadow: F.shadowSoft, opacity: collapsed ? 1 : 0.7,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = collapsed ? '1' : '0.7'; }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
      </svg>
    </button>
  );
}

function EvidencePackHeader({ model }: { model: ReturnType<typeof buildEvidencePackModel> }) {
  return (
    <div style={{ padding: `${SPACE.lg}px ${SPACE.md}px ${SPACE.sm}px` }}>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: TYPE.display.md,
        fontWeight: 650,
        color: F.ink,
        lineHeight: 1.1,
      }}>{model.title}</div>
    </div>
  );
}

function EvidenceSectionHead({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: `${SPACE.xs}px ${SPACE.md}px ${SPACE.sm}px`,
      fontFamily: 'var(--font-mono)',
      fontSize: TYPE.meta.xs,
      fontWeight: 700,
      color: F.fgMuted,
      letterSpacing: TRACKING.micro,
      textTransform: 'uppercase',
    }}>{children}</div>
  );
}

function EvidenceCard({
  item,
  expanded,
  isHighlighted,
  isHovered,
  cardRefs,
  onOpenSource,
  onToggleExpanded,
}: {
  item: EvidencePackItem;
  expanded: boolean;
  isHighlighted: boolean;
  isHovered: boolean;
  cardRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
  onOpenSource: (refIndex: number) => void;
  onToggleExpanded: () => void;
}) {
  const litUp = isHighlighted || isHovered;
  const canExpand = item.rows.length > 0;
  const onClick = () => {
    if (canExpand) onToggleExpanded();
  };
  const statusColor = item.status === 'background' ? F.fgMuted : F.fenway;
  const statusBackground = item.status === 'background' ? F.cream100 : F.fenwaySoft;

  return (
    <div
      ref={(el) => {
        for (const ref of item.refs) cardRefs.current[ref] = el;
      }}
      onClick={onClick}
      style={{
        background: F.surface,
        border: `1px solid ${isHighlighted ? F.fenway : isHovered ? F.borderStrong : F.border}`,
        padding: SPACE.sm + 2,
        marginBottom: SPACE.sm,
        cursor: canExpand ? 'pointer' : 'default',
        borderRadius: RADIUS.md,
        boxShadow: litUp ? F.shadow : F.shadowSoft,
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
        animation: isHighlighted ? 'finish-pulse 600ms ease-out 1' : 'none',
      }}>
      <div style={{ display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr) 10px', gap: SPACE.sm, alignItems: 'start' }}>
        <div style={{
          width: 26,
          height: 26,
          borderRadius: RADIUS.md,
          background: statusBackground,
          color: statusColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${item.role === 'cba' || item.role === 'context' ? F.fenwaySoft : F.border}`,
        }}>
          <Icon name={item.icon} size={14} color={statusColor} />
        </div>

        <div style={{ minWidth: 0 }}>
          {item.type !== 'claim' && (
            <div style={{
              marginBottom: 2,
              fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.xs,
              color: statusColor,
              fontWeight: 700,
              letterSpacing: TRACKING.micro,
              textTransform: 'uppercase',
            }}>{itemTypeLabel(item)}</div>
          )}
          <div style={{
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.lg,
            fontWeight: 700,
            color: F.ink,
            lineHeight: 1.15,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
          }}>{item.title}</div>
          <div style={{
            marginTop: SPACE.sm,
            display: 'flex',
            alignItems: 'center',
            gap: SPACE.xs,
            flexWrap: 'wrap',
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.meta.md,
            color: F.fgMuted,
            lineHeight: 1.15,
          }}>
            {item.meta && <span>{item.meta}</span>}
            {item.freshness && item.meta && <span>·</span>}
            {item.freshness && <span>{item.freshness}</span>}
            <RefChips refs={item.refs} compact />
          </div>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: SPACE.xs,
          color: F.fgMuted,
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.sm,
        }}>
          {canExpand && (
            <span aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' }}>›</span>
          )}
        </div>
      </div>

      {expanded && canExpand && (
        <div style={{
          marginTop: SPACE.md,
          paddingTop: SPACE.sm,
          borderTop: `1px solid ${F.border}`,
          display: 'grid',
          gap: SPACE.xs,
        }}>
          {item.proof && (
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
              color: F.inkSoft,
              lineHeight: 1.35,
            }}>
              {item.proof}
            </div>
          )}
          {item.claim && (
            <div style={{
              padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
              borderRadius: RADIUS.sm,
              background: F.cream50,
              border: `1px solid ${F.border}`,
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
              color: F.inkSoft,
              lineHeight: 1.35,
            }}>
              {item.claim}
            </div>
          )}
          {item.rows.length > 0 && (
            <>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: TYPE.meta.xs,
                fontWeight: 700,
                color: F.fgMuted,
                letterSpacing: TRACKING.micro,
                textTransform: 'uppercase',
              }}>Supporting records</div>
              {item.rows.map((row) => (
                <EvidenceChildRow key={row.key} row={row} onOpenSource={onOpenSource} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function itemTypeLabel(item: EvidencePackItem): string {
  if (item.type === 'option') return 'Option hinge';
  if (item.type === 'background') return 'Background evidence';
  return 'Checked claim';
}

function EvidenceChildRow({ row, onOpenSource }: { row: EvidenceCheckRow; onOpenSource: (refIndex: number) => void }) {
  return (
    <button onClick={(e) => {
      e.stopPropagation();
      onOpenSource(row.refIndex);
    }} style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto',
      gap: SPACE.sm,
      width: '100%',
      textAlign: 'left',
      border: `1px solid ${F.border}`,
      borderRadius: RADIUS.sm,
      background: F.cream50,
      padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
      cursor: 'pointer',
    }}>
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block',
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.sm,
          color: F.ink,
          fontWeight: 650,
          lineHeight: 1.25,
        }}>{row.title}</span>
        <span style={{
          display: 'block',
          marginTop: 1,
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.meta.md,
          color: F.fgMuted,
          lineHeight: 1.3,
        }}>{row.proof}</span>
        {(row.freshness || row.meta) && (
          <span style={{
            display: 'block',
            marginTop: 3,
            fontFamily: 'var(--font-mono)',
            fontSize: TYPE.meta.xs,
            color: F.fgMuted,
            letterSpacing: TRACKING.caps,
            lineHeight: 1.25,
          }}>
            {[row.freshness, row.meta].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: TYPE.meta.sm,
        color: F.fenway,
        fontWeight: 700,
      }}>[{row.refIndex}]</span>
    </button>
  );
}

function RefChips({ refs, compact = false }: { refs: number[]; compact?: boolean }) {
  return (
    <div style={{
      display: 'inline-flex',
      flexWrap: 'wrap',
      gap: 3,
      marginTop: compact ? 0 : SPACE.sm,
      verticalAlign: 'middle',
    }}>
      {refs.map((ref) => (
        <span key={ref} style={{
          fontFamily: 'var(--font-mono)',
          fontSize: compact ? TYPE.meta.xs : TYPE.meta.sm,
          color: F.fenway,
          background: F.fenwaySoft,
          border: `1px solid ${F.border}`,
          borderRadius: RADIUS.sm,
          padding: compact ? `0 ${SPACE.xs}px` : `1px ${SPACE.xs + 1}px`,
          fontWeight: 700,
          lineHeight: compact ? 1.35 : undefined,
        }}>[{ref}]</span>
      ))}
    </div>
  );
}

function EmptyEvidenceState({ focusActive }: { focusActive: boolean }) {
  return (
    <div style={{
      padding: `${SPACE.xl}px ${SPACE.sm}px`,
      textAlign: 'center',
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.sm,
      color: F.fgMuted,
      lineHeight: 1.5,
    }}>
      {focusActive ? 'No evidence matched this option.' : 'Evidence checks will appear here once the brief finishes.'}
    </div>
  );
}

function primarySectionTitle(sectionTitle: string, focusActive: boolean, visibleCount: number, totalRefs: number): string {
  if (focusActive) return sectionTitle;
  if (visibleCount === 0 && totalRefs > 0) return 'Evidence loaded for this brief';
  return sectionTitle;
}
