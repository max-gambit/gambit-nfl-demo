import { BRIEF_MODEL } from '../client.js';
import {
  loadBriefBundle, agentSystemBlocks, uploadMarkdownArtifact, safeSlug,
} from './shared.js';
import { createMessageWithContextGraphTools } from '../tool_loop.js';
import type { AgentResult } from './index.js';

const DECK_SYSTEM = `You are the Gambit Analyst, generating a board-ready slide deck outline from an existing brief.

Output a single Markdown document representing 8–10 slides. Use this exact structure:

# <Deck title>

## Slide 1: <Title>
- <bullet>
- <bullet>

(repeat for each slide)

Each slide should be tight: 3–5 bullets max. Lead with the working-thesis slide, follow with the strategic options, then the cap math, then the watch-points, and close with next steps. Reference the brief's CBA citations and source contracts where relevant. Numbers should match the brief data exactly — do not fabricate.

Audience: ownership and front-office leadership. Tone: consultative, evidence-driven, terse. No throat-clearing, no markdown beyond headings and bullets.`;

export async function runDeckAgent(
  briefId: string,
  config: { query?: string },
  agentRunId: string,
): Promise<AgentResult> {
  const bundle = await loadBriefBundle(briefId);

  const userPrompt = config.query
    ? `Generate a board deck from the active brief. Specific ask: ${config.query}`
    : 'Generate a board deck from the active brief.';

  const { message: response } = await createMessageWithContextGraphTools({
    model: BRIEF_MODEL,
    max_tokens: 4096,
    system: await agentSystemBlocks(DECK_SYSTEM, bundle),
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim();

  if (!text) throw new Error('deck agent returned empty output');

  const stem = safeSlug(bundle.brief.thesis ?? bundle.brief.question);
  const filename = `${stem}-deck.md`;
  const path = await uploadMarkdownArtifact(agentRunId, filename, text);

  // Slide count = lines starting with "## Slide".
  const slides = text.split('\n').filter((l) => /^##\s*Slide/i.test(l)).length;
  const sizeKb = Math.max(1, Math.round(new Blob([text]).size / 1024));

  return {
    artifact: {
      name: filename,
      kind: 'deck',
      storage_path: path,
      meta: { slides: slides || undefined, size_kb: sizeKb },
    },
    summary: slides ? `${slides} slides · ${sizeKb} KB` : `${sizeKb} KB`,
  };
}
