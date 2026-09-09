import type { BriefSource, DataAnalysisBriefBody, NflHistoricalSelection, NflTransactionMarketAnalysis } from '@shared/types';
import { factualBody, type NflFactualQuery, type NflRosterNumericFilter, type NflRosterNumericField } from '@shared/nflFacts';
import { factualPackageAnswer } from '@shared/nflAnswerDepth';
import { nflTransactionTradePackageLines } from '@shared/nflTransactionMarket';
import { loadCurrentNflDataWithMode, type NflCapRow, type NflDemoSeed, type NflPlayerMetricRow, type NflRosterEntry } from '../nfl_data/seed.js';
import { positionGroupsFromQuestion, teamIdsFromQuestion } from '../nfl_transactions/question.js';
import { loadCurrentNflTransactionMarketSnapshot } from '../nfl_transactions/seed.js';
import { analyzeNflTransactionMarket } from '../nfl_transactions/analyze.js';
import { createClaudeMessage, BRIEF_MODEL } from '../claude/client.js';
import { isHistoricalRecordQuestion, selectHistoricalRecords } from '../nfl_transactions/historical_selection.js';
import { applyRosterConstraints, numericFilterLabel, numericMatches } from './constraints.js';
import { SNAP_SOURCE } from '../nfl_data/starts.js';

export interface FactualAnswer {
  body: DataAnalysisBriefBody;
  sources: Array<Omit<BriefSource, 'id' | 'brief_id'>>;
}

const baseQuery = (): NflFactualQuery => ({
  kind: 'roster', team_ids: ['NYG'], player_names: [], position_groups: [], exclude_nyg: false,
  veterans_only: false, limit: 12, sort: 'name', transaction: 'none', post_june: true,
  hypothetical_unavailable: false, max_cap: null, min_starts: null,
});

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const dollars = (value: number | null | undefined) => value == null ? 'Not recorded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const number = (value: number | null | undefined) => value == null ? 'Not recorded' : value.toLocaleString();

function factualPositionGroup(position: string | null): NflFactualQuery['position_groups'][number] | null {
  const p = (position ?? '').toUpperCase();
  const aliases: Record<string, NflFactualQuery['position_groups'][number]> = {
    QB: 'QB', RB: 'RB', FB: 'RB', HB: 'RB', WR: 'WR', TE: 'TE', T: 'OT', OT: 'OT',
    G: 'IOL', OG: 'IOL', C: 'IOL', OC: 'IOL', IOL: 'IOL', EDGE: 'EDGE',
    DT: 'IDL', NT: 'IDL', IDL: 'IDL', LB: 'LB', ILB: 'LB', MLB: 'LB', CB: 'CB',
    S: 'S', SAF: 'S', FS: 'S', SS: 'S', K: 'ST', P: 'ST', LS: 'ST', ST: 'ST',
  };
  return aliases[p] ?? null;
}

function namedPlayers(question: string, rows: readonly { player_name: string }[]): string[] {
  const text = ` ${normalized(question)} `;
  const names = [...new Set(rows.map(row => row.player_name))];
  const full = names.filter(name => text.includes(` ${normalized(name)} `));
  const surnames = names.filter(name => {
    const last = normalized(name).split(' ').at(-1)!;
    return last.length >= 4 && text.includes(` ${last} `) && names.filter(other => normalized(other).split(' ').at(-1) === last).length === 1;
  });
  return [...new Set([...full, ...surnames])];
}

