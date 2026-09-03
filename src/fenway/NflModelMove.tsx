import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  NflPositionMarketGroup,
  NflSellerMoveOptionsResponse,
  NflSellerMoveResponse,
  NflTransactionMarketAnalysis,
} from '@shared/types';
import { getNflSellerMoveOptions, modelNflSellerMove } from '../api/nflTransactionMarket';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

export function NflModelMove({ analysis }: { analysis: NflTransactionMarketAnalysis }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<NflSellerMoveOptionsResponse | null>(null);
  const [position, setPosition] = useState<NflPositionMarketGroup | ''>('');
  const [playerId, setPlayerId] = useState('');
  const [pickYear, setPickYear] = useState<number | ''>('');
  const [pickRound, setPickRound] = useState(3);
  const [result, setResult] = useState<NflSellerMoveResponse | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const analysisPositions = useMemo(
    () => analysis.position_trends.map((trend) => trend.position_group),
    [analysis.position_trends],
  );
  const positionOption = options?.positions.find((row) => row.position_group === position) ?? null;
  const players = positionOption?.players ?? [];

  useEffect(() => {
    if (!open || options) return;
    setLoadingOptions(true);
    setError(null);
    void getNflSellerMoveOptions('NYG', analysisPositions)
      .then((next) => {
        setOptions(next);
        setPickYear(next.current_year + 1);
        const first = next.positions.find((row) => row.players.length > 0) ?? next.positions[0];
        setPosition(first?.position_group ?? '');
        setPlayerId(first?.players[0]?.player_id ?? '');
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => setLoadingOptions(false));
  }, [analysisPositions, open, options]);

  useEffect(() => {
    if (!open || !options || !position || !playerId || pickYear === '') {
      setResult(null);
      return;
    }
    const nextRequestId = ++requestId.current;
    setCalculating(true);
    setResult(null);
    setError(null);
    void modelNflSellerMove({
      team_id: 'NYG',
      player_id: playerId,
      position_group: position,
      pick_year: pickYear,
      pick_round: pickRound,
      market_scope: {
        snapshot_id: analysis.snapshot_id,
        start_year: analysis.query.start_year,
        end_year: analysis.query.end_year,
        include_ytd: analysis.query.include_ytd,
        team_ids: analysis.query.team_ids,
      },
    }).then((next) => {
      if (requestId.current === nextRequestId) setResult(next);
    }).catch((caught) => {
      if (requestId.current === nextRequestId) {
        setResult(null);
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }).finally(() => {
      if (requestId.current === nextRequestId) setCalculating(false);
    });
  }, [analysis, open, options, pickRound, pickYear, playerId, position]);

  function choosePosition(next: NflPositionMarketGroup) {
    setPosition(next);
    const firstPlayer = options?.positions.find((row) => row.position_group === next)?.players[0];
    setPlayerId(firstPlayer?.player_id ?? '');
  }

  if (!open) {
    return <section style={shellStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.md, flexWrap: 'wrap' }}>
        <div>
          <span style={eyebrowStyle}>Take it one step further</span>
          <strong style={{ display: 'block', color: F.ink, fontSize: TYPE.body.lg }}>Test a return for a current Giants player</strong>
        </div>
        <button type="button" onClick={() => setOpen(true)} style={primaryButtonStyle}>Model a move</button>
      </div>
    </section>;
  }

  return <section style={shellStyle} data-testid="nfl-model-move">
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: SPACE.md, alignItems: 'start' }}>
      <div>
        <span style={eyebrowStyle}>Seller-side check</span>
        <h3 style={{ margin: '2px 0 4px', color: F.ink, fontFamily: 'var(--font-display)', fontSize: TYPE.display.sm }}>Model a move</h3>
        <p style={{ margin: 0, color: F.fgMuted, fontSize: TYPE.body.sm }}>Your proposed pick is compared with the live historical result. Cap figures come from the selected Giants contract.</p>
      </div>
      <button type="button" onClick={() => setOpen(false)} aria-label="Close Model a move" style={quietButtonStyle}>Close</button>
    </div>

    {loadingOptions ? <p role="status" style={statusStyle}>Loading current Giants contracts…</p> : options && <div style={controlsStyle}>
      <label style={labelStyle}><span>Position from this analysis</span>
        <select aria-label="Position group" value={position} onChange={(event) => choosePosition(event.target.value as NflPositionMarketGroup)} style={inputStyle}>
          {options.positions.map((row) => <option key={row.position_group} value={row.position_group}>{row.position_group}{row.players.length === 0 ? ' — no complete Giants contract' : ''}</option>)}
        </select>
      </label>
      <label style={labelStyle}><span>Giants player</span>
        <select aria-label="Giants player" value={playerId} disabled={players.length === 0} onChange={(event) => setPlayerId(event.target.value)} style={inputStyle}>
          {players.length === 0 ? <option value="">No supported player</option> : players.map((player) => <option key={player.player_id} value={player.player_id}>{player.player_name} · {player.listed_position ?? player.position_group}</option>)}
        </select>
      </label>
      <label style={labelStyle}><span>Pick year</span>
        <select aria-label="Pick year" value={pickYear} onChange={(event) => setPickYear(Number(event.target.value))} style={inputStyle}>
          {[1, 2, 3].map((offset) => <option key={offset} value={options.current_year + offset}>{options.current_year + offset}</option>)}
        </select>
      </label>
      <label style={labelStyle}><span>Pick round / day</span>
        <select aria-label="Pick round" value={pickRound} onChange={(event) => setPickRound(Number(event.target.value))} style={inputStyle}>
          {[1, 2, 3, 4, 5, 6, 7].map((round) => <option key={round} value={round}>Round {round} · Day {pickDay(round)}</option>)}
        </select>
      </label>
    </div>}

    {calculating && <p role="status" style={statusStyle}>Updating the trade and cap result…</p>}
    {error && <p role="alert" style={{ ...statusStyle, color: F.red }}>{friendlyError(error)}</p>}
    {!calculating && !error && position && players.length === 0 && <p style={statusStyle}>No active Giants player in this position has all of the public contract fields needed for this calculation.</p>}
    {result && <MoveResult result={result} />}
  </section>;
}

