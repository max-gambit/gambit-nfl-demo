import test from 'node:test';
import assert from 'node:assert/strict';
import { inferBriefModeFromQuestion, stripBriefModePrefix } from '@shared/briefMode';
import { inferBriefTemplateFromQuestion } from '@shared/briefTemplates';
import { loadCbaCorpusSeed } from '../../src/cba/seed.js';
import type { CurrentPlayerStatViewRow } from '../../src/nba_player_stats/seed.js';
import {
  dataAnalysisCbaCitationSources,
  dataAnalystTools,
  dataAnalystTracesToBriefSources,
  dataAnalystTracesToToolCalls,
  handleDataAnalystToolUse,
  isSubmitDataAnalysisInput,
  recommendationBriefCbaCitationSources,
  resolveDataAnalystTeamIds,
  selectCbaArticlesForText,
  submitDataAnalysisTool,
  summarizePlayerStatsForAnalyst,
} from '../../src/claude/data_analyst.js';
import type { CbaArticle, DataAnalystTrace, SubmitBriefInput, SubmitDataAnalysisInput } from '@shared/types';

test('brief mode parsing honors explicit data command and conservative heuristics', () => {
  assert.deepEqual(stripBriefModePrefix('/data Which Wizards players have the weakest net rating?'), {
    mode: 'data_analyst',
    question: 'Which Wizards players have the weakest net rating?',
  });
  assert.equal(inferBriefModeFromQuestion('Which Wizards players have the highest usage?'), 'data_analyst');
  assert.equal(inferBriefModeFromQuestion('Rank the Wizards by true shooting'), 'data_analyst');
  assert.equal(inferBriefModeFromQuestion('Should Washington trade for a veteran guard?'), 'brief');
  assert.equal(
    inferBriefModeFromQuestion('We are the Giants. Should we cut, restructure, extend, or tag a veteran contract to open cap room?'),
    'data_analyst',
  );
  assert.equal(
    inferBriefModeFromQuestion('Audit the Giants offseason roster. Which position groups look over- or under-invested by 2026 cap number, and where is the data incomplete?'),
    'data_analyst',
  );
  assert.equal(
    inferBriefTemplateFromQuestion('Audit the Giants offseason roster. Which position groups look over- or under-invested by 2026 cap number, and where is the data incomplete?'),
    'data_table',
  );
  assert.equal(inferBriefModeFromQuestion('Should we trade for a veteran edge rusher?'), 'brief');
});

test('data analyst tool catalog exposes read-only app data tools and structured output', () => {
  assert.deepEqual(dataAnalystTools.map((tool) => tool.name), [
    'list_available_datasets',
    'query_nfl_data',
    'query_nba_data',
    'query_brief_workspace',
  ]);
  const nflSchema = dataAnalystTools.find((tool) => tool.name === 'query_nfl_data')?.input_schema as {
    properties?: { datasets?: { items?: { enum?: string[] } }; trade_goal?: unknown };
  };
  assert.ok(nflSchema.properties?.datasets?.items?.enum?.includes('rules'));
  assert.ok(nflSchema.properties?.datasets?.items?.enum?.includes('trade_screen'));
  assert.ok(nflSchema.properties?.datasets?.items?.enum?.includes('coverage'));
  assert.ok(nflSchema.properties?.trade_goal);
  const querySchema = dataAnalystTools.find((tool) => tool.name === 'query_nba_data')?.input_schema as {
    properties?: { datasets?: { items?: { enum?: string[] } }; trade_goal?: unknown };
  };
  assert.ok(querySchema.properties?.datasets?.items?.enum?.includes('cba_articles'));
  assert.equal(querySchema.properties?.trade_goal, undefined);

  assert.equal(submitDataAnalysisTool.name, 'submit_data_analysis');

  const schema = submitDataAnalysisTool.input_schema as {
    required?: string[];
    properties?: { sources?: { items?: { properties?: { kind?: { enum?: string[] } } } } };
  };
  assert.deepEqual(schema.required, [
    'answer',
    'key_findings',
    'tables',
    'calculations',
    'sources',
    'caveats',
    'followups',
  ]);
  assert.ok(schema.properties?.sources?.items?.properties?.kind?.enum?.includes('CBA'));
});

