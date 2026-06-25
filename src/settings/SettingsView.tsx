import { useState, type CSSProperties } from 'react';
import { Icon } from '../ds/Icon';
import { useToasts } from '../store';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { ContextGraphSettings } from './ContextGraphSettings';

type SourceStatus = 'connected' | 'not_connected';
type SourceAction = 'connect' | 'configure';

interface SourceConfig {
  id: string;
  name: string;
  category: string;
  status: SourceStatus;
  freshness: string;
  cadence: string;
  icon: string;
}

const SOURCES: SourceConfig[] = [
  { id: 'google-sheets', name: 'Google Sheets', category: 'Workspace', status: 'connected', freshness: '12m ago', cadence: 'Hourly', icon: 'grid' },
  { id: 'google-docs', name: 'Google Docs', category: 'Workspace', status: 'connected', freshness: '22m ago', cadence: 'Hourly', icon: 'doc' },
  { id: 'pff', name: 'PFF', category: 'League data', status: 'not_connected', freshness: 'Not connected', cadence: 'Daily', icon: 'search' },
  { id: 'teamworks', name: 'Teamworks', category: 'Team operations', status: 'not_connected', freshness: 'Not connected', cadence: 'Near real time', icon: 'shield' },
  { id: 'club-os', name: 'Club football ops DB', category: 'Internal system', status: 'not_connected', freshness: 'Not connected', cadence: 'On demand', icon: 'clipboard' },
  { id: 'zebra', name: 'Zebra tracking', category: 'Tracking and player data', status: 'not_connected', freshness: 'Not connected', cadence: 'Game day', icon: 'pulse' },
  { id: 'sports-info-solutions', name: 'Sports Info Solutions', category: 'Scouting and charting', status: 'not_connected', freshness: 'Not connected', cadence: 'Game day', icon: 'play' },
  { id: 'overthecap', name: 'Over The Cap / contracts', category: 'Cap and contracts', status: 'connected', freshness: '35m ago', cadence: 'Daily', icon: 'clipboard' },
  { id: 'nfl-official', name: 'NFL official rosters / transactions', category: 'League data', status: 'connected', freshness: '1h ago', cadence: 'Daily', icon: 'check' },
  { id: 'pro-football-reference', name: 'Pro Football Reference / Stathead', category: 'Historical stats', status: 'not_connected', freshness: 'Not connected', cadence: 'Weekly', icon: 'search' },
  { id: 'hudl-sportscode', name: 'Hudl / Sportscode', category: 'Video workflow', status: 'not_connected', freshness: 'Not connected', cadence: 'Game day', icon: 'deck' },
  { id: 'catapult', name: 'Catapult', category: 'Performance', status: 'not_connected', freshness: 'Not connected', cadence: 'Daily', icon: 'pulse' },
  { id: 'slack-email', name: 'Slack / Email', category: 'Communications', status: 'not_connected', freshness: 'Not connected', cadence: 'On demand', icon: 'link' },
];

const STATUS_COPY: Record<SourceStatus, { label: string; connected: boolean }> = {
  connected: { label: 'Connected', connected: true },
  not_connected: { label: 'Not connected', connected: false },
};

const CONNECTED_STATUS_COLOR = 'var(--fenway-500)';

