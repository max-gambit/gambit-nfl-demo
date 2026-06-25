import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { ProbBar } from '../ds/ProbBar';
import { fire } from '../lib/events';
import { useBriefs, useToasts, useUi } from '../store';
import { CandidateScenarioModal } from './CandidateScenarioModal';
import type { BriefOption, BriefOptionDetails, BriefOptionMoveCandidate, PillKind } from '@shared/types';

interface OptionsTableProps {
  embedded?: boolean;
}

const HEAD = ['Decision path', 'Impact', 'Execution read', 'Confidence', 'Evidence'];

const LIKELIHOOD_OPTIONS: { kind: PillKind; label: string }[] = [
  { kind: 'executable',  label: 'Executable' },
  { kind: 'plausible',   label: 'Plausible' },
  { kind: 'speculative', label: 'Speculative' },
];

type SortKey = 'recommended' | 'cap-desc' | 'cap-asc' | 'likelihood-desc' | 'timing';

const SORT_OPTIONS: { key: SortKey; label: string; short: string }[] = [
  { key: 'recommended',      label: 'Current lean order',          short: 'Current lean' },
  { key: 'cap-desc',         label: 'Cap impact (high to low)',    short: 'Cap down' },
  { key: 'cap-asc',          label: 'Cap impact (low to high)',    short: 'Cap up' },
  { key: 'likelihood-desc',  label: 'Likelihood (high to low)',    short: 'Likelihood' },
  { key: 'timing',           label: 'Timing',                      short: 'Timing' },
];

function capNumber(row: BriefOption): number {
  return Number(row.net_cap_num) || 0;
}

function compareRows(a: BriefOption, b: BriefOption, sort: SortKey): number {
  switch (sort) {
    case 'recommended':      return a.ref_index - b.ref_index;
    case 'cap-desc':         return capNumber(b) - capNumber(a);
    case 'cap-asc':          return capNumber(a) - capNumber(b);
    case 'likelihood-desc':  return b.likelihood_pct - a.likelihood_pct;
    case 'timing':           return (a.timing ?? '').localeCompare(b.timing ?? '');
  }
}

function SkelBlock({ w, h }: { w: number | string; h: number }) {
  return (
    <div style={{
      width: typeof w === 'number' ? `${w}px` : w, height: h,
      background: F.cream100, borderRadius: RADIUS.sm,
      animation: 'skeleton-shimmer 1.6s ease-in-out infinite',
    }} />
  );
}

function escapeCsvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function detailsFor(row: BriefOption): BriefOptionDetails {
  return row.details ?? {
    decision_question: `Should we pursue option [${row.ref_index}]?`,
    why_this: row.subtitle ?? 'This option was included as a candidate path in the generated brief.',
    upside: row.net_cap_label ? `Creates the listed three-year cap outcome (${row.net_cap_label}).` : 'Keeps this path available for comparison.',
    downside: row.cba_section ? `Requires clean execution under ${row.cba_section}.` : 'Needs deeper validation before it becomes a final decision.',
    required_moves: [row.timing ? `Sequence around ${formatTiming(row.timing)}.` : 'Confirm transaction mechanics and sequencing.'],
    blockers: row.likelihood_kind === 'speculative' ? ['Model marked this path speculative.'] : [],
    watch_triggers: [row.timing ? `Re-check this option before ${formatTiming(row.timing)}.` : 'Re-check when new market or cap data lands.'],
    next_step: 'Open the supporting evidence and ask a follow-up before deciding.',
    evidence_refs: [row.ref_index],
  };
}

function evidenceRefsFor(row: BriefOption): number[] {
  const refs = detailsFor(row).evidence_refs
    .map((ref) => Number(ref))
    .filter((ref) => Number.isInteger(ref) && ref > 0);
  const fallback = refs.length ? refs : [row.ref_index];
  return [...new Set(fallback)].sort((a, b) => a - b);
}

