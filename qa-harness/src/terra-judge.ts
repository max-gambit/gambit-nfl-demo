export const NFL_RELIABILITY_JUDGE_MODEL = 'gpt-5.6-terra';
export const NFL_RELIABILITY_MAX_JUDGE_CALLS = 1;
export const NFL_RELIABILITY_MAX_JUDGE_OUTPUT_TOKENS = 600;

export type NflReliabilityViolation =
  | 'stale_context'
  | 'wrong_team'
  | 'wrong_player'
  | 'wrong_pick'
  | 'money_swap'
  | 'unsupported_numeric_claim'
  | 'missing_followup_answer'
  | 'interpretation_unavailable';

export interface NflReliabilityJudgeCase {
  id: string;
  answer: string;
  facts: Record<string, string | number | boolean | null>;
}

export interface NflReliabilityJudgeVerdict {
  id: string;
  verdict: 'pass' | 'fail' | 'inconclusive';
  violations: NflReliabilityViolation[];
  rationale: string;
}

export interface TerraJudgeRequest {
  model: string;
  store: false;
  reasoning: { effort: 'none' };
  max_output_tokens: number;
  input: Array<{
    role: 'system' | 'user';
    content: Array<{ type: 'input_text'; text: string }>;
  }>;
  text: {
    format: {
      type: 'json_schema';
      name: 'nfl_answer_reliability';
      strict: true;
      schema: Record<string, unknown>;
    };
  };
}

export type TerraJudgeResult =
  | { status: 'skipped_no_openai_key'; verdicts: []; usage: null }
  | {
    status: 'completed';
    verdicts: NflReliabilityJudgeVerdict[];
    usage: { input_tokens: number | null; output_tokens: number | null };
  };

const VIOLATIONS: NflReliabilityViolation[] = [
  'stale_context',
  'wrong_team',
  'wrong_player',
  'wrong_pick',
  'money_swap',
  'unsupported_numeric_claim',
  'missing_followup_answer',
  'interpretation_unavailable',
];

export function buildTerraJudgeRequest(
  cases: NflReliabilityJudgeCase[],
  model = NFL_RELIABILITY_JUDGE_MODEL,
): TerraJudgeRequest {
  if (cases.length === 0) throw new Error('At least one completed reliability case is required.');
  const ids = cases.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error('Reliability judge case IDs must be unique.');
  return {
    model,
    store: false,
    reasoning: { effort: 'none' },
    max_output_tokens: NFL_RELIABILITY_MAX_JUDGE_OUTPUT_TOKENS,
    input: [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: [
            'Act as a conservative NFL front-office answer-quality judge.',
            'Compare each answer only with its server-generated fact sheet.',
            'Fail concrete grounding errors. Mark ambiguous semantic quality inconclusive.',
            'Do not introduce outside football facts. Keep each rationale under 160 characters.',
          ].join(' '),
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'input_text',
          text: JSON.stringify({ cases }),
        }],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'nfl_answer_reliability',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cases: {
              type: 'array',
              minItems: cases.length,
              maxItems: cases.length,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', enum: ids },
                  verdict: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
                  violations: {
                    type: 'array',
                    items: { type: 'string', enum: VIOLATIONS },
                  },
                  rationale: { type: 'string' },
                },
                required: ['id', 'verdict', 'violations', 'rationale'],
              },
            },
          },
          required: ['cases'],
        },
      },
    },
  };
}

export async function judgeNflReliabilityCases(options: {
  apiKey?: string;
  cases: NflReliabilityJudgeCase[];
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<TerraJudgeResult> {
  if (!options.apiKey?.trim()) {
    return { status: 'skipped_no_openai_key', verdicts: [], usage: null };
  }
  const request = buildTerraJudgeRequest(options.cases, options.model);
  const response = await (options.fetchImpl ?? fetch)('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + options.apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error('Terra judge request failed with HTTP ' + response.status + '.');
  }
  const body = await response.json() as unknown;
  const verdicts = parseTerraJudgeResponse(body, options.cases.map((entry) => entry.id));
  const usage = isRecord(body) && isRecord(body.usage) ? body.usage : {};
  return {
    status: 'completed',
    verdicts,
    usage: {
      input_tokens: integerOrNull(usage.input_tokens),
      output_tokens: integerOrNull(usage.output_tokens),
    },
  };
}

export function parseTerraJudgeResponse(
  response: unknown,
  expectedIds: string[],
): NflReliabilityJudgeVerdict[] {
  if (!isRecord(response)) throw new Error('Terra judge returned an invalid response object.');
  const outputText = typeof response.output_text === 'string'
    ? response.output_text
    : outputTextFromBlocks(response.output);
  if (!outputText) throw new Error('Terra judge response did not contain output text.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error('Terra judge output was not valid JSON.');
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.cases)) {
    throw new Error('Terra judge output did not match the expected batch shape.');
  }
  const expected = new Set(expectedIds);
  const verdicts = parsed.cases.map(parseVerdict);
  if (verdicts.length !== expected.size
    || new Set(verdicts.map((entry) => entry.id)).size !== expected.size
    || verdicts.some((entry) => !expected.has(entry.id))) {
    throw new Error('Terra judge output did not return each requested case exactly once.');
  }
  return verdicts;
}

function parseVerdict(value: unknown): NflReliabilityJudgeVerdict {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !['pass', 'fail', 'inconclusive'].includes(String(value.verdict))
    || !Array.isArray(value.violations)
    || value.violations.some((entry) => !VIOLATIONS.includes(entry as NflReliabilityViolation))
    || typeof value.rationale !== 'string') {
    throw new Error('Terra judge returned an invalid case verdict.');
  }
  return {
    id: value.id,
    verdict: value.verdict as NflReliabilityJudgeVerdict['verdict'],
    violations: value.violations as NflReliabilityViolation[],
    rationale: value.rationale,
  };
}

function outputTextFromBlocks(output: unknown): string | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  return null;
}

function integerOrNull(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
