import { useState } from 'react';
import type { BriefSource, NflHistoricalSelection, NflSellerMoveResponse, NflTransactionComparable, NflTransactionMarketAnalysis } from '@shared/types';
import { marketAnnualRows, marketExampleTrades, sellerScenarioChanges } from '@shared/nflAnswerDepth';
import { nflTransactionMarketCohortEvidence, nflTransactionTradeAssetLabel } from '@shared/nflTransactionMarket';

export function MarketAnswerEvidence({ analysis, sources, onEvidence }: {
  analysis: NflTransactionMarketAnalysis; sources: BriefSource[]; onEvidence: (ref?: number) => void;
}) {
  const [measure, setMeasure] = useState<'events' | 'rate'>('events');
  const [selectedYear, setSelectedYear] = useState<number>();
  const points = marketAnnualRows(analysis);
  const value = (point: typeof points[number]) => measure === 'events' ? point.events : point.rosterPlayerSeasons > 0 ? point.events / point.rosterPlayerSeasons * 100 : null;
  const max = Math.max(1, ...points.map(point => value(point) ?? 0));
  const examples = marketExampleTrades(analysis, selectedYear);


  return <div className="gc-market-depth">
    {points.length > 0 && <section className="gc-annual" aria-label="Annual player movements">
      <div className="gc-evidence-heading"><h3>Player movements by year</h3><div className="gc-measure-toggle" aria-label="Annual chart measure">
        <button aria-pressed={measure === 'events'} onClick={() => setMeasure('events')}>Player movements</button>
        <button aria-pressed={measure === 'rate'} onClick={() => setMeasure('rate')}>Per 100 player-seasons</button>
      </div></div>
      <p className="gc-evidence-note">{analysis.query.position_groups.join(', ') || 'All positions'}{measure === 'rate' ? ' · Player movements ÷ player-seasons × 100' : ''}</p>
      <div className="gc-annual-bars" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(42px, 1fr))` }}>
        {points.map(point => {
          const current = value(point);
          const label = current == null ? 'N/A' : measure === 'events' ? String(current) : current.toFixed(2);
          return <button key={point.year} className={selectedYear === point.year ? 'selected' : ''} aria-pressed={selectedYear === point.year} aria-label={`${point.year}${point.partial ? ' partial year' : ''}: ${label} ${measure === 'events' ? 'player movements' : 'movements per 100 player-seasons'}. Show trades.`} onClick={() => setSelectedYear(selectedYear === point.year ? undefined : point.year)}>
            <strong>{label}</strong><div className="gc-bar-track" aria-hidden="true"><span style={{ height: `${current == null ? 0 : current / max * 100}%` }} /></div><small>{point.year}{point.partial ? '*' : ''}</small>
          </button>;
        })}
      </div>
      {points.some(point => point.partial) && <p className="gc-evidence-note">* Partial year. It is excluded from the completed-year comparison above.</p>}
    </section>}
    <section className="gc-trade-examples" aria-live="polite">
      <div className="gc-evidence-heading"><h3>{examples.title}</h3>{selectedYear != null && <button className="gc-text-button" onClick={() => setSelectedYear(undefined)}>Clear year filter</button>}</div>
      {examples.rows.length ? <><p className="gc-evidence-note">{examples.selection}</p><PackageCards rows={examples.rows} sources={sources} onEvidence={onEvidence} /></> : <p className="gc-evidence-note">No trade packages available for {selectedYear ?? 'this selection'}.</p>}
    </section>
  </div>;
}

export function ScenarioChangeEvidence({ current, previous }: { current: NflSellerMoveResponse; previous: NflSellerMoveResponse | null }) {
  const changes = sellerScenarioChanges(current, previous);
  if (!changes.length) return null;
  const visible = changes.filter(row => row.changed || ['Cap space created', 'Dead money', 'Following-year cap effect'].includes(row.label));
  return <section className="gc-scenario-change" aria-label="Changes from the previous scenario">
    <h3>Scenario changes</h3>
    <div><table><thead><tr><th>Item</th><th>Previous</th><th>Revised</th></tr></thead><tbody>{visible.map(row => <tr key={row.label} className={row.changed ? 'changed' : ''}><th>{row.label}</th><td>{row.before}</td><td>{row.after}{!row.changed && <small> · unchanged</small>}</td></tr>)}</tbody></table></div>
  </section>;
}


export function HistoricalPackageEvidence({ analysis, selection, sources, onEvidence }: {
  analysis: NflTransactionMarketAnalysis; selection: NflHistoricalSelection; sources: BriefSource[]; onEvidence: (ref?: number) => void;
}) {
  const [limit, setLimit] = useState(12);
  const evidence = nflTransactionMarketCohortEvidence(analysis);
  const byId = new Map(evidence.rows.map(row => [row.event_id, row]));
  const rows = selection.event_ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  return <section className="gc-trade-examples" aria-label="Matching trade packages">
    {rows.length > limit && <p className="gc-evidence-note">{limit} of {rows.length} trades · Newest first</p>}
    <PackageCards rows={rows.slice(0, limit)} sources={sources} onEvidence={onEvidence} />
    {rows.length > limit && <button className="gc-text-button" onClick={() => setLimit(limit + 12)}>Show next {Math.min(12, rows.length - limit)} trades</button>}
  </section>;
}

function PackageCards({ rows, sources, onEvidence }: {
  rows: NflTransactionComparable[]; sources: BriefSource[]; onEvidence: (ref?: number) => void;
}) {
  const eventRefs = new Map(sources.flatMap(source => {
    const data = source.data as Record<string, unknown> | null;
    const event = data?.transaction as { event_id?: string } | undefined;
    const id = event?.event_id ?? data?.transaction_event_id;
    return typeof id === 'string' ? [[id, source.ref_index] as const] : [];
  }));
  return <div className="gc-package-list">{rows.map(row => {
        const assets = row.trade_package?.assets ?? [];
        const teams = [...new Set(assets.map(asset => asset.received_team_id))].sort();
        const sourceRef = eventRefs.get(row.event_id);
        return <article key={row.trade_id ?? row.event_id}>
          <header><strong>{row.player_name}</strong><span>{row.event_date ?? row.event_year} · {row.from_team_id} → {row.to_team_id}</span>{sourceRef != null && <button onClick={() => onEvidence(sourceRef)}>Source [{sourceRef}]</button>}</header>
          {teams.length ? <div className="gc-package-sides">{teams.map(team => <div key={team}><h4>{team} received</h4><ul>{assets.filter(asset => asset.received_team_id === team).map(asset => <li key={asset.asset_id}>{nflTransactionTradeAssetLabel(asset)}</li>)}</ul></div>)}</div> : <p>{row.compensation_summary ?? 'The complete asset package is not recorded.'}</p>}
        </article>;
      })}</div>;
}
