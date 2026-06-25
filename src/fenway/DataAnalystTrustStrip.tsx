import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import type { DataAnalystTrace, ToolCall } from '@shared/types';

export function DataAnalystTrustStrip({ toolCalls }: { toolCalls?: ToolCall[] | null }) {
  const traces = extractDataAnalystTraces(toolCalls);
  const datasets = dedupeDatasets(traces);
  const errors = traces.flatMap((trace) => trace.errors);
  if (datasets.length === 0 && errors.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: SPACE.xs,
      flexWrap: 'wrap',
      marginTop: SPACE.md,
      paddingTop: SPACE.sm,
      borderTop: `1px solid ${F.border}`,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: TYPE.meta.xs,
        color: F.fgMuted,
        letterSpacing: TRACKING.micro,
        textTransform: 'uppercase',
      }}>Data</span>
      {datasets.slice(0, 4).map((dataset) => (
        <span key={`${dataset.dataset_id}-${dataset.team_ids.join(',')}`} style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.xs,
          color: F.fenway,
          background: F.fenwaySoft,
          border: `1px solid ${F.fenway}`,
          borderRadius: RADIUS.pill,
          padding: `2px ${SPACE.xs + 2}px`,
        }}>
          {dataset.dataset_id.replace(/^nba_/, '').replace(/_current$/, '').replaceAll('_', ' ')}
          {dataset.team_ids.length ? ` · ${dataset.team_ids.join('/')}` : ''}
        </span>
      ))}
      {errors.length > 0 && (
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.xs,
          color: F.amber,
          background: F.amberSoft,
          border: `1px solid ${F.amber}`,
          borderRadius: RADIUS.pill,
          padding: `2px ${SPACE.xs + 2}px`,
        }}>{errors.length} caveat{errors.length === 1 ? '' : 's'}</span>
      )}
    </div>
  );
}

export function extractDataAnalystTraces(toolCalls?: ToolCall[] | null): DataAnalystTrace[] {
  return (toolCalls ?? []).flatMap((toolCall) => (
    toolCall.data_analyst_trace ? [toolCall.data_analyst_trace] : []
  ));
}

function dedupeDatasets(traces: DataAnalystTrace[]) {
  const byKey = new Map<string, DataAnalystTrace['datasets'][number]>();
  for (const trace of traces) {
    for (const dataset of trace.datasets) {
      byKey.set(`${dataset.dataset_id}:${dataset.team_ids.join(',')}`, dataset);
    }
  }
  return [...byKey.values()];
}