function rowsToCsv(rows: BriefOption[]): string {
  const head = [
    'Ref', 'Option', 'Subtitle', 'Type', 'Path', 'Decision question',
    'Cap impact ($M)', 'Cap label', 'EPM', 'CBA', 'Timing',
    'Likelihood', 'Likelihood %', 'Sources', 'Evidence refs', 'Next step',
  ];
  const lines = [head.join(',')];
  for (const r of rows) {
    const details = detailsFor(r);
    lines.push([
      String(r.ref_index),
      escapeCsvCell(r.title),
      escapeCsvCell(r.subtitle ?? ''),
      escapeCsvCell(r.type_kind ?? ''),
      escapeCsvCell(r.path_kind ?? ''),
      escapeCsvCell(details.decision_question),
      String(r.net_cap_num),
      escapeCsvCell(r.net_cap_label),
      escapeCsvCell(r.epm ?? ''),
      escapeCsvCell(r.cba_section ?? ''),
      escapeCsvCell(r.timing ?? ''),
      escapeCsvCell(r.likelihood_kind),
      String(r.likelihood_pct),
      String(r.src_count),
      escapeCsvCell(evidenceRefsFor(r).join(' ')),
      escapeCsvCell(details.next_step),
    ].join(','));
  }
  return lines.join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatTiming(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');
}

function formatCapRangeValue(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
}

function firstUsefulText(items: string[]): string | null {
  const found = items.map((item) => item.trim()).find(Boolean);
  return found ?? null;
}

function optionConstraint(row: BriefOption, details: BriefOptionDetails): { label: string; text: string } {
  const blocker = firstUsefulText(details.blockers);
  if (blocker) return { label: 'Hinge', text: blocker };
  const move = firstUsefulText(details.required_moves);
  if (move) return { label: 'Requires', text: move };
  if (row.cba_section) return { label: 'Rule', text: row.cba_section };
  return { label: 'Open', text: 'Validate assumptions before acting.' };
}

function specificNextStep(details: BriefOptionDetails): string | null {
  const text = details.next_step.trim();
  if (!text) return null;
  if (/open the supporting evidence|ask a follow-up|before deciding/i.test(text)) return null;
  if (text.length < 16) return null;
  return text;
}

function detailText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function candidateMovesFor(details: BriefOptionDetails): BriefOptionMoveCandidate[] {
  return (details.move_candidates ?? [])
    .filter((candidate) => !!candidateTargetLabel(candidate))
    .slice(0, 4);
}

function candidateEvidenceRefs(candidate: BriefOptionMoveCandidate, fallback: number[]): number[] {
  const refs = (candidate.evidence_refs ?? [])
    .map((ref) => Number(ref))
    .filter((ref) => Number.isInteger(ref) && ref > 0);
  return [...new Set(refs.length ? refs : fallback)].sort((a, b) => a - b);
}

function candidateTargetLabel(candidate: BriefOptionMoveCandidate): string | null {
  const names = (candidate.target_player_names ?? [])
    .map((name) => name.trim())
    .filter(Boolean);
  const team = detailText(candidate.target_team_id) ?? detailText(candidate.target_team_name);
  if (names.length) return [names.join(' / '), team].filter(Boolean).join(' · ');
  if (/archetype|profile|generic|placeholder|tbd/i.test(candidate.label)) return null;
  return detailText(candidate.label);
}

function optionFollowupPrompt(row: BriefOption, details: BriefOptionDetails, evidenceRefs: number[]): string {
  const refs = evidenceRefs.map((ref) => `[${ref}]`).join(' ');
  return [
    `Analyze strategic option [${row.ref_index}] "${row.title}" further.`,
    'Treat the scope as the whole strategic option, not just candidate moves.',
    'Lay out specific candidate moves or targets if supportable: target player/team, outgoing construction, salary/CBA mechanics, likely cost, constraint/unknown, and evidence refs.',
    refs ? `Use the current option evidence refs ${refs} and say plainly if no named target is supportable from the available data.` : 'Say plainly if no named target is supportable from the available data.',
    details.downside ? `Current known tradeoff: ${details.downside}` : '',
  ].filter(Boolean).join(' ');
}

export function OptionsTable({ embedded = false }: OptionsTableProps) {
  // Default expanded when embedded inside a brief card: options are the
  // concrete decision matrix behind the working thesis.
  const [expanded, setExpanded] = useState(embedded);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [likelihoodFilter, setLikelihoodFilter] = useState<Set<PillKind>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>('recommended');
  const [openOptionRef, setOpenOptionRef] = useState<number | null>(null);

  const {
    activeBriefId, briefs, optionsByBrief, loadingDataFor, setActiveBrief,
  } = useBriefs();
  const {
    setSourceFilterRefs, setHighlightedSourceRef, setSelectedSourceRef,
    setSelectedOptionRef, setExpandedBrief, setRightPanelMode, setRightPanelOpen,
  } = useUi();
  const { pushToast } = useToasts();
  const filterRef = useRef<HTMLDivElement>(null);
  const sortRef = useRef<HTMLDivElement>(null);

  const allRows = activeBriefId ? (optionsByBrief[activeBriefId] ?? []) : [];

  const rows = useMemo(() => {
    let r = allRows;
    if (likelihoodFilter.size > 0) {
      r = r.filter((row) => likelihoodFilter.has(row.likelihood_kind));
    }
    return [...r].sort((a, b) => compareRows(a, b, sortBy));
  }, [allRows, likelihoodFilter, sortBy]);

  const maxAbs = rows.length ? Math.max(...rows.map((r) => Math.abs(capNumber(r)))) : 1;
  const capRange = useMemo(() => {
    if (!rows.length) return null;
    const values = rows.map(capNumber);
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [rows]);

  useEffect(() => setOpenOptionRef(null), [activeBriefId]);

  // Close popovers on outside click.
  useEffect(() => {
    if (!filterOpen && !sortOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (filterRef.current && !filterRef.current.contains(t)) setFilterOpen(false);
      if (sortRef.current && !sortRef.current.contains(t)) setSortOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [filterOpen, sortOpen]);

  const isLoadingFirst = !!activeBriefId && loadingDataFor.has(activeBriefId) && allRows.length === 0;
  if (isLoadingFirst) {
    return (
      <div style={
        embedded
          ? { background: 'transparent', padding: `0 ${SPACE.xl + 2}px ${SPACE.xs}px`, boxSizing: 'border-box', width: '100%' }
          : { background: F.paper, padding: `${SPACE.xs + 2}px ${SPACE.lg + 2}px ${SPACE.lg + 2}px`, boxSizing: 'border-box', width: '100%' }
      }>
        <div style={{
          background: F.surface, border: `1px solid ${F.border}`,
          borderRadius: RADIUS.lg, padding: `${SPACE.md}px ${SPACE.lg}px`,
          boxShadow: F.shadowChat,
          display: 'flex', flexDirection: 'column', gap: SPACE.sm + 2,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md }}>
            <SkelBlock w={140} h={12} />
            <SkelBlock w={70}  h={10} />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: SPACE.md + 2, padding: `${SPACE.xs}px 0` }}>
              <SkelBlock w={'42%'} h={12} />
              <div style={{ flex: 1 }} />
              <SkelBlock w={64} h={12} />
              <SkelBlock w={56} h={10} />
              <SkelBlock w={48} h={10} />
              <SkelBlock w={42} h={12} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!allRows.length) return null;

  const filterCount = likelihoodFilter.size;
  const activeSort = SORT_OPTIONS.find((s) => s.key === sortBy);
  const sortLabel = activeSort?.label ?? 'Default';
  const sortShort = activeSort?.short ?? 'Sort';
  const isCustomSort = sortBy !== 'recommended';

  const exportCsv = () => {
    const briefForName = briefs.find((b) => b.id === activeBriefId);
    const stem = (briefForName?.thesis ?? briefForName?.question ?? 'options')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'options';
    const filename = `${stem}-options.csv`;
    downloadCsv(filename, rowsToCsv(rows));
    pushToast({
      tone: 'success',
      message: 'Options exported as CSV',
      detail: `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} · ${filename}`,
    });
  };

  const toggleLikelihood = (k: PillKind) => {
    setLikelihoodFilter((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const selectOption = (row: BriefOption) => {
    const next = openOptionRef === row.ref_index ? null : row.ref_index;
    setOpenOptionRef(next);
    setSelectedOptionRef(next);
  };

  const viewEvidence = (row: BriefOption) => {
    const refs = evidenceRefsFor(row);
    setSelectedOptionRef(row.ref_index);
    setSourceFilterRefs(refs);
    setHighlightedSourceRef(refs[0] ?? null);
    pushToast({
      tone: 'info',
      message: `Evidence for option [${row.ref_index}]`,
      detail: refs.map((ref) => `[${ref}]`).join(' '),
    });
  };

  const openEvidenceSource = (row: BriefOption, ref: number) => {
    const refs = evidenceRefsFor(row);
    setSelectedOptionRef(row.ref_index);
    setSourceFilterRefs(refs);
    setHighlightedSourceRef(ref);
    setSelectedSourceRef(ref);
  };

  const analyzeOptionFurther = (row: BriefOption) => {
    if (!activeBriefId) return;
    const details = detailsFor(row);
    const evidenceRefs = evidenceRefsFor(row);
    setActiveBrief(activeBriefId);
    setExpandedBrief(activeBriefId);
    setRightPanelMode('thread');
    setRightPanelOpen(true);
    setSelectedOptionRef(row.ref_index);
    window.setTimeout(() => {
      fire('v6d3cf:prefill-reply-composer', {
        text: optionFollowupPrompt(row, details, evidenceRefs),
      });
    }, 0);
    pushToast({
      tone: 'info',
      message: `Option [${row.ref_index}] staged`,
      detail: 'Right panel opened with a focused follow-up draft.',
    });
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={
        embedded
          ? { background: 'transparent', padding: `0 ${SPACE.xl + 2}px ${SPACE.xs}px`, position: 'relative', boxSizing: 'border-box', width: '100%', minWidth: 0 }
          : { background: F.paper, padding: `${SPACE.xs + 2}px ${SPACE.lg + 2}px ${SPACE.lg + 2}px`, position: 'relative', boxSizing: 'border-box', width: '100%', minWidth: 0 }
      }
    >
      <div style={{
        background: F.surface,
        border: `1px solid ${F.border}`,
        borderRadius: RADIUS.lg,
        overflow: 'visible',
        boxShadow: F.shadowChat,
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
      }}>
        <div style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: `${SPACE.md - 1}px 0`,
          fontFamily: 'var(--font-sans)',
          boxSizing: 'border-box',
        }}>
          <div
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm + 2, flex: 1, minWidth: 0, cursor: 'pointer', paddingLeft: SPACE.lg }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={F.fgMuted} strokeWidth="1.75" strokeLinecap="round" style={{ flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
              <path d="M9 6l6 6-6 6" />
            </svg>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.sm + 2, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: TYPE.body.lg, fontWeight: 600, color: F.ink }}>Strategic options</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgMuted, fontVariantNumeric: 'tabular-nums' }}>
                {filterCount > 0 ? `${rows.length} of ${allRows.length} paths` : `${rows.length} decision paths`}
              </span>
            </div>
          </div>

          {!expanded && (
            <div onClick={(e) => { e.stopPropagation(); setExpanded(true); }} style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm + 2, flexShrink: 0, cursor: 'pointer', marginLeft: SPACE.sm, paddingRight: SPACE.lg }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs }}>
                {rows.map((r, i) => (
                  <div key={i} title={`${r.title}: ${r.net_cap_label}`} style={{
                    width: 4, height: 14 + (Math.abs(capNumber(r)) / maxAbs) * 14,
                    background: capNumber(r) >= 0 ? F.positive : F.red,
                    borderRadius: 1,
                  }} />
                ))}
              </div>
              {capRange && (
                <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs, fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgMuted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  <span style={{ color: capRange.min < 0 ? F.red : F.positive, fontWeight: 600 }}>{formatCapRangeValue(capRange.min)}</span>
                  <span>to</span>
                  <span style={{ color: capRange.max >= 0 ? F.positive : F.red, fontWeight: 600 }}>{formatCapRangeValue(capRange.max)}</span>
                </div>
              )}
              <span style={{
                padding: `${SPACE.xs}px ${SPACE.sm + 2}px`, background: F.cream50,
                border: `1px solid ${F.border}`, borderRadius: RADIUS.pill,
                fontSize: TYPE.body.sm, fontWeight: 500, color: F.ink,
                whiteSpace: 'nowrap',
              }}>Expand</span>
            </div>
          )}

          {expanded && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0, marginLeft: SPACE.sm, paddingRight: SPACE.lg }}>
              <div ref={filterRef} style={{ position: 'relative' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setFilterOpen((o) => !o); setSortOpen(false); }}
                  style={toolbarButtonStyle(filterCount > 0)}
                >
                  Filter{filterCount > 0 ? ` · ${filterCount}` : ''}
                </button>
                {filterOpen && (
                  <div style={popoverStyle(220)}>
                    <PopoverHead>Likelihood</PopoverHead>
                    {LIKELIHOOD_OPTIONS.map((opt) => {
                      const checked = likelihoodFilter.has(opt.kind);
                      return (
                        <label key={opt.kind} style={checkRowStyle}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleLikelihood(opt.kind)}
                            style={{ accentColor: F.fenway }}
                          />
                          {opt.label}
                        </label>
                      );
                    })}
                    {filterCount > 0 && (
                      <button
                        onClick={() => setLikelihoodFilter(new Set())}
                        style={clearButtonStyle}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>
              <span style={toolbarDividerStyle} />
              <div ref={sortRef} style={{ position: 'relative' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setSortOpen((o) => !o); setFilterOpen(false); }}
                  style={toolbarButtonStyle(isCustomSort)}
                >
                  {isCustomSort ? `Sort · ${sortShort}` : 'Sort'}
                </button>
                {sortOpen && (
                  <div style={popoverStyle(250)}>
                    <PopoverHead>Sort by · {sortLabel}</PopoverHead>
                    {SORT_OPTIONS.map((opt) => {
                      const checked = sortBy === opt.key;
                      return (
                        <label key={opt.key} style={checkRowStyle}>
                          <input
                            type="radio"
                            name="options-sort"
                            checked={checked}
                            onChange={() => { setSortBy(opt.key); setSortOpen(false); }}
                            style={{ accentColor: F.fenway }}
                          />
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
              <span style={toolbarDividerStyle} />
              <button
                onClick={(e) => { e.stopPropagation(); exportCsv(); }}
                title="Download options as CSV"
                style={toolbarButtonStyle(false)}
              >
                Export
              </button>
            </div>
          )}
        </div>

        {expanded && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '26%' }} />
                <col style={{ width: '32%' }} />
                <col style={{ width: '25%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '7%' }} />
              </colgroup>
              <thead>
                <tr>
                  {HEAD.map((h) => (
                    <th key={h} style={{
                      padding: `${SPACE.sm}px ${SPACE.md + 2}px`, background: 'transparent',
                      fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 600,
                      color: F.fgMuted, letterSpacing: TRACKING.body, textTransform: 'uppercase',
                      textAlign: h === 'Evidence' ? 'right' : 'left',
                      borderTop: `1px solid ${F.border}`,
                      borderBottom: `1px solid ${F.border}`, whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => {
                  const probColor = r.likelihood_kind === 'executable'
                    ? F.fenway
                    : r.likelihood_kind === 'speculative'
                      ? F.amber
                      : F.accent;
                  const isOpen = openOptionRef === r.ref_index;
                  const cellBorder = isOpen || ri === rows.length - 1 ? 'none' : `1px solid ${F.border}`;
                  const netCapPos = capNumber(r) >= 0;
                  const epmPos = !(r.epm ?? '').trim().startsWith('-') && !(r.epm ?? '').trim().startsWith('−');
                  const details = detailsFor(r);
                  const evidenceRefs = evidenceRefsFor(r);
                  const constraint = optionConstraint(r, details);
                  const nextStep = specificNextStep(details);
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => selectOption(r)}
                        style={{
                          cursor: 'pointer',
                          background: isOpen ? F.cream50 : F.surface,
                          transition: 'background 120ms ease',
                        }}
                      >
                        <td style={{ padding: `${SPACE.md}px ${SPACE.md + 2}px`, borderBottom: cellBorder, verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, minWidth: 0 }}>
                            <span style={{
                              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.accent, fontWeight: 700,
                              padding: `2px ${SPACE.xs + 2}px`, background: F.cream50, borderRadius: RADIUS.sm,
                              border: `1px solid ${F.border}`, flexShrink: 0,
                            }}>[{r.ref_index}]</span>
                            <div style={{ minWidth: 0 }}>
                              <div style={{
                                fontFamily: 'var(--font-sans)', fontSize: TYPE.body.lg, fontWeight: 600,
                                color: F.ink, letterSpacing: TRACKING.tight,
                              }}>{r.title}</div>
                              {r.subtitle && (
                                <div style={{ fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.fgMuted, marginTop: 2, fontWeight: 400 }}>
                                  {r.subtitle}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: `${SPACE.md}px ${SPACE.md + 2}px`, borderBottom: cellBorder, verticalAlign: 'top' }}>
                          <div style={metricStripStyle}>
                            <Metric label="Cap" value={r.net_cap_label} positive={netCapPos} />
                            {r.epm && (
                              <Metric label="EPA" value={r.epm} positive={epmPos} />
                            )}
                          </div>
                          <FirstLookLine label="Upside" text={details.upside} />
                          <FirstLookLine label="Risk" text={details.downside} />
                        </td>
                        <td style={{ padding: `${SPACE.md}px ${SPACE.md + 2}px`, borderBottom: cellBorder, verticalAlign: 'top' }}>
                          <FirstLookLine label={constraint.label} text={constraint.text} />
                          {nextStep && <FirstLookLine label="Next" text={nextStep} />}
                          <FirstLookLine
                            label="Window"
                            text={[r.timing ? formatTiming(r.timing) : null, r.cba_section].filter(Boolean).join(' · ') || '-'}
                          />
                        </td>
                        <td style={{ padding: `${SPACE.md}px ${SPACE.md + 2}px`, borderBottom: cellBorder, verticalAlign: 'top' }}>
                          <div style={{ fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.inkSoft, fontWeight: 600, textTransform: 'capitalize', marginBottom: 3 }}>
                            {r.likelihood_kind}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm + 2 }}>
                            <ProbBar pct={r.likelihood_pct} color={probColor} width={56} height={4} />
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: TYPE.body.md, fontWeight: 500, color: F.inkSoft, fontVariantNumeric: 'tabular-nums' }}>
                              {r.likelihood_pct}%
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: `${SPACE.md}px ${SPACE.md + 2}px`, borderBottom: cellBorder, textAlign: 'right', verticalAlign: 'top' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); viewEvidence(r); }}
                            title="Show evidence backing this option"
                            style={pillButtonStyle}
                          >
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                            {evidenceRefs.length || r.src_count} refs
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={HEAD.length} style={{ padding: 0, borderBottom: ri === rows.length - 1 ? 'none' : `1px solid ${F.border}` }}>
                            <OptionDrawer
                              row={r}
                              details={details}
                              evidenceRefs={evidenceRefs}
                              onViewEvidence={() => viewEvidence(r)}
                              onOpenEvidence={(ref) => openEvidenceSource(r, ref)}
                              onAnalyzeFurther={() => analyzeOptionFurther(r)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function OptionDrawer({
  row,
  details,
  evidenceRefs,
  onViewEvidence,
  onOpenEvidence,
  onAnalyzeFurther,
}: {
  row: BriefOption;
  details: BriefOptionDetails;
  evidenceRefs: number[];
  onViewEvidence: () => void;
  onOpenEvidence: (ref: number) => void;
  onAnalyzeFurther: () => void;
}) {
  const candidateMoves = candidateMovesFor(details);
  const [scenarioCandidate, setScenarioCandidate] = useState<BriefOptionMoveCandidate | null>(null);
  const netCapPos = capNumber(row) >= 0;
  const epmPos = !(row.epm ?? '').trim().startsWith('-') && !(row.epm ?? '').trim().startsWith('−');
  const windowText = [row.timing ? formatTiming(row.timing) : null, row.cba_section].filter(Boolean).join(' · ') || 'Not specified';

  return (
    <div style={drawerShellStyle}>
      <div style={drawerHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={drawerEyebrowStyle}>Option [{row.ref_index}]</div>
          <div style={drawerTitleStyle}>{row.title}</div>
          <div style={drawerQuestionStyle}>{row.subtitle ?? details.decision_question}</div>
        </div>
        <div style={drawerMetricClusterStyle}>
          <Metric label="Cap" value={row.net_cap_label} positive={netCapPos} />
          {row.epm && <Metric label="EPA" value={row.epm} positive={epmPos} />}
          <span style={drawerMetricTextStyle}>{row.likelihood_pct}% {row.likelihood_kind}</span>
          <span style={drawerMetricTextStyle}>{windowText}</span>
        </div>
      </div>

      <section style={candidateSectionStyle}>
        <div style={drawerSectionHeaderStyle}>
          <div>
            <div style={drawerEyebrowStyle}>Candidate moves</div>
            <div style={drawerSectionSubtleStyle}>
              {candidateMoves.length ? `${candidateMoves.length} named ${candidateMoves.length === 1 ? 'construction' : 'constructions'}` : 'No named construction supported yet'}
            </div>
          </div>
        </div>
        {candidateMoves.length ? (
          <div style={candidateListStyle}>
            {candidateMoves.map((candidate, i) => (
              <MoveCandidateCard
                key={`${candidate.label}-${i}`}
                candidate={candidate}
                fallbackRefs={evidenceRefs}
                onOpenEvidence={onOpenEvidence}
                onOpenScenario={() => setScenarioCandidate(candidate)}
              />
            ))}
          </div>
        ) : (
          <MoveCandidateEmpty />
        )}
      </section>

      <section style={optionInfoGridStyle}>
        <OptionInfoBlock title="Basketball value" body={details.upside} support={details.why_this} />
        <OptionInfoBlock title="Cost / tradeoff" body={details.downside} />
        <OptionInfoBlock
          title="Open constraints"
          items={[
            ...details.blockers.filter(Boolean),
            ...details.watch_triggers.filter(Boolean),
          ]}
          empty="No specific unresolved constraint supplied."
        />
      </section>

      <div style={drawerFooterStyle}>
        <div style={evidenceRailStyle}>
          <span style={drawerEyebrowStyle}>Evidence</span>
          {evidenceRefs.map((ref) => (
            <button key={ref} onClick={() => onOpenEvidence(ref)} style={evidenceChipStyle}>
              [{ref}]
            </button>
          ))}
          <button onClick={onViewEvidence} style={subtleActionStyle}>View all</button>
        </div>
        <button
          onClick={onAnalyzeFurther}
          style={strategicOptionActionStyle}
          title="Analyze this whole strategic option further"
          aria-label={`Analyze strategic option ${row.ref_index} further`}
        >
          Analyze option further
        </button>
      </div>
      {scenarioCandidate && (
        <CandidateScenarioModal
          option={row}
          details={details}
          candidate={scenarioCandidate}
          fallbackRefs={evidenceRefs}
          onOpenEvidence={onOpenEvidence}
          onClose={() => setScenarioCandidate(null)}
        />
      )}
    </div>
  );
}

function MoveCandidateCard({
  candidate,
  fallbackRefs,
  onOpenEvidence,
  onOpenScenario,
}: {
  candidate: BriefOptionMoveCandidate;
  fallbackRefs: number[];
  onOpenEvidence: (ref: number) => void;
  onOpenScenario: () => void;
}) {
  const refs = candidateEvidenceRefs(candidate, fallbackRefs);
  const target = candidateTargetLabel(candidate) ?? candidate.label;
  const fit = detailText(candidate.basketball_fit) ?? detailText(candidate.why);
  const subjectTeamId = candidate.subject_team_id?.trim().toUpperCase() || 'GSW';
  return (
    <div
      style={moveCandidateCardStyle}
      role="button"
      tabIndex={0}
      onClick={onOpenScenario}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpenScenario();
        }
      }}
      title={`Turn ${target} into a project scenario`}
    >
      <div style={moveCandidateHeaderStyle}>
        <div>
          <div style={moveCandidateTitleStyle}>{target}</div>
          {target !== candidate.label && detailText(candidate.label) && (
            <div style={moveCandidateLabelStyle}>{candidate.label}</div>
          )}
        </div>
        <div style={moveCandidateEvidenceStyle}>
          {refs.slice(0, 3).map((ref) => (
            <button
              key={ref}
              onClick={(event) => {
                event.stopPropagation();
                onOpenEvidence(ref);
              }}
              style={miniEvidenceChipStyle}
            >
              [{ref}]
            </button>
          ))}
        </div>
      </div>
      {fit && <div style={moveCandidateWhyStyle}>{fit}</div>}
      <div style={candidateFactGridStyle}>
        <CandidateFact label={candidate.outgoing_package ? `${subjectTeamId} sends` : 'Construction'} text={candidate.outgoing_package ?? candidate.mechanism} />
        <CandidateFact label="Salary / CBA" text={candidate.salary_match} />
        <CandidateFact label="Likely cost" text={candidate.cost} />
        <CandidateFact label="Constraint" text={candidate.constraints} />
      </div>
      <div style={moveCandidateActionStyle}>Scenario details</div>
    </div>
  );
}

function CandidateFact({ label, text }: { label: string; text: string | null | undefined }) {
  const body = detailText(text);
  if (!body) return null;
  return (
    <div style={candidateFactStyle}>
      <span style={candidateFactLabelStyle}>{label}</span>
      <span style={candidateFactBodyStyle}>{body}</span>
    </div>
  );
}

function MoveCandidateEmpty() {
  return (
    <div style={moveCandidateEmptyStyle}>
      <div style={moveCandidateEmptyTitleStyle}>No named player/team construction is supported by the current evidence.</div>
      <div style={moveCandidateEmptyBodyStyle}>
        The useful version here is target, outgoing package, salary mechanics, cost, constraint, and source refs.
      </div>
    </div>
  );
}

function OptionInfoBlock({
  title,
  body,
  support,
  items,
  empty,
}: {
  title: string;
  body?: string;
  support?: string;
  items?: string[];
  empty?: string;
}) {
  const visible = (items ?? []).filter(Boolean).slice(0, 4);
  return (
    <div style={optionInfoBlockStyle}>
      <div style={optionInfoTitleStyle}>{title}</div>
      {body && <div style={optionInfoBodyStyle}>{body}</div>}
      {support && support !== body && <div style={optionInfoSupportStyle}>{support}</div>}
      {visible.length > 0 ? (
        <div style={optionInfoListStyle}>
          {visible.map((item, i) => (
            <div key={`${item}-${i}`} style={optionInfoListRowStyle}>
              <span style={optionInfoBulletStyle} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      ) : !body ? (
        <div style={emptyListStyle}>{empty ?? 'No detail supplied.'}</div>
      ) : null}
    </div>
  );
}

function FirstLookLine({ label, text }: { label: string; text: string }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '50px minmax(0, 1fr)',
      gap: SPACE.sm,
      alignItems: 'baseline',
      marginTop: SPACE.xs + 2,
      minWidth: 0,
    }}>
      <span style={{
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        fontWeight: 600,
        color: F.fg,
        letterSpacing: TRACKING.body,
        whiteSpace: 'nowrap',
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        color: F.inkSoft,
        lineHeight: 1.38,
        minWidth: 0,
      }}>{text}</span>
    </div>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <span style={metricItemStyle}>
      <span style={metricLabelStyle}>{label}</span>
      <span style={{ ...metricValueStyle, color: positive ? F.positive : F.red }}>{value}</span>
    </span>
  );
}

function PopoverHead({ children }: { children: ReactNode }) {
  return (
    <div style={{
      padding: `${SPACE.xs}px ${SPACE.md + 2}px ${SPACE.xs + 2}px`,
      fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 600,
      color: F.fgMuted, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
    }}>{children}</div>
  );
}

function toolbarButtonStyle(active: boolean): CSSProperties {
  return {
    padding: `${SPACE.xs}px ${SPACE.sm}px`, background: active ? F.fenwaySoft : 'transparent',
    border: 'none', fontSize: TYPE.body.sm,
    color: active ? F.fenway : F.inkSoft,
    cursor: 'pointer', fontFamily: 'var(--font-sans)', fontWeight: 500,
    borderRadius: RADIUS.md, whiteSpace: 'nowrap',
  };
}

function popoverStyle(minWidth: number): CSSProperties {
  return {
    position: 'absolute', top: `calc(100% + ${SPACE.xs + 2}px)`, right: 0, zIndex: 30,
    minWidth, background: F.surface,
    border: `1px solid ${F.borderStrong}`, borderRadius: RADIUS.md,
    boxShadow: F.shadowPop,
    padding: `${SPACE.sm}px 0`,
  };
}

const checkRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: SPACE.sm,
  padding: `${SPACE.xs + 2}px ${SPACE.md + 2}px`,
  fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md, color: F.ink,
  cursor: 'pointer',
};

const clearButtonStyle: CSSProperties = {
  margin: `${SPACE.xs + 2}px ${SPACE.md + 2}px ${SPACE.xs}px`,
  padding: `${SPACE.xs}px ${SPACE.sm + 2}px`,
  background: 'transparent', color: F.fgMuted,
  border: `1px solid ${F.border}`, borderRadius: RADIUS.sm,
  fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 500,
  cursor: 'pointer',
};

const toolbarDividerStyle: CSSProperties = {
  width: 1,
  height: 12,
  background: F.border,
};

const pillButtonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: SPACE.xs,
  fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, fontWeight: 500,
  color: F.fgMuted, fontVariantNumeric: 'tabular-nums',
  padding: `3px ${SPACE.sm}px`, background: F.cream50,
  border: 'none', borderRadius: RADIUS.pill,
  cursor: 'pointer', whiteSpace: 'nowrap',
};

const metricStripStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.sm + 2,
  flexWrap: 'wrap',
  marginBottom: SPACE.sm,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.md,
  fontVariantNumeric: 'tabular-nums',
};

const metricItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: SPACE.xs + 1,
  whiteSpace: 'nowrap',
};

const metricLabelStyle: CSSProperties = {
  color: F.fgMuted,
  fontWeight: 600,
};

const metricValueStyle: CSSProperties = {
  fontWeight: 700,
};

const drawerEyebrowStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 700,
  color: F.fgMuted,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
  marginBottom: SPACE.xs,
};