/** A bounded, visible selection. It never infers player quality or availability. */
export function factualQueryFromQuestion(question: string, seed: NflDemoSeed, prior: NflFactualQuery | null = null): NflFactualQuery | null {
  const inclusion = question.replace(/\b(?:exclude|excluding|except(?: for)?|without)\s+.+?(?=\s+(?:with|under|over|at least|at most|sorted|sort|ordered|order)\b|[;.!?]|$)/gi, ' ');
  const names = namedPlayers(inclusion, seed.roster_entries);
  const groups = positionGroupsFromQuestion(inclusion);
  const teams = teamIdsFromQuestion(inclusion);
  const refinement = /^(?:only|filter|sort|order|now|instead|show (?:me )?(?:those|their)|what about|and|with|under|over|at least|at most|exclude|excluding|except|without|remove|drop|ignore|clear|make (?:that|it))\b/i.test(question);
  const semantic = /\b(?:roster|players?|linemen|linebackers?|receivers?|cornerbacks?|safeties|quarterbacks?|running backs?|snaps?|starts?|games?|age|youngest|oldest|cap|contracts?|salary|salaries|cash|veterans?|unavailable|injur(?:y|ed)|releas(?:e|ing)|restructure)\b/i.test(question);
  if (!names.length && !groups.length && !semantic && !(prior && refinement)) return null;
  const query = prior && refinement ? structuredClone(prior) : baseQuery();
  if (names.length) { query.player_names = names; query.team_ids = []; query.exclude_nyg = false; }
  if (groups.length) query.position_groups = groups;
  if (teams.length && !names.length) query.team_ids = teams;
  if (/\b(?:acquire|add|acquisition|targets?|other teams|trade for|investigate)\b/i.test(question) && groups.length && !names.length) {
    query.team_ids = []; query.exclude_nyg = true;
  }
  if (/\b(?:other (?:nfl )?teams|outside (?:the )?(?:giants|nyg))\b/i.test(question)) { query.team_ids = []; query.exclude_nyg = true; }
  if (/\b(?:leaguewide|league-wide|across (?:the )?(?:nfl|league)|all (?:nfl )?teams|all nfl players)\b/i.test(question)) { query.team_ids = []; query.exclude_nyg = false; }
  if (/\bveterans?\b/i.test(question)) query.veterans_only = true;
  if (/\b(?:unavailable|injur(?:y|ed)|missing time|limited|knee)\b/i.test(question) && /\b(?:if|hypothetical|assume|suppose)\b/i.test(question)) {
    query.hypothetical_unavailable = true;
    query.hypothetical_player_names = names;
    if (names.length && /\b(?:roles?|cover|receivers?|receiving|targets?|replacements?)\b/i.test(question)) {
      const subjects = seed.roster_entries.filter(r => names.includes(r.player_name));
      query.player_names = [];
      query.team_ids = [...new Set(subjects.map(r => r.team_id))];
      query.position_groups = [...new Set(subjects.map(r => factualPositionGroup(r.position)))].filter(Boolean) as NflFactualQuery['position_groups'];
      if (/\b(?:targets?|trade for|acquire|other teams)\b/i.test(question)) { query.team_ids = []; query.exclude_nyg = true; }
    }
  }
  if (/\b(?:cut|release|releasing)\b/i.test(question)) query.transaction = 'release';
  if (/\brestructur(?:e|ing)\b/i.test(question)) query.transaction = 'restructure';
  if (/\btrad(?:e|ing)\b/i.test(question) && names.length && /\b(?:cap|money|save|savings)\b/i.test(question)) query.transaction = 'trade';
  if (/\b(?:before|pre[- ]?)\s*june\s*1\b/i.test(question)) query.post_june = false;
  if (/\b(?:after|post[- ]?)\s*june\s*1\b/i.test(question)) query.post_june = true;
  const limit = question.match(/\b(?:show|list|first|top|include|which)\s+(?:me\s+)?(\d{1,2}|three|five|ten)\b/i);
  if (limit) query.limit = Math.max(1, Math.min(50, Number(limit[1]) || ({ three: 3, five: 5, ten: 10 } as Record<string, number>)[limit[1].toLowerCase()] || 12));
  if (/\ball (?:matching |the )?(?:players|records|linemen|receivers)\b/i.test(question)) query.limit = 50;
  return applyRosterConstraints(question, query, seed);
}

