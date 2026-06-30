import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRADE_EVAL_CORPUS_ID,
  TRADE_EVAL_PROMPT_TYPES,
  TRADE_EVAL_SCHEMA_VERSION,
  tradeEvalScenarioSignature,
  type TradeEvalAnswerScore,
  type TradeEvalAnswerInput,
  type TradeEvalAsset,
  type TradeEvalLabel,
  type TradeEvalLabelFixture,
  type TradeEvalLabelingQueue,
  type TradeEvalLegality,
  type TradeEvalPrompt,
  type TradeEvalPromptFixture,
  type TradeEvalPromptType,
  type TradeEvalReport,
  type TradeEvalRuleTag,
  type TradeEvalScenario,
  type TradeEvalScenarioFixture,
  type TradeEvalSourceBehavior,
  type TradeEvalSourceDataVersion,
  type TradeEvalTeamLeg,
  type TradeEvalTeamSalaryTotal,
} from '@shared/tradeEval';
import type { NbaCapSheetPlayerRow } from '@shared/types';
import type { NbaCapSheetSeed, NbaCapSheetSeedTeam } from '../nba_cap_sheets/seed.js';

export const DEFAULT_TRADE_EVAL_OUT_DIR = fileURLToPath(new URL('../../../data/evals/nba-trade-corpus', import.meta.url));
export const DEFAULT_TRADE_EVAL_GENERATED_AT = '2026-06-29T00:00:00.000Z';
export const DEFAULT_TRADE_EVAL_SUBJECT_TEAM_ID = 'GSW';
export const REALGM_CURRENT_TRADE_RESTRICTED_PLAYER_NAMES = ['Al Horford'] as const;

const SECOND_APRON_FALLBACK = 207_824_000;

export interface TradeEvalArtifacts {
  scenarios: TradeEvalScenarioFixture;
  prompts: TradeEvalPromptFixture;
  labels: TradeEvalLabelFixture;
  labelingQueue: TradeEvalLabelingQueue;
}

export interface TradeEvalBuildOptions {
  generatedAt?: string;
  subjectTeamId?: string;
}

interface GenerationContext {
  seed: NbaCapSheetSeed;
  subjectTeamId: string;
  sourceDataVersion: TradeEvalSourceDataVersion;
  sheetsByTeam: Map<string, NbaCapSheetSeedTeam>;
}

interface AssetSpec {
  kind: TradeEvalAsset['kind'];
  teamId: string;
  direction: TradeEvalAsset['direction'];
  rank?: number;
  sourceNeededRank?: number;
  excludedPlayerNames?: readonly string[];
  label?: string;
  salaryAmount?: number | null;
  salarySourceStatus?: TradeEvalAsset['salary_source_status'];
  notes?: string;
}

interface ScenarioDefinition {
  slug: string;
  title: string;
  summary: string;
  teams: string[];
  ruleTags: TradeEvalRuleTag[];
  intendedEdge: string;
  expectedLegality: TradeEvalLegality;
  expectedFailureReasons: string[];
  expectedRepairHints: string[];
  legs: Array<{
    teamId: string;
    sends: AssetSpec[];
    receives: AssetSpec[];
  }>;
}

export function buildTradeEvalArtifacts(
  seed: NbaCapSheetSeed,
  options: TradeEvalBuildOptions = {},
): TradeEvalArtifacts {
  const scenarios = buildTradeEvalScenarios(seed, options);
  const generatedAt = options.generatedAt ?? DEFAULT_TRADE_EVAL_GENERATED_AT;
  const baseMeta = buildFixtureMeta(seed, {
    generatedAt,
    subjectTeamId: options.subjectTeamId ?? DEFAULT_TRADE_EVAL_SUBJECT_TEAM_ID,
    scenarioCount: scenarios.length,
  });
  const prompts = materializeTradeEvalPrompts(scenarios);
  const labels = buildInitialTradeEvalLabels(scenarios);
  return {
    scenarios: {
      meta: baseMeta,
      scenarios,
    },
    prompts: {
      meta: { ...baseMeta, prompt_count: prompts.length },
      prompts,
    },
    labels: {
      meta: { ...baseMeta, label_count: labels.length },
      labels,
    },
    labelingQueue: buildRealGmLabelingQueue(scenarios, baseMeta),
  };
}

export function buildTradeEvalScenarios(
  seed: NbaCapSheetSeed,
  options: TradeEvalBuildOptions = {},
): TradeEvalScenario[] {
  const context = buildGenerationContext(seed, options.subjectTeamId ?? DEFAULT_TRADE_EVAL_SUBJECT_TEAM_ID);
  const definitions = buildScenarioDefinitions(context);
  if (definitions.length !== 50) {
    throw new Error(`trade eval V0 expected 50 scenario definitions, found ${definitions.length}`);
  }
  return definitions.map((definition, index) => scenarioFromDefinition(context, definition, index + 1));
}

export function materializeTradeEvalPrompts(scenarios: TradeEvalScenario[]): TradeEvalPrompt[] {
  return scenarios.flatMap((scenario) => TRADE_EVAL_PROMPT_TYPES.map((promptType) => buildPrompt(scenario, promptType)));
}

