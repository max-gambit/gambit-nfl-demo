import type { BriefSource, NflSellerMoveConversationArtifact } from '@shared/types';
import { fire } from '../lib/events';
import { useBriefs, useUi } from '../store';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

export function NflSellerMoveAnalysis({
  artifact,
  followups = [],
}: {
  artifact: NflSellerMoveConversationArtifact;
  followups?: string[];
}) {
  const { activeBriefId, sourcesByBrief } = useBriefs();
  const { setSelectedSourceRef, setSourceFilterRefs, setHighlightedSourceRef, setRailCollapsed } = useUi();
  const sources = activeBriefId ? sourcesByBrief[activeBriefId] ?? [] : [];
  const contractRef = sources.find((source) => source.data?.seller_move_contract === true)?.ref_index;
  const roleRef = sources.find((source) => source.data?.seller_move_role === true)?.ref_index;
  const comparableRefs = new Map(
    sources.flatMap((source) => {
      const eventId = transactionEventId(source);
      return eventId ? [[eventId, source.ref_index] as const] : [];
    }),
  );
  const openEvidence = (ref: number | undefined) => {
    if (ref == null) return;
    setSourceFilterRefs([ref]);
    setHighlightedSourceRef(ref);
    setSelectedSourceRef(ref);
    setRailCollapsed(false);
    fire('v6d3cf:open-evidence', { ref });
  };

  if (artifact.status !== 'answered' || !artifact.result) {
    return <div
      role={artifact.status === 'clarification' ? 'status' : 'alert'}
      data-testid="nfl-seller-move-clarification"
      style={{
        padding: SPACE.lg,
        border: `1px solid ${artifact.status === 'clarification' ? F.borderStrong : F.red}`,
        borderRadius: RADIUS.md,
        background: artifact.status === 'clarification' ? F.cream50 : F.surface,
        color: F.ink,
        fontFamily: 'var(--font-display)',
        fontSize: TYPE.display.sm,
        lineHeight: 1.4,
      }}
    >{artifact.message}</div>;
  }

  const result = artifact.result;
  return <div style={{ display: 'grid', gap: SPACE.xl }} aria-live="polite" data-testid="nfl-seller-move-result">
    <section style={{
      padding: `${SPACE.xl}px ${SPACE['2xl']}px`,
      borderRadius: RADIUS.md,
      background: F.fenwaySoft,
      border: `1px solid ${F.fenway}`,
      borderLeft: `4px solid ${F.fenway}`,
    }}>
      <span style={eyebrowStyle}>What New York would receive · proposed by you</span>
      <h3 style={{ margin: 0, color: F.ink, fontFamily: 'var(--font-display)', fontSize: TYPE.display.md, lineHeight: 1.3 }}>
        {result.proposal.label} for {result.player.player_name}
      </h3>
      <p style={{ margin: `${SPACE.xs}px 0 0`, color: F.inkSoft, fontSize: TYPE.body.lg, fontWeight: 650 }}>
        {result.market.range_label}
      </p>
      <small style={{ color: F.fgMuted }}>{result.market.sample_size} usable historical trades · {result.market.cohort_label}</small>
    </section>

    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm }}>
      <ResultMetric label={`${result.cap.current_year} cap space created`} value={money(result.cap.current_year_cap_space_created_dollars)} />
      <ResultMetric label={`${result.cap.current_year} dead money`} value={money(result.cap.current_year_dead_money_dollars)} />
      {result.cap.next_year && <ResultMetric
        label={`${result.cap.next_year.year} cap effect`}
        value={signedMoney(result.cap.next_year.cap_effect_dollars)}
        note={result.cap.next_year.cap_effect_dollars >= 0 ? 'additional cap space' : 'additional cap cost'}
      />}
      <ResultMetric label="Depth consequence" value={result.depth.label} note={result.depth.basis} />
    </section>

    {result.comparables.length > 0 && <section>
      <span style={eyebrowStyle}>{artifact.show_comparables ? 'Trades behind this result' : 'Most relevant trades'}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.sm, marginTop: SPACE.xs }}>
        {result.comparables.map((row) => {
          const ref = comparableRefs.get(row.event_id);
          return <button
            type="button"
            key={row.event_id}
            disabled={ref == null}
            onClick={() => openEvidence(ref)}
            aria-label={`Open transaction evidence for ${row.player_name}`}
            style={{
              padding: SPACE.md,
              background: F.surface,
              border: `1px solid ${F.border}`,
              borderRadius: RADIUS.md,
              textAlign: 'left',
              color: 'inherit',
              cursor: ref == null ? 'default' : 'pointer',
            }}
          >
            <strong style={{ display: 'block', color: F.ink }}>{row.player_name}</strong>
            <span style={{ display: 'block', color: F.inkSoft, fontSize: TYPE.body.sm }}>{row.from_team_id} → {row.to_team_id} · {row.event_year}</span>
            <span style={{ display: 'block', marginTop: 4, color: F.fgMuted, fontSize: TYPE.meta.md }}>{row.compensation_summary}</span>
            <span style={{ display: 'block', marginTop: 3, color: F.fgMuted, fontSize: TYPE.meta.md }}>{comparableRelationshipLabel(row.comparison_to_proposal)}</span>
            {ref != null && <span style={sourceLinkStyle}>Open transaction evidence →</span>}
          </button>;
        })}
      </div>
    </section>}

    {followups.length > 0 && <section>
      <span style={eyebrowStyle}>Next questions</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>
        {followups.map((followup) => <button
          type="button"
          key={followup}
          onClick={() => fire('v6d3cf:submit-brief', { text: followup })}
          style={{
            color: F.fenway,
            background: F.fenwaySoft,
            border: `1px solid ${F.fenway}`,
            borderRadius: RADIUS.pill,
            padding: `${SPACE.xs - 1}px ${SPACE.sm}px`,
            fontSize: TYPE.body.sm,
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >{followup}</button>)}
      </div>
    </section>}

    <details style={{ border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
      <summary style={{ cursor: 'pointer', padding: `${SPACE.sm}px ${SPACE.md}px`, color: F.ink, fontWeight: 700 }}>See calculation and sources</summary>
      <div style={{ display: 'grid', gap: SPACE.sm, padding: `0 ${SPACE.md}px ${SPACE.md}px`, color: F.inkSoft, fontSize: TYPE.body.sm, lineHeight: 1.5 }}>
        <p style={{ margin: 0 }}>{result.cap.calculation}</p>
        {result.cap.next_year && <p style={{ margin: 0 }}>
          {result.cap.next_year.year}: {money(result.cap.next_year.scheduled_cap_dollars)} scheduled cap minus {money(result.cap.next_year.accelerated_dead_money_dollars)} accelerated dead money = {signedMoney(result.cap.next_year.cap_effect_dollars)} cap effect.
        </p>}
        <p style={{ margin: 0 }}>{result.market.method}</p>
        {result.market.middle_range && <p style={{ margin: 0 }}>Middle historical range: {result.market.middle_range.stronger_pick} through {result.market.middle_range.weaker_pick}.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
          <EvidenceButton label="Open player contract evidence" sourceRef={contractRef} onOpen={openEvidence} />
          {result.depth.source_url && <EvidenceButton label="Open current-role evidence" sourceRef={roleRef} onOpen={openEvidence} />}
        </div>
        {result.limitations.map((limitation) => <p key={limitation} style={{ margin: 0, color: F.fgMuted }}>{limitation}</p>)}
      </div>
    </details>
  </div>;
}

function EvidenceButton({ label, sourceRef, onOpen }: { label: string; sourceRef: number | undefined; onOpen: (ref: number | undefined) => void }) {
  return <button type="button" disabled={sourceRef == null} onClick={() => onOpen(sourceRef)} style={{
    border: 0,
    padding: 0,
    background: 'transparent',
    color: sourceRef == null ? F.fgMuted : F.fenway,
    fontSize: TYPE.meta.md,
    fontWeight: 700,
    cursor: sourceRef == null ? 'default' : 'pointer',
  }}>{label} →</button>;
}

function ResultMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div data-result-metric={label} style={{ padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
    <span style={{ display: 'block', color: F.fgMuted, fontSize: TYPE.meta.xs, textTransform: 'uppercase', letterSpacing: TRACKING.micro }}>{label}</span>
    <strong style={{ display: 'block', marginTop: 4, color: F.ink, fontSize: TYPE.body.lg, fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    {note && <small style={{ display: 'block', marginTop: 4, color: F.fgMuted, lineHeight: 1.35 }}>{note}</small>}
  </div>;
}

function transactionEventId(source: BriefSource): string | null {
  const transaction = source.data?.transaction;
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) return null;
  const eventId = (transaction as Record<string, unknown>).event_id;
  return typeof eventId === 'string' ? eventId : null;
}

function money(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function signedMoney(value: number): string {
  return `${value >= 0 ? '+' : '−'}${money(Math.abs(value))}`;
}

function comparableRelationshipLabel(value: 'stronger' | 'similar' | 'weaker'): string {
  if (value === 'stronger') return 'Stronger return than your proposal';
  if (value === 'weaker') return 'Weaker return than your proposal';
  return 'Similar return to your proposal';
}

const eyebrowStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 4,
  color: F.fenway,
  fontSize: TYPE.meta.xs,
  fontWeight: 700,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};
const sourceLinkStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: SPACE.xs,
  color: F.fenway,
  fontSize: TYPE.meta.md,
  fontWeight: 700,
};
