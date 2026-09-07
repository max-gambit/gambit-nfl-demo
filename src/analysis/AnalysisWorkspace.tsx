import { useEffect, useMemo, useState } from 'react';
import { RailChannels } from '../briefs/RailChannels';
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

/** The primary question -> analysis -> evidence -> follow-up workspace. */
export function AnalysisWorkspace() {
  const [channelDrawerOpen, setChannelDrawerOpen] = useState(false);
  const { sessionsLoaded, loadSessions } = useSessions();
  const {
    briefs,
    sourcesByBrief,
    activeBriefId,
    loadAllBriefs,
    loadBriefData,
    loadArtifacts,
    subscribeBriefUpdates,
    subscribeArtifactInserts,
  } = useBriefs();
  const { loadTrayItems, subscribeAgentRuns } = useTray();
  const { loadBookmarks } = useBookmarks();
  const { loadMonitors, subscribeMonitors, acknowledgeBriefAlerts } = useMonitors();
  const {
    railCollapsed,
    rightPanelOpen,
    setRightPanelOpen,
    setSelectedOptionRef,
    setSourceFilterRefs,
    setSelectedSourceRef,
    toggleRailCollapsed,
  } = useUi();
  const startNewChannel = useNewChannel();
  const activeBrief = useMemo(
    () => briefs.find((brief) => brief.id === activeBriefId) ?? null,
    [briefs, activeBriefId],
  );
  const hasEvidence = Boolean(
    activeBrief?.status === 'ready'
    && activeBrief.body
    && activeBriefId
    && (sourcesByBrief[activeBriefId]?.length ?? 0) > 0,
  );

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
      void loadArtifacts(activeBriefId);
    }
    setSelectedOptionRef(null);
    setSourceFilterRefs(null);
    setSelectedSourceRef(null);
    setChannelDrawerOpen(false);
  }, [
    activeBriefId,
    acknowledgeBriefAlerts,
    loadBriefData,
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

  useEffect(() => {
    if (hasEvidence) setRightPanelOpen(true);
  }, [activeBriefId, hasEvidence, setRightPanelOpen]);

  useEffect(() => onEvt('v6d3cf:open-evidence', () => setRightPanelOpen(true)), [setRightPanelOpen]);

  if (!sessionsLoaded) {
    return (
      <div className="analysis-loading" role="status">
        <strong>Opening Analysis…</strong>
        <span>Loading the Giants questions and evidence.</span>
      </div>
    );
  }

  return (
    <div className="analysis-workspace">
      <div className="analysis-workspace-canvas">
        {(channelDrawerOpen || (hasEvidence && rightPanelOpen)) && (
          <button
            type="button"
            className="analysis-evidence-backdrop"
            aria-label="Close open panel"
            onClick={() => {
              setChannelDrawerOpen(false);
              setRightPanelOpen(false);
            }}
          />
        )}
        <div className={`analysis-channel-rail${channelDrawerOpen ? ' open' : ''}`}>
          <LeftRail
            contentOverride={<RailChannels />}
            collapsed={railCollapsed}
            onToggle={toggleRailCollapsed}
            side="left"
          />
        </div>
        <main className="analysis-workspace-main">
          <button
            type="button"
            className="analysis-channels-trigger"
            onClick={() => setChannelDrawerOpen(true)}
          >Channels</button>
          {hasEvidence && (
            <button
              type="button"
              className="analysis-evidence-trigger"
              onClick={() => setRightPanelOpen(true)}
            >Evidence</button>
          )}
          <ChannelHeader evidenceAvailable={hasEvidence} />
          <SessionFeed />
        </main>
        {hasEvidence && (
          <div className={`analysis-evidence-rail${rightPanelOpen ? ' open' : ''}`}>
            <LeftRail
              collapsed={!rightPanelOpen}
              onToggle={() => setRightPanelOpen(!rightPanelOpen)}
              side="right"
            />
          </div>
        )}
      </div>
      <Toaster />
    </div>
  );
}