export function buildInitialTradeEvalLabels(scenarios: TradeEvalScenario[]): TradeEvalLabel[] {
  return scenarios.map((scenario): TradeEvalLabel => {
    const sourceNeeded = scenario.oracle.expected_legality === 'source_needed';
    return {
      scenario_id: scenario.id,
      scenario_signature: tradeEvalScenarioSignature(scenario),
      source: sourceNeeded ? 'internal_heuristic' : 'realgm_tradechecker',
      status: sourceNeeded ? 'source_needed' : 'manual_pending',
      expected_legality: scenario.oracle.expected_legality,
      checked_at: null,
      reason_text: sourceNeeded
        ? 'Skipped until the missing salary/source row is resolved.'
        : 'Pending small-batch RealGM Trade Checker review; heuristic expectation is not final gold.',
      screenshot_path: null,
      page_text_path: null,
      label_confidence: sourceNeeded ? 'source_gap' : 'heuristic',
      reviewer_notes: '',
    };
  });
}

export function mergeTradeEvalLabels(
  baseLabels: TradeEvalLabel[],
  importedLabels: TradeEvalLabel[],
): TradeEvalLabel[] {
  const importedByScenario = new Map(importedLabels.map((label) => [label.scenario_id, label]));
  return baseLabels.map((label) => {
    const imported = importedByScenario.get(label.scenario_id);
    if (!imported) return label;
    if (imported.scenario_signature !== label.scenario_signature) return label;
    return imported;
  });
}

export function buildRealGmLabelingQueue(
  scenarios: TradeEvalScenario[],
  meta: TradeEvalScenarioFixture['meta'],
): TradeEvalLabelingQueue {
  return {
    meta,
    policy: {
      max_batch_size: 5,
      min_delay_seconds: 2,
      no_captcha_bypass: true,
      no_scaled_scraping: true,
    },
    items: scenarios.map((scenario) => ({
      scenario_id: scenario.id,
      title: scenario.title,
      teams: scenario.teams,
      rule_tags: scenario.rule_tags,
      realgm_url: 'https://basketball.realgm.com/tradechecker',
      recommended_action: scenario.oracle.expected_legality === 'source_needed'
        ? 'skip_until_salary_source'
        : 'check_in_realgm',
      stop_conditions: [
        'Stop if RealGM shows CAPTCHA, Cloudflare challenge, account wall, or terms uncertainty.',
        'Stop if the batch would exceed 5 scenarios or requires bypassing site protections.',
        'Record screenshot_path and page_text_path before marking a label as realgm.',
      ],
    })),
  };
}

export function scoreTradeEvalAnswer(
  prompt: TradeEvalPrompt,
  label: TradeEvalLabel,
  answerText: string,
): TradeEvalAnswerScore {
  const text = normalizeText(answerText);
  const legality = scoreLegality(label.expected_legality, text);
  const ruleDiagnosis = scoreRequiredTerms(prompt.expected.must_mention, text);
  const sourceBehavior = scoreSourceBehavior(prompt.expected.expected_source_behavior, text);
  const uncertaintyDiscipline = scoreUncertainty(prompt.expected.allowed_uncertainty, label.expected_legality, text);
  const repairQuality = prompt.prompt_type === 'repair'
    ? scoreRequiredTerms(prompt.expected.repair_hints, text)
    : 1;
  const operatorUsefulness = prompt.prompt_type === 'decision_support'
    ? scoreOperatorUsefulness(text)
    : 1;
  const hasForbiddenClaim = prompt.expected.must_not_claim.some((claim) => text.includes(normalizeText(claim)));
  const forbiddenClaimPenalty = hasForbiddenClaim ? 0 : 1;
  const subscores = {
    legality,
    rule_diagnosis: ruleDiagnosis,
    repair_quality: repairQuality,
    source_behavior: sourceBehavior,
    operator_usefulness: operatorUsefulness,
    uncertainty_discipline: Math.min(uncertaintyDiscipline, forbiddenClaimPenalty),
  };
  const totalScore = roundScore(Object.values(subscores).reduce((sum, score) => sum + score, 0) / 6);
  const failureModes = failureModesFor(prompt, label, subscores, text);
  return {
    prompt_id: prompt.id,
    scenario_id: prompt.scenario_id,
    prompt_type: prompt.prompt_type,
    status: scoreStatus(totalScore, subscores, hasForbiddenClaim),
    total_score: totalScore,
    subscores,
    failure_modes: failureModes,
  };
}

export function buildTradeEvalReport(args: {
  scenarios: TradeEvalScenario[];
  prompts: TradeEvalPrompt[];
  scores: TradeEvalAnswerScore[];
  generatedAt?: string;
}): TradeEvalReport {
  const scenarioById = new Map(args.scenarios.map((scenario) => [scenario.id, scenario]));
  const byRuleFamily: TradeEvalReport['by_rule_family'] = {};
  for (const score of args.scores) {
    const scenario = scenarioById.get(score.scenario_id);
    if (!scenario) continue;
    for (const tag of scenario.rule_tags) {
      const bucket = byRuleFamily[tag] ?? {
        prompt_count: 0,
        average_score: 0,
        failure_modes: [],
      };
      bucket.prompt_count += 1;
      bucket.average_score += score.total_score;
      bucket.failure_modes.push(...score.failure_modes);
      byRuleFamily[tag] = bucket;
    }
  }
  for (const [tag, bucket] of Object.entries(byRuleFamily)) {
    byRuleFamily[tag] = {
      prompt_count: bucket.prompt_count,
      average_score: roundScore(bucket.prompt_count === 0 ? 0 : bucket.average_score / bucket.prompt_count),
      failure_modes: [...new Set(bucket.failure_modes)].sort(),
    };
  }
  return {
    corpus_id: TRADE_EVAL_CORPUS_ID,
    generated_at: args.generatedAt ?? DEFAULT_TRADE_EVAL_GENERATED_AT,
    prompt_count: args.prompts.length,
    pass_count: args.scores.filter((score) => score.status === 'pass').length,
    warning_count: args.scores.filter((score) => score.status === 'warning').length,
    fail_count: args.scores.filter((score) => score.status === 'fail').length,
    scores: args.scores,
    by_rule_family: byRuleFamily,
  };
}

