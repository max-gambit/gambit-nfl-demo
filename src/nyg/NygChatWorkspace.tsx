import { useEffect, useMemo, useRef, useState } from 'react';
import type { Brief, BriefSource, DataAnalysisBriefBody } from '@shared/types';
import { isFactualBody } from '@shared/nflFacts';
import { factualAnswerPresentation, marketAnnualRows } from '@shared/nflAnswerDepth';
import { HistoricalPackageEvidence, MarketAnswerEvidence, ScenarioChangeEvidence } from './NygAnswerEvidence';
import { nflTransactionMarketCohortEvidence, nflTransactionTradePackageLines } from '@shared/nflTransactionMarket';
import { createBrief, createBriefWithSession, getBrief } from '../api/briefs';
import { useBookmarks, useBriefs, useSessions, useUi } from '../store';
import { on as onEvt } from '../lib/events';
import { NflTransactionMarketAnalysisView } from '../fenway/NflTransactionMarketAnalysis';
import { NflSellerMoveAnalysis } from '../fenway/NflSellerMoveAnalysis';
import { Toaster } from '../fenway/Toaster';

const STARTERS = [
  { label: 'Contract alternatives', question: 'Convert $6 million of Paulson Adebo’s 2026 salary after June 1. Compare holding versus converting, show the effect this year and next year, explain whether cash changes, and cite the CBA mechanism.', detail: 'Hold versus restructure · cap, cash and future obligations' },
  { label: 'Receiver alternatives', question: 'Compare experienced outside receivers with our internal options. Prioritize next-year flexibility and show the evidence.', detail: 'Production, attributed evaluations and contract implications' },
  { label: 'College projection review', question: 'Compare Tyler Warren and Colston Loveland as historical draft prospects for a detached receiving role. What favors each option, what could change the decision, and what would we need from our scouts?', detail: 'Role tradeoffs · attributed reports and supplied model inputs' },
  { label: 'Availability review', question: 'Using the historical September 2025 Giants availability report, prioritize the questions for staff from observed changes. Then assume Andrew Thomas is unavailable and show the contingency work that follows.', detail: 'Observed flags · staff questions and roster contingency' },
  { label: 'Game preparation and self-scout', question: 'Compare the Giants and Dallas offenses on third down in the captured 2025 sample. Split converted and failed plays by distance, identify a film-review priority, and show the plays to inspect.', detail: 'Situation comparisons · play review and coaching hypotheses' },
  { label: 'EDGE trade history', question: 'How has the trade market for edge rushers changed from 2016 to 2025?', detail: 'Historical transactions · complete recorded packages' },
];

