import type { StateCreator } from 'zustand';
import type { Session } from '@shared/types';
import { supabase } from '../api/client';

export interface SessionsSlice {
  sessions: Session[];
  activeSessionId: string | null;
  /** Whether the initial loadSessions() call has finished. */
  sessionsLoaded: boolean;

  setActiveSession: (id: string | null) => void;
  loadSessions: () => Promise<void>;
  insertSession: (session: Session) => void;
  removeSession: (id: string, nextActiveId?: string | null) => void;
  /** Rename a session in-place. Does NOT persist — caller is responsible for
   *  the API call (`renameSession` in `api/sessions.ts`). Used by SessionFeed
   *  after the first brief lands in an Untitled channel. */
  patchSessionLabel: (id: string, label: string) => void;
}

export const createSessionsSlice: StateCreator<SessionsSlice, [], [], SessionsSlice> = (set) => ({
  sessions: [],
  activeSessionId: null,
  sessionsLoaded: false,

  setActiveSession: (id) => set((s) => ({
    activeSessionId: id,
    sessions: s.sessions.map((sess) => ({ ...sess, active: sess.id === id })),
  })),

  loadSessions: async () => {
    // Load sessions + brief counts in parallel. We compute counts client-side
    // by joining a `briefs(count)` aggregate via PostgREST's relationship
    // shorthand to avoid an extra round trip per session.
    const { data, error } = await supabase
      .from('sessions')
      .select('*, briefs(count)')
      .is('archived_at', null)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[sessions] loadSessions failed', error);
      set({ sessionsLoaded: true });
      return;
    }

    const sessions: Session[] = ((data ?? []) as Array<Session & { briefs?: { count: number }[] }>)
      .map((s, i, all) => ({
        id: s.id,
        user_id: s.user_id ?? null,
        label: s.label,
        created_at: s.created_at,
        updated_at: s.updated_at,
        archived_at: s.archived_at ?? null,
        count: s.briefs?.[0]?.count ?? 0,
        // Default the first session to active until the user picks one.
        active: i === all.length - 1 ? false : false,
      }));

    set((s) => {
      // Validate the persisted activeSessionId. A fresh themed demo should
      // land on the first-question composer instead of auto-opening stale
      // generated briefs from an older tenant.
      const persistedId = s.activeSessionId;
      const stillValid = persistedId && sessions.some((sess) => sess.id === persistedId);
      const nextActiveId = stillValid ? persistedId : null;
      return {
        sessions: sessions.map((sess) => ({
          ...sess,
          active: sess.id === nextActiveId,
        })),
        activeSessionId: nextActiveId,
        sessionsLoaded: true,
      };
    });
  },

  insertSession: (session) => {
    set((s) => ({
      sessions: [...s.sessions.map((sess) => ({ ...sess, active: false })), { ...session, active: true }],
      activeSessionId: session.id,
    }));
  },

  removeSession: (id, nextActiveId = null) => {
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== id);
      const validNextId = nextActiveId && sessions.some((sess) => sess.id === nextActiveId)
        ? nextActiveId
        : null;
      const activeSessionId = s.activeSessionId === id ? validNextId : s.activeSessionId;
      return {
        sessions: sessions.map((sess) => ({ ...sess, active: sess.id === activeSessionId })),
        activeSessionId,
      };
    });
  },

  patchSessionLabel: (id, label) => {
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === id ? { ...sess, label } : sess)),
    }));
  },
});
