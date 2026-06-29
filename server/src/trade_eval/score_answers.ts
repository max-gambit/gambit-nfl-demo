import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEFAULT_TRADE_EVAL_GENERATED_AT,
  DEFAULT_TRADE_EVAL_OUT_DIR,
  buildTradeEvalReport,
  renderTradeEvalReportMarkdown,
  scoreTradeEvalAnswers,
} from './corpus.js';
import {
  parseTradeEvalLabelFixture,
  parseTradeEvalPromptFixture,
  parseTradeEvalScenarioFixture,
  type TradeEvalAnswerInput,
} from '@shared/tradeEval';

const args = Object.fromEntries(process.argv.slice(2)
  .filter((arg) => arg.startsWith('--') && arg.includes('='))
  .map((arg) => {
    const [key, ...rest] = arg.slice(2).split('=');
    return [key, rest.join('=')];
  }));

const answersPath = args.answers;
if (!answersPath) {
  throw new Error('Usage: npm --prefix server run score:trade-eval-corpus -- --answers=/absolute/or/relative/answers.json [--out-dir=...] [--corpus-dir=...]');
}

const corpusDir = args['corpus-dir'] || DEFAULT_TRADE_EVAL_OUT_DIR;
const outDir = args['out-dir'] || join(corpusDir, 'reports');

const [scenarioRaw, promptRaw, labelRaw, answerRaw] = await Promise.all([
  readFile(join(corpusDir, 'scenarios.v0.json'), 'utf8'),
  readFile(join(corpusDir, 'prompts.v0.json'), 'utf8'),
  readFile(join(corpusDir, 'labels.v0.json'), 'utf8'),
  readFile(answersPath, 'utf8'),
]);

const scenarios = parseTradeEvalScenarioFixture(JSON.parse(scenarioRaw)).scenarios;
const prompts = parseTradeEvalPromptFixture(JSON.parse(promptRaw)).prompts;
const labels = parseTradeEvalLabelFixture(JSON.parse(labelRaw)).labels;
const answers = parseAnswerInputs(JSON.parse(answerRaw));
const scores = scoreTradeEvalAnswers({ prompts, labels, answers });
const report = buildTradeEvalReport({
  scenarios,
  prompts: answers.map((answer) => {
    const prompt = prompts.find((item) => item.id === answer.prompt_id);
    if (!prompt) throw new Error(`answer references unknown prompt_id ${answer.prompt_id}`);
    return prompt;
  }),
  scores,
  generatedAt: DEFAULT_TRADE_EVAL_GENERATED_AT,
});

await mkdir(outDir, { recursive: true });
await Promise.all([
  writeFile(join(outDir, 'report.latest.json'), `${JSON.stringify(report, null, 2)}\n`),
  writeFile(join(outDir, 'report.latest.md'), renderTradeEvalReportMarkdown(report)),
]);

console.log([
  `Wrote NBA trade eval report to ${outDir}`,
  `prompts=${report.prompt_count}`,
  `pass=${report.pass_count}`,
  `warning=${report.warning_count}`,
  `fail=${report.fail_count}`,
].join(' '));

function parseAnswerInputs(value: unknown): TradeEvalAnswerInput[] {
  const maybeAnswers = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { answers?: unknown }).answers)
      ? (value as { answers: unknown[] }).answers
      : null;
  if (!maybeAnswers) throw new Error('answers file must be an array or an object with an answers array');
  return maybeAnswers.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`answers[${index}] must be an object`);
    const record = item as Record<string, unknown>;
    if (typeof record.prompt_id !== 'string' || !record.prompt_id) throw new Error(`answers[${index}].prompt_id must be a non-empty string`);
    if (typeof record.answer !== 'string' || !record.answer) throw new Error(`answers[${index}].answer must be a non-empty string`);
    return {
      prompt_id: record.prompt_id,
      answer: record.answer,
    };
  });
}
