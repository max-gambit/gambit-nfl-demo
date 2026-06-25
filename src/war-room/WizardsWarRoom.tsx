import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type {
  BriefSource,
  ContextGraphWarRoomCounterparty,
  ContextGraphWarRoomDecisionCard,
  ContextGraphWarRoomEdge,
  ContextGraphWarRoomNode,
  ContextGraphWarRoomResponse,
  ContextGraphWarRoomTopCall,
} from '@shared/types';
import { createBrief } from '../api/briefs';
import { getContextGraphWarRoom } from '../api/contextGraph';
import { createSession } from '../api/sessions';
import { useBriefs, useSessions, useToasts, useUi } from '../store';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { ContextGraphActivityDrawer } from './ContextGraphActivityDrawer';

const SUBJECT_TEAM_ID = 'GSW';
const SUBJECT_TEAM_NAME = 'Golden State Warriors';

type WarRoomView = 'briefing' | 'call_sheet' | 'evidence' | 'context';

export function WizardsWarRoom() {
  const [data, setData] = useState<ContextGraphWarRoomResponse | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState(SUBJECT_TEAM_ID);
  const [activeView, setActiveView] = useState<WarRoomView>('briefing');
  const [loading, setLoading] = useState(true);
  const [startingPrompt, setStartingPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { pushToast } = useToasts();
  const { insertSession, setActiveSession } = useSessions();
  const {
    insertBrief,
    setActiveBrief,
    activeBriefId,
    sourcesByBrief,
    loadBriefData,
  } = useBriefs();
  const {
    setActiveNav,
    setDatabaseTeamId,
    setExpandedBrief,
    setRightPanelMode,
    setRightPanelOpen,
  } = useUi();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getContextGraphWarRoom(SUBJECT_TEAM_ID)
      .then((response) => {
        if (cancelled) return;
        setData(response);
        setSelectedTeamId(response.executive_summary.top_calls[0]?.team_id ?? response.counterparties[0]?.team_id ?? SUBJECT_TEAM_ID);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeBriefId) void loadBriefData(activeBriefId);
  }, [activeBriefId, loadBriefData]);

  const activeSources = activeBriefId ? (sourcesByBrief[activeBriefId] ?? []) : [];
  const selectedCounterparty = data?.counterparties.find((team) => team.team_id === selectedTeamId) ?? null;
  const selectedNode = data?.graph.nodes.find((node) => node.team_id === selectedTeamId) ?? null;
  const maxScore = Math.max(1, ...(data?.counterparties.map((team) => team.score) ?? [1]));
  const mapLayout = useMemo(() => layoutNodes(data?.graph.nodes ?? []), [data?.graph.nodes]);
  const primaryPrompt = data?.demo_prompts[0] ?? null;
  const onboardingProfile = data?.subject.preferences.onboarding_profile ?? null;
  const onboardingPriorityCount = onboardingProfile?.strategic_priorities.ranked_priorities.length ?? 0;
  const onboardingActive = onboardingProfile?.status === 'completed';

  const openContextGraph = () => {
    setDatabaseTeamId(SUBJECT_TEAM_ID);
    setActiveNav('database');
  };

  const startPrompt = async (prompt: string, title: string) => {
    setStartingPrompt(title);
    try {
      const session = await createSession(`${data?.subject.name ?? SUBJECT_TEAM_NAME} War Room`);
      insertSession(session);
      setActiveSession(session.id);
      const brief = await createBrief({ session_id: session.id, question: prompt });
      insertBrief(brief);
      setActiveBrief(brief.id);
      setExpandedBrief(brief.id);
      setRightPanelMode('thread');
      setRightPanelOpen(true);
      setActiveNav('analyze');
      pushToast({
        tone: 'success',
        message: 'Executive brief started',
        detail: 'The lookup trail will appear as the brief generates.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Could not start executive brief',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    } finally {
      setStartingPrompt(null);
    }
  };

  const startMemoryBrief = () => {
    void startPrompt(
      `Using the ${data?.subject.name ?? SUBJECT_TEAM_NAME} Intel onboarding profile, current public roster/cap/stat data, and Intel, identify the roster decisions where team-specific priorities and working style change the recommendation. Label onboarding context separately from public evidence.`,
      'Onboarding-aware brief',
    );
  };

  if (loading) {
    return <div style={surfaceStyle}><div style={centeredStyle}>Loading {SUBJECT_TEAM_NAME} board brief...</div></div>;
  }

  if (!data) {
    return <div style={surfaceStyle}><div style={centeredStyle}>{error ?? 'War Room unavailable.'}</div></div>;
  }

  const { executive_summary: executive, subject } = data;

  return (
    <div style={surfaceStyle}>
      <section style={heroStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={eyebrowStyle}>Board brief</div>
          <h1 style={titleStyle}>{subject.name}</h1>
          <p style={headlineStyle}>{executive.headline}</p>
          <p style={ledeStyle}>{executive.recommended_posture}</p>
        </div>
        <div style={heroRailStyle}>
          <ConfidencePill summary={executive} />
          <button onClick={() => setActiveView('context')} style={memoryStatusStyle(onboardingActive)}>
            {onboardingActive ? `Context onboarding active · ${onboardingPriorityCount}` : 'Complete onboarding'}
          </button>
          <button
            onClick={() => primaryPrompt && startPrompt(primaryPrompt.prompt, 'Executive brief')}
            disabled={!primaryPrompt || startingPrompt !== null}
            style={primaryButtonStyle}
          >
            {startingPrompt ? 'Starting...' : 'Run executive brief'}
          </button>
          <button onClick={openContextGraph} style={secondaryButtonStyle}>Edit assumptions</button>
        </div>
      </section>

      {error && <div style={errorStyle}>{error}</div>}

      <div style={viewSwitchStyle} role="tablist" aria-label="War room views">
        <ViewButton active={activeView === 'briefing'} onClick={() => setActiveView('briefing')}>Briefing</ViewButton>
        <ViewButton active={activeView === 'call_sheet'} onClick={() => setActiveView('call_sheet')}>Call Sheet</ViewButton>
        <ViewButton active={activeView === 'evidence'} onClick={() => setActiveView('evidence')}>Evidence</ViewButton>
        <ViewButton active={activeView === 'context'} onClick={() => setActiveView('context')}>Context</ViewButton>
      </div>

      {activeView === 'briefing' && (
        <BriefingView
          data={data}
          onOpenContextGraph={openContextGraph}
          onStartPrompt={startPrompt}
          startingPrompt={startingPrompt}
        />
      )}

      {activeView === 'call_sheet' && (
        <CallSheetView
          counterparties={data.counterparties}
          executiveTopCalls={executive.top_calls}
          selectedCounterparty={selectedCounterparty}
          maxScore={maxScore}
          onSelectTeam={setSelectedTeamId}
        />
      )}

      {activeView === 'evidence' && (
        <EvidenceView
          data={data}
          activeSources={activeSources}
          selectedNode={selectedNode}
          selectedCounterparty={selectedCounterparty}
          mapLayout={mapLayout}
          onSelectTeam={setSelectedTeamId}
        />
      )}

      {activeView === 'context' && (
        <OnboardingContextView
          data={data}
          onRunOnboardingBrief={startMemoryBrief}
          startingBrief={startingPrompt === 'Onboarding-aware brief'}
        />
      )}
    </div>
  );
}

function BriefingView({
  data,
  onOpenContextGraph,
  onStartPrompt,
  startingPrompt,
}: {
  data: ContextGraphWarRoomResponse;
  onOpenContextGraph: () => void;
  onStartPrompt: (prompt: string, title: string) => void;
  startingPrompt: string | null;
}) {
  const prompt = data.demo_prompts.find((item) => item.title.toLowerCase().includes('counterparty')) ?? data.demo_prompts[0] ?? null;
  return (
    <div style={briefingGridStyle}>
      <section style={{ ...panelStyle, gridColumn: '1 / -1' }}>
        <SectionHeader eyebrow="Executive calls" title="Decisions to Settle" />
        <div style={decisionGridStyle}>
          {data.executive_summary.decision_cards.map((card) => (
            <DecisionCard key={card.title} card={card} />
          ))}
        </div>
      </section>

      <section style={panelStyle}>
        <SectionHeader eyebrow="Call sheet" title="First three calls" />
        <div style={{ display: 'grid', gap: SPACE.sm }}>
          {data.executive_summary.top_calls.map((call) => <TopCallCard key={call.team_id} call={call} />)}
          {data.executive_summary.top_calls.length === 0 && (
            <p style={bodyTextStyle}>No strong call lane is present in the current read.</p>
          )}
        </div>
      </section>

      <section style={panelStyle}>
        <SectionHeader eyebrow="Assumptions" title="What this read is using" />
        <div style={assumptionGridStyle}>
          <Metric label="Posture" value={formatReadable(data.subject.preferences.strategic_posture.timeframe)} />
          <Metric label="Spend" value={formatReadable(data.subject.preferences.ownership.spending_posture)} />
          <Metric label="Risk" value={formatReadable(data.subject.preferences.cultural_signals.risk_tolerance.value)} />
          <Metric label="Overrides" value={data.subject.has_overrides ? 'yes' : 'no'} tone={data.subject.has_overrides ? 'good' : 'neutral'} />
        </div>
        {data.executive_summary.caveats.length > 0 && (
          <div style={caveatBoxStyle}>
            {data.executive_summary.caveats.slice(0, 2).map((caveat) => (
              <div key={caveat} style={caveatLineStyle}>{caveat}</div>
            ))}
          </div>
        )}
        <div style={assumptionActionsStyle}>
          <button onClick={onOpenContextGraph} style={secondaryButtonStyle}>Edit assumptions</button>
          {prompt && (
            <button
              onClick={() => onStartPrompt(prompt.prompt, prompt.title)}
              disabled={startingPrompt !== null}
              style={primaryButtonStyle}
            >
              Run call-sheet brief
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function OnboardingContextView({
  data,
  onRunOnboardingBrief,
  startingBrief,
}: {
  data: ContextGraphWarRoomResponse;
  onRunOnboardingBrief: () => void;
  startingBrief: boolean;
}) {
  const profile = data.subject.preferences.onboarding_profile;
  const completed = profile.status === 'completed';
  const cornerstones = profile.team_snapshot.cornerstones;
  const ranked = profile.strategic_priorities.ranked_priorities;
  return (
    <div style={briefingGridStyle}>
      <section style={{ ...panelStyle, gridColumn: '1 / -1' }}>
        <SectionHeader eyebrow="Intel onboarding" title={completed ? `${data.subject.name} setup is active` : 'Onboarding not completed'} />
        <p style={bodyTextStyle}>
          {completed
            ? `This context is stored in the ${data.subject.name} Intel override profile and is available to Gambit as first-party team context.`
            : 'The first-run onboarding flow writes here directly. Complete it before relying on onboarding-aware recommendations.'}
        </p>
        <div style={decisionGridStyle}>
          <article style={miniCardStyle}>
            <div style={eyebrowStyle}>Identity</div>
            <h3 style={cardTitleStyle}>{labelFromId(profile.identity.role) || 'Role not set'}</h3>
            <p style={bodyTextStyle}>{labelFromId(profile.identity.decision_authority) || 'Decision authority not set'}</p>
          </article>
          <article style={miniCardStyle}>
            <div style={eyebrowStyle}>Team snapshot</div>
            <h3 style={cardTitleStyle}>{labelFromId(profile.team_snapshot.lifecycle) || 'Lifecycle not set'}</h3>
            <p style={bodyTextStyle}>{cornerstones.length ? cornerstones.join(', ') : 'No cornerstones captured'}</p>
          </article>
          <article style={miniCardStyle}>
            <div style={eyebrowStyle}>Priority vector</div>
            <h3 style={cardTitleStyle}>{ranked.length} ranked priorities</h3>
            <p style={bodyTextStyle}>{profile.strategic_priorities.ninety_day_decision || 'No 90-day decision captured'}</p>
          </article>
          <article style={miniCardStyle}>
            <div style={eyebrowStyle}>Working style</div>
            <h3 style={cardTitleStyle}>{labelFromId(profile.working_style.recommendation_style) || 'Default pending'}</h3>
            <p style={bodyTextStyle}>{profile.working_style.claim_requirements.map(labelFromId).join(', ') || 'Evidence requirements not set'}</p>
          </article>
        </div>
        <div style={{ marginTop: SPACE.lg }}>
          <button type="button" onClick={onRunOnboardingBrief} disabled={!completed || startingBrief} style={primaryButtonStyle}>
            {startingBrief ? 'Starting...' : 'Run onboarding-aware brief'}
          </button>
        </div>
      </section>
    </div>
  );
}

function CallSheetView({
  counterparties,
  executiveTopCalls,
  selectedCounterparty,
  maxScore,
  onSelectTeam,
}: {
  counterparties: ContextGraphWarRoomCounterparty[];
  executiveTopCalls: ContextGraphWarRoomTopCall[];
  selectedCounterparty: ContextGraphWarRoomCounterparty | null;
  maxScore: number;
  onSelectTeam: (teamId: string) => void;
}) {
  const topCallIds = new Set(executiveTopCalls.map((call) => call.team_id));
  return (
    <div style={detailGridStyle}>
      <section style={{ ...panelStyle, gridColumn: '1 / -1' }}>
        <SectionHeader eyebrow="Call sheet" title="Who to call, and why" />
        <div style={callSheetLayoutStyle}>
          <div style={callRowsStyle}>
            {counterparties.map((team) => (
              <button
                key={team.team_id}
                onClick={() => onSelectTeam(team.team_id)}
                style={selectedCounterparty?.team_id === team.team_id ? activeCallRowStyle : callRowStyle}
              >
                <div style={callRowTopStyle}>
                  <span style={teamCodeStyle}>{team.team_id}</span>
                  <span style={teamNameStyle}>{team.name}</span>
                  <TierBadge tier={team.tier} />
                  {topCallIds.has(team.team_id) && <span style={priorityBadgeStyle}>first wave</span>}
                </div>
                <div style={scoreBarTrackStyle}>
                  <div style={{ ...scoreBarStyle, width: `${Math.max(8, (team.score / maxScore) * 100)}%` }} />
                </div>
                <div style={callLaneStyle}>{team.dossier.likely_trade_lane}</div>
              </button>
            ))}
          </div>
          <CounterpartyDetail counterparty={selectedCounterparty} />
        </div>
      </section>
    </div>
  );
}

function EvidenceView({
  data,
  activeSources,
  selectedNode,
  selectedCounterparty,
  mapLayout,
  onSelectTeam,
}: {
  data: ContextGraphWarRoomResponse;
  activeSources: BriefSource[];
  selectedNode: ContextGraphWarRoomNode | null;
  selectedCounterparty: ContextGraphWarRoomCounterparty | null;
  mapLayout: Map<string, { x: number; y: number }>;
  onSelectTeam: (teamId: string) => void;
}) {
  return (
    <div style={evidenceGridStyle}>
      <section style={panelStyle}>
        <SectionHeader eyebrow="Source state" title="Confidence and Freshness" />
        <div style={assumptionGridStyle}>
          <Metric label="Validation" value={data.subject.validation.status} tone={data.subject.validation.status === 'pass' ? 'good' : 'bad'} />
          <Metric label="Warnings" value={String(data.subject.validation.warning_count)} />
          <Metric label="As of" value={data.subject.as_of_date || 'unknown'} />
          <Metric label="Updated" value={data.subject.last_updated || 'unknown'} />
        </div>
      </section>

      <section style={panelStyle}>
        <SectionHeader eyebrow="Player pressure" title="Decision Pressure" />
        <DecisionPressureList players={data.roster_pressure.slice(0, 6)} />
      </section>

      <section style={{ ...panelStyle, gridColumn: '1 / -1' }}>
        <SectionHeader eyebrow="Relationships" title="Map and Inspector" />
        <div style={mapShellStyle}>
          <svg viewBox="0 0 800 360" role="img" aria-label={`${data.subject.name} relationship map`} style={mapSvgStyle}>
            {data.graph.edges.map((edge) => {
              const from = mapLayout.get(edge.from_team_id);
              const to = mapLayout.get(edge.to_team_id);
              if (!from || !to) return null;
              return (
                <g key={edge.id}>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edgeColor(edge.type)} strokeWidth="2" opacity="0.72" />
                  <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4} textAnchor="middle" style={mapLabelStyle}>{edge.label}</text>
                </g>
              );
            })}
            {data.graph.nodes.map((node) => {
              const point = mapLayout.get(node.team_id);
              if (!point) return null;
              const selected = node.team_id === selectedNode?.team_id;
              return (
                <g key={node.team_id} onClick={() => onSelectTeam(node.team_id)} style={{ cursor: 'pointer' }}>
                  <circle cx={point.x} cy={point.y} r={node.kind === 'subject' ? 42 : 30} fill={node.kind === 'subject' ? F.ink : selected ? F.fenway : F.surface} stroke={selected ? F.fenway : F.borderStrong} strokeWidth={selected ? 4 : 2} />
                  <text x={point.x} y={point.y + 5} textAnchor="middle" style={{ ...nodeTextStyle, fill: node.kind === 'subject' || selected ? F.surface : F.ink }}>{node.team_id}</text>
                </g>
              );
            })}
          </svg>
          <Inspector
            node={selectedNode}
            counterparty={selectedCounterparty}
            edgeCount={data.graph.edges.filter((edge) => edge.to_team_id === selectedNode?.team_id || edge.from_team_id === selectedNode?.team_id).length}
          />
        </div>
      </section>

      <section style={{ ...panelStyle, gridColumn: '1 / -1' }}>
        <ContextGraphActivityDrawer
          title="Last brief lookup trail"
          mode="persisted"
          sources={activeSources}
        />
      </section>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} role="tab" aria-selected={active} style={active ? activeViewButtonStyle : viewButtonStyle}>
      {children}
    </button>
  );
}

function ConfidencePill({ summary }: { summary: ContextGraphWarRoomResponse['executive_summary'] }) {
  return (
    <div style={confidencePillStyle(summary.confidence.status)}>
      <div style={confidenceLabelStyle}>{summary.confidence.label}</div>
      <div style={confidenceDetailStyle}>{summary.confidence.detail}</div>
    </div>
  );
}

function DecisionCard({ card }: { card: ContextGraphWarRoomDecisionCard }) {
  return (
    <article style={decisionCardStyle}>
      <div style={decisionTopStyle}>
        <h3 style={cardTitleStyle}>{card.title}</h3>
        <span style={severityBadgeStyle(card.severity)}>{card.severity}</span>
      </div>
      <div style={signalLineStyle}>{card.signal}</div>
      <p style={bodyTextStyle}>{card.recommendation}</p>
      <div style={questionStyle}>{card.action}</div>
    </article>
  );
}

function TopCallCard({ call }: { call: ContextGraphWarRoomTopCall }) {
  return (
    <article style={topCallStyle}>
      <div style={callRowTopStyle}>
        <span style={teamCodeStyle}>{call.team_id}</span>
        <span style={teamNameStyle}>{call.name}</span>
        <TierBadge tier={call.tier} />
      </div>
      <div style={miniHeadingStyle}>{call.priority}</div>
      <div style={callLaneStyle}>{call.trade_lane}</div>
      <div style={questionStyle}>{call.opening_question}</div>
    </article>
  );
}

function CounterpartyDetail({ counterparty }: { counterparty: ContextGraphWarRoomCounterparty | null }) {
  if (!counterparty) {
    return (
      <aside style={inspectorStyle}>
        <div style={eyebrowStyle}>Selected team</div>
        <p style={bodyTextStyle}>Select a team to see the call notes.</p>
      </aside>
    );
  }

  return (
    <aside style={inspectorStyle}>
      <div style={eyebrowStyle}>Selected team</div>
      <h3 style={inspectorTitleStyle}>{counterparty.name}</h3>
      <div style={inspectorGridStyle}>
        <Metric label="Score" value={String(counterparty.score)} />
        <Metric label="Tier" value={counterparty.tier} />
        <Metric label="Posture" value={formatReadable(counterparty.posture)} />
        <Metric label="Overrides" value={counterparty.has_overrides ? 'yes' : 'no'} tone={counterparty.has_overrides ? 'good' : 'neutral'} />
      </div>
      <div style={miniHeadingStyle}>Likely lane</div>
      <div style={callLaneStyle}>{counterparty.dossier.likely_trade_lane}</div>
      <div style={questionStyle}>{counterparty.dossier.opening_question}</div>
      <div style={miniHeadingStyle}>Why this team</div>
      <ul style={reasonListStyle}>
        {counterparty.dossier.leverage_notes.map((reason) => <li key={reason}>{reason}</li>)}
      </ul>
      {counterparty.dossier.risks.length > 0 && (
        <>
          <div style={miniHeadingStyle}>Caveats</div>
          <ul style={reasonListStyle}>
            {counterparty.dossier.risks.map((risk) => <li key={risk}>{risk}</li>)}
          </ul>
        </>
      )}
    </aside>
  );
}

function DecisionPressureList({ players }: { players: ContextGraphWarRoomResponse['roster_pressure'] }) {
  if (players.length === 0) return <p style={bodyTextStyle}>No roster-pressure spike in the current read.</p>;

  return (
    <div style={{ display: 'grid', gap: SPACE.xs }}>
      {players.map((player) => (
        <div key={player.player_id} style={playerRowStyle}>
          <div style={playerMainStyle}>
            <span style={playerNameStyle}>{player.name}</span>
            <span style={actionBadgeStyle(player.action)}>{player.action}</span>
          </div>
          <div style={playerMetaStyle}>
            {player.tier} · {player.movement_status} · {String(player.years_remaining ?? 'unknown')} yrs
          </div>
          <div style={pressureTrackStyle}>
            <div style={{ ...pressureBarStyle, width: `${Math.min(100, player.pressure_score)}%` }} />
          </div>
          <div style={reasonLineStyle}>{player.rationale.slice(0, 2).join(' · ') || player.contract_leverage}</div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'good' | 'bad' }) {
  return (
    <div style={metricStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ ...metricValueStyle, color: tone === 'good' ? F.fenway : tone === 'bad' ? F.red : F.ink }}>{value}</div>
    </div>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ marginBottom: SPACE.md }}>
      <div style={eyebrowStyle}>{eyebrow}</div>
      <h2 style={sectionTitleStyle}>{title}</h2>
    </div>
  );
}

function TierBadge({ tier }: { tier: ContextGraphWarRoomCounterparty['tier'] }) {
  const style = tier === 'hot'
    ? { background: F.redSoft, color: F.red, borderColor: F.red }
    : tier === 'warm'
      ? { background: F.amberSoft, color: F.amber, borderColor: F.amber }
      : { background: F.cream50, color: F.fg, borderColor: F.borderStrong };
  return <span style={{ ...tierBadgeStyle, ...style }}>{tier}</span>;
}

function Inspector({
  node,
  counterparty,
  edgeCount,
}: {
  node: ContextGraphWarRoomNode | null;
  counterparty: ContextGraphWarRoomCounterparty | null;
  edgeCount: number;
}) {
  if (!node) return null;
  return (
    <aside style={inspectorStyle}>
      <div style={eyebrowStyle}>Selected node</div>
      <h3 style={inspectorTitleStyle}>{node.name}</h3>
      <div style={inspectorGridStyle}>
        <Metric label="Team" value={node.team_id} />
        <Metric label="Edges" value={String(edgeCount)} />
        <Metric label="Validation" value={node.validation_status} tone={node.validation_status === 'pass' ? 'good' : 'bad'} />
        <Metric label="Overrides" value={node.has_overrides ? 'yes' : 'no'} tone={node.has_overrides ? 'good' : 'neutral'} />
      </div>
      {counterparty && (
        <>
          <div style={miniHeadingStyle}>Call notes</div>
          <div style={callLaneStyle}>{counterparty.dossier.likely_trade_lane}</div>
          <div style={questionStyle}>{counterparty.dossier.opening_question}</div>
        </>
      )}
    </aside>
  );
}

function layoutNodes(nodes: ContextGraphWarRoomNode[]) {
  const map = new Map<string, { x: number; y: number }>();
  const center = nodes.find((node) => node.kind === 'subject');
  if (center) map.set(center.team_id, { x: 400, y: 180 });
  const ring = nodes.filter((node) => node.kind !== 'subject');
  ring.forEach((node, index) => {
    const angle = (-Math.PI / 2) + (index / Math.max(1, ring.length)) * Math.PI * 2;
    map.set(node.team_id, {
      x: 400 + Math.cos(angle) * 260,
      y: 180 + Math.sin(angle) * 120,
    });
  });
  return map;
}

function edgeColor(type: ContextGraphWarRoomEdge['type']): string {
  if (type === 'trade_partner') return F.fenway;
  if (type === 'personnel') return F.positive;
  if (type === 'rivalry') return F.red;
  if (type === 'pick') return F.amber;
  return F.fgMuted;
}

function severityBadgeStyle(severity: 'high' | 'medium' | 'low'): React.CSSProperties {
  const color = severity === 'high' ? F.red : severity === 'medium' ? F.amber : F.fenway;
  const background = severity === 'high' ? F.redSoft : severity === 'medium' ? F.amberSoft : F.fenwaySoft;
  return {
    ...tierBadgeStyle,
    color,
    background,
    borderColor: color,
  };
}

function confidencePillStyle(status: 'high' | 'medium' | 'low'): React.CSSProperties {
  const color = status === 'high' ? F.fenway : status === 'medium' ? F.amber : F.red;
  const background = status === 'high' ? F.fenwaySoft : status === 'medium' ? F.amberSoft : F.redSoft;
  return {
    border: `1px solid ${color}`,
    background,
    borderRadius: RADIUS.md,
    padding: SPACE.md,
    minWidth: 230,
  };
}

function actionBadgeStyle(action: 'protect' | 'monitor' | 'market' | 'decision'): React.CSSProperties {
  const color = action === 'market' ? F.red : action === 'decision' ? F.amber : action === 'protect' ? F.fenway : F.fg;
  const background = action === 'market' ? F.redSoft : action === 'decision' ? F.amberSoft : action === 'protect' ? F.fenwaySoft : F.cream50;
  return {
    ...tierBadgeStyle,
    color,
    background,
    borderColor: color,
  };
}

function memoryStatusStyle(active: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? F.fenway : F.borderStrong}`,
    background: active ? F.fenwaySoft : F.surface,
    color: active ? F.fenway : F.ink,
    borderRadius: RADIUS.sm,
    padding: `${SPACE.sm}px ${SPACE.md}px`,
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontSize: TYPE.body.sm,
    fontWeight: 800,
    textAlign: 'left',
  };
}

function formatReadable(value: string): string {
  return value.replace(/_/g, ' ');
}

function labelFromId(value: string): string {
  return value ? formatReadable(value) : '';
}

const surfaceStyle: React.CSSProperties = {
  height: '100%',
  overflow: 'auto',
  background: F.paper,
  padding: SPACE.xl,
};

const centeredStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.body.md,
};

const heroStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: SPACE['3xl'],
  alignItems: 'end',
  marginBottom: SPACE.lg,
};

const heroRailStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.sm,
};

const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
  color: F.fgMuted,
  fontWeight: 700,
};

const titleStyle: React.CSSProperties = {
  margin: `${SPACE.xs}px 0`,
  fontFamily: 'var(--font-display)',
  fontSize: 30,
  lineHeight: 1.05,
  color: F.ink,
  letterSpacing: TRACKING.body,
};

const headlineStyle: React.CSSProperties = {
  maxWidth: 860,
  margin: `${SPACE.md}px 0 ${SPACE.sm}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.display.lg,
  lineHeight: 1.25,
  color: F.ink,
  fontWeight: 800,
};

const ledeStyle: React.CSSProperties = {
  maxWidth: 880,
  margin: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.lg,
  lineHeight: 1.6,
  color: F.inkSoft,
};

const viewSwitchStyle: React.CSSProperties = {
  display: 'inline-flex',
  maxWidth: '100%',
  flexWrap: 'wrap',
  gap: SPACE.xs,
  padding: SPACE.xs,
  border: `1px solid ${F.border}`,
  background: F.cream50,
  borderRadius: RADIUS.md,
  marginBottom: SPACE.lg,
};

const viewButtonStyle: React.CSSProperties = {
  border: '1px solid transparent',
  background: 'transparent',
  color: F.fg,
  borderRadius: RADIUS.sm,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 800,
};

const activeViewButtonStyle: React.CSSProperties = {
  ...viewButtonStyle,
  border: `1px solid ${F.borderStrong}`,
  background: F.surface,
  color: F.ink,
  boxShadow: F.shadowSoft,
};

const briefingGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: SPACE.lg,
  alignItems: 'start',
};

const detailGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: SPACE.lg,
  alignItems: 'start',
};

const evidenceGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: SPACE.lg,
  alignItems: 'start',
};

