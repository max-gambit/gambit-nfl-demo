import type { StateCreator } from 'zustand';
import type { Artifact, Brief, BriefOption, BriefSource, ChatTurn } from '@shared/types';
import { supabase } from '../api/client';

export interface BriefsSlice {
  briefs: Brief[];
  activeBriefId: string | null;
  /** Conversation history per brief, loaded lazily via loadTurns. */
  turnsByBrief: Record<string, ChatTurn[]>;
  /** Source cards per brief, loaded lazily via loadBriefData. */
  sourcesByBrief: Record<string, BriefSource[]>;
  /** Strategic options per brief, loaded lazily via loadBriefData. */
  optionsByBrief: Record<string, BriefOption[]>;
  /** Artifacts per brief, loaded lazily via loadArtifacts + Realtime updates. */
  artifactsByBrief: Record<string, Artifact[]>;
  /** Brief IDs whose history is being fetched, for skeleton UI. */
  loadingTurnsFor: Set<string>;
  /** Brief IDs whose sources/options are being fetched. */
  loadingDataFor: Set<string>;
  /** Whether the initial loadBriefs() call has finished. */
  briefsLoaded: boolean;

  setActiveBrief: (id: string | null) => void;
  loadBriefs: (sessionId: string) => Promise<void>;
  /** Load every brief across all sessions — Phase 7b "threads" model. */
  loadAllBriefs: () => Promise<void>;
  loadTurns: (briefId: string) => Promise<void>;
  loadBriefData: (briefId: string) => Promise<void>;
  loadArtifacts: (briefId: string) => Promise<void>;
  appendTurn: (briefId: string, turn: ChatTurn) => void;
  setLastAssistantContent: (briefId: string, content: string) => void;
  setLastAssistantToolCalls: (briefId: string, toolCalls: ChatTurn['tool_calls']) => void;
  insertBrief: (brief: Brief) => void;
  removeBriefsForSession: (sessionId: string) => void;
  patchBrief: (id: string, patch: Partial<Brief>) => void;
  /** Subscribe to brief UPDATE events via Supabase Realtime; returns an unsubscribe fn. */
  subscribeBriefUpdates: () => () => void;
  /** Subscribe to artifact INSERT events; returns an unsubscribe fn. */
  subscribeArtifactInserts: () => () => void;
}

