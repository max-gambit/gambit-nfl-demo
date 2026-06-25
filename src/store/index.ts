// Zustand root store, composed of focused slices.
// Runtime data loads from Supabase/API routes; persisted state is limited to
// local UI selection so seeded/generated content can be cleared cleanly.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { SessionsSlice } from './sessions';
import { createSessionsSlice } from './sessions';
import type { BriefsSlice } from './briefs';
import { createBriefsSlice } from './briefs';
import type { TraySlice } from './tray';
import { createTraySlice } from './tray';
import type { UiSlice } from './ui';
import { createUiSlice, RIGHT_PANEL_DEFAULT_WIDTH } from './ui';
import type { CbaSlice } from './cba';
import { createCbaSlice } from './cba';
import type { BookmarksSlice } from './bookmarks';
import { createBookmarksSlice } from './bookmarks';
import type { ProjectsSlice } from './projects';
import { createProjectsSlice } from './projects';
import type { MonitorsSlice } from './monitors';
import { createMonitorsSlice } from './monitors';
import type { ToastsSlice } from './toasts';
import { createToastsSlice } from './toasts';

export type RootStore = SessionsSlice & BriefsSlice & TraySlice & UiSlice & CbaSlice & BookmarksSlice & ProjectsSlice & MonitorsSlice & ToastsSlice;

// Persist only the active selection — narrow surface so a stale storage
// value can't poison the rest of the store. The actual session + brief data
// always re-fetches from Supabase on mount; storage just hints which to
// activate after the load finishes.
export const useStore = create<RootStore>()(
  persist(
    (...a) => ({
      ...createSessionsSlice(...a),
      ...createBriefsSlice(...a),
      ...createTraySlice(...a),
      ...createUiSlice(...a),
      ...createCbaSlice(...a),
      ...createBookmarksSlice(...a),
      ...createProjectsSlice(...a),
      ...createMonitorsSlice(...a),
      ...createToastsSlice(...a),
    }),
    {
      name: 'gambit-nfl-demo-state-nyg-v1',
      // Bumped for the NFL demo identity/default POV. Mismatched versions
      // migrate through this narrow persisted surface instead of dropping the
      // app into Zustand's no-migrate warning path.
      version: 15,
      migrate: (persisted) => {
        const s = persisted as Partial<RootStore>;
        const storedNav = s.activeNav as string | undefined;
        const activeNav = storedNav === 'saved'
          ? 'projects'
          : isPersistedNav(storedNav) ? storedNav : 'analyze';
        return {
          activeSessionId: null,
          activeBriefId: null,
          activeNav,
          databaseTeamId: 'NYG',
          databasePlayerId: null,
          databaseCapRowId: null,
          databaseStatKey: null,
          activeProjectId: null,
          expandedBriefId: null,
          rightPanelMode: 'list' as const,
          rightPanelWidth: s.rightPanelWidth ?? RIGHT_PANEL_DEFAULT_WIDTH,
          rightPanelOpen: s.rightPanelOpen ?? true,
        };
      },
      partialize: (s) => ({
        activeSessionId: s.activeSessionId,
        activeBriefId: s.activeBriefId,
        activeNav: s.activeNav,
        databaseTeamId: s.databaseTeamId,
        databasePlayerId: s.databasePlayerId,
        databaseCapRowId: s.databaseCapRowId,
        databaseStatKey: s.databaseStatKey,
        activeProjectId: s.activeProjectId,
        expandedBriefId: s.expandedBriefId,
        rightPanelMode: s.rightPanelMode,
        rightPanelWidth: s.rightPanelWidth,
        rightPanelOpen: s.rightPanelOpen,
      }),
    },
  ),
);

// Convenience hooks. `useShallow` memoizes the selector result by shallow-
// equal so React's `useSyncExternalStore` doesn't see a new object on every
// render — without it, React 18 throws the "getSnapshot should be cached to
// avoid an infinite loop" warning and can fail to mount.

export const useUi = () => useStore(useShallow((s) => ({
  paletteOpen: s.paletteOpen,
  helpOpen: s.helpOpen,
  sessionsExpanded: s.sessionsExpanded,
  railCollapsed: s.railCollapsed,
  activeNav: s.activeNav,
  databaseTeamId: s.databaseTeamId,
  databasePlayerId: s.databasePlayerId,
  databaseCapRowId: s.databaseCapRowId,
  databaseStatKey: s.databaseStatKey,
  compareTargetBriefId: s.compareTargetBriefId,
  expandedBriefId: s.expandedBriefId,
  rightPanelMode: s.rightPanelMode,
  rightPanelWidth: s.rightPanelWidth,
  rightPanelOpen: s.rightPanelOpen,
  sourceFilterRefs: s.sourceFilterRefs,
  sourceFilterRef: s.sourceFilterRef,
  highlightedSourceRef: s.highlightedSourceRef,
  selectedOptionRef: s.selectedOptionRef,
  setPaletteOpen: s.setPaletteOpen,
  setHelpOpen: s.setHelpOpen,
  setActiveNav: s.setActiveNav,
  setDatabaseTeamId: s.setDatabaseTeamId,
  setDatabasePlayerId: s.setDatabasePlayerId,
  setDatabaseCapRowId: s.setDatabaseCapRowId,
  setDatabaseStatKey: s.setDatabaseStatKey,
  setCompareTargetBriefId: s.setCompareTargetBriefId,
  setExpandedBrief: s.setExpandedBrief,
  setRightPanelMode: s.setRightPanelMode,
  setRightPanelWidth: s.setRightPanelWidth,
  setRightPanelOpen: s.setRightPanelOpen,
  togglePalette: s.togglePalette,
  toggleHelp: s.toggleHelp,
  toggleSessionsExpanded: s.toggleSessionsExpanded,
  toggleRailCollapsed: s.toggleRailCollapsed,
  setSourceFilterRefs: s.setSourceFilterRefs,
  setSourceFilterRef: s.setSourceFilterRef,
  setHighlightedSourceRef: s.setHighlightedSourceRef,
  selectedSourceRef: s.selectedSourceRef,
  setSelectedSourceRef: s.setSelectedSourceRef,
  setSelectedOptionRef: s.setSelectedOptionRef,
})));

