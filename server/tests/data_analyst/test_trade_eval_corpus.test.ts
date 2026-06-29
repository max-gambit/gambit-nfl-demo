import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  TRADE_EVAL_PROMPT_TYPES,
  parseTradeEvalLabelFixture,
  parseTradeEvalPromptFixture,
  parseTradeEvalScenarioFixture,
  tradeEvalScenarioSignature,
  type TradeEvalLabel,
} from '@shared/tradeEval';
import {
  REALGM_CURRENT_TRADE_RESTRICTED_PLAYER_NAMES,
  buildTradeEvalArtifacts,
  buildTradeEvalReport,
  mergeTradeEvalLabels,
  renderTradeEvalReportMarkdown,
  scoreTradeEvalAnswers,
  scoreTradeEvalAnswer,
} from '../../src/trade_eval/corpus.js';
import { loadNbaCapSheetSeed } from '../../src/nba_cap_sheets/seed.js';

const scenarioPath = fileURLToPath(new URL('../../../data/evals/nba-trade-corpus/scenarios.v0.json', import.meta.url));
const promptPath = fileURLToPath(new URL('../../../data/evals/nba-trade-corpus/prompts.v0.json', import.meta.url));
const labelPath = fileURLToPath(new URL('../../../data/evals/nba-trade-corpus/labels.v0.json', import.meta.url));
const queuePath = fileURLToPath(new URL('../../../data/evals/nba-trade-corpus/realgm-labeling-queue.v0.json', import.meta.url));

