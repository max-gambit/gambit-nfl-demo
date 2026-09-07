import type { BriefSource, DataAnalysisBriefBody, NflTransactionMarketAnalysis } from '@shared/types';
import { factualBody, type NflFactualQuery } from '@shared/nflFacts';
import { nflTransactionMarketCohortEvidence, nflTransactionTradePackageLines } from '@shared/nflTransactionMarket';
import { loadCurrentNflDataWithMode, type NflCapRow, type NflDemoSeed, type NflPlayerMetricRow, type NflRosterEntry } from '../nfl_data/seed.js';
import { positionGroupsFromQuestion, teamIdsFromQuestion } from '../nfl_transactions/question.js';
import { loadCurrentNflTransactionMarketSnapshot } from '../nfl_transactions/seed.js';
import { analyzeNflTransactionMarket } from '../nfl_transactions/analyze.js';
import { createClaudeMessage, BRIEF_MODEL } from '../claude/client.js';

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
  const names = namedPlayers(question, seed.roster_entries);
  const groups = positionGroupsFromQuestion(question);
  const teams = teamIdsFromQuestion(question);
  const refinement = /^(?:only|filter|sort|order|now|instead|show (?:me )?(?:those|their)|what about|and |with |under |over |at least|make (?:that|it))\b/i.test(question);
  const semantic = /\b(?:roster|players?|linemen|linebackers?|receivers?|cornerbacks?|safeties|quarterbacks?|running backs?|snaps?|starts?|cap|contracts?|salary|salaries|cash|veterans?|unavailable|injur(?:y|ed)|releas(?:e|ing)|restructure)\b/i.test(question);
  if (!names.length && !groups.length && !semantic && !(prior && refinement)) return null;
  const query = prior && refinement ? structuredClone(prior) : baseQuery();
  if (names.length) { query.player_names = names; query.team_ids = []; query.exclude_nyg = false; }
  if (groups.length) query.position_groups = groups;
  if (teams.length && !names.length) query.team_ids = teams;
  if (/\b(?:acquire|add|acquisition|targets?|other teams|trade for|investigate)\b/i.test(question) && groups.length && !names.length) {
    query.team_ids = []; query.exclude_nyg = true;
  }
  if (/\b(?:leaguewide|league-wide|across the (?:nfl|league)|all teams)\b/i.test(question)) { query.team_ids = []; query.exclude_nyg = false; }
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
  if (/\b(?:lowest|smallest|ascending)\b.*\bcap\b|\bcap\b.*\b(?:lowest|ascending)\b/i.test(question)) query.sort = 'cap_asc';
  if (/\b(?:highest|largest|biggest|most|descending)\b.*\bcap\b|\bcap\b.*\b(?:highest|descending)\b/i.test(question)) query.sort = 'cap_desc';
  if (/\b(?:most|highest|sort|order)\b.*\bsnaps?\b/i.test(question)) query.sort = 'snaps_desc';
  if (/\b(?:most|highest|sort|order)\b.*\bstarts?\b/i.test(question)) query.sort = 'starts_desc';
  if (/\balphabetical\b/i.test(question)) query.sort = 'name';
  const limit = question.match(/\b(?:show|list|first|top|include|which)\s+(?:me\s+)?(\d{1,2}|three|five|ten)\b/i);
  if (limit) query.limit = Math.max(1, Math.min(50, Number(limit[1]) || ({ three: 3, five: 5, ten: 10 } as Record<string, number>)[limit[1].toLowerCase()] || 12));
  if (/\ball (?:matching |the )?(?:players|records|linemen|receivers)\b/i.test(question)) query.limit = 50;
  const cap = question.match(/\b(?:under|below|less than|at most)\s*\$?([\d.]+)\s*(m(?:illion)?|k|thousand)?\b/i);
  if (cap && /\bcap\b/i.test(question)) query.max_cap = Number(cap[1]) * (/^m/i.test(cap[2] ?? '') ? 1e6 : /^(k|thousand)/i.test(cap[2] ?? '') ? 1e3 : 1);
  const starts = question.match(/\b(?:at least|minimum(?: of)?)\s+(\d{1,2})\s+starts?\b/i);
  if (starts) query.min_starts = Number(starts[1]);
  return query;
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
    return { ...baseQuery(), team_ids: teams, player_names: names, position_groups: positions as NflFactualQuery['position_groups'], exclude_nyg: input.exclude_nyg === true, veterans_only: input.veterans_only === true };
  } catch { return null; }
}