export const useSessions = () => useStore(useShallow((s) => ({
  sessions: s.sessions,
  activeSessionId: s.activeSessionId,
  sessionsLoaded: s.sessionsLoaded,
  setActiveSession: s.setActiveSession,
  loadSessions: s.loadSessions,
  insertSession: s.insertSession,
  removeSession: s.removeSession,
  patchSessionLabel: s.patchSessionLabel,
})));

export const useBriefs = () => useStore(useShallow((s) => ({
  briefs: s.briefs,
  activeBriefId: s.activeBriefId,
  turnsByBrief: s.turnsByBrief,
  sourcesByBrief: s.sourcesByBrief,
  optionsByBrief: s.optionsByBrief,
  artifactsByBrief: s.artifactsByBrief,
  loadingTurnsFor: s.loadingTurnsFor,
  loadingDataFor: s.loadingDataFor,
  briefsLoaded: s.briefsLoaded,
  setActiveBrief: s.setActiveBrief,
  loadBriefs: s.loadBriefs,
  loadAllBriefs: s.loadAllBriefs,
  loadTurns: s.loadTurns,
  loadBriefData: s.loadBriefData,
  loadArtifacts: s.loadArtifacts,
  appendTurn: s.appendTurn,
  setLastAssistantContent: s.setLastAssistantContent,
  setLastAssistantToolCalls: s.setLastAssistantToolCalls,
  insertBrief: s.insertBrief,
  removeBriefsForSession: s.removeBriefsForSession,
  patchBrief: s.patchBrief,
  subscribeBriefUpdates: s.subscribeBriefUpdates,
  subscribeArtifactInserts: s.subscribeArtifactInserts,
})));

export const useTray = () => useStore(useShallow((s) => ({
  trayItems: s.trayItems,
  trayLoaded: s.trayLoaded,
  loadTrayItems: s.loadTrayItems,
  subscribeAgentRuns: s.subscribeAgentRuns,
  upsertRun: s.upsertRun,
})));

export const useCba = () => useStore(useShallow((s) => ({
  cbaArticles: s.cbaArticles,
  cbaLoaded: s.cbaLoaded,
  loadCbaArticles: s.loadCbaArticles,
})));

export const useBookmarks = () => useStore(useShallow((s) => ({
  bookmarkedBriefIds: s.bookmarkedBriefIds,
  bookmarksLoaded: s.bookmarksLoaded,
  loadBookmarks: s.loadBookmarks,
  toggleBookmark: s.toggleBookmark,
})));

export const useProjects = () => useStore(useShallow((s) => ({
  projects: s.projects,
  projectsLoaded: s.projectsLoaded,
  activeProjectId: s.activeProjectId,
  activeScenarioId: s.activeScenarioId,
  activeProjectDetail: s.activeProjectDetail,
  activeProjectLoading: s.activeProjectLoading,
  projectDiagnosis: s.projectDiagnosis,
  setActiveProject: s.setActiveProject,
  setActiveScenario: s.setActiveScenario,
  loadProjects: s.loadProjects,
  loadProject: s.loadProject,
  createProject: s.createProject,
  attachBrief: s.attachBrief,
  updateProject: s.updateProject,
  updateStageNote: s.updateStageNote,
  createProjectTask: s.createProjectTask,
  updateProjectTask: s.updateProjectTask,
  deleteProjectTask: s.deleteProjectTask,
  createScenario: s.createScenario,
  updateScenario: s.updateScenario,
  duplicateScenario: s.duplicateScenario,
  createScenarioPlayer: s.createScenarioPlayer,
  updateScenarioPlayer: s.updateScenarioPlayer,
  deleteScenarioPlayer: s.deleteScenarioPlayer,
  createScenarioAsset: s.createScenarioAsset,
  updateScenarioAsset: s.updateScenarioAsset,
  deleteScenarioAsset: s.deleteScenarioAsset,
  updateScenarioValidation: s.updateScenarioValidation,
  validateScenario: s.validateScenario,
  createArtifact: s.createArtifact,
  updateArtifact: s.updateArtifact,
  deleteArtifact: s.deleteArtifact,
  advanceProject: s.advanceProject,
  seedProject: s.seedProject,
  diagnoseProject: s.diagnoseProject,
  generatePackage: s.generatePackage,
})));

export const useMonitors = () => useStore(useShallow((s) => ({
  monitors: s.monitors,
  monitorsLoaded: s.monitorsLoaded,
  loadMonitors: s.loadMonitors,
  createMonitor: s.createMonitor,
  pauseMonitor: s.pauseMonitor,
  acknowledgeBriefAlerts: s.acknowledgeBriefAlerts,
  subscribeMonitors: s.subscribeMonitors,
})));

export const useToasts = () => useStore(useShallow((s) => ({
  toasts: s.toasts,
  pushToast: s.pushToast,
  dismissToast: s.dismissToast,
})));

function isPersistedNav(value: string | undefined): value is RootStore['activeNav'] {
  return value === 'dashboard'
    || value === 'analyze'
    || value === 'war_room'
    || value === 'projects'
    || value === 'database'
    || value === 'cba'
    || value === 'settings';
}
