import { useEffect, useMemo, useRef, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { BriefRecommendationCard } from './BriefRecommendationCard';
import { BriefTemplatePicker } from './BriefTemplatePicker';
import { CompactBriefRow } from './CompactBriefRow';
import { Composer } from './Composer';
import { on as onEvt } from '../lib/events';
import { useBriefs, useSessions, useToasts, useUi } from '../store';
import { createBrief, createBriefWithSession, regenerateBrief } from '../api/briefs';
import {
  renameSession as renameSessionApi,
  deriveChannelLabel,
  UNTITLED_CHANNEL_LABEL,
} from '../api/sessions';
import { runAgent } from '../api/agent';
import { stripBriefModePrefix } from '@shared/briefMode';
import { briefModeForTemplate, inferBriefTemplateFromQuestion } from '@shared/briefTemplates';
import type { AgentKind, Brief, BriefTemplateId, BriefTemplateSelection } from '@shared/types';

const CONTENT_MAX_WIDTH = 760;

/**
 * Phase 9 — channel feed with focused-card expand/collapse pattern.
 *
 *   - One brief is "focused" at a time (the rest render as compact rows).
 *   - Effective focus = `expandedBriefId` (if it belongs to active session)
 *     else most-recent brief in the channel. Explicit clicks override.
 *   - The focused brief renders the full recommendation card with a "Reply"
 *     button at the bottom that opens the right-panel thread mode.
 *   - Channel composer pinned at the bottom creates new briefs in the active
 *     session. Submitting auto-focuses the new brief AND opens its thread
 *     in the right panel so follow-ups land where the user expects.
 */
export function SessionFeed() {
  const { sessions, activeSessionId, patchSessionLabel, insertSession, setActiveSession } = useSessions();
  const {
    briefs,
    insertBrief, setActiveBrief,
    loadBriefData, loadArtifacts,
  } = useBriefs();
  const {
    expandedBriefId, setExpandedBrief, setRightPanelMode, setRightPanelOpen,
  } = useUi();
  const { pushToast } = useToasts();
  const [submitting, setSubmitting] = useState(false);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [templateSelection, setTemplateSelection] = useState<BriefTemplateSelection>({ template_id: 'decision_brief' });
  const [templateManuallySelected, setTemplateManuallySelected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<HTMLDivElement>(null);

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const suggestedTemplateId = useMemo<BriefTemplateId>(
    () => inferBriefTemplateFromQuestion(draftQuestion),
    [draftQuestion],
  );
  const displayedTemplateSelection = templateManuallySelected
    ? templateSelection
    : { template_id: suggestedTemplateId };

  const chooseTemplate = (selection: BriefTemplateSelection) => {
    setTemplateSelection(selection);
    setTemplateManuallySelected(true);
  };

  // Briefs in this channel, oldest-first (Slack feed order).
  const channelBriefs = useMemo(
    () => briefs
      .filter((b) => b.session_id === activeSessionId)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [briefs, activeSessionId],
  );

  // Effective focused brief: explicit selection wins; otherwise default to
  // most-recent in the channel. This means a freshly-loaded channel always
  // has *one* expanded card without forcing a write to expandedBriefId.
  const effectiveFocusedId = useMemo(() => {
    if (expandedBriefId && channelBriefs.some((b) => b.id === expandedBriefId)) {
      return expandedBriefId;
    }
    const last = channelBriefs[channelBriefs.length - 1];
    return last?.id ?? null;
  }, [expandedBriefId, channelBriefs]);

  // Sync activeBriefId with the focused card so OptionsTable / cap strip / etc.
  // follow the user's attention naturally.
  useEffect(() => {
    if (effectiveFocusedId) setActiveBrief(effectiveFocusedId);
  }, [effectiveFocusedId, setActiveBrief]);

  // Eagerly load each visible brief's sources/options/artifacts so the focused
  // card lands with real data and compact rows pre-fetch in the background.
  useEffect(() => {
    for (const b of channelBriefs) {
      void loadBriefData(b.id);
      void loadArtifacts(b.id);
    }
  }, [channelBriefs, loadBriefData, loadArtifacts]);

  // Two scroll behaviors depending on what changed the focused brief:
  //
  //   1. In-feed click (compact row → expanded card) — scroll-then-expand.
  //      The clicked compact row smooth-scrolls to the top of the feed
  //      first; once the scroll lands (`scrollend` event, or 400ms fallback),
  //      we set the expanded brief. This separates "navigate" from "expand"
  //      so the user sees a single smooth glide in the direction of their
  //      click instead of a layout jump + chase-the-target scroll. See
  //      `onCompactClick` below.
  //
  //   2. Navigation (deep link, right-panel pick, monitors jump, etc.) —
  //      smooth-scrolls the focused brief to the top of the feed after the
  //      state change has landed. Double-rAF defers until layout commits so
  //      the glide animates to a stable target. The `inFeedClickRef` flag
  //      lets click flow skip this effect (the click handler does its own
  //      scroll) without the two paths fighting.
  const isInitialFocusRef = useRef(true);
  const inFeedClickRef = useRef(false);
  useEffect(() => {
    if (!effectiveFocusedId) return;
    if (isInitialFocusRef.current) {
      isInitialFocusRef.current = false;
      return;
    }
    if (inFeedClickRef.current) {
      inFeedClickRef.current = false;
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Prefer the recommendation card itself (skips past the user-question
        // bubble above it) so the answer lands at the top of the feed. Falls
        // back to the wrapper ref if for some reason the card hasn't mounted.
        const scrollEl = scrollRef.current;
        const cardEl = scrollEl?.querySelector<HTMLElement>(
          `[data-brief-id="${effectiveFocusedId}"] [data-recommendation-card="true"]`,
        );
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          focusedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }, [effectiveFocusedId]);

  // Scroll-then-expand. On compact-row click:
  //   1. Smooth-scroll the clicked row to the top of the feed.
  //   2. Wait for `scrollend` (or 400ms fallback for browsers without it).
  //   3. Set the expanded brief — at this point the clicked row is at the top,
  //      so the layout shift happens cleanly without a competing scroll.
  // `pendingExpandRef` tracks the in-flight expansion so a rapid second click
  // can cancel the first; only the last-clicked brief ends up expanded.
  const pendingExpandRef = useRef<{ briefId: string; timer: number; cleanup: () => void } | null>(null);
  const onCompactClick = (briefId: string, originEl: HTMLElement) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) {
      setExpandedBrief(briefId);
      return;
    }

    // Cancel any prior in-flight scroll-then-expand.
    if (pendingExpandRef.current) {
      pendingExpandRef.current.cleanup();
      pendingExpandRef.current = null;
    }

    // If the row is already at the top of the feed (within scrollMarginTop
    // budget), skip the scroll dance — just expand.
    const rowTop = originEl.getBoundingClientRect().top;
    const containerTop = scrollEl.getBoundingClientRect().top;
    const distance = Math.abs(rowTop - containerTop - 12);
    if (distance < 3) {
      inFeedClickRef.current = true;
      setExpandedBrief(briefId);
      return;
    }

    originEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const expand = () => {
      if (pendingExpandRef.current?.briefId !== briefId) return;
      pendingExpandRef.current = null;
      inFeedClickRef.current = true;
      setExpandedBrief(briefId);
      // After the layout commits with the focused card (which renders the
      // user-question bubble above the recommendation card), scroll the
      // RECOMMENDATION CARD itself to the top of the feed instead of the
      // wrapper. Otherwise the question lands at the top and the actual
      // answer is pushed below — the click target was the row showing the
      // thesis, so the user expects the corresponding card at the top.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const scrollEl2 = scrollRef.current;
          if (!scrollEl2) return;
          const cardEl = scrollEl2.querySelector<HTMLElement>(
            `[data-brief-id="${briefId}"] [data-recommendation-card="true"]`,
          );
          if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'auto', block: 'start' });
          }
        });
      });
    };

    const onScrollEnd = () => {
      if (pendingExpandRef.current?.briefId !== briefId) return;
      window.clearTimeout(pendingExpandRef.current.timer);
      scrollEl.removeEventListener('scrollend', onScrollEnd);
      expand();
    };
    scrollEl.addEventListener('scrollend', onScrollEnd);

    const timer = window.setTimeout(() => {
      scrollEl.removeEventListener('scrollend', onScrollEnd);
      expand();
    }, 400);

    pendingExpandRef.current = {
      briefId,
      timer,
      cleanup: () => {
        window.clearTimeout(timer);
        scrollEl.removeEventListener('scrollend', onScrollEnd);
      },
    };
  };

  // Listen for /regenerate slash command from the channel composer (or any
  // composer that fires the global event). Targets the focused brief.
  useEffect(() => onEvt('v6d3cf:slash-regenerate', () => {
    if (!effectiveFocusedId) return;
    void regenerateBrief(effectiveFocusedId).catch((err) => {
      pushToast({
        tone: 'error',
        message: 'Couldn’t regenerate brief',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    });
  }), [effectiveFocusedId, pushToast]);

  const submitNewBrief = async (text: string) => {
    const parsed = stripBriefModePrefix(text);
    const q = parsed.question.trim();
    const template = parsed.mode === 'data_analyst'
      ? { template_id: 'data_table' as const }
      : (templateManuallySelected ? templateSelection : { template_id: inferBriefTemplateFromQuestion(text) });
    const mode = briefModeForTemplate(template) ?? parsed.mode ?? 'brief';
    if (!q || submitting) return;
    setSubmitting(true);
    try {
      let brief;
      if (!activeSessionId) {
        // First-question case (no channel yet) — create session + brief in
        // one shot. Session is auto-labeled from the question.
        const created = await createBriefWithSession(q, mode, template);
        insertSession(created.session);
        setActiveSession(created.session.id);
        brief = created.brief;
      } else {
        brief = await createBrief({ session_id: activeSessionId, question: q, mode, template });

        // Auto-rename Untitled channels from the first question — this is the
        // signal that the user has actually committed to this channel. Fire-
        // and-forget the API call; UI patches optimistically.
        const currentSession = sessions.find((s) => s.id === activeSessionId);
        if (currentSession && currentSession.label === UNTITLED_CHANNEL_LABEL) {
          const newLabel = deriveChannelLabel(q);
          patchSessionLabel(activeSessionId, newLabel);
          renameSessionApi(activeSessionId, newLabel).catch((err) => {
            console.warn('[session-feed] rename failed', err);
          });
        }
      }
      insertBrief(brief);
      // Focus the new brief in the feed AND open its thread in the right panel
      // so the user can immediately follow up while it generates.
      setExpandedBrief(brief.id);
      setRightPanelMode('thread');
      setRightPanelOpen(true);
      setDraftQuestion('');
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t start brief',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => onEvt('v6d3cf:submit-data-brief', ({ text }) => {
    void submitNewBrief(`/data ${text}`);
  }), [submitNewBrief]);

  // Slash-command from the channel composer dispatches an agent against the
  // currently-focused brief (best signal for "current context").
  const dispatchFromChannel = async (kind: AgentKind, label: string) => {
    if (!effectiveFocusedId) {
      pushToast({
        tone: 'info',
        message: 'Ask a question first',
        detail: 'Agents attach to a brief — start one in this channel before dispatching.',
      });
      return;
    }
    try {
      await runAgent({ brief_id: effectiveFocusedId, kind, config: {}, query: '' });
      pushToast({
        tone: 'info',
        message: `${label} dispatched`,
        detail: 'Watch the puck in the header — it pulses when finished.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t start agent',
        detail: err instanceof Error ? err.message : 'Server unreachable.',
      });
    }
  };

  if (!session) {
    // No active channel — show a centered first-question composer inline
    // within the FenwayApp shell. Submitting auto-creates the session via
    // `createBriefWithSession`. No channel-creation step required.
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: F.paper, padding: `0 ${SPACE['2xl']}px`,
      }}>
          <div style={{ width: '100%', maxWidth: 720 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: TYPE.display.lg, fontWeight: 500,
            color: F.ink, lineHeight: 1.2, letterSpacing: TRACKING.tight,
            marginBottom: SPACE.xl, textAlign: 'center',
          }}>
            What do you want to analyze?
          </div>
          <TemplateToolbar
            selected={displayedTemplateSelection}
            suggestedTemplateId={suggestedTemplateId}
            draftQuestion={draftQuestion}
            onChange={chooseTemplate}
            disabled={submitting}
          />
          <Composer
            onSubmit={submitNewBrief}
            onValueChange={setDraftQuestion}
            onSlashCommand={dispatchFromChannel}
            disabled={submitting}
            placeholder="Ask anything about cap, contracts, trades, or the CBA…"
            focusBinding="main"
            autoFocus
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: F.paper, position: 'relative' }}>
      {/* Feed — bottom padding leaves room for the floating composer overlay. */}
      <div ref={scrollRef} className="gd-scroll" style={{
        flex: 1, overflowY: 'auto',
        padding: `${SPACE.xl}px ${SPACE['2xl']}px ${SPACE['4xl'] * 2 + SPACE['3xl']}px`,
      }}>
        <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: '0 auto' }}>
          {channelBriefs.length === 0 && (
            <div style={{
              padding: `${SPACE['4xl']}px ${SPACE.md}px`, textAlign: 'center',
              fontFamily: 'var(--font-sans)', fontSize: TYPE.body.lg, color: F.fgMuted,
            }}>
              No briefs in this channel yet. Ask a question below to start the first one.
            </div>
          )}
          {channelBriefs.map((b) => (
            <FeedRow key={b.id} brief={b}
              isFocused={b.id === effectiveFocusedId}
              focusedRef={b.id === effectiveFocusedId ? focusedRef : null}
              onCompactClick={onCompactClick}
            />
          ))}
        </div>
      </div>

      {/* Floating composer with a fader above so the feed bleeds out instead
          of slamming into a hard divider. Container is non-clickable so the
          fade region doesn't intercept feed scrolling. */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}>
        <div aria-hidden="true" style={{
          position: 'absolute', left: 0, right: 0, top: -SPACE['3xl'], height: SPACE['3xl'],
          background: `linear-gradient(to bottom, ${F.paper}00, ${F.paper})`,
        }} />
        <div style={{
          background: F.paper,
          padding: `${SPACE.sm}px ${SPACE['2xl']}px ${SPACE.xl}px`,
          pointerEvents: 'auto',
        }}>
          <div style={{ maxWidth: CONTENT_MAX_WIDTH, margin: '0 auto' }}>
            <TemplateToolbar
              selected={displayedTemplateSelection}
              suggestedTemplateId={suggestedTemplateId}
              draftQuestion={draftQuestion}
              onChange={chooseTemplate}
              disabled={submitting}
            />
            <Composer
              key={activeSessionId ?? 'no-session'}
              onSubmit={submitNewBrief}
              onValueChange={setDraftQuestion}
              onSlashCommand={dispatchFromChannel}
              disabled={submitting}
              placeholder={`Ask a new question in #${session.label}…`}
              focusBinding="main"
              autoFocus={channelBriefs.length === 0}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedRow({ brief, isFocused, focusedRef, onCompactClick }: {
  brief: Brief;
  isFocused: boolean;
  focusedRef: React.RefObject<HTMLDivElement> | null;
  /** FLIP-aware expand handler from the parent — receives the click event so
   *  the parent can capture the row's pre-click bounding rect and anchor the
   *  brief at the same viewport position after the layout commits. */
  onCompactClick: (briefId: string, originEl: HTMLElement) => void;
}) {
  const {
    setExpandedBrief, setRightPanelMode, setRightPanelOpen,
    rightPanelOpen, rightPanelMode, expandedBriefId,
  } = useUi();

  if (!isFocused) {
    return (
      <>
        <UserQuestionBubble brief={brief} />
        <CompactBriefRow
          brief={brief}
          onClick={(e) => onCompactClick(brief.id, e.currentTarget)}
        />
      </>
    );
  }

  // Whether the right panel is currently showing this brief's thread —
  // determines whether a card click opens or closes it.
  const isShowingThisThread = rightPanelOpen
    && rightPanelMode === 'thread'
    && expandedBriefId === brief.id;

  const toggleThread = () => {
    if (isShowingThisThread) {
      setRightPanelOpen(false);
    } else {
      setExpandedBrief(brief.id);
      setRightPanelMode('thread');
      setRightPanelOpen(true);
    }
  };

  // Click anywhere on the focused card to toggle the thread panel for this
  // brief. Skip if the click landed on an interactive element (buttons /
  // OptionsTable controls / source pills); those handle their own actions
  // and we don't want to double-fire.
  const onCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [role="button"]')) return;
    toggleThread();
  };

  return (
    // `scrollMarginTop` on the wrapper is a fallback target. The click handler
    // actually scrolls the inner [data-recommendation-card] div, so the user
    // question bubble above lands just out of view (still scrollable into).
    // `data-brief-id` lets the FLIP click handler in the parent locate this
    // wrapper after re-render so it can compute the post-shift delta.
    <div
      ref={focusedRef ?? undefined}
      data-brief-id={brief.id}
      style={{ scrollMarginTop: SPACE.md, cursor: 'pointer' }}
      onClick={onCardClick}
    >
      <UserQuestionBubble brief={brief} />
      <BriefRecommendationCard brief={brief} embedTable onReply={toggleThread} isInThread={isShowingThisThread} />
    </div>
  );
}