/** The model may resolve a question to filters, but cannot author displayed prose. */
async function planUnrecognizedQuestion(question: string, prior: NflFactualQuery | null, seed: NflDemoSeed): Promise<NflFactualQuery | null> {
  try {
    const response = await createClaudeMessage({
      model: BRIEF_MODEL, max_tokens: 600,
      system: [{ type: 'text', text: 'Translate an NFL records question into a read-only factual selection. No evaluations, recommendations, forecasts, scores, medical conclusions, assumed trade availability, or invented statistics. Only use this tool if roster/contract/2025 usage records directly answer a material part of the question. Unknown topics are unsupported. Default team NYG unless explicitly leaguewide, named elsewhere, or an acquisition search. Only carry prior scope for a clear follow-up. Never invent player names or silently replace an unknown player. Emit no prose.' }],
      tools: [{ name: 'select_records', description: 'Select available recorded facts or declare unsupported.', input_schema: { type: 'object', properties: {
        supported: { type: 'boolean' }, team_ids: { type: 'array', items: { type: 'string', enum: seed.teams.map(t => t.team_id) } },
        player_names: { type: 'array', items: { type: 'string' } }, positions: { type: 'array', items: { type: 'string', enum: ['QB','RB','WR','TE','OT','IOL','EDGE','IDL','LB','CB','S','ST'] } },
        exclude_nyg: { type: 'boolean' }, veterans_only: { type: 'boolean' },
      }, required: ['supported','team_ids','player_names','positions','exclude_nyg','veterans_only'], additionalProperties: false } }],
      tool_choice: { type: 'tool', name: 'select_records', disable_parallel_tool_use: true },
      messages: [{ role: 'user', content: JSON.stringify({ question, previous_selection: prior }) }],
    }, { timeout: 12_000, maxRetries: 0 });
    const block = response.content.find(b => b.type === 'tool_use' && b.name === 'select_records');
    if (block?.type !== 'tool_use' || !block.input || typeof block.input !== 'object') return null;
    const input = block.input as Record<string, unknown>;
    if (input.supported !== true) return null;
    const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string') ? v as string[] : [];
    const names = strings(input.player_names);
    if (names.some(name => !normalized(question).includes(normalized(name)))) return null;
    if (names.some(name => !seed.roster_entries.some(r => normalized(r.player_name) === normalized(name)))) return null;
    const teams = strings(input.team_ids);
    if (teams.some(id => !seed.teams.some(t => t.team_id === id))) return null;
    const positions = strings(input.positions);
    if (positions.some(p => !['QB','RB','WR','TE','OT','IOL','EDGE','IDL','LB','CB','S','ST'].includes(p))) return null;
    return applyRosterConstraints(question, { ...baseQuery(), team_ids: teams, player_names: names, position_groups: positions as NflFactualQuery['position_groups'], exclude_nyg: input.exclude_nyg === true, veterans_only: input.veterans_only === true }, seed);
  } catch { return null; }
}

export async function buildNflFactualAnswer(question: string, prior: NflFactualQuery | null = null, market: NflTransactionMarketAnalysis | null = null, historical: NflHistoricalSelection | null = null): Promise<FactualAnswer> {
  if (market && historical?.years.length === 1 && /\bsame (?:period|years|window)\b/i.test(question)) return {
    body: factualBody({ answer: `These trades cover ${historical.years[0]} only. Choose at least two years to compare periods.`, key_findings: [], tables: [], calculations: [], caveats: [historical.summary], followups: [`Compare ${positionGroupsFromQuestion(question).join(' with ') || 'EDGE with IOL'} from ${market.query.start_year} through ${market.query.end_year}.`], market_analysis: market, historical_selection: historical, answer_layout: 'trade_packages' }), sources: [],
  };
  if (isHistoricalRecordQuestion(question, Boolean(market), Boolean(historical))) {
    const analysis = market ?? await analyzeNflTransactionMarket({ analysis_mode: 'comparables', start_year: 2016, end_year: 2025, position_groups: positionGroupsFromQuestion(question), transaction_types: ['trade'] }, { loadSnapshot: loadCurrentNflTransactionMarketSnapshot });
    return historicalPackageAnswer(question, analysis, historical);
  }
  const loaded = await loadCurrentNflDataWithMode();
  const query = factualQueryFromQuestion(question, loaded.seed, prior)
    ?? await planUnrecognizedQuestion(question, prior, loaded.seed);
  if (!query) return unsupportedAnswer();
  const answer = rosterFactsAnswer(query, loaded.seed);
  if (loaded.source_mode !== 'supabase_current_views') answer.body.caveats.unshift(`These records come from the saved public snapshot dated ${loaded.seed.as_of_date}; current database views were not used.`);
  return answer;
}

