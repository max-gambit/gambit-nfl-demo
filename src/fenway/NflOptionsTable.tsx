import { useMemo } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { useBriefs, useUi } from '../store';

/** NFL-native option comparison for the active Analysis brief. */
export function NflOptionsTable() {
  const { activeBriefId, optionsByBrief } = useBriefs();
  const { selectedOptionRef, setSelectedOptionRef, setSourceFilterRefs } = useUi();
  const options = useMemo(
    () => activeBriefId ? optionsByBrief[activeBriefId] ?? [] : [],
    [activeBriefId, optionsByBrief],
  );

  if (options.length === 0) return null;

  return (
    <section style={{ borderTop: `1px solid ${F.border}`, borderBottom: `1px solid ${F.border}` }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'minmax(220px, 1.5fr) .7fr .8fr .7fr .55fr',
        gap: SPACE.md, padding: `${SPACE.sm}px ${SPACE['2xl']}px`,
        background: F.cream50, color: F.fgMuted,
        fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs,
        fontWeight: 700, textTransform: 'uppercase', letterSpacing: TRACKING.micro,
      }}>
        <span>Option</span><span>Cap effect</span><span>NFL rule</span><span>Timing</span><span>Evidence</span>
      </div>
      {options.map((option) => {
        const active = selectedOptionRef === option.ref_index;
        const evidenceRefs = option.details?.evidence_refs ?? [];
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              const next = active ? null : option.ref_index;
              setSelectedOptionRef(next);
              setSourceFilterRefs(next === null ? null : evidenceRefs);
            }}
            style={{
              width: '100%', display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1.5fr) .7fr .8fr .7fr .55fr',
              gap: SPACE.md, alignItems: 'center', textAlign: 'left',
              padding: `${SPACE.md}px ${SPACE['2xl']}px`,
              border: 'none', borderTop: `1px solid ${F.border}`,
              borderLeft: `3px solid ${active ? F.fenway : 'transparent'}`,
              background: active ? F.fenwaySoft : F.surface,
              color: F.ink, cursor: 'pointer',
            }}
          >
            <span style={{ display: 'grid', gap: 3, minWidth: 0 }}>
              <strong style={{ fontSize: TYPE.body.md }}>{option.title}</strong>
              {option.subtitle && <small style={{ color: F.fgMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{option.subtitle}</small>}
            </span>
            <strong style={{ fontFamily: 'var(--font-mono)', fontSize: TYPE.body.sm }}>{option.net_cap_label || 'Directional'}</strong>
            <span style={{ fontSize: TYPE.body.sm }}>{option.cba_section || 'Rule check needed'}</span>
            <span style={{ fontSize: TYPE.body.sm }}>{option.timing || 'Open'}</span>
            <span style={{
              justifySelf: 'start', borderRadius: RADIUS.pill,
              padding: `3px ${SPACE.sm}px`, background: F.cream100,
              color: F.fenway, fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.sm, fontWeight: 700,
            }}>{evidenceRefs.length || option.src_count} refs</span>
          </button>
        );
      })}
    </section>
  );
}
