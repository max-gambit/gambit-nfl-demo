import type { NflContextIntentTag } from './nfl_context_composer.js';

export type NflDecisionPrimitiveKey =
  | 'cap_scenario_ladder'
  | 'playable_depth'
  | 'trade_price_discipline'
  | 'role_fit'
  | 'benchmark_context'
  | 'decision_confidence';

export interface NflDecisionPrimitive {
  key: NflDecisionPrimitiveKey;
  applies: boolean;
  facts: string[];
  decision_checks: string[];
  boundaries: string[];
  source_refs: string[];
}

export interface NflPrimitiveSourceRow {
  k: string;
  v: string;
}

export interface BuildNflDecisionPrimitivesArgs {
  question: string;
  intentTags: NflContextIntentTag[];
  focusGroups: string[];
  rowsByRef: Map<number, NflPrimitiveSourceRow[]>;
  refsAreReserved: boolean;
}

interface PrimitiveSeed {
  facts?: string[];
  decision_checks?: string[];
  boundaries?: string[];
  source_refs?: string[];
}

const MONEY_TARGETS = '$5M / $10M / $15M+';

export function buildNflDecisionPrimitives(args: BuildNflDecisionPrimitivesArgs): NflDecisionPrimitive[] {
  const base = [
    capScenarioLadder(args),
    playableDepthTranslator(args),
    tradePriceDiscipline(args),
    roleFitLens(args),
    benchmarkContext(args),
  ].filter((primitive): primitive is NflDecisionPrimitive => Boolean(primitive?.applies));

  if (base.length === 0) return [];
  return [
    ...base,
    decisionConfidenceSynthesizer(args, base),
  ];
}

function capScenarioLadder(args: BuildNflDecisionPrimitivesArgs): NflDecisionPrimitive | null {
  if (!shouldUseCapScenarioLadder(args.question)) {
    return null;
  }
  const capRows = rowsForDataset(args.rowsByRef, 'nfl_cap_sheets_current');
  const tradeRows = rowsForDataset(args.rowsByRef, 'nfl_trade_screen_current');
  return primitive(args, 'cap_scenario_ladder', {
    facts: compactRows([
      valueFact(capRows, 'Contract field coverage'),
      valueFact(capRows, 'Top cap contracts'),
      valueFact(capRows, 'Position-group cap rollups'),
      valueFact(tradeRows, 'Lower-pain outgoing hierarchy'),
      valueFact(tradeRows, 'Bad cap-relief trades'),
    ]),
    decision_checks: [
      `If the user did not name a target amount, reason in room bands: small about ${MONEY_TARGETS.split(' / ')[0]}, medium about ${MONEY_TARGETS.split(' / ')[1]}, and large about ${MONEY_TARGETS.split(' / ')[2]}.`,
      'For each cap lever, pair 2026 room with future-year cost: dead money, post-June treatment, trade impact, remaining years, and restructure/new-money risk.',
      'Prefer short-dated lower-pain salary-out before touching premium starters unless the user explicitly asks for football blockbusters.',
    ],
    boundaries: [
      'Do not list every lever as equivalent; scale the recommendation to how much room must actually be created.',
      'Do not call a move 2027-clean if it requires a new extension, restructure, or new-money component.',
    ],
    source_refs: refsForDatasets(args, ['nfl_cap_sheets_current', 'nfl_trade_screen_current']),
  });
}

function shouldUseCapScenarioLadder(question: string): boolean {
  return /\b(cap room|cap space|cap sheet|cap hit|cap number|cap ledger|cap audit|cap allocation|clean\s+2026\s+room|create\s+room|open\s+room|clear\s+room|flexibility lever|dead money|cut|release|restructure|cut savings|trade room|2027|hangover|contract lever|post[-\s]?june|guarantee|over[-\s]?invest(?:ed|ment)?|under[-\s]?invest(?:ed|ment)?)\b/i
    .test(question);
}

function playableDepthTranslator(args: BuildNflDecisionPrimitivesArgs): NflDecisionPrimitive | null {
  if (!args.intentTags.includes('roster') && !args.intentTags.includes('trade') && args.focusGroups.length === 0) return null;
  const rosterRows = rowsForDataset(args.rowsByRef, 'nfl_rosters_current');
  const metricsRows = rowsForDataset(args.rowsByRef, 'nfl_player_metrics_current');
  const coverageRows = rowsForDataset(args.rowsByRef, 'nfl_coverage_current');
  const tradeRows = rowsForDataset(args.rowsByRef, 'nfl_trade_screen_current');
  return primitive(args, 'playable_depth', {
    facts: compactRows([
      valueFact(rosterRows, 'Roster rows'),
      valueFact(metricsRows, 'Top position scorecards'),
      valueFact(coverageRows, 'Position groups'),
      valueFact(tradeRows, 'Depth-after-trade checks'),
    ]),
    decision_checks: [
      'Translate raw bodies into football depth buckets: core/probable starter, rotation, depth or special teams, development/no public sample, and unknown.',
      'When moving salary out, name the actual position room that weakens and whether the remaining names are playable contributors or just roster/cap rows.',
      'Use scorecard coverage and role notes where available before calling a room deep, thin, or replaceable.',
    ],
    boundaries: [
      'Raw row counts are inventory, not playable depth.',
      'If the evidence only gives row counts, say the depth conclusion still needs role/quality validation.',
    ],
    source_refs: refsForDatasets(args, ['nfl_rosters_current', 'nfl_player_metrics_current', 'nfl_coverage_current', 'nfl_trade_screen_current']),
  });
}

