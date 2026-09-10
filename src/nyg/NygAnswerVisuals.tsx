import { useState } from 'react';
import type { NflAnswerVisual } from '@shared/nflAnswerVisuals';

export function NygAnswerVisuals({ visuals, onEvidence }: { visuals: NflAnswerVisual[]; onEvidence: (ref?: number) => void }) {
  return <div className="gc-answer-visuals">{visuals.map(visual => <AnswerVisual key={`${visual.tableIndex}:${visual.context}`} visual={visual} onEvidence={onEvidence} />)}</div>;
}

function AnswerVisual({ visual, onEvidence }: { visual: NflAnswerVisual; onEvidence: (ref?: number) => void }) {
  const [metric, setMetric] = useState(0);
  const selectedMetric = visual.kind === 'bars' ? Math.min(metric, visual.metrics.length - 1) : 0;
  const count = visual.kind === 'bars' ? visual.points.length : visual.kind === 'practice' ? visual.players.length : visual.rows.length;
  return <section className="gc-answer-visual" aria-label={visual.title}>
    <header><div><h3>{visual.title}</h3><p>{visual.context}</p></div><button className="gc-chart-source" onClick={() => onEvidence(visual.sourceRefs[0])}>Sources <span>↗</span></button></header>
    {visual.kind === 'bars' && <>
      {!visual.grouped && <div className="gc-chart-controls"><label>Compare by <select aria-label="Comparison metric" value={selectedMetric} onChange={event => setMetric(Number(event.target.value))}>{visual.metrics.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>{visual.points.some(point => point.internal) && <span className="gc-chart-key"><i className="internal" /> NYG <i /> Other teams</span>}</div>}
      {visual.grouped && <div className="gc-chart-legend">{visual.metrics.map((name, i) => <span key={name}><i className={`series-${i % 4}`} />{name}</span>)}</div>}
      <Bars visual={visual} metric={selectedMetric} />
    </>}
    {visual.kind === 'practice' && <>
      <div className="gc-practice-matrix" style={{ gridTemplateColumns: `minmax(130px, 1.5fr) repeat(${visual.dates.length}, minmax(58px, 1fr)) minmax(88px, 1fr)` }}>
        <span /><>{visual.dates.map(day => <strong className="gc-matrix-heading" key={day}>{day}</strong>)}</><strong className="gc-matrix-heading">Game status</strong>
        {visual.players.map((player, i) => <div className="gc-matrix-row" key={i}><strong>{player.name}</strong>{player.statuses.map((status, j) => <span className={`gc-practice-cell ${/^(DNP|LP|FP)$/.test(status) ? status.toLowerCase() : 'unknown'}`} key={j}>{status}</span>)}<span className="gc-game-designation">{player.designation || 'Not recorded'}</span></div>)}
      </div>
      <div className="gc-chart-legend"><span><i className="practice-fp" />FP · Full</span><span><i className="practice-lp" />LP · Limited</span><span><i className="practice-dnp" />DNP · Did not participate</span></div>
    </>}
    {visual.kind === 'downs' && <>
      <div className="gc-chart-legend"><span><i className="series-0" />Converted</span><span><i className="series-1" />Failed</span></div>
      <div className="gc-down-bars">{visual.rows.map((row, i) => {
        const total = row.converted + row.failed;
        return <div key={i}><div className="gc-down-label"><strong>{row.label}</strong><span>{row.converted} converted · {row.failed} failed{row.share !== 'Not recorded' ? ` · ${row.share}` : ''}</span></div><div className="gc-down-track" aria-hidden="true"><span style={{ width: `${total ? row.converted / total * 100 : 0}%` }} /><span style={{ width: `${total ? row.failed / total * 100 : 0}%` }} /></div></div>;
      })}</div>
    </>}
    {count < visual.totalRows && <p className="gc-chart-foot">{count} of {visual.totalRows} rows shown. All rows are in the full figures below.</p>}
  </section>;
}

function Bars({ visual, metric }: { visual: Extract<NflAnswerVisual, { kind: 'bars' }>; metric: number }) {
  const indices = visual.grouped ? visual.metrics.map((_, i) => i) : [metric];
  const values = visual.points.flatMap(point => indices.map(i => point.values[i]).filter((v): v is number => v != null));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const extent = max - min || 1;
  const zero = -min / extent * 100;
  const axisLabel = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1, ...(visual.grouped ? { style: 'currency', currency: 'USD' } : {}) }).format(value);
  return <div className={`gc-comparison-bars${visual.grouped ? ' grouped' : ''}`}>
    <div className="gc-chart-axis"><span>{axisLabel(min)}</span><span>{axisLabel(max)}</span></div>
    {visual.points.map((point, row) => <div className="gc-comparison-row" key={row}>
      <div className="gc-chart-player"><strong>{point.label}</strong>{point.detail && <small>{point.detail}</small>}</div>
      <div className="gc-chart-series">{indices.map(index => {
        const value = point.values[index];
        const left = value == null ? zero : (Math.min(0, value) - min) / extent * 100;
        return <div className="gc-chart-value-row" key={index} aria-label={`${point.label}, ${visual.metrics[index]}: ${point.labels[index]}`}>
          <div className="gc-horizontal-track" aria-hidden="true"><i className="gc-zero-line" style={{ left: `${zero}%` }} />{value != null && <span className={visual.grouped ? `series-${index % 4}` : point.internal ? 'internal' : 'external'} style={{ left: `${left}%`, width: `${Math.abs(value) / extent * 100}%` }} />}</div>
          <strong className={value == null ? 'gc-chart-unknown' : ''}>{point.labels[index]}</strong>
        </div>;
      })}</div>
    </div>)}
  </div>;
}