function TemplateToolbar({
  selected,
  suggestedTemplateId,
  draftQuestion,
  onChange,
  disabled,
}: {
  selected: BriefTemplateSelection;
  suggestedTemplateId: BriefTemplateId;
  draftQuestion: string;
  onChange: (selection: BriefTemplateSelection) => void;
  disabled: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: SPACE.sm,
      marginBottom: SPACE.sm,
      minWidth: 0,
    }}>
      <BriefTemplatePicker
        selected={selected}
        suggestedTemplateId={suggestedTemplateId}
        draftQuestion={draftQuestion}
        onChange={onChange}
        disabled={disabled}
      />
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: TYPE.meta.xs,
        color: F.fgFaint,
        letterSpacing: TRACKING.micro,
        textTransform: 'uppercase',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        answer format
      </span>
    </div>
  );
}

/**
 * User's originating question rendered as a right-aligned submitted-question
 * card. Pinned just above each brief in the feed so the question→brief
 * pairing stays visually intact regardless of focus state. Same component for
 * compact and focused rows; consistency keeps the layout stable when the user
 * expands a brief (the card doesn't appear or move).
 */
function UserQuestionBubble({ brief }: { brief: Brief }) {
  const askedAt = new Date(brief.created_at).toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit',
  });
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: SPACE.md }}>
      <div style={{ maxWidth: 'min(100%, 640px)', minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgFaint,
          marginBottom: SPACE.xs, letterSpacing: TRACKING.caps, textTransform: 'uppercase',
          textAlign: 'right',
        }}>You · {askedAt}</div>
        <div style={{
          background: F.surface,
          border: `1px solid ${F.border}`,
          borderRadius: RADIUS.md,
          boxShadow: F.shadowSoft,
          padding: `${SPACE.sm}px ${SPACE.md}px`,
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.md,
          lineHeight: 1.45,
          color: F.inkSoft,
          fontWeight: 500,
          textAlign: 'left',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
        }}>
          {brief.question}
        </div>
      </div>
    </div>
  );
}
