import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { getCbaArticle, listCba, searchCbaArticles, streamCbaChat } from '../api/cba';
import { fire } from '../lib/events';
import { useUi } from '../store';
import type {
  CbaArticleResponse,
  CbaCitation,
  CbaChunk,
  CbaDocument,
  CbaSearchContextPayload,
  CbaSection,
} from '@shared/types';

type ChatEntry = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: CbaCitation[];
  contexts: CbaSearchContextPayload[];
  action?: 'open_analyze';
  boundaryQuestion?: string;
};

type CbaLinkState = {
  articleId: string | null;
  chunkId: string | null;
};

const RELATED_CONCEPTS = [
  { label: 'Second apron', query: 'second apron' },
  { label: 'Hard cap', query: 'hard cap' },
  { label: 'Trade aggregation', query: 'trade aggregation' },
  { label: 'Bird rights', query: 'Bird rights' },
  { label: 'Sign-and-trade', query: 'sign and trade' },
];

export function CbaWorkbench() {
  const { setActiveNav } = useUi();
  const [document, setDocument] = useState<CbaDocument | null>(null);
  const [tocSections, setTocSections] = useState<CbaSection[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSections, setSearchSections] = useState<CbaSection[]>([]);
  const [selected, setSelected] = useState<CbaArticleResponse | null>(null);
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [highlightedChunkId, setHighlightedChunkId] = useState<string | null>(null);
  const [relatedContexts, setRelatedContexts] = useState<CbaSearchContextPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const chunkRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const initialLinkRef = useRef(readCbaLinkState());

  const selectArticle = useCallback(async (
    id: string,
    chunkId: string | null = null,
    options: { updateUrl?: boolean } = {},
  ) => {
    try {
      const next = await getCbaArticle(id);
      setSelected(next);
      setSelectedChunkId(chunkId);
      setHighlightedChunkId(chunkId);
      if (options.updateUrl !== false) writeCbaLinkState(id, chunkId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CBA section unavailable.');
    }
  }, []);

  const openAnalyzeWithDraft = useCallback((text: string) => {
    clearCbaLinkState();
    setActiveNav('analyze');
    window.setTimeout(() => {
      fire('v6d3cf:prefill-composer', { text });
    }, 80);
  }, [setActiveNav]);

  useEffect(() => {
    let cancelled = false;
    listCba()
      .then(async (res) => {
        if (cancelled) return;
        setDocument(res.document);
        setTocSections(res.sections);
        const initial = initialLinkRef.current;
        const initialSection = initial.articleId
          ? res.sections.find((section) => section.id === initial.articleId)
          : null;
        const target = initialSection ?? res.sections[0] ?? null;
        if (target) await selectArticle(target.id, initialSection ? initial.chunkId : null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'CBA corpus unavailable.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectArticle]);

  useEffect(() => {
    const onPopState = () => {
      const next = readCbaLinkState();
      if (!next.articleId) return;
      void selectArticle(next.articleId, next.chunkId, { updateUrl: false });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [selectArticle]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchSections([]);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchCbaArticles(q)
        .then((res) => {
          if (!cancelled) setSearchSections(res.sections);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'CBA search failed.');
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  useEffect(() => {
    if (!highlightedChunkId) return;
    const node = chunkRefs.current[highlightedChunkId];
    if (!node) return;
    requestAnimationFrame(() => node.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    const timeout = window.setTimeout(() => setHighlightedChunkId(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [selected?.section.id, highlightedChunkId]);

  const visibleSections = searchQuery.trim() ? searchSections : tocSections;

  return (
    <section style={{
      height: '100%',
      minHeight: 0,
      display: 'grid',
      gridTemplateColumns: '300px minmax(420px, 1fr) 380px',
      background: F.paper,
      color: F.ink,
    }}>
      <CbaIndexPanel
        document={document}
        sections={visibleSections}
        selectedId={selected?.section.id ?? null}
        searchQuery={searchQuery}
        onSearch={setSearchQuery}
        onSelect={(id) => { void selectArticle(id); }}
        loading={loading}
        error={error}
      />
      <CbaReader
        selected={selected}
        highlightedChunkId={highlightedChunkId}
        relatedContexts={relatedContexts}
        chunkRefs={chunkRefs}
        onNavigate={(articleId, chunkId) => { void selectArticle(articleId, chunkId); }}
        onOpenAnalyzeDraft={openAnalyzeWithDraft}
      />
      <CbaChatRail
        selected={selected}
        selectedChunkId={selectedChunkId}
        onNavigate={(articleId, chunkId) => { void selectArticle(articleId, chunkId); }}
        onContexts={setRelatedContexts}
        onOpenAnalyze={(question) => {
          const prompt = question
            ? `Analyze this live/team-specific question with current cap data, then cite the relevant CBA rule: ${question}`
            : 'Analyze this live/team-specific question with current cap data, then cite the relevant CBA rule.';
          openAnalyzeWithDraft(prompt);
        }}
      />
    </section>
  );
}

function CbaIndexPanel({
  document,
  sections,
  selectedId,
  searchQuery,
  onSearch,
  onSelect,
  loading,
  error,
}: {
  document: CbaDocument | null;
  sections: CbaSection[];
  selectedId: string | null;
  searchQuery: string;
  onSearch: (query: string) => void;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <aside style={{
      borderRight: `1px solid ${F.border}`,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: F.paper,
    }}>
      <div style={{ padding: SPACE.lg, borderBottom: `1px solid ${F.border}` }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.xs,
          fontWeight: 700,
          letterSpacing: TRACKING.micro,
          color: F.fgMuted,
          textTransform: 'uppercase',
        }}>CBA reference</div>
        <div style={{
          marginTop: SPACE.xs,
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.lg,
          fontWeight: 600,
          color: F.ink,
          lineHeight: 1.25,
        }}>{document?.season_label ?? '2023 CBA'}</div>
        <div style={{
          marginTop: SPACE.xs,
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.md,
          color: F.fgMuted,
        }}>{document ? `${document.page_count} PDF pages` : 'Loading'}</div>
      </div>
      <div style={{ padding: SPACE.md, borderBottom: `1px solid ${F.border}` }}>
        <input
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search sections"
          style={{
            width: '100%',
            height: 34,
            boxSizing: 'border-box',
            border: `1px solid ${F.borderStrong}`,
            borderRadius: RADIUS.md,
            background: F.surface,
            padding: `0 ${SPACE.md}px`,
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.sm,
            color: F.ink,
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs, marginTop: SPACE.sm }}>
          {RELATED_CONCEPTS.map((concept) => (
            <button
              key={concept.query}
              onClick={() => onSearch(concept.query)}
              style={{
                border: `1px solid ${F.border}`,
                borderRadius: RADIUS.pill,
                background: searchQuery === concept.query ? F.fenwaySoft : F.surface,
                color: searchQuery === concept.query ? F.fenway : F.fgMuted,
                padding: `2px ${SPACE.sm}px`,
                fontFamily: 'var(--font-mono)',
                fontSize: TYPE.meta.sm,
                cursor: 'pointer',
              }}
            >
              {concept.label}
            </button>
          ))}
        </div>
      </div>
      <div className="gd-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `${SPACE.sm}px 0` }}>
        {loading && <PanelNote>Loading CBA corpus...</PanelNote>}
        {!loading && error && <PanelNote>{error}</PanelNote>}
        {!loading && !error && sections.length === 0 && <PanelNote>No matching sections.</PanelNote>}
        {sections.map((section) => {
          const active = section.id === selectedId;
          return (
            <button
              key={section.id}
              onClick={() => onSelect(section.id)}
              style={{
                width: '100%',
                border: 'none',
                borderLeft: active ? `2px solid ${F.fenway}` : '2px solid transparent',
                borderBottom: `1px solid ${F.border}`,
                background: active ? F.cream50 : 'transparent',
                padding: `${SPACE.sm}px ${SPACE.md}px`,
                textAlign: 'left',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = F.cream50; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontSize: TYPE.body.sm,
                fontWeight: active ? 600 : 500,
                color: active ? F.ink : F.inkSoft,
                lineHeight: 1.35,
              }}>{section.label}</div>
              <div style={{
                marginTop: 3,
                fontFamily: 'var(--font-mono)',
                fontSize: TYPE.meta.sm,
                color: F.fgMuted,
                letterSpacing: TRACKING.caps,
              }}>{pageLabel(section)}</div>
              {section.snippet && (
                <div style={{
                  marginTop: SPACE.xs,
                  fontFamily: 'var(--font-sans)',
                  fontSize: TYPE.meta.md,
                  color: F.fgMuted,
                  lineHeight: 1.35,
                }}>
                  <HighlightedText text={section.snippet} terms={section.match_terms ?? []} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function CbaReader({
  selected,
  highlightedChunkId,
  relatedContexts,
  chunkRefs,
  onNavigate,
  onOpenAnalyzeDraft,
}: {
  selected: CbaArticleResponse | null;
  highlightedChunkId: string | null;
  relatedContexts: CbaSearchContextPayload[];
  chunkRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onNavigate: (articleId: string, chunkId: string | null) => void;
  onOpenAnalyzeDraft: (text: string) => void;
}) {
  if (!selected) {
    return (
      <main style={{ minHeight: 0, overflow: 'auto', padding: SPACE.xl }}>
        <PanelNote>Select a CBA section.</PanelNote>
      </main>
    );
  }

  const related = uniqueRelatedContexts(relatedContexts, selected.section.id).slice(0, 4);

  return (
    <main className="gd-scroll" style={{
      minHeight: 0,
      overflowY: 'auto',
      background: F.surface,
    }}>
      <article style={{ maxWidth: 880, margin: '0 auto', padding: `${SPACE['2xl']}px ${SPACE['2xl']}px ${SPACE['4xl']}px` }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.md,
          color: F.fgMuted,
          letterSpacing: TRACKING.caps,
          textTransform: 'uppercase',
        }}>{selected.section.article}{selected.section.section_number ? ` / Section ${selected.section.section_number}` : ''}</div>
        <h1 style={{
          margin: `${SPACE.sm}px 0 ${SPACE.sm}px`,
          fontFamily: 'var(--font-display)',
          fontSize: TYPE.display.lg,
          lineHeight: 1.15,
          letterSpacing: TRACKING.body,
          color: F.ink,
        }}>{selected.section.label}</h1>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.md,
          color: F.fgMuted,
          marginBottom: SPACE.xl,
        }}>{pageLabel(selected.section)}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.lg }}>
          <button
            onClick={() => onOpenAnalyzeDraft(buildAnalyzeRulePrompt(selected.section))}
            style={secondaryButtonStyle}
          >
            Explain this rule in Analyze
          </button>
          <button
            onClick={() => copyText(sectionDeepLink(selected.section.id, null))}
            style={secondaryButtonStyle}
          >
            Copy section link
          </button>
        </div>
        {related.length > 0 && (
          <div style={{
            border: `1px solid ${F.border}`,
            borderRadius: RADIUS.md,
            background: F.paper,
            padding: SPACE.md,
            marginBottom: SPACE.lg,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.xs,
              color: F.fgMuted,
              letterSpacing: TRACKING.micro,
              textTransform: 'uppercase',
              marginBottom: SPACE.sm,
            }}>Related sections</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>
              {related.map((context) => (
                <button
                  key={`${context.article_id}-${context.chunk_id}`}
                  onClick={() => onNavigate(context.article_id, context.chunk_id)}
                  style={{
                    border: `1px solid ${F.borderStrong}`,
                    borderRadius: RADIUS.pill,
                    background: F.surface,
                    color: F.inkSoft,
                    padding: `3px ${SPACE.sm}px`,
                    fontFamily: 'var(--font-mono)',
                    fontSize: TYPE.meta.sm,
                    cursor: 'pointer',
                  }}
                >
                  {formatCitationLabel(context)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: SPACE.md,
        }}>
          {selected.chunks.map((chunk) => {
            const highlighted = chunk.id === highlightedChunkId;
            return (
              <div
                key={chunk.id}
                ref={(el) => { chunkRefs.current[chunk.id] = el; }}
                style={{
                  padding: `${SPACE.md}px ${SPACE.lg}px`,
                  border: `1px solid ${highlighted ? F.fenway : F.border}`,
                  borderRadius: RADIUS.md,
                  background: highlighted ? F.fenwaySoft : F.paper,
                  boxShadow: highlighted ? F.shadow : 'none',
                  transition: 'background 160ms ease, border 160ms ease, box-shadow 160ms ease',
                }}
              >
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: TYPE.meta.xs,
                  color: F.fgMuted,
                  marginBottom: SPACE.sm,
                  letterSpacing: TRACKING.micro,
                  textTransform: 'uppercase',
                }}>Chunk {chunk.chunk_index} {pageLabel(chunk) ? `- ${pageLabel(chunk)}` : ''}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs, marginBottom: SPACE.sm }}>
                  <button
                    onClick={() => onOpenAnalyzeDraft(buildAnalyzeRulePrompt(selected.section, chunk))}
                    style={miniButtonStyle}
                  >
                    Explain chunk in Analyze
                  </button>
                  <button
                    onClick={() => copyText(sectionDeepLink(selected.section.id, chunk.id))}
                    style={miniButtonStyle}
                  >
                    Copy chunk link
                  </button>
                </div>
                <p style={{
                  margin: 0,
                  fontFamily: 'var(--font-sans)',
                  fontSize: TYPE.body.md,
                  lineHeight: 1.65,
                  color: F.ink,
                  whiteSpace: 'pre-wrap',
                }}>{chunk.body}</p>
              </div>
            );
          })}
        </div>
      </article>
    </main>
  );
}

function CbaChatRail({
  selected,
  selectedChunkId,
  onNavigate,
  onContexts,
  onOpenAnalyze,
}: {
  selected: CbaArticleResponse | null;
  selectedChunkId: string | null;
  onNavigate: (articleId: string, chunkId: string | null) => void;
  onContexts: (contexts: CbaSearchContextPayload[]) => void;
  onOpenAnalyze: (question: string) => void;
}) {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, [messages, streaming]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || streaming) return;
    const assistantId = `assistant-${Date.now()}`;
    setDraft('');
    setStreaming(true);
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: 'user', content: text, citations: [], contexts: [] },
      { id: assistantId, role: 'assistant', content: '', citations: [], contexts: [] },
    ]);

    try {
      for await (const streamEvent of streamCbaChat({
        message: text,
        activeArticleId: selected?.section.id ?? null,
        selectedChunkId,
      })) {
        if (streamEvent.type === 'context') {
          const contexts = streamEvent.contexts ?? [];
          onContexts(contexts);
          setMessages((current) => current.map((entry) => (
            entry.id === assistantId ? { ...entry, contexts } : entry
          )));
        } else if (streamEvent.type === 'token') {
          setMessages((current) => current.map((entry) => (
            entry.id === assistantId ? { ...entry, content: `${entry.content}${streamEvent.text}` } : entry
          )));
        } else if (streamEvent.type === 'citation') {
          setMessages((current) => current.map((entry) => (
            entry.id === assistantId
              ? { ...entry, citations: mergeCitations(entry.citations, streamEvent.citation) }
              : entry
          )));
        } else if (streamEvent.type === 'navigate') {
          onNavigate(streamEvent.article_id, streamEvent.chunk_id);
        } else if (streamEvent.type === 'boundary') {
          setMessages((current) => current.map((entry) => (
            entry.id === assistantId
              ? { ...entry, action: streamEvent.action, boundaryQuestion: streamEvent.question }
              : entry
          )));
        } else if (streamEvent.type === 'error') {
          setMessages((current) => current.map((entry) => (
            entry.id === assistantId ? { ...entry, content: streamEvent.message } : entry
          )));
        }
      }
    } catch (err) {
      setMessages((current) => current.map((entry) => (
        entry.id === assistantId
          ? { ...entry, content: err instanceof Error ? err.message : 'CBA chat failed.' }
          : entry
      )));
    } finally {
      setStreaming(false);
    }
  };

  return (
    <aside style={{
      borderLeft: `1px solid ${F.border}`,
      background: F.paper,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ padding: SPACE.lg, borderBottom: `1px solid ${F.border}` }}>
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.lg,
          fontWeight: 600,
          color: F.ink,
        }}>CBA Navigator</div>
        <div style={{
          marginTop: SPACE.xs,
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.md,
          color: F.fgMuted,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>{selected?.section.label ?? 'No section selected'}</div>
      </div>
      <div ref={scrollRef} className="gd-scroll" style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: SPACE.md,
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.md,
      }}>
        {messages.length === 0 && (
          <div style={{
            border: `1px solid ${F.border}`,
            background: F.surface,
            borderRadius: RADIUS.md,
            padding: SPACE.md,
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.sm,
            color: F.fgMuted,
            lineHeight: 1.5,
          }}>
            Ask for a rule, exception, definition, article, or section.
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} style={{
            alignSelf: message.role === 'user' ? 'flex-end' : 'stretch',
            maxWidth: message.role === 'user' ? '88%' : '100%',
            background: message.role === 'user' ? F.fenwaySoft : F.surface,
            border: `1px solid ${message.role === 'user' ? F.fenway : F.border}`,
            borderRadius: RADIUS.md,
            padding: SPACE.md,
          }}>
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
              color: F.ink,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>{message.content || (streaming && message.role === 'assistant' ? 'Searching CBA...' : '')}</div>
            {message.citations.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs, marginTop: SPACE.sm }}>
                {message.citations.map((citation) => (
                  <div
                    key={`${message.id}-${citation.article_id}-${citation.chunk_id}`}
                    style={{ display: 'flex', gap: SPACE.xs, flexWrap: 'wrap', alignItems: 'center' }}
                  >
                    <button
                      onClick={() => onNavigate(citation.article_id, citation.chunk_id)}
                      style={citationButtonStyle}
                    >
                      {formatCitationLabel(citation)}
                    </button>
                    <button
                      onClick={() => copyText(formatCitationCopyText(citation))}
                      style={miniButtonStyle}
                    >
                      Copy cite
                    </button>
                    <button
                      onClick={() => copyText(sectionDeepLink(citation.article_id, citation.chunk_id))}
                      style={miniButtonStyle}
                    >
                      Copy link
                    </button>
                  </div>
                ))}
                {message.citations.length > 1 && (
                  <CitationStepper
                    citations={message.citations}
                    selectedChunkId={selectedChunkId}
                    onNavigate={onNavigate}
                  />
                )}
              </div>
            )}
            {message.role === 'assistant' && message.contexts.length > 0 && (
              <RetrievedContextPanel
                contexts={message.contexts}
                onNavigate={onNavigate}
              />
            )}
            {message.action === 'open_analyze' && (
              <button
                onClick={() => onOpenAnalyze(message.boundaryQuestion ?? '')}
                style={{
                  marginTop: SPACE.sm,
                  height: 30,
                  border: `1px solid ${F.fenway}`,
                  borderRadius: RADIUS.md,
                  background: F.fenway,
                  color: F.surface,
                  padding: `0 ${SPACE.md}px`,
                  fontFamily: 'var(--font-sans)',
                  fontSize: TYPE.body.sm,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Open Analyze
              </button>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={submit} style={{ padding: SPACE.md, borderTop: `1px solid ${F.border}`, display: 'flex', gap: SPACE.sm }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={streaming}
          placeholder="Ask the CBA"
          rows={2}
          style={{
            flex: 1,
            resize: 'none',
            minHeight: 44,
            maxHeight: 96,
            border: `1px solid ${F.borderStrong}`,
            borderRadius: RADIUS.md,
            padding: `${SPACE.sm}px ${SPACE.md}px`,
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.sm,
            color: F.ink,
            outline: 'none',
            background: F.surface,
          }}
        />
        <button
          type="submit"
          disabled={streaming || !draft.trim()}
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            border: `1px solid ${F.fenway}`,
            borderRadius: RADIUS.md,
            background: streaming || !draft.trim() ? F.cream100 : F.fenway,
            color: streaming || !draft.trim() ? F.fgMuted : F.surface,
            cursor: streaming || !draft.trim() ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: TYPE.body.lg,
            fontWeight: 700,
          }}
          title="Send"
          aria-label="Send"
        >
          {streaming ? '...' : '>'}
        </button>
      </form>
    </aside>
  );
}

function RetrievedContextPanel({
  contexts,
  onNavigate,
}: {
  contexts: CbaSearchContextPayload[];
  onNavigate: (articleId: string, chunkId: string | null) => void;
}) {
  return (
    <details style={{
      marginTop: SPACE.sm,
      border: `1px solid ${F.border}`,
      borderRadius: RADIUS.md,
      background: F.paper,
      padding: SPACE.sm,
    }}>
      <summary style={{
        cursor: 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: TYPE.meta.sm,
        color: F.fgMuted,
        letterSpacing: TRACKING.caps,
      }}>Retrieved context</summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm, marginTop: SPACE.sm }}>
        {contexts.map((context, index) => (
          <div
            key={`${context.article_id}-${context.chunk_id}-${index}`}
            style={{
              border: `1px solid ${F.border}`,
              borderRadius: RADIUS.md,
              background: F.surface,
              padding: SPACE.sm,
            }}
          >
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: SPACE.xs,
              alignItems: 'center',
              marginBottom: SPACE.xs,
            }}>
              <button
                onClick={() => onNavigate(context.article_id, context.chunk_id)}
                style={citationButtonStyle}
              >
                {formatCitationLabel(context)}
              </button>
              <span style={contextPillStyle}>{context.support_level}</span>
              <span style={contextPillStyle}>{context.match_kind.replace(/_/g, ' ')}</span>
              <span style={contextPillStyle}>score {context.score}</span>
            </div>
            <div style={{
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.meta.md,
              color: F.inkSoft,
              lineHeight: 1.45,
            }}>{context.quote}</div>
          </div>
        ))}
      </div>
    </details>
  );
}

function CitationStepper({
  citations,
  selectedChunkId,
  onNavigate,
}: {
  citations: CbaCitation[];
  selectedChunkId: string | null;
  onNavigate: (articleId: string, chunkId: string | null) => void;
}) {
  const step = (direction: -1 | 1) => {
    const currentIndex = Math.max(0, citations.findIndex((citation) => citation.chunk_id === selectedChunkId));
    const next = citations[(currentIndex + direction + citations.length) % citations.length];
    if (next) onNavigate(next.article_id, next.chunk_id);
  };
  return (
    <div style={{ display: 'flex', gap: SPACE.xs }}>
      <button onClick={() => step(-1)} style={miniButtonStyle}>Prev cited</button>
      <button onClick={() => step(1)} style={miniButtonStyle}>Next cited</button>
    </div>
  );
}

function PanelNote({ children }: { children: ReactNode }) {
  return (
    <div style={{
      margin: SPACE.md,
      padding: SPACE.md,
      border: `1px solid ${F.border}`,
      borderRadius: RADIUS.md,
      background: F.surface,
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.body.sm,
      color: F.fgMuted,
      lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}

function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  const cleanTerms = terms
    .map((term) => term.trim())
    .filter((term) => term.length > 2)
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
  if (cleanTerms.length === 0) return <>{text}</>;

  const pattern = new RegExp(`(${cleanTerms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) => {
        const highlighted = cleanTerms.some((term) => term.toLowerCase() === part.toLowerCase());
        return highlighted ? (
          <mark
            key={`${part}-${index}`}
            style={{
              background: F.fenwaySoft,
              color: F.ink,
              padding: '0 2px',
              borderRadius: RADIUS.sm,
            }}
          >
            {part}
          </mark>
        ) : part;
      })}
    </>
  );
}

const secondaryButtonStyle: CSSProperties = {
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.md,
  background: F.paper,
  color: F.inkSoft,
  padding: `${SPACE.xs}px ${SPACE.md}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 600,
  cursor: 'pointer',
};

const miniButtonStyle: CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.pill,
  background: F.paper,
  color: F.fgMuted,
  padding: `2px ${SPACE.sm}px`,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  cursor: 'pointer',
};

const citationButtonStyle: CSSProperties = {
  border: `1px solid ${F.fenway}`,
  borderRadius: RADIUS.pill,
  background: F.paper,
  color: F.fenway,
  padding: `3px ${SPACE.sm}px`,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  cursor: 'pointer',
};

const contextPillStyle: CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.pill,
  background: F.cream50,
  color: F.fgMuted,
  padding: `2px ${SPACE.xs}px`,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
};

function pageLabel(item: { page_start: number | null; page_end: number | null }): string {
  if (item.page_start == null) return '';
  if (item.page_end == null || item.page_end === item.page_start) return `p. ${item.page_start}`;
  return `pp. ${item.page_start}-${item.page_end}`;
}

function formatCitationLabel(item: {
  label: string;
  page_start: number | null;
  page_end: number | null;
}): string {
  const sectionLabel = item.label.split(' - ')[0] ?? item.label;
  const pages = pageLabel(item);
  return pages ? `${sectionLabel}, ${pages}` : sectionLabel;
}

function formatCitationCopyText(citation: CbaCitation): string {
  return `${formatCitationLabel(citation)}: "${citation.quote}"`;
}

function sectionDeepLink(articleId: string, chunkId: string | null): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'cba');
  url.searchParams.set('article', articleId);
  if (chunkId) url.searchParams.set('chunk', chunkId);
  else url.searchParams.delete('chunk');
  return url.toString();
}

function buildAnalyzeRulePrompt(section: CbaSection, chunk?: CbaChunk): string {
  const quote = chunk ? ` Quote: "${clipWords(chunk.body, 42)}"` : '';
  const page = pageLabel(chunk ?? section);
  const cite = page ? `${section.label} (${page})` : section.label;
  return `Explain this CBA rule in Analyze against current team/cap context. CBA citation: ${cite}.${quote}`;
}

function uniqueRelatedContexts(
  contexts: CbaSearchContextPayload[],
  currentArticleId: string,
): CbaSearchContextPayload[] {
  const seen = new Set<string>();
  const out: CbaSearchContextPayload[] = [];
  for (const context of contexts) {
    if (context.article_id === currentArticleId) continue;
    if (seen.has(context.article_id)) continue;
    seen.add(context.article_id);
    out.push(context);
  }
  return out;
}

function copyText(text: string): void {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch((err) => {
    console.warn('[cba] copy failed', err);
  });
}

function clipWords(text: string, maxWords: number): string {
  const words = text.replace(/\s+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const clipped = words.slice(0, maxWords).join(' ');
  return words.length > maxWords ? `${clipped}...` : clipped;
}

function mergeCitations(citations: CbaCitation[], next: CbaCitation): CbaCitation[] {
  if (citations.some((citation) => citation.article_id === next.article_id && citation.chunk_id === next.chunk_id)) {
    return citations;
  }
  return [...citations, next];
}

function readCbaLinkState(): CbaLinkState {
  if (typeof window === 'undefined') return { articleId: null, chunkId: null };
  const params = new URLSearchParams(window.location.search);
  if (params.get('tab') !== 'cba') return { articleId: null, chunkId: null };
  return {
    articleId: params.get('article'),
    chunkId: params.get('chunk'),
  };
}

function writeCbaLinkState(articleId: string, chunkId: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', 'cba');
  url.searchParams.set('article', articleId);
  if (chunkId) url.searchParams.set('chunk', chunkId);
  else url.searchParams.delete('chunk');
  window.history.replaceState(null, '', url);
}

function clearCbaLinkState(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('tab') !== 'cba') return;
  url.searchParams.delete('tab');
  url.searchParams.delete('article');
  url.searchParams.delete('chunk');
  window.history.replaceState(null, '', url);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
