import { BRIEF_MODEL } from '../client.js';
import {
  loadBriefBundle, agentSystemBlocks, uploadMarkdownArtifact, safeSlug,
} from './shared.js';
import { createMessageWithContextGraphTools } from '../tool_loop.js';
import type { AgentResult } from './index.js';

const STAFF_PROTOCOL_SYSTEM = `You are the Gambit Analyst creating a staff protocol packet from an existing NBA front-office brief.

The output is meant to be forwarded by a president of basketball operations to analytics, coaching, scouting/front office, and cap/contracts staff. It should turn the brief into a clear packet: answer, why, risks, alternatives, and the exact questions staff should prioritize.

Output a single Markdown document with this structure:

# Staff Protocol: <decision title>

## Verdict
One direct answer with confidence. If the active question is binary, answer yes/no/conditional before explaining.

## Why
3-5 concise bullets grounded in the active brief evidence. Cite source refs or option refs where available.

## Risks
3-5 bullets naming the ways the answer could be wrong, including stale/missing/private-data caveats.

## What would change the answer
3-5 observable triggers that would flip or materially soften the verdict.

## Alternatives to study
Group alternatives into internal, draft, league-wide, and no-action/status-quo lanes. If a lane is not supported by evidence, say what data is missing instead of inventing names.

## Staff questions
Use four subsections: Analytics, Coaching, Scouting / Front office, and Cap / Contracts. Each subsection should have 3-5 sharp questions that can be forwarded as-is. Prioritize the highest-leverage questions first.

Tone: direct, executive, and forwardable. Do not recommend obviously invalid or off-limits names except as rejected comparables. Keep current app evidence above Intel narrative, and caveat missing private team data loudly.`;

export async function runStaffProtocolAgent(
  briefId: string,
  config: { query?: string },
  agentRunId: string,
): Promise<AgentResult> {
  const bundle = await loadBriefBundle(briefId);

  const userPrompt = config.query
    ? `Create a staff protocol packet from the active brief. Specific angle: ${config.query}`
    : 'Create a staff protocol packet from the active brief. Make it forwardable to analytics, coaching, scouting/front office, and cap/contracts.';

  const { message: response } = await createMessageWithContextGraphTools({
    model: BRIEF_MODEL,
    max_tokens: 6144,
    system: await agentSystemBlocks(STAFF_PROTOCOL_SYSTEM, bundle),
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim();

  if (!text) throw new Error('staff_protocol agent returned empty output');

  const stem = safeSlug(config.query ?? bundle.brief.thesis ?? bundle.brief.question);
  const filename = `${stem}-staff-protocol.md`;
  const path = await uploadMarkdownArtifact(agentRunId, filename, text);

  const staffQuestionCount = text.split('\n').filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
  const sizeKb = Math.max(1, Math.round(new Blob([text]).size / 1024));

  return {
    artifact: {
      name: filename,
      kind: 'staff_protocol',
      storage_path: path,
      meta: { staff_questions: staffQuestionCount || undefined, size_kb: sizeKb },
    },
    summary: staffQuestionCount
      ? `${staffQuestionCount} staff prompts · ${sizeKb} KB`
      : `Staff packet · ${sizeKb} KB`,
  };
}