export function scoreTradeEvalAnswers(args: {
  prompts: TradeEvalPrompt[];
  labels: TradeEvalLabel[];
  answers: TradeEvalAnswerInput[];
}): TradeEvalAnswerScore[] {
  const promptsById = new Map(args.prompts.map((prompt) => [prompt.id, prompt]));
  const labelsByScenario = new Map(args.labels.map((label) => [label.scenario_id, label]));
  return args.answers.map((answer) => {
    const prompt = promptsById.get(answer.prompt_id);
    if (!prompt) throw new Error(`answer references unknown prompt_id ${answer.prompt_id}`);
    const label = labelsByScenario.get(prompt.scenario_id);
    if (!label) throw new Error(`prompt ${prompt.id} has no label for scenario ${prompt.scenario_id}`);
    return scoreTradeEvalAnswer(prompt, label, answer.answer);
  });
}

export function renderTradeEvalReportMarkdown(report: TradeEvalReport): string {
  const failingScores = report.scores.filter((score) => score.status !== 'pass');
  const lines = [
    '# NBA Trade Eval Report',
    '',
    `Corpus: ${report.corpus_id}`,
    `Generated: ${report.generated_at}`,
    `Prompts scored: ${report.prompt_count}`,
    `Result: ${report.pass_count} pass / ${report.warning_count} warning / ${report.fail_count} fail`,
    '',
    '## Rule Families',
    '',
    '| Rule family | Prompts | Average score | Failure modes |',
    '| --- | ---: | ---: | --- |',
    ...Object.entries(report.by_rule_family)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([tag, bucket]) => `| ${tag} | ${bucket.prompt_count} | ${bucket.average_score.toFixed(3)} | ${bucket.failure_modes.join(', ') || 'none'} |`),
    '',
    '## Failing Prompts',
    '',
    ...(failingScores.length === 0
      ? ['none']
      : failingScores.map((score) => `- ${score.status.toUpperCase()} ${score.prompt_id}: ${score.failure_modes.join(', ') || 'no failure mode recorded'} (${score.total_score.toFixed(3)})`)),
  ];
  return `${lines.join('\n')}\n`;
}

export async function writeTradeEvalArtifacts(
  artifacts: TradeEvalArtifacts,
  outDir = DEFAULT_TRADE_EVAL_OUT_DIR,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeJson(join(outDir, 'scenarios.v0.json'), artifacts.scenarios),
    writeJson(join(outDir, 'prompts.v0.json'), artifacts.prompts),
    writeJson(join(outDir, 'labels.v0.json'), artifacts.labels),
    writeJson(join(outDir, 'realgm-labeling-queue.v0.json'), artifacts.labelingQueue),
  ]);
}

function buildFixtureMeta(
  seed: NbaCapSheetSeed,
  args: { generatedAt: string; subjectTeamId: string; scenarioCount: number },
): TradeEvalScenarioFixture['meta'] {
  return {
    schema_version: TRADE_EVAL_SCHEMA_VERSION,
    corpus_id: TRADE_EVAL_CORPUS_ID,
    generated_at: args.generatedAt,
    scenario_count: args.scenarioCount,
    source_data_version: sourceDataVersion(seed),
    generation_policy: {
      subject_team_id: args.subjectTeamId,
      realgm_policy: 'Small-batch manual/computer-use queue only; no CAPTCHA bypass, no scaled scraping, cache labels as evidence.',
      notes: [
        'V0 uses public/demo NBA cap-sheet seed data only.',
        'RealGM labels remain manual_pending until screenshot and page-text evidence are imported.',
        'Expected labels are heuristic unless label_confidence is realgm or human_reviewed.',
      ],
    },
  };
}

function buildGenerationContext(seed: NbaCapSheetSeed, subjectTeamId: string): GenerationContext {
  const sheetsByTeam = new Map(seed.cap_sheets.map((sheet) => [sheet.team_id, sheet]));
  if (!sheetsByTeam.has(subjectTeamId)) throw new Error(`subject team ${subjectTeamId} is missing from NBA cap sheet seed`);
  return {
    seed,
    subjectTeamId,
    sourceDataVersion: sourceDataVersion(seed),
    sheetsByTeam,
  };
}

function sourceDataVersion(seed: NbaCapSheetSeed): TradeEvalSourceDataVersion {
  return {
    season: seed.season,
    as_of_date: seed.as_of_date,
    source_name: seed.source_name,
    source_url: seed.source_url,
    retrieved_at: seed.retrieved_at,
  };
}

function buildScenarioDefinitions(context: GenerationContext): ScenarioDefinition[] {
  return [
    ...cleanControlDefinitions(context),
    ...salaryMatchingDefinitions(context),
    ...secondApronDefinitions(context),
    ...hardCapSignAndTradeDefinitions(context),
    ...tradeExceptionDefinitions(context),
    ...multiTeamDefinitions(context),
    ...sourceNeededDefinitions(context),
  ];
}

