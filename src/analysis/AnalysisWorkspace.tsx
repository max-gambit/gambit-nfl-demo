import { useEffect, useRef, useState } from 'react';
import { RailChannels } from '../briefs/RailChannels';
import { BriefRightPanel } from '../fenway/BriefRightPanel';
import { ChannelHeader } from '../fenway/ChannelHeader';
import { LeftRail } from '../fenway/LeftRail';
import { SessionFeed } from '../fenway/SessionFeed';
import { Toaster } from '../fenway/Toaster';
import { fire, on as onEvt } from '../lib/events';
import { useNewChannel } from '../lib/useNewChannel';
import {
  useBookmarks,
  useBriefs,
  useMonitors,
  useSessions,
  useTray,
  useUi,
} from '../store';

const TY_TRANSACTION_MARKET_QUESTION = 'Which position markets have grown or shrunk over the last 10 years, and what does that imply for trade strategy?';

interface AnalysisWorkspaceProps {
  presenter?: boolean;
}

/** The primary question -> analysis -> evidence -> follow-up workspace. */
export function AnalysisWorkspace({ presenter = false }: AnalysisWorkspaceProps) {
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);
  const presentationInitialized = useRef(false);
  const { sessions, activeSessionId, sessionsLoaded, loadSessions, setActiveSession } = useSessions();
  const {
    briefs,
    briefsLoaded,
    activeBriefId,
    setActiveBrief,
    loadAllBriefs,
    loadBriefData,
    loadTurns,
    loadArtifacts,
    subscribeBriefUpdates,
    subscribeArtifactInserts,
  } = useBriefs();
  const { loadTrayItems, subscribeAgentRuns } = useTray();
  const { loadBookmarks } = useBookmarks();
  const { loadMonitors, subscribeMonitors, acknowledgeBriefAlerts } = useMonitors();
  const {
    railCollapsed,
    setRailCollapsed,
    setExpandedBrief,
    setRightPanelMode,
    setRightPanelOpen,
    setSelectedOptionRef,
    setSourceFilterRefs,
    setSelectedSourceRef,
    toggleRailCollapsed,
  } = useUi();
  const startNewChannel = useNewChannel();

  useEffect(() => {
    if (presentationInitialized.current || !sessionsLoaded || !briefsLoaded) return;
    const tyBrief = [...briefs]
      .filter((brief) => brief.question.trim() === TY_TRANSACTION_MARKET_QUESTION)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())[0];
    const presentationSession = presenter
      ? sessions.find((session) => session.id === tyBrief?.session_id) ?? null
      : sessions.length === 1 && tyBrief?.session_id === sessions[0].id ? sessions[0] : null;
    if (!presentationSession) return;

    const targetBrief = tyBrief;
    if (!targetBrief) return;

    presentationInitialized.current = true;
    if (activeSessionId !== presentationSession.id) setActiveSession(presentationSession.id);
    setActiveBrief(targetBrief.id);
    setExpandedBrief(targetBrief.id);
    setRightPanelMode('list');
    setRightPanelOpen(false);
    setRailCollapsed(true);
    setEvidenceDrawerOpen(false);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const card = document.querySelector<HTMLElement>(`[data-brief-id="${targetBrief.id}"] [data-recommendation-card="true"]`);
        card?.scrollIntoView({ block: 'start' });
      });
    });
  }, [
    activeSessionId,
    briefs,
    briefsLoaded,
    presenter,
    sessions,
    sessionsLoaded,
    setActiveBrief,
    setActiveSession,
    setExpandedBrief,
    setRailCollapsed,
    setRightPanelMode,
    setRightPanelOpen,
  ]);

  useEffect(() => {
    void loadSessions();
    void loadAllBriefs();
    void loadBookmarks();
    void loadMonitors();
    void loadTrayItems();
    const offBriefs = subscribeBriefUpdates();
    const offArtifacts = subscribeArtifactInserts();
    const offRuns = subscribeAgentRuns();
    const offMonitors = subscribeMonitors();
    return () => {
      offBriefs();
      offArtifacts();
      offRuns();
      offMonitors();
    };
  }, [
    loadSessions,
    loadAllBriefs,
    loadBookmarks,
    loadMonitors,
    loadTrayItems,
    subscribeBriefUpdates,
    subscribeArtifactInserts,
    subscribeAgentRuns,
    subscribeMonitors,
  ]);

  useEffect(() => {
    if (activeBriefId) {
      void acknowledgeBriefAlerts(activeBriefId);
      void loadBriefData(activeBriefId);
      void loadTurns(activeBriefId);
      void loadArtifacts(activeBriefId);
    }
    setSelectedOptionRef(null);
    setSourceFilterRefs(null);
    setSelectedSourceRef(null);
  }, [
    activeBriefId,
    acknowledgeBriefAlerts,
    loadBriefData,
    loadTurns,
    loadArtifacts,
    setSelectedOptionRef,
    setSourceFilterRefs,
    setSelectedSourceRef,
  ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        fire('v6d3cf:focus-composer');
      }
      if (command && !event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        void startNewChannel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [startNewChannel]);

  useEffect(() => onEvt('v6d3cf:open-evidence', () => setEvidenceDrawerOpen(true)), []);

  if (!sessionsLoaded) {
    return (
      <div className="analysis-loading" role="status">
        <strong>Opening Analysis…</strong>
        <span>Loading the Giants questions and evidence.</span>
      </div>
    );
  }

  return (
    <div className="analysis-workspace" data-presenter={presenter ? 'true' : 'false'}>
      <div className="analysis-workspace-canvas">
        {evidenceDrawerOpen && (
          <button
            type="button"
            className="analysis-evidence-backdrop"
            aria-label="Close evidence panel"
            onClick={() => setEvidenceDrawerOpen(false)}
          />
        )}
        <div className={`analysis-evidence-rail${evidenceDrawerOpen ? ' open' : ''}`}>
          <LeftRail
            extra={<RailChannels readOnly={presenter} />}
            collapsed={railCollapsed}
            onToggle={toggleRailCollapsed}
          />
        </div>
        <main className="analysis-workspace-main">
          <button
            type="button"
            className="analysis-evidence-trigger"
            onClick={() => setEvidenceDrawerOpen(true)}
          >Why this answer</button>
          <ChannelHeader readOnly={presenter} />
          <SessionFeed presenter={presenter} />
        </main>
        <BriefRightPanel />
      </div>
      <Toaster />
    </div>
  );
}