const panelStyle: React.CSSProperties = {
  background: F.surface,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  boxShadow: F.shadowSoft,
  padding: SPACE.lg,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.display.md,
  color: F.ink,
  letterSpacing: TRACKING.body,
};

const decisionGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: SPACE.md,
};

const decisionCardStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.cream50,
  padding: SPACE.md,
  minWidth: 0,
};

const miniCardStyle: React.CSSProperties = {
  ...decisionCardStyle,
  background: F.surface,
};

const decisionTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: SPACE.sm,
  marginBottom: SPACE.sm,
};

const cardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.display.sm,
  color: F.ink,
  lineHeight: 1.25,
};

const assumptionGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: SPACE.sm,
};

const assumptionActionsStyle: React.CSSProperties = {
  marginTop: SPACE.md,
  display: 'flex',
  justifyContent: 'space-between',
  gap: SPACE.sm,
  flexWrap: 'wrap',
};

const caveatBoxStyle: React.CSSProperties = {
  marginTop: SPACE.md,
  display: 'grid',
  gap: SPACE.xs,
  borderLeft: `3px solid ${F.amber}`,
  paddingLeft: SPACE.md,
};

const caveatLineStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.45,
  color: F.inkSoft,
};

const metricStyle: React.CSSProperties = {
  background: F.cream50,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  padding: SPACE.sm,
  minWidth: 0,
};

const metricLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  color: F.fgMuted,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const metricValueStyle: React.CSSProperties = {
  marginTop: SPACE.xs,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  color: F.ink,
  fontWeight: 700,
};

const miniHeadingStyle: React.CSSProperties = {
  marginTop: SPACE.md,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
  letterSpacing: TRACKING.caps,
  textTransform: 'uppercase',
  fontWeight: 700,
};

const confidenceLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  color: F.ink,
  fontWeight: 800,
};

const confidenceDetailStyle: React.CSSProperties = {
  marginTop: SPACE.xs,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
  lineHeight: 1.35,
};

const bodyTextStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  lineHeight: 1.5,
  color: F.inkSoft,
};

const signalLineStyle: React.CSSProperties = {
  marginBottom: SPACE.sm,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
  lineHeight: 1.4,
};

const questionStyle: React.CSSProperties = {
  marginTop: SPACE.sm,
  borderLeft: `3px solid ${F.fenway}`,
  paddingLeft: SPACE.sm,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.ink,
  fontWeight: 700,
  lineHeight: 1.45,
};

const primaryButtonStyle: React.CSSProperties = {
  border: `1px solid ${F.fenway}`,
  background: F.fenway,
  color: F.surface,
  borderRadius: RADIUS.md,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 800,
};

