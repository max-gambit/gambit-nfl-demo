import { useEffect, type ReactNode } from 'react';
import { F } from '../theme/fenway';
import { Header } from './Header';
import { LeftRail } from './LeftRail';
import { SessionFeed } from './SessionFeed';
import { BriefRightPanel } from './BriefRightPanel';
import { KeyboardHelp } from './KeyboardHelp';
import { fire } from '../lib/events';
import { useNewChannel } from '../lib/useNewChannel';
import { createBrief } from '../api/briefs';
import { createSession } from '../api/sessions';
import { PaletteOverlay } from '../agents/PaletteOverlay';
import { DashboardView, type DashboardFeedAnalysisRequest } from '../dashboard/DashboardView';
import { CompareView } from '../briefs/CompareView';
import { WizardsWarRoom } from '../war-room/WizardsWarRoom';
import { NbaRosterDatabase, NbaRosterLeftPanel } from '../database/NbaRosterDatabase';
import { CbaWorkbench } from '../cba/CbaWorkbench';
import { ProjectsView } from '../projects/ProjectsView';
import { SettingsView } from '../settings/SettingsView';
import { useBriefs, useSessions, useToasts, useUi } from '../store';
import type { NavTab } from '../store/ui';

interface FenwayAppProps {
  leftRailExtra?: ReactNode;
  tabBarOverride?: ReactNode;
  trayBetween?: ReactNode;
}

export function FenwayApp({
  leftRailExtra = null,
  tabBarOverride,
  trayBetween,
}: FenwayAppProps) {
  const {
    paletteOpen, helpOpen, railCollapsed,
    activeNav, compareTargetBriefId,
    setPaletteOpen, setHelpOpen,
    setActiveNav,
    setExpandedBrief, setRightPanelMode, setRightPanelOpen,
    togglePalette, toggleHelp, toggleRailCollapsed,
  } = useUi();
  const { insertBrief, loadAllBriefs, setActiveBrief } = useBriefs();
  const { sessions, insertSession, setActiveSession } = useSessions();
  const { pushToast } = useToasts();
  const startNewChannel = useNewChannel();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (isDeepLinkNavTab(tab)) setActiveNav(tab);
  }, [setActiveNav]);

  // Phase 9 — clicking a brief from Dashboard / Projects / search jumps into the
  // active session, expands the brief in the channel feed, and opens the
  // right panel's thread mode for it.
  const gotoBrief = (id: string, sessionId?: string) => {
    void (async () => {
      await loadAllBriefs();
      if (sessionId) setActiveSession(sessionId);
      setActiveBrief(id);
      setExpandedBrief(id);
      setRightPanelMode('thread');
      setRightPanelOpen(true);
      setActiveNav('analyze');
    })();
  };

  const analyzeFeedItem = async (request: DashboardFeedAnalysisRequest) => {
    try {
      const existingSession = sessions.find((s) => s.label === request.sessionLabel);
      const session = existingSession ?? await createSession(request.sessionLabel);
      if (!existingSession) insertSession(session);
      setActiveSession(session.id);

      const brief = await createBrief({
        session_id: session.id,
        question: request.prompt,
        mode: 'brief',
      });
      insertBrief(brief);
      setExpandedBrief(brief.id);
      setRightPanelMode('thread');
      setRightPanelOpen(true);
      setActiveNav('analyze');
      pushToast({
        tone: 'info',
        message: 'Analyzing feed item',
        detail: request.title,
      });
    } catch (err) {
      console.error('[dashboard] analyze feed item failed', err);
      pushToast({
        tone: 'error',
        message: 'Couldn’t analyze feed item',
        detail: err instanceof Error ? err.message : 'Server unreachable.',
      });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const inField = target?.closest('input, textarea');

      if (cmd && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        fire('v6d3cf:focus-composer');
        return;
      }
      // ⌘B — focus the brief-thread reply composer in the right panel.
      if (cmd && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        fire('v6d3cf:focus-reply-composer');
        return;
      }
      if (cmd && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
        return;
      }
      // ⌘N — new channel: skips any modal, lands on a fresh Untitled channel
      // with the composer focused and ready for the first question.
      if (cmd && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void startNewChannel();
        return;
      }
      if (cmd && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        fire('v6d3cf:last-brief');
        return;
      }
      if (cmd && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        fire('v6d3cf:goto-brief', { index: idx });
        return;
      }
      if (cmd && (e.key === '[' || e.key === ']')) {
        e.preventDefault();
        fire('v6d3cf:cycle-brief', { dir: e.key === '[' ? 'prev' : 'next' });
        return;
      }
      if ((cmd && e.key === '/') || (e.key === '?' && !inField)) {
        e.preventDefault();
        toggleHelp();
        return;
      }
    };

    const onOpenPalette = () => setPaletteOpen(true);
    const onToggleHelp = () => toggleHelp();

    window.addEventListener('keydown', onKey);
    window.addEventListener('v6d3cf:open-palette', onOpenPalette);
    window.addEventListener('v6d3cf:toggle-help', onToggleHelp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('v6d3cf:open-palette', onOpenPalette);
      window.removeEventListener('v6d3cf:toggle-help', onToggleHelp);
    };
  }, [togglePalette, toggleHelp, setPaletteOpen, startNewChannel]);

  // Compare overrides everything — full main pane, no right panel.
  // Feed owns its own pane; no Analyze rail or right panel.
  // Otherwise (Analyze) → ChannelHeader + SessionFeed in main, BriefRightPanel on the right.
  const showAnalyzeSurface = activeNav === 'analyze' && compareTargetBriefId === null;
  const showGlobalLeftRail = activeNav !== 'dashboard' && activeNav !== 'cba' && activeNav !== 'projects' && activeNav !== 'settings';

  return (
    <div className={activeNav === 'dashboard' ? 'fenway-app-dashboard' : undefined} style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: 'hidden', background: F.paper, position: 'relative',
    }}>
      <Header trayBetween={trayBetween} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {showGlobalLeftRail && (
          <LeftRail
            extra={leftRailExtra}
            contentOverride={activeNav === 'database' ? <NbaRosterLeftPanel /> : null}
            collapsed={railCollapsed}
            onToggle={toggleRailCollapsed}
          />
        )}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
          {activeNav === 'dashboard' ? (
            <DashboardView
              onJumpToBrief={gotoBrief}
              onAnalyzeFeedItem={analyzeFeedItem}
            />
          ) : activeNav === 'war_room' ? (
            <WizardsWarRoom />
          ) : activeNav === 'projects' ? (
            <ProjectsView onJumpToBrief={gotoBrief} />
          ) : activeNav === 'database' ? (
            <NbaRosterDatabase />
          ) : activeNav === 'cba' ? (
            <CbaWorkbench />
          ) : activeNav === 'settings' ? (
            <SettingsView />
          ) : compareTargetBriefId !== null ? (
            <>
              {tabBarOverride ?? null}
              <CompareView />
            </>
          ) : (
            <>
              {tabBarOverride ?? null}
              <SessionFeed />
            </>
          )}
        </main>
        {showAnalyzeSurface && <BriefRightPanel />}
      </div>
      <PaletteOverlay open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <KeyboardHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function isDeepLinkNavTab(value: string | null): value is NavTab {
  return value === 'dashboard'
    || value === 'analyze'
    || value === 'projects'
    || value === 'database'
    || value === 'cba'
    || value === 'settings';
}
