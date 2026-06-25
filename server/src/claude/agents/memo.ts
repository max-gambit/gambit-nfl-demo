import { BRIEF_MODEL } from '../client.js';
import {
  loadBriefBundle, agentSystemBlocks, uploadMarkdownArtifact, safeSlug,
} from './shared.js';
import { createMessageWithContextGraphTools } from '../tool_loop.js';
import type { AgentResult } from './index.js';

const MEMO_SYSTEM = `You are the Gambit Analyst, drafting a written front-office memo from an existing brief.

Output a single Markdown document with this structure:

# <Memo title>

**To:** Ownership / front-office leadership
**From:** Gambit Analyst
**Re:** <subject>
**Date:** <today, format: Apr 28, 2026>

---

<body>

The body is 3–5 short sections, each with a level-2 heading (##). Cover, in order:
1. Working thesis — the thesis/current lean, restated with the headline cap impact.
2. Why this path — the reasoning, citing CBA articles and source contracts inline.
3. Alternatives considered — the other strategic options and why the current lean ranks ahead for now.
4. Risks & watch-points — the watching items, expanded into 2–3 sentences each.
5. Next steps — concrete decisions and timing.

Tone: a senior NBA front-office voice. Consultative, terse, evidence-driven. No bullet lists in the body sections except for "Next steps". Numbers must match the brief data exactly — do not fabricate.`;

export async function runMemoAgent(
  briefId: string,
  config: { query?: string },
  agentRunId: string,
): Promise<AgentResult> {
  const bundle = await loadBriefBundle(briefId);

  const userPrompt = config.query
    ? `Draft a memo from the active brief. Specific ask: ${config.query}`
    : 'Draft a memo from the active brief.';

  const { message: response } = await createMessageWithContextGraphTools({
    model: BRIEF_MODEL,
    max_tokens: 4096,
    system: await agentSystemBlocks(MEMO_SYSTEM, bundle),
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim();

  if (!text) throw new Error('memo agent returned empty output');

  const stem = safeSlug(bundle.brief.thesis ?? bundle.brief.question);
  const filename = `${stem}-memo.md`;
  const path = await uploadMarkdownArtifact(agentRunId, filename, text);

  const words = text.split(/\s+/).filter(Boolean).length;
  const pages = Math.max(1, Math.round(words / 350));
  const sizeKb = Math.max(1, Math.round(new Blob([text]).size / 1024));

  return {
    artifact: {
      name: filename,
      kind: 'doc',
      storage_path: path,
      meta: { pages, words, size_kb: sizeKb },
    },
    summary: `${pages} ${pages === 1 ? 'page' : 'pages'} · ${sizeKb} KB`,
  };
}