export function NygChatWorkspace({ showLibrary = false, onOpenChat }: { showLibrary?: boolean; onOpenChat: () => void }) {
  const { sessions, sessionsLoaded, activeSessionId, loadSessions, setActiveSession, insertSession } = useSessions();
  const { briefs, briefsLoaded, sourcesByBrief, activeBriefId, loadAllBriefs, loadBriefData, insertBrief, patchBrief, setActiveBrief, subscribeBriefUpdates } = useBriefs();
  const { bookmarkedBriefIds, loadBookmarks, toggleBookmark } = useBookmarks();
  const { selectedSourceRef, setSelectedSourceRef } = useUi();
  const [draft, setDraft] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [report, setReport] = useState({player:'',author:'',date:'',observation:''});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [showEarlier, setShowEarlier] = useState(false);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const latestTurnRef = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const initialized = useRef(false);
  const turns = useMemo(() => briefs.filter(b => b.session_id === activeSessionId).sort((a, b) => a.created_at.localeCompare(b.created_at)), [briefs, activeSessionId]);
  const currentSessionIds = new Set(briefs.filter(b => isFactualBody(b.body)).map(b => b.session_id));
  const earlierCount = sessions.filter(s => !currentSessionIds.has(s.id)).length;
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const saved = briefs.filter(b => bookmarkedBriefIds.has(b.id) && isFactualBody(b.body)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const selectedBrief = briefId ? briefs.find(b => b.id === briefId) : null;
  const evidenceBrief = evidenceId ? briefs.find(b => b.id === evidenceId) : null;

  useEffect(() => {
    void loadSessions(); void loadAllBriefs(); void loadBookmarks();
    return subscribeBriefUpdates();
  }, [loadSessions, loadAllBriefs, loadBookmarks, subscribeBriefUpdates]);
  useEffect(() => {
    if (!sessionsLoaded || !briefsLoaded || initialized.current) return;
    initialized.current = true;
    const sessionId = new URLSearchParams(window.location.search).get('conversation');
    if (sessionId && sessions.some(s => s.id === sessionId)) setActiveSession(sessionId);
  }, [sessionsLoaded, briefsLoaded, sessions, setActiveSession]);
  useEffect(() => {
    if (!initialized.current) return;
    const params = new URLSearchParams(window.location.search);
    if (activeSessionId) params.set('conversation', activeSessionId); else params.delete('conversation');
    window.history.replaceState({}, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  }, [activeSessionId, sessionsLoaded, briefsLoaded]);
  useEffect(() => { for (const turn of turns) void loadBriefData(turn.id); }, [turns, loadBriefData]);
  useEffect(() => {
    if (turns.length) setActiveBrief(turns.at(-1)!.id);
  }, [activeSessionId, turns.length, setActiveBrief]);
  useEffect(() => {
    if (pending) bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    else latestTurnRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [activeSessionId, turns.length, pending]);
  useEffect(() => onEvt('v6d3cf:prefill-composer', ({ text }) => { setDraft(text); inputRef.current?.focus(); }), []);
  useEffect(() => onEvt('v6d3cf:focus-composer', () => inputRef.current?.focus()), []);
  useEffect(() => onEvt('v6d3cf:open-evidence', () => { if (activeBriefId) { setEvidenceId(activeBriefId); void loadBriefData(activeBriefId); } }), [activeBriefId, loadBriefData]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') { setEvidenceId(null); setBriefId(null); setRailOpen(false); } };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);

  function openConversation(id: string | null) {
    onOpenChat();
    setActiveSession(id); setActiveBrief(null); setDraft(''); setError(null); setRailOpen(false); setEvidenceId(null); setBriefId(null);
    inputRef.current?.focus();
  }
  function openEvidence(id: string, ref: number | null = null) { setActiveBrief(id); setSelectedSourceRef(ref); setEvidenceId(id); void loadBriefData(id); }
  async function submit(question: string) {
    const text = question.trim();
    if (!text || inFlight.current) return;
    inFlight.current = true; setPending(text); setDraft(''); setError(null);
    const sessionAtSubmit = activeSessionId;
    try {
      let answer: Brief;
      if (sessionAtSubmit) answer = await createBrief({ session_id: sessionAtSubmit, question: text, mode: 'data_analyst', template: { template_id: 'data_table' } });
      else { const created = await createBriefWithSession(text, 'data_analyst', { template_id: 'data_table' }); insertSession(created.session); answer = created.brief; }
      insertBrief(answer); setActiveBrief(answer.id); void loadBriefData(answer.id);
      // Poll in addition to realtime; a lost socket must not strand the answer.
      if (answer.status === 'generating') {
        for (let attempt = 0; attempt < 30; attempt++) {
          await new Promise(resolve => window.setTimeout(resolve, 1500));
          const next = await getBrief(answer.id); patchBrief(next.id, next);
          if (next.status !== 'generating') { void loadBriefData(next.id); break; }
        }
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The answer could not be loaded.'); setDraft(text); }
    finally { setPending(null); inFlight.current = false; inputRef.current?.focus(); }
  }
  async function saveBrief(answer: Brief) {
    if (!bookmarkedBriefIds.has(answer.id)) await toggleBookmark(answer.id);
    setActiveBrief(answer.id); setBriefId(answer.id); void loadBriefData(answer.id);
  }

  return <div className="giants-chat-shell">
    <button className="gc-mobile-rail" onClick={() => setRailOpen(v => !v)} aria-label="Toggle conversations">☰ Conversations</button>
    {railOpen && <button className="gc-rail-backdrop" aria-label="Close conversations" onClick={() => setRailOpen(false)} />}
    <aside className={`gc-sidebar${railOpen ? ' is-open' : ''}`}>
      <div className="gc-eyebrow">CONVERSATIONS</div>
      <button className="gc-new" disabled={Boolean(pending)} onClick={() => openConversation(null)}><span>＋</span> New conversation</button>
      <input className="gc-history-search" aria-label="Search conversations" placeholder="Find a conversation…" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="gc-history">{[...sessions].reverse().filter(s => showEarlier || currentSessionIds.has(s.id) || s.id === activeSessionId).filter(s => s.label.toLowerCase().includes(search.toLowerCase())).map(s => <button key={s.id} title={briefs.find(b => b.session_id === s.id)?.question ?? s.label} disabled={Boolean(pending)} className={s.id === activeSessionId ? 'selected' : ''} onClick={() => openConversation(s.id)}><span>{s.label}</span><small>{date(s.created_at)} · {briefs.filter(b => b.session_id === s.id).length} answers</small></button>)}</div>
      {earlierCount > 0 && <button className="gc-earlier" onClick={() => setShowEarlier(v => !v)}>{showEarlier ? "Hide earlier conversations" : `Earlier conversations (${earlierCount})`}</button>}
      <div className="gc-sidebar-foot">Public NFL data</div>
    </aside>
    <main className="gc-main">
      {showLibrary ? <div className="gc-library"><h1>Saved briefs</h1><p>Briefs keep the selected answer, calculations, assumptions and source links together.</p>{saved.length === 0 ? <div className="gc-empty-note">No briefs saved yet. Use “Save as brief” below an answer in Chat.</div> : saved.map(answer => <button className="gc-library-card" key={answer.id} onClick={() => { setBriefId(answer.id); setActiveBrief(answer.id); void loadBriefData(answer.id); }}><small>{date(answer.created_at)}</small><strong>{briefTitle(answer)}</strong><span>{answer.body?.kind === 'data_analysis' ? answer.body.answer : ''}</span><b>Open brief →</b></button>)}</div> : <>
        <header className="gc-conversation-header"><div><h1>{activeSession?.label ?? 'Chat'}</h1></div><span className="gc-save-state">{pending ? 'Checking sources…' : turns.length ? 'Conversation saved' : 'New conversation'}</span></header>
        <div className="gc-scroll" aria-label="Conversation">
          {!sessionsLoaded || !briefsLoaded ? <p className="gc-empty-note" role="status">Loading conversations…</p> : turns.length === 0 && !pending ? <section className="gc-welcome"><h2>New conversation</h2><p>Connect player evidence, contract scenarios and roster alternatives. Change the objective or add an evaluation as the conversation develops.</p><div className="gc-starters">{STARTERS.map(starter => <button key={starter.label} onClick={() => { setDraft(starter.question); inputRef.current?.focus(); }}><div><strong>{starter.label}</strong><small>{starter.detail}</small></div><b>↗</b></button>)}</div></section> : <div className="gc-turns">
            {turns.map((answer, index) => <article key={answer.id} ref={index === turns.length - 1 ? latestTurnRef : undefined} className="gc-turn" data-brief-id={answer.id}>
              <div className="gc-user"><span className="gc-eyebrow">YOU</span><p>{answer.question}</p></div>
              <div className="gc-assistant"><div className="gc-answer-mark"><small>Gambit</small></div>
                {answer.status === 'generating' ? <p role="status">Checking the requested records…</p> : !isFactualBody(answer.body) ? <div className="gc-legacy"><p>{answer.status === 'failed' ? 'This earlier question did not complete.' : 'This earlier answer includes analysis outside the current factual format.'}</p><button disabled={Boolean(pending)} onClick={() => void submit(answer.question)}>Ask again with current facts →</button></div> : <>
                  <FactualAnswer body={answer.body} previous={isFactualBody(turns[index - 1]?.body) ? turns[index - 1].body as DataAnalysisBriefBody : null} briefId={answer.id} onEvidence={ref => openEvidence(answer.id, ref)} />
                  <div className="gc-answer-actions"><button onClick={() => openEvidence(answer.id)}>Sources <span>{sourcesByBrief[answer.id]?.length ?? '…'}</span></button><button onClick={() => void saveBrief(answer)}>{bookmarkedBriefIds.has(answer.id) ? 'Open saved brief' : 'Save as brief'}</button></div>
                  {answer.id === turns.at(-1)?.id && answer.body.followups.length > 0 && <div className="gc-followups">{answer.body.followups.slice(0, 3).map(text => <button key={text} disabled={Boolean(pending)} onClick={() => void submit(text)}>{text} <span>↗</span></button>)}</div>}
                </>}
              </div>
            </article>)}
            {pending && !turns.some(t => t.question === pending && t.id === turns.at(-1)?.id) && <article className="gc-turn"><div className="gc-user"><span className="gc-eyebrow">YOU</span><p>{pending}</p></div><PendingAnswer /></article>}
          </div>}
          <div ref={bottomRef} />
        </div>
        <div className="gc-composer-wrap">{reportOpen && <section className="gc-report-input" aria-label="Add an attributed evaluation"><p>Add an evaluation to your next question. Its author and date stay attached. To use a grade in a comparison, include its role and scale, such as receiving role: 8/10, and state your decision rule in the question.</p><div>{(['player','author','date'] as const).map(field=><label key={field}>{field === 'player' ? 'Player' : field === 'author' ? 'Author / model version' : 'Evaluation date'}<input type={field==='date'?'date':'text'} value={report[field]} onChange={e=>setReport({...report,[field]:e.target.value})}/></label>)}</div><label>Observation<textarea value={report.observation} maxLength={2000} onChange={e=>setReport({...report,observation:e.target.value})}/></label><button disabled={!Object.values(report).every(v=>v.trim())} onClick={()=>{setDraft(v=>v+'\n\n[Evaluation]\nPlayer: '+report.player+'\nAuthor: '+report.author+'\nDate: '+report.date+'\nObservation: '+report.observation+'\n[/Evaluation]');setReportOpen(false);inputRef.current?.focus();}}>Attach to question</button></section>}<form onSubmit={e => { e.preventDefault(); void submit(draft); }} className="gc-composer"><label className="gc-sr-only" htmlFor="giants-question">Ask a Giants or NFL question</label><textarea id="giants-question" ref={inputRef} rows={2} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ask a question, change an assumption, or inspect a source…" disabled={Boolean(pending)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(draft); } }} /><div className="gc-composer-tools"><span><button type="button" className="gc-add-evaluation" onClick={()=>setReportOpen(v=>!v)} disabled={Boolean(pending)}>Add evaluation</button><small>Enter to send · Shift + Enter for a new line</small></span><button aria-label="Send question" disabled={!draft.trim() || Boolean(pending) || !sessionsLoaded}>↑</button></div></form>{error && <div className="gc-error" role="alert">Couldn’t complete that question. Your text is preserved. {error}</div>}</div>
      </>}
    </main>
    {evidenceBrief && <div className="gc-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setEvidenceId(null); }}><aside className="gc-evidence-drawer" role="dialog" aria-modal="true" aria-label="Sources"><div className="gc-panel-heading"><div><h2>Sources</h2></div><button autoFocus aria-label="Close sources" onClick={() => setEvidenceId(null)}>×</button></div><p className="gc-panel-question">{evidenceBrief.question}</p>{isFactualBody(evidenceBrief.body) && <div className="gc-limits">{evidenceBrief.body.caveats.map((text, i) => <p key={i}>{text}</p>)}</div>}<SourceList sources={sourcesByBrief[evidenceBrief.id]} selectedRef={selectedSourceRef} /></aside></div>}
    {selectedBrief && isFactualBody(selectedBrief.body) && <div className="gc-overlay gc-brief-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setBriefId(null); }}><section className="gc-brief-document" role="dialog" aria-modal="true" aria-label="Saved factual brief"><div className="gc-panel-heading"><span className="gc-eyebrow">NEW YORK GIANTS · BRIEF</span><button autoFocus aria-label="Close brief" onClick={() => setBriefId(null)}>×</button></div><h1>{briefTitle(selectedBrief)}</h1><div className="gc-brief-meta">{date(selectedBrief.created_at)} · {bookmarkedBriefIds.has(selectedBrief.id) ? 'Saved' : 'Preview'}</div><FactualAnswer body={selectedBrief.body} briefId={selectedBrief.id} onEvidence={ref => { setBriefId(null); openEvidence(selectedBrief.id, ref); }} /><h2 className="gc-source-heading">Sources</h2><SourceList sources={sourcesByBrief[selectedBrief.id]} /><div className="gc-brief-actions"><button disabled={!sourcesByBrief[selectedBrief.id]} onClick={() => { downloadBrief(selectedBrief, sourcesByBrief[selectedBrief.id] ?? []); setSavedFeedback('Markdown brief downloaded with source links.'); }}>Download Markdown</button><button onClick={() => { openConversation(selectedBrief.session_id); }}>Continue conversation</button></div>{savedFeedback && <p role="status">{savedFeedback}</p>}</section></div>}
    <Toaster />
  </div>;
}

function FactualAnswer({ body: savedBody, previous = null, briefId, onEvidence }: { body: DataAnalysisBriefBody; previous?: DataAnalysisBriefBody | null; briefId: string; onEvidence: (ref?: number) => void }) {
  const { setActiveBrief, sourcesByBrief } = useBriefs();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const body = factualAnswerPresentation(savedBody);
  const result = body.seller_move_analysis?.result;
  const primaryMarket = body.market_analysis && !body.seller_move_analysis && body.answer_layout !== 'trade_packages';
  const cite = (refs: number[]) => refs.length ? <button className="gc-cite" onClick={() => onEvidence(refs[0])}>[{refs.slice(0, 4).join(', ')}{refs.length > 4 ? '…' : ''}]</button> : null;
  return <div className="gc-factual-answer" onFocus={() => setActiveBrief(briefId)} onMouseDown={() => setActiveBrief(briefId)}>
    {body.answer_paragraphs?.length ? body.answer_paragraphs.map((paragraph,index)=><p className="gc-answer-lead" key={index}>{paragraph.text} {cite(paragraph.source_refs)}</p>) : <p className="gc-answer-lead">{body.answer} {cite(body.answer_source_refs??[])}</p>}
    {body.conversation_state && <details className="gc-calculation-details"><summary>Scenario and assumptions</summary><div className="gc-details-body"><p><strong>Objective:</strong> {body.conversation_state.active.objective.replaceAll('_',' ')} · {body.conversation_state.active.candidate_scope} candidates</p><p><strong>Horizon:</strong> {body.conversation_state.active.horizon || 'Not specified'}</p>{body.conversation_state.active.budget && <p><strong>Budget:</strong> {body.conversation_state.active.budget.type} {money(body.conversation_state.active.budget.amount)} · reserve {money(body.conversation_state.active.budget.reserve)}</p>}{[...body.conversation_state.active.protected_player_names.map(p=>'Keep '+p), ...body.conversation_state.active.assumptions, ...body.conversation_state.active.supplied_terms, ...body.conversation_state.active.unresolved_inputs].map((text,i)=><p key={i}>{text}</p>)}</div></details>}
    {result && <div className="gc-fact-strip"><div><small>{result.cap.current_year} CAP SPACE CREATED</small><strong>{money(result.cap.current_year_cap_space_created_dollars)}</strong></div><div><small>{result.cap.current_year} DEAD MONEY</small><strong>{money(result.cap.current_year_dead_money_dollars)}</strong></div><div><small>PROPOSED RETURN</small><strong>{result.proposal.pick_year} · Round {result.proposal.pick_round}</strong></div></div>}
    {result && previous?.seller_move_analysis?.result && <ScenarioChangeEvidence current={result} previous={previous.seller_move_analysis.result} />}
    {primaryMarket && <div className="gc-fact-strip"><div><small>PLAYER MOVEMENTS</small><strong>{body.market_analysis!.coverage.event_count}</strong></div><div><small>TRADES</small><strong>{body.market_analysis!.coverage.distinct_trade_count ?? 'Not recorded'}</strong></div><div><small>PERIOD</small><strong>{body.market_analysis!.query.start_year}–{body.market_analysis!.query.end_year}</strong></div></div>}
    {body.key_findings.map((finding, i) => <div className="gc-finding" key={i}><strong>{finding.label}</strong><p>{finding.body} {cite(finding.source_refs)}</p></div>)}
    {body.tables.map((table, i) => <div className={`gc-fact-table${table.title.includes('packages') ? ' gc-package-table' : ''}`} key={i}>
      <h3>{table.title} {cite(table.source_refs)}</h3><div><table><thead><tr>{table.columns.map((column, j) => <th key={j}>{column}</th>)}</tr></thead><tbody>{table.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}>{String(cell ?? 'Not recorded')}</td>)}</tr>)}</tbody></table></div>
    </div>)}
    {Boolean(body.supporting_details?.length) && <details className="gc-calculation-details"><summary>Comparison details</summary><div className="gc-details-body">{body.supporting_details!.map((detail,i)=><div className="gc-finding" key={i}><strong>{detail.label}</strong><p>{detail.body} {cite(detail.source_refs)}</p></div>)}</div></details>}
    {body.contract_scenario?.tables && <details className="gc-calculation-details"><summary>All contract years and obligations</summary><div className="gc-details-body">{body.contract_scenario.tables.map((table,i)=><div className="gc-fact-table" key={i}><h3>{table.title} {cite(table.source_refs)}</h3><div><table><thead><tr>{table.columns.map((c,j)=><th key={j}>{c}</th>)}</tr></thead><tbody>{table.rows.map((row,j)=><tr key={j}>{row.map((cell,k)=><td key={k}>{String(cell??'Unknown')}</td>)}</tr>)}</tbody></table></div></div>)}</div></details>}
    {body.historical_selection && body.market_analysis && <HistoricalPackageEvidence analysis={body.market_analysis} selection={body.historical_selection} sources={sourcesByBrief[briefId] ?? []} onEvidence={onEvidence} />}
    {body.answer_layout === 'market_overview' && body.market_analysis && <MarketAnswerEvidence analysis={body.market_analysis} sources={sourcesByBrief[briefId] ?? []} onEvidence={onEvidence} />}
    {body.market_analysis && <details className="gc-calculation-details" open={detailsOpen} onToggle={e => setDetailsOpen(e.currentTarget.open)}><summary>{body.seller_move_analysis ? 'Calculation details' : body.historical_selection ? `${body.market_analysis.query.start_year}–${body.market_analysis.query.end_year} data and methodology` : 'Data and methodology'}</summary><div className="gc-details-body">{body.seller_move_analysis ? <NflSellerMoveAnalysis artifact={body.seller_move_analysis} briefId={briefId} onEvidence={onEvidence} /> : <NflTransactionMarketAnalysisView analysis={body.market_analysis} briefId={briefId} onEvidence={onEvidence} />}</div></details>}
    {!body.market_analysis && body.calculations.length > 0 && <details className="gc-visible-calculations"><summary>Calculation details</summary>{body.calculations.map((calc, i) => <p className="gc-formula" key={i}><strong>{calc.label}</strong><br />{calc.formula} = {calc.value} {cite(calc.source_refs)}</p>)}</details>}
    {!body.market_analysis && body.caveats.length > 0 && (!body.factual_query || body.factual_query.hypothetical_unavailable || body.factual_query.transaction !== 'none' || body.factual_query.min_starts != null || body.factual_query.max_cap != null) && <div className="gc-answer-limit"><p>{body.caveats[0]}</p></div>}
  </div>;
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
function SourceList({ sources, selectedRef }: { sources?: BriefSource[]; selectedRef?: number | null }) {
  if (!sources) return <p className="gc-empty-note" role="status">Loading the source record…</p>;
  if (!sources.length) return <p className="gc-empty-note">No source cards are attached to this answer.</p>;
  return <div className="gc-source-list">{sources.map(source => {
    const data = source.data && typeof source.data === 'object' ? source.data as Record<string, unknown> : {};
    const url = safeUrl(data.source_url);
    const rows = Array.isArray(data.rows) ? data.rows as Array<{ k?: unknown; v?: unknown }> : [];
    return <details key={source.id} className="gc-source-card" open={selectedRef === source.ref_index || undefined}><summary><span>[{source.ref_index}]</span><div><strong>{source.title ?? source.source}</strong><small>{source.source} · {source.updated_at}</small></div><b>＋</b></summary><div>{typeof data.contribution === 'string' && <p>{data.contribution}</p>}{typeof data.excerpt === 'string' && <blockquote>{data.excerpt}</blockquote>}{typeof data.source_locator === 'string' && <p>{data.source_locator}</p>}{typeof data.authority_boundary === 'string' && <p>{data.authority_boundary}</p>}{rows.map((row, i) => <dl key={i}><dt>{String(row.k ?? '')}</dt><dd>{safeUrl(row.v) ? <a href={safeUrl(row.v)!} target="_blank" rel="noreferrer">Open source ↗</a> : String(row.v ?? 'Not recorded')}</dd></dl>)}{Array.isArray(data.source_tables) && data.source_tables.map((raw,i)=>{const table=raw as {section?:string;rows?:unknown[][]};return <details key={i}><summary>{table.section||'Captured source table'}</summary><div className="gc-fact-table"><div><table><tbody>{table.rows?.map((row,j)=><tr key={j}>{row.map((cell,k)=><td key={k}>{String(cell??'')}</td>)}</tr>)}</tbody></table></div></div></details>;})}{url && <a href={url} target="_blank" rel="noreferrer">Open original source ↗</a>}</div></details>;
  })}</div>;
}
function briefTitle(brief: Brief): string {
  const selection = isFactualBody(brief.body) ? brief.body.historical_selection : null;
  if (selection && isFactualBody(brief.body)) return [selection.player_names.join(', ') || `${brief.body.market_analysis?.query.position_groups.join(', ') || 'NFL'} trade packages`, selection.years.join(', '), selection.pick_rounds.length ? `Round ${selection.pick_rounds.join(', ')} returns` : ''].filter(Boolean).join(' · ');
  const result = isFactualBody(brief.body) ? brief.body.seller_move_analysis?.result : null;
  return result ? `${result.player.player_name} · ${result.proposal.pick_year} round ${result.proposal.pick_round} trade scenario` : brief.question;
}
function downloadBrief(brief: Brief, sources: BriefSource[]) {
  if (!isFactualBody(brief.body)) return;
  const body = factualAnswerPresentation(brief.body);
  const cell = (value: unknown) => String(value ?? 'Not recorded').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const narrative=body.answer_paragraphs?.length?body.answer_paragraphs.map(p=>p.text+(p.source_refs.length?' '+p.source_refs.map(ref=>'['+ref+']').join(' '):'')).join('\n\n'):body.answer;
  const lines = [`# ${briefTitle(brief)}`, `New York Giants · saved ${brief.created_at}`, '', `Question: ${brief.question}`, '', narrative, ''];
  const table = (title: string, columns: string[], rows: unknown[][]) => {
    if (!rows.length) return;
    lines.push(`## ${title}`, `| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`), '');
  };
  if(body.conversation_state) {const active=body.conversation_state.active;lines.push('## Scenario', active.objective+'; '+active.candidate_scope+' candidates; '+active.horizon, ...active.assumptions,...active.supplied_terms,...active.unresolved_inputs,'');if(active.budget) lines.push('Budget: '+active.budget.type+' '+money(active.budget.amount)+'; reserve '+money(active.budget.reserve),'');}
  if(body.contract_scenario) lines.push('## Executed contract scenario', '```json', JSON.stringify(body.contract_scenario,null,2), '```', '');
  if(body.cap_strategy) lines.push('## Calculated funding strategy and sensitivity', '```json', JSON.stringify(body.cap_strategy,null,2), '```', '');
  if(body.funding_observations) lines.push('## Retained funding observations', '```json', JSON.stringify(body.funding_observations,null,2), '```', '');
  for (const finding of body.key_findings) lines.push(`## ${finding.label}`, finding.body, '');
  for (const item of body.tables) table(item.title, item.columns, item.rows);
  for (const detail of body.supporting_details ?? []) lines.push(`## ${detail.label}`, detail.body, '');
  for (const calc of body.calculations) lines.push(`**${calc.label}:** ${calc.formula} = ${calc.value}`, '');
  const seller = body.seller_move_analysis?.result;
  if (seller?.cap.next_year) {
    const next = seller.cap.next_year;
    lines.push(`## ${next.year} contract calculation`, `${money(next.scheduled_cap_dollars)} scheduled cap charge − ${money(next.accelerated_dead_money_dollars)} accelerated dead money = ${money(next.cap_effect_dollars)} cap-space effect.`, '');
  }
  if (body.market_analysis) {
    const market = body.market_analysis;
    if (!seller && !body.historical_selection) table('Annual recorded player events', ['Year', 'Player events', 'Roster player-seasons'], marketAnnualRows(market).map(p => [p.partial ? `${p.year} (partial)` : p.year, p.events, p.rosterPlayerSeasons]));
    lines.push(body.historical_selection ? '## Original historical cohort' : '## Historical scope', `${market.query.start_year}–${market.query.end_year}; ${market.query.position_groups.join(', ') || 'all positions'}; ${market.query.transaction_types.join(', ')}; ${market.query.team_ids.join(', ') || 'leaguewide'}.`, `${market.coverage.event_count} player events; ${market.coverage.distinct_trade_count ?? 'unrecorded'} distinct trades.`, '');
    if (!seller && !body.historical_selection) table(`Period measures: ${market.query.baseline_years.join('–')} → ${market.query.recent_years.join('–')}`, ['Position', 'Player events', 'Events per 100 player-seasons'], market.position_trends.map(t => [t.position_group, t.event_count, `${t.mobility.baseline_value == null ? 'Not recorded' : (t.mobility.baseline_value / 100).toFixed(2)} → ${t.mobility.recent_value == null ? 'Not recorded' : (t.mobility.recent_value / 100).toFixed(2)}`]));
    const cohort = nflTransactionMarketCohortEvidence(market);
    const events = seller ? cohort.rows.filter(r => seller.comparables.some(c => c.event_id === r.event_id)) : body.historical_selection ? body.historical_selection.event_ids.flatMap(id => { const row = cohort.rows.find(r => r.event_id === id); return row ? [row] : []; }) : cohort.rows;
    table(seller ? 'Displayed historical comparison sample' : 'Matching historical transactions', ['Player', 'Date', 'Move', 'Recorded package / terms'], events.map(r => [r.player_name, r.event_date ?? r.event_year, `${r.from_team_id ?? '—'} → ${r.to_team_id ?? '—'}`, nflTransactionTradePackageLines(r).join('; ') || r.compensation_summary || 'Not recorded']));
    lines.push(cohort.summary, '');
  }
  lines.push('## Assumptions and limitations', ...body.caveats.map(c => `- ${c}`), '', '## Sources');
  for (const source of sources) {
    const data = source.data as Record<string, unknown> | null;
    lines.push(`### [${source.ref_index}] ${source.title ?? source.source}`, `${source.source} · ${source.updated_at}`);
    const url = safeUrl(data?.source_url); if (url) lines.push(`[Original source](${url})`);
    if (typeof data?.contribution === 'string') lines.push(data.contribution);
    if (Array.isArray(data?.rows)) for (const row of data.rows as Array<{ k: unknown; v: unknown }>) lines.push(`- ${cell(row.k)}: ${cell(row.v)}`);
    lines.push('');
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `Giants-brief-${brief.id.slice(0, 8)}.md`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function date(value: string) { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function money(value: number) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value); }

function PendingAnswer() {
  const [seconds,setSeconds]=useState(0);
  useEffect(()=>{const start=Date.now();const timer=window.setInterval(()=>setSeconds(Math.floor((Date.now()-start)/1000)),1000);return ()=>clearInterval(timer);},[]);
  return <p className="gc-thinking" role="status"><span />{seconds<15?'Checking the evidence and working through your question…':'Preparing the answer. Any unfinished analysis will be marked clearly.'} <small>{seconds}s</small></p>;
}