const drawerShellStyle: CSSProperties = {
  padding: `${SPACE.lg}px ${SPACE.lg}px ${SPACE.lg}px`,
  background: F.cream50,
  display: 'grid',
  gap: SPACE.md,
  minWidth: 0,
  boxSizing: 'border-box',
};

const drawerHeaderStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: SPACE.sm,
  alignItems: 'start',
  minWidth: 0,
};

const drawerTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: TYPE.display.md,
  lineHeight: 1.25,
  color: F.ink,
  fontWeight: 650,
  letterSpacing: TRACKING.body,
};

const drawerQuestionStyle: CSSProperties = {
  marginTop: SPACE.xs + 2,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  lineHeight: 1.42,
  color: F.inkSoft,
  maxWidth: 760,
};

const drawerMetricClusterStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: SPACE.sm,
  flexWrap: 'wrap',
  minWidth: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.md,
  fontVariantNumeric: 'tabular-nums',
};

const drawerMetricTextStyle: CSSProperties = {
  color: F.fg,
  whiteSpace: 'nowrap',
};

const candidateSectionStyle: CSSProperties = {
  paddingTop: SPACE.xs,
  borderTop: `1px solid ${F.border}`,
  minWidth: 0,
};

const drawerSectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: SPACE.md,
  marginBottom: SPACE.sm,
};

const drawerSectionSubtleStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.fgMuted,
  lineHeight: 1.35,
};

const candidateListStyle: CSSProperties = {
  display: 'grid',
  gap: 0,
  borderTop: `1px solid ${F.border}`,
};

const moveCandidateCardStyle: CSSProperties = {
  padding: `${SPACE.md}px 0 ${SPACE.md + 2}px`,
  borderBottom: `1px solid ${F.border}`,
  display: 'grid',
  gap: SPACE.sm,
  minWidth: 0,
  cursor: 'pointer',
  outlineColor: F.fenway,
  outlineOffset: 4,
};

const moveCandidateHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: SPACE.sm,
  minWidth: 0,
};

const moveCandidateTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  lineHeight: 1.35,
  fontWeight: 650,
  color: F.ink,
  minWidth: 0,
};

const moveCandidateLabelStyle: CSSProperties = {
  marginTop: 2,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.3,
  color: F.fgMuted,
};

const moveCandidateWhyStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
  lineHeight: 1.38,
  maxWidth: 980,
};

const moveCandidateEvidenceStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.xs,
  flexShrink: 0,
};

const candidateFactGridStyle: CSSProperties = {
  display: 'grid',
  gap: SPACE.xs + 2,
  alignItems: 'start',
  minWidth: 0,
};

