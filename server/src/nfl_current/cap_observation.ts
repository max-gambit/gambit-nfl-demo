import { readFile } from 'node:fs/promises';
import { factualBody } from '@shared/nflFacts';
import type { PreparedNflCurrentAnswer } from './analysis.js';

interface Source { label: string; url: string; captured_at: string; sha256: string }
interface CapObservation {
  schema: string; team_id: string; season: number;
  team: Source & { total_liabilities: number; top_51: number; cap_space: number };
  league: Source & { cap_space: number; active_cap_spending: number; dead_money: number; contracts: number };
  calculator: Source & { applied_cap: number };
}
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export async function loadCapObservationAnswer(): Promise<PreparedNflCurrentAnswer | null> {
  try {
    const data = JSON.parse(await readFile(new URL('../../../data/nfl-demo/cap-observation.current.json', import.meta.url), 'utf8')) as CapObservation;
    return capObservationAnswer(data);
  } catch { return null; }
}

export function capObservationAnswer(data: CapObservation): PreparedNflCurrentAnswer | null {
  if (data.schema !== 'public_cap_observation.v1' || data.team_id !== 'NYG' || data.season !== 2026) return null;
  const { team, league, calculator } = data;
  if (![team.total_liabilities, team.top_51, team.cap_space, league.cap_space, league.active_cap_spending, league.dead_money, calculator.applied_cap].every(Number.isFinite)) return null;
  if (team.total_liabilities + team.cap_space !== calculator.applied_cap || league.active_cap_spending + league.dead_money + league.cap_space !== calculator.applied_cap) return null;
  if ([team, league, calculator].some(s => !Number.isFinite(Date.parse(s.captured_at)) || !/^[a-f0-9]{64}$/.test(s.sha256))) return null;
  const difference = Math.abs(team.cap_space - league.cap_space);
  const dates = [...new Set([team, league, calculator].map(s => s.captured_at.slice(0, 10)))].join(', ');
  return {
    body: factualBody({
      answer: `Public pages captured ${dates}: Over The Cap's Giants page reports ${money(team.cap_space)} in 2026 cap space; its league table reports ${money(league.cap_space)}.${difference ? ` The figures differ by ${money(difference)}; the captured pages do not explain that difference.` : ' The captured figures agree.'}`,
      key_findings: [{ label: 'Accounting status', body: 'These are dated public observations. A club-certified in-season cap total and the individual league adjustments are not available in the loaded evidence.', source_refs: [1, 2, 3] }],
      tables: [{ title: 'Captured 2026 public accounting', columns: ['Source', 'Reported spending / liabilities', 'Dead money', 'Cap space'], rows: [
        ['Giants page', `${money(team.total_liabilities)} total liabilities`, 'Included in total liabilities', money(team.cap_space)],
        ['League table', `${money(league.active_cap_spending)} active cap spending`, money(league.dead_money), money(league.cap_space)],
      ], source_refs: [1, 2] }],
      calculations: [
        {label:'Public cap observation difference',formula:`abs(${money(team.cap_space)} − ${money(league.cap_space)})`,value:money(difference),source_refs:[1,2]},
        { label: 'Team page arithmetic', formula: `${money(calculator.applied_cap)} applied cap − ${money(team.total_liabilities)} total liabilities`, value: money(team.cap_space), source_refs: [1, 3] },
        { label: 'League table arithmetic', formula: `${money(calculator.applied_cap)} applied cap − ${money(league.active_cap_spending)} active spending − ${money(league.dead_money)} dead money`, value: money(league.cap_space), source_refs: [2, 3] },
      ],
      caveats: [
        `As of capture on ${dates}; this is not a live feed or a September 10 forecast.${difference ? ' The source disagreement is unresolved.' : ''}`,
        `The Giants page separately lists ${money(team.top_51)} as Top 51. That subtotal is not its total liabilities. Roster refresh dates do not update these captured cap observations.`,
        'Public roster, reserve and practice-squad records do not establish every club ledger adjustment. No unexplained difference is assigned to a roster move or accounting category.',
      ], followups: [],
    }),
    sources: [team, league, calculator].map((source, index) => ({ ref_index: index + 1, kind: 'CAP', source: 'Over The Cap', title: source.label, updated_at: source.captured_at, data: {
      source_url: source.url, contribution: 'Dated public source observation, independently reconciled to the captured applied cap.',
      rows: Object.entries(source).filter(([key]) => !['label','url'].includes(key)).map(([k, v]) => ({ k: k.replaceAll('_', ' '), v: typeof v === 'number' ? (k === 'contracts' ? String(v) : money(v)) : v })),
    } })),
  };
}