export function SettingsView() {
  const [recentAction, setRecentAction] = useState<Record<string, SourceAction>>({});
  const { pushToast } = useToasts();

  const onAction = (source: SourceConfig) => {
    const action = actionForSource(source);
    setRecentAction((current) => ({ ...current, [source.id]: action }));
    pushToast({
      tone: 'success',
      message: actionToast(source.name, action),
    });
  };

  return (
    <section style={surfaceStyle}>
      <header style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>Settings</div>
          <h1 style={titleStyle}>Profile and sources</h1>
        </div>
      </header>

      <main style={contentStyle}>
        <section style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div style={eyebrowStyle}>Profile</div>
            <h2 style={sectionTitleStyle}>Team preferences</h2>
          </div>
          <div style={profilePanelStyle}>
            <ContextGraphSettings initialTeamId="NYG" embedded />
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={sectionHeaderStyle}>
            <div style={eyebrowStyle}>Sources</div>
            <h2 style={sectionTitleStyle}>Connections</h2>
          </div>
          <div style={tableStyle}>
            <div style={tableHeaderStyle}>
              <div>Source</div>
              <div>Status</div>
              <div>Sync</div>
              <div>Updated</div>
              <div />
            </div>
            {SOURCES.map((source, index) => {
              const status = STATUS_COPY[source.status];
              const recent = recentAction[source.id];
              const action = actionForSource(source);
              const isLast = index === SOURCES.length - 1;
              return (
                <div key={source.id} style={isLast ? lastRowStyle : rowStyle}>
                  <div style={sourceCellStyle}>
                    <div style={sourceIconStyle}>
                      <Icon name={source.icon} size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={sourceNameStyle}>{source.name}</div>
                      <div style={sourceCategoryStyle}>{source.category}</div>
                    </div>
                  </div>
                  <div><StatusIndicator label={status.label} connected={status.connected} /></div>
                  <div style={plainCellStyle}>{source.cadence}</div>
                  <div style={plainCellStyle}>{recent ? recentCopy(recent) : source.freshness}</div>
                  <div style={actionCellStyle}>
                    <button type="button" onClick={() => onAction(source)} style={actionButtonStyle}>
                      {actionLabel(action)}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </section>
  );
}

function actionForSource(source: SourceConfig): SourceAction {
  if (source.status === 'connected') return 'configure';
  return 'connect';
}

function actionLabel(action: SourceAction): string {
  if (action === 'connect') return 'Connect';
  return 'Configure';
}

function actionToast(sourceName: string, action: SourceAction): string {
  if (action === 'connect') return `${sourceName} connected`;
  return `${sourceName} updated`;
}

function recentCopy(action: SourceAction): string {
  if (action === 'connect') return 'Connected just now';
  return 'Updated just now';
}

function StatusIndicator({ label, connected }: { label: string; connected: boolean }) {
  return (
    <span style={statusIndicatorStyle}>
      <span style={{ ...statusDotStyle, background: connected ? CONNECTED_STATUS_COLOR : F.fgFaint }} />
      {label}
    </span>
  );
}

const surfaceStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: F.paper,
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  minHeight: 92,
  padding: `${SPACE.xl}px ${SPACE['3xl']}px`,
  borderBottom: `1px solid ${F.border}`,
  display: 'flex',
  alignItems: 'flex-end',
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 700,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
  color: F.fgMuted,
};

const titleStyle: CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontFamily: 'var(--font-display)',
  fontSize: TYPE.display.lg,
  fontWeight: 650,
  color: F.ink,
  letterSpacing: TRACKING.body,
};

const contentStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: `${SPACE.xl}px ${SPACE['3xl']}px ${SPACE['4xl']}px`,
};

const sectionStyle: CSSProperties = {
  display: 'grid',
  gap: SPACE.md,
  marginBottom: SPACE['2xl'],
};

const sectionHeaderStyle: CSSProperties = {
  display: 'grid',
  gap: SPACE.xs,
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: TYPE.display.sm,
  fontWeight: 650,
  color: F.ink,
  letterSpacing: TRACKING.body,
};

const profilePanelStyle: CSSProperties = {
  minHeight: 520,
  background: F.surface,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  overflow: 'hidden',
  boxShadow: F.shadowSoft,
};

const tableStyle: CSSProperties = {
  background: F.surface,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  overflow: 'hidden',
  boxShadow: F.shadowSoft,
};

const tableHeaderStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(240px, 1.6fr) 120px 132px 132px 84px',
  gap: SPACE.lg,
  alignItems: 'center',
  minHeight: 38,
  padding: `0 ${SPACE.lg}px`,
  borderBottom: `1px solid ${F.border}`,
  background: F.paper,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 700,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
  color: F.fgMuted,
};

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(240px, 1.6fr) 120px 132px 132px 84px',
  gap: SPACE.lg,
  alignItems: 'center',
  minHeight: 60,
  padding: `0 ${SPACE.lg}px`,
  borderBottom: `1px solid ${F.border}`,
};

const lastRowStyle: CSSProperties = {
  ...rowStyle,
  borderBottom: 'none',
};

const sourceCellStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.md,
  minWidth: 0,
};

const sourceIconStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: RADIUS.md,
  border: `1px solid ${F.border}`,
  background: F.paper,
  color: F.fenway,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const sourceNameStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  fontWeight: 650,
  color: F.ink,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const sourceCategoryStyle: CSSProperties = {
  marginTop: 2,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.fgMuted,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const plainCellStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
};

const actionCellStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const actionButtonStyle: CSSProperties = {
  height: 28,
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: F.fenway,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 650,
  cursor: 'pointer',
};

const statusIndicatorStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: SPACE.sm,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
};

const statusDotStyle: CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: RADIUS.pill,
  flexShrink: 0,
};
