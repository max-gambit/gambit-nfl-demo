import { useEffect, useState } from 'react';
import { F } from '../theme/fenway';
import { useBriefs, useProjects, useToasts, useUi } from '../store';
import { on as onEvt } from '../lib/events';
import { regenerateBrief } from '../api/briefs';
import { BriefShareFlow } from './BriefShareFlow';
import { Icon } from '../ds/Icon';

export function BriefActions() {
  const { activeBriefId, briefs } = useBriefs();
  const {
    projects,
    projectsLoaded,
    loadProjects,
    createProject,
    attachBrief,
  } = useProjects();
  const { setActiveNav } = useUi();
  const { pushToast } = useToasts();
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const briefId = activeBriefId;
  const brief = briefId ? briefs.find((b) => b.id === briefId) : null;
  const canStartProject = brief?.status === 'ready' || brief?.status === 'partial';
  const defaultProjectTitle = brief ? (brief.thesis || brief.question).trim() : '';

  useEffect(() => {
    if (!projectOpen) return;
    if (!projectsLoaded) void loadProjects();
    if (!projectTitle) setProjectTitle(defaultProjectTitle);
  }, [defaultProjectTitle, loadProjects, projectOpen, projectTitle, projectsLoaded]);

  useEffect(() => {
    setProjectTitle('');
    setProjectOpen(false);
  }, [briefId]);

  // Slash-command bridge from the composer so `/regenerate` works without
  // aiming at the card footer.
  useEffect(() => onEvt('v6d3cf:slash-regenerate', () => { void onRegenerate(); }), [briefId]);

  const onRegenerate = async () => {
    if (!briefId || regenerating) return;
    setRegenerating(true);
    try {
      await regenerateBrief(briefId);
      pushToast({
        tone: 'info',
        message: 'Regenerating brief',
        detail: 'Sources, options, and reasoning will refresh in ~30–60s.',
      });
    } catch (err) {
      console.error('[brief-actions] regenerate failed', err);
      pushToast({
        tone: 'error',
        message: 'Couldn’t regenerate brief',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    } finally {
      setRegenerating(false);
    }
  };

  const onCreateProject = async () => {
    if (!briefId || !brief || !canStartProject || projectBusy) return;
    setProjectBusy(true);
    try {
      const project = await createProject({
        title: projectTitle.trim() || defaultProjectTitle || brief.question,
        question: brief.question,
        objective: 'Connect basketball context, cap/CBA validation, stakeholder feedback, and GM-ready recommendation from this source brief.',
        source_brief_id: briefId,
      });
      if (project) {
        setProjectOpen(false);
        setActiveNav('projects');
        pushToast({
          tone: 'success',
          message: 'Project started',
          detail: project.project.title,
        });
      }
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t start project',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    } finally {
      setProjectBusy(false);
    }
  };

  const onAttachProject = async (projectId: string) => {
    if (!briefId || !canStartProject || projectBusy) return;
    setProjectBusy(true);
    try {
      const result = await attachBrief(projectId, briefId);
      if (result) {
        setProjectOpen(false);
        setActiveNav('projects');
        pushToast({
          tone: result.already_attached ? 'info' : 'success',
          message: result.already_attached ? 'Already in project' : 'Added to project',
          detail: result.project.project.title,
        });
      }
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t add to project',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    } finally {
      setProjectBusy(false);
    }
  };

  const Action = ({
    icon, label, on, onClick, disabled, title,
  }: { icon: string; label: string; on?: boolean; onClick?: () => void; disabled?: boolean; title?: string }) => (
    <button onClick={onClick} disabled={disabled} title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        height: 28,
        padding: '0 9px',
        background: on ? F.cream50 : 'transparent',
        border: `1px solid ${on ? F.borderStrong : F.border}`,
        borderRadius: 6,
        fontFamily: 'var(--font-sans)', fontSize: 11.5, fontWeight: 600,
        color: on ? F.fenway : F.inkSoft,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = F.cream50; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = on ? F.cream50 : 'transparent'; }}
    >
      <Icon name={icon} size={12} />
      {label}
    </button>
  );

  return (
    <div data-print-hide="true" style={{
      marginTop: 8, paddingTop: 8,
      display: 'flex', alignItems: 'center', gap: 6,
      borderTop: `1px solid ${F.border}`,
      flexWrap: 'wrap',
    }}>
      <div style={{ position: 'relative' }}>
        <Action
          icon="plus"
          label="Start project"
          on={projectOpen}
          onClick={() => setProjectOpen((open) => !open)}
          disabled={!briefId || !canStartProject}
          title={canStartProject ? 'Create a project from this brief or add it to an existing project.' : 'Projects can start from a completed brief.'}
        />
        {projectOpen && briefId && canStartProject && (
          <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(27, 26, 23, 0.28)',
            padding: 20,
          }} onMouseDown={(event) => {
            if (event.target === event.currentTarget) setProjectOpen(false);
          }}>
            <div style={{
              width: 'min(720px, 100%)',
              maxHeight: 'min(680px, calc(100vh - 48px))',
              overflow: 'hidden',
              display: 'grid',
              gridTemplateRows: 'auto 1fr',
              background: F.surface,
              border: `1px solid ${F.borderStrong}`,
              borderRadius: 10,
              boxShadow: F.shadowPop,
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '14px 16px',
                borderBottom: `1px solid ${F.border}`,
              }}>
                <div>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 700,
                    color: F.fgMuted,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}>Project source</div>
                  <div style={{ marginTop: 3, fontFamily: 'var(--font-sans)', fontSize: 17, fontWeight: 700, color: F.ink }}>
                    Start / Add to Project
                  </div>
                </div>
                <button
                  onClick={() => setProjectOpen(false)}
                  title="Close"
                  style={{
                    width: 30,
                    height: 30,
                    display: 'grid',
                    placeItems: 'center',
                    border: `1px solid ${F.border}`,
                    borderRadius: 7,
                    background: F.surface,
                    color: F.fg,
                    cursor: 'pointer',
                    fontSize: 16,
                  }}
                >×</button>
              </div>

              <div style={{
                minHeight: 0,
                overflowY: 'auto',
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 0.85fr)',
                gap: 0,
              }}>
                <section style={{ padding: 16, borderRight: `1px solid ${F.border}` }}>
                  <div style={{
                    border: `1px solid ${F.border}`,
                    background: F.cream50,
                    borderRadius: 8,
                    padding: 11,
                    marginBottom: 12,
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      fontWeight: 700,
                      color: F.fgMuted,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      marginBottom: 5,
                    }}>Source brief</div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.4, color: F.inkSoft }}>
                      {brief?.thesis || brief?.question || 'Active brief'}
                    </div>
                  </div>

                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 700,
                    color: F.fgMuted,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    marginBottom: 8,
                  }}>New project</div>
                  <input
                    value={projectTitle}
                    onChange={(event) => setProjectTitle(event.target.value)}
                    placeholder="Project title"
                    maxLength={120}
                    style={{
                      width: '100%',
                      height: 34,
                      border: `1px solid ${F.border}`,
                      borderRadius: 7,
                      padding: '0 9px',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 13,
                      color: F.ink,
                      boxSizing: 'border-box',
                      marginBottom: 10,
                    }}
                  />
                  <button
                    onClick={() => void onCreateProject()}
                    disabled={projectBusy}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 7,
                      width: '100%',
                      minHeight: 34,
                      background: F.fenway,
                      color: '#fff',
                      border: 'none',
                      borderRadius: 7,
                      fontFamily: 'var(--font-sans)',
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: projectBusy ? 'wait' : 'pointer',
                      opacity: projectBusy ? 0.65 : 1,
                    }}
                  >
                    <Icon name="plus" size={13} />
                    Start project
                  </button>
                </section>

                <section style={{ padding: 16 }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 700,
                    color: F.fgMuted,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    marginBottom: 8,
                  }}>Existing projects</div>
                  <div style={{ display: 'grid', gap: 7, maxHeight: 420, overflowY: 'auto' }}>
                    {projects.length === 0 && (
                      <div style={{ color: F.fgMuted, fontSize: 12, lineHeight: 1.4 }}>
                        No existing projects.
                      </div>
                    )}
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => void onAttachProject(project.id)}
                        disabled={projectBusy}
                        title={project.title}
                        style={{
                          display: 'grid',
                          gap: 4,
                          width: '100%',
                          padding: '9px',
                          background: F.cream50,
                          border: `1px solid ${F.border}`,
                          borderRadius: 7,
                          cursor: projectBusy ? 'wait' : 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <span style={{
                          fontFamily: 'var(--font-sans)',
                          fontSize: 12.5,
                          color: F.inkSoft,
                          fontWeight: 650,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>{project.title}</span>
                        <span style={{
                          display: 'flex',
                          gap: 8,
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: F.fgMuted,
                        }}>
                          <span>{project.active_step}</span>
                          <span>{project.linked_brief_count} sources</span>
                          <span>{project.package_status}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}
      </div>
      <BriefShareFlow briefId={briefId} />
      <div style={{ flex: '1 1 12px', minWidth: 8 }} />
      <button onClick={() => void onRegenerate()} disabled={!briefId || regenerating}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          padding: '0 9px',
          background: 'transparent',
          border: `1px solid ${F.border}`,
          borderRadius: 6,
          fontFamily: 'var(--font-sans)', fontSize: 11.5, color: F.fgMuted,
          fontWeight: 600, cursor: regenerating ? 'wait' : 'pointer',
          opacity: regenerating ? 0.6 : 1,
          whiteSpace: 'nowrap',
        }}>
          <Icon name="refresh" size={12} />
          {regenerating ? 'Regenerating…' : 'Regenerate'}
        </button>
    </div>
  );
}
