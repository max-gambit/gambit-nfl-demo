import { useEffect, useMemo, useRef, useState } from 'react';
import type { Brief, BriefSource, DataAnalysisBriefBody } from '@shared/types';
import { isFactualBody } from '@shared/nflFacts';
import { nflTransactionMarketCohortEvidence, nflTransactionTradePackageLines } from '@shared/nflTransactionMarket';
import { createBrief, createBriefWithSession, getBrief } from '../api/briefs';
import { useBookmarks, useBriefs, useSessions, useUi } from '../store';
import { on as onEvt } from '../lib/events';
import { NflTransactionMarketAnalysisView } from '../fenway/NflTransactionMarketAnalysis';
import { NflSellerMoveAnalysis } from '../fenway/NflSellerMoveAnalysis';
import { Toaster } from '../fenway/Toaster';

const STARTERS = [
  { label: 'EDGE trade history', question: 'How has the trade market for edge rushers changed from 2016 to 2025?', detail: 'Historical transactions · complete recorded packages' },
  { label: 'Brian Burns trade scenario', question: 'What if we moved Brian Burns for a 2027 second?', detail: 'A proposed return · contract calculations' },
  { label: 'Giants cap accounting', question: 'How much 2026 cap space do the Giants currently have?', detail: 'Public source dates · accounting basis' },
];