test('data analyst dataset catalog advertises NFL demo data instead of legacy NBA snapshots', async () => {
  const result = await handleDataAnalystToolUse('list_available_datasets', {});
  const datasetIds = result.datasets.map((dataset) => dataset.dataset_id);

  assert.equal(result.ok, true);
  assert.ok(datasetIds.includes('nfl_demo_static'));
  assert.ok(datasetIds.includes('nfl_rosters_current'));
  assert.ok(datasetIds.includes('nfl_cap_sheets_current'));
  assert.ok(datasetIds.includes('nfl_player_metrics_current'));
  assert.ok(datasetIds.includes('nfl_coverage_current'));
  assert.ok(datasetIds.includes('nfl_context_graph'));
  assert.ok(datasetIds.includes('nfl_rules_static'));
  assert.equal(datasetIds.some((datasetId) => datasetId.startsWith('nba_')), false);
});

test('data analyst NFL tool defaults omitted team scope to Giants and returns cap rules evidence', async () => {
  const result = await handleDataAnalystToolUse('query_nfl_data', {
    datasets: ['cap_sheets', 'rules'],
    player_names: ['Andrew Thomas'],
    limit: 8,
  });

  assert.equal(result.ok, true);
  assert.equal(result.datasets.some((dataset) => dataset.dataset_id === 'nfl_cap_sheets_current'), true);
  assert.equal(result.datasets.some((dataset) => dataset.dataset_id === 'nfl_rules_static'), true);
  assert.deepEqual(result.datasets.find((dataset) => dataset.dataset_id === 'nfl_cap_sheets_current')?.team_ids, ['NYG']);
  const capRows = (result.data.cap_sheets as {
    rows: Array<{
      player_name: string;
      restructure_savings_estimate_2026: number | null;
      post_june_1_cut_savings_2026: number | null;
      trade_savings_2026: number | null;
      contract_years_remaining: number | null;
      contract_ledger_confidence: string;
    }>;
  }).rows;
  assert.equal(capRows[0]?.player_name, 'Andrew Thomas');
  assert.equal(typeof capRows[0]?.restructure_savings_estimate_2026, 'number');
  assert.equal(typeof capRows[0]?.post_june_1_cut_savings_2026, 'number');
  assert.equal(typeof capRows[0]?.trade_savings_2026, 'number');
  assert.equal(typeof capRows[0]?.contract_years_remaining, 'number');
  assert.notEqual(capRows[0]?.contract_ledger_confidence, 'source-needed');
  const rules = (result.data.rules as { rows: Array<{ rule_family: string }> }).rows;
  assert.equal(rules.some((row) => row.rule_family === 'restructure_conversion'), true);
});

