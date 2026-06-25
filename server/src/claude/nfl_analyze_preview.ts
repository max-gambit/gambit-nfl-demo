import type { BriefSource, NflCapRow, NflPlayerMetricRow, SubmitDataAnalysisInput } from '@shared/types';
import { handleDataAnalystToolUse, isSubmitDataAnalysisInput } from './data_analyst.js';

export const NFL_GIANTS_ANALYZE_ACCEPTANCE_QUESTION =
  'We are the Giants. Should we cut, restructure, extend, or tag a veteran contract to open cap room?';

export async function buildNflGiantsAnalyzePreview(
  question = NFL_GIANTS_ANALYZE_ACCEPTANCE_QUESTION,
): Promise<SubmitDataAnalysisInput> {
  const toolResult = await handleDataAnalystToolUse('query_nfl_data', {
    datasets: ['cap_sheets', 'rosters', 'player_metrics', 'context_graph', 'rules'],
    limit: 24,
  });
  if (!toolResult.ok) {
    throw new Error(`NFL Analyze preview evidence lookup failed: ${JSON.stringify(toolResult.errors)}`);
  }

  const capRows = ((toolResult.data.cap_sheets as { rows?: NflCapRow[] } | undefined)?.rows ?? []);
  const playerRows = capRows.filter((row) => row.player_id);
  const metrics = ((toolResult.data.player_metrics as { rows?: NflPlayerMetricRow[] } | undefined)?.rows ?? []);
  const ruleRows = ((toolResult.data.rules as { rows?: Array<{ rule_family: string; summary: string; source_url: string }> } | undefined)?.rows ?? []);
  const restructureRules = ruleRows.filter((row) => (
    row.rule_family === 'restructure_conversion' ||
    row.rule_family === 'post_june_1_accounting' ||
    row.rule_family === 'franchise_transition_tag' ||
    row.rule_family === 'extensions'
  ));
  const restructureCandidates = playerRows
    .slice()
    .sort((a, b) => (b.restructure_savings_estimate_2026 ?? 0) - (a.restructure_savings_estimate_2026 ?? 0));
  const bestRestructure = restructureCandidates[0] ?? null;
  const tagCandidate = playerRows.find((row) => row.tag_eligible_2027) ?? null;
  const totalRestructureRoom = sum(playerRows.map((row) => row.restructure_savings_estimate_2026));
  const totalCutSavings = sum(playerRows.map((row) => row.cut_savings_2026));

  const sources: Array<Omit<BriefSource, 'id' | 'brief_id'>> = [
    {
      ref_index: 1,
      kind: 'ANALYST_DATA',
      source: 'GAMBIT_APP_DATA',
      title: 'App data - NFL cap and contract rows - NYG',
      updated_at: toolResult.datasets.find((dataset) => dataset.dataset_id === 'nfl_cap_sheets_current')?.as_of_date ?? null,
      data: {
        dataset_id: 'nfl_cap_sheets_current',
        team_ids: ['NYG'],
        rows: playerRows.map((row) => ({
          player: row.player_name,
          cap_number_2026: row.cap_number_2026,
          cut_savings_2026: row.cut_savings_2026,
          restructure_savings_estimate_2026: row.restructure_savings_estimate_2026,
          tag_eligible_2027: row.tag_eligible_2027,
          source_url: row.source_url,
        })),
      },
    },
    {
      ref_index: 2,
      kind: 'ANALYST_DATA',
      source: 'GAMBIT_APP_DATA',
      title: 'App data - NFL player metrics - NYG',
      updated_at: toolResult.datasets.find((dataset) => dataset.dataset_id === 'nfl_player_metrics_current')?.as_of_date ?? null,
      data: {
        dataset_id: 'nfl_player_metrics_current',
        team_ids: ['NYG'],
        rows: metrics.map((row) => ({
          player: row.player_name,
          position: row.position,
          games_2025: row.games_2025,
          role: row.role,
          tier: row.value_tier,
        })),
      },
    },
    {
      ref_index: 3,
      kind: 'CBA',
      source: 'NFL CBA / public transaction-rule references',
      title: 'NFL rules - restructure, post-June 1, tag, and extension families',
      updated_at: toolResult.datasets.find((dataset) => dataset.dataset_id === 'nfl_rules_static')?.as_of_date ?? null,
      data: {
        dataset_id: 'nfl_rules_static',
        rules: restructureRules.map((row) => ({
          rule_family: row.rule_family,
          summary: row.summary,
          source_url: row.source_url,
        })),
      },
    },
  ];

  const payload: SubmitDataAnalysisInput = {
    answer: [
      'Use restructure/extension work as the first Giants cap-room lever, not a straight cut.',
      bestRestructure
        ? `${bestRestructure.player_name} is the clearest modeled restructure candidate in the static app data at ${formatCompactMoney(bestRestructure.restructure_savings_estimate_2026)} of estimated 2026 room.`
        : 'The static app data does not identify a modeled restructure candidate.',
      tagCandidate
        ? `${tagCandidate.player_name} is the only tagged-lever candidate in the loaded NYG cap rows, so tag analysis should stay player-specific rather than generic.`
        : 'The loaded NYG cap rows do not identify a 2027 tag-eligible veteran.',
    ].join(' '),
    key_findings: [
      {
        label: 'Restructure beats cut in the static model',
        body: `Modeled restructure room across NYG player rows is ${formatCompactMoney(totalRestructureRoom)}, versus ${formatCompactMoney(totalCutSavings)} of modeled cut savings. The biggest single restructure row is ${bestRestructure?.player_name ?? 'not available'}.`,
        source_refs: [1, 3],
      },
      {
        label: 'Cut path needs player-specific dead-money review',
        body: 'The leading veteran rows carry dead-money fields, so a cut recommendation should not be made from headline cap number alone.',
        source_refs: [1, 3],
      },
      {
        label: 'Tag and extension paths are separate rule families',
        body: 'The loaded NFL rules distinguish restructure conversion, post-June 1 accounting, franchise/transition tags, and extensions, so the final live answer should cite the applicable family for each path.',
        source_refs: [3],
      },
    ],
    tables: [
      {
        title: 'NYG cap levers from app data',
        columns: ['Player', 'Pos', '2026 cap', 'Cut savings', 'Restructure est.', 'Tag 2027', 'Lever'],
        rows: playerRows.map((row) => [
          row.player_name,
          row.position,
          moneyCell(row.cap_number_2026),
          moneyCell(row.cut_savings_2026),
          moneyCell(row.restructure_savings_estimate_2026),
          row.tag_eligible_2027 ? 'Yes' : 'No',
          labelize(row.contract_lever),
        ]),
        source_refs: [1],
      },
    ],
    calculations: [
      {
        label: 'Modeled restructure room',
        formula: 'sum(restructure_savings_estimate_2026) for NYG player rows',
        value: formatCompactMoney(totalRestructureRoom),
        source_refs: [1],
      },
      {
        label: 'Modeled cut savings',
        formula: 'sum(cut_savings_2026) for NYG player rows',
        value: formatCompactMoney(totalCutSavings),
        source_refs: [1],
      },
    ],
    sources,
    caveats: [
      'This is a deterministic local acceptance preview, not a live Anthropic model response.',
      'NFL demo data is a static checked-in snapshot, not a live cap feed.',
      'Rule rows are bounded summaries from the loaded demo corpus, not a full legal/CBA parser.',
      `Question under test: ${question}`,
    ],
    followups: [
      'Run the same question through live Analyze after ANTHROPIC_API_KEY is configured.',
      'Replace static estimates with reviewed club cap-sheet rows before external use.',
    ],
  };

  if (!isSubmitDataAnalysisInput(payload)) {
    throw new Error('NFL Analyze preview payload failed SubmitDataAnalysisInput guard');
  }
  return payload;
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => (
    typeof value === 'number' && Number.isFinite(value) ? total + value : total
  ), 0);
}

function moneyCell(value: number | null): string {
  return typeof value === 'number' ? `$${Math.round(value / 1_000_000)}M` : 'source needed';
}

function formatCompactMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'source needed';
  return `$${(value / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
}

function labelize(value: string): string {
  return value.replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

if (process.argv[1]?.endsWith('nfl_analyze_preview.ts')) {
  buildNflGiantsAnalyzePreview()
    .then((payload) => {
      process.stdout.write(JSON.stringify(payload, null, 2));
      process.stdout.write('\n');
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