function cleanControlDefinitions(context: GenerationContext): ScenarioDefinition[] {
  const teams = [
    ['MIL', 5], ['OKC', 6], ['CHA', 7], ['POR', 7],
    ['SAS', 7], ['CHI', 5], ['ATL', 5], ['MEM', 4],
  ] as const;
  return teams.map(([teamId, incomingRank], index) => twoTeamDefinition(context, {
    slug: `clean-${teamId.toLowerCase()}`,
    title: `Clean control salary swap with ${teamId}`,
    summary: `GSW sends one mid-salary player to ${teamId} for a lower-salary rotation player.`,
    counterpartyTeamId: teamId,
    gswSends: [cleanControlPlayerSpec(context.subjectTeamId, index % 2 === 0 ? 3 : 4)],
    gswReceives: [playerSpec(teamId, incomingRank)],
    ruleTags: ['clean_control', 'salary_matching'],
    intendedEdge: 'Control case where salary direction should not create an obvious CBA failure.',
    expectedLegality: 'legal',
    expectedFailureReasons: [],
    expectedRepairHints: ['confirm current salary rows', 'run final trade builder check'],
  }));
}

function salaryMatchingDefinitions(context: GenerationContext): ScenarioDefinition[] {
  const illegalCases = [
    ['LAL', 6], ['ORL', 5], ['POR', 6], ['OKC', 6], ['MIL', 4],
  ] as const;
  const legalCases = [
    ['SAC', 2], ['MIL', 2], ['BOS', 3], ['OKC', 1], ['HOU', 2],
  ] as const;
  return [
    ...illegalCases.map(([teamId, incomingRank]) => twoTeamDefinition(context, {
      slug: `salary-mismatch-${teamId.toLowerCase()}`,
      title: `Salary-matching stress test with ${teamId}`,
      summary: `GSW sends a small salary to ${teamId} for a materially larger incoming salary.`,
      counterpartyTeamId: teamId,
      gswSends: [playerSpec(context.subjectTeamId, 6)],
      gswReceives: [playerSpec(teamId, incomingRank)],
      ruleTags: ['salary_matching'],
      intendedEdge: 'Incoming salary should exceed a normal matching band for the outgoing package.',
      expectedLegality: 'illegal',
      expectedFailureReasons: ['salary matching'],
      expectedRepairHints: ['add outgoing salary', 'reduce incoming salary', 'route salary through another team'],
    })),
    ...legalCases.map(([teamId, incomingRank]) => twoTeamDefinition(context, {
      slug: `salary-close-${teamId.toLowerCase()}`,
      title: `Near-band salary match with ${teamId}`,
      summary: `GSW sends a large veteran salary to ${teamId} for a similar or lower incoming salary.`,
      counterpartyTeamId: teamId,
      gswSends: [playerSpec(context.subjectTeamId, 2)],
      gswReceives: [playerSpec(teamId, incomingRank)],
      ruleTags: ['salary_matching'],
      intendedEdge: 'Near-boundary case that should be evaluated by matching math, not vibes.',
      expectedLegality: 'legal',
      expectedFailureReasons: [],
      expectedRepairHints: ['confirm matching band', 'confirm current team salary and apron status'],
    })),
  ];
}

function secondApronDefinitions(context: GenerationContext): ScenarioDefinition[] {
  const teams = [
    ['BOS', 2], ['CLE', 2], ['HOU', 2], ['LAL', 2],
    ['ORL', 3], ['OKC', 1], ['WAS', 2], ['DEN', 2],
  ] as const;
  return teams.map(([teamId, incomingRank]) => twoTeamDefinition(context, {
    slug: `second-apron-${teamId.toLowerCase()}`,
    title: `Second-apron aggregation check with ${teamId}`,
    summary: `GSW aggregates multiple outgoing salaries for a higher-salary incoming player from ${teamId}.`,
    counterpartyTeamId: teamId,
    gswSends: [playerSpec(context.subjectTeamId, 3), playerSpec(context.subjectTeamId, 4), playerSpec(context.subjectTeamId, 6)],
    gswReceives: [playerSpec(teamId, incomingRank)],
    ruleTags: ['second_apron', 'salary_matching'],
    intendedEdge: 'Tests whether the answer catches aggregation and second-apron runway instead of only comparing total salary.',
    expectedLegality: 'illegal',
    expectedFailureReasons: ['second apron', 'aggregation'],
    expectedRepairHints: ['avoid aggregation', 'send one larger salary', 'reduce incoming salary below second-apron runway'],
  }));
}

function hardCapSignAndTradeDefinitions(context: GenerationContext): ScenarioDefinition[] {
  const teams = [
    ['SAC', 5], ['MIL', 5], ['CHA', 5], ['ATL', 4],
    ['NOP', 5], ['POR', 5], ['SAS', 5], ['PHI', 3],
  ] as const;
  return teams.map(([teamId, incomingRank]) => twoTeamDefinition(context, {
    slug: `sign-trade-hard-cap-${teamId.toLowerCase()}`,
    title: `Sign-and-trade hard-cap check with ${teamId}`,
    summary: `GSW receives a player via sign-and-trade mechanics from ${teamId}.`,
    counterpartyTeamId: teamId,
    gswSends: [playerSpec(context.subjectTeamId, 3)],
    gswReceives: [
      { ...playerSpec(teamId, incomingRank), notes: 'Modeled as incoming sign-and-trade player.' },
      {
        kind: 'sign_and_trade_rights',
        teamId,
        direction: 'incoming',
        label: `${teamId} sign-and-trade rights`,
        salaryAmount: null,
        salarySourceStatus: 'not-applicable',
        notes: 'Mechanism marker for hard-cap eval; not a salary asset.',
      },
    ],
    ruleTags: ['hard_cap', 'sign_and_trade'],
    intendedEdge: 'Tests whether the answer catches sign-and-trade hard-cap effects for a team already near/over apron lines.',
    expectedLegality: 'illegal',
    expectedFailureReasons: ['hard cap', 'sign-and-trade'],
    expectedRepairHints: ['avoid sign-and-trade', 'use ordinary trade mechanics', 'create apron room before receiving sign-and-trade player'],
  }));
}

