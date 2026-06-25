import { BRIEF_MODEL } from '../client.js';
import {
  loadBriefBundle, agentSystemBlocks, uploadMarkdownArtifact, safeSlug,
} from './shared.js';
import { createMessageWithContextGraphTools } from '../tool_loop.js';
import type { AgentResult } from './index.js';

const CHANGE_MY_MIND_SYSTEM = `You are the Gambit Analyst running a steel-man / red-team pass on an existing brief.

Your job is to surface the disconfirming evidence — the things that, if true, would change the brief's working thesis. You are NOT trying to be balanced or polite. You are trying to find the cracks.

Output a single Markdown document.

Structure:

# What would change my mind

> Working thesis: <one-line restatement of the brief's thesis>

## Disconfirming scenarios
3–5 numbered scenarios. Each is a concrete, observable trigger — a specific player news item, a CBA ruling, a counterparty move, a market signal. Format: bold the trigger ("**Player X re-signs with team Y**"), then 1–2 sentences on why this would change the working thesis.

## Hidden assumptions
2–4 short bullets. What does the working thesis quietly take for granted that could be wrong?

## Stress test the data
2–3 short bullets identifying weaknesses or gaps in the cited sources — stale data, small samples, unrepresentative comps, anything that warrants a tighter check.

## What to watch in the next 30 days
A short prose paragraph naming the 2–3 highest-leverage signals that, if they move, should trigger a re-evaluation.

Tone: skeptical but professional. Cite CBA articles and source contracts where the disconfirming evidence is grounded in them. No throat-clearing.`;

export async function runChangeMyMindAgent(
  briefId: string,
  config: { query?: string },
  agentRunId: string,
): Promise<AgentResult> {
  const bundle = await loadBriefBundle(briefId);

  const userPrompt = config.query
    ? `Run a steel-man pass against the brief. Specific angle: ${config.query}`
    : 'Run a steel-man pass against the brief — what would change the working thesis?';

  const { message: response } = await createMessageWithContextGraphTools({
    model: BRIEF_MODEL,
    max_tokens: 4096,
    system: await agentSystemBlocks(CHANGE_MY_MIND_SYSTEM, bundle),
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim();

  if (!text) throw new Error('change_my_mind agent returned empty output');

  const stem = safeSlug(bundle.brief.thesis ?? bundle.brief.question);
  const filename = `${stem}-change-my-mind.md`;
  const path = await uploadMarkdownArtifact(agentRunId, filename, text);

  const scenarios = text.split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).length;
  const sizeKb = Math.max(1, Math.round(new Blob([text]).size / 1024));

  return {
    artifact: {
      name: filename,
      kind: 'doc',
      storage_path: path,
      meta: { scenarios: scenarios || undefined, size_kb: sizeKb },
    },
    summary: scenarios
      ? `${scenarios} disconfirming scenarios · ${sizeKb} KB`
      : `Steel-man pass · ${sizeKb} KB`,
  };
}