const secondaryButtonStyle: React.CSSProperties = {
  border: `1px solid ${F.borderStrong}`,
  background: F.surface,
  color: F.ink,
  borderRadius: RADIUS.md,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 800,
};

const topCallStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.cream50,
  padding: SPACE.md,
};

const callSheetLayoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: SPACE.md,
  alignItems: 'start',
};

const callRowsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: SPACE.sm,
};

const callRowStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  background: F.cream50,
  borderRadius: RADIUS.md,
  padding: SPACE.sm,
  cursor: 'pointer',
  textAlign: 'left',
  minWidth: 0,
};

const activeCallRowStyle: React.CSSProperties = {
  ...callRowStyle,
  border: `1px solid ${F.fenway}`,
  boxShadow: F.shadow,
  background: F.fenwaySoft,
};

const callRowTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.xs,
  flexWrap: 'wrap',
  minWidth: 0,
};

const teamCodeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.body.md,
  color: F.ink,
  fontWeight: 800,
};

const teamNameStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowWrap: 'anywhere',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.ink,
  fontWeight: 700,
};

const priorityBadgeStyle: React.CSSProperties = {
  ...teamCodeStyle,
  fontSize: TYPE.meta.xs,
  color: F.fenway,
  textTransform: 'uppercase',
  letterSpacing: TRACKING.micro,
};

