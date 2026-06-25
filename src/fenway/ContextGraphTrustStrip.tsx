import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import type { ContextGraphTrace, ToolCall } from '@shared/types';

interface Props {
  toolCalls?: ToolCall[] | null;
}

export function ContextGraphTrustStrip({ toolCalls }: Props) {
  const traces = extractContextGraphTraces(toolCalls);
  const teams = dedupeTeams(traces);
  const errors = traces.flatMap((trace) => trace.errors);
  if (teams.length === 0 && errors.length === 0) return null;
  const qaFindingCount = teams.filter(hasQaFindings).length;

  return (
    <div style={{
      marginTop: SPACE.md,
      paddingTop: SPACE.sm,
      borderTop: `1px dashed ${F.border}`,
      display: 'flex',
      flexWrap: 'wrap',
      gap: SPACE.xs + 2,
      alignItems: 'center',
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: TYPE.meta.sm,
        color: F.fgMuted,
        letterSpacing: TRACKING.caps,
        textTransform: 'uppercase',
        marginRight: SPACE.xs,
      }}>
        Intel
      </span>
      {errors.length === 0 && (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: `3px ${SPACE.sm}px`,
          borderRadius: RADIUS.pill,
          border: `1px solid ${qaFindingCount > 0 ? F.amber : F.fenway}`,
          background: qaFindingCount > 0 ? F.amberSoft : F.fenwaySoft,
          color: qaFindingCount > 0 ? F.amber : F.fenway,
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.sm,
          fontWeight: 700,
        }}>
          lookup ok{qaFindingCount > 0 ? ` · ${qaFindingCount} QA caveat${qaFindingCount === 1 ? '' : 's'}` : ''}
        </span>
      )}
      {teams.map((team) => (
        <span key={team.team_id} title={trustTitle(team)} style={teamChipStyle(team)}>
          {team.team_id}
          <span style={{ color: F.fgMuted, fontWeight: 500 }}>
            {compactQaLabel(team)}
          </span>
          {team.has_overrides && (
            <span style={{ color: F.fenway, fontWeight: 600 }}>override</span>
          )}
        </span>
      ))}
      {errors.length > 0 && (
        <span style={{
          padding: `3px ${SPACE.sm}px`,
          borderRadius: RADIUS.pill,
          background: F.redSoft,
          color: F.red,
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.sm,
          fontWeight: 600,
        }}>
          {errors.length} lookup {errors.length === 1 ? 'error' : 'errors'}
        </span>
      )}
    </div>
  );
}

export function extractContextGraphTraces(toolCalls?: ToolCall[] | null): ContextGraphTrace[] {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.flatMap((toolCall) => (
    toolCall.context_graph_trace ? [toolCall.context_graph_trace] : []
  ));
}

function dedupeTeams(traces: ContextGraphTrace[]) {
  const byId = new Map<string, ContextGraphTrace['teams'][number]>();
  for (const trace of traces) {
    for (const team of trace.teams) byId.set(team.team_id, team);
  }
  return [...byId.values()].sort((a, b) => a.team_id.localeCompare(b.team_id));
}

function hasQaFindings(team: ContextGraphTrace['teams'][number]): boolean {
  return team.validation_status !== 'pass' || team.validation_error_count > 0 || team.validation_warning_count > 0;
}

function compactQaLabel(team: ContextGraphTrace['teams'][number]): string {
  if (team.validation_error_count > 0) return `source QA ${team.validation_error_count}`;
  if (team.validation_warning_count > 0) return `source QA ${team.validation_warning_count} warn`;
  return 'source QA clear';
}

function teamChipStyle(team: ContextGraphTrace['teams'][number]) {
  const hasFindings = hasQaFindings(team);
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: SPACE.xs,
    padding: `3px ${SPACE.sm}px`,
    borderRadius: RADIUS.pill,
    border: `1px solid ${hasFindings ? F.amber : F.border}`,
    background: hasFindings ? F.amberSoft : F.cream50,
    color: F.inkSoft,
    fontFamily: 'var(--font-mono)',
    fontSize: TYPE.meta.sm,
    fontWeight: 600,
  };
}

function trustTitle(team: ContextGraphTrace['teams'][number]): string {
  return [
    `${team.team_id} · ${team.name}`,
    `Source QA: ${team.validation_status === 'pass' ? 'clear' : 'needs review'}`,
    `Validation errors: ${team.validation_error_count}`,
    `Validation warnings: ${team.validation_warning_count}`,
    `Overrides: ${team.has_overrides ? 'yes' : 'no'}`,
    `As of: ${team.source_as_of_date || 'unknown'}`,
    `Updated: ${team.source_last_updated || 'unknown'}`,
  ].join('\n');
}
