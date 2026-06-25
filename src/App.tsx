import { useEffect, useState } from 'react';
import { FenwayApp } from './fenway/FenwayApp';
import { RailChannels } from './briefs/RailChannels';
import { ChannelHeader } from './fenway/ChannelHeader';
import { Tray } from './agents/Tray';
import { Toaster } from './fenway/Toaster';
import { getContextGraphOnboarding } from './api/contextGraph';
import type { ContextGraphOnboardingViewModel } from '@shared/types';
import { ContextGraphOnboardingFlow, WIZARDS_ONBOARDING_LOCAL_KEY } from './onboarding/ContextGraphOnboardingFlow';
import {
  CONTEXT_GRAPH_FORCE_ANALYZE_START,
  CONTEXT_GRAPH_ONBOARDING_DISABLED,
  CONTEXT_GRAPH_ONBOARDING_TEAM_ID,
} from './onboarding/config';
import {
  PostOnboardingLaunch,
  WIZARDS_ONBOARDING_LAUNCH_BRIEF_KEY,
  WIZARDS_ONBOARDING_LAUNCH_DISMISSED_KEY,
  WIZARDS_ONBOARDING_LAUNCH_SESSION_KEY,
} from './onboarding/PostOnboardingLaunch';
import { resolveBriefShareToken } from './api/briefs';
import { useBookmarks, useBriefs, useMonitors, useProjects, useSessions, useToasts, useTray, useUi } from './store';

