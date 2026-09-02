import type {
  NflPositionMarketTrend,
  NflTransactionComparable,
  NflTransactionMarketAnalysis,
  NflTransactionMarketSignal,
  NflTransactionMarketYearPoint,
} from '@shared/types';
import { fire } from '../lib/events';
import { useBriefs, useUi } from '../store';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

export function NflTransactionMarketAnalysisView({ analysis }: { analysis: NflTransactionMarketAnalysis }) {
  const trendRows = analysis.position_trends;
  const { activeBriefId, sourcesByBrief } = useBriefs();
  const { setSelectedSourceRef, setSourceFilterRefs, setHighlightedSourceRef } = useUi();
  const eventSourceRefs = new Map(
    (activeBriefId ? sourcesByBrief[activeBriefId] ?? [] : [])
      .flatMap((source) => {
        const eventId = transactionEventId(source.data);
        return eventId ? [[eventId, source.ref_index] as const] : [];
      }),
  );
  const maxMobility = Math.max(1, ...trendRows.flatMap((trend) => [
    trend.mobility.baseline_value ?? 0,
    trend.mobility.recent_value ?? 0,
  ]));
  const openComparableEvidence = (row: NflTransactionComparable) => {
    const ref = eventSourceRefs.get(row.event_id);
    if (ref == null) return;
    setSourceFilterRefs([ref]);
    setHighlightedSourceRef(ref);
    setSelectedSourceRef(ref);
    fire('v6d3cf:open-evidence', { ref });
  };

  return (
    <div style={{ display: 'grid', gap: SPACE.lg }} data-testid="nfl-transaction-market-analysis">
      <SnapshotHeader analysis={analysis} />

      <section>
        <SectionLabel>Position-market trend</SectionLabel>
        <div style={{
          border: `1px solid ${F.border}`,
          borderRadius: RADIUS.md,
          overflow: 'hidden',
          background: F.surface,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
            gap: SPACE.sm, padding: `${SPACE.sm}px ${SPACE.md}px`, borderBottom: `1px solid ${F.border}`,
          }}>
            <span style={{ color: F.fgMuted, fontSize: TYPE.body.sm }}>
              Material moves per 100 roster player-seasons
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, color: F.fgMuted, fontSize: TYPE.meta.md }}>
              <Legend color={F.borderStrong} label={`${analysis.query.baseline_years[0]}–${analysis.query.baseline_years[1]}`} />
              <Legend color={F.fenway} label={`${analysis.query.recent_years[0]}–${analysis.query.recent_years[1]}`} />
            </span>
          </div>
          <div style={{ display: 'grid' }}>
            {trendRows.map((trend) => (
              <TrendRow key={trend.position_group} trend={trend} maxMobility={maxMobility} />
            ))}
          </div>
        </div>
      </section>

      <AnnualSeriesChart analysis={analysis} />

      <section>
        <SectionLabel>Signal comparison</SectionLabel>
        <div style={{ display: 'grid', gap: SPACE.sm }}>
          {trendRows.map((trend) => (
            <article key={trend.position_group} style={{ padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACE.sm }}>
                <strong style={{ color: F.ink }}>{trend.position_group} · <DirectionBadge direction={trend.direction} status={trend.status} /></strong>
                <span style={{ color: F.fgMuted, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs }}>{trend.event_count.toLocaleString()} material events</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: SPACE.sm, marginTop: SPACE.sm }}>
                <SignalMetric label="Mobility" signal={trend.mobility} />
                <SignalMetric label="Move share" signal={trend.transaction_share} />
                <SignalMetric label="Contract price" signal={trend.contract_price} />
                <SignalMetric label="Trade price" signal={trend.trade_compensation} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <StrategyImplications trends={trendRows} />

      <section>
        <SectionLabel>Method and cohort</SectionLabel>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: SPACE.sm,
        }}>
          <MethodCard title="Cohort" body={analysis.methodology.cohort} />
          <MethodCard title="Mobility" body={analysis.methodology.mobility} />
          <MethodCard title="Trade price" body={analysis.methodology.trade_price} />
          <MethodCard title="Contract price" body={analysis.methodology.contract_price} />
          <MethodCard title="Classification" body={analysis.methodology.classification} />
          <MethodCard title="Influence" body={analysis.methodology.influence} />
        </div>
        <p style={{ margin: `${SPACE.sm}px 0 0`, color: F.fgMuted, fontSize: TYPE.meta.md, lineHeight: 1.45 }}>
          Minimum samples: {analysis.methodology.minimum_samples}
        </p>
      </section>

      {analysis.comparables.length > 0 && (
        <ComparableSection title="Supporting transactions and comparables" rows={analysis.comparables} sourceRefs={eventSourceRefs} onOpen={openComparableEvidence} />
      )}
      {analysis.influential_transactions.length > 0 && (
        <ComparableSection title="Largest leave-one-out sensitivities" rows={analysis.influential_transactions} sourceRefs={eventSourceRefs} onOpen={openComparableEvidence} showInfluence />
      )}

      <section>
        <SectionLabel>Coverage and limitations</SectionLabel>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: SPACE.sm, marginBottom: SPACE.sm,
        }}>
          <Metric label="Material events" value={analysis.coverage.event_count.toLocaleString()} />
          <Metric label="Trades" value={analysis.coverage.trade_count.toLocaleString()} />
          <Metric label="Priced contracts" value={analysis.coverage.priced_contract_count.toLocaleString()} />
          <Metric label="Identity coverage" value={formatBasisPoints(analysis.coverage.position_match_basis_points)} />
        </div>
        <div style={{
          display: 'grid', gap: SPACE.xs, padding: SPACE.md,
          background: analysis.status === 'supported' ? F.cream50 : F.amberSoft,
          border: `1px solid ${analysis.status === 'supported' ? F.border : F.amber}`,
          borderRadius: RADIUS.md,
        }}>
          {analysis.limitations.map((limitation, index) => (
            <div key={index} style={{ color: F.fgMuted, fontSize: TYPE.body.sm, lineHeight: 1.5 }}>{limitation}</div>
          ))}
          {analysis.source_refs.map((source) => (
            <div key={source.id} style={{ color: F.fgMuted, fontSize: TYPE.meta.md, lineHeight: 1.45 }}>
              <strong style={{ color: F.ink }}>{source.name}</strong> · as of {source.as_of_date} · retrieved {formatDate(source.retrieved_at)} · SHA-256 {source.checksum_sha256.slice(0, 12)}…
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StrategyImplications({ trends }: { trends: NflPositionMarketTrend[] }) {
  const rows = trends
    .filter((trend) => trend.status !== 'insufficient_evidence')
    .sort((a, b) => statusRank(b) - statusRank(a) || b.event_count - a.event_count)
    .slice(0, 6);
  if (rows.length === 0) return null;
  return <section>
    <SectionLabel>Trade-strategy implications</SectionLabel>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: SPACE.sm }}>
      {rows.map((trend) => <div key={trend.position_group} style={{ padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
        <strong style={{ display: 'block', color: F.ink, fontSize: TYPE.body.sm, marginBottom: 4 }}>
          {trend.position_group} · {trend.direction.replaceAll('_', ' ')}
        </strong>
        <span style={{ color: F.fgMuted, fontSize: TYPE.body.sm, lineHeight: 1.5 }}>
          {strategyText(trend)}
        </span>
      </div>)}
    </div>
  </section>;
}

function strategyText(trend: NflPositionMarketTrend): string {
  if (trend.direction === 'growing' && trend.status === 'supported') {
    return 'Expect a more active market: start counterparty work earlier, establish a price ceiling from the returned comparables, and avoid waiting for a single deadline-day option.';
  }
  if (trend.direction === 'shrinking' && trend.status === 'supported') {
    return 'Treat a thinner market as a sourcing constraint, not automatic leverage: widen the comparable window and validate availability before setting an aggressive ask.';
  }
  if (trend.direction === 'flat' && trend.status === 'supported') {
    return 'Activity and price are broadly stable under the governed thresholds; use role fit and specific compensation bands to separate otherwise similar calls.';
  }
  return 'Signals are mixed or directional. Negotiate to the supported activity or price signal only, and keep the broader market claim out of the decision memo.';
}

function statusRank(trend: NflPositionMarketTrend): number {
  return trend.status === 'supported' ? 2 : trend.status === 'directional' ? 1 : 0;
}

function SnapshotHeader({ analysis }: { analysis: NflTransactionMarketAnalysis }) {
  return (
    <section style={{
      display: 'grid', gap: SPACE.sm, padding: SPACE.md,
      border: `1px solid ${analysis.status === 'supported' ? F.fenway : F.amber}`,
      borderRadius: RADIUS.md,
      background: analysis.status === 'supported' ? F.fenwaySoft : F.amberSoft,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap' }}>
          <strong style={{ color: F.ink, fontSize: TYPE.body.md }}>Live transaction-market calculation</strong>
          <StatusBadge status={analysis.status} />
        </div>
        <span style={{ color: F.fgMuted, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs }}>
          Snapshot {analysis.snapshot_id.slice(0, 12)} · {formatDate(analysis.generated_at)}
        </span>
      </div>
      <div style={{ color: F.inkSoft, fontSize: TYPE.body.sm, lineHeight: 1.5 }}>
        Executed filters: {analysis.query.start_year}–{analysis.query.end_year}
        {analysis.query.include_ytd ? ' including labeled 2026 YTD' : ''}
        {' · '}{analysis.query.position_groups.length ? analysis.query.position_groups.join(', ') : 'all position groups'}
        {' · '}{analysis.query.transaction_types.join(', ').replaceAll('_', ' ')}
        {analysis.query.team_ids.length ? ` · ${analysis.query.team_ids.join(', ')}` : ' · leaguewide'}
      </div>
    </section>
  );
}

function TrendRow({ trend, maxMobility }: { trend: NflPositionMarketTrend; maxMobility: number }) {
  const baseline = trend.mobility.baseline_value ?? 0;
  const recent = trend.mobility.recent_value ?? 0;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '48px minmax(120px, 1fr) minmax(116px, auto)',
      gap: SPACE.sm, alignItems: 'center', padding: `${SPACE.sm}px ${SPACE.md}px`,
      borderBottom: `1px solid ${F.border}`,
    }}>
      <strong style={{ color: F.ink, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md }}>{trend.position_group}</strong>
      <div style={{ display: 'grid', gap: 4 }} aria-label={`${trend.position_group} mobility comparison`}>
        <Bar value={baseline} max={maxMobility} color={F.borderStrong} />
        <Bar value={recent} max={maxMobility} color={F.fenway} />
      </div>
      <div style={{ display: 'grid', justifyItems: 'end', gap: 2 }}>
        <span style={{ color: F.ink, fontVariantNumeric: 'tabular-nums', fontSize: TYPE.body.sm }}>
          {formatRate(baseline)} → {formatRate(recent)}
        </span>
        <span style={{ color: F.fgMuted, fontSize: TYPE.meta.xs }}>
          {formatChange(trend.mobility.relative_change_basis_points)}
        </span>
      </div>
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const width = Math.max(value > 0 ? 2 : 0, Math.min(100, (value / max) * 100));
  return <div style={{ height: 6, borderRadius: RADIUS.pill, background: F.cream100, overflow: 'hidden' }}>
    <div style={{ width: `${width}%`, height: '100%', background: color, borderRadius: RADIUS.pill }} />
  </div>;
}

function AnnualSeriesChart({ analysis }: { analysis: NflTransactionMarketAnalysis }) {
  const years = [...new Set(analysis.yearly_series.map((point) => point.year))].sort((a, b) => a - b);
  const grouped = new Map<NflPositionMarketTrend['position_group'], NflTransactionMarketYearPoint[]>();
  for (const trend of analysis.position_trends) grouped.set(trend.position_group, []);
  for (const point of analysis.yearly_series) grouped.get(point.position_group)?.push(point);
  const max = Math.max(1, ...analysis.yearly_series.map((point) => point.mobility_per_100_basis_points ?? 0));
  const width = 600;
  const height = 42;
  const chartRows = [...grouped.entries()];
  if (!years.length || !chartRows.length) return null;

  return <section>
    <SectionLabel>Full annual mobility series</SectionLabel>
    <div style={{ border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: SPACE.sm, padding: `${SPACE.sm}px ${SPACE.md}px`, borderBottom: `1px solid ${F.border}`, color: F.fgMuted, fontSize: TYPE.meta.md }}>
        <span>Question-time calculation · material moves per 100 player-seasons</span>
        <span>{years[0]}–{years.at(-1)}</span>
      </div>
      {chartRows.map(([position, points]) => {
        const byYear = new Map(points.map((point) => [point.year, point]));
        const values = years.map((year) => byYear.get(year)?.mobility_per_100_basis_points ?? null);
        const plotted = values.flatMap((value, index) => value == null ? [] : [{
          x: years.length === 1 ? width / 2 : (index / (years.length - 1)) * width,
          y: height - 4 - ((value / max) * (height - 8)),
          value,
        }]);
        const first = plotted[0]?.value ?? null;
        const last = plotted.at(-1)?.value ?? null;
        return <div key={position} style={{ display: 'grid', gridTemplateColumns: '46px minmax(150px, 1fr) 92px', gap: SPACE.sm, alignItems: 'center', padding: `${SPACE.xs + 2}px ${SPACE.md}px`, borderBottom: `1px solid ${F.border}` }}>
          <strong style={{ color: F.ink, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md }}>{position}</strong>
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${position} annual mobility from ${years[0]} to ${years.at(-1)}`} style={{ width: '100%', height, overflow: 'visible' }}>
            <line x1="0" x2={width} y1={height - 4} y2={height - 4} stroke={F.border} strokeWidth="1" />
            {plotted.length > 1 && <polyline fill="none" stroke={F.fenway} strokeWidth="2.5" vectorEffect="non-scaling-stroke" points={plotted.map((point) => `${point.x},${point.y}`).join(' ')} />}
            {plotted.map((point, index) => <circle key={`${position}-${index}`} cx={point.x} cy={point.y} r="2.5" fill={F.fenway} vectorEffect="non-scaling-stroke" />)}
          </svg>
          <span style={{ justifySelf: 'end', color: F.inkSoft, fontVariantNumeric: 'tabular-nums', fontSize: TYPE.meta.md }}>{first == null || last == null ? 'No annual rate' : `${formatRate(first)} → ${formatRate(last)}`}</span>
        </div>;
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${SPACE.xs}px ${SPACE.md}px ${SPACE.sm}px 70px`, color: F.fgMuted, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs }}>
        {years.map((year) => <span key={year}>{year}</span>)}
      </div>
    </div>
  </section>;
}

function SignalMetric({ label, signal }: { label: string; signal: NflTransactionMarketSignal }) {
  return <div style={{ minWidth: 0 }}>
    <span style={{ display: 'block', color: F.fgMuted, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, textTransform: 'uppercase', letterSpacing: TRACKING.micro }}>{label}</span>
    <strong style={{ display: 'block', marginTop: 3, color: F.inkSoft, fontSize: TYPE.body.sm, fontWeight: 650, overflowWrap: 'anywhere' }}>{signalCell(signal)}</strong>
    <span style={{ color: F.fgMuted, fontSize: TYPE.meta.xs }}>n={signal.sample_size.toLocaleString()} · {signal.status.replaceAll('_', ' ')}</span>
  </div>;
}

function ComparableSection({ title, rows, sourceRefs, onOpen, showInfluence = false }: {
  title: string;
  rows: NflTransactionComparable[];
  sourceRefs: Map<string, number>;
  onOpen: (row: NflTransactionComparable) => void;
  showInfluence?: boolean;
}) {
  return (
    <section>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ display: 'grid', gap: SPACE.sm }}>
        {rows.map((row) => {
          const sourceRef = sourceRefs.get(row.event_id);
          return <button type="button" key={row.event_id} disabled={sourceRef == null} onClick={() => onOpen(row)} aria-label={`Open evidence for ${row.player_name}`} style={{
            display: 'grid', gap: SPACE.xs, padding: SPACE.md,
            border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface,
            width: '100%', textAlign: 'left', color: 'inherit', cursor: sourceRef == null ? 'default' : 'pointer',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACE.sm }}>
              <strong style={{ color: F.ink, fontSize: TYPE.body.sm }}>{row.player_name}</strong>
              <span style={{ color: F.fgMuted, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs }}>
                {row.event_date ?? row.event_year} · {row.date_precision} precision
              </span>
            </div>
            <div style={{ color: F.inkSoft, fontSize: TYPE.body.sm, lineHeight: 1.45 }}>
              {row.position_group ?? 'Position unresolved'} · {row.transaction_type.replaceAll('_', ' ')}
              {row.from_team_id || row.to_team_id ? ` · ${row.from_team_id ?? 'FA'} → ${row.to_team_id ?? 'FA'}` : ''}
              {row.compensation_summary ? ` · ${row.compensation_summary}` : ''}
              {row.contract_apy_dollars != null ? ` · ${formatDollars(row.contract_apy_dollars)} APY` : ''}
            </div>
            <div style={{ color: F.fgMuted, fontSize: TYPE.meta.md }}>
              Identity: {row.identity_confidence}
              {row.raw_position ? ` · Raw role: ${row.raw_position}` : ''}
              {row.normalization_basis ? ` · Normalized via ${row.normalization_basis}` : ''}
              {showInfluence && row.influence_explanation ? ` · ${row.influence_explanation}` : ''}
            </div>
            <div style={{ color: sourceRef == null ? F.fgMuted : F.fenway, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700 }}>
              {sourceRef == null ? 'Evidence detail unavailable for this saved result' : `Open exact evidence [${sourceRef}] →`}
            </div>
          </button>;
        })}
      </div>
    </section>
  );
}

function MethodCard({ title, body }: { title: string; body: string }) {
  return <div style={{ padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
    <strong style={{ display: 'block', marginBottom: 4, color: F.ink, fontSize: TYPE.body.sm }}>{title}</strong>
    <span style={{ color: F.fgMuted, fontSize: TYPE.body.sm, lineHeight: 1.5 }}>{body}</span>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
    <div style={{ color: F.fgMuted, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, textTransform: 'uppercase', letterSpacing: TRACKING.micro }}>{label}</div>
    <div style={{ marginTop: 4, color: F.ink, fontFamily: 'var(--font-display)', fontSize: TYPE.display.md }}>{value}</div>
  </div>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    <span style={{ width: 14, height: 4, borderRadius: 4, background: color }} />{label}
  </span>;
}

function StatusBadge({ status }: { status: NflTransactionMarketAnalysis['status'] }) {
  const supported = status === 'supported';
  return <span style={{
    padding: `2px ${SPACE.xs + 2}px`, borderRadius: RADIUS.pill,
    border: `1px solid ${supported ? F.fenway : F.amber}`,
    background: supported ? F.surface : F.amberSoft,
    color: supported ? F.fenway : F.amber,
    fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
    letterSpacing: TRACKING.micro, textTransform: 'uppercase',
  }}>{status.replaceAll('_', ' ')}</span>;
}

function DirectionBadge({ direction, status }: { direction: NflPositionMarketTrend['direction']; status: NflPositionMarketTrend['status'] }) {
  const color = status === 'supported' && direction === 'growing'
    ? F.fenway
    : status === 'supported' && direction === 'shrinking'
      ? F.inkSoft
      : F.fgMuted;
  return <span style={{ color, fontWeight: 700, textTransform: 'capitalize' }}>{direction.replaceAll('_', ' ')}</span>;
}

function signalCell(signal: NflTransactionMarketSignal): string {
  if (signal.status === 'insufficient_evidence' || signal.baseline_value == null || signal.recent_value == null) return 'Insufficient';
  const values = signal.unit === 'events_per_100_player_seasons'
    ? `${formatRate(signal.baseline_value)} → ${formatRate(signal.recent_value)}`
    : signal.unit === 'apy_cap_basis_points'
      ? `${formatBasisPoints(signal.baseline_value)} → ${formatBasisPoints(signal.recent_value)}`
      : `${formatBasisPoints(signal.baseline_value)} → ${formatBasisPoints(signal.recent_value)}`;
  return `${values} (${signal.direction})`;
}

function formatRate(basisPoints: number): string {
  return (basisPoints / 100).toFixed(1);
}

function formatBasisPoints(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(1)}%`;
}

function formatChange(basisPoints: number | null): string {
  if (basisPoints == null) return 'change unavailable';
  const value = basisPoints / 100;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatDollars(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}

function formatDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(parsed))
    : value;
}

function transactionEventId(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const transaction = (data as Record<string, unknown>).transaction;
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction)) return null;
  const eventId = (transaction as Record<string, unknown>).event_id;
  return typeof eventId === 'string' && eventId ? eventId : null;
}

function SectionLabel({ children }: { children: string }) {
  return <div style={{
    marginBottom: SPACE.sm, color: F.fenway, fontFamily: 'var(--font-sans)',
    fontSize: TYPE.meta.md, fontWeight: 700, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
  }}>{children}</div>;
}

const tableHeaderStyle = {
  textAlign: 'left' as const,
  padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
  background: F.cream50,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 700,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase' as const,
  borderBottom: `1px solid ${F.border}`,
};

function tableCellStyle(index: number, total: number) {
  return {
    padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
    color: F.inkSoft,
    borderBottom: index === total - 1 ? 'none' : `1px solid ${F.border}`,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap' as const,
  };
}
