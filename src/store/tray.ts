import type { StateCreator } from 'zustand';
import type { AgentRun } from '@shared/types';
import { supabase } from '../api/client';

export interface TraySlice {
  trayItems: AgentRun[];
  trayLoaded: boolean;

  loadTrayItems: () => Promise<void>;
  /** Subscribe to agent_runs INSERT/UPDATE; returns an unsubscribe fn. */
  subscribeAgentRuns: () => () => void;
  /** Insert or replace a run in the tray (used when palette dispatches). */
  upsertRun: (run: AgentRun) => void;
}

// Ordering: running first, then needs_input, then most-recently-completed,
// then failures. Matches what the GM expects to glance at.
function sortRuns(rs: AgentRun[]): AgentRun[] {
  const rank = (r: AgentRun) =>
    r.status === 'running' ? 0
    : r.status === 'needs_input' ? 1
    : r.status === 'completed' ? 2
    : 3;
  return [...rs].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

const TRAY_LIMIT = 6;

export const createTraySlice: StateCreator<TraySlice, [], [], TraySlice> = (set) => ({
  trayItems: [],
  trayLoaded: false,

  loadTrayItems: async () => {
    // Pull the most recent runs across the whole workspace. Single-tenant for
    // the prototype so no user_id filter; we cap at TRAY_LIMIT * 2 to give
    // the client-side sort some breathing room before slicing.
    const { data, error } = await supabase
      .from('agent_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(TRAY_LIMIT * 2);

    if (error) {
      console.warn('[tray] loadTrayItems failed', error);
      set({ trayLoaded: true });
      return;
    }

    set({
      trayItems: sortRuns((data ?? []) as AgentRun[]).slice(0, TRAY_LIMIT),
      trayLoaded: true,
    });
  },

  subscribeAgentRuns: () => {
    const channel = supabase
      .channel('agent-runs-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'agent_runs' },
        (payload) => {
          const row = payload.new as AgentRun;
          set((s) => ({
            trayItems: sortRuns([row, ...s.trayItems.filter((r) => r.id !== row.id)])
              .slice(0, TRAY_LIMIT),
          }));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'agent_runs' },
        (payload) => {
          const row = payload.new as AgentRun;
          set((s) => {
            const exists = s.trayItems.some((r) => r.id === row.id);
            if (!exists) {
              return {
                trayItems: sortRuns([row, ...s.trayItems]).slice(0, TRAY_LIMIT),
              };
            }
            return {
              trayItems: sortRuns(
                s.trayItems.map((r) => (r.id === row.id ? row : r)),
              ).slice(0, TRAY_LIMIT),
            };
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  },

  upsertRun: (run) => {
    set((s) => {
      const existing = s.trayItems.find((r) => r.id === run.id);
      const next = existing
        ? s.trayItems.map((r) => (r.id === run.id ? run : r))
        : [run, ...s.trayItems];
      return { trayItems: sortRuns(next).slice(0, TRAY_LIMIT) };
    });
  },
});
