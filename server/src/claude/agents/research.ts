import { BRIEF_MODEL } from '../client.js';
import {
  loadBriefBundle, agentSystemBlocks, uploadMarkdownArtifact, safeSlug,
} from './shared.js';
import { createMessageWithContextGraphTools } from '../tool_loop.js';
import type { AgentResult } from './index.js';

const RESEARCH_SYSTEM = `You are the Gambit Analyst, producing a deep-research note that extends an existing brief.

The user has asked a research question that goes beyond the brief's working thesis — it might explore comp sets, market dynamics, CBA edge cases, multi-team trade trees, or longitudinal team-building patterns. Output a single Markdown document.

Structure:

# <Research title>

> <one-sentence question being investigated>

## Key findings
3–5 numbered findings. Each is one or two sentences with the finding stated up front, followed by the evidence.

## Analysis
2–4 short sections, each with a level-3 heading (###). Walk through the reasoning, citing CBA articles and source contracts where relevant. Use prose, not bullets.

## Implications for the brief
A short paragraph mapping the findings back to the active brief: which options become more or less attractive, which assumptions hold up, which need revisiting.

## Open questions
2–4 short bullets of follow-ups worth running as separate agents.

Tone: rigorous, evidence-driven, willing to caveat where data is missing. No throat-clearing.`;

export async function runResearchAgent(
  briefId: string,
  config: { query?: string },
  agentRunId: string,
): Promise<AgentResult> {
  const bundle = await loadBriefBundle(briefId);

  const userPrompt = config.query
    ? `Run deep research, anchored to the active brief. Question: ${config.query}`
    : 'Run deep research that extends the active brief — surface comparable situations, risks, and second-order effects worth knowing.';

  const { message: response } = await createMessageWithContextGraphTools({
    model: BRIEF_MODEL,
    max_tokens: 6144,
    system: await agentSystemBlocks(RESEARCH_SYSTEM, bundle),
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim();

  if (!text) throw new Error('research agent returned empty output');

  const stem = safeSlug(config.query ?? bundle.brief.thesis ?? bundle.brief.question);
  const filename = `${stem}-research.md`;
  const path = await uploadMarkdownArtifact(agentRunId, filename, text);

  const words = text.split(/\s+/).filter(Boolean).length;
  const sizeKb = Math.max(1, Math.round(new Blob([text]).size / 1024));
  const findings = text.split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).length;

  return {
    artifact: {
      name: filename,
      kind: 'doc',
      storage_path: path,
      meta: { words, findings: findings || undefined, size_kb: sizeKb },
    },
    summary: findings
      ? `${findings} findings · ${sizeKb} KB`
      : `${words.toLocaleString()} words · ${sizeKb} KB`,
  };
}
