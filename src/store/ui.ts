import type { StateCreator } from 'zustand';

export type NavTab = 'dashboard' | 'analyze' | 'war_room' | 'projects' | 'database' | 'cba' | 'settings';
export type RightPanelMode = 'list' | 'thread';

// Phase 9 — right-panel sizing constants.
export const RIGHT_PANEL_DEFAULT_WIDTH = 360;
export const RIGHT_PANEL_MIN_WIDTH = 280;
export const RIGHT_PANEL_MAX_WIDTH = 600;

export interface UiSlice {
  paletteOpen: boolean;
  helpOpen: boolean;
  sessionsExpanded: boolean;
  railCollapsed: boolean;
  /** Phase 7b — which top-level surface is active. Header writes; FenwayApp reads. */
  activeNav: NavTab;
  /** Database tab: selected roster team. */
  databaseTeamId: string;
  /** Database tab: selected player from the active roster team. */
  databasePlayerId: number | null;
  /** Database tab: selected cap-sheet salary row. */
  databaseCapRowId: string | null;
  /** Database tab: selected advanced-stats row. */
  databaseStatKey: string | null;
  /** Phase 7b — when set, FenwayApp renders the side-by-side CompareView with
   *  the active brief on the left and this brief on the right. */
  compareTargetBriefId: string | null;
  /** Phase 9 — which brief is expanded in the channel feed. Null falls through
   *  to the most-recent brief in the active session. */
  expandedBriefId: string | null;
  /** Phase 9 — master/detail mode of the right panel. 'list' = TOC of briefs
   *  in the active channel; 'thread' = one brief's reply thread + composer. */
  rightPanelMode: RightPanelMode;
  /** Phase 9 — right panel width in px. Persists across reloads. */
  rightPanelWidth: number;
  /** Phase 9 — collapse the right panel to a thin handle (drag-to-zero affordance). */
  rightPanelOpen: boolean;
  /** When set, LeftRail filters source cards to these ref_index values.
   *  Drilldown from the OptionsTable evidence actions. Persists until clear. */
  sourceFilterRefs: number[] | null;
  /** Compatibility read for older single-ref callers. */
  sourceFilterRef: number | null;
  /** Transient — when set, LeftRail scrolls to and highlights the matching
   *  source card. Auto-clears after the highlight animation completes. */
  highlightedSourceRef: number | null;
  /** Phase 9 — when set, LeftRail swaps from the source list to the detail
   *  view for this source's `ref_index`. Cleared by the "← Sources" back
   *  button. Independent from `sourceFilterRef` (drilldown filter from
   *  OptionsTable's "X src" pill). */
  selectedSourceRef: number | null;
  /** Strategic option currently opened/selected in the decision matrix. */
  selectedOptionRef: number | null;
  setPaletteOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setActiveNav: (nav: NavTab) => void;
  setDatabaseTeamId: (teamId: string) => void;
  setDatabasePlayerId: (playerId: number | null) => void;
  setDatabaseCapRowId: (rowId: string | null) => void;
  setDatabaseStatKey: (statKey: string | null) => void;
  setCompareTargetBriefId: (id: string | null) => void;
  setExpandedBrief: (id: string | null) => void;
  setRightPanelMode: (mode: RightPanelMode) => void;
  setRightPanelWidth: (w: number) => void;
  setRightPanelOpen: (open: boolean) => void;
  togglePalette: () => void;
  toggleHelp: () => void;
  toggleSessionsExpanded: () => void;
  toggleRailCollapsed: () => void;
  setSourceFilterRefs: (refs: number[] | null) => void;
  setSourceFilterRef: (n: number | null) => void;
  setHighlightedSourceRef: (n: number | null) => void;
  setSelectedSourceRef: (n: number | null) => void;
  setSelectedOptionRef: (n: number | null) => void;
}

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  paletteOpen: false,
  helpOpen: false,
  sessionsExpanded: false,
  railCollapsed: false,
  activeNav: 'analyze',
  databaseTeamId: 'NYG',
  databasePlayerId: null,
  databaseCapRowId: null,
  databaseStatKey: null,
  compareTargetBriefId: null,
  expandedBriefId: null,
  rightPanelMode: 'list',
  rightPanelWidth: RIGHT_PANEL_DEFAULT_WIDTH,
  rightPanelOpen: true,
  sourceFilterRefs: null,
  sourceFilterRef: null,
  highlightedSourceRef: null,
  selectedSourceRef: null,
  selectedOptionRef: null,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setHelpOpen: (open) => set({ helpOpen: open }),
  setActiveNav: (nav) => set({ activeNav: nav }),
  setDatabaseTeamId: (teamId) => set({ databaseTeamId: teamId, databaseCapRowId: null, databasePlayerId: null, databaseStatKey: null }),
  setDatabasePlayerId: (playerId) => set({ databasePlayerId: playerId }),
  setDatabaseCapRowId: (rowId) => set({ databaseCapRowId: rowId, databaseStatKey: null }),
  setDatabaseStatKey: (statKey) => set({ databaseStatKey: statKey, databaseCapRowId: null }),
  setCompareTargetBriefId: (id) => set({ compareTargetBriefId: id }),
  setExpandedBrief: (id) => set({ expandedBriefId: id }),
  setRightPanelMode: (mode) => set({ rightPanelMode: mode }),
  setRightPanelWidth: (w) => set({
    rightPanelWidth: Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, w)),
  }),
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  toggleSessionsExpanded: () => set((s) => ({ sessionsExpanded: !s.sessionsExpanded })),
  toggleRailCollapsed: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
  setSourceFilterRefs: (refs) => set({
    sourceFilterRefs: refs && refs.length ? refs : null,
    sourceFilterRef: refs && refs.length === 1 ? refs[0] : null,
  }),
  setSourceFilterRef: (n) => set({
    sourceFilterRefs: n === null ? null : [n],
    sourceFilterRef: n,
  }),
  setHighlightedSourceRef: (n) => set({ highlightedSourceRef: n }),
  setSelectedSourceRef: (n) => set({ selectedSourceRef: n }),
  setSelectedOptionRef: (n) => set({ selectedOptionRef: n }),
});
