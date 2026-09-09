import type { DataAnalysisBriefBody } from '@shared/types';
import { db } from '../db/client.js';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import { describeNflIllustrativeTerms, getNflContractDossier } from './index.js';
import { validateNflContractScenarioArgs } from './validation.js';
import type { NflContractScenarioArgs } from './types.js';

type Reference = NonNullable<DataAnalysisBriefBody['saved_contract_reference']>;
export interface SavedContractRow { id: string; session_id: string; created_at: string; contract_args: unknown }
export interface SavedContractRequest { player_name: string; brief_id?: string }
export interface SavedContractContext { session_id: string; created_before?: string; exclude_brief_id?: string }
export interface SavedContractAnswer extends FactualAnswer { scenario_args?: NflContractScenarioArgs }
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

export function savedContractSource(reference: Reference): FactualAnswer['sources'][number] {
  return {
    ref_index: 1, kind: 'CAP', title: reference.player_name + ' · saved illustrative contract',
    source: 'Saved user-supplied illustration', updated_at: reference.saved_at,
    data: { source_url: '/?conversation=' + reference.session_id, rows: [
      { k: 'Contract basis', v: 'Saved hypothetical compensation, not the player’s actual contract or asking price.' },
      { k: 'Saved brief', v: reference.brief_id }, { k: 'Saved conversation', v: reference.session_id },
      { k: 'Selection', v: reference.selection_basis.replaceAll('_', ' ') },
      { k: 'Retained inputs', v: 'Acquisition compensation, team, season and timing only. Current budget, reserve and player protections are applied separately.' },
    ] },
  };
}

/** Only compensation is imported. A saved funding amount, salary limit, budget
 * or player protection belongs to its original scenario, not this contract. */
