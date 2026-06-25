import type { StateCreator } from 'zustand';
import { supabase } from '../api/client';
import { SINGLE_TENANT_USER_ID } from '../lib/tenant';
import { toast } from './toast-bus';

export interface BookmarksSlice {
  /** brief_ids the current (single-tenant) user has bookmarked. */
  bookmarkedBriefIds: Set<string>;
  bookmarksLoaded: boolean;

  loadBookmarks: () => Promise<void>;
  /** Optimistically toggles, then persists. Reverts on persistence failure. */
  toggleBookmark: (briefId: string) => Promise<void>;
}

export const createBookmarksSlice: StateCreator<BookmarksSlice, [], [], BookmarksSlice> = (set, get) => ({
  bookmarkedBriefIds: new Set(),
  bookmarksLoaded: false,

  loadBookmarks: async () => {
    const { data, error } = await supabase
      .from('bookmarks')
      .select('brief_id')
      .eq('user_id', SINGLE_TENANT_USER_ID);
    if (error) {
      console.warn('[bookmarks] load failed', error);
      set({ bookmarksLoaded: true });
      return;
    }
    const ids = new Set<string>((data ?? []).map((r) => (r as { brief_id: string }).brief_id));
    set({ bookmarkedBriefIds: ids, bookmarksLoaded: true });
  },

  toggleBookmark: async (briefId) => {
    const before = get().bookmarkedBriefIds;
    const isOn = before.has(briefId);
    const next = new Set(before);
    if (isOn) next.delete(briefId);
    else next.add(briefId);
    set({ bookmarkedBriefIds: next });

    if (isOn) {
      const { error } = await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id', SINGLE_TENANT_USER_ID)
        .eq('brief_id', briefId);
      if (error) {
        console.warn('[bookmarks] delete failed, reverting', error);
        set({ bookmarkedBriefIds: before });
        toast({ tone: 'error', message: 'Couldn’t remove bookmark', detail: error.message });
      }
      return;
    }
    const { error } = await supabase
      .from('bookmarks')
      .insert({ user_id: SINGLE_TENANT_USER_ID, brief_id: briefId });
    if (error) {
      console.warn('[bookmarks] insert failed, reverting', error);
      set({ bookmarkedBriefIds: before });
      toast({ tone: 'error', message: 'Couldn’t save bookmark', detail: error.message });
    }
  },
});