function MoveResult({ result }: { result: NflSellerMoveResponse }) {
  return <div style={{ display: 'grid', gap: SPACE.lg }} aria-live="polite" data-testid="nfl-model-move-result">
    <div style={{ padding: SPACE.lg, borderRadius: RADIUS.md, background: F.fenwaySoft, borderLeft: `4px solid ${F.fenway}` }}>
      <span style={eyebrowStyle}>What New York receives · proposed by you</span>
      <strong style={{ display: 'block', color: F.ink, fontSize: TYPE.display.sm }}>{result.proposal.label}</strong>
      <p style={{ margin: '6px 0 0', color: F.inkSoft, fontSize: TYPE.body.md, fontWeight: 650 }}>{result.market.range_label}</p>
      <small style={{ color: F.fgMuted }}>{result.market.sample_size} usable historical trades · {result.market.cohort_label}</small>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm }}>
      <ResultMetric label={`${result.cap.current_year} cap space created`} value={money(result.cap.current_year_cap_space_created_dollars)} />
      <ResultMetric label={`${result.cap.current_year} dead money`} value={money(result.cap.current_year_dead_money_dollars)} />
      {result.cap.next_year && <ResultMetric
        label={`${result.cap.next_year.year} cap effect`}
        value={signedMoney(result.cap.next_year.cap_effect_dollars)}
        note={result.cap.next_year.cap_effect_dollars >= 0 ? 'additional cap space' : 'additional cap cost'}
      />}
      <ResultMetric label="Depth consequence" value={result.depth.label} note={result.depth.basis} />
    </div>

    {result.comparables.length > 0 && <div>
      <span style={eyebrowStyle}>Most relevant trades</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.sm, marginTop: SPACE.xs }}>
        {result.comparables.map((row) => <article key={row.event_id} style={{ padding: SPACE.md, background: F.surface, border: `1px solid ${F.border}`, borderRadius: RADIUS.md }}>
          <strong style={{ display: 'block', color: F.ink }}>{row.player_name}</strong>
          <span style={{ display: 'block', color: F.inkSoft, fontSize: TYPE.body.sm }}>{row.from_team_id} → {row.to_team_id} · {row.event_year}</span>
          <span style={{ display: 'block', marginTop: 4, color: F.fgMuted, fontSize: TYPE.meta.md }}>{row.compensation_summary}</span>
          <a href={row.source_url} target="_blank" rel="noreferrer" style={sourceLinkStyle} aria-label={`Open transaction source for ${row.player_name}`}>Open transaction source ↗</a>
        </article>)}
      </div>
    </div>}

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
          <a href={result.cap.contract_source_url} target="_blank" rel="noreferrer" style={sourceLinkStyle}>Open player contract source ↗</a>
          {result.depth.source_url && <a href={result.depth.source_url} target="_blank" rel="noreferrer" style={sourceLinkStyle}>Open role source ↗</a>}
        </div>
        {result.limitations.map((limitation) => <p key={limitation} style={{ margin: 0, color: F.fgMuted }}>{limitation}</p>)}
      </div>
    </details>
  </div>;
}

function ResultMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div style={{ padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface }}>
    <span style={{ display: 'block', color: F.fgMuted, fontSize: TYPE.meta.xs, textTransform: 'uppercase', letterSpacing: TRACKING.micro }}>{label}</span>
    <strong style={{ display: 'block', marginTop: 4, color: F.ink, fontSize: TYPE.body.lg, fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
    {note && <small style={{ display: 'block', marginTop: 4, color: F.fgMuted, lineHeight: 1.35 }}>{note}</small>}
  </div>;
}

function pickDay(round: number): number { return round === 1 ? 1 : round <= 3 ? 2 : 3; }
function money(value: number): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value); }
function signedMoney(value: number): string { return `${value >= 0 ? '+' : '−'}${money(Math.abs(value))}`; }
function friendlyError(value: string): string {
  if (/snapshot.*current|no longer current/i.test(value)) return 'The historical data changed. Rerun the market question before testing this move.';
  if (/contract/i.test(value)) return 'The current public contract data does not support this calculation.';
  return 'This move could not be calculated from the available public data.';
}

const shellStyle: React.CSSProperties = { display: 'grid', gap: SPACE.lg, padding: SPACE.lg, border: `1px solid ${F.borderStrong}`, borderRadius: RADIUS.md, background: F.cream50 };
const controlsStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: SPACE.sm };
const labelStyle: React.CSSProperties = { display: 'grid', gap: 5, color: F.inkSoft, fontSize: TYPE.meta.md, fontWeight: 700 };
const inputStyle: React.CSSProperties = { width: '100%', minWidth: 0, padding: `${SPACE.xs + 2}px ${SPACE.sm}px`, border: `1px solid ${F.borderStrong}`, borderRadius: RADIUS.sm, background: F.surface, color: F.ink, fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm };
const eyebrowStyle: React.CSSProperties = { display: 'block', marginBottom: 4, color: F.fenway, fontSize: TYPE.meta.xs, fontWeight: 700, letterSpacing: TRACKING.micro, textTransform: 'uppercase' };
const primaryButtonStyle: React.CSSProperties = { border: 0, borderRadius: RADIUS.sm, background: F.fenway, color: F.surface, padding: `${SPACE.xs + 2}px ${SPACE.md}px`, fontWeight: 700, cursor: 'pointer' };
const quietButtonStyle: React.CSSProperties = { border: `1px solid ${F.border}`, borderRadius: RADIUS.sm, background: F.surface, color: F.inkSoft, padding: `${SPACE.xs}px ${SPACE.sm}px`, cursor: 'pointer' };
const statusStyle: React.CSSProperties = { margin: 0, color: F.fgMuted, fontSize: TYPE.body.sm };
const sourceLinkStyle: React.CSSProperties = { display: 'inline-block', marginTop: SPACE.xs, color: F.fenway, fontSize: TYPE.meta.md, fontWeight: 700, textDecoration: 'none' };