const moveCandidateActionStyle: CSSProperties = {
  justifySelf: 'start',
  padding: `${SPACE.xs + 1}px ${SPACE.sm + 2}px`,
  background: F.fenwaySoft,
  color: F.fenway,
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.pill,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 650,
};

const candidateFactStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '112px minmax(0, 1fr)',
  alignContent: 'start',
  gap: SPACE.md,
  alignSelf: 'start',
  alignItems: 'baseline',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.34,
  minWidth: 0,
};

const candidateFactLabelStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 700,
  color: F.fgMuted,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
  transform: 'translateY(-1px)',
};

const candidateFactBodyStyle: CSSProperties = {
  color: F.inkSoft,
  display: 'block',
  minWidth: 0,
  overflowWrap: 'anywhere',
};

const moveCandidateEmptyStyle: CSSProperties = {
  padding: `${SPACE.sm}px 0`,
  display: 'grid',
  justifyItems: 'start',
  gap: SPACE.xs + 2,
  minWidth: 0,
};

const moveCandidateEmptyTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  fontWeight: 650,
  color: F.ink,
  lineHeight: 1.35,
};

const moveCandidateEmptyBodyStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
  lineHeight: 1.4,
};

const optionInfoGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: SPACE.lg,
  paddingTop: SPACE.md,
  borderTop: `1px solid ${F.border}`,
  minWidth: 0,
};