export function rosterFactsAnswer(query: NflFactualQuery, seed: NflDemoSeed): FactualAnswer {
  if (query.unresolved_constraints?.length) return {
    body: factualBody({
      answer: `I can’t apply ${query.unresolved_constraints.map(value => `“${value}”`).join(', ')} from these records. Please restate or remove those conditions before I return a player list.`,
      key_findings: [], tables: [], calculations: [], caveats: [], followups: [], factual_query: query,
    }), sources: [],
  };
  const caps = new Map(seed.cap_rows.filter(c => c.player_id).map(c => [`${c.team_id}:${c.player_id}`, c]));
  const metrics = new Map(seed.player_metrics.map(m => [`${m.team_id}:${m.player_id}`, m]));
  const numericFilters: NflRosterNumericFilter[] = query.numeric_filters ?? [
    ...(query.max_cap == null ? [] : [{ field: 'cap_2026', operator: 'lte', value: query.max_cap } as const]),
    ...(query.min_starts == null ? [] : [{ field: 'starts_2025', operator: 'gte', value: query.min_starts } as const]),
  ];
  const recordedValue = (row: NflRosterEntry, field: NflRosterNumericField): number | null => {
    if (field === 'age') return row.age;
    const cap = caps.get(`${row.team_id}:${row.player_id}`);
    if (field === 'cap_2026') return cap?.source_status === 'captured' ? cap.cap_number_2026 : null;
    const metric = metrics.get(`${row.team_id}:${row.player_id}`);
    if ((field === 'starts_2025' || field === 'games_2025') && metric?.source_data?.starts_2025_source) return metric[field] ?? null;
    if (field === 'snaps_2025' && metric?.source_data?.snaps_2025_source) return metric.snaps_2025 ?? null;
    return metric?.source_status === 'captured' ? metric[field] ?? null : null;
  };
  const missingNames = query.player_names.filter(name => !seed.roster_entries.some(r => normalized(r.player_name) === normalized(name)));
  const candidates = seed.roster_entries.filter(r => {
    if (query.team_ids.length && !query.team_ids.includes(r.team_id)) return false;
    if (query.exclude_nyg && r.team_id === 'NYG') return false;
    if (query.excluded_team_ids?.includes(r.team_id)) return false;
    if (query.excluded_player_names?.some(name => normalized(name) === normalized(r.player_name))) return false;
    if (query.roster_statuses?.length && !query.roster_statuses.includes(r.roster_status)) return false;
    if (query.player_names.length && !query.player_names.some(name => normalized(name) === normalized(r.player_name))) return false;
    if (query.position_groups.length && !query.position_groups.includes(factualPositionGroup(r.position) as NflFactualQuery['position_groups'][number])) return false;
    if (query.veterans_only && !(Number(r.experience) >= 1)) return false;
    return true;
  });
  const missingCap = candidates.filter(r => { const c = caps.get(`${r.team_id}:${r.player_id}`); return c?.source_status !== 'captured' || c.cap_number_2026 == null; }).length;
  const missingStarts = candidates.filter(r => recordedValue(r, 'starts_2025') == null).length;
  const matched = candidates.filter(r => numericFilters.every(filter => numericMatches(recordedValue(r, filter.field), filter)));
  const sortField: NflRosterNumericField | null = query.sort === 'name' ? null : query.sort.startsWith('receiving_yards') ? 'receiving_yards_2025' : query.sort.startsWith('age') ? 'age' : query.sort.startsWith('cap') ? 'cap_2026' : query.sort.startsWith('snaps') ? 'snaps_2025' : query.sort.startsWith('games') ? 'games_2025' : 'starts_2025';
  const sortValue = (r: NflRosterEntry): number | null => sortField ? recordedValue(r, sortField) : null;
  matched.sort((a, b) => {
    if (query.sort !== 'name') { const av = sortValue(a), bv = sortValue(b); if (av == null && bv != null) return 1; if (bv == null && av != null) return -1; if (av != null && bv != null && av !== bv) return query.sort.endsWith('_asc') ? av - bv : bv - av; }
    return a.player_name.localeCompare(b.player_name) || a.team_id.localeCompare(b.team_id);
  });
  const requiredFields = [...new Set([...numericFilters.map(filter => filter.field), ...(sortField ? [sortField] : [])])];
  const unavailableFields = candidates.length ? requiredFields.filter(field => candidates.every(row => recordedValue(row, field) == null)) : [];
  const rows = unavailableFields.length ? [] : matched.slice(0, query.limit);
  const includeAge = numericFilters.some(filter => filter.field === 'age') || query.sort.startsWith('age');
  const sources: FactualAnswer['sources'] = [];
  const addSource = (r: NflRosterEntry, cap: NflCapRow | undefined, metric: NflPlayerMetricRow | undefined) => {
    const ref = sources.length + 1;
    const usageUrls = Array.isArray(metric?.source_data?.source_urls) ? metric.source_data.source_urls as string[] : [];
    const snapSource = metric?.snaps_2025 != null ? usageUrls.find(url => /\/snap_counts\/snap_counts_2025\.csv$/.test(url)) ?? (metric.metric_families?.includes('nflverse_snap_counts') ? SNAP_SOURCE : null) : null;
    sources.push({ ref_index: ref, kind: 'ROSTER', source: 'Public roster and recorded contract / usage data', title: `${r.player_name} · ${r.team_id}`, updated_at: seed.as_of_date, data: {
      source_url: r.source_url ?? seed.source_url,
      contribution: 'Roster identity and status, contract figures and recorded 2025 usage; each source is linked separately.',
      rows: [ { k: 'Roster as of', v: seed.as_of_date }, { k: 'Roster source', v: r.source_url ?? 'Not recorded' },
        { k: 'Contract source', v: cap?.source_url ?? 'Not recorded' }, { k: '2025 snap-count source', v: snapSource ?? 'Not recorded' },
        ...(metric?.source_data?.starts_2025_source ? [
          { k: 'Games and starts source (2025 regular season)', v: String((metric.source_data.starts_2025_source as { source_url: string }).source_url) },
          { k: 'Game log captured', v: String((metric.source_data.starts_2025_source as { captured_at: string }).captured_at) },
          { k: '2025 regular-season games / starts', v: `${metric.games_2025} / ${metric.starts_2025}` },
        ] : []),
        ...(!metric?.source_data?.starts_2025_source ? [{ k: 'Other 2025 usage sources', v: metric?.source_url ?? 'Not recorded' }] : []),
        { k: 'Roster status', v: r.roster_status }, { k: 'Contract source status', v: cap?.source_status ?? 'Not recorded' }, { k: 'Usage source status', v: metric?.source_status ?? 'Not recorded' } ],
      ...(metric?.source_data?.starts_2025_source ? { regular_season_game_log: metric.source_data.starts_2025_source } : {}),
    } });
    return ref;
  };
  const refs: number[] = [];
  const records = rows.map(r => {
    const cap = caps.get(`${r.team_id}:${r.player_id}`); const metric = metrics.get(`${r.team_id}:${r.player_id}`);
    refs.push(addSource(r, cap, metric));
    const c = cap?.source_status === 'captured' ? cap : undefined;
    const base = [r.player_name, r.team_id, r.position ?? 'Not recorded', r.roster_status, dollars(c?.cap_number_2026), number(recordedValue(r, 'starts_2025')), number(recordedValue(r, 'snaps_2025')), ...(includeAge ? [number(r.age)] : []), number(recordedValue(r, 'games_2025'))];
    if (query.transaction !== 'none') {
      const effect = transactionValues(c, query);
      base.push(dollars(effect.savings), dollars(effect.dead));
    }
    return base;
  });
  const sortLabel = ({ name: 'player name (A–Z)', receiving_yards_desc: 'recorded 2025 receiving yards, highest first', receiving_yards_asc: 'recorded 2025 receiving yards, lowest first', cap_asc: '2026 cap number, lowest first', cap_desc: '2026 cap number, highest first', snaps_desc: 'recorded 2025 snaps, highest first', snaps_asc: 'recorded 2025 snaps, lowest first', starts_desc: 'recorded 2025 starts, highest first', starts_asc: 'recorded 2025 starts, lowest first', games_desc: 'recorded 2025 games, highest first', games_asc: 'recorded 2025 games, lowest first', age_asc: 'recorded age, youngest first', age_desc: 'recorded age, oldest first' } as const)[query.sort];
  const scope = [query.team_ids.join(', ') || 'all loaded NFL teams', query.exclude_nyg ? 'excluding NYG' : '', query.position_groups.join(', '), query.veterans_only ? 'at least one recorded year of NFL experience' : '', ...numericFilters.map(numericFilterLabel), query.excluded_team_ids?.length ? `excluding ${query.excluded_team_ids.join(', ')}` : '', query.excluded_player_names?.length ? `excluding ${query.excluded_player_names.join(', ')}` : '', query.roster_statuses?.join(', ')].filter(Boolean).join(' · ');
  const caveats = [
    'Roster and contract records do not establish trade availability, asking prices, football fit or a recommended order of contact.',
    'Usage is recorded for the 2025 season. It is not a projection of 2026 role or health. Missing values are not zero.',
  ];
  const fieldLabels = { receiving_yards_2025: 'recorded 2025 receiving yards', age: 'recorded age', cap_2026: 'a captured 2026 cap number', starts_2025: 'recorded 2025 starts', snaps_2025: 'recorded 2025 snaps', games_2025: 'recorded 2025 games' };
  const coverageGaps = [...new Set(numericFilters.map(filter => filter.field))].flatMap(field => {
    const missing = candidates.filter(row => recordedValue(row, field) == null).length;
    return missing ? [`${missing} of ${candidates.length} cohort records lack ${fieldLabels[field]}`] : [];
  });
  const missingSortValues = query.sort === 'name' ? 0 : matched.filter(row => sortValue(row) == null).length;
  if (coverageGaps.length) caveats.unshift(`${coverageGaps.join('; ')}. Those records cannot be tested against the requested numeric filters and are excluded from the result.`);
  if (missingSortValues && rows.length) caveats.unshift(`${missingSortValues} of ${matched.length} matching players lack the field used for ordering; those players appear after the recorded values.`);
  if (!sources.length) sources.push({ ref_index: 1, kind: 'ROSTER', source: seed.source_name, title: 'Roster selection and data coverage', updated_at: seed.as_of_date, data: {
    source_url: seed.source_url, contribution: 'Defines the loaded roster cohort and the missing fields excluded by this selection.', rows: [
      { k: 'Cohort before numeric filters', v: String(candidates.length) }, { k: 'Missing captured cap number', v: String(missingCap) }, { k: 'Missing recorded 2025 starts', v: String(missingStarts) },
    ],
  } });
  if (!refs.length) refs.push(1);
  if (query.position_groups.length) caveats.push('Position filters use recorded roster labels and explicit aliases (for example, guard and center map to IOL). Generic DE, OLB, DB and OL labels are not reassigned to a more specific role.');
  if (query.hypothetical_unavailable) caveats.unshift('Player unavailability is a user-supplied hypothetical. The records do not establish a medical condition, a return date, current role assignments or replacement suitability. Staff would need current assignments and availability to assess coverage.');
  if (query.transaction !== 'none') caveats.unshift(query.transaction === 'restructure'
    ? 'Restructure savings are a recorded estimate, conditional on contract terms and execution; player agreement and the future-year allocation are not established here.'
    : `Scenario: ${query.post_june ? 'actually processed after June 1' : 'processed before June 1'}. Figures are the recorded contract calculation, not a team cap-space reconciliation; replacement costs and later transactions are not included.`);
  if (missingNames.length) caveats.push(`No exact roster record was found for: ${missingNames.join(', ')}.`);
  return { body: factualBody({
    answer: unavailableFields.length
      ? `I can’t apply ${[...numericFilters.filter(filter => unavailableFields.includes(filter.field)).map(numericFilterLabel), ...(sortField && unavailableFields.includes(sortField) ? [`ordering by ${sortLabel}`] : [])].join(' and ')}: none of the ${candidates.length} players in this group have ${unavailableFields.map(field => fieldLabels[field]).join(' or ')}. No player list was selected.`
      : rows.length ? `${query.hypothetical_unavailable ? `If ${(query.hypothetical_player_names ?? []).join(', ') || 'the player'} is unavailable, current role assignments would be needed to assess coverage. ` : ''}${matched.length.toLocaleString()} players match${rows.length < matched.length ? `; showing ${rows.length}` : ''}, ordered by ${sortLabel}. Roster as of ${seed.as_of_date}; usage from 2025.` : `No matches in the ${seed.as_of_date} roster data.${coverageGaps.length ? ` ${coverageGaps.join('; ')}; players missing those figures could not be included.` : ''}`,
    key_findings: [{ label: 'Filters', body: scope, source_refs: refs }],
    tables: records.length ? [{ title: query.transaction === 'none' ? 'Roster, contracts and usage' : `${query.transaction[0].toUpperCase()}${query.transaction.slice(1)} cap effect`, columns: ['Player','Team','Position','Status','2026 cap','2025 starts','2025 snaps', ...(includeAge ? ['Age'] : []),'2025 games', ...(query.transaction === 'none' ? [] : ['2026 savings','2026 dead money'])], rows: records, source_refs: refs }] : [],
    population: {eligible_count:candidates.length,matched_count:matched.length,displayed_count:rows.length,selection_basis:scope+'; ordered by '+sortLabel,missing_fields:coverageGaps,complete:rows.length===matched.length},
    calculations: [], caveats, followups: rows.length ? ['Sort by most 2025 starts.', 'Only include players with at least 10 starts.'] : [], factual_query: query,
  }), sources };
}

