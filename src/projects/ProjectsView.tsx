import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Dispatch, ReactNode, RefObject, SetStateAction } from 'react';
import {
  PROJECT_STEP_DEFINITIONS,
  type NbaCapSheet,
  type NbaCapSheetPlayerRow,
  type NbaCapSheetSourceStatus,
  type ProjectCounterpartyContext,
  type ProjectDetail,
  type ProjectPackageStatus,
  type ProjectScenarioPlayer,
  type ProjectScenarioPlayerDirection,
  type ProjectScenarioValidation,
  type ProjectScenarioValidationKind,
  type ProjectScenarioValidationStatus,
  type ProjectStepId,
  type ProjectTradeScenarioDetail,
  type ProjectTradeScenarioStatus,
} from '@shared/types';
import { Icon } from '../ds/Icon';
import { getCurrentNbaCapSheet, getCurrentNbaCapSheets } from '../api/nba';
import { useProjects } from '../store';
import { F } from '../theme/fenway';

interface ProjectsViewProps {
  onJumpToBrief: (briefId: string, sessionId?: string) => void;
}

const STAGE_INDEX = Object.fromEntries(
  PROJECT_STEP_DEFINITIONS.map((step, index) => [step.id, index]),
) as Record<ProjectStepId, number>;

const VALIDATION_STATUSES: ProjectScenarioValidationStatus[] = ['manual_pending', 'pass', 'warning', 'fail', 'source_needed', 'not_run'];
const SCENARIO_STATUSES: ProjectTradeScenarioStatus[] = ['active', 'shortlisted', 'presented', 'terms_agreed', 'archived', 'collapsed'];
type DossierSectionId = 'snapshot' | 'deal' | 'validation' | 'basketball' | 'call' | 'evidence';
type StatusTone = 'neutral' | 'good' | 'warn' | 'bad';

