import type {
  NflPositionMarketTrend,
  NflTransactionComparable,
  NflTransactionMarketAnalysis,
  NflTransactionMarketSignal,
  NflTransactionMarketYearPoint,
} from '@shared/types';
import { nflTransactionMarketFootballRead } from '@shared/nflTransactionMarket';
import { fire } from '../lib/events';
import { useBriefs, useUi } from '../store';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

interface Props {
  analysis: NflTransactionMarketAnalysis;
  interpretation?: string;
  followups?: string[];
}

export function NflTransactionMarketAnalysisView({ analysis, interpretation = '', followups = [] }: Props) {
  const footballRead = nflTransactionMarketFootballRead(analysis);
  const { activeBriefId, sourcesByBrief } = useBriefs();
  const { setSelectedSourceRef, setSourceFilterRefs, setHighlightedSourceRef, setRailCollapsed } = useUi();
  const eventSourceRefs = new Map(
    (activeBriefId ? sourcesByBrief[activeBriefId] ?? [] : [])
      .flatMap((source) => {
        const eventId = transactionEventId(source.data);
        return eventId ? [[eventId, source.ref_index] as const] : [];
      }),
  );
  const openComparableEvidence = (row: NflTransactionComparable) => {
    const ref = eventSourceRefs.get(row.event_id);
    if (ref == null) return;
    setSourceFilterRefs([ref]);
    setHighlightedSourceRef(ref);
    setSelectedSourceRef(ref);
    setRailCollapsed(false);
    fire('v6d3cf:open-evidence', { ref });
  };
  const visibleTrends = primaryTrendRows(analysis);
  const keyTransactions = (
    analysis.influential_transactions.length > 0
      ? analysis.influential_transactions
      : analysis.comparables
  ).slice(0, 4);
  const supplemental = supplementalInterpretation(interpretationForDisplay(interpretation), footballRead);

  return (
    <div style={{ display: 'grid', gap: SPACE.xl }} data-testid="nfl-transaction-market-analysis">
      <section style={{
        display: 'grid', gap: SPACE.md, padding: `${SPACE.xl}px ${SPACE['2xl']}px`,
        border: `1px solid ${F.fenway}`, borderLeft: `4px solid ${F.fenway}`,
        borderRadius: RADIUS.md, background: F.fenwaySoft,
      }}>
        <div>
          <SectionLabel>Bottom line</SectionLabel>
          <h3 style={{
            margin: 0, color: F.ink, fontFamily: 'var(--font-display)',
            fontSize: TYPE.display.md, lineHeight: 1.35, letterSpacing: TRACKING.tight,
          }}>{footballRead.conclusion}</h3>
        </div>
        <div style={{ borderTop: `1px solid ${F.borderStrong}`, paddingTop: SPACE.md }}>
          <span style={{
            display: 'block', marginBottom: 4, color: F.fenway,
            fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md,
            fontWeight: 700, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
          }}>What this means for New York</span>
          <p style={{ margin: 0, color: F.ink, fontSize: TYPE.body.lg, lineHeight: 1.5, fontWeight: 600 }}>
            {newYorkImplication(footballRead.implication)}
          </p>
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: SPACE.sm, flexWrap: 'wrap' }}>
          <SectionLabel>Market comparison</SectionLabel>
          <span style={{ color: F.fgMuted, fontSize: TYPE.meta.md }}>
            {analysis.query.baseline_years.join('–')} vs {analysis.query.recent_years.join('–')}
          </span>
        </div>
        <div style={{ overflowX: 'auto', border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
          <table style={{ width: '100%', minWidth: 690, borderCollapse: 'collapse', fontSize: TYPE.body.sm }}>
            <thead>
              <tr>
                {['Position', 'Overall read', 'Player movement', 'Contract cost vs. cap', 'Premium-pick trades'].map((label) => (
                  <th key={label} style={tableHeaderStyle}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleTrends.map((trend, index) => (
                <tr key={trend.position_group}>
                  <td style={tableCellStyle(index, visibleTrends.length)}><strong style={{ color: F.ink }}>{trend.position_group}</strong></td>
                  <td style={tableCellStyle(index, visibleTrends.length)}><OverallRead trend={trend} /></td>
                  <td style={tableCellStyle(index, visibleTrends.length)}><SignalRead signal={trend.mobility} /></td>
                  <td style={tableCellStyle(index, visibleTrends.length)}><SignalRead signal={trend.contract_price} /></td>
                  <td style={tableCellStyle(index, visibleTrends.length)}><SignalRead signal={trend.trade_compensation} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {analysis.position_trends.length > visibleTrends.length && (
          <p style={{ margin: `${SPACE.xs}px 0 0`, color: F.fgMuted, fontSize: TYPE.meta.md }}>
            Showing the six most decision-relevant position reads. The full comparison is available below.
          </p>
        )}
      </section>

      {keyTransactions.length > 0 && (
        <section>
          <SectionLabel>{analysis.influential_transactions.length > 0 ? 'Transactions that most affect the result' : 'Key transactions'}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: SPACE.sm }}>
            {keyTransactions.map((row) => (
              <KeyTransaction
                key={row.event_id}
                row={row}
                sourceRef={eventSourceRefs.get(row.event_id)}
                onOpen={openComparableEvidence}
              />
            ))}
          </div>
        </section>
      )}

      {supplemental && (
        <section style={{ padding: SPACE.md, borderLeft: `3px solid ${F.borderStrong}`, background: F.cream50 }}>
          <SectionLabel>Analyst interpretation</SectionLabel>
          <p style={{ margin: 0, color: F.inkSoft, fontSize: TYPE.body.md, lineHeight: 1.6 }}>{supplemental}</p>
        </section>
      )}

      {followups.length > 0 && (
        <section>
          <SectionLabel>Next questions</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>
            {followups.slice(0, 4).map((followup) => (
              <span key={followup} style={{
                color: F.fenway, background: F.fenwaySoft, border: `1px solid ${F.fenway}`,
                borderRadius: RADIUS.pill, padding: `${SPACE.xs - 1}px ${SPACE.sm}px`, fontSize: TYPE.body.sm,
              }}>{followup}</span>
            ))}
          </div>
        </section>
      )}

      <details style={{ border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
        <summary style={{
          cursor: 'pointer', padding: `${SPACE.md}px ${SPACE.lg}px`, color: F.ink,
          fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md, fontWeight: 700,
        }}>See calculation and sources</summary>
        <div style={{ display: 'grid', gap: SPACE.xl, padding: `0 ${SPACE.lg}px ${SPACE.lg}px` }}>
          <ScopeSummary analysis={analysis} />
          <AnnualSeriesChart analysis={analysis} />
          <FullSignalComparison trends={analysis.position_trends} />
          <Methodology analysis={analysis} />
          {analysis.comparables.length > 0 && (
            <ComparableSection title="Supporting transactions" rows={analysis.comparables} sourceRefs={eventSourceRefs} onOpen={openComparableEvidence} />
          )}
          {analysis.influential_transactions.length > 0 && (
            <ComparableSection title="Transactions that most affect the result" rows={analysis.influential_transactions} sourceRefs={eventSourceRefs} onOpen={openComparableEvidence} showInfluence />
          )}
          <CoverageAndSources analysis={analysis} />
        </div>
      </details>
    </div>
  );
}

function primaryTrendRows(analysis: NflTransactionMarketAnalysis): NflPositionMarketTrend[] {
  if (analysis.position_trends.length <= 6) return analysis.position_trends;
  const tradeOnly = analysis.query.transaction_types.length === 1 && analysis.query.transaction_types[0] === 'trade';
  return [...analysis.position_trends]
    .sort((left, right) => tradeOnly
      ? (right.trade_compensation.overall_value ?? -1) - (left.trade_compensation.overall_value ?? -1)
      : right.event_count - left.event_count || statusRank(right) - statusRank(left))
    .slice(0, 6);
}

function statusRank(trend: NflPositionMarketTrend): number {
  return trend.status === 'supported' ? 2 : trend.status === 'directional' ? 1 : 0;
}

function OverallRead({ trend }: { trend: NflPositionMarketTrend }) {
  return <strong style={{ color: trend.status === 'supported' ? F.ink : F.inkSoft, fontWeight: 650 }}>{overallReadText(trend)}</strong>;
}

function SignalRead({ signal }: { signal: NflTransactionMarketSignal }) {
  if (signal.status === 'insufficient_evidence' || signal.baseline_value == null || signal.recent_value == null) {
    return <span style={{ color: F.fgMuted }}>Not enough data</span>;
  }
  const percent = signal.unit !== 'events_per_100_player_seasons';
  return <span style={{ display: 'grid', gap: 2 }}>
    <strong style={{ color: F.inkSoft, fontWeight: 650 }}>{directionLabel(signal.direction)}</strong>
    <span style={{ color: F.fgMuted, fontVariantNumeric: 'tabular-nums', fontSize: TYPE.meta.md }}>
      {percent ? formatPercentDetailed(signal.baseline_value) : formatRateDetailed(signal.baseline_value)} →{' '}
      {percent ? formatPercentDetailed(signal.recent_value) : formatRateDetailed(signal.recent_value)}
    </span>
  </span>;
}

function KeyTransaction({ row, sourceRef, onOpen }: {
  row: NflTransactionComparable;
  sourceRef: number | undefined;
  onOpen: (row: NflTransactionComparable) => void;
}) {
  return <button
    type="button"
    disabled={sourceRef == null}
    onClick={() => onOpen(row)}
    aria-label={`Open evidence for ${row.player_name}`}
    style={{
      display: 'grid', gap: 4, padding: SPACE.md, width: '100%', textAlign: 'left',
      border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface,
      color: 'inherit', cursor: sourceRef == null ? 'default' : 'pointer',
    }}
  >
    <strong style={{ color: F.ink, fontSize: TYPE.body.md }}>{row.player_name}</strong>
    <span style={{ color: F.inkSoft, fontSize: TYPE.body.sm }}>
      {row.position_group ?? 'Position unresolved'} · {moveLabel(row.transaction_type)}
      {row.from_team_id || row.to_team_id ? ` · ${row.from_team_id ?? 'FA'} → ${row.to_team_id ?? 'FA'}` : ''}
    </span>
    <span style={{ color: F.fgMuted, fontSize: TYPE.meta.md }}>
      {formatDate(row.event_date ?? String(row.event_year))}
      {row.compensation_summary ? ` · ${row.compensation_summary}` : ''}
      {row.contract_apy_dollars != null ? ` · ${formatDollars(row.contract_apy_dollars)} APY` : ''}
    </span>
    <span style={{ color: sourceRef == null ? F.fgMuted : F.fenway, fontSize: TYPE.meta.md, fontWeight: 700 }}>
      {sourceRef == null ? 'Source detail available after a live refresh' : 'Open transaction evidence →'}
    </span>
  </button>;
}

function ScopeSummary({ analysis }: { analysis: NflTransactionMarketAnalysis }) {
  return <section style={{ display: 'grid', gap: SPACE.xs, padding: SPACE.md, background: F.cream50, borderRadius: RADIUS.md }}>
    <SectionLabel>Market scope</SectionLabel>
    <strong style={{ color: F.ink }}>{evidenceStatusLabel(analysis.status)}</strong>
    <span style={{ color: F.inkSoft, fontSize: TYPE.body.sm, lineHeight: 1.5 }}>
      {analysis.query.start_year}–{analysis.query.end_year}
      {analysis.query.include_ytd ? ' including labeled 2026 YTD' : ''}
      {' · '}{analysis.query.position_groups.length ? analysis.query.position_groups.join(', ') : 'all positions'}
      {' · '}{analysis.query.transaction_types.map(moveLabel).join(', ')}
      {analysis.query.team_ids.length ? ` · ${analysis.query.team_ids.join(', ')}` : ' · leaguewide'}
    </span>
    <span style={{ color: F.fgMuted, fontSize: TYPE.meta.md }}>
      Calculated {formatDate(analysis.generated_at)} · snapshot {analysis.snapshot_id.slice(0, 12)}
    </span>
  </section>;
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
    <SectionLabel>Year-by-year player movement</SectionLabel>
    <div style={{ border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface, overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: SPACE.sm, padding: `${SPACE.sm}px ${SPACE.md}px`, borderBottom: `1px solid ${F.border}`, color: F.fgMuted, fontSize: TYPE.meta.md }}>
        <span>Player moves per 100 roster player-seasons</span>
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
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${position} annual player movement from ${years[0]} to ${years.at(-1)}`} style={{ width: '100%', height, overflow: 'visible' }}>
            <line x1="0" x2={width} y1={height - 4} y2={height - 4} stroke={F.border} strokeWidth="1" />
            {plotted.length > 1 && <polyline fill="none" stroke={F.fenway} strokeWidth="2.5" vectorEffect="non-scaling-stroke" points={plotted.map((point) => `${point.x},${point.y}`).join(' ')} />}
            {plotted.map((point, index) => <circle key={`${position}-${index}`} cx={point.x} cy={point.y} r="2.5" fill={F.fenway} vectorEffect="non-scaling-stroke" />)}
          </svg>
          <span style={{ justifySelf: 'end', color: F.inkSoft, fontVariantNumeric: 'tabular-nums', fontSize: TYPE.meta.md }}>
            {first == null || last == null ? 'No annual rate' : `${formatRateDetailed(first)} → ${formatRateDetailed(last)}`}
          </span>
        </div>;
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: `${SPACE.xs}px ${SPACE.md}px ${SPACE.sm}px 70px`, color: F.fgMuted, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs }}>
        {years.map((year) => <span key={year}>{year}</span>)}
      </div>
    </div>
  </section>;
}

function FullSignalComparison({ trends }: { trends: NflPositionMarketTrend[] }) {
  return <section>
    <SectionLabel>Full signal comparison</SectionLabel>
    <div style={{ display: 'grid', gap: SPACE.sm }}>
      {trends.map((trend) => (
        <article key={trend.position_group} style={{ padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: SPACE.sm, flexWrap: 'wrap' }}>
            <strong style={{ color: F.ink }}>{trend.position_group} · {overallReadText(trend)}</strong>
            <span style={{ color: F.fgMuted, fontSize: TYPE.meta.md }}>{trend.event_count.toLocaleString()} player moves analyzed</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm, marginTop: SPACE.sm }}>
            <SignalMetric label="How often players moved" signal={trend.mobility} />
            <SignalMetric label="Share of league movement" signal={trend.transaction_share} />
            <SignalMetric label="Contract cost versus cap" signal={trend.contract_price} />
            <SignalMetric label="Trades returning premium picks" signal={trend.trade_compensation} />
          </div>
        </article>
      ))}
    </div>
  </section>;
}

function SignalMetric({ label, signal }: { label: string; signal: NflTransactionMarketSignal }) {
  return <div style={{ minWidth: 0 }}>
    <span style={{ display: 'block', color: F.fgMuted, fontSize: TYPE.meta.xs, textTransform: 'uppercase', letterSpacing: TRACKING.micro }}>{label}</span>
    <strong style={{ display: 'block', marginTop: 3, color: F.inkSoft, fontSize: TYPE.body.sm, overflowWrap: 'anywhere' }}>{technicalSignalCell(signal)}</strong>
    <span style={{ color: F.fgMuted, fontSize: TYPE.meta.xs }}>
      {signal.sample_size.toLocaleString()} records · {evidenceStatusLabel(signal.status)}
    </span>
  </div>;
}

function Methodology({ analysis }: { analysis: NflTransactionMarketAnalysis }) {
  return <section>
    <SectionLabel>Calculation method</SectionLabel>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.sm }}>
      <MethodCard title="Comparison period" body={analysis.methodology.cohort} />
      <MethodCard title="How player movement was measured" body={analysis.methodology.mobility} />
      <MethodCard title="Trades returning premium picks" body={analysis.methodology.trade_price} />
      <MethodCard title="Contract cost versus cap" body={analysis.methodology.contract_price} />
      <MethodCard title="How the overall read was set" body={analysis.methodology.classification} />
      <MethodCard title="Transactions that most affect the result" body={analysis.methodology.influence} />
    </div>
    <p style={{ margin: `${SPACE.sm}px 0 0`, color: F.fgMuted, fontSize: TYPE.meta.md, lineHeight: 1.45 }}>
      Minimum records: {analysis.methodology.minimum_samples}
    </p>
  </section>;
}

function CoverageAndSources({ analysis }: { analysis: NflTransactionMarketAnalysis }) {
  return <section>
    <SectionLabel>Coverage, limits, and sources</SectionLabel>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm, marginBottom: SPACE.sm }}>
      <Metric label="Player moves analyzed" value={analysis.coverage.event_count.toLocaleString()} />
      <Metric label="Trades" value={analysis.coverage.trade_count.toLocaleString()} />
      <Metric label="Contracts with terms" value={analysis.coverage.priced_contract_count.toLocaleString()} />
      <Metric label="Player records matched" value={formatPercentDetailed(analysis.coverage.position_match_basis_points)} />
    </div>
    <div style={{ display: 'grid', gap: SPACE.xs, padding: SPACE.md, background: F.cream50, border: `1px solid ${F.border}`, borderRadius: RADIUS.md }}>
      {analysis.limitations.map((limitation, index) => (
        <div key={index} style={{ color: F.fgMuted, fontSize: TYPE.body.sm, lineHeight: 1.5 }}>{limitation}</div>
      ))}
      {analysis.source_refs.map((source) => (
        <div key={source.id} style={{ color: F.fgMuted, fontSize: TYPE.meta.md, lineHeight: 1.45 }}>
          <strong style={{ color: F.ink }}>{source.name}</strong> · as of {source.as_of_date} · retrieved {formatDate(source.retrieved_at)} · SHA-256 {source.checksum_sha256.slice(0, 12)}…
        </div>
      ))}
    </div>
  </section>;
}

function ComparableSection({ title, rows, sourceRefs, onOpen, showInfluence = false }: {
  title: string;
  rows: NflTransactionComparable[];
  sourceRefs: Map<string, number>;
  onOpen: (row: NflTransactionComparable) => void;
  showInfluence?: boolean;
}) {
  return <section>
    <SectionLabel>{title}</SectionLabel>
    <div style={{ display: 'grid', gap: SPACE.sm }}>
      {rows.map((row) => {
        const sourceRef = sourceRefs.get(row.event_id);
        return <button type="button" key={row.event_id} disabled={sourceRef == null} onClick={() => onOpen(row)} aria-label={`Open evidence for ${row.player_name}`} style={{
          display: 'grid', gap: SPACE.xs, padding: SPACE.md, border: `1px solid ${F.border}`,
          borderRadius: RADIUS.md, background: F.surface, width: '100%', textAlign: 'left',
          color: 'inherit', cursor: sourceRef == null ? 'default' : 'pointer',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: SPACE.sm }}>
            <strong style={{ color: F.ink, fontSize: TYPE.body.sm }}>{row.player_name}</strong>
            <span style={{ color: F.fgMuted, fontSize: TYPE.meta.xs }}>{row.event_date ?? row.event_year} · {row.date_precision} date</span>
          </div>
          <div style={{ color: F.inkSoft, fontSize: TYPE.body.sm, lineHeight: 1.45 }}>
            {row.position_group ?? 'Position unresolved'} · {moveLabel(row.transaction_type)}
            {row.from_team_id || row.to_team_id ? ` · ${row.from_team_id ?? 'FA'} → ${row.to_team_id ?? 'FA'}` : ''}
            {row.compensation_summary ? ` · ${row.compensation_summary}` : ''}
            {row.contract_apy_dollars != null ? ` · ${formatDollars(row.contract_apy_dollars)} APY` : ''}
          </div>
          <div style={{ color: F.fgMuted, fontSize: TYPE.meta.md }}>
            Player record: {row.identity_confidence}
            {row.raw_position ? ` · Source position: ${row.raw_position}` : ''}
            {row.normalization_basis ? ` · Position mapping: ${row.normalization_basis}` : ''}
            {showInfluence && row.influence_explanation ? ` · ${row.influence_explanation}` : ''}
          </div>
          <div style={{ color: sourceRef == null ? F.fgMuted : F.fenway, fontSize: TYPE.meta.xs, fontWeight: 700 }}>
            {sourceRef == null ? 'Source detail unavailable for this saved result' : `Open exact evidence [${sourceRef}] →`}
          </div>
        </button>;
      })}
    </div>
  </section>;
}

function MethodCard({ title, body }: { title: string; body: string }) {
  return <div style={{ padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
    <strong style={{ display: 'block', marginBottom: 4, color: F.ink, fontSize: TYPE.body.sm }}>{title}</strong>
    <span style={{ color: F.fgMuted, fontSize: TYPE.body.sm, lineHeight: 1.5 }}>{body}</span>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div style={{ padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
    <div style={{ color: F.fgMuted, fontSize: TYPE.meta.xs, textTransform: 'uppercase', letterSpacing: TRACKING.micro }}>{label}</div>
    <div style={{ marginTop: 4, color: F.ink, fontFamily: 'var(--font-display)', fontSize: TYPE.display.md }}>{value}</div>
  </div>;
}

function overallReadText(trend: NflPositionMarketTrend): string {
  if (trend.status === 'insufficient_evidence') return 'Not enough data';
  if (trend.direction === 'mixed') return 'Mixed signals';
  return `${trend.status === 'supported' ? 'Clear' : 'Likely'} ${directionNoun(trend.direction)}`;
}

function evidenceStatusLabel(status: NflTransactionMarketAnalysis['status']): string {
  if (status === 'supported') return 'Strong evidence';
  if (status === 'directional') return 'Likely trend';
  return 'Not enough evidence';
}

function directionNoun(direction: NflPositionMarketTrend['direction']): string {
  if (direction === 'growing') return 'growth';
  if (direction === 'shrinking') return 'decline';
  if (direction === 'flat') return 'stability';
  return direction === 'mixed' ? 'mixed signals' : 'uncertainty';
}

function directionLabel(direction: NflTransactionMarketSignal['direction']): string {
  if (direction === 'growing') return 'Up';
  if (direction === 'shrinking') return 'Down';
  if (direction === 'flat') return 'Stable';
  if (direction === 'mixed') return 'Mixed';
  return 'Not enough data';
}

function technicalSignalCell(signal: NflTransactionMarketSignal): string {
  if (signal.status === 'insufficient_evidence' || signal.baseline_value == null || signal.recent_value == null) return 'Not enough evidence';
  const delta = signal.recent_value - signal.baseline_value;
  const values = signal.unit === 'events_per_100_player_seasons'
    ? `${formatRateDetailed(signal.baseline_value)} → ${formatRateDetailed(signal.recent_value)} · ${formatSigned(delta / 100, 2)} per 100`
    : `${formatPercentDetailed(signal.baseline_value)} → ${formatPercentDetailed(signal.recent_value)} · ${formatSigned(delta, 0)} bp`;
  return `${values} (${directionLabel(signal.direction).toLowerCase()})`;
}

function interpretationForDisplay(value: string): string {
  return value
    .replace(/clear the supported multi-signal growth gate/gi, 'show a clear growth trend')
    .replace(/clear the supported multi-signal shrinkage gate/gi, 'show a clear decline')
    .replace(/classification rules and evidence gates/gi, 'calculation rules and source limits')
    .replace(/\bmaterial events\b/gi, 'player moves analyzed')
    .replace(/\bmobility\b/gi, 'player movement')
    .replace(/\bmove share\b/gi, 'share of league player movement')
    .replace(/\bcontract price\b/gi, 'contract cost versus the cap')
    .replace(/\btrade price\b/gi, 'premium-pick trade return')
    .replace(/\bidentity coverage\b/gi, 'player records matched')
    .replace(/\bcohort\b/gi, 'comparison period')
    .trim();
}

function supplementalInterpretation(value: string, read: { conclusion: string; implication: string }): string | null {
  if (!value) return null;
  const cleanedConclusion = interpretationForDisplay(read.conclusion);
  const cleanedImplication = interpretationForDisplay(read.implication);
  const remainder = value
    .replace(cleanedConclusion, '')
    .replace(cleanedImplication, '')
    .replace(/The calculation rules and source limits remain visible below\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return remainder.length >= 24 ? remainder : null;
}

function newYorkImplication(value: string): string {
  const stripped = value.replace(/^For New York:\s*/i, '');
  return stripped.replace(/^./, (letter) => letter.toUpperCase());
}

function moveLabel(value: string): string {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function formatRateDetailed(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2);
}

function formatPercentDetailed(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

function formatSigned(value: number, precision: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(precision)}`;
}

function formatDollars(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${value.toLocaleString()}`;
}

function formatDate(value: string): string {
  if (/^\d{4}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      .format(new Date(year, month - 1, day));
  }
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
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  background: F.cream50,
  color: F.fgMuted,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.meta.xs,
  fontWeight: 700,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase' as const,
  borderBottom: `1px solid ${F.border}`,
};

function tableCellStyle(index: number, total: number) {
  return {
    padding: `${SPACE.sm}px ${SPACE.md}px`,
    color: F.inkSoft,
    borderBottom: index === total - 1 ? 'none' : `1px solid ${F.border}`,
    verticalAlign: 'top' as const,
  };
}
