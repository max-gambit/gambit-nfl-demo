import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type {
  ListContextGraphPreferencesResponse,
  NbaCapSheet,
  NbaCapSheetMetric,
  NbaCapSheetPlayerRow,
  NbaCapSheetSection,
  NbaPlayerStatRow,
  NbaRosterEntry,
  NbaRosterTeam,
  GetCurrentNflTeamResponse,
  NflCapRow,
  NflPlayerMetricRow,
  NflRosterEntry,
} from '@shared/types';
import { getCurrentNflCapSheet } from '../api/nfl';
import { listContextGraphPreferences } from '../api/contextGraph';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { useUi } from '../store';
import { ContextGraphSettings } from '../settings/ContextGraphSettings';

type DatabaseView = 'context' | 'cap' | 'stats' | 'roster';

type FinancialSummaryModel = {
  payroll: number | null;
  salaryCap: number | null;
  luxuryTax: number | null;
  firstApron: number | null;
  secondApron: number | null;
  capStatus: string;
  capStatusNote: string;
  hardCap: string;
  hardCapNote: string;
};

const NBA_2025_26_THRESHOLDS = {
  salaryCap: 154_647_000,
  luxuryTax: 187_895_000,
  firstApron: 195_945_000,
  secondApron: 207_824_000,
};

const CAP_SHEET_PLAYER_COLUMN_WIDTH = 220;

type DetailLoadState =
  | { status: 'idle'; data: null; error: null }
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: GetCurrentNflTeamResponse; error: null }
  | { status: 'error'; data: null; error: string };

type ContextGraphTeamsLoadState =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: ListContextGraphPreferencesResponse; error: null }
  | { status: 'error'; data: null; error: string };

function useContextGraphTeams(): ContextGraphTeamsLoadState {
  const [state, setState] = useState<ContextGraphTeamsLoadState>({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    listContextGraphPreferences()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', data: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}

function useNflTeamDetail(teamId: string | null): DetailLoadState {
  const [state, setState] = useState<DetailLoadState>({ status: 'idle', data: null, error: null });

  useEffect(() => {
    if (!teamId) {
      setState({ status: 'idle', data: null, error: null });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    getCurrentNflCapSheet(teamId)
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', data: null, error: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, [teamId]);

  return state;
}

export function NbaRosterLeftPanel() {
  const graphTeams = useContextGraphTeams();
  const {
    databaseTeamId,
    setDatabaseTeamId,
  } = useUi();
  const summaryData = graphTeams.status === 'ready' ? graphTeams.data : null;
  const selectedTeamId = summaryData?.teams.find((team) => team.team_id === databaseTeamId)?.team_id
    ?? summaryData?.teams.find((team) => team.team_id === 'NYG')?.team_id
    ?? summaryData?.teams[0]?.team_id
    ?? null;

  if (graphTeams.status === 'loading') {
    return <LeftPanelShell><MutedBlock>Loading teams...</MutedBlock></LeftPanelShell>;
  }
  if (graphTeams.status === 'error') {
    return <LeftPanelShell><MutedBlock>{graphTeams.error}</MutedBlock></LeftPanelShell>;
  }

  const teams = summaryData?.teams ?? [];

  return (
    <LeftPanelShell>
      <div className="gd-scroll" style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: `${SPACE.md}px ${SPACE.md}px`,
      }}>
        {teams.map((team, index) => {
          const active = selectedTeamId === team.team_id;
          const isLast = index === teams.length - 1;
          const freshness = team.validation.status === 'pass' ? 'fresh' : 'stale';
          return (
            <button
              key={team.team_id}
              onClick={() => {
                setDatabaseTeamId(team.team_id);
              }}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '38px 1fr auto',
                alignItems: 'center',
                gap: SPACE.sm,
                minHeight: 48,
                padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
                marginBottom: 0,
                background: active ? F.surface : 'transparent',
                border: `1px solid ${active ? F.fenway : 'transparent'}`,
                borderBottom: active || isLast ? `1px solid ${active ? F.fenway : 'transparent'}` : `1px solid ${F.border}`,
                borderRadius: active ? RADIUS.md : 0,
                cursor: 'pointer',
                textAlign: 'left',
                boxShadow: active ? F.shadowSoft : 'none',
              }}
            >
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, fontWeight: 700,
                color: active ? F.fenway : F.fg,
                letterSpacing: TRACKING.caps,
              }}>{team.team_id}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: active ? 600 : 500,
                  color: F.ink,
                }}>{team.name}</span>
              </span>
              <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <FreshnessDot status={freshness} />
              </span>
            </button>
          );
        })}
      </div>
    </LeftPanelShell>
  );
}

