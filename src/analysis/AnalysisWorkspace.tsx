import { useEffect, useState } from 'react';
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

interface AnalysisWorkspaceProps {
  presenter?: boolean;
}

/** The primary question -> analysis -> evidence -> follow-up workspace. */
export function AnalysisWorkspace({ presenter = false }: AnalysisWorkspaceProps) {
  const [evidenceDrawerOpen, setEvidenceDrawerOpen] = useState(false);
  const { sessionsLoaded, loadSessions } = useSessions();
  const {
    activeBriefId,
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
    setSelectedOptionRef,
    setSourceFilterRefs,
    setSelectedSourceRef,
    toggleRailCollapsed,
  } = useUi();
  const startNewChannel = useNewChannel();

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
        <span>Loading the Giants decision workspace and evidence graph.</span>
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
          >Evidence pack</button>
          <ChannelHeader readOnly={presenter} />
          <SessionFeed presenter={presenter} />
        </main>
        <BriefRightPanel />
      </div>
      <Toaster />
    </div>
  );
}
