import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { getCurrentNbaCapSheet } from '../api/nba';
import { classifyEvidenceSource, formatEvidenceFreshness } from './evidencePanelModel';
import type {
  BriefSource,
  GetCurrentNbaCapSheetResponse,
  NbaCapSheet,
  NbaCapSheetPlayerRow,
  NbaPlayerStatRow,
  NbaRosterEntry,
} from '@shared/types';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

interface Props {
  source: BriefSource;
  onBack: () => void;
}

type Primitive = string | number | boolean | null;
type Row = { k: string; v: Primitive };
type PlayerCandidate = {
  teamId: string;
  playerName: string | null;
  nbaPlayerId: number | null;
  sourceMatchedBy: 'structured-data' | 'title';
};
type PlayerProfile = {
  candidate: PlayerCandidate;
  capSheet: NbaCapSheet;
  capRow: NbaCapSheetPlayerRow | null;
  statRow: NbaPlayerStatRow | null;
  rosterEntry: NbaRosterEntry | null;
};
type PlayerProfileState =
  | { status: 'idle'; candidate: null; profile: null; error: null }
  | { status: 'loading'; candidate: PlayerCandidate; profile: null; error: null }
  | { status: 'ready'; candidate: PlayerCandidate; profile: PlayerProfile | null; error: null }
  | { status: 'error'; candidate: PlayerCandidate; profile: null; error: string };

const NBA_TEAM_IDS = new Set([
  'ATL', 'BKN', 'BOS', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
]);

export function SourceDetail({ source, onBack }: Props) {
  const data = isRecord(source.data) ? source.data : {};
  const directRows = rowsFromData(data);
  const nestedSections = nestedObjects(data);
  const candidate = useMemo(() => playerCandidateFromSource(source, data), [source, data]);
  const profileState = useSourcePlayerProfile(candidate);
  const evidence = useMemo(() => classifyEvidenceSource(source), [source]);
  const freshness = formatEvidenceFreshness(source);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        padding: `${SPACE.md}px ${SPACE.md}px ${SPACE.sm + 2}px`,
        borderBottom: `1px solid ${F.border}`,
        display: 'flex', alignItems: 'center', gap: SPACE.sm, flexShrink: 0,
        background: F.paper,
      }}>
        <button onClick={onBack}
          style={{
            padding: `${SPACE.xs}px ${SPACE.sm}px`,
            background: 'transparent', border: `1px solid ${F.border}`,
            borderRadius: RADIUS.md, cursor: 'pointer',
            fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 500, color: F.fgMuted,
            display: 'flex', alignItems: 'center', gap: SPACE.xs + 1,
          }}>
          <span aria-hidden="true">←</span>
          Evidence Pack
        </button>
        <div style={{ flex: 1 }} />
        <Badge tone="primary">{evidence.title}</Badge>
        <Badge>{source.kind}</Badge>
      </div>

      <div className="gd-scroll" style={{
        flex: 1, overflowY: 'auto',
        padding: `${SPACE.md}px ${SPACE.md}px ${SPACE['2xl']}px`,
      }}>
        <div style={{ marginBottom: SPACE.lg }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: TYPE.meta.xs,
            color: F.fgMuted,
            fontWeight: 700,
            letterSpacing: TRACKING.micro,
            textTransform: 'uppercase',
            marginBottom: SPACE.xs,
          }}>Evidence check</div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: TYPE.display.md, fontWeight: 600,
            color: F.ink, lineHeight: 1.2, letterSpacing: TRACKING.body,
          }}>{evidence.title}</div>
          <div style={{
            marginTop: SPACE.xs,
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.md,
            color: F.inkSoft,
            lineHeight: 1.45,
          }}>{evidence.proof}</div>
          <div style={{
            marginTop: SPACE.xs,
            display: 'flex', gap: SPACE.sm, flexWrap: 'wrap',
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md,
            color: F.fgMuted, letterSpacing: TRACKING.caps,
          }}>
            {source.source && <span>{source.source}</span>}
            <span>REF [{source.ref_index}]</span>
            {freshness && <span>{freshness}</span>}
            {!freshness && source.updated_at && <span>{source.updated_at}</span>}
          </div>
          {source.title !== evidence.title && (
            <div style={{
              marginTop: SPACE.sm,
              padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
              background: F.cream50,
              border: `1px solid ${F.border}`,
              borderRadius: RADIUS.sm,
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
              color: F.fgMuted,
              lineHeight: 1.4,
            }}>
              Source record: <span style={{ color: F.inkSoft, fontWeight: 600 }}>{source.title}</span>
            </div>
          )}
        </div>

        <HydratedPlayerProfile state={profileState} />

        {directRows.length > 0 && (
          <Section title={source.kind === 'ANALYST_DATA' ? 'Evidence data' : 'Source data'}>
            <KvList rows={directRows} />
          </Section>
        )}

        {nestedSections.map((section) => (
          <Section key={section.title} title={section.title}>
            {section.rows.length > 0 ? <KvList rows={section.rows} /> : <JsonBlock value={section.value} />}
          </Section>
        ))}

        {directRows.length === 0 && nestedSections.length === 0 && (
          <div style={{
            padding: SPACE.lg,
            border: `1px solid ${F.border}`,
            borderRadius: RADIUS.md,
            background: F.surface,
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.sm,
            color: F.fgMuted,
            lineHeight: 1.5,
          }}>
            This source did not include structured detail data.
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: SPACE.lg }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
        color: F.fgMuted, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
        marginBottom: SPACE.sm,
      }}>{title}</div>
      {children}
    </section>
  );
}

