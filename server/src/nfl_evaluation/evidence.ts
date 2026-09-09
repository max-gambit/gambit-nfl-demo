import { readFile } from 'node:fs/promises';
import capturedReceiving from '../../../data/nfl-scouting/receiving.json';
import capturedCollege from '../../../data/nfl-examples/college.json';
import { getNflContractDossier } from '../nfl_contracts/index.js';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import type { SuppliedEvaluation } from '../nfl_scouting/evidence.js';
import type { NflEvaluationContext, NflEvaluationDomain, TrustedNflEvaluationCost } from './types.js';

export interface EvaluationEvidenceOption {
  name: string; team: string | null; path: string; internal: boolean; stats_season: number;
  games: number | null; receptions: number | null; yards: number | null; yards_per_game: number | null; receptions_per_game: number | null;
  last_active_year: number | null; incoming_cap: number | null; cost: TrustedNflEvaluationCost | null; reports: string[]; refs: number[];
}
export function supportedEvaluationNames(domain: NflEvaluationDomain, context: NflEvaluationContext): string[] {
  return domain === 'college' ? capturedCollege.players.map(p => p.name) : [...new Set([...capturedReceiving.records.map(p => p.player_name), ...context.seed.roster_entries.filter(p => p.team_id === 'NYG' && p.position === 'WR').map(p => p.player_name)])];
}
export function defaultEvaluationNames(domain: NflEvaluationDomain, context: NflEvaluationContext): string[] {
  if (domain === 'college') return capturedCollege.players.map(p => p.name);
  return ['Courtland Sutton', 'Jakobi Meyers', 'Christian Kirk', 'Darnell Mooney', 'Malik Nabers'].filter(name => context.seed.roster_entries.some(p => p.player_name === name));
}
export async function loadEvaluationEvidence(domain: NflEvaluationDomain, names: string[], context: NflEvaluationContext): Promise<{ options: EvaluationEvidenceOption[]; sources: FactualAnswer['sources'] }> {
  const sources: FactualAnswer['sources'] = [];
  const add = (source: Omit<FactualAnswer['sources'][number], 'ref_index'>) => { sources.push({ ...source, ref_index: sources.length + 1 }); return sources.length; };
  const publicReports = domain === 'receiver' ? (JSON.parse(await readFile(new URL('../../../data/nfl-scouting/reports.json', import.meta.url), 'utf8')) as { reports: SuppliedEvaluation[] }).reports : [];
  const options = names.map(name => {
    if (domain === 'college') {
      const p = capturedCollege.players.find(p => p.name === name)!;
      const numeric = capturedCollege.sources.find(s => s.id === p.stats_source_id)!;
      const evaluation = capturedCollege.sources.find(s => s.id === p.assessment.source_id)!;
      const statRef = add({ kind: 'COLLEGE', source: numeric.title, title: `${name}: official 2024 college record`, updated_at: numeric.effective_date, data: { ...numeric, numeric_provenance: { player: p.name, games: p.games, receptions: p.receptions, yards: p.receiving_yards, stats_locator: p.stats_locator }, rows: [{ k: 'Effective scope', v: '2024 statistics; historical 2025 draft class' }, { k: 'Captured', v: numeric.captured_at }] } });
      const reportRef = add({ kind: 'SCOUTING', source: p.assessment.author, title: `${name}: attributed historical public assessment`, updated_at: p.assessment.published_on, data: { ...evaluation, attribution: p.assessment, rows: [{ k: 'Receiving', v: p.assessment.receiving }, { k: 'Movement / blocking', v: p.assessment.movement_blocking }, { k: 'Boundary', v: 'An attributed April 2025 opinion; not a Giants grade or current prospect availability.' }] } });
      return { name, team: null, path: 'Historical 2025 draft example; current eligibility/path unverified', internal: false, stats_season: 2024, games: p.games, receptions: p.receptions, yards: p.receiving_yards, yards_per_game: p.receiving_yards / p.games, receptions_per_game: p.receptions / p.games, last_active_year: null, incoming_cap: null, cost: null, reports: [`${p.assessment.author}: Receiving — ${p.assessment.receiving} Movement/blocking — ${p.assessment.movement_blocking}`], refs: [statRef, reportRef] };
    }
    const roster = context.seed.roster_entries.find(p => p.player_name === name);
    if (!roster) throw new Error('A selected receiver has no recorded roster identity; refresh or select another captured option.');
    const record = capturedReceiving.records.find(r => r.player_name === name);
    const at = (column: string) => record?.table.columns.indexOf(column) ?? -1;
    const total = (column: string) => {
      if (!record || at(column) < 0 || !record.table.rows.length) return null;
      const totals = record.table.rows.filter(row => /^(?:total|\d+TM|---)$/i.test(row[at('TEAM')] ?? ''));
      const rows = totals.length ? totals : record.table.rows;
      const values = rows.map(row => row[at(column)] === '' ? NaN : Number(row[at(column)].replaceAll(',', '')));
      return values.every(Number.isFinite) ? values.reduce((a,b) => a + b, 0) : null;
    };
    const games = total('G'), receptions = total('REC'), yards = total('YDS');
    const rosterRef = add({ kind: 'ROSTER', source: 'Dated public roster snapshot', title: `${name}: recorded roster path`, updated_at: context.seed.as_of_date, data: { source_url: roster.source_url, effective_date: context.seed.as_of_date, rows: [{ k: 'Team', v: roster.team_id }, { k: 'Status', v: roster.roster_status }, { k: 'Source note', v: roster.source_note }, { k: 'Boundary', v: 'Roster association does not establish current medical availability, role assignment or willingness to transact.' }] } });
    const refs = [rosterRef];
    if (record) refs.push(add({ kind: 'PRODUCTION', source: 'Official club career statistics', title: `${name}: 2025 receiving production`, updated_at: record.captured_at, data: { source_url: record.source_url, captured_at: record.captured_at, effective_date: '2025 regular season', source_sha256: record.source_sha256, original_table: record.table, numeric_provenance: { games, receptions, yards }, rows: [{ k: 'Period', v: '2025 regular season, complete team stints' }, { k: 'Captured', v: record.captured_at }] } }));
    const dossier = getNflContractDossier(name);
    const years = dossier?.source_status === 'reported' ? dossier.reported_years.filter(y => !y.is_void).map(y => y.year) : [];
    const last_active_year = years.length ? Math.max(...years) : null;
    if (dossier) refs.push(add({ kind: 'CONTRACT', source: 'Inspected OverTheCap dossier', title: `${name}: reported active years`, updated_at: dossier.inspected_at, data: { source_url: dossier.source_url, captured_at: dossier.inspected_at, source_sha256: dossier.source_sha256, source_tables: dossier.source_tables, numeric_provenance: { active_years: years, last_active_year }, rows: [{ k: 'Source status', v: dossier.source_status }, { k: 'Boundary', v: 'Active years exclude void years. Contract horizon is not incoming cost or a guarantee valuation.' }, { k: 'Conflicts', v: dossier.conflicts.join(' ') || 'None reported' }] } }));
    const reports = publicReports.filter(p => p.player_name === name);
    for (const p of reports) refs.push(add({ kind: 'SCOUTING', source: p.kind, title: `${name}: ${p.author}`, updated_at: p.date, data: { source_url: p.source_url, effective_date: p.date, rows: [{ k: 'Author', v: p.author }, { k: 'Assessment', v: p.observation }, { k: 'Scope', v: p.scope }] } }));
    const costs = (context.trustedCosts ?? []).filter(c => c.player_name === name);
    if (costs.length > 1) throw new Error('Choose one compatible root-calculated incoming-cost scenario per player.');
    const cost = costs[0] ?? null;
    if (cost && (cost.origin !== 'contract_scenario' || cost.team_id !== 'NYG' || cost.season !== Number.parseInt(context.seed.season, 10) || !cost.source_id || !Number.isFinite(Date.parse(cost.as_of)) || !['reported', 'conditional', 'illustrative', 'blocked'].includes(cost.status) || !['internal', 'trade', 'free_agent', 'draft', 'unresolved'].includes(cost.acquisition_path) || !Array.isArray(cost.conditions) || cost.conditions.some(c => typeof c !== 'string') || (cost.incoming_cap != null && (!Number.isFinite(cost.incoming_cap) || cost.incoming_cap < 0)))) throw new Error('Invalid trusted incoming-cost evidence.');
    const incoming_cap = cost && cost.status !== 'blocked' ? cost.incoming_cap : null;
    if (cost) refs.push(add({ kind: 'CONTRACT_SCENARIO', source: 'Root-executed contract scenario', title: `${name}: calculated incoming cap`, updated_at: cost.as_of, data: { source_url: cost.source_url, scenario_source_id: cost.source_id, origin: cost.origin, numeric_provenance: { season: cost.season, incoming_cap, status: cost.status }, rows: [{ k: 'Status', v: cost.status }, { k: 'Conditions', v: cost.conditions.join(' ') }, { k: 'Boundary', v: 'Calculated scenario input; not an asking price, executed offer or confirmed availability.' }] } }));
    const internal = roster.team_id === 'NYG';
    return { name, team: roster.team_id, path: internal ? `Internal NYG roster option (${context.seed.as_of_date}); current assignment unresolved` : cost && cost.status !== 'blocked' && cost.acquisition_path !== 'unresolved' ? `${cost.acquisition_path} scenario; availability/consent unverified` : `External ${roster.team_id} option; acquisition path and price unresolved`, internal, stats_season: 2025, games, receptions, yards, yards_per_game: games && yards != null ? yards / games : null, receptions_per_game: games && receptions != null ? receptions / games : null, last_active_year, incoming_cap, cost, reports: reports.map(p => `${p.author} (${p.date}): ${p.observation} [${p.scope}]`), refs };
  });
  return { options, sources };
}
