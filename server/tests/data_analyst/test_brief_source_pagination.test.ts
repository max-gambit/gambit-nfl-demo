import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBriefSources } from '../../../src/api/briefSources.js';

function clientFor(page: (from: number, to: number) => unknown) {
  const query = {
    select: () => query,
    eq: (field: string, value: string) => { assert.equal(field, 'brief_id'); assert.equal(value, 'brief-test'); return query; },
    order: () => query,
    range: page,
  };
  return { from: (table: string) => { assert.equal(table, 'brief_sources'); return query; } } as unknown as SupabaseClient;
}

test('all 2729 sources are retained, including citations beyond the first page', async () => {
  const sources = Array.from({ length: 2729 }, (_, index) => ({ id: 'source-' + index, ref_index: index + 1 }));
  const ranges: number[][] = [];
  const result = await loadBriefSources(clientFor((from, to) => {
    ranges.push([from, to]);
    return { data: sources.slice(from, to + 1), error: null };
  }), 'brief-test');
  assert.deepEqual(result.data, sources);
  assert.equal(result.error, null);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.ok(result.data?.some(source => source.ref_index === 2521));
});

test('an exact page boundary and an empty source list both terminate', async () => {
  for (const size of [0, 1000]) {
    let reads = 0;
    const sources = Array.from({ length: size }, (_, index) => ({ ref_index: index + 1 }));
    const result = await loadBriefSources(clientFor((from, to) => { reads++; return { data: sources.slice(from, to + 1), error: null }; }), 'brief-test');
    assert.equal(result.data?.length, size);
    assert.equal(reads, size === 0 ? 1 : 2);
  }
});

test('later-page failures never return a partial source list as complete', async () => {
  for (const throws of [false, true]) {
    const error = new Error('source page unavailable');
    const result = await loadBriefSources(clientFor(from => {
      if (from === 0) return { data: Array.from({ length: 1000 }, (_, index) => ({ ref_index: index + 1 })), error: null };
      if (throws) throw error;
      return { data: null, error };
    }), 'brief-test');
    assert.equal(result.data, null);
    assert.equal(result.error, error);
  }
});