function HydratedPlayerProfile({ state }: { state: PlayerProfileState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') {
    return (
      <Section title="Player profile">
        <div style={{
          padding: SPACE.md,
          border: `1px solid ${F.border}`,
          borderRadius: RADIUS.md,
          background: F.surface,
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.sm,
          color: F.fgMuted,
          lineHeight: 1.5,
        }}>
          Loading NBA database profile...
        </div>
      </Section>
    );
  }
  if (state.status === 'error') {
    return (
      <Section title="Player profile">
        <div style={{
          padding: SPACE.md,
          border: `1px solid ${F.border}`,
          borderRadius: RADIUS.md,
          background: F.surface,
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.sm,
          color: F.fgMuted,
          lineHeight: 1.5,
        }}>
          NBA database profile unavailable: {state.error}
        </div>
      </Section>
    );
  }
  if (!state.profile) {
    return (
      <Section title="Player profile">
        <div style={{
          padding: SPACE.md,
          border: `1px solid ${F.border}`,
          borderRadius: RADIUS.md,
          background: F.surface,
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.sm,
          color: F.fgMuted,
          lineHeight: 1.5,
        }}>
          No NBA database profile matched {state.candidate.playerName ?? 'this source'} on {state.candidate.teamId}.
        </div>
      </Section>
    );
  }
  return <PlayerProfileCard profile={state.profile} />;
}