const optionInfoBlockStyle: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: SPACE.xs,
  minWidth: 0,
};

const optionInfoTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 700,
  color: F.fgMuted,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const optionInfoBodyStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  color: F.ink,
  lineHeight: 1.4,
};

const optionInfoSupportStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
  lineHeight: 1.35,
};

const optionInfoListStyle: CSSProperties = {
  display: 'grid',
  gap: SPACE.xs,
  marginTop: SPACE.xs,
};

const optionInfoListRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '7px minmax(0, 1fr)',
  gap: SPACE.sm,
  alignItems: 'baseline',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.inkSoft,
  lineHeight: 1.34,
};

const optionInfoBulletStyle: CSSProperties = {
  width: 4,
  height: 4,
  borderRadius: RADIUS.pill,
  background: F.fgMuted,
  transform: 'translateY(-2px)',
};

const emptyListStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.fgMuted,
  lineHeight: 1.38,
};

const drawerFooterStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: SPACE.sm,
  flexWrap: 'wrap',
  paddingTop: SPACE.sm,
  borderTop: `1px solid ${F.border}`,
  minWidth: 0,
};

const evidenceRailStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.sm,
  flexWrap: 'wrap',
  minWidth: 0,
};

const evidenceChipStyle: CSSProperties = {
  padding: `2px ${SPACE.sm}px`,
  background: F.surface,
  color: F.fenway,
  border: `1px solid ${F.fenway}`,
  borderRadius: RADIUS.pill,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.md,
  fontWeight: 700,
  cursor: 'pointer',
};

const miniEvidenceChipStyle: CSSProperties = {
  padding: `1px ${SPACE.xs + 2}px`,
  background: F.fenwaySoft,
  color: F.fenway,
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.pill,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const subtleActionStyle: CSSProperties = {
  padding: `${SPACE.xs}px ${SPACE.sm + 2}px`,
  background: 'transparent',
  color: F.fenway,
  border: `1px solid ${F.fenway}`,
  borderRadius: RADIUS.md,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 500,
  cursor: 'pointer',
};

const strategicOptionActionStyle: CSSProperties = {
  ...subtleActionStyle,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 40,
  padding: `${SPACE.sm}px ${SPACE.lg}px`,
  background: F.fenway,
  color: F.surface,
  borderColor: F.fenway,
  boxShadow: F.shadowSoft,
  fontWeight: 650,
  whiteSpace: 'nowrap',
};