export function NbaRosterDatabase() {
  const graphTeams = useContextGraphTeams();
  const {
    databaseTeamId, databaseCapRowId, databaseStatKey, databasePlayerId,
    setDatabaseTeamId, setDatabaseCapRowId, setDatabasePlayerId, setDatabaseStatKey,
  } = useUi();
  const [view, setView] = useState<DatabaseView>('context');

  const teams = graphTeams.status === 'ready' ? graphTeams.data.teams : [];
  const selectedSummary = useMemo(
    () => teams.find((team) => team.team_id === databaseTeamId)
      ?? teams.find((team) => team.team_id === 'NYG')
      ?? teams[0]
      ?? null,
    [teams, databaseTeamId],
  );
  const detail = useNflTeamDetail(selectedSummary?.team_id ?? null);

  useEffect(() => {
    if (selectedSummary && selectedSummary.team_id !== databaseTeamId) {
      setDatabaseTeamId(selectedSummary.team_id);
    }
  }, [selectedSummary, databaseTeamId, setDatabaseTeamId]);

  useEffect(() => {
    setView('context');
  }, [databaseTeamId]);

  const nflDetail = detail.status === 'ready' ? detail.data : null;
  const snapshot = detail.status === 'ready' ? detail.data.snapshot : null;
  const selectedRow = nflDetail
    ? selectedNflCapRow(nflDetail.cap_rows, databaseCapRowId, databasePlayerId)
    : null;
  const selectedStats = nflDetail
    ? selectedNflMetricRow(nflDetail.player_metrics, databaseStatKey, selectedRow, databasePlayerId)
    : null;

  useEffect(() => {
    const firstRow = detail.status === 'ready' ? firstPlayerCapRow(detail.data.cap_rows) : null;
    if (!databaseCapRowId && !databaseStatKey && databasePlayerId === null && firstRow) {
      setDatabaseCapRowId(nflCapRowId(firstRow));
      setDatabasePlayerId(null);
    }
  }, [detail, databaseCapRowId, databaseStatKey, databasePlayerId, setDatabaseCapRowId, setDatabasePlayerId]);

  if (graphTeams.status === 'loading') {
    return <MainShell><EmptyState>Loading NFL Intel database...</EmptyState></MainShell>;
  }
  if (graphTeams.status === 'error') {
    return <MainShell><EmptyState>{graphTeams.error}</EmptyState></MainShell>;
  }
  if (!selectedSummary) {
    return <MainShell><EmptyState>No NFL Intel snapshot has been seeded yet.</EmptyState></MainShell>;
  }
  return (
    <MainShell>
      <div style={{
        padding: `${SPACE.lg}px ${SPACE.xl}px ${SPACE.md}px`,
        borderBottom: `1px solid ${F.border}`,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: SPACE.lg,
        flexWrap: 'wrap',
      }}>
        <div>
          <Kicker>{databaseViewKicker(view)}</Kicker>
          <div style={{
            marginTop: SPACE.xs,
            fontFamily: 'var(--font-display)', fontSize: TYPE.display.lg, fontWeight: 600,
            color: F.ink, lineHeight: 1.15, letterSpacing: TRACKING.body,
          }}>
            {selectedSummary.name}
          </div>
          <div style={{
            marginTop: SPACE.xs,
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.fgMuted,
          }}>
            {selectedSummary.conference} · {selectedSummary.division} · {selectedSummary.roster_summary.roster_count} Intel roster rows
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <SourceChip label="Snapshot" value={snapshot?.as_of_date ?? selectedSummary.as_of_date ?? 'None'} />
          <SourceChip label="Validation" value={selectedSummary.validation.status.toUpperCase()} />
          <SourceChip label="Overrides" value={selectedSummary.has_overrides ? 'On' : 'Off'} />
          <SourceChip label="Unknowns" value={String(selectedSummary.validation.error_count + selectedSummary.validation.warning_count)} />
        </div>
      </div>

      {nflDetail && (
        <NflFinancialSummaryStrip detail={nflDetail} />
      )}

      <div style={{
        padding: `${SPACE.sm}px ${SPACE.xl}px`,
        borderBottom: `1px solid ${F.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: SPACE.sm,
      }}>
        <SegmentButton active={view === 'context'} onClick={() => setView('context')}>Intel</SegmentButton>
        <SegmentButton active={view === 'cap'} onClick={() => setView('cap')}>Cap sheet</SegmentButton>
        <SegmentButton active={view === 'stats'} onClick={() => setView('stats')}>Player metrics</SegmentButton>
        <SegmentButton active={view === 'roster'} onClick={() => setView('roster')}>Offseason roster</SegmentButton>
      </div>

      <div className="gd-scroll" style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {view === 'context' ? (
          <ContextGraphSettings key={selectedSummary.team_id} teamId={selectedSummary.team_id} embedded />
        ) : nflDetail && view === 'cap' ? (
          <NflCapSheetView
            rows={nflDetail.cap_rows}
            selectedRowId={selectedRow ? nflCapRowId(selectedRow) : null}
            onSelectRow={(row) => {
              setDatabaseCapRowId(nflCapRowId(row));
              setDatabasePlayerId(null);
            }}
          />
        ) : nflDetail && view === 'stats' ? (
          <NflMetricsTable
            rows={nflDetail.player_metrics}
            selectedStatKey={selectedStats ? nflMetricKey(selectedStats) : databaseStatKey}
            onSelectRow={(row) => {
              setDatabaseStatKey(nflMetricKey(row));
              setDatabasePlayerId(null);
            }}
          />
        ) : nflDetail && view === 'roster' ? (
          <NflRosterTable
            rows={nflDetail.roster_entries}
            onSelectEntry={(entry) => {
              const capMatch = nflDetail.cap_rows.find((row) => row.player_id === entry.player_id) ?? null;
              if (capMatch) {
                setDatabaseCapRowId(nflCapRowId(capMatch));
                setDatabaseStatKey(null);
              } else {
                setDatabaseCapRowId(null);
                setDatabaseStatKey(entry.player_id);
              }
            }}
          />
        ) : (
          <MilestoneTwoPlaceholder view={view} teamName={selectedSummary.name} />
        )}
      </div>

      {nflDetail && view !== 'context' && (
        <div style={{
          padding: `${SPACE.sm}px ${SPACE.xl}px`,
          borderTop: `1px solid ${F.border}`,
          fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm,
          color: F.fgMuted, lineHeight: 1.45,
        }}>
          {nflDetail.source_refs.slice(0, 3).map((source, index) => (
            <span key={`${source.id}-${index}`}>
              {index > 0 ? ' · ' : null}
              {source.url.startsWith('http') ? (
                <a href={source.url} target="_blank" rel="noreferrer" style={{ color: F.fenway, textDecoration: 'none', fontWeight: 600 }}>
                  {source.name}
                </a>
              ) : (
                <span>{source.name}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </MainShell>
  );
}

function databaseViewKicker(view: DatabaseView): string {
  if (view === 'context') return 'Database / Intel';
  if (view === 'stats') return 'Database / player metrics';
  if (view === 'roster') return 'Database / offseason roster';
  return 'Database / cap sheet';
}

function MilestoneTwoPlaceholder({ view, teamName }: { view: DatabaseView; teamName: string }) {
  const label = view === 'cap'
    ? 'NFL cap sheets'
    : view === 'stats'
      ? 'NFL player metrics'
      : 'NFL offseason roster';
  return (
    <EmptyState>
      {label} for {teamName} land in Milestone 2. The current Database slice is intentionally limited to NFL Intel.
    </EmptyState>
  );
}

function NflCapSheetView({
  rows,
  selectedRowId,
  onSelectRow,
}: {
  rows: NflCapRow[];
  selectedRowId: string | null;
  onSelectRow: (row: NflCapRow) => void;
}) {
  const playerRows = rows.filter((row) => row.player_id);
  const postureRows = rows.filter((row) => !row.player_id);
  return (
    <div>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        color: F.ink,
        minWidth: 1180,
      }}>
        <thead>
          <tr>
            {['Player', 'Pos', 'Cap 2026', 'Cash 2026', 'Total left', 'Years', 'Guarantees', 'Dead cut', 'Cut room', 'Restructure', 'Tag', 'Lever', 'Source'].map((head) => (
              <th key={head} style={{
                position: 'sticky', top: 0, zIndex: 1,
                padding: `${SPACE.sm}px ${SPACE.md}px`,
                background: F.paper,
                borderBottom: `1px solid ${F.borderStrong}`,
                fontFamily: 'var(--font-mono)',
                fontSize: TYPE.meta.sm,
                color: F.fgMuted,
                textAlign: ['Player', 'Lever', 'Source'].includes(head) ? 'left' : 'right',
                letterSpacing: TRACKING.micro,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                width: head === 'Player' ? CAP_SHEET_PLAYER_COLUMN_WIDTH : undefined,
                minWidth: head === 'Player' ? CAP_SHEET_PLAYER_COLUMN_WIDTH : undefined,
              }}>{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {playerRows.map((row) => {
            const selected = nflCapRowId(row) === selectedRowId;
            return (
              <tr
                key={nflCapRowId(row)}
                onClick={() => onSelectRow(row)}
                style={{ background: selected ? F.fenwaySoft : 'transparent', cursor: 'pointer' }}
              >
                <td style={capSheetPlayerCellStyle()}>
                  <span style={{ display: 'block' }}>{row.player_name}</span>
                  <SmallStatus>{formatMetricValue(row.contract_lever)}</SmallStatus>
                </td>
                <td style={cellStyle('right')}>{row.position ?? '-'}</td>
                <td style={cellStyle('right', Boolean(row.cap_number_2026))}>{formatMoney(row.cap_number_2026)}</td>
                <td style={cellStyle('right')}>{formatMoney(row.cash_due_2026)}</td>
                <td style={cellStyle('right')}>{formatMoney(row.total_value_remaining)}</td>
                <td style={cellStyle('right')}>{row.years_remaining ?? '-'}</td>
                <td style={cellStyle('right')}>{formatMoney(row.guaranteed_remaining)}</td>
                <td style={cellStyle('right')}>{formatMoney(row.dead_money_if_cut_2026)}</td>
                <td style={cellStyle('right', (row.cut_savings_2026 ?? 0) > 0)}>{formatMoney(row.cut_savings_2026)}</td>
                <td style={cellStyle('right', (row.restructure_savings_estimate_2026 ?? 0) > 0)}>{formatMoney(row.restructure_savings_estimate_2026)}</td>
                <td style={cellStyle('right')}>{row.tag_eligible_2027 ? '2027' : '-'}</td>
                <td style={cellStyle('left')}>{formatMetricValue(row.contract_lever)}</td>
                <td style={cellStyle('left')}>
                  {row.source_url?.startsWith('http') ? (
                    <a href={row.source_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} style={{ color: F.fenway, textDecoration: 'none', fontWeight: 600 }}>
                      {formatMetricValue(row.source_status)}
                    </a>
                  ) : formatMetricValue(row.source_status)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {postureRows.length > 0 && (
        <div style={{
          padding: `${SPACE.lg}px ${SPACE.xl}px ${SPACE.xl}px`,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: SPACE.md,
        }}>
          {postureRows.map((row) => (
            <section key={nflCapRowId(row)} style={{
              minWidth: 0,
              padding: SPACE.md,
              border: `1px solid ${F.border}`,
              borderRadius: RADIUS.md,
              background: F.surface,
            }}>
              <FinancialLabel>Team Cap Posture</FinancialLabel>
              <div style={{ marginTop: SPACE.xs, fontFamily: 'var(--font-sans)', fontSize: TYPE.body.lg, fontWeight: 750, color: F.ink }}>
                {formatCompactMoney(row.cap_number_2026)}
              </div>
              <div style={{ marginTop: SPACE.xs, color: F.fgMuted, fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, lineHeight: 1.4 }}>
                Estimated restructure room: {formatCompactMoney(row.restructure_savings_estimate_2026)}. Static demo cap posture; verify against live league cap sheets before external use.
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function NflMetricsTable({
  rows,
  selectedStatKey,
  onSelectRow,
}: {
  rows: NflPlayerMetricRow[];
  selectedStatKey: string | null;
  onSelectRow: (row: NflPlayerMetricRow) => void;
}) {
  return (
    <table style={{
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.sm,
      color: F.ink,
      minWidth: 900,
    }}>
      <thead>
        <tr>
          {['Player', 'Pos', 'Snaps', 'Games', 'Availability', 'Role', 'Tier', 'Metric note', 'Source'].map((head) => (
            <th key={head} style={{
              position: 'sticky', top: 0, zIndex: 1,
              padding: `${SPACE.sm}px ${SPACE.md}px`,
              background: F.paper,
              borderBottom: `1px solid ${F.borderStrong}`,
              fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.sm,
              color: F.fgMuted,
              textAlign: ['Player', 'Availability', 'Role', 'Tier', 'Metric note', 'Source'].includes(head) ? 'left' : 'right',
              letterSpacing: TRACKING.micro,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>{head}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const selected = selectedStatKey === nflMetricKey(row);
          return (
            <tr
              key={nflMetricKey(row)}
              onClick={() => onSelectRow(row)}
              style={{ background: selected ? F.fenwaySoft : 'transparent', cursor: 'pointer' }}
            >
              <td style={cellStyle('left', true)}>{row.player_name}</td>
              <td style={cellStyle('right')}>{row.position ?? '-'}</td>
              <td style={cellStyle('right', true)}>{formatNumber(row.snaps_2025, 0)}</td>
              <td style={cellStyle('right')}>{formatNumber(row.games_2025, 0)}</td>
              <td style={cellStyle('left')}>{formatMetricValue(row.availability_risk)}</td>
              <td style={cellStyle('left')}>{formatMetricValue(row.role)}</td>
              <td style={cellStyle('left')}>{formatMetricValue(row.value_tier)}</td>
              <td style={cellStyle('left')}>{row.metric_note}</td>
              <td style={cellStyle('left')}>
                {row.source_url?.startsWith('http') ? (
                  <a href={row.source_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} style={{ color: F.fenway, textDecoration: 'none', fontWeight: 600 }}>
                    Roster source
                  </a>
                ) : 'Static snapshot'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function NflRosterTable({
  rows,
  onSelectEntry,
}: {
  rows: NflRosterEntry[];
  onSelectEntry?: (entry: NflRosterEntry) => void;
}) {
  return (
    <table style={{
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.sm,
      color: F.ink,
      minWidth: 860,
    }}>
      <thead>
        <tr>
          {['Player', 'Pos', 'Age', 'Roster', 'Contract', 'Order', 'Source note', 'Source'].map((head) => (
            <th key={head} style={{
              position: 'sticky', top: 0, zIndex: 1,
              padding: `${SPACE.sm}px ${SPACE.md}px`,
              background: F.paper,
              borderBottom: `1px solid ${F.borderStrong}`,
              fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.sm,
              color: F.fgMuted,
              textAlign: ['Player', 'Roster', 'Contract', 'Source note', 'Source'].includes(head) ? 'left' : 'right',
              letterSpacing: TRACKING.micro,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>{head}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => (
          <tr key={entry.player_id} onClick={() => onSelectEntry?.(entry)} style={{ cursor: onSelectEntry ? 'pointer' : 'default' }}>
            <td style={cellStyle('left', true)}>{entry.player_name}</td>
            <td style={cellStyle('right')}>{entry.position ?? '-'}</td>
            <td style={cellStyle('right')}>{entry.age ?? '-'}</td>
            <td style={cellStyle('left')}>{formatMetricValue(entry.roster_status)}</td>
            <td style={cellStyle('left')}>{formatMetricValue(entry.contract_status)}</td>
            <td style={cellStyle('right')}>{entry.source_order}</td>
            <td style={cellStyle('left')}>{entry.source_note}</td>
            <td style={cellStyle('left')}>
              {entry.source_url?.startsWith('http') ? (
                <a href={entry.source_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} style={{ color: F.fenway, textDecoration: 'none', fontWeight: 600 }}>
                  Roster page
                </a>
              ) : 'Static snapshot'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CapSheetView({
  playerRows,
  sections,
  selectedRowId,
  onSelectRow,
}: {
  playerRows: NbaCapSheetPlayerRow[];
  sections: NbaCapSheetSection[];
  selectedRowId: string | null;
  onSelectRow: (row: NbaCapSheetPlayerRow) => void;
}) {
  const seasons = Array.from(new Set(playerRows.flatMap((row) => row.salary_cells.map((cell) => cell.season)))).sort();
  return (
    <div>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        color: F.ink,
        minWidth: capSheetTableMinWidth(seasons.length),
      }}>
        <thead>
          <tr>
            {['Player', 'Pos', ...seasons, 'Total', 'FA', 'Bird', 'Restrictions', 'Source'].map((head) => (
              <th key={head} style={{
                position: 'sticky', top: 0, zIndex: 1,
                padding: `${SPACE.sm}px ${SPACE.md}px`,
                background: F.paper,
                borderBottom: `1px solid ${F.borderStrong}`,
                fontFamily: 'var(--font-mono)',
                fontSize: TYPE.meta.sm,
                color: F.fgMuted,
                textAlign: head === 'Player' || head === 'Restrictions' || head === 'Source' ? 'left' : 'right',
                letterSpacing: TRACKING.micro,
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                width: head === 'Player' ? CAP_SHEET_PLAYER_COLUMN_WIDTH : undefined,
                minWidth: head === 'Player' ? CAP_SHEET_PLAYER_COLUMN_WIDTH : undefined,
              }}>{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {playerRows.map((row) => {
            const selected = row.id === selectedRowId;
            const cellsBySeason = new Map(row.salary_cells.map((cell) => [cell.season, cell]));
            return (
              <tr
                key={row.id}
                onClick={() => onSelectRow(row)}
                style={{ background: selected ? F.fenwaySoft : 'transparent', cursor: 'pointer' }}
              >
                <td style={capSheetPlayerCellStyle()}>
                  <span style={{ display: 'block' }}>{row.player_name}</span>
                  {row.source_status !== 'captured' && <SmallStatus>Source needed</SmallStatus>}
                </td>
                <td style={cellStyle('right')}>{row.position ?? '—'}</td>
                {seasons.map((season) => (
                  <td key={season} style={cellStyle('right')}>
                    {formatSalaryCell(cellsBySeason.get(season))}
                  </td>
                ))}
                <td style={cellStyle('right', Boolean(row.total_amount))}>{formatMoney(row.total_amount)}</td>
                <td style={cellStyle('right')}>{row.fa_status ?? '—'}</td>
                <td style={cellStyle('right')}>{row.bird_rights ?? '—'}</td>
                <td style={cellStyle('left')}>{row.restrictions.length ? row.restrictions.join('; ') : '—'}</td>
                <td style={cellStyle('left')}>
                  {row.source_url && row.source_url.startsWith('http') ? (
                    <a href={row.source_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} style={{ color: F.fenway, textDecoration: 'none', fontWeight: 600 }}>
                      {row.source_status === 'captured' ? 'Captured' : 'Review'}
                    </a>
                  ) : row.source_status === 'captured' ? 'Captured' : 'Source needed'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{
        padding: `${SPACE.lg}px ${SPACE.xl}px ${SPACE.xl}px`,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: SPACE.md,
      }}>
        {sections.map((section) => <CapSection key={section.key} section={section} />)}
      </div>
    </div>
  );
}

function StatsTable({
  rows,
  selectedStatKey,
  onSelectRow,
}: {
  rows: NbaPlayerStatRow[];
  selectedStatKey: string | null;
  onSelectRow: (row: NbaPlayerStatRow) => void;
}) {
  return (
    <table style={{
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.sm,
      color: F.ink,
      minWidth: 1160,
    }}>
      <thead>
        <tr>
          {['Player', 'Pos', 'Age', 'GP', 'MIN', 'PTS', 'REB', 'AST', 'TS%', 'eFG%', 'USG%', 'ORtg', 'DRtg', 'Net', 'PIE', 'DWS', 'Match'].map((head) => (
            <th key={head} style={{
              position: 'sticky', top: 0, zIndex: 1,
              padding: `${SPACE.sm}px ${SPACE.md}px`,
              background: F.paper,
              borderBottom: `1px solid ${F.borderStrong}`,
              fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.sm,
              color: F.fgMuted,
              textAlign: head === 'Player' || head === 'Match' ? 'left' : 'right',
              letterSpacing: TRACKING.micro,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}>{head}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const selected = selectedStatKey === statKey(row);
          return (
            <tr
              key={statKey(row)}
              onClick={() => onSelectRow(row)}
              style={{ background: selected ? F.fenwaySoft : 'transparent', cursor: 'pointer' }}
            >
              <td style={cellStyle('left', true)}>{row.player_name}</td>
              <td style={cellStyle('right')}>{row.position ?? '—'}</td>
              <td style={cellStyle('right')}>{row.age}</td>
              <td style={cellStyle('right')}>{row.games_played}</td>
              <td style={cellStyle('right')}>{row.minutes.toLocaleString()}</td>
              <td style={cellStyle('right', true)}>{formatNumber(row.points_per_game, 1)}</td>
              <td style={cellStyle('right')}>{formatNumber(row.rebounds_per_game, 1)}</td>
              <td style={cellStyle('right')}>{formatNumber(row.assists_per_game, 1)}</td>
              <td style={cellStyle('right')}>{formatUnitPct(row.true_shooting_pct)}</td>
              <td style={cellStyle('right')}>{formatUnitPct(row.effective_fg_pct)}</td>
              <td style={cellStyle('right')}>{formatUnitPct(row.usage_pct)}</td>
              <td style={cellStyle('right')}>{formatNumber(row.offensive_rating, 1)}</td>
              <td style={cellStyle('right')}>{formatNumber(row.defensive_rating, 1)}</td>
              <td style={cellStyle('right', row.net_rating > 0)}>{formatSigned(row.net_rating)}</td>
              <td style={cellStyle('right')}>{formatUnitPct(row.player_impact_estimate)}</td>
              <td style={cellStyle('right')}>{formatNumber(row.defensive_win_shares, 2)}</td>
              <td style={cellStyle('left')}>
                {row.match_status === 'roster-matched' ? 'Roster linked' : 'Stats only'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CapSection({ section }: { section: NbaCapSheetSection }) {
  return (
    <section style={{
      minWidth: 0,
      border: `1px solid ${section.source_status === 'source-needed' ? F.borderStrong : F.border}`,
      borderRadius: RADIUS.md,
      background: F.surface,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: `${SPACE.sm}px ${SPACE.md}px`,
        borderBottom: `1px solid ${F.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: SPACE.sm,
      }}>
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.sm,
          fontWeight: 700,
          color: F.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>{section.title}</div>
        <StatusPill status={section.source_status} />
      </div>
      <div style={{ padding: SPACE.md }}>
        {section.notes[0] && (
          <div style={{
            marginBottom: SPACE.sm,
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.sm,
            color: F.fgMuted,
            lineHeight: 1.4,
          }}>{section.notes[0]}</div>
        )}
        <div style={{ display: 'grid', gap: SPACE.sm }}>
          {section.rows.slice(0, 5).map((row, index) => (
            <SectionRow key={`${section.key}-${index}`} row={row} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionRow({ row }: { row: Record<string, unknown> }) {
  const entries = Object.entries(row)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .slice(0, 4);
  return (
    <div style={{
      display: 'grid',
      gap: 3,
      paddingBottom: SPACE.sm,
      borderBottom: `1px solid ${F.border}`,
    }}>
      {entries.map(([key, value]) => (
        <div key={key} style={{
          display: 'grid',
          gridTemplateColumns: '92px 1fr',
          gap: SPACE.sm,
          alignItems: 'baseline',
          minWidth: 0,
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: TYPE.meta.sm,
            color: F.fgMuted,
            textTransform: 'uppercase',
            overflowWrap: 'anywhere',
          }}>{labelize(key)}</span>
          <span style={{
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.sm,
            color: F.ink,
            lineHeight: 1.35,
            overflowWrap: 'anywhere',
          }}>{formatUnknown(value)}</span>
        </div>
      ))}
    </div>
  );
}

function RosterTable({
  team,
  onSelectEntry,
}: {
  team: NbaRosterTeam;
  onSelectEntry?: (entry: NbaRosterEntry) => void;
}) {
  return (
    <table style={{
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.sm,
      color: F.ink,
      minWidth: 820,
    }}>
      <thead>
        <tr>
          {['#', 'Player', 'Pos', 'Ht', 'Wt', 'Last attended', 'Country', 'NBA ID'].map((head) => (
            <th key={head} style={{
              position: 'sticky', top: 0, zIndex: 1,
              padding: `${SPACE.sm}px ${SPACE.md}px`,
              background: F.paper,
              borderBottom: `1px solid ${F.borderStrong}`,
              fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.sm,
              color: F.fgMuted,
              textAlign: head === 'Player' || head === 'Last attended' || head === 'Country' ? 'left' : 'right',
              letterSpacing: TRACKING.micro,
              textTransform: 'uppercase',
            }}>{head}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {team.players.map((entry) => (
          <RosterRow key={entry.nba_player_id} entry={entry} onSelectEntry={onSelectEntry} />
        ))}
      </tbody>
    </table>
  );
}

function RosterRow({ entry, onSelectEntry }: { entry: NbaRosterEntry; onSelectEntry?: (entry: NbaRosterEntry) => void }) {
  return (
    <tr onClick={() => onSelectEntry?.(entry)} style={{ cursor: onSelectEntry ? 'pointer' : 'default' }}>
      <td style={cellStyle('right')}>{entry.jersey_number ?? '—'}</td>
      <td style={cellStyle('left', true)}>{entry.player.full_name}</td>
      <td style={cellStyle('right')}>{entry.position ?? '—'}</td>
      <td style={cellStyle('right')}>{entry.height ?? '—'}</td>
      <td style={cellStyle('right')}>{entry.weight_lbs ?? '—'}</td>
      <td style={cellStyle('left')}>{entry.last_attended ?? '—'}</td>
      <td style={cellStyle('left')}>{entry.country ?? '—'}</td>
      <td style={cellStyle('right')}>{entry.stats ? `${entry.nba_player_id} · stats` : entry.nba_player_id}</td>
    </tr>
  );
}

function MainShell({ children }: { children: ReactNode }) {
  return (
    <section style={{
      height: '100%',
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: F.paper,
    }}>
      {children}
    </section>
  );
}

function LeftPanelShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: F.paper }}>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  status = 'captured',
}: {
  label: string;
  value: string | number;
  status?: NbaCapSheetMetric['source_status'];
}) {
  const displayValue = typeof value === 'string' ? formatMetricValue(value) : value;
  return (
    <div style={{
      minWidth: 0,
      padding: `${SPACE.sm}px ${SPACE.md}px`,
      background: F.surface,
      border: `1px solid ${status === 'source-needed' ? F.borderStrong : F.border}`,
      borderRadius: RADIUS.md,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: SPACE.xs,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.xs,
          color: F.fgMuted,
          letterSpacing: TRACKING.micro,
          textTransform: 'uppercase',
          fontWeight: 700,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>{label}</div>
        {status !== 'captured' && <StatusDot status={status} />}
      </div>
      <div style={{
        marginTop: 2,
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.md,
        color: F.ink,
        fontWeight: 600,
        lineHeight: 1.2,
        overflowWrap: 'anywhere',
      }}>{displayValue}</div>
    </div>
  );
}

function FinancialSummaryStrip({ sheet }: { sheet: NbaCapSheet }) {
  const summary = databaseFinancialSummary(sheet);
  const secondApronDelta = summary.payroll != null && summary.secondApron != null
    ? summary.secondApron - summary.payroll
    : null;
  const runwayRows = [
    deltaRow('Salary cap', summary.payroll, summary.salaryCap),
    deltaRow('Tax line', summary.payroll, summary.luxuryTax),
    deltaRow('First apron', summary.payroll, summary.firstApron),
    secondApronDelta == null
      ? { label: 'Second apron', value: 'Needed', caption: 'threshold missing', tone: F.fgMuted }
      : {
          label: 'Second apron',
          value: formatCompactMoney(Math.abs(secondApronDelta)),
          caption: secondApronDelta >= 0 ? 'room' : 'over',
          tone: secondApronDelta >= 0 ? F.fenway : F.red,
        },
  ];
  const secondApronHeadline = secondApronDelta == null
    ? 'Second apron needed'
    : `${formatCompactMoney(Math.abs(secondApronDelta))} ${secondApronDelta >= 0 ? 'below' : 'over'} second apron`;
  const secondApronSubhead = summary.secondApron == null
    ? 'Second-apron threshold is missing.'
    : `Hard-cap line: ${formatCompactMoney(summary.secondApron)}.`;

  return (
    <div data-testid="database-financial-summary" style={{
      padding: `${SPACE.md}px ${SPACE.xl}px ${SPACE.lg}px`,
      borderBottom: `1px solid ${F.border}`,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: SPACE.sm,
      alignItems: 'stretch',
    }}>
      <FinancialPanel>
        <FinancialHeader label="Payroll" badge={summary.capStatus} />
        <FinancialHero value={formatCompactMoney(summary.payroll)} subhead={summary.capStatusNote} />
        <FinancialDetailGrid>
          <FinancialGridItem label="Hard cap" value={summary.hardCap} />
          <FinancialGridItem label="Trigger" value={summary.hardCapNote} />
        </FinancialDetailGrid>
      </FinancialPanel>

      <FinancialPanel>
        <FinancialHeader label="Apron runway" badge="Second apron" />
        <FinancialHero
          value={secondApronHeadline}
          subhead={secondApronSubhead}
          tone={secondApronDelta != null && secondApronDelta < 0 ? F.red : F.ink}
        />
        <FinancialDetailGrid>
          {runwayRows.map((row) => (
            <FinancialGridItem key={row.label} {...row} />
          ))}
        </FinancialDetailGrid>
      </FinancialPanel>

      <FinancialPanel>
        <FinancialHeader label="Thresholds" badge="League rules" />
        <FinancialHero value="2025-26 season" subhead="NBA cap, tax, and apron lines used for this view." />
        <FinancialDetailGrid>
          <FinancialGridItem label="Salary cap" value={formatCompactMoney(summary.salaryCap)} />
          <FinancialGridItem label="Luxury tax" value={formatCompactMoney(summary.luxuryTax)} />
          <FinancialGridItem label="First apron" value={formatCompactMoney(summary.firstApron)} />
          <FinancialGridItem label="Second apron" value={formatCompactMoney(summary.secondApron)} />
        </FinancialDetailGrid>
      </FinancialPanel>
    </div>
  );
}

function NflFinancialSummaryStrip({ detail }: { detail: GetCurrentNflTeamResponse }) {
  const posture = detail.cap_rows.find((row) => !row.player_id) ?? null;
  const playerRows = detail.cap_rows.filter((row) => row.player_id);
  const totalCap = sumNumbers(playerRows.map((row) => row.cap_number_2026));
  const restructureRoom = sumNumbers(playerRows.map((row) => row.restructure_savings_estimate_2026));
  const cutRoom = sumNumbers(playerRows.map((row) => row.cut_savings_2026));
  const tagCandidates = playerRows.filter((row) => row.tag_eligible_2027).length;
  const primaryLever = playerRows
    .slice()
    .sort((a, b) => (b.restructure_savings_estimate_2026 ?? 0) - (a.restructure_savings_estimate_2026 ?? 0))[0] ?? null;

  return (
    <div data-testid="database-financial-summary" style={{
      padding: `${SPACE.md}px ${SPACE.xl}px ${SPACE.lg}px`,
      borderBottom: `1px solid ${F.border}`,
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
      gap: SPACE.sm,
      alignItems: 'stretch',
    }}>
      <FinancialPanel>
        <FinancialHeader label="Team cap posture" badge={detail.snapshot.season} />
        <FinancialHero
          value={formatCompactMoney(posture?.cap_number_2026 ?? totalCap)}
          subhead={`${detail.team.abbreviation} static cap snapshot as of ${detail.snapshot.as_of_date}.`}
        />
        <FinancialDetailGrid>
          <FinancialGridItem label="Roster rows" value={String(detail.roster_entries.length)} />
          <FinancialGridItem label="Cap rows" value={String(playerRows.length)} />
        </FinancialDetailGrid>
      </FinancialPanel>

      <FinancialPanel>
        <FinancialHeader label="Flexible room" badge="Contracts" />
        <FinancialHero
          value={formatCompactMoney(restructureRoom)}
          subhead={primaryLever ? `Largest restructure lever: ${primaryLever.player_name}.` : 'No player restructure estimates in snapshot.'}
          tone={restructureRoom > 0 ? F.fenway : F.ink}
        />
        <FinancialDetailGrid>
          <FinancialGridItem label="Cut savings" value={formatCompactMoney(cutRoom)} />
          <FinancialGridItem label="Tag candidates" value={String(tagCandidates)} />
        </FinancialDetailGrid>
      </FinancialPanel>

      <FinancialPanel>
        <FinancialHeader label="Data trust" badge="Static" />
        <FinancialHero
          value={detail.snapshot.as_of_date}
          subhead="Internal demo fixture; source links and row statuses show what must be verified before external use."
        />
        <FinancialDetailGrid>
          <FinancialGridItem label="Sources" value={String(detail.source_refs.length)} />
          <FinancialGridItem label="Metrics" value={String(detail.player_metrics.length)} />
        </FinancialDetailGrid>
      </FinancialPanel>
    </div>
  );
}

function FinancialPanel({ children }: { children: ReactNode }) {
  return (
    <section style={{
      minWidth: 0,
      minHeight: 174,
      padding: `${SPACE.md}px ${SPACE.lg}px`,
      background: F.surface,
      border: `1px solid ${F.border}`,
      borderRadius: RADIUS.md,
      boxShadow: F.shadowSoft,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {children}
    </section>
  );
}

function FinancialHeader({ label, badge }: { label: string; badge?: string }) {
  return (
    <div style={{
      minHeight: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.md,
    }}>
      <FinancialLabel>{label}</FinancialLabel>
      {badge && <FinancialBadge>{badge}</FinancialBadge>}
    </div>
  );
}

function FinancialBadge({ children }: { children: ReactNode }) {
  return (
    <span style={{
      flexShrink: 0,
      maxWidth: '52%',
      padding: `3px ${SPACE.sm}px`,
      borderRadius: RADIUS.pill,
      background: F.fenwaySoft,
      color: F.fenway,
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.sm,
      fontWeight: 700,
      lineHeight: 1.2,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

function FinancialLabel({ children }: { children: ReactNode }) {
  return (
    <div style={financialCapsStyle}>
      {children}
    </div>
  );
}

const financialCapsStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  color: F.fgMuted,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
  fontWeight: 700,
  lineHeight: 1.2,
};

function FinancialMeta({ children }: { children: ReactNode }) {
  return (
    <span style={financialCapsStyle}>
      {children}
    </span>
  );
}

function FinancialHero({
  value,
  subhead,
  tone = F.ink,
}: {
  value: string;
  subhead: string;
  tone?: string;
}) {
  return (
    <div style={{
      minHeight: 64,
      paddingBottom: SPACE.sm,
    }}>
      <div style={{
        marginTop: SPACE.xs,
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.display.md,
        color: tone,
        fontWeight: 750,
        lineHeight: 1.1,
        overflowWrap: 'anywhere',
      }}>
        {value}
      </div>
      <div style={{
        marginTop: SPACE.sm,
        color: F.fgMuted,
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        lineHeight: 1.35,
        overflowWrap: 'anywhere',
      }}>
        {subhead}
      </div>
    </div>
  );
}

function FinancialDetailGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{
      paddingTop: SPACE.sm,
      borderTop: `1px solid ${F.border}`,
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      columnGap: SPACE.lg,
      rowGap: SPACE.sm,
    }}>
      {children}
    </div>
  );
}

function FinancialGridItem({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: string;
}) {
  return (
    <div style={{
      minWidth: 0,
    }}>
      <FinancialMeta>{label}</FinancialMeta>
      <div style={{
        marginTop: 2,
        display: 'flex',
        alignItems: 'baseline',
        gap: SPACE.xs,
        minWidth: 0,
      }}>
        <span style={{
          color: tone ?? F.ink,
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.lg,
          fontWeight: 750,
          lineHeight: 1.2,
          overflowWrap: caption ? undefined : 'anywhere',
          whiteSpace: caption ? 'nowrap' : 'normal',
        }}>{value}</span>
        {caption && (
          <span style={{
            color: F.fgMuted,
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.sm,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}>{caption}</span>
        )}
      </div>
    </div>
  );
}

function formatMetricValue(value: string): string {
  if (!value.includes('_')) return value;
  return labelize(value);
}

function databaseFinancialSummary(sheet: NbaCapSheet): FinancialSummaryModel {
  const metricsByKey = new Map(sheet.metrics.map((metric) => [metric.key, metric]));
  const thresholds = sheet.summary.season === '2025-26' ? NBA_2025_26_THRESHOLDS : null;
  const payrollMetric = metricsByKey.get('payroll');
  const capStatusMetric = metricsByKey.get('cap_status');
  const hardCapMetric = metricsByKey.get('hard_cap');
  const payroll = sheet.summary.payroll_amount ?? metricAmount(payrollMetric);
  const salaryCap = metricAmount(metricsByKey.get('salary_cap')) ?? thresholds?.salaryCap ?? null;
  const luxuryTax = metricAmount(metricsByKey.get('luxury_tax')) ?? thresholds?.luxuryTax ?? null;
  const firstApron = metricAmount(metricsByKey.get('first_apron')) ?? thresholds?.firstApron ?? null;
  const secondApron = metricAmount(metricsByKey.get('second_apron')) ?? thresholds?.secondApron ?? null;

  return {
    payroll,
    salaryCap,
    luxuryTax,
    firstApron,
    secondApron,
    capStatus: formatMetricValue(String(capStatusMetric?.value ?? sheet.summary.cap_status)),
    capStatusNote: capStatusCardNote(String(capStatusMetric?.value ?? sheet.summary.cap_status)),
    hardCap: hardCapCardValue(String(hardCapMetric?.value ?? sheet.summary.apron_status)),
    hardCapNote: hardCapCardNote(String(hardCapMetric?.note ?? hardCapMetric?.value ?? sheet.summary.apron_status)),
  };
}

function metricAmount(metric: NbaCapSheetMetric | undefined): number | null {
  return typeof metric?.amount === 'number' && Number.isFinite(metric.amount) ? metric.amount : null;
}

function formatCompactMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Source needed';
  const sign = value < 0 ? '-' : '';
  const millions = Math.abs(value) / 1_000_000;
  return `${sign}$${millions.toLocaleString('en-US', {
    minimumFractionDigits: millions < 10 ? 1 : 1,
    maximumFractionDigits: 1,
  })}M`;
}

function deltaRow(label: string, payroll: number | null, threshold: number | null) {
  if (payroll == null || threshold == null) {
    return { label, value: 'Needed', caption: 'source missing', tone: F.fgMuted };
  }
  const delta = payroll - threshold;
  return {
    label,
    value: formatSignedCompactMoney(delta),
    caption: delta >= 0 ? 'over' : 'below',
    tone: delta >= 0 ? F.amber : F.fenway,
  };
}

function formatSignedCompactMoney(value: number): string {
  if (!Number.isFinite(value)) return 'Source needed';
  if (value === 0) return '$0.0M';
  return `${value > 0 ? '+' : '-'}${formatCompactMoney(Math.abs(value))}`;
}

function capStatusCardNote(status: string): string {
  const normalized = status.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'between_aprons') return 'Above the first apron, below the second.';
  if (normalized === 'second_apron') return 'Second-apron restrictions apply.';
  if (normalized === 'above_first_apron') return 'Above the first apron.';
  if (normalized === 'below_first_apron') return 'Below the first apron.';
  if (normalized === 'below_cap') return 'Cap-room posture.';
  return 'Current cap posture.';
}

function hardCapCardValue(value: string): string {
  if (/^none$/i.test(value.trim())) return 'No hard cap';
  if (/second apron/i.test(value)) return '2nd apron hard cap';
  if (/first apron/i.test(value)) return '1st apron hard cap';
  if (/hard-capped:\s*yes/i.test(value)) return 'Hard-capped';
  return formatMetricValue(value);
}

function hardCapCardNote(value: string): string {
  if (/^none$/i.test(value.trim())) return 'No active hard-cap trigger.';
  if (/horford/i.test(value) && /(taxpayer mid-level|tmle)/i.test(value)) return 'TMLE used on Al Horford.';
  if (/hard-capped:\s*yes/i.test(value)) return 'Transaction hard cap active.';
  if (!value || value === 'Source needed') return 'Hard-cap source needed.';
  return value;
}

function SourceChip({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: SPACE.xs,
      minHeight: 28,
      padding: `${SPACE.xs}px ${SPACE.sm}px`,
      border: `1px solid ${F.border}`,
      borderRadius: RADIUS.md,
      background: F.surface,
      fontFamily: 'var(--font-mono)',
      fontSize: TYPE.meta.sm,
      color: F.fgMuted,
      maxWidth: 240,
    }}>
      <span style={{ letterSpacing: TRACKING.micro, textTransform: 'uppercase', fontWeight: 700 }}>{label}</span>
      <span style={{ color: F.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  );
}

function SegmentButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        minHeight: 30,
        padding: `${SPACE.xs}px ${SPACE.md}px`,
        border: `1px solid ${active ? F.fenway : F.border}`,
        borderRadius: RADIUS.md,
        background: active ? F.fenwaySoft : F.surface,
        color: active ? F.fenway : F.ink,
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        fontWeight: 700,
      }}
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span style={{
      flexShrink: 0,
      padding: `2px ${SPACE.xs}px`,
      borderRadius: RADIUS.sm,
      border: `1px solid ${status === 'captured' ? F.border : F.borderStrong}`,
      background: status === 'captured' ? F.fenwaySoft : F.cream100,
      color: status === 'captured' ? F.fenway : F.fgMuted,
      fontFamily: 'var(--font-mono)',
      fontSize: TYPE.meta.xs,
      fontWeight: 700,
      letterSpacing: TRACKING.micro,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {status === 'captured' ? 'Captured' : 'Source needed'}
    </span>
  );
}

type MockFreshnessStatus = 'fresh' | 'stale' | 'out-of-date';

function mockFreshnessStatus(teamId: string): MockFreshnessStatus {
  const seed = teamId.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  if (seed % 7 === 0) return 'out-of-date';
  if (seed % 3 === 0) return 'stale';
  return 'fresh';
}

function FreshnessDot({ status }: { status: MockFreshnessStatus }) {
  const meta = freshnessMeta(status);
  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      style={{
        width: 7,
        height: 7,
        borderRadius: 999,
        background: meta.fill,
        border: `1px solid ${meta.stroke}`,
        opacity: meta.opacity,
        boxShadow: 'none',
        display: 'inline-block',
      }}
    />
  );
}

function freshnessMeta(status: MockFreshnessStatus): { label: string; fill: string; stroke: string; opacity: number } {
  if (status === 'fresh') return { label: 'Fresh content', fill: F.fenway, stroke: F.fenway, opacity: 0.46 };
  if (status === 'stale') return { label: 'Stale content', fill: F.surface, stroke: F.borderStrong, opacity: 1 };
  return { label: 'Out of date content', fill: F.fgFaint, stroke: F.fgFaint, opacity: 0.68 };
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      title={status === 'captured' ? 'Captured source' : 'Source needed'}
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: status === 'captured' ? F.fenway : F.amber,
        display: 'inline-block',
      }}
    />
  );
}

function SmallStatus({ children }: { children: ReactNode }) {
  return (
    <span style={{
      display: 'block',
      marginTop: 2,
      fontFamily: 'var(--font-mono)',
      fontSize: TYPE.meta.sm,
      color: F.fgMuted,
      textTransform: 'uppercase',
      letterSpacing: TRACKING.micro,
    }}>{children}</span>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: TYPE.meta.xs,
      color: F.fgMuted,
      fontWeight: 700,
      letterSpacing: TRACKING.micro,
      textTransform: 'uppercase',
    }}>
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: SPACE['3xl'],
      fontFamily: 'var(--font-sans)',
      color: F.fgMuted,
    }}>
      {children}
    </div>
  );
}

