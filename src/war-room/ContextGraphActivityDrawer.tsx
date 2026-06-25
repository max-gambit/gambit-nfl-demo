import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { extractContextGraphTraces } from '../fenway/ContextGraphTrustStrip';
import type { BriefSource, ContextGraphTrace, ToolCall } from '@shared/types';
import type React from 'react';

interface Props {
  title?: string;
  mode?: 'live' | 'persisted';
  toolCalls?: ToolCall[] | null;
  sources?: BriefSource[];
}

export function ContextGraphActivityDrawer({
  title = 'AI lookup activity',
  mode = 'persisted',
  toolCalls,
  sources = [],
}: Props) {
  const traces = [
    ...extractContextGraphTraces(toolCalls),
    ...tracesFromSources(sources),
  ];
  const teams = dedupeTeams(traces);
  const errors = traces.flatMap((trace) => trace.errors);
  const qaTeams = teams.filter(hasQaFindings);

  if (teams.length === 0 && errors.length === 0) {
    return (
      <div style={drawerStyle}>
        <div style={drawerHeaderStyle}>
          <span>{title}</span>
          <Badge>{mode === 'live' ? 'listening' : 'idle'}</Badge>
        </div>
        <div style={emptyStyle}>No Intel lookup has been recorded for the current brief yet.</div>
      </div>
    );
  }

  return (
    <div style={drawerStyle}>
      <div style={drawerHeaderStyle}>
        <span>{title}</span>
        <Badge>{mode === 'live' ? 'live' : 'persisted'}</Badge>
      </div>
      {teams.length > 0 && (
        <div style={{
          ...qaSummaryStyle,
          borderColor: errors.length > 0 ? F.red : qaTeams.length > 0 ? F.amber : F.fenway,
          background: errors.length > 0 ? F.redSoft : qaTeams.length > 0 ? F.amberSoft : F.fenwaySoft,
          color: errors.length > 0 ? F.red : qaTeams.length > 0 ? F.amber : F.fenway,
        }}>
          {errors.length > 0
            ? `${errors.length} context lookup ${errors.length === 1 ? 'error' : 'errors'}`
            : qaTeams.length > 0
              ? `Lookup returned ${teams.length} team${teams.length === 1 ? '' : 's'} with ${qaTeams.length} source QA caveat${qaTeams.length === 1 ? '' : 's'}`
              : `Lookup returned ${teams.length} team${teams.length === 1 ? '' : 's'} with source QA clear`}
        </div>
      )}
      <div style={{ display: 'grid', gap: SPACE.xs }}>
        {teams.map((team) => (
          <div key={team.team_id} style={lookupRowStyle(team)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm }}>
              <span style={teamPillStyle}>{team.team_id}</span>
              <span style={teamNameStyle}>{team.name}</span>
            </div>
            <div style={metaWrapStyle}>
              <span style={metaTokenStyle(team)}>{sourceQaLabel(team)}</span>
              <span style={metaTokenStyle()}>{team.has_overrides ? 'overrides yes' : 'overrides no'}</span>
              <span style={metaTokenStyle()}>as of {formatAsOfDate(team.source_as_of_date)}</span>
            </div>
          </div>
        ))}
        {errors.length > 0 && (
          <div style={{ ...lookupErrorRowStyle, borderColor: F.red, background: F.redSoft }}>
            <div style={{ color: F.red, fontWeight: 700 }}>{errors.length} lookup error{errors.length === 1 ? '' : 's'}</div>
            <div style={metaLineStyle}>{errors.map((error) => `${error.team_id}: ${error.error}`).join(' · ')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function tracesFromSources(sources: BriefSource[]): ContextGraphTrace[] {
  return sources.flatMap((source) => {
    if (source.kind !== 'CONTEXT_GRAPH' || !source.data) return [];
    const trace = (source.data as { context_graph_trace?: unknown }).context_graph_trace;
    return isContextGraphTrace(trace) ? [trace] : [];
  });
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

function sourceQaLabel(team: ContextGraphTrace['teams'][number]): string {
  if (team.validation_error_count > 0) return `source QA ${team.validation_error_count} issue${team.validation_error_count === 1 ? '' : 's'}`;
  if (team.validation_warning_count > 0) return `source QA ${team.validation_warning_count} warning${team.validation_warning_count === 1 ? '' : 's'}`;
  return 'source QA clear';
}

function formatAsOfDate(value: string | null | undefined): string {
  if (!value) return 'date unknown';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isContextGraphTrace(value: unknown): value is ContextGraphTrace {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { tool_name?: unknown }).tool_name === 'lookup_context_graph_teams' &&
    Array.isArray((value as { teams?: unknown }).teams) &&
    Array.isArray((value as { errors?: unknown }).errors)
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span style={{
      padding: `2px ${SPACE.xs + 2}px`,
      borderRadius: RADIUS.pill,
      background: F.fenwaySoft,
      color: F.fenway,
      border: `1px solid ${F.fenway}`,
      fontFamily: 'var(--font-mono)',
      fontSize: TYPE.meta.xs,
      letterSpacing: TRACKING.micro,
      textTransform: 'uppercase',
    }}>
      {children}
    </span>
  );
}

const drawerStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  boxShadow: F.shadowSoft,
  padding: SPACE.md,
};

const drawerHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: SPACE.sm,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 700,
  color: F.ink,
};

const lookupErrorRowStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.cream50,
  padding: SPACE.sm,
};

const lookupRowStyle = (team: ContextGraphTrace['teams'][number]): React.CSSProperties => {
  const hasFindings = hasQaFindings(team);
  return {
    ...lookupErrorRowStyle,
    borderColor: hasFindings ? F.borderStrong : F.border,
    background: hasFindings ? F.cream100 : F.cream50,
  };
};

const teamPillStyle: React.CSSProperties = {
  minWidth: 34,
  textAlign: 'center',
  padding: `2px ${SPACE.xs}px`,
  borderRadius: RADIUS.pill,
  background: F.ink,
  color: F.surface,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 700,
};

const teamNameStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.ink,
  fontWeight: 600,
};

const metaLineStyle: React.CSSProperties = {
  marginTop: SPACE.xs,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
};

const metaWrapStyle: React.CSSProperties = {
  marginTop: SPACE.xs,
  display: 'flex',
  flexWrap: 'wrap',
  gap: SPACE.xs,
};

const metaTokenStyle = (team?: ContextGraphTrace['teams'][number]): React.CSSProperties => {
  const hasFindings = team ? hasQaFindings(team) : false;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 18,
    padding: `1px ${SPACE.xs + 2}px`,
    borderRadius: RADIUS.sm,
    background: hasFindings ? F.amberSoft : F.surface,
    color: hasFindings ? F.amber : F.fgMuted,
    border: `1px solid ${hasFindings ? F.amber : F.border}`,
    fontFamily: 'var(--font-mono)',
    fontSize: TYPE.meta.sm,
    fontWeight: hasFindings ? 700 : 500,
    whiteSpace: 'nowrap',
  };
};

const qaSummaryStyle: React.CSSProperties = {
  marginBottom: SPACE.sm,
  padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 700,
  lineHeight: 1.4,
};

const emptyStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.fgMuted,
  lineHeight: 1.5,
};
