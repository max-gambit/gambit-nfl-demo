import type { AgentKind } from '@shared/types';
import { runDeckAgent } from './deck.js';
import { runMemoAgent } from './memo.js';
import { runResearchAgent } from './research.js';
import { runChangeMyMindAgent } from './change_my_mind.js';
import { runStaffProtocolAgent } from './staff_protocol.js';

export interface AgentResult {
  artifact: {
    name: string;
    kind: string;
    storage_path: string;
    meta: Record<string, unknown>;
  };
  summary: string;
}

export type AgentHandler = (
  briefId: string,
  config: { query?: string },
  agentRunId: string,
) => Promise<AgentResult>;

const HANDLERS: Record<AgentKind, AgentHandler> = {
  deck: runDeckAgent,
  memo: runMemoAgent,
  research: runResearchAgent,
  change_my_mind: runChangeMyMindAgent,
  // comp_set / synthesize fall through to research for the prototype — same
  // shape, same artifact format. We can split them later if needed.
  comp_set: runResearchAgent,
  synthesize: runResearchAgent,
  staff_protocol: runStaffProtocolAgent,
};

export function handlerFor(kind: AgentKind): AgentHandler {
  const h = HANDLERS[kind];
  if (!h) throw new Error(`no handler for agent kind: ${kind}`);
  return h;
}

export const AGENT_TITLES: Record<AgentKind, string> = {
  deck: 'Generating deck',
  memo: 'Drafting memo',
  research: 'Deep research',
  comp_set: 'Building comp set',
  synthesize: 'Synthesizing across briefs',
  change_my_mind: 'Stress-testing the brief',
  staff_protocol: 'Creating staff protocol',
};