test('data analyst NFL tool supports Giants cut restructure tag prompt evidence shape', async () => {
  const result = await handleDataAnalystToolUse('query_nfl_data', {
    datasets: ['cap_sheets', 'rosters', 'player_metrics', 'coverage', 'context_graph', 'rules'],
    limit: 12,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.datasets.find((dataset) => dataset.dataset_id === 'nfl_cap_sheets_current')?.team_ids, ['NYG']);
  assert.equal(result.datasets.some((dataset) => dataset.dataset_id === 'nfl_coverage_current'), true);
  const coverage = result.data.coverage as {
    teams: Array<{ team_id: string; readiness: Array<{ key: string; status: string; gaps?: Array<{ public_ceiling?: boolean }> }> }>;
  };
  assert.equal(coverage.teams[0]?.team_id, 'NYG');
  assert.equal(coverage.teams[0]?.readiness.some((item) => item.key === 'player_quality' && item.status === 'strong'), true);
  const capRows = (result.data.cap_sheets as { rows: Array<{ player_name: string; restructure_savings_estimate_2026: number | null; tag_eligible_2027: boolean }> }).rows;
  assert.ok(capRows.some((row) => row.player_name === 'Andrew Thomas' && typeof row.restructure_savings_estimate_2026 === 'number'));
  assert.ok(capRows.some((row) => row.tag_eligible_2027));
  const rules = (result.data.rules as { rows: Array<{ rule_family: string; summary: string }> }).rows;
  assert.ok(rules.some((row) => row.rule_family === 'post_june_1_accounting'));
  assert.ok(rules.some((row) => row.rule_family === 'franchise_transition_tag'));
});

test('data analyst NFL trade screen returns construction guardrails and named target lanes', async () => {
  const result = await handleDataAnalystToolUse('query_nfl_data', {
    datasets: ['rosters', 'cap_sheets', 'trade_screen'],
    trade_goal: 'add interior pass-rush juice without creating a 2027 cap problem',
    limit: 20,
  });

  assert.equal(result.ok, true);
  assert.equal(result.datasets.some((dataset) => dataset.dataset_id === 'nfl_trade_screen_current'), true);
  assert.equal(result.datasets.some((dataset) => dataset.dataset_id === 'nfl_context_graph'), true);
  const screen = (result.data.trade_screen as {
    screens: Array<{
      subject_team_id: string;
      outgoing_hierarchy: string[];
      depth_after_trade: string[];
      named_target_lanes: string[];
      target_lanes: Array<{
        target_player_name: string;
        target_team_id: string;
        motivation_tier: string;
        recommended_action: string;
        seller_case: string;
        seller_objection: string;
        validation_trigger: string;
        motivation_confidence: string;
        reasons: string[];
        blockers: string[];
        seller_depth_consequence: string;
      }>;
      counterparty_intel_team_ids: string[];
      bad_cap_relief_trades: string[];
      answer_requirements: string[];
    }>;
  }).screens[0];
  assert.equal(screen.subject_team_id, 'NYG');
  assert.ok(screen.outgoing_hierarchy.some((line) => /Greg Newsome II/.test(line)));
  assert.ok(screen.outgoing_hierarchy.some((line) => /Jon Runyan/.test(line)));
  assert.ok(screen.depth_after_trade.some((line) => /(CB|S) after trade/.test(line)));
  assert.ok(screen.named_target_lanes.some((line) => /(Vita Vea|Grover Stewart|A'Shawn Robinson|Harrison Phillips|Tedarrell Slaton)/.test(line)));
  assert.ok(screen.named_target_lanes.some((line) => /recommended_action=/.test(line)));
  assert.equal(screen.named_target_lanes.some((line) => /motivation_tier=/.test(line)), false);
  assert.ok(screen.counterparty_intel_team_ids.includes('TB'));
  const vea = screen.target_lanes.find((lane) => lane.target_team_id === 'TB' && lane.target_player_name === 'Vita Vea');
  assert.ok(vea);
  assert.equal(vea.motivation_tier, 'long_shot_unless_posture_changes');
  assert.equal(vea.recommended_action, 'posture_change_only');
  assert.match(vea.seller_case, /high-impact, low-probability target/i);
  assert.match(vea.seller_objection, /Do not headline Vita Vea/i);
  assert.match(vea.validation_trigger, /Confirm whether Tampa/i);
  assert.ok(vea.blockers.some((blocker) => /contend|top-priced|top-of-room/i.test(blocker)));
  assert.ok(screen.bad_cap_relief_trades.some((line) => /Brian Burns.*bad 2026 cap-relief trade/.test(line)));
  assert.ok(screen.answer_requirements.some((line) => /salary-out construction/.test(line)));
});

test('data analyst NBA tool defaults omitted team scope to Warriors POV', () => {
  assert.deepEqual(resolveDataAnalystTeamIds(undefined), ['GSW']);
  assert.deepEqual(resolveDataAnalystTeamIds([]), ['GSW']);
  assert.deepEqual(resolveDataAnalystTeamIds(['ATL']), ['ATL']);
});

test('player-stat analyst summaries rank usage, weak net rating, and combined risk', () => {
  const rows: CurrentPlayerStatViewRow[] = [
    playerStatRow('WAS', 'High Usage Negative', 0.31, -12.5),
    playerStatRow('WAS', 'Efficient Low Usage', 0.16, 8.2),
    playerStatRow('WAS', 'Middle Drag', 0.24, -8.0),
  ];

  const summary = summarizePlayerStatsForAnalyst(rows, 2);

  assert.deepEqual(summary.top_usage.map((row) => row.player_name), ['High Usage Negative', 'Middle Drag']);
  assert.deepEqual(summary.weakest_net_rating.map((row) => row.player_name), ['High Usage Negative', 'Middle Drag']);
  assert.equal(summary.high_usage_weak_net[0].player_name, 'High Usage Negative');
  assert.equal(summary.high_usage_weak_net[0].analyst_score, 43.5);
});

test('data analyst traces become persisted tool calls and source rows with freshness', () => {
  const trace: DataAnalystTrace = {
    tool_use_id: 'toolu_data_1',
    tool_name: 'query_nba_data',
    datasets: [
      {
        dataset_id: 'nba_player_stats_current',
        label: 'NBA player advanced stats',
        source_name: 'Reviewed workbook',
        as_of_date: '2026-05-04',
        team_ids: ['WAS'],
        row_count: 17,
      },
    ],
    errors: [],
  };

  const toolCalls = dataAnalystTracesToToolCalls([trace]);
  assert.equal(toolCalls[0].name, 'query_nba_data');
  assert.deepEqual(toolCalls[0].input.team_ids, ['WAS']);
  assert.equal(toolCalls[0].data_analyst_trace?.datasets[0].as_of_date, '2026-05-04');

  const sources = dataAnalystTracesToBriefSources([trace], 4);
  assert.equal(sources[0].ref_index, 4);
  assert.equal(sources[0].kind, 'ANALYST_DATA');
  assert.equal(sources[0].source, 'GAMBIT_APP_DATA');
  assert.equal(sources[0].updated_at, '2026-05-04');
  assert.deepEqual((sources[0].data as { rows: { k: string; v: string }[] }).rows[3], {
    k: 'Teams',
    v: 'WAS',
  });
});

test('submit_data_analysis runtime guard accepts complete analyst payloads only', () => {
  const payload: SubmitDataAnalysisInput = {
    answer: 'Washington has one clear high-usage negative-net outlier.',
    key_findings: [{ label: 'Usage drag', body: 'High usage paired with weak net rating.', source_refs: [1] }],
    tables: [{ title: 'WAS usage and net rating', columns: ['Player', 'USG%', 'Net'], rows: [['A', 0.31, -12.5]], source_refs: [1] }],
    calculations: [{ label: 'Risk score', formula: 'usage_pct * 100 - net_rating', value: '43.5', source_refs: [1] }],
    sources: [{ ref_index: 1, kind: 'ANALYST_DATA', source: 'GAMBIT_APP_DATA', title: 'App data - NBA player advanced stats', updated_at: '2026-05-04', data: null }],
    caveats: ['Fixture payload uses app snapshot data only.'],
    followups: ['Compare the same players to cap-sheet obligations.'],
  };

  assert.equal(isSubmitDataAnalysisInput(payload), true);
  assert.equal(isSubmitDataAnalysisInput({ ...payload, caveats: 'none' }), false);
});

test('data analysis CBA citation sources select matching article cards', () => {
  const payload: SubmitDataAnalysisInput = {
    answer: 'The second apron matters because salary aggregation and frozen first-round pick rules constrain this path.',
    key_findings: [{
      label: 'Apron restriction',
      body: 'A second-apron team cannot treat aggregation as a normal trade lever.',
      source_refs: [1],
    }],
    tables: [],
    calculations: [],
    sources: [{ ref_index: 1, kind: 'ANALYST_DATA', source: 'GAMBIT_APP_DATA', title: 'App data - cap sheet', updated_at: '2026-05-04', data: null }],
    caveats: ['Snapshot does not include live post-draft apron changes.'],
    followups: [],
  };

  const sources = dataAnalysisCbaCitationSources(
    'Does the second apron block us from aggregating salaries?',
    payload,
    cbaArticles(),
    4,
    payload.sources,
  );

  assert.equal(sources.length, 1);
  assert.equal(sources[0].ref_index, 4);
  assert.equal(sources[0].kind, 'CBA');
  assert.equal(sources[0].source, 'CBA REFERENCE');
  assert.match(sources[0].title, /ARTICLE VII §7\.1/);
  assert.deepEqual(
    (sources[0].data as { article: string; section: string; rows: { k: string; v: string }[] }).rows[0],
    { k: 'Citation', v: 'ARTICLE VII §7.1' },
  );
});

test('data analysis CBA citation matcher does not add rule cards for non-CBA analysis', () => {
  assert.deepEqual(selectCbaArticlesForText(cbaArticles(), 'Rank Washington guards by true shooting.'), []);
  assert.deepEqual(selectCbaArticlesForText(cbaArticles(), 'Compare Larry Bird and Magic Johnson career playoff production.'), []);
});

test('data analysis CBA citation sources skip NBA cards when NFL data evidence is present', () => {
  const payload: SubmitDataAnalysisInput = {
    answer: 'For the Giants, prioritize restructure paths before tag decisions.',
    key_findings: [],
    tables: [],
    calculations: [],
    sources: [{
      ref_index: 1,
      kind: 'ANALYST_DATA',
      source: 'GAMBIT_APP_DATA',
      title: 'App data - NFL rules static snippets',
      updated_at: '2026-06-25',
      data: {
        rows: [{ k: 'Dataset', v: 'nfl_rules_static' }],
        data_analyst_trace: {
          tool_use_id: 'trace_1',
          tool_name: 'query_nfl_data',
          datasets: [{
            dataset_id: 'nfl_rules_static',
            label: 'NFL rules static snippets',
            as_of_date: '2026-06-25',
            source_name: 'NFL rules corpus',
            team_ids: ['NYG'],
            row_count: 3,
          }],
          errors: [],
        },
      },
    }],
    caveats: [],
    followups: [],
  };

  const sources = dataAnalysisCbaCitationSources(
    'We are the Giants. Should we restructure or tag a veteran contract?',
    payload,
    cbaArticles(),
    2,
    payload.sources,
  );

  assert.deepEqual(sources, []);
});

test('data analysis CBA citation matcher handles above-cap re-signing phrasing', () => {
  const sources = selectCbaArticlesForText(cbaArticles(), 'Can we re-sign him above the cap without using room?');

  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, 'ARTICLE VI §3');
});

test('CBA citation matcher uses seeded corpus aliases and section refs', async () => {
  const corpus = await loadCbaCorpusSeed();
  const articles = corpus.sections;

  const birdSources = selectCbaArticlesForText(articles, 'Can we re-sign him above the cap with Bird rights?');
  assert.equal(birdSources[0]?.id, 'Article VII §6');

  const mleSources = selectCbaArticlesForText(articles, 'MLE §VII.6.9 hard-caps us at the first apron.');
  assert.equal(mleSources[0]?.id, 'Article VII §6');

  const mixedSources = recommendationBriefCbaCitationSources(
    'Can we re-sign him above the cap and still use the MLE?',
    {
      thesis: 'Use the Bird-rights re-sign path, then decide whether the MLE is worth the hard-cap risk.',
      reasoning: 'Bird rights preserve above-cap retention optionality; MLE use can create first-apron constraints.',
      watching: [{ tag: 'Cap', body: 'Qualifying-offer timing and exception sequencing matter.' }],
      options: [{
        ref_index: 1,
        title: 'Re-sign incumbent',
        subtitle: 'Above-cap path',
        type_kind: 'fa',
        path_kind: 'compete',
        net_cap_num: 18,
        net_cap_label: '+$18.0M',
        epm: '+1.0',
        cba_section: 'BIRD §VI.3',
        timing: 'JUL 2026',
        src_count: 1,
        likelihood_kind: 'executable',
        likelihood_pct: 70,
        spark: [1, 2, 3],
        details: {
          decision_question: 'Can we retain him?',
          why_this: 'Preserves a contributor without cap room.',
          upside: 'Keeps talent.',
          downside: 'Crowds apron room.',
          required_moves: ['Confirm rights'],
          blockers: [],
          watch_triggers: ['Offer sheet'],
          next_step: 'Verify CBA refs.',
          evidence_refs: [1],
        },
      }],
      sources: [],
    },
    articles,
    3,
  );
  assert.ok(mixedSources.some((source) => source.title.includes('Article VII §6')));

  const secondApronSources = dataAnalysisCbaCitationSources(
    'Does the second apron block salary aggregation?',
    {
      answer: 'The second apron turns salary aggregation into the governing constraint.',
      key_findings: [],
      tables: [],
      calculations: [],
      sources: [],
      caveats: [],
      followups: [],
    },
    articles,
    7,
  );
  assert.ok(secondApronSources.some((source) => /Article VII §2|Article VII §12/.test(source.title)));
  assert.ok(secondApronSources.every((source) => !/Article [IVXLCDM]+ §\d+ - Article [IVXLCDM]+ §\d+/.test(source.title)));
});

test('recommendation brief CBA citation sources use option CBA sections', () => {
  const payload: SubmitBriefInput = {
    thesis: 'Use the Bird-rights re-sign path before chasing external salary.',
    reasoning: 'Keeping the incumbent preserves above-cap optionality for the first move.',
    watching: [{ tag: 'Cap', body: 'The practical constraint is whether the qualifying-offer timeline keeps leverage intact.' }],
    options: [{
      ref_index: 1,
      title: 'Re-sign incumbent guard',
      subtitle: 'Preserve above-cap retention path.',
      type_kind: 'fa',
      path_kind: 'compete',
      net_cap_num: 18,
      net_cap_label: '+$18.0M',
      epm: '+1.0',
      cba_section: 'BIRD §VI.3',
      timing: 'JUL 2026',
      src_count: 1,
      likelihood_kind: 'executable',
      likelihood_pct: 70,
      spark: [10, 12, 14, 16, 18],
      details: {
        decision_question: 'Should we prioritize the Bird-rights path?',
        why_this: 'It keeps a known contributor without needing cap room.',
        upside: 'Retention without creating a new hole.',
        downside: 'Can crowd later flexibility.',
        required_moves: ['Confirm rights status', 'Set qualifying-offer posture'],
        blockers: [],
        watch_triggers: ['Market offer sheet'],
        next_step: 'Have cap/contracts verify rights and QO dates.',
        evidence_refs: [1],
      },
    }],
    sources: [],
  };

  const sources = recommendationBriefCbaCitationSources('Can we re-sign him above the cap?', payload, cbaArticles(), 2);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].ref_index, 2);
  assert.equal(sources[0].kind, 'CBA');
  assert.match(sources[0].title, /ARTICLE VI §3/);
});

function playerStatRow(teamId: string, playerName: string, usagePct: number, netRating: number): CurrentPlayerStatViewRow {
  return {
    team_id: teamId,
    player_name: playerName,
    position: 'G',
    games_played: 50,
    minutes: 1000,
    usage_pct: usagePct,
    net_rating: netRating,
    true_shooting_pct: 0.55,
    effective_fg_pct: 0.5,
    assist_pct: 0.2,
    turnover_pct: 10,
    match_status: 'roster-matched',
  } as CurrentPlayerStatViewRow;
}

function cbaArticles(): CbaArticle[] {
  return [
    {
      id: 'ARTICLE VII §6.9',
      label: 'Mid-Level Exception',
      body: 'Teams above the cap may use the Non-Taxpayer MLE to sign free agents. Use of the MLE hard-caps the team at the first apron.',
    },
    {
      id: 'ARTICLE VII §7.1',
      label: 'Second Apron Restrictions',
      body: 'Teams above the second apron lose access to MLE/BAE, cannot aggregate salaries in trade, and have first-round picks frozen.',
    },
    {
      id: 'ARTICLE VI §3',
      label: 'Bird Rights & Qualifying Offers',
      body: 'A team holds Bird rights after a player completes 3 seasons without a free-agent change of address; allows re-signing above the cap.',
    },
  ];
}