function tradePriceDiscipline(args: BuildNflDecisionPrimitivesArgs): NflDecisionPrimitive | null {
  if (!args.intentTags.includes('trade')) return null;
  const tradeRows = rowsForDataset(args.rowsByRef, 'nfl_trade_screen_current');
  const intelRows = rowsForDataset(args.rowsByRef, 'nfl_context_graph');
  return primitive(args, 'trade_price_discipline', {
    facts: compactRows([
      valueFact(tradeRows, 'Seller thesis cards'),
      valueFact(tradeRows, 'Counterparty seller summaries'),
      valueFact(tradeRows, 'Required answer checks'),
      valueFact(intelRows, 'Seller thesis summaries'),
    ]),
    decision_checks: [
      'Any recommended call needs a price boundary, seller reason, seller objection, and availability validation trigger.',
      'Default price posture: check-call rentals live in conditional/day-three territory unless role fit and seller thesis justify more.',
      'Monitor-only or posture-change targets should be described as watch lanes, not priced acquisitions.',
    ],
    boundaries: [
      'Cap fit is not availability.',
      'Do not imply an exact asking price, final trade value, medical clearance, or seller intent unless supplied by authoritative private data.',
    ],
    source_refs: refsForDatasets(args, ['nfl_trade_screen_current', 'nfl_context_graph']),
  });
}

function roleFitLens(args: BuildNflDecisionPrimitivesArgs): NflDecisionPrimitive | null {
  if (!args.intentTags.includes('player_quality') && !args.intentTags.includes('trade') && !/\b(upgrade|need|fit|trust|spend)\b/i.test(args.question)) {
    return null;
  }
  const metricRows = rowsForDataset(args.rowsByRef, 'nfl_player_metrics_current');
  const coverageRows = rowsForDataset(args.rowsByRef, 'nfl_coverage_current');
  return primitive(args, 'role_fit', {
    facts: compactRows([
      valueFact(metricRows, 'Metric coverage'),
      valueFact(metricRows, 'Top position scorecards'),
      valueFact(coverageRows, 'Readiness'),
      valueFact(coverageRows, 'Position groups'),
    ]),
    decision_checks: roleFitChecks(args.focusGroups),
    boundaries: [
      'Do not turn cap hit, roster membership, or snap volume alone into player quality.',
      'If public scorecards are directional or missing for the named player/group, phrase role fit as a validation question rather than a settled grade.',
    ],
    source_refs: refsForDatasets(args, ['nfl_player_metrics_current', 'nfl_coverage_current']),
  });
}

function benchmarkContext(args: BuildNflDecisionPrimitivesArgs): NflDecisionPrimitive | null {
  if (!/\b(over[-\s]?invest(?:ed|ment)?|under[-\s]?invest(?:ed|ment)?|spend share|league average|relative|rank|audit|allocation|heaviest|cost center|benchmark)\b/i.test(args.question)) {
    return null;
  }
  const capRows = rowsForDataset(args.rowsByRef, 'nfl_cap_sheets_current');
  const coverageRows = rowsForDataset(args.rowsByRef, 'nfl_coverage_current');
  return primitive(args, 'benchmark_context', {
    facts: compactRows([
      valueFact(capRows, 'Position-group cap rollups'),
      valueFact(capRows, 'Top cap contracts'),
      valueFact(coverageRows, 'Position groups'),
      valueFact(coverageRows, 'Readiness'),
    ]),
    decision_checks: [
      'Before saying overinvested or underinvested, compare the group to the current file: team spend share, concentration among top contracts, and available league/team benchmark context.',
      'Separate cap allocation from player quality; heavy spend is not automatically bad if the scorecards/roles justify it.',
      'If no league benchmark is loaded, say the conclusion is a team-internal concentration read rather than a league-relative verdict.',
    ],
    boundaries: [
      'Do not call a group overinvested from raw dollars alone.',
      'Do not imply league rank or percentile unless the current evidence actually supports it.',
    ],
    source_refs: refsForDatasets(args, ['nfl_cap_sheets_current', 'nfl_coverage_current']),
  });
}

