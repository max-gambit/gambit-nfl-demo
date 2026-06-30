import type Anthropic from '@anthropic-ai/sdk';
import type { BriefSource, DataAnalystTrace } from '@shared/types';
import type { CurrentNflEvidencePack } from './nfl_evidence.js';
import {
  buildNflDecisionPrimitives,
  type NflDecisionPrimitive,
} from './nfl_decision_primitives.js';

export type NflContextIntentTag =
  | 'roster'
  | 'cap_contract'
  | 'trade'
  | 'player_quality'
  | 'rules'
  | 'ol_quality'
  | 'seller_thesis';

export interface ComposedNflContext {
  intent_tags: NflContextIntentTag[];
  team_ids: string[];
  focus_groups: string[];
  must_use_facts: string[];
  decision_variables: string[];
  decision_primitives: NflDecisionPrimitive[];
  coverage_boundaries: string[];
  source_ref_map: string[];
  do_not_claim: string[];
  system_block: string;
}

interface SourceRow {
  k: string;
  v: string;
}

export function buildNflContextComposerForEvidence(
  question: string,
  evidence: CurrentNflEvidencePack | null,
): ComposedNflContext | null {
  if (!evidence) return null;
  const sourceRows = sourceRowsByRef(evidence.sources);
  return buildComposedContext({
    question,
    teamIds: evidence.team_ids,
    rowsByRef: sourceRows,
    traceDatasets: evidence.trace_datasets.map((dataset) => dataset.dataset_id),
    refsAreReserved: true,
  });
}

export function buildNflContextComposerForDataAnalyst(
  question: string,
  traces: DataAnalystTrace[],
  messages: Anthropic.MessageParam[] = [],
): ComposedNflContext | null {
  const datasetEntries = traces
    .filter((trace) => trace.errors.length === 0 && trace.tool_name === 'query_nfl_data')
    .flatMap((trace) => trace.datasets
      .filter((dataset) => dataset.dataset_id.startsWith('nfl_'))
      .map((dataset) => ({ trace, dataset })));
  if (datasetEntries.length === 0) return null;

  const rowsByDataset = sourceRowsByDatasetFromDataAnalystMessages(messages);
  const teamIds = [...new Set(datasetEntries.flatMap(({ dataset }) => dataset.team_ids))]
    .filter((teamId) => /^[A-Z]{2,3}$/.test(teamId));
  const rowsByRef = new Map<number, SourceRow[]>();
  datasetEntries.forEach(({ trace, dataset }, index) => {
    rowsByRef.set(index + 1, rowsByDataset.get(toolResultDatasetKey(trace.tool_use_id, dataset.dataset_id)) ?? [
      { k: 'Dataset', v: dataset.dataset_id },
      { k: 'Label', v: dataset.label },
      { k: 'Teams', v: dataset.team_ids.join(', ') || 'all/bounded' },
      { k: 'Rows returned', v: String(dataset.row_count) },
      { k: 'Source', v: dataset.source_name ?? 'unknown' },
    ]);
  });

  return buildComposedContext({
    question,
    teamIds,
    rowsByRef,
    traceDatasets: datasetEntries.map(({ dataset }) => dataset.dataset_id),
    refsAreReserved: false,
  });
}

function sourceRowsByDatasetFromDataAnalystMessages(messages: Anthropic.MessageParam[]): Map<string, SourceRow[]> {
  const rowsByDataset = new Map<string, SourceRow[]>();
  for (const message of messages) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== 'tool_result' || typeof block.content !== 'string') continue;
      const parsed = parseToolResult(block.content);
      if (!parsed || parsed.tool_name !== 'query_nfl_data') continue;
      for (const [datasetId, rows] of sourceRowsFromNflToolResult(parsed)) {
        rowsByDataset.set(toolResultDatasetKey(stringValue(block.tool_use_id) ?? '', datasetId), rows);
      }
    }
  }
  return rowsByDataset;
}

function toolResultDatasetKey(toolUseId: string, datasetId: string): string {
  return `${toolUseId}:${datasetId}`;
}

