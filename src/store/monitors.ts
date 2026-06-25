import type { StateCreator } from 'zustand';
import type { Monitor, MonitorConfig, MonitorKind } from '@shared/types';
import { supabase } from '../api/client';
import {
  acknowledgeMonitorAlerts,
  createMonitor as createMonitorApi,
  listMonitors,
  pauseMonitor as pauseMonitorApi,
} from '../api/monitors';
import { toast } from './toast-bus';

export interface MonitorsSlice {
  monitors: Monitor[];
  monitorsLoaded: boolean;

  loadMonitors: () => Promise<void>;
  createMonitor: (input: { brief_id: string; kind: MonitorKind; config: MonitorConfig }) => Promise<Monitor | null>;
  pauseMonitor: (id: string, paused: boolean) => Promise<void>;
  /** Mark all alerts for a brief as seen — clears the badge. */
  acknowledgeBriefAlerts: (briefId: string) => Promise<void>;
  /** Subscribe to monitors INSERT/UPDATE; returns an unsubscribe fn. */
  subscribeMonitors: () => () => void;
}

export const createMonitorsSlice: StateCreator<MonitorsSlice, [], [], MonitorsSlice> = (set, get) => ({
  monitors: [],
  monitorsLoaded: false,

  loadMonitors: async () => {
    try {
      const monitors = await listMonitors();
      set({ monitors, monitorsLoaded: true });
    } catch (error) {
      console.warn('[monitors] load failed', error);
      set({ monitorsLoaded: true });
    }
  },

  createMonitor: async ({ brief_id, kind, config }) => {
    let m: Monitor;
    try {
      m = await createMonitorApi({ brief_id, kind, config });
    } catch (error) {
      console.warn('[monitors] create failed', error);
      toast({
        tone: 'error',
        message: kind === 'rerun' ? 'Couldn’t schedule weekly re-run' : 'Couldn’t create watch',
        detail: error instanceof Error ? error.message : 'unknown error',
      });
      return null;
    }
    set((s) => ({ monitors: [m, ...s.monitors] }));
    toast({
      tone: 'success',
      message: kind === 'rerun' ? 'Weekly re-run scheduled' : 'Monitor created',
      detail: kind === 'watch' ? `Will check ${config.schedule ?? 'weekly'}.` : undefined,
    });
    return m;
  },

  pauseMonitor: async (id, paused) => {
    const before = get().monitors;
    set({ monitors: before.map((m) => (m.id === id ? { ...m, paused } : m)) });
    try {
      const updated = await pauseMonitorApi(id, paused);
      set((s) => ({ monitors: s.monitors.map((m) => (m.id === id ? updated : m)) }));
    } catch (error) {
      console.warn('[monitors] pause failed, reverting', error);
      set({ monitors: before });
    }
  },

  acknowledgeBriefAlerts: async (briefId) => {
    const before = get().monitors;
    const targets = before.filter((m) => m.brief_id === briefId && m.alerts_count > 0);
    if (targets.length === 0) return;
    set({ monitors: before.map((m) => (m.brief_id === briefId ? { ...m, alerts_count: 0 } : m)) });
    try {
      const updated = await acknowledgeMonitorAlerts(briefId);
      if (updated.length > 0) {
        const byId = new Map(updated.map((m) => [m.id, m]));
        set((s) => ({ monitors: s.monitors.map((m) => byId.get(m.id) ?? m) }));
      }
    } catch (error) {
      console.warn('[monitors] acknowledge failed, reverting', error);
      set({ monitors: before });
    }
  },

  subscribeMonitors: () => {
    const channel = supabase
      .channel('monitors-updates')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'monitors' },
        (payload) => {
          const row = payload.new as Monitor;
          set((s) => {
            if (s.monitors.some((m) => m.id === row.id)) return s;
            return { monitors: [row, ...s.monitors] };
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'monitors' },
        (payload) => {
          const row = payload.new as Monitor;
          set((s) => ({
            monitors: s.monitors.map((m) => (m.id === row.id ? row : m)),
          }));
        },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  },
});