export function NygChatWorkspace({ showLibrary = false, onOpenChat }: { showLibrary?: boolean; onOpenChat: () => void }) {
  const { sessions, sessionsLoaded, activeSessionId, loadSessions, setActiveSession, insertSession } = useSessions();
  const { briefs, briefsLoaded, sourcesByBrief, activeBriefId, loadAllBriefs, loadBriefData, insertBrief, patchBrief, setActiveBrief, subscribeBriefUpdates } = useBriefs();
  const { bookmarkedBriefIds, loadBookmarks, toggleBookmark } = useBookmarks();
  const { selectedSourceRef, setSelectedSourceRef } = useUi();
  const [draft, setDraft] = useState('');
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
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length, pending]);
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
          {!sessionsLoaded || !briefsLoaded ? <p className="gc-empty-note" role="status">Loading conversations…</p> : turns.length === 0 && !pending ? <section className="gc-welcome"><h2>New conversation</h2><p>Ask about player records, historical transactions, contract calculations or the rule behind a move.</p><div className="gc-starters">{STARTERS.map(starter => <button key={starter.label} onClick={() => { setDraft(starter.question); inputRef.current?.focus(); }}><div><strong>{starter.label}</strong><small>{starter.detail}</small></div><b>↗</b></button>)}</div></section> : <div className="gc-turns">
            {turns.map(answer => <article key={answer.id} className="gc-turn" data-brief-id={answer.id}>
              <div className="gc-user"><span className="gc-eyebrow">YOU</span><p>{answer.question}</p></div>
              <div className="gc-assistant"><div className="gc-answer-mark"><small>Gambit</small></div>
                {answer.status === 'generating' ? <p role="status">Checking the requested records…</p> : !isFactualBody(answer.body) ? <div className="gc-legacy"><p>{answer.status === 'failed' ? 'This earlier question did not complete.' : 'This earlier answer includes analysis outside the current factual format.'}</p><button disabled={Boolean(pending)} onClick={() => void submit(answer.question)}>Ask again with current facts →</button></div> : <>
                  <FactualAnswer body={answer.body} briefId={answer.id} onEvidence={ref => openEvidence(answer.id, ref)} />
                  <div className="gc-answer-actions"><button onClick={() => openEvidence(answer.id)}>Sources & limits <span>{sourcesByBrief[answer.id]?.length ?? '…'}</span></button><button onClick={() => void saveBrief(answer)}>{bookmarkedBriefIds.has(answer.id) ? 'Open saved brief' : 'Save as brief'}</button></div>
                  {answer.id === turns.at(-1)?.id && answer.body.followups.length > 0 && <div className="gc-followups">{answer.body.followups.slice(0, 3).map(text => <button key={text} disabled={Boolean(pending)} onClick={() => void submit(text)}>{text} <span>↗</span></button>)}</div>}
                </>}
              </div>
            </article>)}
            {pending && !turns.some(t => t.question === pending && t.id === turns.at(-1)?.id) && <article className="gc-turn"><div className="gc-user"><span className="gc-eyebrow">YOU</span><p>{pending}</p></div><p className="gc-thinking" role="status"><span /> Checking the requested records and source dates…</p></article>}
          </div>}
          <div ref={bottomRef} />
        </div>
        <div className="gc-composer-wrap"><form onSubmit={e => { e.preventDefault(); void submit(draft); }} className="gc-composer"><label className="gc-sr-only" htmlFor="giants-question">Ask a Giants or NFL question</label><textarea id="giants-question" ref={inputRef} rows={2} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ask a question, change an assumption, or inspect a source…" disabled={Boolean(pending)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(draft); } }} /><div className="gc-composer-tools"><span><small>Enter to send · Shift + Enter for a new line</small></span><button aria-label="Send question" disabled={!draft.trim() || Boolean(pending) || !sessionsLoaded}>↑</button></div></form>{error && <div className="gc-error" role="alert">Couldn’t complete that question. Your text is preserved. {error}</div>}</div>
      </>}
    </main>
    {evidenceBrief && <div className="gc-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setEvidenceId(null); }}><aside className="gc-evidence-drawer" role="dialog" aria-modal="true" aria-label="Sources and limits"><div className="gc-panel-heading"><div><span className="gc-eyebrow">ANSWER EVIDENCE</span><h2>Sources & limits</h2></div><button autoFocus aria-label="Close sources" onClick={() => setEvidenceId(null)}>×</button></div><p className="gc-panel-question">{evidenceBrief.question}</p>{isFactualBody(evidenceBrief.body) && <div className="gc-limits">{evidenceBrief.body.caveats.map((text, i) => <p key={i}>{text}</p>)}</div>}<SourceList sources={sourcesByBrief[evidenceBrief.id]} selectedRef={selectedSourceRef} /></aside></div>}
    {selectedBrief && isFactualBody(selectedBrief.body) && <div className="gc-overlay gc-brief-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setBriefId(null); }}><section className="gc-brief-document" role="dialog" aria-modal="true" aria-label="Saved factual brief"><div className="gc-panel-heading"><span className="gc-eyebrow">NEW YORK GIANTS · FACTUAL BRIEF</span><button autoFocus aria-label="Close brief" onClick={() => setBriefId(null)}>×</button></div><h1>{briefTitle(selectedBrief)}</h1><div className="gc-brief-meta">{date(selectedBrief.created_at)} · {bookmarkedBriefIds.has(selectedBrief.id) ? 'Saved' : 'Preview'}</div><FactualAnswer body={selectedBrief.body} briefId={selectedBrief.id} onEvidence={ref => { setBriefId(null); openEvidence(selectedBrief.id, ref); }} expanded /><h2 className="gc-source-heading">Source record</h2><SourceList sources={sourcesByBrief[selectedBrief.id]} /><div className="gc-brief-actions"><button disabled={!sourcesByBrief[selectedBrief.id]} onClick={() => { downloadBrief(selectedBrief, sourcesByBrief[selectedBrief.id] ?? []); setSavedFeedback('Markdown brief downloaded with source links.'); }}>Download Markdown</button><button onClick={() => { openConversation(selectedBrief.session_id); }}>Continue conversation</button></div>{savedFeedback && <p role="status">{savedFeedback}</p>}</section></div>}
    <Toaster />
  </div>;
}

function FactualAnswer({ body, briefId, onEvidence, expanded = false }: { body: DataAnalysisBriefBody; briefId: string; onEvidence: (ref?: number) => void; expanded?: boolean }) {
  const { setActiveBrief } = useBriefs();
  const [detailsOpen, setDetailsOpen] = useState(expanded);
  const result = body.seller_move_analysis?.result;
  const primaryMarket = body.market_analysis && !body.seller_move_analysis;
  return <div className="gc-factual-answer" onFocus={() => setActiveBrief(briefId)} onMouseDown={() => setActiveBrief(briefId)}>
    <p className="gc-answer-lead">{body.answer}</p>
    {result && <div className="gc-fact-strip"><div><small>{result.cap.current_year} CAP SPACE CREATED</small><strong>{money(result.cap.current_year_cap_space_created_dollars)}</strong></div><div><small>{result.cap.current_year} DEAD MONEY</small><strong>{money(result.cap.current_year_dead_money_dollars)}</strong></div><div><small>PROPOSED RETURN</small><strong>{result.proposal.pick_year} · Round {result.proposal.pick_round}</strong></div></div>}
    {primaryMarket && <div className="gc-fact-strip"><div><small>PLAYER EVENTS</small><strong>{body.market_analysis!.coverage.event_count}</strong></div><div><small>DISTINCT TRADES</small><strong>{body.market_analysis!.coverage.distinct_trade_count ?? 'Not recorded'}</strong></div><div><small>HISTORICAL PERIOD</small><strong>{body.market_analysis!.query.start_year}–{body.market_analysis!.query.end_year}</strong></div></div>}
    {!body.seller_move_analysis && body.key_findings.map((finding, i) => <div className="gc-finding" key={i}><strong>{finding.label}</strong><p>{finding.body} {finding.source_refs.length > 0 && <button className="gc-cite" onClick={() => onEvidence(finding.source_refs[0])}>[{finding.source_refs.slice(0, 4).join(', ')}{finding.source_refs.length > 4 ? '…' : ''}]</button>}</p></div>)}
    {body.tables.map((table, i) => <div className="gc-fact-table" key={i}><h3>{table.title}</h3><div><table><thead><tr>{table.columns.map((column, j) => <th key={j}>{column}</th>)}</tr></thead><tbody>{table.rows.map((row, j) => <tr key={j}>{row.map((cell, k) => <td key={k}>{String(cell ?? 'Not recorded')}</td>)}</tr>)}</tbody></table></div></div>)}
    {body.market_analysis && <details className="gc-calculation-details" open={detailsOpen} onToggle={e => setDetailsOpen(e.currentTarget.open)}><summary>{body.seller_move_analysis ? 'Contract calculation & historical comparisons' : 'Explore periods, measures & all matching transactions'}</summary><div className="gc-details-body">{body.seller_move_analysis ? <NflSellerMoveAnalysis artifact={body.seller_move_analysis} briefId={briefId} onEvidence={onEvidence} /> : <NflTransactionMarketAnalysisView analysis={body.market_analysis} briefId={briefId} onEvidence={onEvidence} />}{body.seller_move_analysis && body.key_findings.length > 0 && body.key_findings.map((f, i) => <div className="gc-finding" key={i}><strong>{f.label}</strong><p>{f.body}</p></div>)}</div></details>}
    {!body.market_analysis && body.calculations.length > 0 && <details className="gc-calculation-details" open={expanded}><summary>Calculation</summary>{body.calculations.map((calc, i) => <p className="gc-formula" key={i}><strong>{calc.label}</strong><br />{calc.formula} = {calc.value}</p>)}</details>}
    {body.caveats.length > 0 && <div className="gc-answer-limit"><strong>Sources & assumptions</strong><p>{body.caveats[0]}</p>{body.caveats.length > 1 && <button onClick={() => onEvidence()}>View all {body.caveats.length} limitations →</button>}</div>}
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
    return <details key={source.id} className="gc-source-card" open={selectedRef === source.ref_index || undefined}><summary><span>[{source.ref_index}]</span><div><strong>{source.title ?? source.source}</strong><small>{source.source} · {source.updated_at}</small></div><b>＋</b></summary><div>{typeof data.contribution === 'string' && <p>{data.contribution}</p>}{rows.map((row, i) => <dl key={i}><dt>{String(row.k ?? '')}</dt><dd>{safeUrl(row.v) ? <a href={safeUrl(row.v)!} target="_blank" rel="noreferrer">Open source ↗</a> : String(row.v ?? 'Not recorded')}</dd></dl>)}{url && <a href={url} target="_blank" rel="noreferrer">Open original source ↗</a>}</div></details>;
  })}</div>;
}
function briefTitle(brief: Brief): string {
  const result = isFactualBody(brief.body) ? brief.body.seller_move_analysis?.result : null;
  return result ? `${result.player.player_name} · ${result.proposal.pick_year} round ${result.proposal.pick_round} trade scenario` : brief.question;
}
function downloadBrief(brief: Brief, sources: BriefSource[]) {
  if (!isFactualBody(brief.body)) return;
  const body = brief.body;
  const cell = (value: unknown) => String(value ?? 'Not recorded').replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = [`# ${briefTitle(brief)}`, `New York Giants · saved ${brief.created_at}`, '', `Question: ${brief.question}`, '', body.answer, ''];
  const table = (title: string, columns: string[], rows: unknown[][]) => {
    if (!rows.length) return;
    lines.push(`## ${title}`, `| ${columns.map(cell).join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`, ...rows.map(row => `| ${row.map(cell).join(' | ')} |`), '');
  };
  for (const finding of body.key_findings) lines.push(`## ${finding.label}`, finding.body, '');
  for (const item of body.tables) table(item.title, item.columns, item.rows);
  for (const calc of body.calculations) lines.push(`**${calc.label}:** ${calc.formula} = ${calc.value}`, '');
  const seller = body.seller_move_analysis?.result;
  if (seller?.cap.next_year) {
    const next = seller.cap.next_year;
    lines.push(`## ${next.year} contract calculation`, `${money(next.scheduled_cap_dollars)} scheduled cap charge − ${money(next.accelerated_dead_money_dollars)} accelerated dead money = ${money(next.cap_effect_dollars)} cap-space effect.`, '');
  }
  if (body.market_analysis) {
    const market = body.market_analysis;
    lines.push('## Historical scope', `${market.query.start_year}–${market.query.end_year}; ${market.query.position_groups.join(', ') || 'all positions'}; ${market.query.transaction_types.join(', ')}; ${market.query.team_ids.join(', ') || 'leaguewide'}.`, `${market.coverage.event_count} player events; ${market.coverage.distinct_trade_count ?? 'unrecorded'} distinct trades.`, '');
    if (!seller) table(`Period measures: ${market.query.baseline_years.join('–')} → ${market.query.recent_years.join('–')}`, ['Position', 'Player events', 'Events per 100 player-seasons'], market.position_trends.map(t => [t.position_group, t.event_count, `${t.mobility.baseline_value == null ? 'Not recorded' : (t.mobility.baseline_value / 100).toFixed(2)} → ${t.mobility.recent_value == null ? 'Not recorded' : (t.mobility.recent_value / 100).toFixed(2)}`]));
    const cohort = nflTransactionMarketCohortEvidence(market);
    const events = seller ? cohort.rows.filter(r => seller.comparables.some(c => c.event_id === r.event_id)) : cohort.rows;
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