export async function buildNflFactualAnswer(question: string, prior: NflFactualQuery | null = null, market: NflTransactionMarketAnalysis | null = null): Promise<FactualAnswer> {
  if (/\b(?:parsons|chubb|excluded|multi[- ]player|whole package|both sides)\b/i.test(question) && /\b(?:trades?|deals?|packages?|exclud(?:e|ed)|included|prices?|compensation|assets?)\b/i.test(question)) {
    const analysis = market ?? await analyzeNflTransactionMarket({ analysis_mode: 'comparables', start_year: 2016, end_year: 2025, position_groups: ['EDGE'], transaction_types: ['trade'] }, { loadSnapshot: loadCurrentNflTransactionMarketSnapshot });
    const found = historicalPackageAnswer(question, analysis);
    if (found) return found;
    return { body: factualBody({ answer: `No matching named trade record was found in the ${analysis.query.start_year}–${analysis.query.end_year} ${analysis.query.position_groups.join(', ')} cohort. The question has not been converted to current roster records.`, key_findings: [], tables: [], calculations: [], caveats: ['The executed historical scope may exclude a requested player or transaction. Change the period or position filter to widen it.'], followups: [], market_analysis: analysis }), sources: [] };
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
  const caps = new Map(seed.cap_rows.filter(c => c.player_id).map(c => [`${c.team_id}:${c.player_id}`, c]));
  const metrics = new Map(seed.player_metrics.map(m => [`${m.team_id}:${m.player_id}`, m]));
  const missingNames = query.player_names.filter(name => !seed.roster_entries.some(r => normalized(r.player_name) === normalized(name)));
  const candidates = seed.roster_entries.filter(r => {
    if (query.team_ids.length && !query.team_ids.includes(r.team_id)) return false;
    if (query.exclude_nyg && r.team_id === 'NYG') return false;
    if (query.player_names.length && !query.player_names.some(name => normalized(name) === normalized(r.player_name))) return false;
    if (query.position_groups.length && !query.position_groups.includes(factualPositionGroup(r.position) as NflFactualQuery['position_groups'][number])) return false;
    if (query.veterans_only && !(Number(r.experience) >= 1)) return false;
    return true;
  });
  const missingCap = candidates.filter(r => { const c = caps.get(`${r.team_id}:${r.player_id}`); return c?.source_status !== 'captured' || c.cap_number_2026 == null; }).length;
  const missingStarts = candidates.filter(r => { const m = metrics.get(`${r.team_id}:${r.player_id}`); return m?.source_status !== 'captured' || m.starts_2025 == null; }).length;
  const matched = candidates.filter(r => {
    const cap = caps.get(`${r.team_id}:${r.player_id}`);
    const metric = metrics.get(`${r.team_id}:${r.player_id}`);
    if (query.max_cap != null && (cap?.source_status !== 'captured' || cap.cap_number_2026 == null || cap.cap_number_2026 > query.max_cap)) return false;
    if (query.min_starts != null && (metric?.source_status !== 'captured' || metric.starts_2025 == null || metric.starts_2025 < query.min_starts)) return false;
    return true;
  });
  const sortValue = (r: NflRosterEntry): number | null => {
    const cap = caps.get(`${r.team_id}:${r.player_id}`); const metric = metrics.get(`${r.team_id}:${r.player_id}`);
    if (query.sort.startsWith('cap')) return cap?.source_status === 'captured' ? cap.cap_number_2026 : null;
    if (metric?.source_status !== 'captured') return null;
    return query.sort === 'snaps_desc' ? metric.snaps_2025 : metric.starts_2025 ?? null;
  };
  matched.sort((a, b) => {
    if (query.sort !== 'name') { const av = sortValue(a), bv = sortValue(b); if (av == null && bv != null) return 1; if (bv == null && av != null) return -1; if (av != null && bv != null && av !== bv) return query.sort === 'cap_asc' ? av - bv : bv - av; }
    return a.player_name.localeCompare(b.player_name) || a.team_id.localeCompare(b.team_id);
  });
  const rows = matched.slice(0, query.limit);
  const sources: FactualAnswer['sources'] = [];
  const addSource = (r: NflRosterEntry, cap: NflCapRow | undefined, metric: NflPlayerMetricRow | undefined) => {
    const ref = sources.length + 1;
    sources.push({ ref_index: ref, kind: 'ROSTER', source: 'Public roster and recorded contract / usage data', title: `${r.player_name} · ${r.team_id}`, updated_at: seed.as_of_date, data: {
      source_url: r.source_url ?? seed.source_url,
      contribution: 'Roster identity and status, contract figures and recorded 2025 usage; each source is linked separately.',
      rows: [ { k: 'Roster as of', v: seed.as_of_date }, { k: 'Roster source', v: r.source_url ?? 'Not recorded' },
        { k: 'Contract source', v: cap?.source_url ?? 'Not recorded' }, { k: 'Usage source (2025 season)', v: metric?.source_url ?? 'Not recorded' },
        { k: 'Roster status', v: r.roster_status }, { k: 'Contract source status', v: cap?.source_status ?? 'Not recorded' }, { k: 'Usage source status', v: metric?.source_status ?? 'Not recorded' } ],
    } });
    return ref;
  };
  const refs: number[] = [];
  const records = rows.map(r => {
    const cap = caps.get(`${r.team_id}:${r.player_id}`); const metric = metrics.get(`${r.team_id}:${r.player_id}`);
    refs.push(addSource(r, cap, metric));
    const c = cap?.source_status === 'captured' ? cap : undefined;
    const m = metric?.source_status === 'captured' ? metric : undefined;
    const base = [r.player_name, r.team_id, r.position ?? 'Not recorded', r.roster_status, dollars(c?.cap_number_2026), number(m?.starts_2025), number(m?.snaps_2025)];
    if (query.transaction !== 'none') {
      const effect = transactionValues(c, query);
      base.push(dollars(effect.savings), dollars(effect.dead));
    }
    return base;
  });
  const sortLabel = ({ name: 'player name (A–Z)', cap_asc: '2026 cap number, lowest first', cap_desc: '2026 cap number, highest first', snaps_desc: 'recorded 2025 snaps, highest first', starts_desc: 'recorded 2025 starts, highest first' } as const)[query.sort];
  const scope = [query.team_ids.join(', ') || 'all loaded NFL teams', query.exclude_nyg ? 'excluding NYG' : '', query.position_groups.join(', '), query.veterans_only ? 'at least one recorded year of NFL experience' : '', query.max_cap == null ? '' : `2026 cap no more than ${dollars(query.max_cap)}`, query.min_starts == null ? '' : `at least ${query.min_starts} recorded 2025 starts`].filter(Boolean).join(' · ');
  const caveats = [
    'Roster and contract records do not establish trade availability, asking prices, football fit or a recommended order of contact.',
    'Usage is recorded for the 2025 season. It is not a projection of 2026 role or health. Missing values are not zero.',
  ];
  const coverageGaps = [query.max_cap != null && missingCap ? `${missingCap} of ${candidates.length} cohort records lack a captured 2026 cap number` : '', query.min_starts != null && missingStarts ? `${missingStarts} of ${candidates.length} cohort records lack recorded 2025 starts` : ''].filter(Boolean);
  if (coverageGaps.length) caveats.unshift(`${coverageGaps.join('; ')}. Those records cannot be tested against the requested numeric filters and are excluded from the result.`);
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
    answer: rows.length ? `${query.hypothetical_unavailable ? `Current role assignments are not available in these records. For the user-supplied ${(query.hypothetical_player_names ?? []).join(', ') || 'player'} unavailability scenario: ` : ''}${matched.length.toLocaleString()} matching player records. Showing ${rows.length}, ordered by ${sortLabel}. Roster snapshot: ${seed.as_of_date}; usage: 2025 season.` : `No player records satisfy these filters in the ${seed.as_of_date} snapshot.${coverageGaps.length ? ` ${coverageGaps.join('; ')}.` : ''} This does not establish that no such player exists.`,
    key_findings: [{ label: 'Selection', body: scope, source_refs: refs }],
    tables: records.length ? [{ title: query.transaction === 'none' ? 'Recorded roster, contract and usage' : `Recorded ${query.transaction} calculation`, columns: ['Player','Team','Position','Status','2026 cap','2025 starts','2025 snaps', ...(query.transaction === 'none' ? [] : ['2026 savings','2026 dead money'])], rows: records, source_refs: refs }] : [],
    calculations: [], caveats, followups: rows.length ? ['Sort by most 2025 starts.', 'Only include players with at least 10 starts.'] : [], factual_query: query,
  }), sources };
}