// V8_App_A5b — the canonical composition.
//
// Phase 9: Slack master/detail Analyze surface — channel feed in main pane,
// right panel for brief list / thread, channel composer at bottom.
export default function App() {
  const [checkingOnboarding, setCheckingOnboarding] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [launchOnboarding, setLaunchOnboarding] = useState<ContextGraphOnboardingViewModel | null>(null);
  const {
    sessionsLoaded,
    loadSessions,
    setActiveSession,
  } = useSessions();
  const {
    briefs, activeBriefId, briefsLoaded,
    setActiveBrief, loadAllBriefs, loadBriefData, loadTurns, loadArtifacts,
    subscribeBriefUpdates, subscribeArtifactInserts,
  } = useBriefs();
  const {
    loadTrayItems, subscribeAgentRuns,
  } = useTray();
  const { loadBookmarks } = useBookmarks();
  const { loadProjects } = useProjects();
  const { loadMonitors, subscribeMonitors, acknowledgeBriefAlerts } = useMonitors();
  const { pushToast } = useToasts();
  const {
    setExpandedBrief, setRightPanelMode, setRightPanelOpen,
    setActiveNav, expandedBriefId, rightPanelMode,
    setSelectedOptionRef, setSourceFilterRefs, setSelectedSourceRef,
  } = useUi();

  useEffect(() => {
    if (CONTEXT_GRAPH_ONBOARDING_DISABLED) {
      setLaunchOnboarding(null);
      setShowOnboarding(false);
      setCheckingOnboarding(false);
      return undefined;
    }
    let cancelled = false;
    const localComplete = window.localStorage.getItem(WIZARDS_ONBOARDING_LOCAL_KEY) === 'true';
    getContextGraphOnboarding(CONTEXT_GRAPH_ONBOARDING_TEAM_ID)
      .then((onboarding) => {
        if (cancelled) return;
        const graphComplete = onboarding.profile.status === 'completed';
        if (graphComplete && !localComplete) {
          window.localStorage.setItem(WIZARDS_ONBOARDING_LOCAL_KEY, 'true');
        }
        if (!graphComplete) {
          window.localStorage.removeItem(WIZARDS_ONBOARDING_LOCAL_KEY);
          window.localStorage.removeItem(WIZARDS_ONBOARDING_LAUNCH_BRIEF_KEY);
          window.localStorage.removeItem(WIZARDS_ONBOARDING_LAUNCH_SESSION_KEY);
          window.localStorage.removeItem(WIZARDS_ONBOARDING_LAUNCH_DISMISSED_KEY);
          setLaunchOnboarding(null);
        } else if (window.localStorage.getItem(WIZARDS_ONBOARDING_LAUNCH_DISMISSED_KEY) !== 'true') {
          setLaunchOnboarding(onboarding);
        }
        setShowOnboarding(!graphComplete);
      })
      .catch(() => {
        if (!cancelled) setShowOnboarding(!localComplete);
      })
      .finally(() => {
        if (!cancelled) setCheckingOnboarding(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!CONTEXT_GRAPH_FORCE_ANALYZE_START) return;
    setActiveNav('analyze');
    setExpandedBrief(null);
    setRightPanelMode('list');
    setRightPanelOpen(true);
  }, [setActiveNav, setExpandedBrief, setRightPanelMode, setRightPanelOpen]);

  // Initial load: sessions + every brief across the workspace + Realtime
  // subscriptions for status flips and artifact inserts.
  useEffect(() => {
    void loadSessions();
    void loadAllBriefs();
    void loadBookmarks();
    void loadProjects();
    void loadMonitors();
    const offBriefs = subscribeBriefUpdates();
    const offArtifacts = subscribeArtifactInserts();
    void loadTrayItems();
    const offRuns = subscribeAgentRuns();
    const offMonitors = subscribeMonitors();
    return () => {
      offBriefs();
      offArtifacts();
      offRuns();
      offMonitors();
    };
  }, [
    loadSessions, loadAllBriefs, loadBookmarks, loadProjects, loadMonitors,
    subscribeBriefUpdates, subscribeArtifactInserts, loadTrayItems,
    subscribeAgentRuns, subscribeMonitors,
  ]);

  const [deepLinkHandled, setDeepLinkHandled] = useState(false);

  // Deep-link: ?brief=<id> activates a known brief; ?share=<token> resolves
  // through the server first, then opens the same Analyze/thread view. Strip
  // params afterwards so refreshes do not keep overriding the user's focus.
  useEffect(() => {
    if (deepLinkHandled || !sessionsLoaded || !briefsLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('brief');
    const shareToken = params.get('share');
    if (!linked && !shareToken) {
      setDeepLinkHandled(true);
      return;
    }

    let cancelled = false;
    const activate = async () => {
      try {
        let briefId = linked;
        let sessionId: string | null = null;
        if (shareToken) {
          const resolved = await resolveBriefShareToken(shareToken);
          briefId = resolved.brief_id;
          sessionId = resolved.session_id;
        } else if (linked) {
          sessionId = briefs.find((brief) => brief.id === linked)?.session_id ?? null;
        }
        if (!briefId || cancelled) return;
        if (sessionId) setActiveSession(sessionId);
        setActiveBrief(briefId);
        setExpandedBrief(briefId);
        setRightPanelMode('thread');
        setRightPanelOpen(true);
        setActiveNav('analyze');
      } catch (err) {
        if (!cancelled) {
          pushToast({
            tone: 'error',
            message: 'Couldn’t open shared brief',
            detail: err instanceof Error ? err.message : 'Share link could not be resolved.',
          });
        }
      } finally {
        if (!cancelled) {
          params.delete('brief');
          params.delete('share');
          const next = params.toString();
          const url = `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`;
          window.history.replaceState({}, '', url);
          setDeepLinkHandled(true);
        }
      }
    };

    void activate();
    return () => {
      cancelled = true;
    };
  }, [
    briefs, briefsLoaded, deepLinkHandled, sessionsLoaded, pushToast, setActiveBrief,
    setActiveNav, setActiveSession, setExpandedBrief, setRightPanelMode, setRightPanelOpen,
  ]);

  // When the active brief changes, mark its monitors' pending alerts as seen
  // so the badge clears once the user lands on the brief.
  useEffect(() => {
    if (activeBriefId) void acknowledgeBriefAlerts(activeBriefId);
  }, [activeBriefId, acknowledgeBriefAlerts]);

  // When the active brief changes, eagerly fetch its sources/options/turns
  // and any pre-existing artifacts so LeftRail, OptionsTable, the channel
  // feed, and the ArtifactStrip render against real data.
  useEffect(() => {
    if (activeBriefId) {
      void loadBriefData(activeBriefId);
      void loadTurns(activeBriefId);
      void loadArtifacts(activeBriefId);
    }
    setSelectedOptionRef(null);
    setSourceFilterRefs(null);
    setSelectedSourceRef(null);
  }, [
    activeBriefId, loadBriefData, loadTurns, loadArtifacts,
    setSelectedOptionRef, setSourceFilterRefs, setSelectedSourceRef,
  ]);

  // Phase 9 — clear stale persisted `expandedBriefId` if it points to a brief
  // that no longer exists (e.g. after `npm run db:reset`). And drop thread
  // mode back to list when the focus is lost.
  useEffect(() => {
    if (expandedBriefId && briefs.length > 0 && !briefs.some((b) => b.id === expandedBriefId)) {
      setExpandedBrief(null);
      if (rightPanelMode === 'thread') setRightPanelMode('list');
    }
  }, [expandedBriefId, briefs, rightPanelMode, setExpandedBrief, setRightPanelMode]);

  const railExtra = <RailChannels />;

  // Phase 9 — channel header replaces the old "open briefs" tabs strip.
  const tabBar = <ChannelHeader />;

  // Empty state during initial fetch — keep it minimal so we don't flash
  // an empty FenwayApp shell while the store hydrates.
  if (!sessionsLoaded || checkingOnboarding) {
    return null;
  }

  if (showOnboarding) {
    return (
      <>
        <ContextGraphOnboardingFlow
          onComplete={(completed) => {
            window.localStorage.removeItem(WIZARDS_ONBOARDING_LAUNCH_DISMISSED_KEY);
            setShowOnboarding(false);
            setLaunchOnboarding(completed);
          }}
        />
        <Toaster />
      </>
    );
  }

  if (launchOnboarding) {
    return (
      <>
        <PostOnboardingLaunch onboarding={launchOnboarding} onDone={() => setLaunchOnboarding(null)} />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <FenwayApp
        leftRailExtra={railExtra}
        tabBarOverride={tabBar}
        trayBetween={<Tray placement="header-between" />}
      />
      <Toaster />
    </>
  );
}