function sourceRowsFromNflToolResult(result: Record<string, unknown>): Map<string, SourceRow[]> {
  const rowsByDataset = new Map<string, SourceRow[]>();
  const rosterRows = sourceRowsFromRostersResult(result);
  if (rosterRows.length) rowsByDataset.set('nfl_rosters_current', rosterRows);
  const capRows = sourceRowsFromCapSheetsResult(result);
  if (capRows.length) rowsByDataset.set('nfl_cap_sheets_current', capRows);
  const metricRows = sourceRowsFromPlayerMetricsResult(result);
  if (metricRows.length) rowsByDataset.set('nfl_player_metrics_current', metricRows);
  const coverageRows = sourceRowsFromCoverageResult(result);
  if (coverageRows.length) rowsByDataset.set('nfl_coverage_current', coverageRows);
  const tradeRows = sourceRowsFromTradeScreenResult(result);
  if (tradeRows.length) rowsByDataset.set('nfl_trade_screen_current', tradeRows);
  return rowsByDataset;
}

function parseToolResult(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sourceRowsFromTradeScreenResult(result: Record<string, unknown>): SourceRow[] {
  const data = isRecord(result.data) ? result.data : null;
  const tradeScreen = data && isRecord(data.trade_screen) ? data.trade_screen : null;
  const screens = tradeScreen && Array.isArray(tradeScreen.screens)
    ? tradeScreen.screens.filter(isRecord)
    : [];
  if (!screens.length) return [];

  const joinScreenStrings = (key: string) => screens
    .flatMap((screen) => stringArrayValue(screen[key]))
    .filter(Boolean)
    .join(' | ');
  const subjectTeams = screens
    .map((screen) => stringValue(screen.subject_team_id))
    .filter((teamId): teamId is string => Boolean(teamId));
  const counterparties = screens
    .flatMap((screen) => stringArrayValue(screen.counterparty_intel_team_ids))
    .filter((teamId, index, arr) => teamId && arr.indexOf(teamId) === index);

  return [
    { k: 'Dataset', v: 'nfl_trade_screen_current' },
    { k: 'Team', v: subjectTeams.join(', ') || 'bounded' },
    { k: 'Objective', v: screens.map((screen) => stringValue(screen.objective)).filter(Boolean).join(' | ') },
    { k: 'Lower-pain outgoing hierarchy', v: joinScreenStrings('outgoing_hierarchy') },
    { k: 'Depth-after-trade checks', v: joinScreenStrings('depth_after_trade') },
    { k: 'Seller thesis cards', v: joinScreenStrings('named_target_lanes') },
    { k: 'Counterparty Intel teams', v: counterparties.join(', ') },
    { k: 'Counterparty seller summaries', v: joinScreenStrings('counterparty_intel_summary') },
    { k: 'Bad cap-relief trades', v: joinScreenStrings('bad_cap_relief_trades') },
    { k: 'Required answer checks', v: joinScreenStrings('answer_requirements') },
  ].filter((row) => row.v.length > 0);
}

function sourceRowsFromRostersResult(result: Record<string, unknown>): SourceRow[] {
  const rows = rowsFromNestedData(result, 'rosters');
  if (!rows.length) return [];
  return [
    { k: 'Dataset', v: 'nfl_rosters_current' },
    { k: 'Team', v: uniqueStrings(rows.map((row) => stringValue(row.team_id))).join(', ') || 'bounded' },
    { k: 'Roster rows', v: String(rows.length) },
    { k: 'Roster source', v: 'query_nfl_data tool result' },
  ];
}

function sourceRowsFromCapSheetsResult(result: Record<string, unknown>): SourceRow[] {
  const rows = rowsFromNestedData(result, 'cap_sheets');
  if (!rows.length) return [];
  const sourceNeeded = rows.filter((row) => stringValue(row.source_status) === 'source-needed');
  const coverage = [
    `years=${countRows(rows, (row) => numberValue(row.contract_years_remaining) != null || numberValue(row.years_remaining) != null)}/${rows.length}`,
    `dead/cut=${countRows(rows, (row) => numberValue(row.dead_money_if_cut_2026) != null && numberValue(row.cut_savings_2026) != null)}/${rows.length}`,
    `post-June=${countRows(rows, (row) => numberValue(row.post_june_1_dead_money_2026) != null && numberValue(row.post_june_1_cut_savings_2026) != null)}/${rows.length}`,
    `trade=${countRows(rows, (row) => numberValue(row.trade_dead_money_2026) != null && numberValue(row.trade_savings_2026) != null)}/${rows.length}`,
  ].join('; ');
  return [
    { k: 'Dataset', v: 'nfl_cap_sheets_current' },
    { k: 'Team', v: uniqueStrings(rows.map((row) => stringValue(row.team_id))).join(', ') || 'bounded' },
    { k: 'Cap rows', v: String(rows.length) },
    { k: 'Source-needed cap rows', v: String(sourceNeeded.length) },
    { k: 'Contract field coverage', v: coverage },
    { k: 'Top cap contracts', v: topCapContracts(rows) },
    { k: 'Position-group cap rollups', v: positionGroupCapRollups(rows) },
  ].filter((row) => row.v.length > 0);
}

function sourceRowsFromPlayerMetricsResult(result: Record<string, unknown>): SourceRow[] {
  const rows = rowsFromNestedData(result, 'player_metrics');
  if (!rows.length) return [];
  const coverageCounts = countStrings(rows.map((row) => stringValue(row.metric_coverage_level) ?? stringValue(row.source_status) ?? 'unknown'));
  const summaries = rows
    .map((row) => [stringValue(row.player_name), stringValue(row.position), stringValue(row.position_metric_summary)].filter(Boolean).join(' - '))
    .filter(Boolean)
    .slice(0, 8)
    .join(' | ');
  return [
    { k: 'Dataset', v: 'nfl_player_metrics_current' },
    { k: 'Team', v: uniqueStrings(rows.map((row) => stringValue(row.team_id))).join(', ') || 'bounded' },
    { k: 'Metric rows', v: String(rows.length) },
    { k: 'Metric coverage', v: Object.entries(coverageCounts).map(([key, count]) => `${key}=${count}`).join('; ') },
    { k: 'Top position scorecards', v: summaries },
  ].filter((row) => row.v.length > 0);
}

function sourceRowsFromCoverageResult(result: Record<string, unknown>): SourceRow[] {
  const data = isRecord(result.data) ? result.data : null;
  const coverage = data && isRecord(data.coverage) ? data.coverage : null;
  const teams = coverage && Array.isArray(coverage.teams) ? coverage.teams.filter(isRecord) : [];
  if (!teams.length) return [];
  const rows: SourceRow[] = [
    { k: 'Dataset', v: 'nfl_coverage_current' },
    { k: 'Team', v: uniqueStrings(teams.map((team) => stringValue(team.team_id))).join(', ') || 'bounded' },
    { k: 'Overall status', v: uniqueStrings(teams.map((team) => stringValue(team.status))).join(', ') },
  ];
  const readiness = teams.flatMap((team) => Array.isArray(team.readiness) ? team.readiness.filter(isRecord) : []);
  if (readiness.length) {
    rows.push({
      k: 'Readiness',
      v: readiness.map((item) => `${stringValue(item.key) ?? 'unknown'}: ${stringValue(item.status) ?? 'unknown'}`).join(' | '),
    });
  }
  const positionGroups = teams.flatMap((team) => Array.isArray(team.position_groups) ? team.position_groups.filter(isRecord) : []);
  if (positionGroups.length) {
    rows.push({
      k: 'Position groups',
      v: positionGroups
        .map((item) => `${stringValue(item.group) ?? 'UNK'}: ${stringValue(item.status) ?? 'unknown'}; metrics=${stringValue(item.metric_source_status) ?? 'unknown'}; seller=${stringValue(item.seller_thesis_status) ?? 'unknown'}`)
        .join(' | '),
    });
  }
  const gaps = teams.flatMap((team) => Array.isArray(team.top_gaps) ? team.top_gaps.filter(isRecord) : []);
  if (gaps.length) {
    rows.push({
      k: 'Top gaps',
      v: gaps.map((gap) => `${stringValue(gap.label) ?? 'Gap'}: ${stringValue(gap.detail) ?? ''}`).join(' | '),
    });
  }
  rows.push({ k: 'Coverage precedence', v: 'Use readiness to decide how strong the answer can be before making a roster, cap, trade, rules, or player-quality claim.' });
  return rows;
}

function rowsFromNestedData(result: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const data = isRecord(result.data) ? result.data : null;
  const section = data && isRecord(data[key]) ? data[key] : null;
  return section && Array.isArray(section.rows) ? section.rows.filter(isRecord) : [];
}

function buildComposedContext(args: {
  question: string;
  teamIds: string[];
  rowsByRef: Map<number, SourceRow[]>;
  traceDatasets: string[];
  refsAreReserved: boolean;
}): ComposedNflContext {
  const intentTags = inferIntentTags(args.question, args.traceDatasets);
  const focusGroups = inferFocusGroups(args.question);
  const mustUseFacts = compactFacts(args.rowsByRef, intentTags, args.refsAreReserved);
  const decisionVariables = decisionVariablesForIntent(intentTags, focusGroups);
  const decisionPrimitives = buildNflDecisionPrimitives({
    question: args.question,
    intentTags,
    focusGroups,
    rowsByRef: args.rowsByRef,
    refsAreReserved: args.refsAreReserved,
  });
  const coverageBoundaries = coverageBoundariesForIntent(intentTags, args.rowsByRef);
  const sourceRefMap = sourceRefMapForRows(args.rowsByRef, args.refsAreReserved);
  const doNotClaim = doNotClaimForIntent(intentTags, args.rowsByRef);

  const context: Omit<ComposedNflContext, 'system_block'> = {
    intent_tags: intentTags,
    team_ids: args.teamIds,
    focus_groups: focusGroups,
    must_use_facts: mustUseFacts,
    decision_variables: decisionVariables,
    decision_primitives: decisionPrimitives,
    coverage_boundaries: coverageBoundaries,
    source_ref_map: sourceRefMap,
    do_not_claim: doNotClaim,
  };

  return {
    ...context,
    system_block: renderComposedContextBlock(context),
  };
}

function sourceRowsByRef(sources: Omit<BriefSource, 'id' | 'brief_id'>[]): Map<number, SourceRow[]> {
  const rowsByRef = new Map<number, SourceRow[]>();
  for (const source of sources) {
    const rows = source.data?.rows;
    rowsByRef.set(source.ref_index, Array.isArray(rows) ? rows.filter(isSourceRow) : []);
  }
  return rowsByRef;
}

function isSourceRow(row: unknown): row is SourceRow {
  return typeof row === 'object'
    && row !== null
    && 'k' in row
    && 'v' in row
    && typeof (row as { k?: unknown }).k === 'string'
    && typeof (row as { v?: unknown }).v === 'string';
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function uniqueStrings(values: Array<string | null>): string[] {
  return values.filter((value, index, arr): value is string => Boolean(value) && arr.indexOf(value) === index);
}

function countRows(rows: Record<string, unknown>[], predicate: (row: Record<string, unknown>) => boolean): number {
  return rows.filter(predicate).length;
}

function countStrings(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function topCapContracts(rows: Record<string, unknown>[]): string {
  return [...rows]
    .sort((a, b) => (numberValue(b.cap_number_2026) ?? -1) - (numberValue(a.cap_number_2026) ?? -1))
    .slice(0, 8)
    .map((row) => `${stringValue(row.player_name) ?? 'Unknown'} ${formatMoney(numberValue(row.cap_number_2026)) ?? 'unpriced'}; years=${numberValue(row.contract_years_remaining) ?? numberValue(row.years_remaining) ?? 'unknown'}; trade=${formatMoney(numberValue(row.trade_savings_2026)) ?? 'unknown'}`)
    .join(' | ');
}

function positionGroupCapRollups(rows: Record<string, unknown>[]): string {
  const byGroup = new Map<string, { count: number; cap: number; sourceNeeded: number }>();
  for (const row of rows) {
    const group = positionGroup(stringValue(row.position));
    const current = byGroup.get(group) ?? { count: 0, cap: 0, sourceNeeded: 0 };
    current.count += 1;
    current.cap += numberValue(row.cap_number_2026) ?? 0;
    if (stringValue(row.source_status) === 'source-needed') current.sourceNeeded += 1;
    byGroup.set(group, current);
  }
  return [...byGroup.entries()]
    .sort((a, b) => b[1].cap - a[1].cap)
    .slice(0, 8)
    .map(([group, row]) => `${group}: ${formatMoney(row.cap) ?? '$0'} across ${row.count} rows${row.sourceNeeded ? `; ${row.sourceNeeded} needs source review` : ''}`)
    .join(' | ');
}

function positionGroup(position: string | null): string {
  const pos = (position ?? '').toUpperCase();
  if (['QB'].includes(pos)) return 'QB';
  if (['RB', 'FB'].includes(pos)) return 'RB';
  if (['WR'].includes(pos)) return 'WR';
  if (['TE'].includes(pos)) return 'TE';
  if (['C', 'G', 'OG', 'OT', 'T', 'OL'].includes(pos)) return 'OL';
  if (['DT', 'NT', 'DE', 'DL'].includes(pos)) return 'DL';
  if (['EDGE', 'OLB'].includes(pos)) return 'EDGE/LB';
  if (['LB', 'ILB', 'MLB'].includes(pos)) return 'LB';
  if (['CB'].includes(pos)) return 'CB';
  if (['S', 'FS', 'SS', 'DB'].includes(pos)) return 'S';
  if (['K', 'P', 'LS'].includes(pos)) return 'ST';
  return pos || 'UNK';
}

function formatMoney(value: number | null): string | null {
  if (value == null) return null;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function inferIntentTags(question: string, datasets: string[]): NflContextIntentTag[] {
  const tags = new Set<NflContextIntentTag>();
  const text = question.toLowerCase();
  if (/\b(roster|depth|position group|who do we have|offseason roster)\b/.test(text)) tags.add('roster');
  if (/\b(cap|contract|cut|release|dead money|restructure|extend|extension|tag|guarantee|post[-\s]?june|spend|audit)\b/.test(text)) tags.add('cap_contract');
  if (/\b(trade|call|market|counterparty|seller|target|salary[-\s]?out)\b/.test(text)) {
    tags.add('trade');
    tags.add('seller_thesis');
  }
  if (/\b(quality|performance|scorecard|disruptive|pressure|separation|coverage|replaceable|run[-\s]?stopping|production|efficiency)\b/.test(text)) {
    tags.add('player_quality');
  }
  if (/\b(rule|cba|waiver|practice squad|ir|pup|nfi|compensatory|franchise tag|transition tag)\b/.test(text)) tags.add('rules');
  if (/\b(ol|offensive line|guard|tackle|center|pass protect|pressure allowed)\b/.test(text)) {
    tags.add('player_quality');
    tags.add('ol_quality');
  }
  if (datasets.includes('nfl_trade_screen_current')) {
    tags.add('trade');
    tags.add('seller_thesis');
  }
  if (datasets.includes('nfl_cap_sheets_current')) tags.add('cap_contract');
  if (datasets.includes('nfl_player_metrics_current')) tags.add('player_quality');
  if (tags.size === 0) tags.add('roster');
  return [...tags];
}

function inferFocusGroups(question: string): string[] {
  const text = question.toLowerCase();
  const groups: string[] = [];
  const add = (group: string) => {
    if (!groups.includes(group)) groups.push(group);
  };
  if (/\b(qb|quarterback)\b/.test(text)) add('QB');
  if (/\b(rb|running back)\b/.test(text)) add('RB');
  if (/\b(wr|receiver|wideout)\b/.test(text)) add('WR');
  if (/\b(te|tight end)\b/.test(text)) add('TE');
  if (/\b(ol|offensive line|guard|tackle|center|interior offensive line)\b/.test(text)) add('OL');
  if (/\b(dt|defensive tackle|interior pressure|interior pass|3-tech|nose|defensive line|dl)\b/.test(text)) add('DL');
  if (/\b(edge|pass rush|outside linebacker|olb)\b/.test(text)) add('EDGE/LB');
  if (/\b(linebacker|lb)\b/.test(text)) add('LB');
  if (/\b(cb|corner|cornerback)\b/.test(text)) add('CB');
  if (/\b(safety|safeties|secondary|db|defensive back)\b/.test(text)) {
    add('CB');
    add('S');
  }
  if (/\b(kicker|punter|special teams|st)\b/.test(text)) add('ST');
  return groups;
}

function compactFacts(
  rowsByRef: Map<number, SourceRow[]>,
  tags: NflContextIntentTag[],
  refsAreReserved: boolean,
): string[] {
  const facts: string[] = [];
  for (const [ref, rows] of rowsByRef) {
    const dataset = valueFor(rows, 'Dataset');
    if (dataset === 'nfl_rosters_current') pushFact(facts, ref, refsAreReserved, rows, ['Team', 'Roster rows', 'Roster source', 'Roster as of']);
    if (dataset === 'nfl_cap_sheets_current') pushFact(facts, ref, refsAreReserved, rows, ['Team', 'Cap rows', 'Source-needed cap rows', 'Contract field coverage', 'Top cap contracts', 'Position-group cap rollups']);
    if (dataset === 'nfl_player_metrics_current') pushFact(facts, ref, refsAreReserved, rows, ['Team', 'Metric rows', 'Metric coverage', 'Top position scorecards']);
    if (dataset === 'nfl_coverage_current') pushFact(facts, ref, refsAreReserved, rows, ['Team', 'Overall status', 'Readiness', 'Position groups', 'Top gaps']);
    if (dataset === 'nfl_trade_screen_current') pushFact(facts, ref, refsAreReserved, rows, ['Objective', 'Lower-pain outgoing hierarchy', 'Depth-after-trade checks', 'Seller thesis cards', 'Counterparty seller summaries', 'Bad cap-relief trades', 'Required answer checks']);
    if (dataset === 'nfl_context_graph' && tags.includes('seller_thesis')) pushFact(facts, ref, refsAreReserved, rows, ['Counterparty Intel teams', 'Seller thesis summaries', 'Intel precedence']);
    if (facts.length >= 12) break;
  }
  return facts.length ? facts : ['Use the loaded NFL app-data traces as the evidence boundary before making a strong claim.'];
}

function pushFact(facts: string[], ref: number, refsAreReserved: boolean, rows: SourceRow[], keys: string[]) {
  const parts = keys
    .map((key) => {
      const value = valueFor(rows, key);
      return value ? `${key}: ${truncate(frontOfficeLabel(value), 360)}` : null;
    })
    .filter((part): part is string => Boolean(part));
  if (parts.length) facts.push(`${refLabel(ref, refsAreReserved)} ${parts.join(' | ')}`);
}

function decisionVariablesForIntent(tags: NflContextIntentTag[], focusGroups: string[]): string[] {
  const variables: string[] = [];
  if (tags.includes('cap_contract')) {
    variables.push('Use cap room, 2026 cap hits, dead money, post-June treatment, trade savings, contract years, and guarantee confidence before naming a cap lever.');
  }
  if (tags.includes('player_quality')) {
    variables.push('Use public position scorecards before adjectives like disruptive, replaceable, separation, coverage liability, or run-stopper.');
  }
  if (tags.includes('trade')) {
    variables.push('For trades, separate subject-team salary-out pain, target contract fit, seller depth loss, seller motivation, and availability validation.');
  }
  if (tags.includes('seller_thesis')) {
    variables.push('A counterparty is a lead lane only when cap/contract fit and graph-backed seller thesis both support a call/check-call action.');
  }
  if (tags.includes('ol_quality')) {
    variables.push('For OL, public data supports continuity and availability unless a reviewed OL quality source is loaded.');
  }
  if (focusGroups.length) variables.push(`Keep the analysis focused on these groups unless the user asks wider: ${focusGroups.join(', ')}.`);
  return variables;
}

function coverageBoundariesForIntent(
  tags: NflContextIntentTag[],
  rowsByRef: Map<number, SourceRow[]>,
): string[] {
  const boundaries = [
    'Coverage status sets answer strength: strong supports a firm claim; directional needs a caveat; weak/blocked limits or refuses the unsupported part.',
  ];
  const coverageRows = [...rowsByRef.values()].find((rows) => valueFor(rows, 'Dataset') === 'nfl_coverage_current');
  const readiness = coverageRows ? valueFor(coverageRows, 'Readiness') : null;
  const groups = coverageRows ? valueFor(coverageRows, 'Position groups') : null;
  if (readiness) boundaries.push(`Question readiness from coverage: ${truncate(readiness, 520)}.`);
  if (groups) boundaries.push(`Position-group readiness from coverage: ${truncate(groups, 520)}.`);
  if (tags.includes('trade')) boundaries.push('Trade answers must not treat cap fit as availability; seller thesis and validation triggers are separate evidence.');
  if (tags.includes('player_quality')) boundaries.push('If scorecard coverage is directional or gap for a named player/group, frame the evaluation as public-evidence-limited.');
  return boundaries;
}

function sourceRefMapForRows(rowsByRef: Map<number, SourceRow[]>, refsAreReserved: boolean): string[] {
  return [...rowsByRef.entries()].map(([ref, rows]) => {
    const dataset = valueFor(rows, 'Dataset') ?? valueFor(rows, 'Label') ?? 'unknown';
    const team = valueFor(rows, 'Team') ?? valueFor(rows, 'Teams') ?? 'bounded';
    return `${refLabel(ref, refsAreReserved)} ${dataset} (${team})`;
  });
}

function doNotClaimForIntent(tags: NflContextIntentTag[], rowsByRef: Map<number, SourceRow[]>): string[] {
  const claims = [
    'Do not use context-graph mini-rosters for current roster counts, cap completeness, or player-team membership.',
    'Do not lead with product/schema labels in visible prose unless the user asks for data QA.',
    'Do not invent private medical, coaching, trade-price, or seller-availability facts.',
  ];
  if (tags.includes('cap_contract')) {
    claims.push('Do not say a Giants cap audit is blocked on ingestion when current roster/cap rows are loaded.');
  }
  if (tags.includes('ol_quality')) {
    claims.push('Do not make OL pressure-allowed or pass-block quality claims unless a reviewed OL quality source is loaded; use continuity/availability language instead.');
  }
  if (tags.includes('trade')) {
    claims.push('Do not describe an expiring target as 2027-clean if the path assumes a new extension, restructure, or new-money component.');
  }
  const tradeRows = [...rowsByRef.values()].find((rows) => valueFor(rows, 'Dataset') === 'nfl_trade_screen_current');
  const sellerCards = tradeRows ? valueFor(tradeRows, 'Seller thesis cards') : '';
  if (/Vita Vea/i.test(sellerCards ?? '')) {
    claims.push('Do not headline Vita Vea/Tampa as the best lane unless the seller thesis supports a call-now or check-call action.');
  }
  return claims;
}

function renderComposedContextBlock(context: Omit<ComposedNflContext, 'system_block'>): string {
  return [
    '=== NFL ANALYST DESK CONTEXT ===',
    'This block is evidence orientation, not an answer plan. Use it to choose relevant facts and confidence boundaries; do not mimic its headings or turn it into a rigid template.',
    `Intent tags: ${context.intent_tags.join(', ')}`,
    `Team ids: ${context.team_ids.join(', ') || 'bounded from tool traces'}`,
    `Focus groups: ${context.focus_groups.join(', ') || 'infer from the user question'}`,
    '',
    'Must-use evidence:',
    ...bullets(context.must_use_facts),
    '',
    'Decision variables:',
    ...bullets(context.decision_variables),
    '',
    'Decision lenses (private; use as reasoning lenses, not public headings):',
    ...primitiveBullets(context.decision_primitives),
    '',
    'Coverage boundaries:',
    ...bullets(context.coverage_boundaries),
    '',
    'Source ref map:',
    ...bullets(context.source_ref_map),
    '',
    'Do not claim:',
    ...bullets(context.do_not_claim),
  ].join('\n');
}

function bullets(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ['- None beyond the mandatory evidence block.'];
}

function primitiveBullets(items: NflDecisionPrimitive[]): string[] {
  if (!items.length) return ['- None beyond the mandatory evidence block.'];
  return items.flatMap((item) => [
    `- ${item.key}:`,
    ...item.facts.map((fact) => `  fact: ${fact}`),
    ...item.decision_checks.map((check) => `  check: ${check}`),
    ...item.boundaries.map((boundary) => `  boundary: ${boundary}`),
    ...(item.source_refs.length ? [`  refs: ${item.source_refs.join('; ')}`] : []),
  ]);
}

function valueFor(rows: SourceRow[], key: string): string | null {
  return rows.find((row) => row.k === key)?.v ?? null;
}

function refLabel(ref: number, refsAreReserved: boolean): string {
  return refsAreReserved ? `[${ref}]` : `trace ${ref}:`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function frontOfficeLabel(value: string): string {
  return value
    .replace(/Contract Ledger v1/gi, 'contract ledger')
    .replace(/\bsource-needed\b/gi, 'needs source review')
    .replace(/\bcaptured_public_metrics\b/gi, 'captured public metrics')
    .replace(/\bstrong_position_scorecards\b/gi, 'strong position scorecards')
    .replace(/\bdirectional_scorecards\b/gi, 'directional scorecards')
    .replace(/\bscorecard_gaps\b/gi, 'scorecard gaps')
    .replace(/\brow parity\b/gi, 'roster/cap coverage match');
}
