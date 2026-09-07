import { useEffect, useMemo, useState } from 'react';
import type { CbaSection, GetCurrentNflTeamResponse, NflDataHealthResponse, NflWorkspaceSummary } from '@shared/types';
import { getCurrentNflCapSheet, getNflDataHealth } from '../api/nfl';
import { resolveBriefShareToken } from '../api/briefs';
import { getNflRuleArticle, listNflRules } from '../api/nflRules';
import { createNflWorkspace, listNflWorkspaces } from '../api/nflWorkspace';
import { AnalysisWorkspace } from '../analysis/AnalysisWorkspace';
import { fire, on as onEvt } from '../lib/events';
import { useBriefs, useSessions, useToasts, useUi } from '../store';
import './nyg.css';

type View = 'analysis' | 'briefing' | 'workspaces' | 'roster' | 'rulebook' | 'settings';
const NAV: Array<{ id: View; label: string }> = [
  { id: 'analysis', label: 'Analysis' }, { id: 'briefing', label: 'Briefing' },
  { id: 'workspaces', label: 'Workspaces' }, { id: 'roster', label: 'Roster & Cap' },
  { id: 'rulebook', label: 'Rulebook' }, { id: 'settings', label: 'Settings' },
];

export function NygApp() {
  const [view, setView] = useState<View>('analysis');
  const [health, setHealth] = useState<NflDataHealthResponse | null>(null);
  const [roster, setRoster] = useState<GetCurrentNflTeamResponse | null>(null);
  const [rules, setRules] = useState<CbaSection[]>([]);
  const [workspaces, setWorkspaces] = useState<NflWorkspaceSummary[]>([]);
  const [focusedRule, setFocusedRule] = useState<CbaSection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);
  const [pendingAnalysisQuestion, setPendingAnalysisQuestion] = useState<string | null>(null);
  const { sessionsLoaded, setActiveSession } = useSessions();
  const { briefs, briefsLoaded, setActiveBrief } = useBriefs();
  const { pushToast } = useToasts();
  const { setExpandedBrief, setRightPanelMode, setRightPanelOpen } = useUi();

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getNflDataHealth('NYG'), getCurrentNflCapSheet('NYG', { force: true }), listNflRules()])
      .then(([nextHealth, nextRoster, toc]) => {
        if (cancelled) return;
        setHealth(nextHealth);
        setRoster(nextRoster);
        setRules(toc.sections);
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void listNflWorkspaces().then(setWorkspaces).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);
  useEffect(() => onEvt('nyg:open-workspaces', ({ refresh }) => {
    setView('workspaces');
    if (refresh) void listNflWorkspaces().then(setWorkspaces).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }), []);

  useEffect(() => {
    if (view !== 'analysis' || !pendingAnalysisQuestion) return;
    fire('v6d3cf:prefill-composer', { text: pendingAnalysisQuestion });
    fire('v6d3cf:focus-composer');
    setPendingAnalysisQuestion(null);
  }, [pendingAnalysisQuestion, view]);

  useEffect(() => {
    if (deepLinkHandled || !sessionsLoaded || !briefsLoaded) return;
    const params = new URLSearchParams(window.location.search);
    const linkedBriefId = params.get('brief');
    const shareToken = params.get('share');
    if (!linkedBriefId && !shareToken) { setDeepLinkHandled(true); return; }
    let cancelled = false;
    void (async () => {
      try {
        let briefId = linkedBriefId;
        let sessionId: string | null = null;
        if (shareToken) {
          const resolved = await resolveBriefShareToken(shareToken);
          briefId = resolved.brief_id;
          sessionId = resolved.session_id;
        } else if (briefId) sessionId = briefs.find((brief) => brief.id === briefId)?.session_id ?? null;
        if (!briefId || cancelled) return;
        if (sessionId) setActiveSession(sessionId);
        setActiveBrief(briefId);
        setExpandedBrief(briefId);
        setRightPanelMode('thread');
        setRightPanelOpen(true);
        setView('analysis');
      } catch (caught) {
        if (!cancelled) pushToast({ tone: 'error', message: 'Couldn’t open shared brief', detail: caught instanceof Error ? caught.message : 'Share link could not be resolved.' });
      } finally {
        if (!cancelled) {
          params.delete('brief'); params.delete('share');
          const next = params.toString();
          window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`);
          setDeepLinkHandled(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [briefs, briefsLoaded, deepLinkHandled, pushToast, sessionsLoaded, setActiveBrief, setActiveSession, setExpandedBrief, setRightPanelMode, setRightPanelOpen]);

  async function createWorkspace(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed) return;
    const created = await createNflWorkspace({ question: trimmed });
    setWorkspaces((current) => [created.workspace, ...current.filter((item) => item.id !== created.workspace.id)]);
  }

  async function openRule(ruleId: string) {
    try { const detail = await getNflRuleArticle(ruleId); setFocusedRule(detail.section); setView('rulebook'); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }

  function openWorkspaceAnalysis(workspace: NflWorkspaceSummary | null): void {
    setActiveSession(workspace?.session_id ?? null);
    setActiveBrief(null);
    setPendingAnalysisQuestion(workspace?.question ?? null);
    setView('analysis');
  }

  const sourceDate = health?.datasets.find((dataset) => dataset.id === 'roster')?.as_of_date;
  return <div className="nyg-app">
    <header className="nyg-header">
      <button className="nyg-wordmark" onClick={() => setView('analysis')} aria-label="Open Analysis"><span className="nyg-monogram">NY</span><span><strong>GIANTS</strong><small>FOOTBALL OPERATIONS</small></span></button>
      <nav aria-label="Primary navigation">{NAV.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>)}</nav>
      <div className="nyg-header-actions"><span className="public-badge">Public demo data</span></div>
    </header>
    <div className="nyg-statusbar"><StatusDot status={health?.meeting_ready ? 'ready' : health ? 'blocked' : 'loading'} /><span>{health?.meeting_ready ? `Roster & cap current through ${sourceDate ? formatDate(sourceDate) : 'the latest public update'}` : health ? 'Public data needs attention' : 'Checking public data'}</span></div>
    {error && <div className="nyg-alert" role="alert"><strong>Couldn’t load current data.</strong> {error}</div>}
    <main className={`nyg-main ${view === 'analysis' ? 'nyg-main-analysis' : ''}`}>
      {view === 'analysis' && <><div className="analysis-modebar analysis-modebar-single"><div><strong>Analysis</strong></div></div><AnalysisWorkspace /></>}
      {view === 'briefing' && <Briefing health={health} onOpenAnalysis={() => setView('analysis')} onOpenRoster={() => setView('roster')} />}
      {view === 'workspaces' && <Workspaces workspaces={workspaces} onCreate={createWorkspace} onOpenAnalysis={openWorkspaceAnalysis} />}
      {view === 'roster' && <RosterCap roster={roster} />}
      {view === 'rulebook' && <Rulebook rules={rules} focused={focusedRule} onOpen={(id) => void openRule(id)} onAnalyze={() => setView('analysis')} />}
      {view === 'settings' && <Settings health={health} />}
    </main>
  </div>;
}

function Briefing({ health, onOpenAnalysis, onOpenRoster }: { health: NflDataHealthResponse | null; onOpenAnalysis: () => void; onOpenRoster: () => void }) {
  const transactions = health?.datasets.find((dataset) => dataset.id === 'transaction_market');
  return <section className="page-shell"><PageTitle eyebrow="New York Giants" title="Football operations briefing" subtitle="Start with a question, calculate the market from public history, then inspect the transactions and contracts behind the answer." />
    <div className="briefing-grid"><article className="hero-brief"><span className="kicker">Primary workspace</span><h2>Interrogate the NFL transaction market.</h2><p>Ask an unfamiliar position-market question and get a fresh calculation from the local transaction history. Test a proposed Giants return inside the result when the contract data supports it.</p><div className="brief-metrics"><Metric label="Transactions" value={transactions?.row_count.toLocaleString() ?? 'Checking'} /><Metric label="Market through" value={transactions?.as_of_date ? formatDate(transactions.as_of_date) : 'Checking'} /><Metric label="Status" value={transactions?.status === 'ready' ? 'Current' : 'Needs attention'} /></div><button className="primary-button" onClick={onOpenAnalysis}>Open Analysis</button></article>
      <article className="readiness-card"><span className="kicker">Public data</span><h3>{health?.meeting_ready ? 'Current for review' : 'Needs attention'}</h3><p>{health?.meeting_ready ? 'Roster, contracts, transactions, and cited rules are available from the loaded public sources.' : 'The affected figures will be omitted or clearly marked until the public source issue is resolved.'}</p><HealthRows health={health} /></article></div>
    <div className="section-heading"><div><span className="kicker">Where to go next</span><h2>Supporting views</h2></div></div><div className="queue-grid"><QueueCard state="Ask" title="Historical position markets" body="Compare player movement, contract cost, and trade returns from the loaded transaction history." onClick={onOpenAnalysis} /><QueueCard state="Inspect" title="Giants roster and contracts" body="Review the current public cap rows used when you test a player move." onClick={onOpenRoster} /><QueueCard state="Verify" title="Sources and coverage" body="Check dates, record counts, and any gaps before relying on a conclusion." onClick={onOpenAnalysis} /></div>
  </section>;
}

function Workspaces({ workspaces, onCreate, onOpenAnalysis }: { workspaces: NflWorkspaceSummary[]; onCreate: (question: string) => Promise<void>; onOpenAnalysis: (workspace: NflWorkspaceSummary | null) => void }) {
  const stages = [
    { id: 'question', label: 'Question', note: 'State the football decision.' },
    { id: 'evidence', label: 'Evidence', note: 'Review market history and current team facts.' },
    { id: 'scenarios', label: 'Scenarios', note: 'Test terms that matter.' },
    { id: 'decision', label: 'Decision', note: 'Record the football judgment.' },
    { id: 'action_plan', label: 'Action Plan', note: 'Assign the next checks.' },
  ];
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0] ?? null;
  const currentStage = Math.max(0, stages.findIndex((stage) => stage.id === selected?.stage));
  async function submitDraft() {
    if (!draftQuestion.trim() || creating) return;
    setCreating(true); setCreateError(null);
    try { await onCreate(draftQuestion); setDraftQuestion(''); setDraftOpen(false); }
    catch (caught) { setCreateError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setCreating(false); }
  }
  return <section className="page-shell"><div className="workspace-title-row"><PageTitle eyebrow="Workspaces · NYG" title={selected?.title ?? 'Decision workspaces'} subtitle="Keep the question, supporting history, scenarios, decision, and action plan together." /><button className="primary-button" onClick={() => setDraftOpen(true)}>+ New workspace</button></div>
    {draftOpen && <article className="workspace-draft"><div><span className="kicker">New workspace</span><h2>Start with the decision question</h2><p>The workspace begins when you submit the first question.</p></div><textarea aria-label="New workspace question" placeholder="What football decision needs a market and team-data check?" value={draftQuestion} onChange={(event) => setDraftQuestion(event.target.value)} /><div className="draft-actions"><button className="quiet-button" onClick={() => { setDraftOpen(false); setDraftQuestion(''); setCreateError(null); }}>Cancel</button><button className="primary-button" onClick={() => void submitDraft()} disabled={!draftQuestion.trim() || creating}>{creating ? 'Creating…' : 'Create from first question'}</button></div>{createError && <p className="settings-blocker">{createError}</p>}</article>}
    {workspaces.length > 0 && <div className="workspace-list" aria-label="NYG decision workspaces">{workspaces.map((workspace) => <button key={workspace.id} className={selected?.id === workspace.id ? 'selected' : ''} onClick={() => setSelectedId(workspace.id)}><span>{workspace.seeded ? 'Public data' : 'In progress'}</span><strong>{workspace.title}</strong><small>{workspace.question}</small></button>)}</div>}
    <div className="workspace-overview"><div><span className="kicker">Decision owner</span><strong>Football Operations</strong></div><div><span className="kicker">Current stage</span><strong>{selected ? stageLabel(selected.stage) : 'Question'}</strong></div><div><span className="kicker">Starting point</span><strong>Live Analysis</strong></div><button className="primary-button" onClick={() => onOpenAnalysis(selected)} disabled={!selected}>Continue in Analysis</button></div><div className="stage-track">{stages.map((stage, index) => <div key={stage.id} className={index < currentStage ? 'complete' : index === currentStage ? 'current' : ''}><span>{index < currentStage ? '✓' : index + 1}</span><strong>{stage.label}</strong><small>{stage.note}</small></div>)}</div><div className="workspace-notes"><article><span className="kicker">Decision statement</span><h3>{selected?.question ?? 'Which position market gives New York the best opportunity, and what terms would justify a move?'}</h3></article><article><span className="kicker">Next action</span><h3>Run the market question, inspect the strongest comparables, and confirm the selected Giants contract.</h3></article></div></section>;
}

function RosterCap({ roster }: { roster: GetCurrentNflTeamResponse | null }) {
  const rosterByPlayer = useMemo(() => new Map(roster?.roster_entries.map((entry) => [entry.player_id, entry]) ?? []), [roster]);
  const rows = [...(roster?.cap_rows ?? [])].filter((row) => row.player_id).sort((a, b) => {
    const aActive = rosterByPlayer.get(a.player_id!)?.roster_status === 'active' ? 1 : 0;
    const bActive = rosterByPlayer.get(b.player_id!)?.roster_status === 'active' ? 1 : 0;
    return bActive - aActive || (b.cap_number_2026 ?? -1) - (a.cap_number_2026 ?? -1);
  });
  const activeCount = roster?.roster_entries.filter((entry) => entry.roster_status === 'active').length;
  const commitments = rows.reduce((sum, row) => sum + (row.cap_number_2026 ?? 0), 0);
  const completeTradeRows = rows.filter((row) => row.source_status === 'captured' && row.post_june_1_trade_savings_2026 != null && row.post_june_1_trade_dead_money_2026 != null).length;
  return <section className="page-shell"><PageTitle eyebrow="Roster & Cap · NYG" title="Current roster and public contract mechanics" subtitle="Cap space and dead money are shown separately from the football judgment." /><div className="roster-summary"><Metric label="Active roster" value={activeCount == null ? '—' : String(activeCount)} /><Metric label="2026 commitments" value={money(commitments)} /><Metric label="Complete trade rows" value={String(completeTradeRows)} /><Metric label="As of" value={roster?.snapshot.as_of_date ? formatDate(roster.snapshot.as_of_date) : 'Checking'} /></div><div className="roster-table"><div className="roster-row roster-head"><span>Player</span><span>Pos.</span><span>Status</span><span>2026 cap</span><span>Post-June trade space</span><span>Dead money</span><span>Source</span></div>{rows.map((row) => { const rosterStatus = rosterByPlayer.get(row.player_id!)?.roster_status ?? 'unknown'; return <div className="roster-row" key={row.player_id ?? row.player_name}><span><strong>{row.player_name}</strong><small>{row.contract_lever.replace(/_/g, ' ')}</small></span><span>{row.position ?? '—'}</span><span>{rosterStatusLabel(rosterStatus)}</span><span>{row.cap_number_2026 == null ? 'Not available' : money(row.cap_number_2026)}</span><span className={row.post_june_1_trade_savings_2026 != null && row.post_june_1_trade_savings_2026 >= 0 ? 'positive' : ''}>{row.post_june_1_trade_savings_2026 == null ? 'Not available' : money(row.post_june_1_trade_savings_2026)}</span><span>{row.post_june_1_trade_dead_money_2026 == null ? 'Not available' : money(row.post_june_1_trade_dead_money_2026)}</span><span>{row.source_url ? <a className="source-link" href={row.source_url} target="_blank" rel="noreferrer">Open ↗</a> : 'Not available'}</span></div>; })}</div></section>;
}

function Rulebook({ rules, focused, onOpen, onAnalyze }: { rules: CbaSection[]; focused: CbaSection | null; onOpen: (id: string) => void; onAnalyze: () => void }) {
  const [query, setQuery] = useState('');
  const visible = rules.filter((rule) => `${rule.label} ${rule.section}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="page-shell"><PageTitle eyebrow="Rulebook · Official authority" title="Find the rule. See the locator. Return to the analysis." subtitle="Every rule summary includes an official URL and exact locator." /><div className="rulebook-layout"><div><input className="rule-search" aria-label="Search NFL rules" placeholder="Search June 1, restructure, waivers…" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="rule-list">{visible.length ? visible.map((rule) => <button key={rule.id} className={focused?.id === rule.id ? 'selected' : ''} onClick={() => onOpen(rule.id)}><strong>{rule.label}</strong><small>{rule.section}</small></button>) : <div className="empty-row">No supported rule matches. Refine the search.</div>}</div></div><article className="rule-detail">{focused ? <><span className="kicker">Official locator</span><h2>{focused.label}</h2><p className="rule-locator">{focused.section}</p><p>{focused.body}</p><a className="source-link" href={focused.source_url} target="_blank" rel="noreferrer">Open authoritative source ↗</a><button className="primary-button" onClick={onAnalyze}>Return to Analysis</button></> : <><span className="kicker">Authority first</span><h2>Select a rule family</h2><p>The exact source locator will appear here.</p></>}</article></div></section>;
}

function Settings({ health }: { health: NflDataHealthResponse | null }) { return <section className="page-shell"><PageTitle eyebrow="Public demo data" title="Sources and coverage" subtitle="Source dates and coverage shown exactly as they are available today." /><div className="settings-grid">{health?.datasets.map((dataset) => <article key={dataset.id}><div className="settings-title"><StatusDot status={dataset.status} /><div><strong>{dataset.label}</strong><small>{plainSourceName(dataset.source_name)}</small></div></div><dl><div><dt>As of</dt><dd>{dataset.as_of_date ? formatDate(dataset.as_of_date) : 'Not available'}</dd></div><div><dt>Retrieved</dt><dd>{dataset.retrieved_at ? formatTime(dataset.retrieved_at) : 'Not available'}</dd></div><div><dt>Records</dt><dd>{dataset.row_count.toLocaleString()}</dd></div></dl>{dataset.blocker && <p className="settings-blocker">{dataset.blocker}</p>}</article>)}<article className="placeholder-card"><span className="kicker">Team-only inputs</span><h3>Not connected</h3><p>Medical grades, internal valuations, staff evaluations, and club transaction systems are not connected to this public demo.</p></article></div></section>; }

function plainSourceName(value: string): string {
  return value.replace(/\s*\+\s*OverTheCap Contract Ledger v1/i, ' and OverTheCap contract data');
}
function HealthRows({ health }: { health: NflDataHealthResponse | null }) { return <div className="health-rows">{health?.datasets.map((dataset) => <div key={dataset.id}><StatusDot status={dataset.status} /><span>{dataset.label}</span><strong>{dataset.status === 'ready' ? 'current' : dataset.status}</strong></div>) ?? <div><StatusDot status="loading" /><span>Checking</span></div>}</div>; }
function QueueCard({ state, title, body, onClick }: { state: string; title: string; body: string; onClick: () => void }) { return <button className="queue-card" onClick={onClick}><span>{state}</span><strong>{title}</strong><p>{body}</p><small>Open →</small></button>; }
function PageTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <div className="page-title"><span className="kicker">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function StatusDot({ status }: { status: string }) { return <i className={`status-dot ${status}`} aria-hidden="true" />; }
function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value); }
function formatDate(value: string) { const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
function formatTime(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function rosterStatusLabel(value: string) { return ({ active: 'Active', cut: 'Released', res: 'Reserve', dev: 'Developmental', rsr: 'Reserve' } as Record<string, string>)[value] ?? value.replace(/_/g, ' '); }
function stageLabel(value: string) { return ({ research: 'Question', validate: 'Evidence', feedback: 'Scenarios', gm: 'Decision', proposal: 'Action Plan', question: 'Question', evidence: 'Evidence', scenarios: 'Scenarios', decision: 'Decision', action_plan: 'Action Plan' } as Record<string, string>)[value] ?? 'Question'; }
