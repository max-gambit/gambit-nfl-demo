import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  buildCandidateScenario,
  buildCandidateProjectScenarioSeed,
  DEFAULT_SCENARIO_SUBJECT_TEAM_ID,
  type CandidateScenarioPlayer,
  type CandidateScenarioTeamImpact,
} from '@shared/candidateScenario';
import type { BriefOption, BriefOptionDetails, BriefOptionMoveCandidate, NbaCapSheet, ProjectDetail } from '@shared/types';
import { getCurrentNbaCapSheet } from '../api/nba';
import { useBriefs, useProjects, useToasts, useUi } from '../store';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

interface CandidateScenarioModalProps {
  option: BriefOption;
  details: BriefOptionDetails;
  candidate: BriefOptionMoveCandidate;
  fallbackRefs: number[];
  onOpenEvidence: (ref: number) => void;
  onClose: () => void;
}

type LoadState =
  | { status: 'loading'; subjectSheet: null; targetSheet: null; error: null }
  | { status: 'ready'; subjectSheet: NbaCapSheet | null; targetSheet: NbaCapSheet | null; error: null }
  | { status: 'error'; subjectSheet: NbaCapSheet | null; targetSheet: NbaCapSheet | null; error: string };

export function CandidateScenarioModal({
  option,
  details,
  candidate,
  fallbackRefs,
  onOpenEvidence,
  onClose,
}: CandidateScenarioModalProps) {
  const { activeBriefId, briefs } = useBriefs();
  const {
    projects,
    projectsLoaded,
    loadProjects,
    loadProject,
    createProject,
    attachBrief,
    createScenario,
    updateScenario,
    createScenarioPlayer,
    validateScenario,
    setActiveProject,
    setActiveScenario,
  } = useProjects();
  const { setActiveNav } = useUi();
  const { pushToast } = useToasts();
  const subjectTeamId = (candidate.subject_team_id ?? DEFAULT_SCENARIO_SUBJECT_TEAM_ID).toUpperCase();
  const targetTeamId = candidate.target_team_id?.toUpperCase() ?? null;
  const refs = candidateEvidenceRefs(candidate, fallbackRefs);
  const [state, setState] = useState<LoadState>({ status: 'loading', subjectSheet: null, targetSheet: null, error: null });
  const [projectMode, setProjectMode] = useState<'new' | 'existing'>('new');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const activeBrief = activeBriefId ? briefs.find((brief) => brief.id === activeBriefId) ?? null : null;

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', subjectSheet: null, targetSheet: null, error: null });
    Promise.all([
      getCurrentNbaCapSheet(subjectTeamId),
      targetTeamId ? getCurrentNbaCapSheet(targetTeamId) : Promise.resolve({ cap_sheet: null }),
    ])
      .then(([subject, target]) => {
        if (!cancelled) {
          setState({
            status: 'ready',
            subjectSheet: subject.cap_sheet,
            targetSheet: target.cap_sheet,
            error: null,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: 'error',
            subjectSheet: null,
            targetSheet: null,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [subjectTeamId, targetTeamId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!projectsLoaded) void loadProjects();
  }, [loadProjects, projectsLoaded]);

  const scenario = useMemo(
    () => buildCandidateScenario(candidate, {
      subjectTeamId,
      subjectSheet: state.subjectSheet,
      targetSheet: state.targetSheet,
    }),
    [candidate, state.subjectSheet, state.targetSheet, subjectTeamId],
  );
  const seed = useMemo(
    () => buildCandidateProjectScenarioSeed(option, details, candidate, refs, {
      subjectTeamId,
      subjectSheet: state.subjectSheet,
      targetSheet: state.targetSheet,
      allowOutgoingPackageFallback: false,
    }),
    [candidate, details, option, refs, state.subjectSheet, state.targetSheet, subjectTeamId],
  );
  const defaultProjectTitle = useMemo(() => {
    const target = scenario.target_label || candidate.label || option.title;
    return `${target} trade scenario`.slice(0, 120);
  }, [candidate.label, option.title, scenario.target_label]);

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) setSelectedProjectId(projects[0].id);
  }, [projects, selectedProjectId]);

  const createInProject = async () => {
    if (busy || state.status === 'loading') return;
    setBusy(true);
    setActionError(null);
    try {
      let project: ProjectDetail | null = null;
      if (projectMode === 'new') {
        project = await createProject({
          title: defaultProjectTitle,
          question: activeBrief?.question ?? details.decision_question,
          objective: `Convert named candidate moves from option [${option.ref_index}] into trade scenarios for cap, CBA, basketball, and phone-framing validation.`,
          workflow_type: 'inbound_trade',
          subject_team_id: seed.model.subject_team_id,
          counterparty_team_id: seed.model.target_team_id,
          trigger_summary: `Option [${option.ref_index}]: ${option.title}`,
          source_brief_id: activeBriefId ?? null,
        });
      } else {
        if (!selectedProjectId) throw new Error('Choose a project first.');
        if (activeBriefId) {
          const attached = await attachBrief(selectedProjectId, activeBriefId);
          project = attached?.project ?? null;
        } else {
          project = await loadProject(selectedProjectId);
        }
      }
      if (!project) throw new Error('Project could not be loaded.');

      const createdDetail = await createScenario(project.project.id, seed.create);
      const createdScenario = latestScenario(createdDetail, seed.create.title);
      if (!createdScenario) throw new Error('Scenario was created but could not be focused.');
      await updateScenario(project.project.id, createdScenario.id, seed.update);
      for (const player of seed.players) {
        await createScenarioPlayer(project.project.id, createdScenario.id, player);
      }
      await validateScenario(project.project.id, createdScenario.id);
      setActiveProject(project.project.id);
      setActiveScenario(createdScenario.id);
      setActiveNav('projects');
      onClose();
      pushToast({
        tone: 'success',
        message: 'Scenario created',
        detail: seed.create.title,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create scenario.';
      setActionError(message);
      pushToast({ tone: 'error', message: 'Couldn’t create scenario', detail: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={backdropStyle} onMouseDown={onClose} role="presentation">
      <div
        style={modalStyle}
        role="dialog"
        aria-modal="true"
        aria-label={`Trade scenario detail for ${scenario.target_label}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={modalHeaderStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={eyebrowStyle}>Candidate scenario</div>
            <div style={titleStyle}>{scenario.target_label}</div>
            {scenario.construction && <div style={subtitleStyle}>{scenario.construction}</div>}
          </div>
          <div style={headerActionsStyle}>
            <div style={evidenceRailStyle}>
              {refs.map((ref) => (
                <button key={ref} onClick={() => onOpenEvidence(ref)} style={evidenceChipStyle}>
                  [{ref}]
                </button>
              ))}
            </div>
            <button onClick={onClose} style={closeButtonStyle}>Close</button>
          </div>
        </div>

        {state.status === 'loading' && <div style={loadingStyle}>Loading cap sheets...</div>}
        {state.status === 'error' && <div style={errorStyle}>{state.error}</div>}

        <div style={teamGridStyle}>
          <TeamImpactPanel impact={scenario.subject} />
          <TeamImpactPanel impact={scenario.target} />
        </div>

        <div style={mechanicsGridStyle}>
          <MechanicsBlock title="Salary / CBA" body={candidate.salary_match} />
          <MechanicsBlock title="Likely cost" body={candidate.cost} />
          <MechanicsBlock title="Constraint" body={candidate.constraints} />
        </div>

        <div style={projectActionStyle}>
          <div style={modeToggleStyle}>
            <button
              type="button"
              aria-pressed={projectMode === 'new'}
              onClick={() => setProjectMode('new')}
              style={modeButtonStyle(projectMode === 'new')}
            >
              New project
            </button>
            <button
              type="button"
              aria-pressed={projectMode === 'existing'}
              onClick={() => setProjectMode('existing')}
              style={modeButtonStyle(projectMode === 'existing')}
            >
              Existing project
            </button>
          </div>
          {projectMode === 'existing' && (
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              style={selectStyle}
              disabled={!projectsLoaded || projects.length === 0}
            >
              {projects.length === 0 && <option value="">No projects yet</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.title}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => void createInProject()}
            disabled={busy || state.status === 'loading' || (projectMode === 'existing' && !selectedProjectId)}
            style={primaryActionStyle(busy || state.status === 'loading' || (projectMode === 'existing' && !selectedProjectId))}
          >
            {busy ? 'Creating...' : projectMode === 'existing' ? 'Add scenario' : 'Create scenario'}
          </button>
        </div>
        {actionError && <div style={actionErrorStyle}>{actionError}</div>}
      </div>
    </div>
  );
}

function latestScenario(project: ProjectDetail | null, title: string) {
  return project?.scenarios
    .filter((scenario) => scenario.title === title)
    .sort((a, b) => b.rank - a.rank || b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

function TeamImpactPanel({
  impact,
}: {
  impact: CandidateScenarioTeamImpact;
}) {
  return (
    <section style={teamPanelStyle}>
      <div style={teamPanelHeaderStyle}>
        <div>
          <div style={eyebrowStyle}>{impact.team_id}</div>
          <div style={teamNameStyle}>{impact.team_name}</div>
        </div>
        <div style={netDeltaStyle(impact.net_salary_delta)}>
          {formatSignedMoney(impact.net_salary_delta)}
        </div>
      </div>
      <div style={movementGridStyle}>
        <PlayerList title="Sends" players={impact.sends} empty="No named player resolved." />
        <PlayerList title="Receives" players={impact.receives} empty="No named player resolved." />
      </div>
      <div style={payrollGridStyle}>
        <Metric label="Known out" value={formatMoney(impact.known_salary_out)} />
        <Metric label="Known in" value={formatMoney(impact.known_salary_in)} />
        <Metric label="Payroll before" value={formatMoney(impact.payroll_before)} />
        <Metric label="Payroll after" value={formatMoney(impact.payroll_after)} strong />
      </div>
      <div style={thresholdGridStyle}>
        {impact.thresholds.map((threshold) => (
          <div key={threshold.key} style={thresholdRowStyle}>
            <span>{threshold.label}</span>
            <span>{formatDistance(threshold.after_distance)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlayerList({ title, players, empty }: { title: string; players: CandidateScenarioPlayer[]; empty: string }) {
  return (
    <div>
      <div style={eyebrowStyle}>{title}</div>
      <div style={playerListStyle}>
        {players.length ? players.map((player) => (
          <div key={`${player.team_id}:${player.name}`} style={playerRowStyle}>
            <span>{player.name}</span>
            <span>{player.salary_label}</span>
          </div>
        )) : <div style={emptyStyle}>{empty}</div>}
      </div>
    </div>
  );
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={metricStyle}>
      <span>{label}</span>
      <strong style={{ color: strong ? F.ink : F.inkSoft }}>{value}</strong>
    </div>
  );
}

function MechanicsBlock({ title, body }: { title: string; body?: string | null }) {
  return (
    <div style={mechanicsBlockStyle}>
      <div style={eyebrowStyle}>{title}</div>
      <div style={mechanicsBodyStyle}>{body?.trim() || 'Source needed'}</div>
    </div>
  );
}

function candidateEvidenceRefs(candidate: BriefOptionMoveCandidate, fallback: number[]): number[] {
  const refs = (candidate.evidence_refs ?? [])
    .map((ref) => Number(ref))
    .filter((ref) => Number.isInteger(ref) && ref > 0);
  return [...new Set(refs.length ? refs : fallback)].sort((a, b) => a - b);
}

function formatMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Source needed';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function formatSignedMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '$0.0M';
  return `${value > 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;
}

function formatDistance(value: number | null): string {
  if (value == null) return 'Source needed';
  if (value === 0) return 'At line';
  return `${formatMoney(Math.abs(value))} ${value > 0 ? 'below' : 'over'}`;
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  background: 'rgba(28, 31, 34, 0.28)',
  backdropFilter: 'blur(2px)',
  display: 'grid',
  placeItems: 'center',
  padding: SPACE.lg,
  boxSizing: 'border-box',
};

const modalStyle: CSSProperties = {
  width: 'min(980px, calc(100vw - 48px))',
  maxHeight: 'min(780px, calc(100vh - 48px))',
  overflow: 'auto',
  background: F.surface,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.lg,
  boxShadow: F.shadowChat,
  padding: SPACE.lg,
  display: 'grid',
  gap: SPACE.md,
  boxSizing: 'border-box',
};

const modalHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: SPACE.md,
  borderBottom: `1px solid ${F.border}`,
  paddingBottom: SPACE.md,
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: TYPE.display.md,
  lineHeight: 1.2,
  color: F.ink,
  fontWeight: 650,
};

const subtitleStyle: CSSProperties = {
  marginTop: SPACE.xs,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.38,
  color: F.inkSoft,
};

const eyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 700,
  color: F.fgMuted,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const headerActionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.sm,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
};

const evidenceRailStyle: CSSProperties = {
  display: 'flex',
  gap: SPACE.xs,
  flexWrap: 'wrap',
};

const evidenceChipStyle: CSSProperties = {
  padding: `2px ${SPACE.sm}px`,
  background: F.fenwaySoft,
  color: F.fenway,
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.pill,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 700,
  cursor: 'pointer',
};

const closeButtonStyle: CSSProperties = {
  padding: `${SPACE.xs + 2}px ${SPACE.md}px`,
  background: F.surface,
  color: F.ink,
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 600,
  cursor: 'pointer',
};

const loadingStyle: CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
};

const errorStyle: CSSProperties = {
  color: F.red,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
};

const teamGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: SPACE.md,
};

const teamPanelStyle: CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  padding: SPACE.md,
  display: 'grid',
  gap: SPACE.md,
  minWidth: 0,
};

const teamPanelHeaderStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: SPACE.md,
  alignItems: 'flex-start',
};

const teamNameStyle: CSSProperties = {
  marginTop: 2,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  fontWeight: 650,
  color: F.ink,
};

function netDeltaStyle(value: number): CSSProperties {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: TYPE.body.md,
    fontWeight: 700,
    color: value > 0 ? F.red : value < 0 ? F.positive : F.inkSoft,
    whiteSpace: 'nowrap',
  };
}

const movementGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: SPACE.md,
};