export function ProjectsView({ onJumpToBrief }: ProjectsViewProps) {
  const {
    projects,
    projectsLoaded,
    activeProjectId,
    activeScenarioId,
    activeProjectDetail,
    activeProjectLoading,
    projectDiagnosis,
    setActiveProject,
    setActiveScenario,
    loadProjects,
    loadProject,
    createProject,
    updateProject,
    advanceProject,
    diagnoseProject,
    generatePackage,
    createScenario,
    updateScenario,
    duplicateScenario,
    createScenarioPlayer,
    deleteScenarioPlayer,
    createScenarioAsset,
    deleteScenarioAsset,
    updateScenarioValidation,
    validateScenario,
    createArtifact,
  } = useProjects();

  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(projects.length === 0);
  const [newTitle, setNewTitle] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newObjective, setNewObjective] = useState('');
  const [newCounterparty, setNewCounterparty] = useState('');
  const [newTrigger, setNewTrigger] = useState('');
  const [editingProject, setEditingProject] = useState(false);
  const [editingDossierSection, setEditingDossierSection] = useState<DossierSectionId | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [dossierMenuOpen, setDossierMenuOpen] = useState(false);
  const [newScenarioOpen, setNewScenarioOpen] = useState(false);
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(emptyProjectDraft());
  const [scenarioDraft, setScenarioDraft] = useState<ScenarioDraft>(emptyScenarioDraft());
  const [newScenarioTitle, setNewScenarioTitle] = useState('');
  const [playerDirection, setPlayerDirection] = useState<ProjectScenarioPlayerDirection>('outgoing');
  const [selectedPlayerKey, setSelectedPlayerKey] = useState('');
  const [assetDraft, setAssetDraft] = useState<AssetDraft>({ label: '', asset_type: 'pick', direction: 'outgoing' });
  const [artifactDraft, setArtifactDraft] = useState<ArtifactDraft>({ title: '', artifact_type: 'trade_builder_report', url: '' });
  const [tradeBuilderDraft, setTradeBuilderDraft] = useState<ValidationDraft>({ status: 'manual_pending', summary: '' });
  const [capSheetDraft, setCapSheetDraft] = useState<ValidationDraft>({ status: 'manual_pending', summary: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inlineStatus, setInlineStatus] = useState<string | null>(null);
  const [teamOptions, setTeamOptions] = useState<{ team_id: string; label: string }[]>([]);
  const [subjectCapSheet, setSubjectCapSheet] = useState<NbaCapSheet | null>(null);
  const [counterpartyCapSheet, setCounterpartyCapSheet] = useState<NbaCapSheet | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);

  useMenuDismiss(projectMenuOpen, setProjectMenuOpen, projectMenuRef);

  useEffect(() => {
    if (!projectsLoaded) void loadProjects();
  }, [loadProjects, projectsLoaded]);

  useEffect(() => {
    if (!projectsLoaded) return;
    const targetId = activeProjectId ?? projects[0]?.id ?? null;
    if (targetId && activeProjectDetail?.project.id !== targetId && !activeProjectLoading) {
      void loadProject(targetId);
    }
  }, [activeProjectDetail?.project.id, activeProjectId, activeProjectLoading, loadProject, projects, projectsLoaded]);

  useEffect(() => {
    getCurrentNbaCapSheets()
      .then((res) => {
        setTeamOptions(res.teams.map((team) => ({
          team_id: team.team.abbreviation,
          label: `${team.team.abbreviation} - ${team.team.full_name}`,
        })));
      })
      .catch((err) => console.warn('[projects] cap sheet summaries failed', err));
  }, []);

  const detail = activeProjectDetail;
  const project = detail?.project ?? null;
  const activeScenario = useMemo(() => {
    if (!detail) return null;
    return detail.scenarios.find((scenario) => scenario.id === activeScenarioId)
      ?? detail.scenarios.find((scenario) => scenario.status !== 'archived')
      ?? detail.scenarios[0]
      ?? null;
  }, [activeScenarioId, detail]);

  useEffect(() => {
    if (!detail) return;
    const first = detail.scenarios.find((scenario) => scenario.status !== 'archived') ?? detail.scenarios[0] ?? null;
    if (!activeScenarioId || !detail.scenarios.some((scenario) => scenario.id === activeScenarioId)) {
      setActiveScenario(first?.id ?? null);
    }
  }, [activeScenarioId, detail, setActiveScenario]);

  useEffect(() => {
    if (!project) return;
    setProjectDraft({
      title: project.title,
      question: project.question,
      objective: project.objective,
      counterparty_team_id: project.counterparty_team_id ?? '',
      inbound_player_id: project.inbound_player_id ? String(project.inbound_player_id) : '',
      trigger_summary: project.trigger_summary,
      counterparty_context: { ...project.counterparty_context },
    });
    setEditingProject(false);
  }, [project?.id, project?.updated_at]);

  useEffect(() => {
    setProjectMenuOpen(false);
    setDossierMenuOpen(false);
    setDiagnosisOpen(false);
    setReportOpen(false);
    setNewScenarioOpen(false);
  }, [project?.id]);

  useEffect(() => {
    if (!activeScenario) {
      setScenarioDraft(emptyScenarioDraft());
      return;
    }
    setScenarioDraft({
      title: activeScenario.title,
      summary: activeScenario.summary,
      status: activeScenario.status,
      rank: String(activeScenario.rank || 1),
      notes: activeScenario.notes,
      basketball_fit: activeScenario.basketball_fit,
      risks: activeScenario.risks,
      phone_framing: activeScenario.phone_framing,
      walk_away: activeScenario.walk_away,
      counter_range: activeScenario.counter_range,
    });
    setTradeBuilderDraft(validationToDraft(latestValidation(activeScenario, 'trade_builder')));
    setCapSheetDraft(validationToDraft(latestValidation(activeScenario, 'internal_cap_sheet')));
    setEditingDossierSection(null);
  }, [activeScenario?.id, activeScenario?.updated_at, activeScenario?.status, activeScenario?.title]);

  useEffect(() => {
    if (!project) return;
    void loadCapSheet(project.subject_team_id, setSubjectCapSheet);
    if (project.counterparty_team_id) void loadCapSheet(project.counterparty_team_id, setCounterpartyCapSheet);
    else setCounterpartyCapSheet(null);
  }, [project?.subject_team_id, project?.counterparty_team_id]);

  const playerRows = useMemo(() => {
    const subjectRows = (subjectCapSheet?.player_rows ?? []).map((row) => ({ key: `outgoing:${row.id}`, direction: 'outgoing' as const, teamId: project?.subject_team_id ?? 'GSW', row }));
    const counterpartyRows = (counterpartyCapSheet?.player_rows ?? []).map((row) => ({ key: `incoming:${row.id}`, direction: 'incoming' as const, teamId: project?.counterparty_team_id ?? '', row }));
    return [...subjectRows, ...counterpartyRows];
  }, [counterpartyCapSheet?.player_rows, project?.counterparty_team_id, project?.subject_team_id, subjectCapSheet?.player_rows]);

  const filteredProjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((item) => (
      item.title.toLowerCase().includes(needle)
      || item.question.toLowerCase().includes(needle)
      || item.objective.toLowerCase().includes(needle)
      || (item.counterparty_team_id ?? '').toLowerCase().includes(needle)
    ));
  }, [projects, query]);

  const onCreateBlank = async () => {
    if (busy || !newTitle.trim() || !newQuestion.trim() || !newObjective.trim()) return;
    await run('create', async () => {
      await createProject({
        title: newTitle.trim(),
        question: newQuestion.trim(),
        objective: newObjective.trim(),
        workflow_type: 'inbound_trade',
        subject_team_id: 'GSW',
        counterparty_team_id: newCounterparty.trim() || null,
        trigger_summary: newTrigger.trim() || newQuestion.trim(),
      });
      setNewTitle('');
      setNewQuestion('');
      setNewObjective('');
      setNewCounterparty('');
      setNewTrigger('');
      setCreateOpen(false);
    });
  };

  const onSelectProject = (projectId: string) => {
    setActiveProject(projectId);
    void loadProject(projectId);
  };

  const onSaveProject = async () => {
    if (!project || !projectDraft.title.trim() || !projectDraft.question.trim()) return;
    await run('project', async () => {
      await updateProject(project.id, {
        title: projectDraft.title.trim(),
        question: projectDraft.question.trim(),
        objective: projectDraft.objective.trim(),
        counterparty_team_id: projectDraft.counterparty_team_id.trim() || null,
        inbound_player_id: projectDraft.inbound_player_id ? Number(projectDraft.inbound_player_id) : null,
        trigger_summary: projectDraft.trigger_summary.trim(),
        counterparty_context: projectDraft.counterparty_context,
      });
      setEditingProject(false);
    });
  };

  const onAdvanceStage = async (step: ProjectStepId) => {
    if (!project) return;
    await run('stage', async () => {
      await advanceProject(project.id, step);
    });
  };

  const onCreateScenario = async () => {
    if (!project || !newScenarioTitle.trim()) return;
    await run('scenario-create', async () => {
      const updated = await createScenario(project.id, {
        title: newScenarioTitle.trim(),
        participating_teams: [project.subject_team_id, project.counterparty_team_id ?? ''].filter(Boolean),
      });
      const created = updated?.scenarios.slice().sort((a, b) => b.rank - a.rank)[0];
      setActiveScenario(created?.id ?? null);
      setNewScenarioTitle('');
      setNewScenarioOpen(false);
    });
  };

  const onSaveScenario = async () => {
    if (!project || !activeScenario || !scenarioDraft.title.trim()) return;
    await run('scenario-save', async () => {
      await updateScenario(project.id, activeScenario.id, {
        title: scenarioDraft.title.trim(),
        summary: scenarioDraft.summary.trim(),
        status: scenarioDraft.status,
        rank: Number(scenarioDraft.rank) || activeScenario.rank,
        notes: scenarioDraft.notes.trim(),
        basketball_fit: scenarioDraft.basketball_fit.trim(),
        risks: scenarioDraft.risks.trim(),
        phone_framing: scenarioDraft.phone_framing.trim(),
        walk_away: scenarioDraft.walk_away.trim(),
        counter_range: scenarioDraft.counter_range.trim(),
      });
    });
  };

  const onDuplicateScenario = async () => {
    if (!project || !activeScenario) return;
    await run('scenario-duplicate', async () => {
      const updated = await duplicateScenario(project.id, activeScenario.id);
      const copied = updated?.scenarios.slice().sort((a, b) => b.rank - a.rank)[0];
      setActiveScenario(copied?.id ?? null);
    });
  };

  const onArchiveScenario = async () => {
    if (!project || !activeScenario) return;
    await run('scenario-archive', async () => {
      await updateScenario(project.id, activeScenario.id, { status: 'archived' });
    });
  };

  const onAddPlayer = async () => {
    if (!project || !activeScenario || !selectedPlayerKey) return;
    const selected = playerRows.find((item) => item.key === selectedPlayerKey);
    if (!selected) return;
    const salary = salaryForRow(selected.row);
    await run('player-add', async () => {
      await createScenarioPlayer(project.id, activeScenario.id, {
        team_id: selected.teamId,
        nba_player_id: selected.row.nba_player_id,
        player_name: selected.row.player_name,
        direction: selected.direction,
        salary_amount: salary.amount,
        salary_source_status: salary.source,
        stats_snapshot: selected.row.stats ?? null,
      });
      setSelectedPlayerKey('');
      setPlayerDirection('outgoing');
    });
  };

  const onAddAsset = async () => {
    if (!project || !activeScenario || !assetDraft.label.trim()) return;
    await run('asset-add', async () => {
      await createScenarioAsset(project.id, activeScenario.id, {
        asset_type: assetDraft.asset_type as 'pick',
        label: assetDraft.label.trim(),
        direction: assetDraft.direction,
        team_id: assetDraft.direction === 'outgoing' ? project.subject_team_id : project.counterparty_team_id,
      });
      setAssetDraft({ label: '', asset_type: 'pick', direction: 'outgoing' });
    });
  };

  const onValidateScenario = async () => {
    if (!project || !activeScenario) return;
    await run('validate', async () => {
      await validateScenario(project.id, activeScenario.id);
    });
  };

  const onSaveManualValidation = async (kind: ProjectScenarioValidationKind, draft: ValidationDraft) => {
    if (!project || !activeScenario) return;
    await run(kind, async () => {
      await updateScenarioValidation(project.id, activeScenario.id, kind, {
        status: draft.status,
        summary: draft.summary.trim(),
      });
    });
  };

  const onAddArtifact = async () => {
    if (!project || !artifactDraft.title.trim()) return;
    await run('artifact', async () => {
      await createArtifact(project.id, {
        scenario_id: activeScenario?.id ?? null,
        artifact_type: artifactDraft.artifact_type as 'trade_builder_report',
        title: artifactDraft.title.trim(),
        url: artifactDraft.url.trim() || null,
      });
      setArtifactDraft({ title: '', artifact_type: 'trade_builder_report', url: '' });
    });
  };

  const onGeneratePackage = async () => {
    if (!project) return;
    await run('package', async () => {
      await generatePackage(project.id);
      setInlineStatus('Scenario library report refreshed.');
      setReportOpen(true);
    });
  };

  const onCopyPackage = async () => {
    const markdown = detail?.latest_package?.markdown;
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setInlineStatus('Markdown copied.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clipboard unavailable.');
    }
  };

  const onExportPackage = () => {
    const markdown = detail?.latest_package?.markdown;
    if (!markdown || !project) return;
    const fileName = `${project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'scenario-library'}.md`;
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError(null);
    setInlineStatus(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Server error.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={shellStyle}>
      <aside style={railStyle}>
        <div style={railHeaderStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <div style={capsStyle}>Projects</div>
              <div style={{ fontSize: 18, fontWeight: 650, color: F.ink, marginTop: 2 }}>Trade scenarios</div>
            </div>
            <IconButton title="New project" onClick={() => setCreateOpen((open) => !open)}>
              <Icon name="plus" size={15} />
            </IconButton>
          </div>
          <div style={{ position: 'relative', marginTop: 12 }}>
            <span style={{ position: 'absolute', top: 8, left: 9, color: F.fgMuted }}>
              <Icon name="search" size={13} />
            </span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" style={{ ...inputStyle, height: 30, paddingLeft: 30 }} />
          </div>
        </div>

        {createOpen && (
          <div style={createBoxStyle}>
            <TextInput value={newTitle} onChange={setNewTitle} placeholder="Inbound call: Boston asks on Moody" />
            <TextInput value={newQuestion} onChange={setNewQuestion} placeholder="Decision question" />
            <TextInput value={newCounterparty} onChange={setNewCounterparty} placeholder="Counterparty team (BOS)" />
            <TextInput value={newTrigger} onChange={setNewTrigger} placeholder="Trigger summary" />
            <textarea value={newObjective} onChange={(event) => setNewObjective(event.target.value)} placeholder="Objective" rows={3} style={{ ...textareaStyle, marginTop: 8, minHeight: 70 }} />
            <button onClick={() => void onCreateBlank()} disabled={busy === 'create' || !newTitle.trim() || !newQuestion.trim() || !newObjective.trim()} style={primaryButtonStyle(busy === 'create' || !newTitle.trim() || !newQuestion.trim() || !newObjective.trim())}>
              Create
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {!projectsLoaded && <RailEmpty label="Loading projects" />}
          {projectsLoaded && filteredProjects.length === 0 && <RailEmpty label="No project rows" />}
          {filteredProjects.map((item) => {
            const active = item.id === activeProjectId;
            const packageMeta = compactPackageStatus(item.package_status);
            return (
              <button key={item.id} onClick={() => onSelectProject(item.id)} style={projectRailButtonStyle(active)}>
                <div style={railTitleStyle}>{item.title}</div>
                <div style={railMetaLineStyle}>
                  {item.counterparty_team_id || 'TBD'} call · {stepLabel(item.active_step)}
                  {packageMeta ? ` · ${packageMeta}` : ''}
                </div>
                <div style={railBodyStyle}>{item.trigger_summary || item.objective || item.question}</div>
                <div style={railCountStyle}>
                  <span>{item.scenario_count} scenarios</span>
                  <span>{item.shortlisted_scenario_count} shortlisted</span>
                  <span>{item.linked_brief_count} sources</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <main style={{ minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        {!detail && (
          <div style={centeredStyle}>
            {activeProjectLoading ? 'Loading project' : 'Create or select a project'}
          </div>
        )}

        {detail && project && (
          <div style={workspaceStyle}>
            <header style={headerStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 16, alignItems: 'start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={headerMetaStyle}>
                    <span>Inbound trade library</span>
                    {compactPackageStatus(project.package_status) && <span>{compactPackageStatus(project.package_status)}</span>}
                  </div>
                  {editingProject ? (
                    <ProjectEditor
                      draft={projectDraft}
                      setDraft={setProjectDraft}
                      teamOptions={teamOptions}
                      subjectCapSheet={subjectCapSheet}
                      busy={busy === 'project'}
                      onCancel={() => {
                        setProjectDraft(projectToDraft(project));
                        setEditingProject(false);
                      }}
                      onSave={() => void onSaveProject()}
                    />
                  ) : (
                    <>
                      <h1 style={titleStyle}>{project.title}</h1>
                      <div style={subheadStyle}>{project.trigger_summary || project.question}</div>
                      <div style={contextGridStyle}>
                        <Metric label="Subject" value={project.subject_team_id} />
                        <Metric label="Counterparty" value={project.counterparty_team_id || 'TBD'} />
                        <Metric label="Inbound player" value={playerNameById(subjectCapSheet, project.inbound_player_id) || 'TBD'} />
                        <Metric label="Status" value={project.status} />
                      </div>
                    </>
                  )}
                </div>
                <div style={headerControlsStyle}>
                  <StageControl activeStep={project.active_step} busy={busy === 'stage'} onAdvance={(step) => void onAdvanceStage(step)} />
                  <div ref={projectMenuRef} style={{ position: 'relative' }}>
                    <IconButton title="Project actions" onClick={() => setProjectMenuOpen((open) => !open)}>
                      <Icon name="more-horizontal" size={15} />
                    </IconButton>
                    {projectMenuOpen && (
                      <ActionMenu align="right">
                        <MenuItem icon="edit" disabled={editingProject} onClick={() => {
                          setEditingProject(true);
                          setProjectMenuOpen(false);
                        }}>Edit project</MenuItem>
                        <MenuItem icon="spark" disabled={busy === 'diagnose'} onClick={() => {
                          setProjectMenuOpen(false);
                          setDiagnosisOpen(true);
                          void run('diagnose', async () => { await diagnoseProject(project.id); });
                        }}>Diagnose</MenuItem>
                        <MenuItem icon="refresh" disabled={busy === 'package'} onClick={() => {
                          setProjectMenuOpen(false);
                          void onGeneratePackage();
                        }}>Generate report</MenuItem>
                        <MenuItem icon="clipboard" disabled={!detail.latest_package?.markdown} onClick={() => {
                          setProjectMenuOpen(false);
                          void onCopyPackage();
                        }}>Copy Markdown</MenuItem>
                        <MenuItem icon="file-down" disabled={!detail.latest_package?.markdown} onClick={() => {
                          setProjectMenuOpen(false);
                          onExportPackage();
                        }}>Export Markdown</MenuItem>
                      </ActionMenu>
                    )}
                  </div>
                </div>
              </div>
              {(error || inlineStatus) && (
                <div style={error ? errorStyle : statusStyle}>{error ?? inlineStatus}</div>
              )}
            </header>

            <section style={bodyGridStyle}>
              <div style={{ minHeight: 0, overflowY: 'auto', padding: 16 }}>
                <Panel title="Inbound context">
                  <div style={contextRowsStyle}>
                    <ContextCell label="Apron / cap posture" value={[project.counterparty_context.apron_level, project.counterparty_context.cap_room].filter(Boolean).join(' · ') || 'TBD'} />
                    <ContextCell label="Aims" value={project.counterparty_context.aims || 'TBD'} />
                    <ContextCell label="Pressure" value={project.counterparty_context.pressure || 'TBD'} />
                    <ContextCell label="Job security" value={project.counterparty_context.job_security || 'TBD'} />
                    <ContextCell label="Known targets" value={project.counterparty_context.known_targets || 'TBD'} />
                    <ContextCell label="Signals" value={project.counterparty_context.signals || 'TBD'} />
                  </div>
                </Panel>

                <Panel
                  title="Scenario library"
                  action={(
                    <SecondaryButton icon="plus" onClick={() => setNewScenarioOpen((open) => !open)}>
                      Scenario
                    </SecondaryButton>
                  )}
                >
                  {newScenarioOpen && (
                    <div style={inlineCreateRowStyle}>
                      <input
                        value={newScenarioTitle}
                        onChange={(event) => setNewScenarioTitle(event.target.value)}
                        placeholder="Scenario title"
                        style={{ ...inputStyle, height: 30 }}
                        autoFocus
                      />
                      <SecondaryButton icon="plus" disabled={busy === 'scenario-create' || !newScenarioTitle.trim()} onClick={() => void onCreateScenario()}>Add</SecondaryButton>
                    </div>
                  )}
                  <ScenarioTable
                    scenarios={detail.scenarios}
                    selectedScenarioId={activeScenario?.id ?? null}
                    onSelect={setActiveScenario}
                  />
                </Panel>
              </div>

              <aside style={inspectorStyle}>
                {!activeScenario && (
                  <div style={mutedLineStyle}>No scenarios yet.</div>
                )}
                {activeScenario && (
                  <>
                    <ScenarioDossier
                      scenario={activeScenario}
                      draft={scenarioDraft}
                      setDraft={setScenarioDraft}
                      editingSection={editingDossierSection}
                      setEditingSection={setEditingDossierSection}
                      playerRows={playerRows}
                      playerDirection={playerDirection}
                      setPlayerDirection={setPlayerDirection}
                      selectedPlayerKey={selectedPlayerKey}
                      setSelectedPlayerKey={setSelectedPlayerKey}
                      assetDraft={assetDraft}
                      setAssetDraft={setAssetDraft}
                      artifactDraft={artifactDraft}
                      setArtifactDraft={setArtifactDraft}
                      artifacts={detail.artifacts}
                      sourceBriefs={detail.source_briefs}
                      tradeBuilderDraft={tradeBuilderDraft}
                      setTradeBuilderDraft={setTradeBuilderDraft}
                      capSheetDraft={capSheetDraft}
                      setCapSheetDraft={setCapSheetDraft}
                      menuOpen={dossierMenuOpen}
                      setMenuOpen={setDossierMenuOpen}
                      busy={busy}
                      onSaveScenario={() => void onSaveScenario()}
                      onDuplicateScenario={() => void onDuplicateScenario()}
                      onArchiveScenario={() => void onArchiveScenario()}
                      onAddPlayer={() => void onAddPlayer()}
                      onDeletePlayer={(playerId) => project && void run('player-delete', async () => { await deleteScenarioPlayer(project.id, activeScenario.id, playerId); })}
                      onAddAsset={() => void onAddAsset()}
                      onDeleteAsset={(assetId) => project && void run('asset-delete', async () => { await deleteScenarioAsset(project.id, activeScenario.id, assetId); })}
                      onValidateScenario={() => void onValidateScenario()}
                      onSaveManualValidation={onSaveManualValidation}
                      onAddArtifact={() => void onAddArtifact()}
                      onJumpToBrief={onJumpToBrief}
                    />

                    <CollapsiblePanel
                      title="Diagnosis"
                      open={diagnosisOpen}
                      onToggle={() => setDiagnosisOpen((open) => !open)}
                      meta={projectDiagnosis ? readinessLabel(projectDiagnosis.readiness) : 'Not run'}
                    >
                      {projectDiagnosis ? (
                        <div style={{ display: 'grid', gap: 8 }}>
                          <StatusText label={readinessLabel(projectDiagnosis.readiness)} tone={readinessTone(projectDiagnosis.readiness)} />
                          <div style={{ fontSize: 12.5, color: F.inkSoft, lineHeight: 1.45 }}>{projectDiagnosis.summary}</div>
                          <MiniList items={projectDiagnosis.gaps.slice(0, 5)} />
                        </div>
                      ) : (
                        <div style={mutedLineStyle}>No current diagnosis.</div>
                      )}
                    </CollapsiblePanel>

                    {detail.latest_package?.markdown && (
                      <CollapsiblePanel
                        title="Report preview"
                        open={reportOpen}
                        onToggle={() => setReportOpen((open) => !open)}
                        meta={packageGeneratedLabel(detail.latest_package.generated_at)}
                      >
                        <pre style={reportPreviewStyle}>{detail.latest_package.markdown}</pre>
                      </CollapsiblePanel>
                    )}
                  </>
                )}
              </aside>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

interface ProjectDraft {
  title: string;
  question: string;
  objective: string;
  counterparty_team_id: string;
  inbound_player_id: string;
  trigger_summary: string;
  counterparty_context: ProjectCounterpartyContext;
}

interface ScenarioDraft {
  title: string;
  summary: string;
  status: ProjectTradeScenarioStatus;
  rank: string;
  notes: string;
  basketball_fit: string;
  risks: string;
  phone_framing: string;
  walk_away: string;
  counter_range: string;
}

interface ValidationDraft {
  status: ProjectScenarioValidationStatus;
  summary: string;
}

interface AssetDraft {
  label: string;
  asset_type: string;
  direction: ProjectScenarioPlayerDirection;
}

interface ArtifactDraft {
  title: string;
  artifact_type: string;
  url: string;
}

interface AvailableScenarioPlayer {
  key: string;
  direction: ProjectScenarioPlayerDirection;
  teamId: string;
  row: NbaCapSheetPlayerRow;
}

function ProjectEditor({
  draft,
  setDraft,
  teamOptions,
  subjectCapSheet,
  busy,
  onCancel,
  onSave,
}: {
  draft: ProjectDraft;
  setDraft: (draft: ProjectDraft) => void;
  teamOptions: { team_id: string; label: string }[];
  subjectCapSheet: NbaCapSheet | null;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const setContext = (key: keyof ProjectCounterpartyContext, value: string) => {
    setDraft({ ...draft, counterparty_context: { ...draft.counterparty_context, [key]: value } });
  };
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 10, maxWidth: 960 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
        <Field label="Title"><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} style={{ ...inputStyle, height: 34 }} /></Field>
        <Field label="Question"><input value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} style={{ ...inputStyle, height: 34 }} /></Field>
      </div>
      <Field label="Description"><textarea value={draft.objective} onChange={(event) => setDraft({ ...draft, objective: event.target.value })} rows={2} style={{ ...textareaStyle, minHeight: 62 }} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '150px 190px minmax(0, 1fr)', gap: 8 }}>
        <Field label="Counterparty">
          <select value={draft.counterparty_team_id} onChange={(event) => setDraft({ ...draft, counterparty_team_id: event.target.value })} style={selectStyle}>
            <option value="">TBD</option>
            {teamOptions.map((team) => <option key={team.team_id} value={team.team_id}>{team.label}</option>)}
          </select>
        </Field>
        <Field label="Inbound player">
          <select value={draft.inbound_player_id} onChange={(event) => setDraft({ ...draft, inbound_player_id: event.target.value })} style={selectStyle}>
            <option value="">TBD</option>
            {(subjectCapSheet?.player_rows ?? []).filter((row) => row.nba_player_id != null).map((row) => (
              <option key={row.id} value={row.nba_player_id ?? ''}>{row.player_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Trigger"><input value={draft.trigger_summary} onChange={(event) => setDraft({ ...draft, trigger_summary: event.target.value })} style={{ ...inputStyle, height: 34 }} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <Field label="Apron / cap"><input value={draft.counterparty_context.apron_level} onChange={(event) => setContext('apron_level', event.target.value)} style={{ ...inputStyle, height: 32 }} /></Field>
        <Field label="Cap room"><input value={draft.counterparty_context.cap_room} onChange={(event) => setContext('cap_room', event.target.value)} style={{ ...inputStyle, height: 32 }} /></Field>
        <Field label="Aims"><input value={draft.counterparty_context.aims} onChange={(event) => setContext('aims', event.target.value)} style={{ ...inputStyle, height: 32 }} /></Field>
        <Field label="Pressure"><input value={draft.counterparty_context.pressure} onChange={(event) => setContext('pressure', event.target.value)} style={{ ...inputStyle, height: 32 }} /></Field>
        <Field label="Job security"><input value={draft.counterparty_context.job_security} onChange={(event) => setContext('job_security', event.target.value)} style={{ ...inputStyle, height: 32 }} /></Field>
        <Field label="Signals"><input value={draft.counterparty_context.signals} onChange={(event) => setContext('signals', event.target.value)} style={{ ...inputStyle, height: 32 }} /></Field>
      </div>
      <Field label="Known targets"><input value={draft.counterparty_context.known_targets} onChange={(event) => setContext('known_targets', event.target.value)} style={{ ...inputStyle, height: 32 }} /></Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <SecondaryButton disabled={busy} onClick={onCancel}>Cancel</SecondaryButton>
        <SecondaryButton icon="check" disabled={busy || !draft.title.trim() || !draft.question.trim()} onClick={onSave}>Save</SecondaryButton>
      </div>
    </div>
  );
}

function ScenarioTable({
  scenarios,
  selectedScenarioId,
  onSelect,
}: {
  scenarios: ProjectTradeScenarioDetail[];
  selectedScenarioId: string | null;
  onSelect: (id: string) => void;
}) {
  if (scenarios.length === 0) return <div style={mutedLineStyle}>No scenarios yet.</div>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <Th>Rank</Th>
            <Th>Scenario</Th>
            <Th>Deal</Th>
            <Th align="right">Delta</Th>
            <Th>Validation</Th>
            <Th>Risk</Th>
          </tr>
        </thead>
        <tbody>
          {scenarios.slice().sort((a, b) => a.rank - b.rank || a.updated_at.localeCompare(b.updated_at)).map((scenario) => {
            const totals = scenarioSalaryTotals(scenario);
            const gaps = scenario.players.filter((player) => !isSalaryUsable(player)).length;
            const selected = scenario.id === selectedScenarioId;
            return (
              <tr key={scenario.id} onClick={() => onSelect(scenario.id)} style={{ cursor: 'pointer', background: selected ? F.accentSoft : F.surface }}>
                <Td>{scenario.rank || '-'}</Td>
                <Td>
                  <div style={scenarioCellTitleStyle}>{scenario.title}</div>
                  <StatusText label={labelize(scenario.status)} tone={scenarioStatusTone(scenario.status)} />
                </Td>
                <Td>{dealLine(scenario)}</Td>
                <Td align="right">{formatMoney(totals.delta)}</Td>
                <Td><ValidationSummary scenario={scenario} sourceGaps={gaps} /></Td>
                <Td>{scenario.risks || 'TBD'}</Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioDossier({
  scenario,
  draft,
  setDraft,
  editingSection,
  setEditingSection,
  playerRows,
  playerDirection,
  setPlayerDirection,
  selectedPlayerKey,
  setSelectedPlayerKey,
  assetDraft,
  setAssetDraft,
  artifactDraft,
  setArtifactDraft,
  artifacts,
  sourceBriefs,
  tradeBuilderDraft,
  setTradeBuilderDraft,
  capSheetDraft,
  setCapSheetDraft,
  menuOpen,
  setMenuOpen,
  busy,
  onSaveScenario,
  onDuplicateScenario,
  onArchiveScenario,
  onAddPlayer,
  onDeletePlayer,
  onAddAsset,
  onDeleteAsset,
  onValidateScenario,
  onSaveManualValidation,
  onAddArtifact,
  onJumpToBrief,
}: {
  scenario: ProjectTradeScenarioDetail;
  draft: ScenarioDraft;
  setDraft: (draft: ScenarioDraft) => void;
  editingSection: DossierSectionId | null;
  setEditingSection: (section: DossierSectionId | null) => void;
  playerRows: AvailableScenarioPlayer[];
  playerDirection: ProjectScenarioPlayerDirection;
  setPlayerDirection: (direction: ProjectScenarioPlayerDirection) => void;
  selectedPlayerKey: string;
  setSelectedPlayerKey: (key: string) => void;
  assetDraft: AssetDraft;
  setAssetDraft: Dispatch<SetStateAction<AssetDraft>>;
  artifactDraft: ArtifactDraft;
  setArtifactDraft: Dispatch<SetStateAction<ArtifactDraft>>;
  artifacts: ProjectDetail['artifacts'];
  sourceBriefs: ProjectDetail['source_briefs'];
  tradeBuilderDraft: ValidationDraft;
  setTradeBuilderDraft: (draft: ValidationDraft) => void;
  capSheetDraft: ValidationDraft;
  setCapSheetDraft: (draft: ValidationDraft) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  busy: string | null;
  onSaveScenario: () => void;
  onDuplicateScenario: () => void;
  onArchiveScenario: () => void;
  onAddPlayer: () => void;
  onDeletePlayer: (playerId: string) => void;
  onAddAsset: () => void;
  onDeleteAsset: (assetId: string) => void;
  onValidateScenario: () => void;
  onSaveManualValidation: (kind: ProjectScenarioValidationKind, draft: ValidationDraft) => Promise<void>;
  onAddArtifact: () => void;
  onJumpToBrief: (briefId: string, sessionId?: string) => void;
}) {
  const totals = scenarioSalaryTotals(scenario);
  const sourceGaps = scenario.players.filter((player) => !isSalaryUsable(player)).length;
  const outgoing = scenario.players.filter((player) => player.direction === 'outgoing');
  const incoming = scenario.players.filter((player) => player.direction === 'incoming');
  const scenarioArtifacts = artifacts.filter((artifact) => !artifact.scenario_id || artifact.scenario_id === scenario.id);
  const edit = (section: DossierSectionId) => setEditingSection(editingSection === section ? null : section);
  const saveAndClose = () => {
    onSaveScenario();
    setEditingSection(null);
  };
  const menuRef = useRef<HTMLDivElement | null>(null);

  useMenuDismiss(menuOpen, setMenuOpen, menuRef);

  return (
    <Panel
      title="Scenario dossier"
      action={(
        <div ref={menuRef} style={{ position: 'relative' }}>
          <IconButton title="Scenario actions" onClick={() => setMenuOpen(!menuOpen)}>
            <Icon name="more-horizontal" size={15} />
          </IconButton>
          {menuOpen && (
            <ActionMenu align="right">
              <MenuItem icon="plus" disabled={busy === 'scenario-duplicate'} onClick={() => {
                setMenuOpen(false);
                onDuplicateScenario();
              }}>Duplicate scenario</MenuItem>
              <MenuItem icon="archive" disabled={busy === 'scenario-archive'} onClick={() => {
                setMenuOpen(false);
                onArchiveScenario();
              }}>Archive no-deal path</MenuItem>
            </ActionMenu>
          )}
        </div>
      )}
    >
      <div style={dossierHeroStyle} className="projects-edit-surface">
        <div style={{ minWidth: 0 }}>
          <div style={dossierMetaLineStyle}>{scenarioMetaLine(scenario)}</div>
          <h2 style={dossierTitleStyle}>{scenario.title}</h2>
          <p style={dossierSummaryStyle}>{scenario.summary || 'No scenario summary captured.'}</p>
        </div>
        <div className="projects-section-actions" data-force-visible={editingSection === 'snapshot' ? 'true' : undefined}>
          <IconButton title="Edit scenario snapshot" onClick={() => edit('snapshot')}><Icon name="edit" size={13} /></IconButton>
        </div>
      </div>

      {editingSection === 'snapshot' && (
        <div style={dossierEditBoxStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr) 124px', gap: 8 }}>
            <input value={draft.rank} onChange={(event) => setDraft({ ...draft, rank: event.target.value })} style={{ ...inputStyle, height: 32 }} />
            <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} style={{ ...inputStyle, height: 32 }} />
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectTradeScenarioStatus })} style={selectStyle}>
              {SCENARIO_STATUSES.map((status) => <option key={status} value={status}>{labelize(status)}</option>)}
            </select>
          </div>
          <textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder="Scenario summary" rows={2} style={{ ...textareaStyle, minHeight: 58 }} />
          <SectionEditActions busy={busy === 'scenario-save'} disabled={!draft.title.trim()} onCancel={() => setEditingSection(null)} onSave={saveAndClose} />
        </div>
      )}

      <SalarySummaryStrip totals={totals} sourceGaps={sourceGaps} />

      <DossierSection title="Deal construction" editing={editingSection === 'deal'} onEdit={() => edit('deal')}>
        <div style={dealColumnsStyle}>
          <DealSide title="Warriors send" emptyLabel="No outgoing salary captured" players={outgoing} onDelete={editingSection === 'deal' ? onDeletePlayer : undefined} />
          <DealSide title="Warriors receive" emptyLabel="No incoming salary captured" players={incoming} onDelete={editingSection === 'deal' ? onDeletePlayer : undefined} />
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={metricLabelStyle}>Other assets</div>
          <AssetRows scenario={scenario} editing={editingSection === 'deal'} onDelete={onDeleteAsset} />
        </div>
        {editingSection === 'deal' && (
          <div style={dossierEditBoxStyle}>
            <div style={{ display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr) auto', gap: 8 }}>
              <select value={playerDirection} onChange={(event) => {
                const direction = event.target.value as ProjectScenarioPlayerDirection;
                setPlayerDirection(direction);
                setSelectedPlayerKey('');
              }} style={selectStyle}>
                <option value="outgoing">Warriors send</option>
                <option value="incoming">Warriors receive</option>
              </select>
              <select value={selectedPlayerKey} onChange={(event) => setSelectedPlayerKey(event.target.value)} style={selectStyle}>
                <option value="">Select player</option>
                {playerRows.filter((item) => item.direction === playerDirection).map((item) => {
                  const salary = salaryForRow(item.row);
                  return (
                    <option key={item.key} value={item.key}>
                      {item.teamId} · {item.row.player_name} · {formatMoney(salary.amount)} · {sourceLabel(salary.source)}
                    </option>
                  );
                })}
              </select>
              <SecondaryButton icon="plus" disabled={busy === 'player-add' || !selectedPlayerKey} onClick={onAddPlayer}>Add</SecondaryButton>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 104px minmax(0, 1fr) auto', gap: 8 }}>
              <select value={assetDraft.direction} onChange={(event) => setAssetDraft((current) => ({ ...current, direction: event.target.value as ProjectScenarioPlayerDirection }))} style={selectStyle}>
                <option value="outgoing">Send</option>
                <option value="incoming">Receive</option>
              </select>
              <select value={assetDraft.asset_type} onChange={(event) => setAssetDraft((current) => ({ ...current, asset_type: event.target.value }))} style={selectStyle}>
                <option value="pick">Pick</option>
                <option value="cash">Cash</option>
                <option value="rights">Rights</option>
                <option value="exception">Exception</option>
                <option value="other">Other</option>
              </select>
              <input value={assetDraft.label} onChange={(event) => setAssetDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Asset" style={{ ...inputStyle, height: 32 }} />
              <SecondaryButton icon="plus" disabled={busy === 'asset-add' || !assetDraft.label.trim()} onClick={onAddAsset}>Add</SecondaryButton>
            </div>
          </div>
        )}
      </DossierSection>

      <DossierSection
        title="Validation ledger"
        editing={editingSection === 'validation'}
        onEdit={() => edit('validation')}
        action={<QuietButton icon="check" disabled={busy === 'validate'} onClick={onValidateScenario}>Run advisory</QuietButton>}
      >
        <ValidationBlock validation={latestValidation(scenario, 'app_advisory')} label="App advisory cross-check" />
        {editingSection === 'validation' ? (
          <>
            <ManualValidation label="Trade Builder" draft={tradeBuilderDraft} setDraft={setTradeBuilderDraft} busy={busy === 'trade_builder'} onSave={() => void onSaveManualValidation('trade_builder', tradeBuilderDraft)} />
            <ManualValidation label="Internal cap sheet" draft={capSheetDraft} setDraft={setCapSheetDraft} busy={busy === 'internal_cap_sheet'} onSave={() => void onSaveManualValidation('internal_cap_sheet', capSheetDraft)} />
          </>
        ) : (
          <div style={validationRowsStyle}>
            <ValidationReadRow label="Trade Builder" empty="Trade Builder verdict pending" validation={latestValidation(scenario, 'trade_builder')} />
            <ValidationReadRow label="Internal cap sheet" empty="Internal cap sheet not checked" validation={latestValidation(scenario, 'internal_cap_sheet')} />
          </div>
        )}
        <div style={{ ...mutedLineStyle, marginTop: 7 }}>Advisory check only; confirm legality in Trade Builder and the internal cap sheet.</div>
      </DossierSection>

      <DossierSection title="Basketball read" editing={editingSection === 'basketball'} onEdit={() => edit('basketball')}>
        {editingSection === 'basketball' ? (
          <div style={dossierEditBoxStyle}>
            <textarea value={draft.basketball_fit} onChange={(event) => setDraft({ ...draft, basketball_fit: event.target.value })} placeholder="Basketball fit" rows={2} style={{ ...textareaStyle, minHeight: 58 }} />
            <textarea value={draft.risks} onChange={(event) => setDraft({ ...draft, risks: event.target.value })} placeholder="Downside / risk" rows={2} style={{ ...textareaStyle, minHeight: 58 }} />
            <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Roster or context notes" rows={2} style={{ ...textareaStyle, minHeight: 58 }} />
            <SectionEditActions busy={busy === 'scenario-save'} disabled={!draft.title.trim()} onCancel={() => setEditingSection(null)} onSave={saveAndClose} />
          </div>
        ) : (
          <div style={readBlockGridStyle}>
            <ReadBlock label="Fit" value={scenario.basketball_fit} empty="No basketball fit read captured." />
            <ReadBlock label="Downside / risk" value={scenario.risks} empty="No risk read captured." />
            <ReadBlock label="Roster notes" value={scenario.notes} empty="No roster/context notes captured." />
          </div>
        )}
      </DossierSection>

      <DossierSection title="Call sheet" editing={editingSection === 'call'} onEdit={() => edit('call')}>
        {editingSection === 'call' ? (
          <div style={dossierEditBoxStyle}>
            <textarea value={draft.phone_framing} onChange={(event) => setDraft({ ...draft, phone_framing: event.target.value })} placeholder="Phone framing" rows={2} style={{ ...textareaStyle, minHeight: 58 }} />
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8 }}>
              <textarea value={draft.walk_away} onChange={(event) => setDraft({ ...draft, walk_away: event.target.value })} placeholder="Walk-away" rows={2} style={{ ...textareaStyle, minHeight: 58 }} />
              <textarea value={draft.counter_range} onChange={(event) => setDraft({ ...draft, counter_range: event.target.value })} placeholder="Counter range" rows={2} style={{ ...textareaStyle, minHeight: 58 }} />
            </div>
            <SectionEditActions busy={busy === 'scenario-save'} disabled={!draft.title.trim()} onCancel={() => setEditingSection(null)} onSave={saveAndClose} />
          </div>
        ) : (
          <div style={readBlockGridStyle}>
            <ReadBlock label="Phone framing" value={scenario.phone_framing} empty="No phone framing captured." />
            <ReadBlock label="Walk-away" value={scenario.walk_away} empty="No walk-away line captured." />
            <ReadBlock label="Counter range" value={scenario.counter_range} empty="No counter range captured." />
          </div>
        )}
      </DossierSection>

      <DossierSection title="Evidence" editing={editingSection === 'evidence'} onEdit={() => edit('evidence')}>
        <div style={{ display: 'grid', gap: 8 }}>
          {scenarioArtifacts.length === 0 && <div style={mutedLineStyle}>No Trade Builder report, cap sheet, or intel artifact linked.</div>}
          {scenarioArtifacts.map((artifact) => (
            <div key={artifact.id} style={compactRowStyle}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: F.inkSoft, fontWeight: 650 }}>{artifact.title}</div>
                <div style={tinyMetaStyle}>{labelize(artifact.artifact_type)}{artifact.url ? ` · ${artifact.url}` : ''}</div>
              </div>
            </div>
          ))}
          {sourceBriefs.map((item) => (
            <button key={item.id} onClick={() => onJumpToBrief(item.brief_id, item.brief.session_id)} style={sourceButtonStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: F.accent, fontSize: 11, fontWeight: 650 }}>
                <Icon name="link" size={12} />
                Analyze source
              </div>
              <div style={sourceTitleStyle}>{item.brief.thesis || item.brief.question || 'Source brief'}</div>
            </button>
          ))}
          {sourceBriefs.length === 0 && <div style={mutedLineStyle}>No linked source briefs.</div>}
        </div>
        {editingSection === 'evidence' && (
          <div style={dossierEditBoxStyle}>
            <select value={artifactDraft.artifact_type} onChange={(event) => setArtifactDraft((current) => ({ ...current, artifact_type: event.target.value }))} style={selectStyle}>
              <option value="trade_builder_report">Trade Builder report</option>
              <option value="internal_cap_sheet">Internal cap sheet</option>
              <option value="source_brief">Source brief</option>
              <option value="scout_intel">Scout intel</option>
              <option value="performance_intel">Performance intel</option>
              <option value="slack_note">Slack note</option>
              <option value="email_note">Email note</option>
              <option value="other">Other</option>
            </select>
            <input value={artifactDraft.title} onChange={(event) => setArtifactDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Artifact title" style={{ ...inputStyle, height: 32 }} />
            <input value={artifactDraft.url} onChange={(event) => setArtifactDraft((current) => ({ ...current, url: event.target.value }))} placeholder="URL or path" style={{ ...inputStyle, height: 32 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <SecondaryButton icon="plus" disabled={busy === 'artifact' || !artifactDraft.title.trim()} onClick={onAddArtifact}>Add artifact</SecondaryButton>
            </div>
          </div>
        )}
      </DossierSection>
    </Panel>
  );
}

function DossierSection({
  title,
  editing,
  onEdit,
  action,
  children,
}: {
  title: string;
  editing: boolean;
  onEdit: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section style={dossierSectionStyle} className="projects-edit-surface" data-editing={editing ? 'true' : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 9 }}>
        <div style={panelTitleStyle}>{title}</div>
        <div className="projects-section-actions" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {action}
          <IconButton title={editing ? `Close ${title}` : `Edit ${title}`} onClick={onEdit}>
            <Icon name={editing ? 'check' : 'edit'} size={12} />
          </IconButton>
        </div>
      </div>
      {children}
    </section>
  );
}

function DealSide({
  title,
  emptyLabel,
  players,
  onDelete,
}: {
  title: string;
  emptyLabel: string;
  players: ProjectScenarioPlayer[];
  onDelete?: (playerId: string) => void;
}) {
  return (
    <div style={dealSideStyle}>
      <div style={metricLabelStyle}>{title}</div>
      <div style={{ display: 'grid', gap: 7, marginTop: 7 }}>
        {players.length === 0 && <div style={emptyDealStyle}>{emptyLabel}</div>}
        {players.map((player) => (
          <div key={player.id} style={playerChipStyle(!isSalaryUsable(player))}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: F.inkSoft, fontWeight: 700 }}>{player.player_name}</div>
              <div style={tinyMetaStyle}>{player.team_id} · {formatMoney(player.salary_amount)} · {sourceLabel(player.salary_source_status)}</div>
              {player.stats_snapshot && (
                <div style={tinyMetaStyle}>
                  {player.stats_snapshot.points_per_game.toFixed(1)} PPG · {player.stats_snapshot.true_shooting_pct.toFixed(1)} TS% · {player.stats_snapshot.net_rating.toFixed(1)} net
                </div>
              )}
            </div>
            {onDelete && <IconButton title="Remove player" onClick={() => onDelete(player.id)}><Icon name="trash" size={12} /></IconButton>}
          </div>
        ))}
      </div>
    </div>
  );
}

function AssetRows({
  scenario,
  editing,
  onDelete,
}: {
  scenario: ProjectTradeScenarioDetail;
  editing: boolean;
  onDelete: (assetId: string) => void;
}) {
  if (scenario.assets.length === 0) return <div style={mutedLineStyle}>No picks, cash, rights, exceptions, or other assets captured.</div>;
  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
      {scenario.assets.map((asset) => (
        <div key={asset.id} style={compactRowStyle}>
          <div style={{ fontSize: 12.5, color: F.inkSoft, minWidth: 0 }}>
            {asset.direction === 'outgoing' ? 'Warriors send' : 'Warriors receive'} · {asset.asset_type}: {asset.label}
          </div>
          {editing && <IconButton title="Remove asset" onClick={() => onDelete(asset.id)}><Icon name="trash" size={12} /></IconButton>}
        </div>
      ))}
    </div>
  );
}

function ValidationReadRow({ label, empty, validation }: { label: string; empty: string; validation: ProjectScenarioValidation | null }) {
  return (
    <div style={validationReadRowStyle}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: F.inkSoft }}>{label}</span>
          <StatusText label={labelize(validation?.status ?? 'manual_pending')} tone={validationTone(validation?.status ?? 'manual_pending')} />
        </div>
        <div style={{ ...mutedLineStyle, marginTop: 5 }}>{validation?.summary || empty}</div>
      </div>
    </div>
  );
}

function ReadBlock({ label, value, empty }: { label: string; value: string; empty: string }) {
  return (
    <div style={readBlockStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ fontSize: 12.5, color: value ? F.inkSoft : F.fgMuted, lineHeight: 1.45 }}>{value || empty}</div>
    </div>
  );
}

function SectionEditActions({
  busy,
  disabled,
  onCancel,
  onSave,
}: {
  busy: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
      <SecondaryButton disabled={busy} onClick={onCancel}>Cancel</SecondaryButton>
      <SecondaryButton icon="check" disabled={busy || disabled} onClick={onSave}>Save</SecondaryButton>
    </div>
  );
}

function ManualValidation({ label, draft, setDraft, busy, onSave }: {
  label: string;
  draft: ValidationDraft;
  setDraft: (draft: ValidationDraft) => void;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <div style={manualValidationStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 138px auto', gap: 8, alignItems: 'center' }}>
        <div style={panelTitleStyle}>{label}</div>
        <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectScenarioValidationStatus })} style={selectStyle}>
          {VALIDATION_STATUSES.map((status) => <option key={status} value={status}>{labelize(status)}</option>)}
        </select>
        <IconButton title={`Save ${label}`} disabled={busy} onClick={onSave}><Icon name="check" size={13} /></IconButton>
      </div>
      <textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} placeholder={`${label} notes`} rows={2} style={{ ...textareaStyle, minHeight: 58, marginTop: 8 }} />
    </div>
  );
}

function ValidationBlock({ label, validation }: { label: string; validation: ProjectScenarioValidation | null }) {
  return (
    <div style={manualValidationStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={panelTitleStyle}>{label}</div>
        <StatusText label={labelize(validation?.status ?? 'not_run')} tone={validationTone(validation?.status ?? 'not_run')} />
      </div>
      <div style={{ ...mutedLineStyle, marginTop: 7 }}>{validation?.summary || 'Not run.'}</div>
    </div>
  );
}

function SalarySummaryStrip({ totals, sourceGaps }: { totals: ReturnType<typeof scenarioSalaryTotals>; sourceGaps: number }) {
  return (
    <div style={salaryStripStyle}>
      <SalaryStripItem label="Outgoing" value={formatMoney(totals.outgoing)} />
      <SalaryStripItem label="Incoming" value={formatMoney(totals.incoming)} />
      <SalaryStripItem label="Delta" value={formatMoney(totals.delta)} />
      <SalaryStripItem label="Source gaps" value={sourceGaps ? String(sourceGaps) : '0'} tone={sourceGaps ? 'warn' : 'good'} />
    </div>
  );
}

function SalaryStripItem({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <div style={salaryStripItemStyle}>
      <span>{label}</span>
      <strong style={{ color: tone === 'good' ? F.accent : tone === 'warn' ? F.amber : F.ink }}>{value}</strong>
    </div>
  );
}

function StageControl({ activeStep, busy, onAdvance }: { activeStep: ProjectStepId; busy: boolean; onAdvance: (step: ProjectStepId) => void }) {
  const activeIndex = STAGE_INDEX[activeStep] ?? 0;
  return (
    <div style={stageControlStyle}>
      <label style={stageSelectLabelStyle}>
        <span>Stage</span>
        <select
          value={activeStep}
          onChange={(event) => {
            const nextStep = event.target.value as ProjectStepId;
            if (nextStep !== activeStep) onAdvance(nextStep);
          }}
          disabled={busy}
          style={stageSelectStyle}
        >
          {PROJECT_STEP_DEFINITIONS.map((step) => (
            <option key={step.id} value={step.id}>{step.label}</option>
          ))}
        </select>
      </label>
      <div style={stageProgressStyle}>
        {PROJECT_STEP_DEFINITIONS.map((step, index) => (
          <span
            key={step.id}
            title={step.label}
            style={stageProgressSegmentStyle(index <= activeIndex)}
          />
        ))}
      </div>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={panelTitleStyle}>{title}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CollapsiblePanel({
  title,
  meta,
  open,
  onToggle,
  children,
}: {
  title: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section style={panelStyle}>
      <button onClick={onToggle} style={collapsibleHeaderStyle} aria-expanded={open}>
        <span style={panelTitleStyle}>{title}</span>
        <span style={collapsibleMetaStyle}>{meta}</span>
      </button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label style={fieldLabelStyle}>{label}{children}</label>;
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} style={{ ...inputStyle, height: 31, marginTop: 8 }} />;
}

function IconButton({ children, title, onClick, disabled }: { children: ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button title={title} onClick={onClick} disabled={disabled} style={iconButtonStyle(disabled)}>
      {children}
    </button>
  );
}

function SecondaryButton({ children, icon, onClick, disabled }: { children: ReactNode; icon?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={secondaryButtonStyle(disabled)}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  );
}

function QuietButton({ children, icon, onClick, disabled }: { children: ReactNode; icon?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={quietButtonStyle(disabled)}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </button>
  );
}

function ActionMenu({ children, align = 'left' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return (
    <div style={{ ...actionMenuStyle, ...(align === 'right' ? { right: 0 } : { left: 0 }) }}>
      {children}
    </div>
  );
}

function MenuItem({ children, icon, onClick, disabled }: { children: ReactNode; icon?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} style={menuItemStyle(disabled)}>
      {icon && <Icon name={icon} size={13} />}
      <span>{children}</span>
    </button>
  );
}

function StatusText({ label, tone = 'neutral' }: { label: string; tone?: StatusTone }) {
  return (
    <span style={statusTextStyle}>
      <span style={statusDotStyle(tone)} />
      <span>{label}</span>
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ ...metricValueStyle, color: tone === 'good' ? F.accent : tone === 'warn' ? F.amber : F.inkSoft }}>{value}</div>
    </div>
  );
}

function ContextCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={contextCellStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.35, color: value === 'TBD' ? F.fgMuted : F.inkSoft }}>{value}</div>
    </div>
  );
}

function MiniList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return <ul style={{ margin: 0, paddingLeft: 16, color: F.inkSoft, fontSize: 12, lineHeight: 1.45 }}>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function RailEmpty({ label }: { label: string }) {
  return <div style={{ padding: 12, color: F.fgMuted, fontSize: 12, textAlign: 'center' }}>{label}</div>;
}

function Th({ children, align }: { children: ReactNode; align?: 'right' }) {
  return <th style={{ ...thStyle, textAlign: align ?? 'left' }}>{children}</th>;
}

function Td({ children, align, strong }: { children: ReactNode; align?: 'right'; strong?: boolean }) {
  return <td style={{ ...tdStyle, textAlign: align ?? 'left', fontWeight: strong ? 650 : 500, color: strong ? F.ink : F.inkSoft }}>{children}</td>;
}

function useMenuDismiss(open: boolean, setOpen: (open: boolean) => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, ref, setOpen]);
}

function compactPackageStatus(status: ProjectPackageStatus): string | null {
  if (status === 'ready') return 'Package ready';
  if (status === 'stale') return 'Package stale';
  if (status === 'drafted') return 'Draft package';
  return null;
}

function dealLine(scenario: ProjectTradeScenarioDetail): string {
  const outgoing = scenario.players.filter((player) => player.direction === 'outgoing').map((player) => player.player_name);
  const incoming = scenario.players.filter((player) => player.direction === 'incoming').map((player) => player.player_name);
  const send = outgoing.length ? outgoing.join(', ') : 'TBD';
  const receive = incoming.length ? incoming.join(', ') : 'TBD';
  return `${send} for ${receive}`;
}

function scenarioMetaLine(scenario: ProjectTradeScenarioDetail): string {
  const app = latestValidation(scenario, 'app_advisory')?.status ?? 'not_run';
  return `Rank ${scenario.rank || '-'} · ${labelize(scenario.status)} · App ${labelize(app)}`;
}

function ValidationSummary({ scenario, sourceGaps }: { scenario: ProjectTradeScenarioDetail; sourceGaps: number }) {
  const app = latestValidation(scenario, 'app_advisory')?.status ?? 'not_run';
  const tradeBuilder = latestValidation(scenario, 'trade_builder')?.status ?? 'manual_pending';
  const capSheet = latestValidation(scenario, 'internal_cap_sheet')?.status ?? 'manual_pending';
  const tone: StatusTone = app === 'fail' || tradeBuilder === 'fail' || capSheet === 'fail'
    ? 'bad'
    : sourceGaps > 0 || app === 'warning' || app === 'source_needed' || tradeBuilder === 'warning' || capSheet === 'warning'
      ? 'warn'
      : app === 'pass' && tradeBuilder === 'pass' && capSheet === 'pass'
        ? 'good'
        : 'neutral';
  return (
    <div style={validationSummaryStyle}>
      <StatusText label={`App ${labelize(app)}`} tone={validationTone(app)} />
      <span>TB {labelize(tradeBuilder)}</span>
      <span>Sheet {labelize(capSheet)}</span>
      <span>{sourceGaps ? `${sourceGaps} source gaps` : 'No source gaps'}</span>
      <span style={{ color: statusColor(tone), fontWeight: 650 }}>{tone === 'good' ? 'Ready to verify' : tone === 'bad' ? 'Blocked' : tone === 'warn' ? 'Needs check' : 'Pending'}</span>
    </div>
  );
}

function validationTone(status: ProjectScenarioValidationStatus): StatusTone {
  if (status === 'pass') return 'good';
  if (status === 'fail') return 'bad';
  if (status === 'warning' || status === 'source_needed') return 'warn';
  return 'neutral';
}

function scenarioStatusTone(status: ProjectTradeScenarioStatus): StatusTone {
  if (status === 'shortlisted' || status === 'presented' || status === 'terms_agreed') return 'good';
  if (status === 'archived' || status === 'collapsed') return 'neutral';
  return 'warn';
}

function readinessTone(readiness: 'low' | 'medium' | 'high'): StatusTone {
  if (readiness === 'high') return 'good';
  if (readiness === 'medium') return 'warn';
  return 'bad';
}

function readinessLabel(readiness: 'low' | 'medium' | 'high'): string {
  return `${readiness} readiness`;
}

function packageGeneratedLabel(value: string | null | undefined): string {
  if (!value) return 'Generated';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Generated';
  return `Generated ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function statusColor(tone: StatusTone): string {
  if (tone === 'good') return F.accent;
  if (tone === 'warn') return F.amber;
  if (tone === 'bad') return F.red;
  return F.fgMuted;
}

async function loadCapSheet(teamId: string, setter: (sheet: NbaCapSheet | null) => void) {
  try {
    const res = await getCurrentNbaCapSheet(teamId);
    setter(res.cap_sheet);
  } catch (err) {
    console.warn('[projects] cap sheet load failed', teamId, err);
    setter(null);
  }
}

function emptyProjectDraft(): ProjectDraft {
  return {
    title: '',
    question: '',
    objective: '',
    counterparty_team_id: '',
    inbound_player_id: '',
    trigger_summary: '',
    counterparty_context: {
      apron_level: '',
      cap_room: '',
      aims: '',
      pressure: '',
      job_security: '',
      known_targets: '',
      signals: '',
    },
  };
}

function projectToDraft(project: ProjectDetail['project']): ProjectDraft {
  return {
    title: project.title,
    question: project.question,
    objective: project.objective,
    counterparty_team_id: project.counterparty_team_id ?? '',
    inbound_player_id: project.inbound_player_id ? String(project.inbound_player_id) : '',
    trigger_summary: project.trigger_summary,
    counterparty_context: { ...project.counterparty_context },
  };
}

function emptyScenarioDraft(): ScenarioDraft {
  return {
    title: '',
    summary: '',
    status: 'active',
    rank: '1',
    notes: '',
    basketball_fit: '',
    risks: '',
    phone_framing: '',
    walk_away: '',
    counter_range: '',
  };
}

function validationToDraft(validation: ProjectScenarioValidation | null): ValidationDraft {
  return {
    status: validation?.status ?? 'manual_pending',
    summary: validation?.summary ?? '',
  };
}

function latestValidation(scenario: ProjectTradeScenarioDetail, kind: ProjectScenarioValidationKind): ProjectScenarioValidation | null {
  return scenario.validations
    .filter((validation) => validation.kind === kind)
    .sort((a, b) => (b.validated_at ?? b.updated_at).localeCompare(a.validated_at ?? a.updated_at))[0] ?? null;
}

function salaryForRow(row: NbaCapSheetPlayerRow): { amount: number | null; source: NbaCapSheetSourceStatus } {
  const current = row.salary_cells.find((cell) => cell.amount != null) ?? row.salary_cells[0] ?? null;
  return {
    amount: current?.amount ?? row.total_amount ?? null,
    source: current?.source_status ?? row.source_status,
  };
}

function scenarioSalaryTotals(scenario: ProjectTradeScenarioDetail): { outgoing: number; incoming: number; delta: number } {
  const totals = { outgoing: 0, incoming: 0, delta: 0 };
  for (const player of scenario.players) {
    if (!isSalaryUsable(player)) continue;
    if (player.direction === 'outgoing') totals.outgoing += player.salary_amount ?? 0;
    if (player.direction === 'incoming') totals.incoming += player.salary_amount ?? 0;
  }
  totals.delta = totals.incoming - totals.outgoing;
  return totals;
}

function isSalaryUsable(player: ProjectScenarioPlayer): boolean {
  if (typeof player.salary_amount !== 'number' || !Number.isFinite(player.salary_amount)) return false;
  return player.salary_source_status === 'captured' || player.salary_source_status === 'manual' || player.manual_override;
}

function playerNameById(sheet: NbaCapSheet | null, id: number | null): string | null {
  if (id == null) return null;
  return sheet?.player_rows.find((row) => row.nba_player_id === id)?.player_name ?? null;
}

function stepLabel(step: ProjectStepId): string {
  return PROJECT_STEP_DEFINITIONS.find((item) => item.id === step)?.label ?? step;
}

function labelize(value: string): string {
  return value.replace(/_/g, ' ');
}

function sourceLabel(value: string): string {
  return value === 'captured' ? 'Captured' : value === 'manual' ? 'Manual' : 'Source needed';
}

function formatMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'TBD';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

const shellStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 320px) minmax(0, 1fr)',
  background: F.paper,
  color: F.ink,
  overflow: 'hidden',
};

const railStyle: CSSProperties = {
  borderRight: `1px solid ${F.border}`,
  background: F.surface,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
};

const railHeaderStyle: CSSProperties = {
  padding: 14,
  borderBottom: `1px solid ${F.border}`,
};

const createBoxStyle: CSSProperties = {
  padding: 12,
  borderBottom: `1px solid ${F.border}`,
  background: F.cream50,
};

const workspaceStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateRows: 'auto 1fr',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  padding: '16px 18px 14px',
  borderBottom: `1px solid ${F.border}`,
  background: F.surface,
};

const bodyGridStyle: CSSProperties = {
  minHeight: 0,
  overflow: 'hidden',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.4fr) minmax(390px, 0.78fr)',
};

const inspectorStyle: CSSProperties = {
  minHeight: 0,
  overflowY: 'auto',
  borderLeft: `1px solid ${F.border}`,
  background: F.surface,
  padding: 14,
};

const centeredStyle: CSSProperties = {
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  color: F.fgMuted,
  fontSize: 13,
};

const titleStyle: CSSProperties = {
  margin: '5px 0 3px',
  fontSize: 21,
  lineHeight: 1.2,
  fontWeight: 700,
  letterSpacing: 0,
  color: F.ink,
};

const subheadStyle: CSSProperties = {
  fontSize: 13,
  color: F.inkSoft,
  lineHeight: 1.4,
};

const headerMetaStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  fontFamily: 'var(--font-mono)',
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: F.fgMuted,
};

const headerControlsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'flex-end',
  gap: 10,
};

const contextGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 12,
  marginTop: 12,
  maxWidth: 860,
};

const contextRowsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  columnGap: 20,
  rowGap: 0,
};

const contextCellStyle: CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  background: 'transparent',
  borderRadius: 0,
  padding: '9px 0 10px',
  minHeight: 46,
};

const panelStyle: CSSProperties = {
  border: `1px solid ${F.border}`,
  background: F.surface,
  borderRadius: 8,
  padding: 12,
  marginBottom: 12,
  boxShadow: F.shadowSoft,
};

const collapsibleHeaderStyle: CSSProperties = {
  width: '100%',
  border: 'none',
  background: 'transparent',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  cursor: 'pointer',
  textAlign: 'left',
};

const collapsibleMetaStyle: CSSProperties = {
  color: F.fgMuted,
  fontSize: 11.5,
  lineHeight: 1.35,
};

const capsStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: F.fgMuted,
};

const panelTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: F.fgMuted,
};

const fieldLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 5,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${F.border}`,
  borderRadius: 7,
  background: F.surface,
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  padding: '0 9px',
  outline: 'none',
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  height: 32,
};

const textareaStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${F.border}`,
  borderRadius: 8,
  background: F.surface,
  color: F.inkSoft,
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  lineHeight: 1.45,
  padding: 10,
  resize: 'vertical',
  outline: 'none',
};

const tableStyle: CSSProperties = {
  width: '100%',
  minWidth: 860,
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontSize: 12,
};

const thStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  background: F.cream50,
  borderBottom: `1px solid ${F.border}`,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  padding: '8px 9px',
  whiteSpace: 'nowrap',
};

const tdStyle: CSSProperties = {
  borderBottom: `1px solid ${F.border}`,
  padding: '8px 9px',
  lineHeight: 1.35,
  verticalAlign: 'top',
  maxWidth: 310,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const scenarioCellTitleStyle: CSSProperties = {
  color: F.ink,
  fontWeight: 650,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  marginBottom: 4,
};

const validationSummaryStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  color: F.fg,
  fontSize: 11.5,
  lineHeight: 1.35,
};

const inlineCreateRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 8,
  borderBottom: `1px solid ${F.border}`,
  paddingBottom: 10,
  marginBottom: 8,
};

const mutedLineStyle: CSSProperties = {
  color: F.fgMuted,
  fontSize: 12,
  lineHeight: 1.45,
};

const tinyMetaStyle: CSSProperties = {
  color: F.fgMuted,
  fontSize: 10.5,
  lineHeight: 1.35,
  fontFamily: 'var(--font-mono)',
};

const metricLabelStyle: CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 3,
};

const metricValueStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.3,
  fontWeight: 650,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const compactRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  border: `1px solid ${F.border}`,
  background: F.cream50,
  borderRadius: 8,
  padding: 8,
};

const manualValidationStyle: CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  background: 'transparent',
  borderRadius: 0,
  padding: '9px 0 0',
  marginBottom: 10,
};

const dossierHeroStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 10,
  alignItems: 'start',
  borderBottom: `1px solid ${F.border}`,
  background: 'transparent',
  borderRadius: 0,
  padding: '2px 0 12px',
  marginBottom: 9,
};

const dossierMetaLineStyle: CSSProperties = {
  color: F.fgMuted,
  fontSize: 11.5,
  lineHeight: 1.3,
  fontFamily: 'var(--font-mono)',
};

const dossierTitleStyle: CSSProperties = {
  margin: '8px 0 4px',
  fontSize: 17,
  lineHeight: 1.22,
  fontWeight: 750,
  color: F.ink,
  letterSpacing: 0,
};

const dossierSummaryStyle: CSSProperties = {
  margin: 0,
  color: F.inkSoft,
  fontSize: 12.5,
  lineHeight: 1.45,
};

const dossierEditBoxStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  border: `1px solid ${F.border}`,
  background: F.surface,
  borderRadius: 8,
  padding: 8,
  marginTop: 8,
};

const dossierSectionStyle: CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  paddingTop: 11,
  marginTop: 11,
};

const salaryStripStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  flexWrap: 'wrap',
  color: F.fg,
  fontSize: 12,
  lineHeight: 1.35,
  padding: '2px 0 5px',
};

const salaryStripItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 5,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
};

const dealColumnsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: 8,
};

const dealSideStyle: CSSProperties = {
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  borderRadius: 0,
  padding: 0,
};

const playerChipStyle = (warn: boolean): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  borderTop: `1px solid ${warn ? F.amber : F.border}`,
  background: 'transparent',
  borderRadius: 0,
  padding: '8px 0',
});

const emptyDealStyle: CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  borderRadius: 0,
  padding: '8px 0',
  color: F.fgMuted,
  fontSize: 12,
  lineHeight: 1.35,
};

const validationRowsStyle: CSSProperties = {
  display: 'grid',
  gap: 7,
  marginTop: 8,
};

const validationReadRowStyle: CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  background: 'transparent',
  borderRadius: 0,
  padding: '9px 0 0',
};

const readBlockGridStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const readBlockStyle: CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  background: 'transparent',
  borderRadius: 0,
  padding: '8px 0 0',
};

const reportPreviewStyle: CSSProperties = {
  margin: 0,
  maxHeight: 330,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  lineHeight: 1.45,
  color: F.inkSoft,
  background: F.cream50,
  border: `1px solid ${F.border}`,
  borderRadius: 8,
  padding: 10,
};

const sourceButtonStyle: CSSProperties = {
  border: `1px solid ${F.border}`,
  background: F.cream50,
  borderRadius: 8,
  padding: 9,
  textAlign: 'left',
  cursor: 'pointer',
};

const sourceTitleStyle: CSSProperties = {
  fontSize: 12.5,
  color: F.inkSoft,
  lineHeight: 1.35,
  marginTop: 5,
};

const errorStyle: CSSProperties = {
  border: `1px solid ${F.red}`,
  background: F.redSoft,
  color: F.red,
  borderRadius: 8,
  padding: '7px 9px',
  fontSize: 12,
  lineHeight: 1.35,
  marginTop: 12,
};

const statusStyle: CSSProperties = {
  border: `1px solid ${F.accent}`,
  background: F.accentSoft,
  color: F.accent,
  borderRadius: 8,
  padding: '7px 9px',
  fontSize: 12,
  lineHeight: 1.35,
  marginTop: 12,
};

const railTitleStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  lineHeight: 1.25,
  fontWeight: 650,
  color: F.ink,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const railMetaLineStyle: CSSProperties = {
  fontSize: 10.5,
  color: F.fgMuted,
  lineHeight: 1.35,
  marginTop: 6,
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase',
};

const railBodyStyle: CSSProperties = {
  fontSize: 11.5,
  color: F.fg,
  lineHeight: 1.35,
  marginTop: 5,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

const railCountStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 8,
  color: F.fgMuted,
  fontSize: 10.5,
  fontFamily: 'var(--font-mono)',
};

function primaryButtonStyle(disabled?: boolean): CSSProperties {
  return {
    minHeight: 31,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 12px',
    borderRadius: 7,
    border: `1px solid ${F.accent}`,
    background: F.accent,
    color: '#fff',
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    whiteSpace: 'nowrap',
    marginTop: 8,
  };
}

function projectRailButtonStyle(active: boolean): CSSProperties {
  return {
    width: '100%',
    display: 'block',
    textAlign: 'left',
    border: `1px solid ${active ? F.accent : F.border}`,
    background: active ? F.accentSoft : F.surface,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    cursor: 'pointer',
  };
}

function iconButtonStyle(disabled?: boolean): CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 7,
    border: `1px solid ${F.border}`,
    background: F.surface,
    color: F.inkSoft,
    display: 'grid',
    placeItems: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

function secondaryButtonStyle(disabled?: boolean): CSSProperties {
  return {
    minHeight: 30,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 10px',
    borderRadius: 7,
    border: `1px solid ${F.borderStrong}`,
    background: F.surface,
    color: F.inkSoft,
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    fontWeight: 650,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    whiteSpace: 'nowrap',
  };
}

const stageControlStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  minWidth: 210,
};

const stageSelectLabelStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 132px',
  alignItems: 'center',
  gap: 8,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const stageSelectStyle: CSSProperties = {
  height: 30,
  border: `1px solid ${F.border}`,
  borderRadius: 7,
  background: F.surface,
  color: F.inkSoft,
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  fontWeight: 650,
  padding: '0 8px',
  outline: 'none',
};

const stageProgressStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: `repeat(${PROJECT_STEP_DEFINITIONS.length}, minmax(0, 1fr))`,
  gap: 4,
};

function stageProgressSegmentStyle(active: boolean): CSSProperties {
  return {
    height: 3,
    borderRadius: 999,
    background: active ? F.accent : F.border,
  };
}

function quietButtonStyle(disabled?: boolean): CSSProperties {
  return {
    minHeight: 26,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: '0 7px',
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: F.inkSoft,
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    fontWeight: 650,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    whiteSpace: 'nowrap',
  };
}

const actionMenuStyle: CSSProperties = {
  position: 'absolute',
  top: 34,
  zIndex: 30,
  minWidth: 188,
  display: 'grid',
  gap: 2,
  padding: 5,
  border: `1px solid ${F.border}`,
  borderRadius: 8,
  background: F.surface,
  boxShadow: F.shadowPop,
};

function menuItemStyle(disabled?: boolean): CSSProperties {
  return {
    width: '100%',
    minHeight: 30,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: F.inkSoft,
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    fontWeight: 600,
    padding: '0 8px',
    textAlign: 'left',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

const statusTextStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  color: F.fg,
  fontSize: 11.5,
  lineHeight: 1.35,
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

function statusDotStyle(tone: StatusTone): CSSProperties {
  return {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: statusColor(tone),
    flexShrink: 0,
  };
}