const callLaneStyle: React.CSSProperties = {
  marginTop: SPACE.sm,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
  lineHeight: 1.45,
};

const tierBadgeStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.pill,
  padding: `1px ${SPACE.xs + 2}px`,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  textTransform: 'uppercase',
  letterSpacing: TRACKING.micro,
  fontWeight: 800,
};

const scoreBarTrackStyle: React.CSSProperties = {
  marginTop: SPACE.sm,
  height: 7,
  borderRadius: RADIUS.pill,
  background: F.cream100,
  overflow: 'hidden',
};

const scoreBarStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: RADIUS.pill,
  background: F.fenway,
};

const reasonLineStyle: React.CSSProperties = {
  marginTop: SPACE.sm,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.fg,
  lineHeight: 1.35,
};

const mapShellStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: SPACE.md,
  alignItems: 'stretch',
};

const mapSvgStyle: React.CSSProperties = {
  width: '100%',
  height: 360,
  display: 'block',
};

const mapLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  fill: F.fgMuted,
  pointerEvents: 'none',
};

const nodeTextStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  fontWeight: 800,
  pointerEvents: 'none',
};

const inspectorStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.cream50,
  padding: SPACE.md,
  minWidth: 0,
};

const inspectorTitleStyle: React.CSSProperties = {
  margin: `${SPACE.xs}px 0 ${SPACE.md}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.display.sm,
  color: F.ink,
};

const inspectorGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: SPACE.xs,
  marginBottom: SPACE.md,
};

const reasonListStyle: React.CSSProperties = {
  margin: `${SPACE.xs}px 0 ${SPACE.md}px`,
  paddingLeft: SPACE.lg,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
  lineHeight: 1.45,
};

const playerRowStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.cream50,
  padding: SPACE.sm,
};

const playerMainStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: SPACE.sm,
  flexWrap: 'wrap',
};

const playerNameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  color: F.ink,
  fontWeight: 800,
};

const playerMetaStyle: React.CSSProperties = {
  marginTop: SPACE.xs,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
};

const pressureTrackStyle: React.CSSProperties = {
  marginTop: SPACE.sm,
  height: 6,
  borderRadius: RADIUS.pill,
  background: F.cream100,
  overflow: 'hidden',
};

const pressureBarStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: RADIUS.pill,
  background: F.amber,
};

const errorStyle: React.CSSProperties = {
  marginBottom: SPACE.md,
  border: `1px solid ${F.red}`,
  background: F.redSoft,
  color: F.red,
  borderRadius: RADIUS.md,
  padding: SPACE.md,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.body.sm,
};
