// Orchestrator. Wires the persona, the flow brief, the Playwright-backed
// computer tool, and the Anthropic streaming loop into a single command.
//
// Usage: `npm run qa` from repo root, or `tsx src/run.ts` from this dir.
//
// Pre-requisites:
//   1. `npm run dev` is running on the host (vite + server).
//   2. Local Supabase is up (`supabase start`).
//   3. ANTHROPIC_API_KEY + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
//      readable from server/.env (the harness loads that file directly).

import 'dotenv/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { ComputerSession, VIEWPORT, type ComputerAction } from './computer.js';
import { resetDatabase } from './reset.js';
import { PERSONA } from './persona.js';
import { FLOWS_BRIEF } from './flows.js';
import {
  parseFindingsBlock, parseFlowOutcomes, writeReport, estimateCost,
  type RunMetrics,
} from './report.js';

// ── Config ─────────────────────────────────────────────────────────────────

// Per docs: Opus 4.7 / Opus 4.6 / Sonnet 4.6 / Opus 4.5 use tool type
// `computer_20251124` + beta header `computer-use-2025-11-24`. Older models
// (Sonnet 4.5, Haiku 4.5, Sonnet 4, Opus 4.1, …) use `computer_20250124` +
// `computer-use-2025-01-24`. We default to Opus 4.7 for best vision +
// reasoning on a benchmarked-vision task; downgrade if cost matters more.
const MODEL = 'claude-opus-4-7';
const MAX_TOKENS_PER_TURN = 4096;
const MAX_ITERATIONS = 300;
const WALL_CLOCK_MS = 45 * 60 * 1000;
const APP_URL = 'http://localhost:5173';
const HEADLESS = process.env.QA_HEADLESS === '1';
const COMPUTER_USE_BETA = 'computer-use-2025-11-24';

// ── Env loading ────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

// Server holds SUPABASE_SERVICE_ROLE_KEY (we need it for the reset step).
dotenv.config({ path: path.join(REPO_ROOT, 'server', '.env') });
// Client/root holds VITE_SERVER_URL etc — not strictly needed but harmless.
dotenv.config({ path: path.join(REPO_ROOT, '.env.local') });

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[qa] missing required env. Need ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.');
  console.error('     The harness reads them from server/.env at the repo root.');
  process.exit(1);
}

// ── Tool definition (computer_use spec) ────────────────────────────────────

const COMPUTER_TOOL = {
  type: 'computer_20251124' as const,
  name: 'computer' as const,
  display_width_px: VIEWPORT.width,
  display_height_px: VIEWPORT.height,
  display_number: 1,
};

// ── Lightweight content-block shapes ───────────────────────────────────────
// Looser than the SDK's strict union types, but this is the harness — we own
// the message construction and don't need the full type discipline.

interface TextBlock { type: 'text'; text: string }
interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
interface ImageBlock { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: (TextBlock | ImageBlock)[];
  is_error?: boolean;
}
type AnyBlock = TextBlock | ToolUseBlock | ImageBlock | ToolResultBlock;
type Msg = { role: 'user' | 'assistant'; content: string | AnyBlock[] };