function tradeExceptionDefinitions(context: GenerationContext): ScenarioDefinition[] {
  const teams = [
    ['BOS', 5], ['CLE', 5], ['LAL', 7], ['MEM', 3],
    ['PHX', 4], ['UTA', 5], ['WAS', 5], ['CHI', 4],
  ] as const;
  return teams.map(([teamId, incomingRank]) => twoTeamDefinition(context, {
    slug: `trade-exception-${teamId.toLowerCase()}`,
    title: `Trade-exception source check with ${teamId}`,
    summary: `GSW tries to absorb a ${teamId} salary into a hypothetical trade exception.`,
    counterpartyTeamId: teamId,
    gswSends: [{
      kind: 'exception',
      teamId: context.subjectTeamId,
      direction: 'outgoing',
      label: 'Hypothetical GSW traded-player exception slot',
      salaryAmount: null,
      salarySourceStatus: 'source-needed',
      notes: 'Exception amount must come from a current exception ledger before this can be labeled.',
    }],
    gswReceives: [playerSpec(teamId, incomingRank)],
    ruleTags: ['trade_exception', 'source_needed'],
    intendedEdge: 'Forces the answer to ask for the current exception amount rather than assuming the TPE exists and is large enough.',
    expectedLegality: 'uncertain',
    expectedFailureReasons: ['trade exception source needed'],
    expectedRepairHints: ['verify current TPE amount', 'compare player salary to exception room', 'use cap-sheet exception ledger'],
  }));
}

function multiTeamDefinitions(context: GenerationContext): ScenarioDefinition[] {
  const triples = [
    ['BOS', 'UTA'], ['CLE', 'MEM'], ['HOU', 'POR'],
    ['LAL', 'ATL'], ['SAC', 'WAS'], ['ORL', 'CHI'],
  ] as const;
  return triples.map(([teamA, teamB], index): ScenarioDefinition => {
    const gswOutgoing = playerSpec(context.subjectTeamId, index % 2 === 0 ? 3 : 4);
    const teamAOutgoing = playerSpec(teamA, 4);
    const teamBOutgoing = playerSpec(teamB, 3);
    return {
      slug: `multi-team-${teamA.toLowerCase()}-${teamB.toLowerCase()}`,
      title: `Three-team routing check with ${teamA} and ${teamB}`,
      summary: `GSW sends salary to ${teamA}, ${teamA} routes salary to ${teamB}, and GSW receives salary from ${teamB}.`,
      teams: [context.subjectTeamId, teamA, teamB],
      ruleTags: ['multi_team', 'salary_matching'],
      intendedEdge: 'Tests whether the answer keeps team-specific salary flows separate instead of netting the whole trade globally.',
      expectedLegality: 'uncertain',
      expectedFailureReasons: ['multi-team matching needs team-by-team validation'],
      expectedRepairHints: ['validate each team leg separately', 'run Trade Checker/internal solver', 'identify which team fails matching'],
      legs: [
        {
          teamId: context.subjectTeamId,
          sends: [gswOutgoing],
          receives: [teamBOutgoing],
        },
        {
          teamId: teamA,
          sends: [teamAOutgoing],
          receives: [reverseDirection(gswOutgoing, 'incoming')],
        },
        {
          teamId: teamB,
          sends: [teamBOutgoing],
          receives: [teamAOutgoing],
        },
      ],
    };
  });
}

function sourceNeededDefinitions(context: GenerationContext): ScenarioDefinition[] {
  return [
    ['DET', 0],
    ['MIA', 0],
  ].map(([teamId, sourceNeededRank]) => twoTeamDefinition(context, {
    slug: `source-needed-${String(teamId).toLowerCase()}`,
    title: `Source-needed salary gate with ${teamId}`,
    summary: `GSW evaluates an incoming ${teamId} player whose public salary row is missing in the seed.`,
    counterpartyTeamId: String(teamId),
    gswSends: [playerSpec(context.subjectTeamId, 4)],
    gswReceives: [sourceNeededPlayerSpec(String(teamId), Number(sourceNeededRank))],
    ruleTags: ['source_needed', 'salary_matching'],
    intendedEdge: 'Explicit source-needed case: Gambit should not answer legality confidently without a salary row.',
    expectedLegality: 'source_needed',
    expectedFailureReasons: ['source-needed salary'],
    expectedRepairHints: ['fetch current salary source', 'manual cap-sheet review', 'rerun after salary row is captured'],
  }));
}

function twoTeamDefinition(
  context: GenerationContext,
  args: {
    slug: string;
    title: string;
    summary: string;
    counterpartyTeamId: string;
    gswSends: AssetSpec[];
    gswReceives: AssetSpec[];
    ruleTags: TradeEvalRuleTag[];
    intendedEdge: string;
    expectedLegality: TradeEvalLegality;
    expectedFailureReasons: string[];
    expectedRepairHints: string[];
  },
): ScenarioDefinition {
  return {
    slug: args.slug,
    title: args.title,
    summary: args.summary,
    teams: [context.subjectTeamId, args.counterpartyTeamId],
    ruleTags: args.ruleTags,
    intendedEdge: args.intendedEdge,
    expectedLegality: args.expectedLegality,
    expectedFailureReasons: args.expectedFailureReasons,
    expectedRepairHints: args.expectedRepairHints,
    legs: [
      {
        teamId: context.subjectTeamId,
        sends: args.gswSends,
        receives: args.gswReceives,
      },
      {
        teamId: args.counterpartyTeamId,
        sends: args.gswReceives.map((asset) => reverseDirection(asset, 'outgoing')),
        receives: args.gswSends.map((asset) => reverseDirection(asset, 'incoming')),
      },
    ],
  };
}