// Helper to project a DB row plus a few derived fields the existing UI uses
// (label/when/sources/duration). Kept here so the slice is the single point
// of truth for brief shape.
function withDisplayFields(b: Brief): Brief {
  const created = new Date(b.created_at);
  const when = `${created.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${created.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const label = b.thesis ? b.thesis.slice(0, 28) : b.question.slice(0, 28);
  const duration = b.duration_ms ? `${(b.duration_ms / 1000).toFixed(1)}s` : undefined;
  return { ...b, when, label, duration };
}

type BriefWithSessionJoin = Brief & { sessions?: { archived_at: string | null } | null };

function fromJoinedBrief(row: BriefWithSessionJoin): Brief {
  const { sessions: _sessions, ...brief } = row;
  return brief as Brief;
}

export const createBriefsSlice: StateCreator<BriefsSlice, [], [], BriefsSlice> = (set, get) => ({
  briefs: [],
  activeBriefId: null,
  turnsByBrief: {},
  sourcesByBrief: {},
  optionsByBrief: {},
  artifactsByBrief: {},
  loadingTurnsFor: new Set(),
  loadingDataFor: new Set(),
  briefsLoaded: false,

  setActiveBrief: (id) => set({ activeBriefId: id }),

  loadBriefs: async (sessionId) => {
    const { data, error } = await supabase
      .from('briefs')
      .select('*, sessions!inner(archived_at)')
      .eq('session_id', sessionId)
      .is('sessions.archived_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[briefs] loadBriefs failed', sessionId, error);
      set({ briefsLoaded: true });
      return;
    }

    const briefs = ((data ?? []) as BriefWithSessionJoin[]).map(fromJoinedBrief).map(withDisplayFields);
    set((s) => ({
      briefs,
      briefsLoaded: true,
      // Preserve activeBriefId only when the user already has one selected.
      // A blank demo launch should stay blank until a channel/brief is chosen.
      activeBriefId:
        s.activeBriefId && briefs.some((b) => b.id === s.activeBriefId)
          ? s.activeBriefId
          : null,
    }));
  },

  // Phase 7b: load briefs from every session. The UI no longer scopes by
  // session — threads are the unit and they span the whole workspace.
  loadAllBriefs: async () => {
    const { data, error } = await supabase
      .from('briefs')
      .select('*, sessions!inner(archived_at)')
      .is('sessions.archived_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[briefs] loadAllBriefs failed', error);
      set({ briefsLoaded: true });
      return;
    }

    const briefs = ((data ?? []) as BriefWithSessionJoin[]).map(fromJoinedBrief).map(withDisplayFields);
    set((s) => ({
      briefs,
      briefsLoaded: true,
      activeBriefId:
        s.activeBriefId && briefs.some((b) => b.id === s.activeBriefId)
          ? s.activeBriefId
          : null,
    }));
  },

  loadTurns: async (briefId) => {
    if (get().turnsByBrief[briefId]) return;

    set((s) => {
      if (s.loadingTurnsFor.has(briefId)) return s;
      const next = new Set(s.loadingTurnsFor);
      next.add(briefId);
      return { ...s, loadingTurnsFor: next };
    });

    const { data, error } = await supabase
      .from('chat_turns')
      .select('*')
      .eq('brief_id', briefId)
      .order('created_at', { ascending: true });

    set((s) => {
      const next = new Set(s.loadingTurnsFor);
      next.delete(briefId);
      return {
        loadingTurnsFor: next,
        turnsByBrief: error
          ? s.turnsByBrief
          : { ...s.turnsByBrief, [briefId]: (data ?? []) as ChatTurn[] },
      };
    });

    if (error) console.warn('[briefs] loadTurns failed', briefId, error);
  },

  loadBriefData: async (briefId) => {
    const s0 = get();
    if (s0.sourcesByBrief[briefId] && s0.optionsByBrief[briefId]) return;

    set((s) => {
      if (s.loadingDataFor.has(briefId)) return s;
      const next = new Set(s.loadingDataFor);
      next.add(briefId);
      return { ...s, loadingDataFor: next };
    });

    const [sourcesRes, optionsRes] = await Promise.all([
      supabase.from('brief_sources').select('*').eq('brief_id', briefId).order('ref_index'),
      supabase.from('brief_options').select('*').eq('brief_id', briefId).order('ref_index'),
    ]);

    set((s) => {
      const next = new Set(s.loadingDataFor);
      next.delete(briefId);
      return {
        loadingDataFor: next,
        sourcesByBrief: sourcesRes.error
          ? s.sourcesByBrief
          : { ...s.sourcesByBrief, [briefId]: (sourcesRes.data ?? []) as BriefSource[] },
        optionsByBrief: optionsRes.error
          ? s.optionsByBrief
          : { ...s.optionsByBrief, [briefId]: (optionsRes.data ?? []) as BriefOption[] },
      };
    });

    if (sourcesRes.error) console.warn('[briefs] loadBriefData sources failed', briefId, sourcesRes.error);
    if (optionsRes.error) console.warn('[briefs] loadBriefData options failed', briefId, optionsRes.error);
  },

  loadArtifacts: async (briefId) => {
    const { data, error } = await supabase
      .from('artifacts')
      .select('*')
      .eq('brief_id', briefId)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[briefs] loadArtifacts failed', briefId, error);
      return;
    }

    set((s) => ({
      artifactsByBrief: { ...s.artifactsByBrief, [briefId]: (data ?? []) as Artifact[] },
    }));
  },

  appendTurn: (briefId, turn) => {
    set((s) => ({
      turnsByBrief: {
        ...s.turnsByBrief,
        [briefId]: [...(s.turnsByBrief[briefId] ?? []), turn],
      },
    }));
  },

  setLastAssistantContent: (briefId, content) => {
    set((s) => {
      const existing = s.turnsByBrief[briefId] ?? [];
      const last = existing[existing.length - 1];
      if (last && last.role === 'assistant' && last.id.startsWith('pending-')) {
        const updated = [...existing.slice(0, -1), { ...last, content }];
        return { turnsByBrief: { ...s.turnsByBrief, [briefId]: updated } };
      }
      const pending: ChatTurn = {
        id: `pending-${Date.now()}`,
        brief_id: briefId,
        role: 'assistant',
        content,
        tool_calls: null,
        created_at: new Date().toISOString(),
      };
      return {
        turnsByBrief: { ...s.turnsByBrief, [briefId]: [...existing, pending] },
      };
    });
  },

  setLastAssistantToolCalls: (briefId, toolCalls) => {
    set((s) => {
      const existing = s.turnsByBrief[briefId] ?? [];
      const last = existing[existing.length - 1];
      if (last && last.role === 'assistant' && last.id.startsWith('pending-')) {
        const updated = [...existing.slice(0, -1), { ...last, tool_calls: toolCalls }];
        return { turnsByBrief: { ...s.turnsByBrief, [briefId]: updated } };
      }
      const pending: ChatTurn = {
        id: `pending-${Date.now()}`,
        brief_id: briefId,
        role: 'assistant',
        content: '',
        tool_calls: toolCalls,
        created_at: new Date().toISOString(),
      };
      return {
        turnsByBrief: { ...s.turnsByBrief, [briefId]: [...existing, pending] },
      };
    });
  },

  insertBrief: (brief) => {
    set((s) => ({
      briefs: [...s.briefs, withDisplayFields(brief)],
      activeBriefId: brief.id,
    }));
  },

  removeBriefsForSession: (sessionId) => {
    set((s) => {
      const removedBriefIds = s.briefs
        .filter((brief) => brief.session_id === sessionId)
        .map((brief) => brief.id);
      if (removedBriefIds.length === 0) return s;
      const removed = new Set(removedBriefIds);
      return {
        briefs: s.briefs.filter((brief) => !removed.has(brief.id)),
        activeBriefId: s.activeBriefId && removed.has(s.activeBriefId) ? null : s.activeBriefId,
        turnsByBrief: withoutBriefKeys(s.turnsByBrief, removed),
        sourcesByBrief: withoutBriefKeys(s.sourcesByBrief, removed),
        optionsByBrief: withoutBriefKeys(s.optionsByBrief, removed),
        artifactsByBrief: withoutBriefKeys(s.artifactsByBrief, removed),
        loadingTurnsFor: withoutSetKeys(s.loadingTurnsFor, removed),
        loadingDataFor: withoutSetKeys(s.loadingDataFor, removed),
      };
    });
  },

  patchBrief: (id, patch) => {
    set((s) => ({
      briefs: s.briefs.map((b) => (b.id === id ? withDisplayFields({ ...b, ...patch }) : b)),
      ...(patch.status === 'generating' || patch.status === 'ready'
        ? {
            optionsByBrief: withoutBriefKey(s.optionsByBrief, id),
            sourcesByBrief: withoutBriefKey(s.sourcesByBrief, id),
          }
        : {}),
    }));
  },

  subscribeBriefUpdates: () => {
    const channel = supabase
      .channel('briefs-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'briefs' },
        (payload) => {
          const updated = payload.new as Brief;
          // Patch in place. On EITHER status transition (`'generating'` for a
          // regenerate, `'ready'` for a brief landing) we clear any cached
          // options/sources so the next loadBriefData refetches.
          //
          // Why both: when a fresh brief is created, App.tsx fires
          // loadBriefData immediately (with the brief still in 'generating'
          // state and no rows in DB). That caches `{}: []`. Without the
          // 'ready'-side clear here, loadBriefData's early-return would
          // short-circuit on the empty-but-truthy array when the brief
          // actually completes — so the recommendation card would render
          // forever with zero sources / zero options.
          set((s) => {
            const briefs = s.briefs.map((b) =>
              b.id === updated.id ? withDisplayFields({ ...b, ...updated }) : b,
            );
            if (updated.status !== 'generating' && updated.status !== 'ready') {
              return { briefs };
            }
            const optionsByBrief = { ...s.optionsByBrief };
            const sourcesByBrief = { ...s.sourcesByBrief };
            delete optionsByBrief[updated.id];
            delete sourcesByBrief[updated.id];
            return { briefs, optionsByBrief, sourcesByBrief };
          });
          if (updated.status === 'ready') {
            // Refetch sources/options so the recommendation card lands with
            // real data the moment status goes ready.
            void get().loadBriefData(updated.id);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  },

  subscribeArtifactInserts: () => {
    const channel = supabase
      .channel('artifacts-inserts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'artifacts' },
        (payload) => {
          const row = payload.new as Artifact;
          set((s) => {
            const existing = s.artifactsByBrief[row.brief_id] ?? [];
            if (existing.some((a) => a.id === row.id)) return s;
            return {
              artifactsByBrief: {
                ...s.artifactsByBrief,
                [row.brief_id]: [...existing, row],
              },
            };
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  },
});

function withoutBriefKey<T>(record: Record<string, T>, id: string): Record<string, T> {
  if (!(id in record)) return record;
  const next = { ...record };
  delete next[id];
  return next;
}

function withoutBriefKeys<T>(record: Record<string, T>, ids: Set<string>): Record<string, T> {
  let next: Record<string, T> | null = null;
  for (const id of ids) {
    if (!(id in record)) continue;
    next ??= { ...record };
    delete next[id];
  }
  return next ?? record;
}

function withoutSetKeys(values: Set<string>, ids: Set<string>): Set<string> {
  let next: Set<string> | null = null;
  for (const id of ids) {
    if (!values.has(id)) continue;
    next ??= new Set(values);
    next.delete(id);
  }
  return next ?? values;
}