function transactionValues(cap: NflCapRow | undefined, query: NflFactualQuery) {
  if (!cap || cap.contract_ledger_status !== 'captured') return { savings: null, dead: null };
  if (query.transaction === 'restructure') return { savings: cap.restructure_savings_estimate_2026, dead: null };
  if (query.transaction === 'trade') return query.post_june ? { savings: cap.post_june_1_trade_savings_2026, dead: cap.post_june_1_trade_dead_money_2026 } : { savings: cap.trade_savings_2026, dead: cap.trade_dead_money_2026 };
  return query.post_june ? { savings: cap.post_june_1_cut_savings_2026, dead: cap.post_june_1_dead_money_2026 } : { savings: cap.cut_savings_2026, dead: cap.dead_money_if_cut_2026 };
}

export function historicalPackageAnswer(question: string, market: NflTransactionMarketAnalysis, prior: NflHistoricalSelection | null = null): FactualAnswer {
  const { rows, selection, evidence } = selectHistoricalRecords(question, market, prior);
  const sources = rows.map((row, index): FactualAnswer['sources'][number] => ({
    ref_index: index + 1, kind: 'TRANSACTION', source: 'Recorded NFL transaction package', title: `${row.player_name} · ${row.event_year}`, updated_at: row.event_date ?? `${row.event_year}-01-01`, data: {
      source_url: (market.source_refs.find(s => s.id === 'trades' && row.source_ref_ids.includes(s.id))
        ?? market.source_refs.find(s => row.trade_package?.assets.some(a => a.source_ref_id === s.id)))?.url,
      transaction_event_id: row.event_id, contribution: 'Recorded assets on both sides of this trade.', trade_package: row.trade_package,
      rows: [{ k: 'Date', v: row.event_date ?? String(row.event_year) }, ...nflTransactionTradePackageLines(row).map(v => ({ k: 'Recorded asset', v }))],
    },
  }));
  return { body: factualPackageAnswer(factualBody({
    answer_layout: 'trade_packages',
    answer: '',
    key_findings: [{ label: 'Selection', body: selection.summary, source_refs: rows.map((_, index) => index + 1) }],
    tables: [], calculations: [], caveats: [evidence.summary, 'Multi-player deals remain in the record but are excluded from per-player draft-return percentages because the compensation is not allocated to individual players. Historical packages do not establish a current asking price.'], followups: rows.length ? [selection.pick_rounds.length ? 'Show the complete trade packages.' : 'Only include trades returning a first-round pick.', selection.years.length ? `Compare ${market.query.position_groups[0] || 'EDGE'} with ${market.query.position_groups[0] === 'IOL' ? 'EDGE' : 'IOL'} over the same period.` : `Only ${market.query.end_year}.`] : ['Show the complete trade packages.'], market_analysis: market, historical_selection: selection,
  })), sources };
}

export function unsupportedAnswer(): FactualAnswer {
  return { body: factualBody({ answer: 'I don’t have enough information to answer that. Specify a player, position, team, statistic or transaction rule.', key_findings: [], tables: [], calculations: [], caveats: ['Available records cover public roster and contract figures, recorded 2025 usage, historical transactions and cited NFL rules. Staff evaluations, medical records and current asking prices are not connected.'], followups: ['Show the Giants wide receiver contracts.', 'Show veteran interior offensive linemen on other teams.'] }), sources: [] };
}