function scenarioFromDefinition(
  context: GenerationContext,
  definition: ScenarioDefinition,
  index: number,
): TradeEvalScenario {
  const construction = definition.legs.map((leg): TradeEvalTeamLeg => ({
    team_id: leg.teamId,
    sends: leg.sends.map((asset) => resolveAsset(context, asset, 'outgoing')),
    receives: leg.receives.map((asset) => resolveAsset(context, asset, 'incoming')),
  }));
  const salaryTotals = construction.map((leg) => salaryTotalForLeg(context, leg));
  const knownSalaryGapCount = construction.flatMap((leg) => [...leg.sends, ...leg.receives])
    .filter((asset) => asset.kind === 'player' && asset.salary_amount == null).length;
  return {
    id: `trade_eval_v0_${String(index).padStart(3, '0')}_${definition.slug}`,
    title: definition.title,
    summary: definition.summary,
    snapshot_date: context.seed.as_of_date,
    season: context.seed.season,
    subject_team_id: context.subjectTeamId,
    teams: definition.teams,
    construction,
    salary_totals: salaryTotals,
    known_salary_gap_count: knownSalaryGapCount,
    rule_tags: definition.ruleTags,
    intended_edge: definition.intendedEdge,
    source_data_version: context.sourceDataVersion,
    oracle: {
      expected_legality: definition.expectedLegality,
      expected_failure_reasons: definition.expectedFailureReasons,
      expected_repair_hints: definition.expectedRepairHints,
      gold_label_confidence: definition.expectedLegality === 'source_needed' ? 'source_gap' : 'heuristic',
      label_status: definition.expectedLegality === 'source_needed' ? 'source_needed' : 'manual_pending',
      evidence_paths: [],
    },
  };
}

function playerSpec(teamId: string, rank: number): AssetSpec {
  return {
    kind: 'player',
    teamId,
    direction: 'outgoing',
    rank,
  };
}

function cleanControlPlayerSpec(teamId: string, rank: number): AssetSpec {
  return {
    ...playerSpec(teamId, rank),
    excludedPlayerNames: REALGM_CURRENT_TRADE_RESTRICTED_PLAYER_NAMES,
  };
}

function sourceNeededPlayerSpec(teamId: string, rank: number): AssetSpec {
  return {
    kind: 'player',
    teamId,
    direction: 'incoming',
    sourceNeededRank: rank,
  };
}

function reverseDirection(asset: AssetSpec, direction: TradeEvalAsset['direction']): AssetSpec {
  return { ...asset, direction };
}

function resolveAsset(
  context: GenerationContext,
  spec: AssetSpec,
  direction: TradeEvalAsset['direction'],
): TradeEvalAsset {
  if (spec.kind !== 'player') {
    return {
      kind: spec.kind,
      team_id: spec.teamId,
      direction,
      salary_amount: spec.salaryAmount ?? null,
      salary_source_status: spec.salarySourceStatus ?? 'not-applicable',
      label: spec.label ?? spec.kind,
      notes: spec.notes,
    };
  }
  const row = spec.sourceNeededRank == null
    ? capturedPlayerAt(context, spec.teamId, spec.rank ?? 0, spec.excludedPlayerNames ?? [])
    : sourceNeededPlayerAt(context, spec.teamId, spec.sourceNeededRank);
  const salary = currentSalary(row, context.seed.season);
  return {
    kind: 'player',
    team_id: spec.teamId,
    direction,
    player_name: row.player_name,
    nba_player_id: row.nba_player_id,
    salary_amount: salary.amount,
    salary_source_status: salary.sourceStatus,
    label: spec.label ?? row.player_name,
    notes: spec.notes,
  };
}

function capturedPlayerAt(
  context: GenerationContext,
  teamId: string,
  rank: number,
  excludedPlayerNames: readonly string[] = [],
): NbaCapSheetPlayerRow {
  const sheet = requiredSheet(context, teamId);
  const excludedNames = new Set(excludedPlayerNames.map(normalizePlayerName));
  const rows = sheet.player_rows
    .filter((row) => currentSalary(row, context.seed.season).amount != null)
    .filter((row) => !excludedNames.has(normalizePlayerName(row.player_name)))
    .sort((a, b) => currentSalary(b, context.seed.season).amount! - currentSalary(a, context.seed.season).amount! || a.player_name.localeCompare(b.player_name));
  const row = rows[rank];
  if (!row) throw new Error(`team ${teamId} has no captured salary player at rank ${rank}`);
  return row;
}

function normalizePlayerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sourceNeededPlayerAt(context: GenerationContext, teamId: string, rank: number): NbaCapSheetPlayerRow {
  const sheet = requiredSheet(context, teamId);
  const rows = sheet.player_rows
    .filter((row) => currentSalary(row, context.seed.season).amount == null)
    .sort((a, b) => a.source_order - b.source_order || a.player_name.localeCompare(b.player_name));
  const row = rows[rank];
  if (!row) throw new Error(`team ${teamId} has no source-needed salary player at rank ${rank}`);
  return row;
}

