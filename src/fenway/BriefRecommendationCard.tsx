import { useCallback, useEffect, useMemo, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { OptionsTable } from './OptionsTable';
import { BriefActions } from './BriefActions';
import { RecommendationCardBody } from './RecommendationCardBody';
import { TemplateBriefBody } from './TemplateBriefBody';
import { BriefTemplatePicker } from './BriefTemplatePicker';
import { DataAnalysisCardBody } from './DataAnalysisCardBody';
import { GeneratingBriefCard } from './GeneratingBriefCard';
import { FailedBriefCard } from './FailedBriefCard';
import { ArtifactStrip } from '../agents/ArtifactStrip';
import { useBriefs, useToasts } from '../store';
import { runAgent } from '../api/agent';
import { briefProgressStreamUrl, getBrief, regenerateBrief } from '../api/briefs';
import { isCustomBaseTemplateId, templateSelectionFromBrief } from '@shared/briefTemplates';
import type { AgentKind, Brief, BriefProgressStreamEvent, BriefTemplateId, BriefTemplateSelection, DataAnalysisBriefBody, RecommendationBriefBody } from '@shared/types';

interface Props {
  brief: Brief;
  /** When true, render the OptionsTable embedded inside the card. Defaults true. */
  embedTable?: boolean;
  /** Channel-feed mode: hide OptionsTable + BriefActions row. The reasoning,
   *  working thesis, and agent dispatch buttons stay (each is already brief-scoped). */
  compact?: boolean;
  /** Phase 9 — when set, render a "Reply" button at the bottom of the card
   *  that opens the right-panel thread mode for this brief. */
  onReply?: () => void;
  /** Phase 10 — render a subtle accent ring around the card when the right
   *  panel is in thread mode for this brief. Reinforces the "this is the brief
   *  you're chatting about" coupling. */
  isInThread?: boolean;
}

/**
 * Phase 8 — the standalone recommendation card. Phase 10 — token sweep.
 * Self-contained: pulls sources/options/artifacts for `brief.id` from the
 * store, dispatches agents against `brief.id`. The parent doesn't need to
 * know about the brief's data — just hands over the row.
 */
export function BriefRecommendationCard({ brief, embedTable = true, compact = false, onReply, isInThread = false }: Props) {
  const { sourcesByBrief, artifactsByBrief, patchBrief } = useBriefs();
  const { pushToast } = useToasts();
  const [changingTemplate, setChangingTemplate] = useState(false);

  const sources = sourcesByBrief[brief.id] ?? [];
  const artifacts = artifactsByBrief[brief.id] ?? [];
  const dataAnalysisBody = isDataAnalysisBody(brief.body) ? brief.body : null;
  const recommendationBody = isRecommendationBody(brief.body) ? brief.body : null;
  const isDataAnalyst = brief.mode === 'data_analyst';
  const templateSelection = useMemo(() => templateSelectionFromBrief(brief), [brief]);
  const effectiveTemplateId = effectiveCardTemplateId(templateSelection);
  const presentationFirst = !!recommendationBody?.presentation && !isDataAnalyst && effectiveTemplateId !== 'decision_brief';
  const showEmbeddedOptions = !!recommendationBody && shouldShowOptionsTable(brief, recommendationBody, effectiveTemplateId);

  const isGenerating = brief.status === 'generating';
  const isFailed = brief.status === 'failed';

  useEffect(() => {
    if (!isGenerating) return undefined;
    if (typeof EventSource === 'undefined') return undefined;
    let cancelled = false;
    const source = new EventSource(briefProgressStreamUrl(brief.id));

    const handleProgress = (event: MessageEvent<string>) => {
      let payload: BriefProgressStreamEvent;
      try {
        payload = JSON.parse(event.data) as BriefProgressStreamEvent;
      } catch (err) {
        console.warn('[brief-card] progress stream payload parse failed', brief.id, err);
        return;
      }
      if (payload.brief_id !== brief.id || cancelled) return;

      if (payload.status === 'ready') {
        patchBrief(brief.id, {
          progress: payload.progress,
          updated_at: payload.updated_at,
        });
        void getBrief(brief.id)
          .then((fresh) => {
            if (!cancelled) patchBrief(brief.id, fresh);
          })
          .catch((err) => {
            console.warn('[brief-card] final brief refresh failed', brief.id, err);
          });
        source.close();
        return;
      }

      patchBrief(brief.id, {
        status: payload.status,
        progress: payload.progress,
        updated_at: payload.updated_at,
        error: payload.error,
      });
      if (payload.status === 'failed') source.close();
    };

    source.addEventListener('progress', handleProgress as EventListener);
    source.onerror = (err) => {
      console.warn('[brief-card] progress stream closed; polling fallback remains active', brief.id, err);
      source.close();
    };

    return () => {
      cancelled = true;
      source.removeEventListener('progress', handleProgress as EventListener);
      source.close();
    };
  }, [brief.id, isGenerating, patchBrief]);

  useEffect(() => {
    if (!isGenerating) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        const fresh = await getBrief(brief.id);
        if (cancelled) return;
        if (fresh.status !== 'generating') {
          patchBrief(brief.id, fresh);
        }
      } catch (err) {
        console.warn('[brief-card] polling failed', brief.id, err);
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, 3_000);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [brief.id, isGenerating, patchBrief]);

  const dispatchAgent = useCallback(async (kind: AgentKind, label: string) => {
    try {
      await runAgent({ brief_id: brief.id, kind, config: {}, query: '' });
      pushToast({
        tone: 'info',
        message: `${label} dispatched`,
        detail: 'Watch the puck in the header — it pulses when finished.',
      });
    } catch (err) {
      console.error('[brief-card] runAgent failed', err);
      pushToast({
        tone: 'error',
        message: 'Couldn’t start agent',
        detail: err instanceof Error ? err.message : 'Server unreachable.',
      });
    }
  }, [brief.id, pushToast]);

  const changeTemplate = useCallback(async (selection: BriefTemplateSelection) => {
    if (changingTemplate) return;
    setChangingTemplate(true);
    try {
      const fresh = await regenerateBrief(brief.id, { template: selection });
      patchBrief(brief.id, fresh);
      pushToast({
        tone: 'info',
        message: 'Regenerating with new template',
        detail: 'The same brief will refresh in place.',
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t change template',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    } finally {
      setChangingTemplate(false);
    }
  }, [brief.id, changingTemplate, patchBrief, pushToast]);

  // Generating: show the placeholder card. Realtime UPDATE flips status='ready'
  // and the next render falls through to the normal branch.
  if (isGenerating) {
    return <GeneratingBriefCard question={brief.question} startedAt={brief.updated_at} progress={brief.progress} />;
  }

  // Failed: show recovery card with original question + Regenerate.
  if (isFailed) {
    return (
      <FailedBriefCard
        briefId={brief.id}
        question={brief.question}
        errorMessage={brief.error}
      />
    );
  }

  const sourcesNote = brief.duration_ms
    ? `${sources.length || 0} sources · ${(brief.duration_ms / 1000).toFixed(1)}s`
    : `${sources.length || 0} sources`;

  // Shared button styles — Phase 10 button system anticipated. Three
  // variants: primary (filled fenway), secondary (outline), tertiary (text).
  // Sized at md (h≈28, body.sm).
  const btnPrimary: React.CSSProperties = {
    padding: `${SPACE.xs + 2}px ${SPACE.lg}px`,
    background: F.fenway, color: F.surface,
    border: 'none', borderRadius: RADIUS.md,
    fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 600,
    cursor: 'pointer', letterSpacing: TRACKING.body,
  };
  const btnSecondary: React.CSSProperties = {
    padding: `${SPACE.xs + 2}px ${SPACE.md}px`,
    background: F.surface, color: F.ink,
    border: `1px solid ${F.border}`, borderRadius: RADIUS.md,
    fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 500,
    cursor: 'pointer',
  };
  const btnTertiary: React.CSSProperties = {
    padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
    background: 'transparent', color: F.fgMuted,
    border: 'none', borderRadius: RADIUS.md,
    fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 500,
    cursor: 'pointer',
  };
  const agentActionsBlock = !isDataAnalyst ? (
    <div style={{
      display: 'flex', alignItems: 'center',
      gap: SPACE.sm, marginTop: SPACE.lg, flexWrap: 'wrap',
      paddingTop: SPACE.md, borderTop: `1px solid ${F.border}`,
    }}>
      <button onClick={() => void dispatchAgent('deck', 'Deck')}
        title="Generate an 8–10 slide deck for this working thesis"
        style={btnPrimary}>Generate deck →</button>
      <button onClick={() => void dispatchAgent('memo', 'Memo')}
        title="Draft a written memo for ownership"
        style={btnSecondary}>Draft memo</button>
      <button onClick={() => void dispatchAgent('research', 'Deep research')}
        title="Run a deep-research pass anchored to this brief"
        style={btnSecondary}>Run deeper research</button>
      <button onClick={() => void dispatchAgent('staff_protocol', 'Staff protocol')}
        title="Create a forwardable staff packet for analytics, coaching, scouting, and cap/contracts"
        style={btnSecondary}>Create staff packet</button>
      <button onClick={() => void dispatchAgent('comp_set', 'Comp set')}
        title="Build a comparable-players set for this brief"
        style={btnSecondary}>Find comps</button>
    </div>
  ) : null;
  const summaryBlock = (
    <div style={{
      marginTop: presentationFirst ? SPACE.lg : 0,
      marginBottom: SPACE.xl,
      paddingTop: presentationFirst ? SPACE.lg : 0,
      paddingBottom: SPACE.xl,
      borderTop: presentationFirst ? `1px solid ${F.border}` : 'none',
      borderBottom: `1px solid ${F.border}`,
    }}>
      <div style={{
        fontFamily: 'var(--font-sans)', fontSize: TYPE.meta.md, fontWeight: 600,
        color: F.fenway,
        letterSpacing: TRACKING.micro, textTransform: 'uppercase',
        marginBottom: SPACE.sm,
      }}>
        {isDataAnalyst ? 'Data answer' : presentationFirst ? 'Current lean' : 'Working thesis'}
      </div>
      <p style={{
        margin: 0,
        fontFamily: 'var(--font-display)',
        fontSize: presentationFirst ? TYPE.display.md : TYPE.display.lg,
        lineHeight: presentationFirst ? 1.45 : 1.35,
        color: F.ink,
        fontWeight: 600,
        letterSpacing: TRACKING.tight,
      }}>
        {dataAnalysisBody?.answer ?? brief.thesis ?? brief.question}
      </p>
    </div>
  );

  return (
    <div data-recommendation-card="true" style={{
        background: F.surface,
        border: `1px solid ${isInThread ? F.fenway : F.border}`,
        borderRadius: RADIUS.lg,
        padding: `${SPACE.xl}px ${SPACE['2xl']}px`,
        marginBottom: SPACE.xl,
        boxShadow: isInThread
          ? `0 0 0 1px ${F.fenway}, ${F.shadowChat}`
          : F.shadowChat,
        scrollMarginTop: SPACE.md,
        transition: 'border-color 0.12s ease, box-shadow 0.12s ease',
        minWidth: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginBottom: SPACE.md }}>
          <div style={{
            width: 28, height: 28, background: F.ink, color: F.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontSize: TYPE.body.md, fontWeight: 700,
            borderRadius: RADIUS.pill,
          }}>G</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md, fontWeight: 500, color: F.ink }}>
              {isDataAnalyst ? 'Gambit Data Analyst' : 'Gambit Analyst'}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.fgMuted, marginTop: 1 }}>{sourcesNote}</div>
          </div>
          <BriefTemplatePicker
            selected={templateSelection}
            onChange={(selection) => void changeTemplate(selection)}
            draftQuestion={brief.question}
            disabled={changingTemplate}
            align="right"
            placement="below"
          />
        </div>

        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.lg,
          color: F.inkSoft,
          lineHeight: 1.65,
          minWidth: 0,
          maxWidth: '100%',
        }}>
          {presentationFirst && recommendationBody && <TemplateBriefBody body={recommendationBody} />}

          {summaryBlock}

          {dataAnalysisBody
            ? <DataAnalysisCardBody body={dataAnalysisBody} />
            : recommendationBody && !presentationFirst && (
              recommendationBody.presentation
                ? <TemplateBriefBody body={recommendationBody} />
                : <RecommendationCardBody body={recommendationBody} />
            )}

          {embedTable && !compact && !isDataAnalyst && showEmbeddedOptions && (
            <div style={{
              marginTop: SPACE.xl,
              marginLeft: -SPACE['2xl'], marginRight: -SPACE['2xl'],
            }}>
              <OptionsTable embedded />
            </div>
          )}
        </div>

        {sources.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: SPACE.sm,
            marginTop: SPACE.md, flexWrap: 'wrap',
            paddingTop: SPACE.md, borderTop: `1px solid ${F.border}`,
          }}>
            {sources.slice(0, 3).map((s) => (
              <span key={s.id} style={{
                fontSize: TYPE.meta.md, color: F.inkSoft, fontFamily: 'var(--font-sans)', fontWeight: 500,
                padding: `${SPACE.xs - 1}px ${SPACE.sm}px`,
                background: F.cream50, borderRadius: RADIUS.pill, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: SPACE.xs + 1,
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm,
                  color: F.accent, fontWeight: 600,
                }}>{s.ref_index}</span>
                {sourceChipLabel(s)}
              </span>
            ))}
            <div style={{ flex: 1 }} />
            {sources.length > 3 && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
                letterSpacing: TRACKING.caps,
              }}>+{sources.length - 3} more</span>
            )}
          </div>
        )}

        {artifacts.length > 0 && <ArtifactStrip artifacts={artifacts} />}

        {agentActionsBlock}

        {!compact && <BriefActions />}

        {onReply && (
          <div style={{
            marginTop: SPACE.md, paddingTop: SPACE.md,
            borderTop: `1px dashed ${F.border}`,
            display: 'flex', alignItems: 'center', gap: SPACE.md,
          }}>
            <button onClick={onReply}
              title="Open the thread for this brief"
              style={{
                ...btnPrimary,
                background: F.fenwaySoft, color: F.fenway,
                border: `1px solid ${F.fenway}`,
                display: 'flex', alignItems: 'center', gap: SPACE.xs + 2,
              }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              Reply in thread
            </button>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgFaint,
              letterSpacing: TRACKING.caps,
            }}>opens thread on the right</span>
          </div>
        )}
    </div>
  );
}

