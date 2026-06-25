import type Anthropic from '@anthropic-ai/sdk';
import { db } from '../../db/client.js';
import { buildContextGraphSystemBlock } from '../context_graph.js';
import { buildBriefContext } from '../prompts.js';
import type { Brief, BriefSource, BriefOption } from '@shared/types';

export interface BriefBundle {
  brief: Brief;
  sources: BriefSource[];
  options: BriefOption[];
}

/** Loads a brief and its sources/options, or throws. */
export async function loadBriefBundle(briefId: string): Promise<BriefBundle> {
  const briefRes = await db.from('briefs').select('*').eq('id', briefId).maybeSingle();
  if (briefRes.error || !briefRes.data) {
    throw new Error(`brief ${briefId} not found`);
  }
  const [sourcesRes, optionsRes] = await Promise.all([
    db.from('brief_sources').select('*').eq('brief_id', briefId).order('ref_index'),
    db.from('brief_options').select('*').eq('brief_id', briefId).order('ref_index'),
  ]);
  return {
    brief: briefRes.data as Brief,
    sources: (sourcesRes.data ?? []) as BriefSource[],
    options: (optionsRes.data ?? []) as BriefOption[],
  };
}

/** Per-brief context block, prefixed for use as a stable Claude system block. */
export function briefContextBlock(bundle: BriefBundle): string {
  return buildBriefContext(bundle.brief, bundle.sources, bundle.options);
}

/** Shared agent system blocks: agent role, context graph access, active brief. */
export async function agentSystemBlocks(
  agentSystem: string,
  bundle: BriefBundle,
): Promise<Anthropic.TextBlockParam[]> {
  return [
    { type: 'text', text: agentSystem, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: await buildContextGraphSystemBlock(), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: briefContextBlock(bundle), cache_control: { type: 'ephemeral' } },
  ];
}

/** Slugifies a brief thesis/question into a safe filename stem. */
export function safeSlug(s: string, max = 40): string {
  const slug = s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'brief';
}

/**
 * Uploads a markdown artifact to Supabase Storage. Returns the storage path
 * (NOT a signed URL — those are minted on demand by the agent route).
 */
export async function uploadMarkdownArtifact(
  agentRunId: string,
  filename: string,
  content: string,
): Promise<string> {
  const path = `${agentRunId}/${filename}`;
  const upload = await db.storage
    .from('artifacts')
    .upload(path, new Blob([content], { type: 'text/markdown' }), {
      contentType: 'text/markdown',
      upsert: true,
    });
  if (upload.error) {
    throw new Error(`artifact upload failed: ${upload.error.message}`);
  }
  return path;
}