function PlayerProfileCard({ profile }: { profile: PlayerProfile }) {
  const { capSheet, capRow, statRow, rosterEntry } = profile;
  const playerName = capRow?.player_name ?? statRow?.player_name ?? rosterEntry?.player.full_name ?? profile.candidate.playerName ?? 'Player';
  const team = capSheet.summary.team;
  const position = capRow?.position ?? statRow?.position ?? rosterEntry?.position ?? rosterEntry?.player.position ?? null;
  const age = capRow?.age ?? statRow?.age ?? null;
  const profileRows: Row[] = [
    { k: 'Team', v: `${team.abbreviation} · ${team.full_name}` },
    { k: 'Position', v: position ?? 'Source needed' },
    { k: 'Age', v: age ?? 'Source needed' },
    { k: 'NBA ID', v: capRow?.nba_player_id ?? statRow?.nba_player_id ?? rosterEntry?.nba_player_id ?? 'Source needed' },
    { k: 'Roster match', v: rosterEntry ? 'Current roster' : statRow?.match_status === 'stats-only' ? 'Stats-only season row' : 'Source needed' },
  ];

  const salaryRows: Row[] = [
    ...((capRow?.salary_cells ?? []).map((cell) => ({
      k: cell.season,
      v: cell.source_status === 'captured' ? salaryCellLabel(cell) : 'Source needed',
    }))),
    { k: 'Total', v: capRow?.total_amount != null ? formatMoney(capRow.total_amount) : 'Source needed' },
    { k: 'FA status', v: capRow?.fa_status ?? 'Source needed' },
    { k: 'FA year', v: capRow?.fa_year ?? 'Source needed' },
    { k: 'Bird rights', v: capRow?.bird_rights ?? 'Source needed' },
    { k: 'How acquired', v: capRow?.how_acquired ?? 'Source needed' },
    { k: 'Restrictions', v: capRow?.restrictions.length ? capRow.restrictions.join('; ') : 'None captured' },
  ];

  const rosterRows: Row[] = [
    { k: 'Jersey', v: rosterEntry?.jersey_number ?? 'Source needed' },
    { k: 'Height', v: rosterEntry?.height ?? rosterEntry?.player.height ?? 'Source needed' },
    { k: 'Weight', v: rosterEntry?.weight_lbs != null ? `${rosterEntry.weight_lbs} lbs` : 'Source needed' },
    { k: 'Last attended', v: rosterEntry?.last_attended ?? rosterEntry?.player.last_attended ?? 'Source needed' },
    { k: 'Country', v: rosterEntry?.country ?? rosterEntry?.player.country ?? 'Source needed' },
  ];

  return (
    <Section title="Player profile">
      <div style={{
        border: `1px solid ${F.borderStrong}`,
        borderRadius: RADIUS.md,
        background: F.surface,
        overflow: 'hidden',
        boxShadow: F.shadowSoft,
      }}>
        <div style={{
          padding: SPACE.md,
          borderBottom: `1px solid ${F.border}`,
          display: 'flex',
          gap: SPACE.md,
          alignItems: 'flex-start',
        }}>
          <div style={{
            width: 42,
            height: 42,
            flexShrink: 0,
            borderRadius: RADIUS.pill,
            background: F.cream100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.md,
            fontWeight: 700,
            color: F.ink,
            letterSpacing: TRACKING.body,
          }}>{initialsFor(playerName)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: TYPE.display.md,
              fontWeight: 600,
              color: F.ink,
              lineHeight: 1.15,
              letterSpacing: TRACKING.body,
            }}>{playerName}</div>
            <div style={{
              marginTop: 3,
              fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.sm,
              color: F.fgMuted,
              letterSpacing: TRACKING.caps,
              textTransform: 'uppercase',
            }}>
              {team.abbreviation} · {position ?? 'Position source needed'} · {statRow ? 'Stats captured' : 'Stats source needed'}
            </div>
          </div>
        </div>

        <div style={{ padding: SPACE.md, display: 'grid', gap: SPACE.md }}>
          <KvList rows={profileRows} />

          {statRow ? (
            <ProfileSubsection title="Advanced stats">
              <KvList rows={advancedStatRows(statRow)} />
            </ProfileSubsection>
          ) : (
            <ProfileSubsection title="Advanced stats">
              <MutedProfileText>No advanced-stats row matched this source.</MutedProfileText>
            </ProfileSubsection>
          )}

          <ProfileSubsection title="Contract and cap sheet">
            <KvList rows={salaryRows} />
          </ProfileSubsection>

          <ProfileSubsection title="Official roster">
            <KvList rows={rosterRows} />
            {(rosterEntry?.source_url ?? capRow?.source_url) && (
              <a
                href={(rosterEntry?.source_url ?? capRow?.source_url) ?? undefined}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-block',
                  marginTop: SPACE.sm,
                  fontFamily: 'var(--font-sans)',
                  fontSize: TYPE.body.sm,
                  color: F.fenway,
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                NBA source page
              </a>
            )}
          </ProfileSubsection>
        </div>
      </div>
    </Section>
  );
}

function ProfileSubsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: TYPE.meta.xs,
        fontWeight: 700,
        color: F.fgMuted,
        letterSpacing: TRACKING.micro,
        textTransform: 'uppercase',
        marginBottom: SPACE.sm,
      }}>{title}</div>
      {children}
    </div>
  );
}

function MutedProfileText({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: SPACE.md,
      border: `1px solid ${F.border}`,
      borderRadius: RADIUS.md,
      background: F.paper,
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.sm,
      color: F.fgMuted,
      lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

function KvList({ rows }: { rows: Row[] }) {
  return (
    <div style={{
      border: `1px solid ${F.border}`,
      borderRadius: RADIUS.md,
      overflow: 'hidden',
      background: F.surface,
    }}>
      {rows.map((row, index) => (
        <div key={`${row.k}-${index}`} style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(104px, 42%) 1fr',
          gap: SPACE.sm,
          padding: `${SPACE.sm}px ${SPACE.md}px`,
          borderBottom: index === rows.length - 1 ? 'none' : `1px solid ${F.border}`,
          alignItems: 'baseline',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
            letterSpacing: TRACKING.caps, textTransform: 'uppercase',
            overflowWrap: 'anywhere',
          }}>{labelForKey(row.k)}</div>
          <div style={{
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.ink,
            fontWeight: 500, lineHeight: 1.4, overflowWrap: 'anywhere',
          }}>{formatValue(row.v)}</div>
        </div>
      ))}
    </div>
  );
}

function Badge({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'primary' }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
      color: tone === 'primary' ? F.fenway : F.fgMuted,
      background: tone === 'primary' ? F.fenwaySoft : F.cream100,
      padding: `2px ${SPACE.sm}px`, borderRadius: RADIUS.sm,
      letterSpacing: TRACKING.micro, textTransform: 'uppercase',
    }}>{children}</span>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre style={{
      margin: 0,
      padding: SPACE.md,
      border: `1px solid ${F.border}`,
      borderRadius: RADIUS.md,
      background: F.surface,
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      fontFamily: 'var(--font-mono)',
      fontSize: TYPE.meta.md,
      color: F.inkSoft,
      lineHeight: 1.5,
    }}>{JSON.stringify(value, null, 2)}</pre>
  );
}

function rowsFromData(data: Record<string, unknown>): Row[] {
  const explicitRows = data.rows;
  if (Array.isArray(explicitRows)) {
    return explicitRows
      .filter(isRecord)
      .map((row) => ({ k: String(row.k ?? row.key ?? ''), v: primitiveValue(row.v ?? row.value) }))
      .filter((row) => row.k);
  }

  return Object.entries(data)
    .filter(([key, value]) => key !== 'rows' && isPrimitive(value))
    .map(([key, value]) => ({ k: key, v: primitiveValue(value) }));
}

function nestedObjects(data: Record<string, unknown>): { title: string; rows: Row[]; value: unknown }[] {
  return Object.entries(data)
    .filter(([key, value]) => key !== 'rows' && !isPrimitive(value))
    .map(([key, value]) => ({
      title: labelForKey(key),
      rows: isRecord(value) ? rowsFromData(value) : [],
      value,
    }));
}