function sourceChipLabel(source: { kind: string; source: string | null; title: string }): string {
  if (source.kind === 'ANALYST_DATA') {
    return source.title.replace(/^App data ·\s*/, '');
  }
  if (source.kind === 'CONTEXT_GRAPH') {
    const teamMatch = source.title.match(/·\s*([A-Z]{3})\s*·/);
    return teamMatch ? `Intel · ${teamMatch[1]}` : 'Intel';
  }
  return source.source ?? source.title;
}

function effectiveCardTemplateId(selection: BriefTemplateSelection): BriefTemplateId {
  if (selection.template_id !== 'custom') return selection.template_id;
  return isCustomBaseTemplateId(selection.base_template_id) ? selection.base_template_id : 'custom';
}

function shouldShowOptionsTable(
  brief: Brief,
  body: RecommendationBriefBody,
  effectiveTemplateId: BriefTemplateId,
): boolean {
  if ((brief.template_id ?? 'decision_brief') === 'decision_brief' || effectiveTemplateId === 'decision_brief') {
    return true;
  }
  if (body.presentation) return false;
  return effectiveTemplateId === 'comparison_matrix' || effectiveTemplateId === 'options_table';
}

function isDataAnalysisBody(body: Brief['body']): body is DataAnalysisBriefBody {
  return body?.kind === 'data_analysis';
}

function isRecommendationBody(body: Brief['body']): body is RecommendationBriefBody {
  return !!body && body.kind !== 'data_analysis' && typeof (body as { reasoning?: unknown }).reasoning === 'string';
}
