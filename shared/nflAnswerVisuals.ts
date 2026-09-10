import type { DataAnalysisTable } from './types';

export type NflVisualPoint = { label: string; detail: string; internal: boolean; values: Array<number | null>; labels: string[] };
export type NflAnswerVisual = {
  tableIndex: number;
  title: string;
  context: string;
  sourceRefs: number[];
  totalRows: number;
} & ({ kind: 'bars'; grouped: boolean; metrics: string[]; points: NflVisualPoint[] }
  | { kind: 'practice'; dates: string[]; players: Array<{ name: string; statuses: string[]; designation: string }> }
  | { kind: 'downs'; rows: Array<{ label: string; converted: number; failed: number; share: string }> });

/** Parse only a complete numeric cell. Unknowns and embedded numbers remain unknown. */
export function chartNumber(cell: string | number | null | undefined): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell !== 'string') return null;
  const value = cell.trim().replaceAll('−', '-');
  if (!/^[+-]?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/.test(value)) return null;
  const parsed = Number(value.replace(/[$,%]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function cellLabel(cell: string | number | null | undefined): string {
  return cell == null ? 'Not recorded' : typeof cell === 'number' ? cell.toLocaleString('en-US') : cell;
}

/** Charts are projections of selected tool tables. No model-written chart values or inferred scores. */
export function nflAnswerVisuals(tables: DataAnalysisTable[]): NflAnswerVisual[] {
  const visuals: NflAnswerVisual[] = [];
  tables.forEach((table, tableIndex) => {
    if (visuals.length >= 2 || table.rows.length < 2 || !table.source_refs.length) return;
    const base = { tableIndex, context: table.title, sourceRefs: [...table.source_refs], totalRows: table.rows.length };
    const columns = table.columns;
    const player = columns.indexOf('Player');
    const dates = columns.flatMap((name, i) => /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}$/i.test(name) ? [i] : []);
    if (player >= 0 && dates.length >= 2 && table.rows.some(row => dates.some(i => /^(DNP|LP|FP)$/.test(String(row[i]))))) {
      const designation = columns.indexOf('Game designation');
      visuals.push({ ...base, kind: 'practice', title: 'Practice participation', dates: dates.map(i => columns[i]), players: table.rows.slice(0, 12).map(row => ({ name: String(row[player]), statuses: dates.map(i => cellLabel(row[i])), designation: designation < 0 ? '' : cellLabel(row[designation]) })) });
      return;
    }
    const converted = columns.indexOf('Converted');
    const failed = columns.indexOf('Failed');
    const offense = columns.indexOf('Offense');
    const distance = columns.indexOf('Distance bucket');
    if (offense >= 0 && converted >= 0 && failed >= 0) {
      const rows = table.rows.slice(0, 12).map(row => ({ label: [row[offense], distance >= 0 ? row[distance] : null].filter(v => v != null).join(' · '), converted: chartNumber(row[converted]), failed: chartNumber(row[failed]), share: cellLabel(row[columns.indexOf('Conversion share')]) }));
      if (rows.every(row => row.converted != null && row.failed != null && Number.isInteger(row.converted) && Number.isInteger(row.failed) && row.converted >= 0 && row.failed >= 0)) {
        visuals.push({ ...base, kind: 'downs', title: /third.down/i.test(table.title) ? 'Third-down outcomes' : 'Play outcomes', rows: rows as Array<{ label: string; converted: number; failed: number; share: string }> });
      }
      return;
    }
    const alternative = columns.indexOf('Alternative');
    const year = columns.indexOf('Year');
    const labelIndex = player >= 0 ? player : alternative >= 0 ? alternative : year;
    if (labelIndex < 0) return;
    const grouped = player < 0;
    const eligible = columns.flatMap((name, i) => {
      // Dates, rank, contract endpoints and grades with an unknown scale are never chart metrics.
      const numericMetric = player >= 0 && /^(?:20\d{2}\s+)?(?:receiving yards|rec yards|yards\s*\/\s*game|receptions|games|starts|(?:offensive\s+)?snaps)$/i.test(name);
      const financialMetric = grouped && /^(?:(?:Hold|Scenario)\s+(?:cap|cash)|(?:Current|Next-year)\s+(?:cap|cash)\s+change(?: vs hold)?(?: \(\+ used\))?)$/i.test(name);
      return (numericMetric || financialMetric) && table.rows.some(row => chartNumber(row[i]) != null) ? [i] : [];
    });
    // Prefer a per-game view for college samples of different lengths when it was already calculated.
    const priority = (i: number) => /yards\s*\/\s*game/i.test(columns[i]) ? 0 : /yards/i.test(columns[i]) ? 1 : /starts/i.test(columns[i]) ? 2 : /snaps/i.test(columns[i]) ? 3 : 4;
    const metrics = grouped ? eligible : [...eligible].sort((a, b) => priority(a) - priority(b));
    if (!metrics.length) return;
    const team = columns.findIndex(name => /^(?:Team|Team \/ scope)$/.test(name));
    const points = table.rows.slice(0, 12).map(row => ({
      label: labelIndex === year ? String(row[labelIndex]) : cellLabel(row[labelIndex]), detail: team < 0 ? '' : cellLabel(row[team]),
      internal: team >= 0 && /\bNYG\b/.test(String(row[team])),
      values: metrics.map(i => chartNumber(row[i])), labels: metrics.map(i => cellLabel(row[i])),
    }));
    const financialTitle = metrics.some(i => /cash/i.test(columns[i])) ? metrics.some(i => /cap/i.test(columns[i])) ? 'Cap and cash comparison' : 'Cash comparison' : 'Cap comparison';
    visuals.push({ ...base, kind: 'bars', grouped, title: grouped ? financialTitle : /yard|reception/i.test(columns[metrics[0]]) ? 'Receiving production' : 'Recorded workload', metrics: metrics.map(i => columns[i]), points });
  });
  return visuals;
}