const playerListStyle: CSSProperties = {
  display: 'grid',
  gap: SPACE.xs,
  marginTop: SPACE.xs,
};

const playerRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: SPACE.sm,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
  lineHeight: 1.3,
};

const emptyStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.fgMuted,
  lineHeight: 1.35,
};

const payrollGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: SPACE.sm,
};

const metricStyle: CSSProperties = {
  display: 'grid',
  gap: 2,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.fgMuted,
};

const thresholdGridStyle: CSSProperties = {
  display: 'grid',
  gap: SPACE.xs,
  borderTop: `1px solid ${F.border}`,
  paddingTop: SPACE.sm,
};

const thresholdRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: SPACE.sm,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
};

const mechanicsGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: SPACE.md,
};

const mechanicsBlockStyle: CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  paddingTop: SPACE.sm,
  display: 'grid',
  gap: SPACE.xs,
};

const mechanicsBodyStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
  lineHeight: 1.38,
};

const projectActionStyle: CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  paddingTop: SPACE.md,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: SPACE.sm,
  flexWrap: 'wrap',
};

const modeToggleStyle: CSSProperties = {
  display: 'inline-flex',
  width: 'fit-content',
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  overflow: 'hidden',
};

function modeButtonStyle(active: boolean): CSSProperties {
  return {
    padding: `${SPACE.xs + 2}px ${SPACE.md}px`,
    border: 'none',
    borderRight: `1px solid ${F.border}`,
    background: active ? F.fenway : F.surface,
    color: active ? '#fff' : F.inkSoft,
    fontFamily: 'var(--font-sans)',
    fontSize: TYPE.body.sm,
    fontWeight: 650,
    cursor: 'pointer',
    minHeight: 38,
  };
}

const selectStyle: CSSProperties = {
  minWidth: 260,
  maxWidth: 'min(420px, 100%)',
  boxSizing: 'border-box',
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  outline: 'none',
};

const actionErrorStyle: CSSProperties = {
  marginTop: -SPACE.xs,
  color: F.red,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.3,
};

function primaryActionStyle(disabled: boolean): CSSProperties {
  return {
    padding: `${SPACE.sm}px ${SPACE.lg}px`,
    background: F.fenway,
    color: '#fff',
    border: `1px solid ${F.fenway}`,
    borderRadius: RADIUS.md,
    fontFamily: 'var(--font-sans)',
    fontSize: TYPE.body.sm,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  };
}