export function selectSavedNflContract(rows: SavedContractRow[], request: SavedContractRequest, context: SavedContractContext): SavedContractAnswer {
  const canonical = getNflContractDossier(request.player_name)?.player_name ?? request.player_name;
  const candidates = rows.filter(row => (!request.brief_id || row.id === request.brief_id)
    && row.id !== context.exclude_brief_id && (!context.created_before || Date.parse(row.created_at) < Date.parse(context.created_before)))
    .sort((a, b) => Number(b.session_id === context.session_id) - Number(a.session_id === context.session_id)
      || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  for (const row of candidates) {
    let saved: NflContractScenarioArgs;
    try { saved = validateNflContractScenarioArgs(row.contract_args); } catch { continue; }
    if (saved.team_id !== 'NYG') continue;
    const move = saved.moves.find(move => move.action === 'acquire' && move.illustrative_terms
      && normalize(getNflContractDossier(move.player_id)?.player_name ?? move.player_id) === normalize(canonical));
    if (!move) continue;
    const acquisition = { player_id: canonical, action: 'acquire' as const, illustrative_terms: structuredClone(move.illustrative_terms!) };
    const scenario: NflContractScenarioArgs = { schema_version: 1, team_id: saved.team_id, season: saved.season, timing: saved.timing, moves: [acquisition] };
    const reference: Reference = { brief_id: row.id, session_id: row.session_id, saved_at: row.created_at, player_name: canonical,
      selection_basis: request.brief_id ? 'explicit_brief' : row.session_id === context.session_id ? 'current_conversation' : 'latest_saved_for_player' };
    return { scenario_args: scenario, sources: [savedContractSource(reference)], body: {
      kind: 'data_analysis', language_policy: 'facts_only_v1',
      answer: `Loaded ${canonical}’s saved illustrative contract from ${reference.saved_at.slice(0, 10)}. The saved compensation can now be calculated with the current budget, reserve and player protections.`,
      saved_contract_reference: reference, saved_contract_lookup: { status: 'found', player_name: canonical, scenario_args: scenario },
      key_findings: [{ label: 'Saved compensation', body: describeNflIllustrativeTerms(acquisition).join('\n'), source_refs: [1] }],
      tables: [{ title: 'Saved illustrative compensation', columns: ['Player', 'Year', 'Year kind', 'Base salary', 'Outstanding guaranteed salary', 'New signing bonus'],
        rows: acquisition.illustrative_terms.years.map((year, index) => [canonical, year.year, year.kind, year.base_salary, year.guaranteed_salary, index === 0 ? acquisition.illustrative_terms.signing_bonus : 0]), source_refs: [1] }],
      calculations: [], caveats: ['This is a saved hypothetical deal. It does not establish current availability, asking price or an executable transaction.'], followups: [],
    } };
  }
  return { sources: [], body: { kind: 'data_analysis', language_policy: 'facts_only_v1',
    answer: `I checked the saved Giants conversations but found no usable illustrative acquisition contract for ${canonical}${request.brief_id ? ' in that saved brief' : ''}. Provide the proposed compensation schedule, or identify the saved deal to use. The public contract figures are not a substitute for hypothetical terms.`,
    saved_contract_lookup: { status: 'not_found', player_name: canonical }, key_findings: [], tables: [], calculations: [], caveats: [], followups: [],
  } };
}

export async function readSavedNflContract(request: SavedContractRequest, context: SavedContractContext): Promise<SavedContractAnswer> {
  if (!context.session_id) throw new Error('A current conversation is required to scope saved-contract access.');
  if (typeof request.player_name !== 'string' || !request.player_name.trim() || request.player_name.length > 100) throw new Error('Name the player whose saved contract is needed.');
  if (request.brief_id && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(request.brief_id)) throw new Error('Invalid saved brief ID.');
  const { data: session, error: sessionError } = await db.from('sessions').select('user_id,workspace_key').eq('id', context.session_id).maybeSingle();
  if (sessionError || !session || session.workspace_key !== 'nyg-demo') throw new Error('The current Giants workspace could not be verified for saved-contract access.');
  const dossier = getNflContractDossier(request.player_name);
  const identities = [...new Set([dossier?.player_name ?? request.player_name.trim(), ...(dossier ? [dossier.player_id] : [])])];
  const results = await Promise.all(identities.map(async player_id => {
    let query = db.from('briefs').select('id,session_id,created_at,contract_args:body->contract_scenario->args,sessions!inner(user_id,workspace_key,archived_at)')
      .eq('status', 'ready').eq('mode', 'data_analyst').eq('sessions.workspace_key', 'nyg-demo').is('sessions.archived_at', null)
      .eq('body->contract_scenario->args->>team_id', 'NYG')
      .contains('body', { contract_scenario: { args: { moves: [{ player_id, action: 'acquire' }] } } });
    query = session.user_id ? query.eq('sessions.user_id', session.user_id) : query.is('sessions.user_id', null);
    if (request.brief_id) query = query.eq('id', request.brief_id);
    if (context.exclude_brief_id) query = query.neq('id', context.exclude_brief_id);
    if (context.created_before) query = query.lt('created_at', context.created_before);
    return query.order('created_at', { ascending: false }).limit(50);
  }));
  if (results.some(result => result.error)) throw new Error('Saved-contract database lookup failed; no missing-contract conclusion was made.');
  const rows = [...new Map(results.flatMap(result => (result.data ?? []) as unknown as SavedContractRow[]).map(row => [row.id, row])).values()];
  return selectSavedNflContract(rows, request, context);
}

export const readSavedNflContractTool = {
  name: 'read_saved_contract',
  description: 'Read an existing hypothetical acquisition contract from the database across accessible Giants conversations. Use when the user refers to a saved/earlier illustrative contract not present in previous_contract_scenario. Name the player; optionally select an exact returned brief_id. Prefers this conversation, otherwise the most recently saved matching contract. Code loads exact compensation for subsequent funding/comparison tools; do not retype the terms. Does not import the old budget, funding moves, salary limits or protected players. Distinct from read_contract_dossiers, which reads public reported obligations.',
  input_schema: { type: 'object' as const, properties: { player_name: { type: 'string' }, brief_id: { type: 'string' } }, required: ['player_name'], additionalProperties: false },
};