function decisionConfidenceSynthesizer(
  args: BuildNflDecisionPrimitivesArgs,
  primitives: NflDecisionPrimitive[],
): NflDecisionPrimitive {
  const hasTrade = primitives.some((item) => item.key === 'trade_price_discipline');
  const hasRoleFit = primitives.some((item) => item.key === 'role_fit');
  const hasCap = primitives.some((item) => item.key === 'cap_scenario_ladder');
  return primitive(args, 'decision_confidence', {
    facts: compactRows([
      'Firm: current roster/cap membership, cap figures, contract fields, and coverage readiness from loaded app data.',
      hasRoleFit ? 'Directional: public scorecards support position-specific quality only where loaded; OL is continuity/availability unless a reviewed OL quality source exists.' : null,
      hasTrade ? 'Validation-required: seller availability, asking price, medicals, and role with the acquiring club.' : null,
      hasCap ? 'Do-not-claim: 2027-clean paths that depend on new money, extension, or restructure assumptions.' : null,
    ]),
    decision_checks: [
      'Let the final recommendation be strongest where facts are firm, narrower where evidence is directional, and explicit about what staff must validate before action.',
      'Use caveats surgically: limit unsupported parts without refusing the whole question when current app data supports the core analysis.',
    ],
    boundaries: [
      'No public numeric confidence score.',
      'Do not expose these primitive labels unless the user asks how the answer was produced.',
    ],
    source_refs: [...new Set(primitives.flatMap((item) => item.source_refs))],
  });
}

function roleFitChecks(focusGroups: string[]): string[] {
  const groups = focusGroups.length ? focusGroups : ['QB', 'WR/TE/RB', 'DL/EDGE/LB', 'DB', 'OL'];
  const checks: string[] = [];
  if (groups.some((group) => group === 'DL' || group === 'EDGE/LB' || group === 'LB')) {
    checks.push('For DL/EDGE/LB, ground disruptive or pressure claims in pressures, hurries, sacks, TFL, role, snap share, or say the public evidence is directional.');
  }
  if (groups.some((group) => group === 'CB' || group === 'S')) {
    checks.push('For DBs, ground coverage claims in targets, completions, yards, rating, missed tackles, availability, or narrow the claim to cap/role.');
  }
  if (groups.some((group) => ['WR', 'TE', 'RB'].includes(group))) {
    checks.push('For WR/TE/RB, ground quality claims in usage, targets/touches, YAC, separation/cushion, production, or state the gap.');
  }
  if (groups.includes('OL')) {
    checks.push('For OL, use continuity, starts/snaps, and availability only unless a reviewed pressure-allowed/pass-blocking source is loaded.');
  }
  if (groups.includes('QB')) {
    checks.push('For QB, ground quality claims in available passing/efficiency scorecards and separate public evidence from staff evaluation.');
  }
  return checks.length ? checks : ['Use position-specific public scorecards before making role-fit or quality claims.'];
}

function primitive(
  args: BuildNflDecisionPrimitivesArgs,
  key: NflDecisionPrimitiveKey,
  seed: PrimitiveSeed,
): NflDecisionPrimitive {
  return {
    key,
    applies: true,
    facts: compactRows(seed.facts ?? []),
    decision_checks: compactRows(seed.decision_checks ?? []),
    boundaries: compactRows(seed.boundaries ?? []),
    source_refs: seed.source_refs?.length ? seed.source_refs : refsForDatasets(args, []),
  };
}

function rowsForDataset(rowsByRef: Map<number, NflPrimitiveSourceRow[]>, datasetId: string): NflPrimitiveSourceRow[] | null {
  return [...rowsByRef.values()].find((rows) => valueFor(rows, 'Dataset') === datasetId) ?? null;
}

function refsForDatasets(args: BuildNflDecisionPrimitivesArgs, datasetIds: string[]): string[] {
  const refs = [...args.rowsByRef.entries()]
    .filter(([, rows]) => datasetIds.length === 0 || datasetIds.includes(valueFor(rows, 'Dataset') ?? ''))
    .map(([ref, rows]) => {
      const dataset = valueFor(rows, 'Dataset') ?? valueFor(rows, 'Label') ?? 'unknown';
      const team = valueFor(rows, 'Team') ?? valueFor(rows, 'Teams') ?? 'bounded';
      return `${args.refsAreReserved ? `[${ref}]` : `trace ${ref}:`} ${dataset} (${team})`;
    });
  return refs;
}

function valueFact(rows: NflPrimitiveSourceRow[] | null, key: string, max = 340): string | null {
  if (!rows) return null;
  const value = valueFor(rows, key);
  return value ? `${key}: ${truncate(value, max)}` : null;
}

function valueFor(rows: NflPrimitiveSourceRow[], key: string): string | null {
  return rows.find((row) => row.k === key)?.v ?? null;
}

function compactRows(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(0, 6);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