test('trade eval fixtures parse and preserve V0 coverage', async () => {
  const [scenarioRaw, promptRaw, labelRaw, queueRaw] = await Promise.all([
    readFile(scenarioPath, 'utf8'),
    readFile(promptPath, 'utf8'),
    readFile(labelPath, 'utf8'),
    readFile(queuePath, 'utf8'),
  ]);
  const scenarioFixture = parseTradeEvalScenarioFixture(JSON.parse(scenarioRaw));
  const promptFixture = parseTradeEvalPromptFixture(JSON.parse(promptRaw));
  const labelFixture = parseTradeEvalLabelFixture(JSON.parse(labelRaw));
  const queue = JSON.parse(queueRaw) as { policy: { max_batch_size: number; min_delay_seconds: number; no_captcha_bypass: boolean; no_scaled_scraping: boolean }; items: unknown[] };

  assert.equal(scenarioFixture.scenarios.length, 50);
  assert.equal(promptFixture.prompts.length, 200);
  assert.equal(labelFixture.labels.length, 50);
  assert.equal(queue.items.length, 50);
  assert.equal(queue.policy.max_batch_size, 5);
  assert.equal(queue.policy.min_delay_seconds, 2);
  assert.equal(queue.policy.no_captcha_bypass, true);
  assert.equal(queue.policy.no_scaled_scraping, true);

  const tagCounts = new Map<string, number>();
  for (const scenario of scenarioFixture.scenarios) {
    for (const tag of scenario.rule_tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  assert.equal(tagCounts.get('clean_control'), 8);
  assert.ok((tagCounts.get('salary_matching') ?? 0) >= 20);
  assert.equal(tagCounts.get('second_apron'), 8);
  assert.equal(tagCounts.get('hard_cap'), 8);
  assert.equal(tagCounts.get('sign_and_trade'), 8);
  assert.equal(tagCounts.get('trade_exception'), 8);
  assert.equal(tagCounts.get('multi_team'), 6);
  assert.equal(scenarioFixture.scenarios.filter((scenario) => scenario.oracle.expected_legality === 'source_needed').length, 2);

  const realGmRestrictedNames = new Set(REALGM_CURRENT_TRADE_RESTRICTED_PLAYER_NAMES.map(normalizePlayerName));
  for (const scenario of scenarioFixture.scenarios) {
    const playerAssets = scenario.construction.flatMap((leg) => [...leg.sends, ...leg.receives]).filter((asset) => asset.kind === 'player');
    const hasMissingPlayerSalary = playerAssets.some((asset) => asset.salary_amount == null);
    if (hasMissingPlayerSalary) assert.equal(scenario.oracle.expected_legality, 'source_needed', scenario.id);
    if (scenario.rule_tags.includes('clean_control')) {
      const names = playerAssets.map((asset) => asset.player_name ?? asset.label);
      assert.equal(names.some((name) => realGmRestrictedNames.has(normalizePlayerName(name))), false, scenario.id);
    }
  }
});

test('trade eval generator deterministically recreates source artifacts and labels support imports', async () => {
  const seed = await loadNbaCapSheetSeed();
  const generated = buildTradeEvalArtifacts(seed);
  const scenarioFixtureRaw = JSON.parse(await readFile(scenarioPath, 'utf8'));
  const scenarioFixture = parseTradeEvalScenarioFixture(scenarioFixtureRaw);
  const promptFixture = JSON.parse(await readFile(promptPath, 'utf8'));
  const labelFixture = parseTradeEvalLabelFixture(JSON.parse(await readFile(labelPath, 'utf8')));

  assert.deepEqual(JSON.parse(JSON.stringify(generated.scenarios)), scenarioFixtureRaw);
  assert.deepEqual(JSON.parse(JSON.stringify(generated.prompts)), promptFixture);

  const generatedLabelsByScenario = new Map(generated.labels.labels.map((label) => [label.scenario_id, label]));
  for (const label of labelFixture.labels) {
    const generatedLabel = generatedLabelsByScenario.get(label.scenario_id);
    assert.ok(generatedLabel, label.scenario_id);
    if (label.status === 'labeled') {
      assert.equal(label.label_confidence, 'realgm');
      assert.ok(label.checked_at, label.scenario_id);
      assert.ok(label.screenshot_path?.startsWith('data/evals/nba-trade-corpus/evidence/realgm/'), label.scenario_id);
      assert.ok(label.page_text_path?.startsWith('data/evals/nba-trade-corpus/evidence/realgm/'), label.scenario_id);
      assert.equal(label.scenario_signature, tradeEvalScenarioSignature(scenarioFixture.scenarios.find((scenario) => scenario.id === label.scenario_id)!));
    } else {
      assert.deepEqual(label, generatedLabel);
    }
  }
});

test('trade eval prompt materialization emits four rubric-backed prompts per scenario', async () => {
  const scenarioFixture = parseTradeEvalScenarioFixture(JSON.parse(await readFile(scenarioPath, 'utf8')));
  const promptFixture = parseTradeEvalPromptFixture(JSON.parse(await readFile(promptPath, 'utf8')));
  const promptsByScenario = new Map<string, string[]>();
  for (const prompt of promptFixture.prompts) {
    const list = promptsByScenario.get(prompt.scenario_id) ?? [];
    list.push(prompt.prompt_type);
    promptsByScenario.set(prompt.scenario_id, list);
    assert.ok(prompt.prompt.includes(prompt.scenario_id));
    assert.ok(prompt.expected.must_mention.length > 0);
    assert.ok(prompt.expected.allowed_uncertainty.length > 0);
  }

  for (const scenario of scenarioFixture.scenarios) {
    assert.deepEqual((promptsByScenario.get(scenario.id) ?? []).sort(), [...TRADE_EVAL_PROMPT_TYPES].sort(), scenario.id);
  }
});

test('trade eval label merge imports RealGM evidence without touching other labels', async () => {
  const labelFixture = parseTradeEvalLabelFixture(JSON.parse(await readFile(labelPath, 'utf8')));
  const first = labelFixture.labels[0];
  const imported: TradeEvalLabel = {
    ...first,
    status: 'labeled',
    checked_at: '2026-06-29T19:30:00.000Z',
    reason_text: 'RealGM reports this trade is successful.',
    screenshot_path: 'data/evals/nba-trade-corpus/evidence/trade_eval_v0_001.png',
    page_text_path: 'data/evals/nba-trade-corpus/evidence/trade_eval_v0_001.txt',
    label_confidence: 'realgm',
  };

  const merged = mergeTradeEvalLabels(labelFixture.labels, [imported]);

  assert.equal(merged[0].status, 'labeled');
  assert.equal(merged[0].label_confidence, 'realgm');
  assert.equal(merged[0].screenshot_path, imported.screenshot_path);
  assert.equal(merged[1], labelFixture.labels[1]);
});

test('trade eval label merge rejects stale evidence for changed scenarios', async () => {
  const seed = await loadNbaCapSheetSeed();
  const generated = buildTradeEvalArtifacts(seed);
  const base = generated.labels.labels[1];
  const staleImported: TradeEvalLabel = {
    ...base,
    scenario_signature: 'scenario:v1:stale:0',
    status: 'labeled',
    checked_at: '2026-06-29T19:55:44.256Z',
    expected_legality: 'illegal',
    reason_text: 'Old RealGM evidence for a previous construction.',
    screenshot_path: 'data/evals/nba-trade-corpus/evidence/realgm/old.png',
    page_text_path: 'data/evals/nba-trade-corpus/evidence/realgm/old.txt',
    label_confidence: 'realgm',
  };

  const merged = mergeTradeEvalLabels([base], [staleImported]);

  assert.deepEqual(merged[0], base);
});

test('trade eval scorer distinguishes correctness, weak diagnosis, and source-needed overconfidence', async () => {
  const promptFixture = parseTradeEvalPromptFixture(JSON.parse(await readFile(promptPath, 'utf8')));
  const labelFixture = parseTradeEvalLabelFixture(JSON.parse(await readFile(labelPath, 'utf8')));
  const labelsByScenario = new Map(labelFixture.labels.map((label) => [label.scenario_id, label]));

  const illegalPrompt = promptFixture.prompts.find((prompt) => (
    prompt.prompt_type === 'diagnosis'
    && prompt.expected.expected_legality === 'illegal'
    && prompt.expected.must_mention.includes('salary matching')
  ));
  assert.ok(illegalPrompt);
  const illegalLabel = labelsByScenario.get(illegalPrompt.scenario_id);
  assert.ok(illegalLabel);
  const strongIllegal = scoreTradeEvalAnswer(
    illegalPrompt,
    illegalLabel,
    'This is invalid under salary matching. The current cap sheet and CBA salary-matching band need a larger outgoing package before a Trade Checker confirmation.',
  );
  assert.equal(strongIllegal.status, 'pass');
  assert.equal(strongIllegal.failure_modes.length, 0);

  const weakDiagnosis = scoreTradeEvalAnswer(
    illegalPrompt,
    illegalLabel,
    'This is invalid because it feels too expensive for Golden State.',
  );
  assert.notEqual(weakDiagnosis.status, 'pass');
  assert.ok(weakDiagnosis.failure_modes.includes('weak_rule_diagnosis'));

  const cautiousNonAnswer = scoreTradeEvalAnswer(
    illegalPrompt,
    illegalLabel,
    'I cannot verify this; it needs a trade checker and salary matching review.',
  );
  assert.equal(cautiousNonAnswer.status, 'fail');
  assert.equal(cautiousNonAnswer.subscores.legality, 0);
  assert.ok(cautiousNonAnswer.failure_modes.includes('missed_illegal_legality'));

  const sourceNeededPrompt = promptFixture.prompts.find((prompt) => (
    prompt.prompt_type === 'legality'
    && prompt.expected.expected_legality === 'source_needed'
  ));
  assert.ok(sourceNeededPrompt);
  const sourceNeededLabel = labelsByScenario.get(sourceNeededPrompt.scenario_id);
  assert.ok(sourceNeededLabel);
  const overconfident = scoreTradeEvalAnswer(
    sourceNeededPrompt,
    sourceNeededLabel,
    'This is definitely legal without checking salary.',
  );
  assert.equal(overconfident.status, 'fail');
  assert.ok(overconfident.failure_modes.includes('missed_source_needed_legality'));
  assert.ok(overconfident.failure_modes.includes('forbidden_claim'));

  const legalPrompt = promptFixture.prompts.find((prompt) => (
    prompt.prompt_type === 'legality'
    && prompt.expected.expected_legality === 'legal'
  ));
  assert.ok(legalPrompt);
  const legalLabel = labelsByScenario.get(legalPrompt.scenario_id);
  assert.ok(legalLabel);
  const negatedLegal = scoreTradeEvalAnswer(
    legalPrompt,
    legalLabel,
    'This trade is not legal under the CBA.',
  );
  assert.equal(negatedLegal.status, 'fail');
  assert.equal(negatedLegal.subscores.legality, 0);
  assert.ok(negatedLegal.failure_modes.includes('missed_legal_legality'));

  const signAndTradePrompt = promptFixture.prompts.find((prompt) => (
    prompt.prompt_type === 'legality'
    && prompt.expected.must_mention.includes('sign-and-trade')
  ));
  assert.ok(signAndTradePrompt);
  const signAndTradeLabel = labelsByScenario.get(signAndTradePrompt.scenario_id);
  assert.ok(signAndTradeLabel);
  const unhyphenatedRuleName = scoreTradeEvalAnswer(
    signAndTradePrompt,
    signAndTradeLabel,
    'This is illegal under the CBA because the sign and trade hard cap blocks the structure.',
  );
  assert.equal(unhyphenatedRuleName.subscores.rule_diagnosis, 1);
  assert.equal(unhyphenatedRuleName.status, 'pass');
});

test('trade eval report groups scores by rule family', async () => {
  const scenarioFixture = parseTradeEvalScenarioFixture(JSON.parse(await readFile(scenarioPath, 'utf8')));
  const promptFixture = parseTradeEvalPromptFixture(JSON.parse(await readFile(promptPath, 'utf8')));
  const labelFixture = parseTradeEvalLabelFixture(JSON.parse(await readFile(labelPath, 'utf8')));
  const prompts = promptFixture.prompts.slice(0, 6);
  const scores = scoreTradeEvalAnswers({
    prompts: promptFixture.prompts,
    labels: labelFixture.labels,
    answers: prompts.map((prompt) => ({
      prompt_id: prompt.id,
      answer: 'This answer needs current cap sheet, CBA salary matching, and RealGM or internal solver confirmation before final use by the Warriors front office.',
    })),
  });

  const report = buildTradeEvalReport({
    scenarios: scenarioFixture.scenarios,
    prompts,
    scores,
  });

  assert.equal(report.corpus_id, 'nba-trade-corpus-v0');
  assert.equal(report.prompt_count, prompts.length);
  assert.ok(report.by_rule_family.salary_matching.prompt_count > 0);
  assert.ok(report.by_rule_family.clean_control.prompt_count > 0);
  const markdown = renderTradeEvalReportMarkdown(report);
  assert.match(markdown, /NBA Trade Eval Report/);
  assert.match(markdown, /Rule Families/);
  assert.match(markdown, /salary_matching/);
});

function normalizePlayerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