function currentSalary(row: NbaCapSheetPlayerRow, season: string): {
  amount: number | null;
  sourceStatus: TradeEvalAsset['salary_source_status'];
} {
  const cell = row.salary_cells.find((salaryCell) => salaryCell.season === season);
  return {
    amount: cell?.amount ?? null,
    sourceStatus: cell?.source_status ?? 'source-needed',
  };
}

function salaryTotalForLeg(context: GenerationContext, leg: TradeEvalTeamLeg): TradeEvalTeamSalaryTotal {
  const sheet = requiredSheet(context, leg.team_id);
  const knownSalaryOut = sumKnownSalary(leg.sends);
  const knownSalaryIn = sumKnownSalary(leg.receives);
  const payrollBefore = sheet.payroll_amount;
  const payrollAfter = payrollBefore == null ? null : payrollBefore + knownSalaryIn - knownSalaryOut;
  const secondApron = metricAmount(sheet, 'second_apron') ?? SECOND_APRON_FALLBACK;
  return {
    team_id: leg.team_id,
    known_salary_out: knownSalaryOut,
    known_salary_in: knownSalaryIn,
    net_salary_delta: knownSalaryIn - knownSalaryOut,
    payroll_before: payrollBefore,
    payroll_after: payrollAfter,
    second_apron: secondApron,
    second_apron_before_distance: payrollBefore == null ? null : secondApron - payrollBefore,
    second_apron_after_distance: payrollAfter == null ? null : secondApron - payrollAfter,
  };
}

function requiredSheet(context: GenerationContext, teamId: string): NbaCapSheetSeedTeam {
  const sheet = context.sheetsByTeam.get(teamId);
  if (!sheet) throw new Error(`NBA cap sheet seed is missing ${teamId}`);
  return sheet;
}

function metricAmount(sheet: NbaCapSheetSeedTeam, key: string): number | null {
  return sheet.metrics.find((metric) => metric.key === key)?.amount ?? null;
}

function sumKnownSalary(assets: TradeEvalAsset[]): number {
  return assets.reduce((sum, asset) => sum + (asset.kind === 'player' ? asset.salary_amount ?? 0 : 0), 0);
}

function buildPrompt(scenario: TradeEvalScenario, promptType: TradeEvalPromptType): TradeEvalPrompt {
  const tradeSummary = describeTrade(scenario);
  const salarySummary = describeSalaryTotals(scenario);
  return {
    id: `${scenario.id}_${promptType}`,
    scenario_id: scenario.id,
    prompt_type: promptType,
    prompt: promptText(promptType, scenario, tradeSummary, salarySummary),
    expected: {
      expected_legality: scenario.oracle.expected_legality,
      must_mention: mustMentionTerms(scenario),
      must_not_claim: mustNotClaimTerms(scenario),
      expected_source_behavior: sourceBehaviorFor(scenario),
      allowed_uncertainty: allowedUncertaintyFor(scenario),
      repair_hints: scenario.oracle.expected_repair_hints,
    },
  };
}

function promptText(
  promptType: TradeEvalPromptType,
  scenario: TradeEvalScenario,
  tradeSummary: string,
  salarySummary: string,
): string {
  const base = `Scenario ${scenario.id}: ${tradeSummary} ${salarySummary}`;
  switch (promptType) {
    case 'legality':
      return `${base} Is this trade legal under the current NBA CBA? Give the controlling constraint.`;
    case 'diagnosis':
      return `${base} If this trade fails, diagnose the exact cap/CBA reason. If it passes, explain why the obvious failure concern is controlled.`;
    case 'repair':
      return `${base} What is the smallest practical change that would make this construction legal or labelable?`;
    case 'decision_support':
      return `${base} Write a Warriors front-office decision brief: pursue, modify, or reject, and name the next check owner.`;
  }
}

function describeTrade(scenario: TradeEvalScenario): string {
  return scenario.construction.map((leg) => {
    const sends = leg.sends.map(assetLabel).join(', ') || 'nothing';
    const receives = leg.receives.map(assetLabel).join(', ') || 'nothing';
    return `${leg.team_id} sends ${sends} and receives ${receives}`;
  }).join('; ');
}

function describeSalaryTotals(scenario: TradeEvalScenario): string {
  return scenario.salary_totals.map((total) => (
    `${total.team_id} salary out ${money(total.known_salary_out)}, in ${money(total.known_salary_in)}, delta ${money(total.net_salary_delta)}`
  )).join('; ');
}

function assetLabel(asset: TradeEvalAsset): string {
  if (asset.kind === 'player') return `${asset.player_name ?? asset.label} (${money(asset.salary_amount)})`;
  return asset.label;
}

function mustMentionTerms(scenario: TradeEvalScenario): string[] {
  const terms = new Set<string>();
  for (const tag of scenario.rule_tags) {
    for (const term of termsForRuleTag(tag)) terms.add(term);
  }
  for (const reason of scenario.oracle.expected_failure_reasons) terms.add(reason);
  return [...terms].filter(Boolean);
}

function termsForRuleTag(tag: TradeEvalRuleTag): string[] {
  switch (tag) {
    case 'salary_matching':
      return ['salary matching'];
    case 'second_apron':
      return ['second apron'];
    case 'hard_cap':
      return ['hard cap'];
    case 'sign_and_trade':
      return ['sign-and-trade'];
    case 'trade_exception':
      return ['trade exception'];
    case 'multi_team':
      return ['multi-team'];
    case 'clean_control':
      return ['current salary'];
    case 'source_needed':
      return ['source-needed'];
  }
}

