import type {
  NflPositionMarketTrend,
  NflTransactionComparable,
  NflTransactionMarketAnalysis,
  NflTransactionMarketSignal,
} from '@shared/types';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

export function NflTransactionMarketAnalysisView({ analysis }: { analysis: NflTransactionMarketAnalysis }) {
  const trendRows = analysis.position_trends.filter((trend) => trend.event_count > 0);
  const maxMobility = Math.max(1, ...trendRows.flatMap((trend) => [
    trend.mobility.baseline_value ?? 0,
    trend.mobility.recent_value ?? 0,
  ]));

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

      <section>
        <SectionLabel>Signal comparison</SectionLabel>
        <div style={{ overflowX: 'auto', border: `1px solid ${F.border}`, borderRadius: RADIUS.md }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, fontSize: TYPE.body.sm }}>
            <thead>
              <tr>
                {['Position', 'Read', 'Mobility', 'Move share', 'Contract price', 'Trade price', 'Sample'].map((column) => (
                  <th key={column} style={tableHeaderStyle}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trendRows.map((trend, index) => (
                <tr key={trend.position_group}>
                  <td style={tableCellStyle(index, trendRows.length)}><strong>{trend.position_group}</strong></td>
                  <td style={tableCellStyle(index, trendRows.length)}><DirectionBadge direction={trend.direction} status={trend.status} /></td>
                  <td style={tableCellStyle(index, trendRows.length)}>{signalCell(trend.mobility)}</td>
                  <td style={tableCellStyle(index, trendRows.length)}>{signalCell(trend.transaction_share)}</td>
                  <td style={tableCellStyle(index, trendRows.length)}>{signalCell(trend.contract_price)}</td>
                  <td style={tableCellStyle(index, trendRows.length)}>{signalCell(trend.trade_compensation)}</td>
                  <td style={tableCellStyle(index, trendRows.length)}>{trend.event_count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
        <ComparableSection title="Supporting transactions and comparables" rows={analysis.comparables} />
      )}
      {analysis.influential_transactions.length > 0 && (
        <ComparableSection title="What drove this result" rows={analysis.influential_transactions} showInfluence />
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

function ComparableSection({ title, rows, showInfluence = false }: { title: string; rows: NflTransactionComparable[]; showInfluence?: boolean }) {
  return (
    <section>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ display: 'grid', gap: SPACE.sm }}>
        {rows.map((row) => (
          <article key={row.event_id} style={{
            display: 'grid', gap: SPACE.xs, padding: SPACE.md,
            border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface,
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
          </article>
        ))}
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