function transactionValues(cap: NflCapRow | undefined, query: NflFactualQuery) {
  if (!cap || cap.contract_ledger_status !== 'captured') return { savings: null, dead: null };
  if (query.transaction === 'restructure') return { savings: cap.restructure_savings_estimate_2026, dead: null };
  if (query.transaction === 'trade') return query.post_june ? { savings: cap.post_june_1_trade_savings_2026, dead: cap.post_june_1_trade_dead_money_2026 } : { savings: cap.trade_savings_2026, dead: cap.trade_dead_money_2026 };
  return query.post_june ? { savings: cap.post_june_1_cut_savings_2026, dead: cap.post_june_1_dead_money_2026 } : { savings: cap.cut_savings_2026, dead: cap.dead_money_if_cut_2026 };
}

export function historicalPackageAnswer(question: string, market: NflTransactionMarketAnalysis): FactualAnswer | null {
  const evidence = nflTransactionMarketCohortEvidence(market);
  const names = namedPlayers(question, evidence.rows);
  const rows = names.length ? evidence.rows.filter(r => names.includes(r.player_name)) : evidence.rows.filter(r => (r.trade_package?.assets.filter(a => a.asset_type === 'player').length ?? 0) > 1);
  if (!rows.length) return null;
  const sources = rows.map((row, index): FactualAnswer['sources'][number] => ({
    ref_index: index + 1, kind: 'TRANSACTION', source: 'Recorded NFL transaction package', title: `${row.player_name} · ${row.event_year}`, updated_at: row.event_date ?? `${row.event_year}-01-01`, data: {
      source_url: (market.source_refs.find(s => s.id === 'trades' && row.source_ref_ids.includes(s.id))
        ?? market.source_refs.find(s => row.trade_package?.assets.some(a => a.source_ref_id === s.id)))?.url,
      transaction_event_id: row.event_id, contribution: 'Recorded assets on both sides of this trade.', trade_package: row.trade_package,
      rows: [{ k: 'Date', v: row.event_date ?? String(row.event_year) }, ...nflTransactionTradePackageLines(row).map(v => ({ k: 'Recorded asset', v }))],
    },
  }));
  return { body: factualBody({
    answer: `${rows.length} matching player trade records in the ${market.query.start_year}–${market.query.end_year} cohort. Multi-player deals are excluded from the per-player pick-price calculation because their compensation is not allocated to individual players. They remain part of the historical record.`,
    key_findings: rows.map((row, index) => ({ label: `${row.player_name} · ${row.event_year}`, body: nflTransactionTradePackageLines(row).join('; ') || row.compensation_summary || 'Package detail is not recorded.', source_refs: [index + 1] })),
    tables: [], calculations: [], caveats: ['The single-player sample does not establish a ceiling, a player valuation, or a current asking price. Removing multi-player transactions changes the sample composition.', evidence.summary], followups: [], market_analysis: market,
  }), sources };
}

export function unsupportedAnswer(): FactualAnswer {
  return { body: factualBody({ answer: 'I could not resolve that question to a supported factual query. Specify a player, position, team, statistic or transaction rule to inspect.', key_findings: [], tables: [], calculations: [], caveats: ['Available records cover public roster and contract figures, recorded 2025 usage, historical transactions and cited NFL rules. Staff evaluations, medical records and current asking prices are not connected.'], followups: ['Show the Giants wide receiver contracts.', 'Show veteran interior offensive linemen on other teams.'] }), sources: [] };
}