function MutedBlock({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: SPACE.md,
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.sm,
      color: F.fgMuted,
      lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

function cellStyle(align: 'left' | 'right', strong = false): CSSProperties {
  return {
    padding: `${SPACE.sm}px ${SPACE.md}px`,
    borderBottom: `1px solid ${F.border}`,
    textAlign: align,
    fontWeight: strong ? 600 : 500,
    color: strong ? F.ink : F.inkSoft,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: align === 'right' ? 'nowrap' : undefined,
    maxWidth: align === 'left' ? 260 : undefined,
    overflowWrap: align === 'left' ? 'anywhere' : undefined,
  };
}

function capSheetPlayerCellStyle(): CSSProperties {
  return {
    ...cellStyle('left', true),
    width: CAP_SHEET_PLAYER_COLUMN_WIDTH,
    minWidth: CAP_SHEET_PLAYER_COLUMN_WIDTH,
    maxWidth: CAP_SHEET_PLAYER_COLUMN_WIDTH,
    overflowWrap: 'normal',
    wordBreak: 'normal',
  };
}

function capSheetTableMinWidth(seasonCount: number): number {
  return CAP_SHEET_PLAYER_COLUMN_WIDTH
    + 72
    + (seasonCount * 118)
    + 112
    + 84
    + 92
    + 220
    + 140;
}

function firstPlayerCapRow(rows: NflCapRow[]): NflCapRow | null {
  return rows.find((row) => row.player_id) ?? rows[0] ?? null;
}

function selectedNflCapRow(
  rows: NflCapRow[],
  selectedRowId: string | null,
  selectedPlayerId: number | null,
): NflCapRow | null {
  if (selectedRowId) return rows.find((row) => nflCapRowId(row) === selectedRowId) ?? null;
  if (selectedPlayerId !== null) return null;
  return firstPlayerCapRow(rows);
}

function selectedNflMetricRow(
  rows: NflPlayerMetricRow[],
  selectedKey: string | null,
  capRow: NflCapRow | null,
  selectedPlayerId: number | null,
): NflPlayerMetricRow | null {
  if (selectedKey) return rows.find((row) => nflMetricKey(row) === selectedKey) ?? null;
  if (capRow?.player_id) return rows.find((row) => row.player_id === capRow.player_id) ?? null;
  if (selectedPlayerId !== null) return null;
  return rows[0] ?? null;
}

function nflCapRowId(row: NflCapRow): string {
  return `${row.team_id}:${row.player_id ?? 'team'}:${row.contract_lever}`;
}

function nflMetricKey(row: NflPlayerMetricRow): string {
  return `${row.team_id}:${row.player_id}`;
}

function sumNumbers(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => (
    typeof value === 'number' && Number.isFinite(value) ? total + value : total
  ), 0);
}

function selectedCapRow(
  rows: NbaCapSheetPlayerRow[],
  statRows: NbaPlayerStatRow[],
  selectedRowId: string | null,
  selectedKey: string | null,
  selectedPlayerId: number | null,
): NbaCapSheetPlayerRow | null {
  if (selectedRowId) return rows.find((row) => row.id === selectedRowId) ?? null;

  if (selectedKey) {
    const statRow = statRows.find((row) => statKey(row) === selectedKey) ?? null;
    if (statRow?.nba_player_id !== null && statRow?.nba_player_id !== undefined) {
      return rows.find((row) => row.nba_player_id === statRow.nba_player_id) ?? null;
    }
    return null;
  }

  if (selectedPlayerId !== null) {
    return rows.find((row) => row.nba_player_id === selectedPlayerId) ?? null;
  }

  return rows.find((row) => row.source_status === 'captured') ?? rows[0] ?? null;
}

function selectedStatRow(
  rows: NbaPlayerStatRow[],
  selectedKey: string | null,
  capRow: NbaCapSheetPlayerRow | null,
  selectedPlayerId: number | null,
): NbaPlayerStatRow | null {
  if (selectedKey) return rows.find((row) => statKey(row) === selectedKey) ?? null;
  if (capRow?.stats) return capRow.stats;
  if (selectedPlayerId !== null) return rows.find((row) => row.nba_player_id === selectedPlayerId) ?? null;
  return null;
}

function statKey(row: NbaPlayerStatRow): string {
  return `${row.team_id}:${row.player_name_normalized}`;
}

function formatSalaryCell(cell: NbaCapSheetPlayerRow['salary_cells'][number] | undefined): string {
  if (!cell) return '—';
  if (cell.source_status !== 'captured') return 'Source needed';
  const base = formatMoney(cell.amount);
  return cell.option_type ? `${base} ${cell.option_type.toUpperCase()}` : base;
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  if (typeof value !== 'number') return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatSigned(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return `${value > 0 ? '+' : ''}${formatNumber(value, 1)}`;
}

function formatUnitPct(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return `${formatNumber(value * 100, 1)}%`;
}

function formatMoney(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

function formatUnknown(value: unknown): string | number {
  if (Array.isArray(value)) return value.map(formatUnknown).join(', ');
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value == null) return '—';
  return JSON.stringify(value);
}

function labelize(value: string): string {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