// ── Run ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const startedAt = new Date();
  const runDir = path.join(__dirname, '..', 'runs', isoStamp(startedAt));
  await fs.mkdir(runDir, { recursive: true });
  console.log(`[qa] run dir: ${runDir}`);

  console.log('[qa] resetting database…');
  await resetDatabase({ supabaseUrl: SUPABASE_URL!, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY! });

  console.log(`[qa] launching browser (headless=${HEADLESS})…`);
  const session = new ComputerSession({ runDir, headless: HEADLESS });
  await session.start(APP_URL);

  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const messages: Msg[] = [
    { role: 'user', content: FLOWS_BRIEF },
  ];

  let iterations = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let lastAssistantText = '';
  const wallClockDeadline = Date.now() + WALL_CLOCK_MS;
  let stopReason: 'end_turn' | 'run_complete' | 'iter_cap' | 'wall_clock' | 'error' = 'iter_cap';
  let fatalError: { message: string; stack?: string } | null = null;

  try {
    while (iterations < MAX_ITERATIONS) {
      if (Date.now() > wallClockDeadline) {
        console.warn('[qa] wall-clock deadline hit, stopping');
        stopReason = 'wall_clock';
        break;
      }
      iterations += 1;
      console.log(`[qa] iteration ${iterations} (messages: ${messages.length})…`);

      const response = await anthropic.beta.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS_PER_TURN,
        system: [
          { type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } },
        ],
        tools: [COMPUTER_TOOL] as unknown as Anthropic.Beta.BetaToolUnion[],
        messages: messages as unknown as Anthropic.Beta.BetaMessageParam[],
        betas: [COMPUTER_USE_BETA],
      });

      // Token accounting.
      inputTokens += response.usage.input_tokens ?? 0;
      outputTokens += response.usage.output_tokens ?? 0;
      cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;

      // Append the assistant turn to history verbatim — the API requires the
      // tool_use blocks be preserved exactly when we send tool_result follow-ups.
      const assistantBlocks = response.content as unknown as AnyBlock[];
      messages.push({ role: 'assistant', content: assistantBlocks });

      const textBlocks = assistantBlocks.filter((b): b is TextBlock => b.type === 'text');
      const toolUses = assistantBlocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      const allText = textBlocks.map((b) => b.text).join('\n');
      if (allText.trim()) console.log(`[qa]   text: ${truncate(allText, 200)}`);
      for (const t of toolUses) {
        console.log(`[qa]   tool_use: ${t.name}(${truncate(JSON.stringify(t.input), 80)})`);
      }
      lastAssistantText = allText;

      if (allText.includes('RUN_COMPLETE')) {
        stopReason = 'run_complete';
        break;
      }
      if (response.stop_reason === 'end_turn' && toolUses.length === 0) {
        stopReason = 'end_turn';
        break;
      }

      if (toolUses.length === 0) {
        console.warn(`[qa]   no tool_use and stop_reason=${response.stop_reason}; nudging continue`);
        messages.push({ role: 'user', content: 'continue' });
        continue;
      }

      const toolResults: ToolResultBlock[] = [];
      for (const tu of toolUses) {
        if (tu.name !== 'computer') {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: [{ type: 'text', text: `unknown tool: ${tu.name}` }],
            is_error: true,
          });
          continue;
        }
        const out = await session.dispatch(tu.input as ComputerAction);
        const blocks: (TextBlock | ImageBlock)[] = [];
        if (out.text) blocks.push({ type: 'text', text: out.text });
        if (out.imageBase64) {
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: out.imageBase64 },
          });
        }
        if (blocks.length === 0) blocks.push({ type: 'text', text: 'ok' });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: blocks,
          is_error: out.isError === true,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }
  } catch (err) {
    // Capture the failure but don't bail — we still want to persist whatever
    // we have so the human can triage from the transcript + screenshots.
    stopReason = 'error';
    fatalError = {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
    console.error('[qa] loop errored — will still write report:', fatalError.message);
  } finally {
    await session.stop().catch(() => {});
  }

  console.log(`[qa] loop ended: ${stopReason} (iterations=${iterations})`);

  // Parse the structured trailers Claude was instructed to emit. On error /
  // partial runs these will usually be empty — that's fine, the report still
  // captures iterations, tokens, cost, and the run dir has full transcript +
  // screenshots for manual triage.
  const findings = parseFindingsBlock(lastAssistantText);
  const flowOutcomes = parseFlowOutcomes(lastAssistantText);

  const finishedAt = new Date();
  const metrics: RunMetrics = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    iterations,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    model: MODEL,
    estimatedCostUsd: estimateCost(inputTokens, outputTokens, cacheReadTokens),
  };

  // Always persist transcript + report, even on partial / errored runs.
  // Wrap each write in its own try so a disk-full or permission failure on
  // one doesn't lose the other.
  try {
    await fs.writeFile(
      path.join(runDir, 'transcript.json'),
      JSON.stringify({ metrics, stopReason, fatalError, lastAssistantText, messages }, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.warn('[qa] failed to write transcript.json:', err);
  }
  try {
    const reportPath = await writeReport({ findings, flowOutcomes, metrics, runDir });
    console.log(`[qa] report: ${reportPath}`);
  } catch (err) {
    console.warn('[qa] failed to write report.md:', err);
  }
  console.log(`[qa] findings: ${findings.length} · estimated cost: $${metrics.estimatedCostUsd.toFixed(2)}`);

  if (fatalError) {
    process.exit(2);
  }
  if (findings.length === 0 && stopReason !== 'run_complete' && stopReason !== 'end_turn') {
    process.exit(2);
  }
}

function isoStamp(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

main().catch((err) => {
  console.error('[qa] fatal:', err);
  process.exit(1);
});
