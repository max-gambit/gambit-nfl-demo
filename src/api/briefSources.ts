import type { SupabaseClient } from '@supabase/supabase-js';
import type { BriefSource } from '@shared/types';

/** Load every source; large historical answers can exceed one database page. */
export async function loadBriefSources(client: SupabaseClient, briefId: string): Promise<{ data: BriefSource[] | null; error: unknown }> {
  const pageSize = 1000;
  const sources: BriefSource[] = [];
  try {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client.from('brief_sources').select('*').eq('brief_id', briefId)
        .order('ref_index').order('id').range(offset, offset + pageSize - 1);
      if (error) return { data: null, error };
      sources.push(...(data ?? []) as BriefSource[]);
      if ((data ?? []).length < pageSize) return { data: sources, error: null };
    }
  } catch (error) {
    // Do not cache a partial set as complete when a later page fails.
    return { data: null, error };
  }
}
