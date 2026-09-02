import { useEffect, useMemo, useState } from 'react';
import type { CbaSection, GetCurrentNflTeamResponse, NflCapRosterAction, NflCapRosterBranch, NflCapRosterDecisionResponse, NflDataHealthResponse, NflWorkspaceSummary } from '@shared/types';
import { getCurrentNflCapSheet } from '../api/nfl';
import { getNflDataHealth, modelNflCapRoster } from '../api/nflDecision';
import { getNflRuleArticle, listNflRules } from '../api/nflRules';
import { createNflWorkspace, listNflWorkspaces } from '../api/nflWorkspace';
import './nyg.css';

type View = 'briefing' | 'decision' | 'workspaces' | 'roster' | 'rulebook' | 'settings';
const NAV: Array<{ id: View; label: string }> = [
  { id: 'briefing', label: 'Briefing' }, { id: 'decision', label: 'Decision Room' },
  { id: 'workspaces', label: 'Workspaces' }, { id: 'roster', label: 'Roster & Cap' },
  { id: 'rulebook', label: 'Rulebook' }, { id: 'settings', label: 'Settings' },
];
const DEFAULT_TARGET = 15_000_000;
const DEFAULT_GROUPS = ['QB'];

export function NygApp() {
  const presenter = new URLSearchParams(window.location.search).get('present') === 'nyg-cap-roster';
  const [view, setView] = useState<View>(presenter ? 'decision' : 'briefing');
  const [health, setHealth] = useState<NflDataHealthResponse | null>(null);
  const [decision, setDecision] = useState<NflCapRosterDecisionResponse | null>(null);
  const [roster, setRoster] = useState<GetCurrentNflTeamResponse | null>(null);
  const [rules, setRules] = useState<CbaSection[]>([]);
  const [workspaces, setWorkspaces] = useState<NflWorkspaceSummary[]>([]);
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [protectedPlayers, setProtectedPlayers] = useState<string[]>([]);
  const [protectedGroups, setProtectedGroups] = useState<string[]>(DEFAULT_GROUPS);
  const [selectedBranch, setSelectedBranch] = useState<NflCapRosterBranch['id']>('balanced');
  const [focusedAction, setFocusedAction] = useState<NflCapRosterAction | null>(null);
  const [focusedRule, setFocusedRule] = useState<CbaSection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(nextTarget = target, nextPlayers = protectedPlayers, nextGroups = protectedGroups) {
    setLoading(true); setError(null);
    try {
      const [nextHealth, nextRoster, toc, nextDecision] = await Promise.all([
        getNflDataHealth('NYG'), getCurrentNflCapSheet('NYG', { force: true }), listNflRules(),
        modelNflCapRoster({ team_id: 'NYG', target_relief_dollars: nextTarget, protected_player_ids: nextPlayers, protected_position_groups: nextGroups, allowed_levers: ['hold', 'pre_june_cut', 'post_june_cut', 'trade', 'restructure', 'extension'] }),
      ]);
      setHealth(nextHealth); setRoster(nextRoster); setRules(toc.sections); setDecision(nextDecision);
      setSelectedBranch(nextDecision.recommended_branch_id ?? 'maximize_relief');
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(DEFAULT_TARGET, [], DEFAULT_GROUPS); }, []);
  useEffect(() => {
    void listNflWorkspaces()
      .then(setWorkspaces)
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  async function createWorkspace(question: string): Promise<void> {
    const trimmed = question.trim();
    if (!trimmed) return;
    const created = await createNflWorkspace({ question: trimmed });
    setWorkspaces((current) => [created.workspace, ...current.filter((item) => item.id !== created.workspace.id)]);
  }

  async function openRule(ruleId: string) {
    try { const detail = await getNflRuleArticle(ruleId); setFocusedRule(detail.section); setView('rulebook'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  }
  function resetPresentation() {
    setView('decision'); setTarget(DEFAULT_TARGET); setProtectedPlayers([]); setProtectedGroups(DEFAULT_GROUPS);
    setSelectedBranch('balanced'); setFocusedAction(null); setFocusedRule(null); window.scrollTo({ top: 0 });
    void load(DEFAULT_TARGET, [], DEFAULT_GROUPS);
  }
  const sourceDate = health?.datasets.find((dataset) => dataset.id === 'roster')?.as_of_date;
  const branch = decision?.branches.find((candidate) => candidate.id === selectedBranch) ?? decision?.branches[0] ?? null;

  return <div className="nyg-app" data-presenter={presenter ? 'true' : 'false'}>
    <header className="nyg-header">
      <button className="nyg-wordmark" onClick={() => setView('briefing')} aria-label="Open Briefing"><span className="nyg-monogram">NY</span><span><strong>GIANTS</strong><small>FOOTBALL OPERATIONS</small></span></button>
      <nav aria-label="Primary navigation">{NAV.map((item) => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>)}</nav>
      <div className="nyg-header-actions"><span className="public-badge">Public demo data</span>{presenter && <button className="quiet-button" onClick={resetPresentation}>Reset presentation</button>}</div>
    </header>
    <div className="nyg-statusbar"><StatusDot status={health?.meeting_ready ? 'ready' : health ? 'blocked' : 'loading'} /><span>{health?.meeting_ready ? 'Preflight passed' : health ? 'Preflight blocked' : 'Checking sources'}</span><span className="status-separator" /><span>Roster & cap as of {sourceDate ? formatDate(sourceDate) : 'checking…'}</span><span className="status-separator" /><span>{health?.source_mode === 'supabase_current_views' ? 'DB-backed' : 'Fallback active'}</span></div>
    {error && <div className="nyg-alert" role="alert"><strong>Runtime check failed.</strong> {error}</div>}
    <main className="nyg-main">
      {view === 'briefing' && <Briefing health={health} decision={decision} onOpenDecision={() => setView('decision')} onOpenRoster={() => setView('roster')} />}
      {view === 'decision' && <DecisionRoom loading={loading} health={health} decision={decision} branch={branch} selectedBranch={selectedBranch} setSelectedBranch={setSelectedBranch} target={target} setTarget={setTarget} protectedGroups={protectedGroups} setProtectedGroups={setProtectedGroups} onRecompute={() => void load()} focusedAction={focusedAction} onFocusAction={setFocusedAction} onProtectPlayer={(id) => { const next = [...new Set([...protectedPlayers, id])]; setProtectedPlayers(next); void load(target, next, protectedGroups); }} onOpenRule={(id) => void openRule(id)} />}
      {view === 'workspaces' && <Workspaces onOpenDecision={() => setView('decision')} decision={decision} workspaces={workspaces} onCreate={createWorkspace} />}
      {view === 'roster' && <RosterCap roster={roster} onFocus={(action) => { setFocusedAction(action); setView('decision'); }} decision={decision} />}
      {view === 'rulebook' && <Rulebook rules={rules} focused={focusedRule} onOpen={(id) => void openRule(id)} onAnalyze={() => setView('decision')} />}
      {view === 'settings' && <Settings health={health} />}
    </main>
  </div>;
}

function Briefing({ health, decision, onOpenDecision, onOpenRoster }: { health: NflDataHealthResponse | null; decision: NflCapRosterDecisionResponse | null; onOpenDecision: () => void; onOpenRoster: () => void }) {
  return <section className="page-shell"><PageTitle eyebrow="New York Giants · September 2, 2026" title="Football operations briefing" subtitle="The decisions that need an owner, the evidence that can support them, and the triggers that change the call." />
    <div className="briefing-grid"><article className="hero-brief"><span className="kicker">Priority decision</span><h2>Build a verified cap-relief plan without sacrificing protected depth.</h2><p>The current model compares hold, depth-preserving, balanced, and maximum-relief branches. Every displayed dollar is reconciled to a player contract row.</p><div className="brief-metrics"><Metric label="Target" value={money(decision?.branches[0]?.target_relief_dollars ?? DEFAULT_TARGET)} /><Metric label="Supported maximum" value={money(decision?.branches.find((b) => b.id === 'maximize_relief')?.total_relief_dollars ?? 0)} /><Metric label="As of" value={decision?.baseline.as_of_date ? formatDate(decision.baseline.as_of_date) : 'Checking'} /></div><button className="primary-button" onClick={onOpenDecision}>Open decision room</button></article>
      <article className="readiness-card"><span className="kicker">Data health</span><h3>{health?.meeting_ready ? 'Meeting preflight passed' : 'Preflight needs attention'}</h3><p>{health?.meeting_ready ? 'Roster, contract mechanics, arithmetic, and rule locators clear the hero-workflow gate.' : 'No recommendation will be presented until blocking checks clear.'}</p><HealthRows health={health} /></article></div>
    <div className="section-heading"><div><span className="kicker">Decision queue</span><h2>What needs attention next</h2></div></div><div className="queue-grid"><QueueCard state="Ready" title="Cap & roster branch" body="Choose the smallest verified action set that clears the target." onClick={onOpenDecision} /><QueueCard state="Review" title="Depth replacement plan" body="Football review is required before any medium- or high-impact move." onClick={onOpenRoster} /><QueueCard state="Trigger" title="Contract ledger refresh" body="Recompute after a signing, release, extension, or league adjustment." onClick={onOpenDecision} /></div>
  </section>;
}

type DecisionProps = { loading: boolean; health: NflDataHealthResponse | null; decision: NflCapRosterDecisionResponse | null; branch: NflCapRosterBranch | null; selectedBranch: NflCapRosterBranch['id']; setSelectedBranch: (id: NflCapRosterBranch['id']) => void; target: number; setTarget: (value: number) => void; protectedGroups: string[]; setProtectedGroups: (value: string[]) => void; onRecompute: () => void; focusedAction: NflCapRosterAction | null; onFocusAction: (action: NflCapRosterAction | null) => void; onProtectPlayer: (id: string) => void; onOpenRule: (id: string) => void };
function DecisionRoom(props: DecisionProps) {
  const { loading, health, decision, branch } = props;
  if (!loading && health && !health.meeting_ready) return <BlockedPreflight health={health} />;
  return <section className="decision-layout"><div className="decision-main"><PageTitle eyebrow="Decision Room · Cap & roster" title="Create room. Preserve the football plan." subtitle="Set the target and protection rules. Deterministic code builds the branches; prose cannot change the math." />
    <div className="model-controls"><label><span>Required 2026 relief</span><input aria-label="Target relief dollars" type="number" step="1000000" min="0" value={props.target} onChange={(e) => props.setTarget(Math.max(0, Math.round(Number(e.target.value))))} /></label><div className="control-group"><span>Protected groups</span><div className="chip-row">{['QB', 'OL', 'WR', 'DL', 'EDGE/LB', 'CB', 'S'].map((group) => <button key={group} className={props.protectedGroups.includes(group) ? 'chip active' : 'chip'} onClick={() => props.setProtectedGroups(props.protectedGroups.includes(group) ? props.protectedGroups.filter((item) => item !== group) : [...props.protectedGroups, group])}>{group}</button>)}</div></div><button className="primary-button" onClick={props.onRecompute} disabled={loading}>{loading ? 'Recomputing…' : 'Recompute branches'}</button></div>
    <div className="branch-grid" aria-label="Cap relief branches">{decision?.branches.map((candidate) => <button key={candidate.id} className={`branch-card ${props.selectedBranch === candidate.id ? 'selected' : ''}`} onClick={() => props.setSelectedBranch(candidate.id)}><span className="branch-state">{candidate.status.replace('_', ' ')}</span><strong>{candidate.label}</strong><span className="branch-number">{money(candidate.total_relief_dollars)}</span><small>{candidate.target_met ? 'Target met' : candidate.id === 'hold' ? 'Baseline' : `${money(Math.max(0, candidate.target_relief_dollars - candidate.total_relief_dollars))} short`}</small></button>)}</div>
    {branch && <article className="branch-detail"><div className="branch-detail-head"><div><span className="kicker">Selected branch</span><h2>{branch.label}</h2><p>{branch.thesis}</p></div><div className="totals"><Metric label="Verified relief" value={money(branch.total_relief_dollars)} /><Metric label="Dead money" value={money(branch.total_dead_money_dollars)} /></div></div><div className="action-table" role="table"><div className="action-row action-head" role="row"><span>Player / action</span><span>Depth effect</span><span>Relief</span><span>Dead money</span></div>{branch.actions.length === 0 && <div className="empty-row">No transaction actions in this branch.</div>}{branch.actions.map((action) => <button className="action-row" role="row" key={action.player_id} onClick={() => props.onFocusAction(action)}><span><strong>{action.player_name}</strong><small>{action.position} · {labelLever(action.lever)}</small></span><span><Impact value={action.depth_effect} /></span><span className="positive">{money(action.relief_dollars)}</span><span>{money(action.dead_money_dollars)}</span></button>)}</div>{branch.blockers.length > 0 && <div className="boundary-note"><strong>Evidence boundary</strong>{branch.blockers.map((item) => <p key={item}>{item}</p>)}</div>}</article>}
    <section className="changes-call"><span className="kicker">What changes the call</span><div className="trigger-grid">{decision?.what_changes_the_call.map((item) => <article key={item.id}><strong>{item.trigger}</strong><p>{item.effect}</p><small>{item.owner}</small></article>)}</div></section><FollowUp />
  </div><aside className="evidence-panel"><span className="kicker">Evidence inspector</span>{props.focusedAction ? <><h2>{props.focusedAction.player_name}</h2><p>{labelLever(props.focusedAction.lever)} · {props.focusedAction.position}</p><dl><div><dt>Cap number</dt><dd>{money(props.focusedAction.cap_number_dollars)}</dd></div><div><dt>Verified relief</dt><dd className="positive">{money(props.focusedAction.relief_dollars)}</dd></div><div><dt>Dead money</dt><dd>{money(props.focusedAction.dead_money_dollars)}</dd></div><div><dt>Contract evidence</dt><dd>{props.focusedAction.confidence}</dd></div></dl><a className="source-link" href={props.focusedAction.source_url ?? '#'} target="_blank" rel="noreferrer">Open player contract source ↗</a>{props.focusedAction.rule_references.map((rule) => <button className="rule-link" key={rule.rule_id} onClick={() => props.onOpenRule(rule.rule_id)}><span>{rule.title}</span><small>{rule.locator}</small></button>)}<button className="quiet-button full" onClick={() => props.onProtectPlayer(props.focusedAction!.player_id)}>Protect player and recompute</button></> : <><h2>Every number opens its proof.</h2><p>Select a player action to inspect the contract row, exact CBA locator, depth effect, and next confirmation.</p><div className="evidence-empty"><span>01</span> Player contract row<br /><span>02</span> Rule authority<br /><span>03</span> Football consequence</div></>}</aside></section>;
}

function Workspaces({ onOpenDecision, decision, workspaces, onCreate }: { onOpenDecision: () => void; decision: NflCapRosterDecisionResponse | null; workspaces: NflWorkspaceSummary[]; onCreate: (question: string) => Promise<void> }) {
  const stages = ['Question', 'Evidence', 'Scenarios', 'Decision', 'Action Plan'];
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = workspaces.find((workspace) => workspace.id === selectedId) ?? workspaces[0] ?? null;
  async function submitDraft() {
    if (!draftQuestion.trim() || creating) return;
    setCreating(true); setCreateError(null);
    try {
      await onCreate(draftQuestion);
      setDraftQuestion(''); setDraftOpen(false);
    } catch (caught) { setCreateError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setCreating(false); }
  }
  return <section className="page-shell"><div className="workspace-title-row"><PageTitle eyebrow="Workspaces · NYG demo" title={selected?.title ?? 'Decision workspaces'} subtitle="Persistent football-operations initiatives, organized around the work—not a generic project tracker." /><button className="primary-button" onClick={() => setDraftOpen(true)}>+ New workspace</button></div>
    {draftOpen && <article className="workspace-draft"><div><span className="kicker">Client-side draft</span><h2>Start with the decision question</h2><p>Nothing is persisted until you submit the first question.</p></div><textarea aria-label="New workspace question" placeholder="What football decision needs a verified evidence and scenario path?" value={draftQuestion} onChange={(event) => setDraftQuestion(event.target.value)} /><div className="draft-actions"><button className="quiet-button" onClick={() => { setDraftOpen(false); setDraftQuestion(''); setCreateError(null); }}>Cancel</button><button className="primary-button" onClick={() => void submitDraft()} disabled={!draftQuestion.trim() || creating}>{creating ? 'Creating…' : 'Create from first question'}</button></div>{createError && <p className="settings-blocker">{createError}</p>}</article>}
    {workspaces.length > 0 && <div className="workspace-list" aria-label="NYG decision workspaces">{workspaces.map((workspace) => <button key={workspace.id} className={selected?.id === workspace.id ? 'selected' : ''} onClick={() => setSelectedId(workspace.id)}><span>{workspace.seeded ? 'Reviewed fixture' : 'Persisted'}</span><strong>{workspace.title}</strong><small>{workspace.question}</small></button>)}</div>}
    <div className="workspace-overview"><div><span className="kicker">Decision owner</span><strong>Football Operations</strong></div><div><span className="kicker">Current stage</span><strong>{selected ? stageLabel(selected.stage) : 'Question'}</strong></div><div><span className="kicker">Evidence state</span><strong>{decision?.data_health.meeting_ready ? 'Hero path verified' : 'Preflight blocked'}</strong></div><button className="primary-button" onClick={onOpenDecision}>Open live model</button></div><div className="stage-track">{stages.map((stage, index) => <div key={stage} className={index < 3 ? 'complete' : index === 3 ? 'current' : ''}><span>{index < 3 ? '✓' : index + 1}</span><strong>{stage}</strong><small>{['Define relief target and protected depth.', 'Attach contract rows and rule authority.', 'Compare deterministic branch ladder.', 'Select a branch with named owners.', 'Prepare transaction and replacement checks.'][index]}</small></div>)}</div><div className="workspace-notes"><article><span className="kicker">Decision statement</span><h3>{selected?.question ?? `Which verified path creates at least ${money(decision?.branches[0]?.target_relief_dollars ?? DEFAULT_TARGET)} while preserving the positions we refuse to weaken?`}</h3></article><article><span className="kicker">Next action</span><h3>Cap administration confirms selected contract rows; personnel signs off on replacement depth.</h3></article></div></section>;
}

function RosterCap({ roster, decision, onFocus }: { roster: GetCurrentNflTeamResponse | null; decision: NflCapRosterDecisionResponse | null; onFocus: (action: NflCapRosterAction) => void }) {
  const actions = useMemo(() => new Map(decision?.branches.find((branch) => branch.id === 'maximize_relief')?.actions.map((action) => [action.player_id, action]) ?? []), [decision]);
  const rows = [...(roster?.cap_rows ?? [])].filter((row) => row.player_id).sort((a, b) => (b.cap_number_2026 ?? -1) - (a.cap_number_2026 ?? -1));
  return <section className="page-shell"><PageTitle eyebrow="Roster & Cap · NYG" title="Contract mechanics, separated from football judgment" subtitle="Positive relief is shown independently from dead money. Directional rows never drive exact recommendations." /><div className="roster-summary"><Metric label="Roster rows" value={String(roster?.roster_entries.length ?? '—')} /><Metric label="2026 commitments" value={money(decision?.baseline.total_cap_commitments_dollars ?? 0)} /><Metric label="Exact decision rows" value={String(decision?.baseline.complete_cap_rows ?? '—')} /><Metric label="Needs source review" value={String(decision?.baseline.incomplete_cap_rows ?? '—')} /></div><div className="roster-table"><div className="roster-row roster-head"><span>Player</span><span>Pos.</span><span>2026 cap</span><span>Positive relief</span><span>Dead money</span><span>Evidence</span></div>{rows.slice(0, 60).map((row) => { const action = row.player_id ? actions.get(row.player_id) : undefined; return <button className="roster-row" key={row.player_id ?? row.player_name} onClick={() => action && onFocus(action)} disabled={!action}><span><strong>{row.player_name}</strong><small>{row.contract_lever.replace(/_/g, ' ')}</small></span><span>{row.position ?? '—'}</span><span>{row.cap_number_2026 == null ? 'Needs source' : money(row.cap_number_2026)}</span><span className={action ? 'positive' : ''}>{action ? money(action.relief_dollars) : '—'}</span><span>{action ? money(action.dead_money_dollars) : '—'}</span><span><EvidencePill value={row.source_status} /></span></button>; })}</div></section>;
}

function Rulebook({ rules, focused, onOpen, onAnalyze }: { rules: CbaSection[]; focused: CbaSection | null; onOpen: (id: string) => void; onAnalyze: () => void }) {
  const [query, setQuery] = useState(''); const visible = rules.filter((rule) => `${rule.label} ${rule.section}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="page-shell"><PageTitle eyebrow="Rulebook · Official authority" title="Find the rule. See the locator. Return to the decision." subtitle="No generalized summary is treated as authority without an official URL and exact locator." /><div className="rulebook-layout"><div><input className="rule-search" aria-label="Search NFL rules" placeholder="Search June 1, restructure, waivers…" value={query} onChange={(e) => setQuery(e.target.value)} /><div className="rule-list">{visible.length ? visible.map((rule) => <button key={rule.id} className={focused?.id === rule.id ? 'selected' : ''} onClick={() => onOpen(rule.id)}><strong>{rule.label}</strong><small>{rule.section}</small></button>) : <div className="empty-row">No supported rule matches. Refine the query; the Rulebook will not invent a citation.</div>}</div></div><article className="rule-detail">{focused ? <><span className="kicker">Official locator</span><h2>{focused.label}</h2><p className="rule-locator">{focused.section}</p><p>{focused.body}</p><a className="source-link" href={focused.source_url} target="_blank" rel="noreferrer">Open authoritative source ↗</a><button className="primary-button" onClick={onAnalyze}>Use in Decision Room</button></> : <><span className="kicker">Authority first</span><h2>Select a rule family</h2><p>The exact source locator and evidence boundary will appear here.</p></>}</article></div></section>;
}

function Settings({ health }: { health: NflDataHealthResponse | null }) { return <section className="page-shell"><PageTitle eyebrow="Settings · Runtime truth" title="Sources and connections" subtitle="Status is read from the runtime. No fabricated connection timestamps." /><div className="settings-grid">{health?.datasets.map((dataset) => <article key={dataset.id}><div className="settings-title"><StatusDot status={dataset.status} /><div><strong>{dataset.label}</strong><small>{dataset.source_name}</small></div></div><dl><div><dt>Source mode</dt><dd>{dataset.source_mode.replace(/_/g, ' ')}</dd></div><div><dt>As of</dt><dd>{dataset.as_of_date ? formatDate(dataset.as_of_date) : 'Not available'}</dd></div><div><dt>Retrieved</dt><dd>{dataset.retrieved_at ? formatTime(dataset.retrieved_at) : 'Not available'}</dd></div><div><dt>Rows</dt><dd>{dataset.row_count.toLocaleString()}</dd></div><div><dt>Expected cadence</dt><dd>{dataset.expected_cadence}</dd></div></dl>{dataset.blocker && <p className="settings-blocker">{dataset.blocker}</p>}</article>)}<article className="placeholder-card"><span className="kicker">Team-only inputs</span><h3>Not connected</h3><p>Medical grades, internal valuations, staff evaluations, and club transaction systems are not connected to this public demo.</p></article></div></section>; }
function BlockedPreflight({ health }: { health: NflDataHealthResponse }) { return <section className="page-shell blocked-page"><span className="blocked-mark">!</span><PageTitle eyebrow="Presenter preflight" title="The decision room is blocked" subtitle="This demo will not claim readiness while a critical source, freshness, or arithmetic check is unresolved." /><div className="blocker-list">{health.blockers.map((item) => <p key={item}>{item}</p>)}</div><div className="boundary-note"><strong>Remediation</strong>{health.remediation.map((item) => <p key={item}>{item}</p>)}</div></section>; }

function FollowUp() { const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState(''); function submit() { setAnswer(/private|confidential|medical grade|internal board|giants-only/i.test(question) ? 'That team-only input is not connected to this public demo. I will not infer or fabricate it; enter a temporary, clearly labeled scenario assumption to explore its effect.' : 'Use the target and protection controls above to recompute the validated branches. Live model prose is optional; the deterministic result remains available without it.'); } return <section className="follow-up"><span className="kicker">Optional follow-up</span><h2>Ask without changing the math</h2><div><input aria-label="Follow-up question" placeholder="What if we protect the offensive line?" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} /><button className="quiet-button" onClick={submit}>Ask</button></div>{answer && <p>{answer}</p>}</section>; }
function HealthRows({ health }: { health: NflDataHealthResponse | null }) { return <div className="health-rows">{health?.datasets.map((dataset) => <div key={dataset.id}><StatusDot status={dataset.status} /><span>{dataset.label}</span><strong>{dataset.status}</strong></div>) ?? <div><StatusDot status="loading" /><span>Checking</span></div>}</div>; }
function QueueCard({ state, title, body, onClick }: { state: string; title: string; body: string; onClick: () => void }) { return <button className="queue-card" onClick={onClick}><span>{state}</span><strong>{title}</strong><p>{body}</p><small>Open →</small></button>; }
function PageTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) { return <div className="page-title"><span className="kicker">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function StatusDot({ status }: { status: string }) { return <i className={`status-dot ${status}`} aria-hidden="true" />; }
function Impact({ value }: { value: string }) { return <span className={`impact ${value}`}>{value}</span>; }
function EvidencePill({ value }: { value: string }) { const label = value === 'captured' ? 'Verified row' : value === 'estimated' ? 'Directional' : 'Needs source'; return <span className={`evidence-pill ${value}`}>{label}</span>; }
function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, notation: Math.abs(value) >= 1_000_000 ? 'compact' : 'standard' }).format(value); }
function formatDate(value: string) { const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }); }
function formatTime(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
function labelLever(value: string) { return value.replace('pre_june', 'Pre-June 1').replace('post_june', 'Post-June 1').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase()); }
function stageLabel(value: string) { return ({ research: 'Question', validate: 'Evidence', feedback: 'Scenarios', gm: 'Decision', proposal: 'Action Plan', question: 'Question', evidence: 'Evidence', scenarios: 'Scenarios', decision: 'Decision', action_plan: 'Action Plan' } as Record<string, string>)[value] ?? 'Question'; }
