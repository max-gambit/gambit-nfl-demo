import type { StateCreator } from 'zustand';
import type { CbaArticle } from '@shared/types';
import { supabase } from '../api/client';

export interface CbaSlice {
  cbaArticles: CbaArticle[];
  cbaLoaded: boolean;
  loadCbaArticles: () => Promise<void>;
}

export const createCbaSlice: StateCreator<CbaSlice, [], [], CbaSlice> = (set, get) => ({
  cbaArticles: [],
  cbaLoaded: false,

  loadCbaArticles: async () => {
    if (get().cbaLoaded) return;
    const { data, error } = await supabase
      .from('cba_articles')
      .select('*')
      .order('id', { ascending: true });
    if (error) {
      console.warn('[cba] loadCbaArticles failed', error);
      set({ cbaLoaded: true });
      return;
    }
    set({ cbaArticles: (data ?? []) as CbaArticle[], cbaLoaded: true });
  },
});