function mustNotClaimTerms(scenario: TradeEvalScenario): string[] {
  switch (scenario.oracle.expected_legality) {
    case 'illegal':
      return ['definitely legal', 'no cba issue', 'cleanly passes'];
    case 'source_needed':
      return ['legal without checking salary', 'definitely legal'];
    case 'uncertain':
      return ['definitely legal', 'definitely illegal'];
    case 'legal':
      return ['definitely illegal'];
  }
}

function sourceBehaviorFor(scenario: TradeEvalScenario): TradeEvalSourceBehavior {
  if (scenario.oracle.expected_legality === 'source_needed') return 'refuse_without_source';
  if (scenario.rule_tags.includes('trade_exception') || scenario.rule_tags.includes('multi_team')) return 'state_uncertainty';
  return 'cite_current_cap_cba';
}

function allowedUncertaintyFor(scenario: TradeEvalScenario): string[] {
  if (scenario.oracle.expected_legality === 'source_needed') {
    return ['salary row is missing', 'source needed', 'cannot verify without current cap sheet'];
  }
  if (scenario.oracle.expected_legality === 'uncertain') {
    return ['needs trade checker', 'needs internal solver', 'requires team-by-team validation'];
  }
  return ['pending final RealGM/internal solver confirmation'];
}

function scoreLegality(expected: TradeEvalLegality, text: string): number {
  const illegal = /\b(illegal|invalid|fails)\b|\bnot (legal|valid|permitted|allowed)\b|\bdoes(?: not|nt|n t) (pass|work|fit|satisfy)\b|\b(can t|cannot) (be completed|be traded|aggregate|absorb|receive|take back|fit|work|pass|satisfy)\b/.test(text);
  const legal = /\b(legal|valid|passes|permitted|allowed)\b/.test(text) && !illegal;
  const uncertain = /\b(uncertain|cannot verify|needs|requires|pending|source needed|manual|trade checker|solver)\b/.test(text);
  switch (expected) {
    case 'legal':
      return legal ? 1 : 0;
    case 'illegal':
      return illegal ? 1 : 0;
    case 'uncertain':
      return uncertain ? 1 : 0;
    case 'source_needed':
      return /source needed|missing salary|cannot verify|need current salary/.test(text) ? 1 : 0;
  }
}

function scoreStatus(
  totalScore: number,
  subscores: TradeEvalAnswerScore['subscores'],
  hasForbiddenClaim: boolean,
): TradeEvalAnswerScore['status'] {
  if (hasForbiddenClaim) return 'fail';
  if (subscores.legality < 1) return 'fail';
  return totalScore >= 0.82 ? 'pass' : totalScore >= 0.62 ? 'warning' : 'fail';
}

function scoreRequiredTerms(terms: string[], text: string): number {
  if (terms.length === 0) return 1;
  const hits = terms.filter((term) => text.includes(normalizeText(term))).length;
  return roundScore(hits / terms.length);
}

function scoreSourceBehavior(expected: TradeEvalSourceBehavior, text: string): number {
  switch (expected) {
    case 'cite_current_cap_cba':
      return /\b(cba|article|section|cap sheet|salary|apron|source|realgm|trade checker|solver)\b/.test(text) ? 1 : 0;
    case 'refuse_without_source':
      return /\b(source needed|missing|cannot verify|need current|manual cap|salary row)\b/.test(text) ? 1 : 0;
    case 'realgm_or_internal_oracle':
      return /\b(realgm|trade checker|internal solver|oracle)\b/.test(text) ? 1 : 0;
    case 'state_uncertainty':
      return /\b(uncertain|needs|requires|pending|team by team|trade checker|solver)\b/.test(text) ? 1 : 0;
  }
}

function scoreUncertainty(allowed: string[], expected: TradeEvalLegality, text: string): number {
  if (expected === 'legal' || expected === 'illegal') {
    return /\b(definitely|guaranteed|no need to check)\b/.test(text) ? 0 : 1;
  }
  return allowed.some((phrase) => text.includes(normalizeText(phrase))) ? 1 : 0;
}

function scoreOperatorUsefulness(text: string): number {
  const terms = ['warriors', 'front office', 'next', 'check', 'risk', 'owner', 'call', 'cap'];
  return scoreRequiredTerms(terms, text);
}

function failureModesFor(
  prompt: TradeEvalPrompt,
  label: TradeEvalLabel,
  subscores: TradeEvalAnswerScore['subscores'],
  normalizedAnswerText: string,
): string[] {
  const failures: string[] = [];
  if (subscores.legality < 1) failures.push(`missed_${label.expected_legality}_legality`);
  if (subscores.rule_diagnosis < 0.8) failures.push('weak_rule_diagnosis');
  if (subscores.repair_quality < 0.8) failures.push('weak_repair');
  if (subscores.source_behavior < 1) failures.push('weak_source_behavior');
  if (subscores.operator_usefulness < 0.6) failures.push('weak_operator_usefulness');
  if (subscores.uncertainty_discipline < 1) failures.push('overconfident_or_unclear_uncertainty');
  if (prompt.expected.must_not_claim.some((claim) => normalizedAnswerText.includes(normalizeText(claim)))) failures.push('forbidden_claim');
  return failures;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function money(value: number | null | undefined): string {
  if (value == null) return 'source needed';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${roundScore(abs / 1_000_000)}M`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