function useSourcePlayerProfile(candidate: PlayerCandidate | null): PlayerProfileState {
  const [state, setState] = useState<PlayerProfileState>({ status: 'idle', candidate: null, profile: null, error: null });

  useEffect(() => {
    if (!candidate) {
      setState({ status: 'idle', candidate: null, profile: null, error: null });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading', candidate, profile: null, error: null });
    getCurrentNbaCapSheet(candidate.teamId)
      .then((response: GetCurrentNbaCapSheetResponse) => {
        if (cancelled) return;
        const profile = profileFromCapSheet(candidate, response.cap_sheet);
        setState({ status: 'ready', candidate, profile, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: 'error',
          candidate,
          profile: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => { cancelled = true; };
  }, [candidate]);

  return state;
}

function profileFromCapSheet(candidate: PlayerCandidate, capSheet: NbaCapSheet | null): PlayerProfile | null {
  if (!capSheet) return null;
  const normalizedName = candidate.playerName ? normalizeName(candidate.playerName) : null;
  const capRow = findCapRow(capSheet.player_rows, candidate.nbaPlayerId, normalizedName);
  const statRow = findStatRow(capSheet.player_stats, candidate.nbaPlayerId, normalizedName, capRow?.nba_player_id ?? null);
  const rosterEntry = findRosterEntry(capSheet.roster?.players ?? [], candidate.nbaPlayerId, normalizedName, capRow?.nba_player_id ?? statRow?.nba_player_id ?? null);

  if (!capRow && !statRow && !rosterEntry) return null;
  return { candidate, capSheet, capRow, statRow, rosterEntry };
}

function findCapRow(
  rows: NbaCapSheetPlayerRow[],
  playerId: number | null,
  normalizedName: string | null,
): NbaCapSheetPlayerRow | null {
  if (playerId !== null) {
    const byId = rows.find((row) => row.nba_player_id === playerId);
    if (byId) return byId;
  }
  if (!normalizedName) return null;
  return rows.find((row) => normalizeName(row.player_name) === normalizedName) ?? null;
}

function findStatRow(
  rows: NbaPlayerStatRow[],
  playerId: number | null,
  normalizedName: string | null,
  fallbackPlayerId: number | null,
): NbaPlayerStatRow | null {
  const id = playerId ?? fallbackPlayerId;
  if (id !== null) {
    const byId = rows.find((row) => row.nba_player_id === id);
    if (byId) return byId;
  }
  if (!normalizedName) return null;
  return rows.find((row) => row.player_name_normalized === normalizedName || normalizeName(row.player_name) === normalizedName) ?? null;
}

function findRosterEntry(
  rows: NbaRosterEntry[],
  playerId: number | null,
  normalizedName: string | null,
  fallbackPlayerId: number | null,
): NbaRosterEntry | null {
  const id = playerId ?? fallbackPlayerId;
  if (id !== null) {
    const byId = rows.find((row) => row.nba_player_id === id);
    if (byId) return byId;
  }
  if (!normalizedName) return null;
  return rows.find((row) => normalizeName(row.player.full_name) === normalizedName) ?? null;
}

function playerCandidateFromSource(source: BriefSource, data: Record<string, unknown>): PlayerCandidate | null {
  if (source.kind === 'ANALYST_DATA' && (isRecord(data.current_nba_evidence) || /^App data\s*[·-]|^Current NBA app data/i.test(source.title))) {
    return null;
  }
  const explicitTeamId = teamIdFromValue(data.team_id)
    ?? teamIdFromValue(data.team)
    ?? teamIdFromRows(data)
    ?? teamIdFromText(source.title)
    ?? teamIdFromText(source.source ?? '');
  const explicitPlayerId = numberFromValue(data.nba_player_id) ?? numberFromValue(data.player_id);
  const explicitPlayerName = stringFromValue(data.player_name)
    ?? stringFromValue(data.player)
    ?? stringFromRows(data, ['player', 'name']);
  const titlePlayerName = playerNameFromTitle(source.title);
  const playerName = explicitPlayerName ?? titlePlayerName;

  if (!explicitTeamId || (!playerName && explicitPlayerId === null)) return null;
  if (!explicitPlayerName && !titlePlayerName && source.kind !== 'CONTRACT') return null;

  return {
    teamId: explicitTeamId,
    playerName,
    nbaPlayerId: explicitPlayerId,
    sourceMatchedBy: explicitPlayerName || explicitPlayerId !== null ? 'structured-data' : 'title',
  };
}

function playerNameFromTitle(title: string): string | null {
  if (!/[—-]/.test(title)) return null;
  const [rawName] = title.split(/[—-]/);
  const name = rawName
    .replace(/\b(contract|salary|cap|profile)\b.*$/i, '')
    .trim();
  return name && /\s/.test(name) ? name : null;
}

function teamIdFromRows(data: Record<string, unknown>): string | null {
  const rows = Array.isArray(data.rows) ? data.rows.filter(isRecord) : [];
  for (const row of rows) {
    const key = String(row.k ?? row.key ?? '').toLowerCase();
    if (!['team', 'team id', 'club'].includes(key)) continue;
    const teamId = teamIdFromValue(row.v ?? row.value);
    if (teamId) return teamId;
  }
  return null;
}

function stringFromRows(data: Record<string, unknown>, keys: string[]): string | null {
  const rows = Array.isArray(data.rows) ? data.rows.filter(isRecord) : [];
  for (const row of rows) {
    const key = String(row.k ?? row.key ?? '').toLowerCase();
    if (!keys.includes(key)) continue;
    const value = stringFromValue(row.v ?? row.value);
    if (value) return value;
  }
  return null;
}

function teamIdFromText(text: string): string | null {
  const candidates = text.match(/\b[A-Z]{2,3}\b/g) ?? [];
  return candidates.find((candidate) => NBA_TEAM_IDS.has(candidate)) ?? null;
}

function teamIdFromValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return teamIdFromText(value.toUpperCase());
}

function stringFromValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function numberFromValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function advancedStatRows(row: NbaPlayerStatRow): Row[] {
  return [
    { k: 'GP / MIN', v: `${row.games_played} / ${row.minutes.toLocaleString()}` },
    { k: 'PTS / REB / AST', v: `${formatNumber(row.points_per_game, 1)} / ${formatNumber(row.rebounds_per_game, 1)} / ${formatNumber(row.assists_per_game, 1)}` },
    { k: 'TS%', v: formatUnitPct(row.true_shooting_pct) },
    { k: 'eFG%', v: formatUnitPct(row.effective_fg_pct) },
    { k: 'USG%', v: formatUnitPct(row.usage_pct) },
    { k: '3PAr', v: formatUnitPct(row.three_point_attempt_rate) },
    { k: 'FTr', v: formatUnitPct(row.free_throw_rate) },
    { k: 'ORB / DRB / REB', v: `${formatUnitPct(row.offensive_rebound_pct)} / ${formatUnitPct(row.defensive_rebound_pct)} / ${formatUnitPct(row.rebound_pct)}` },
    { k: 'AST% / TOV%', v: `${formatUnitPct(row.assist_pct)} / ${formatNumber(row.turnover_pct, 1)}%` },
    { k: 'ORtg / DRtg', v: `${formatNumber(row.offensive_rating, 1)} / ${formatNumber(row.defensive_rating, 1)}` },
    { k: 'Net rating', v: formatSigned(row.net_rating) },
    { k: 'PIE', v: formatUnitPct(row.player_impact_estimate) },
    { k: 'DWS', v: formatNumber(row.defensive_win_shares, 2) },
    { k: 'Match', v: row.match_status === 'roster-matched' ? 'Roster linked' : 'Stats only' },
  ];
}

function salaryCellLabel(cell: NbaCapSheetPlayerRow['salary_cells'][number]): string {
  const value = cell.amount != null ? formatMoney(cell.amount) : cell.label ?? 'Source needed';
  return cell.option_type ? `${value} ${cell.option_type.toUpperCase()}` : value;
}

function initialsFor(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'P';
}

function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is Primitive {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function primitiveValue(value: unknown): Primitive {
  if (isPrimitive(value)) return value;
  return JSON.stringify(value);
}

function formatValue(value: Primitive): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function labelForKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMoney(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
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
  const formatted = formatNumber(value, 1);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatUnitPct(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return `${(value * 100).toFixed(1)}%`;
}
