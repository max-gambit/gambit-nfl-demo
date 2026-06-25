import { useEffect, useState, type CSSProperties } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import type { AgentRun, AgentStatus, Artifact } from '@shared/types';

export interface PuckTheme {
  fill: string;
  glyphFill: string;
  shape: 'triangle' | 'square' | 'circle';
}

const THEME_BY_STATUS: Record<AgentStatus, PuckTheme> = {
  queued: { fill: F.fgFaint, glyphFill: '#FFFFFF', shape: 'triangle' },
  running: { fill: F.fenway, glyphFill: '#FFFFFF', shape: 'triangle' },
  needs_input: { fill: '#1F2937', glyphFill: '#FFFFFF', shape: 'square' },
  completed: { fill: '#3F6B4A', glyphFill: '#FFFFFF', shape: 'circle' },
  failed: { fill: '#D14545', glyphFill: '#FFFFFF', shape: 'square' },
};

export function themeForRun(run: AgentRun): PuckTheme {
  return THEME_BY_STATUS[run.status] ?? THEME_BY_STATUS.completed;
}

interface Props {
  run: AgentRun;
  theme: PuckTheme;
  expanded?: boolean;
  onToggle?: () => void;
  briefLabel?: string | null;
  channelLabel?: string | null;
  artifact?: Artifact | null;
  /** When non-null, popover renders a "Jump to brief" button. */
  onJumpToBrief?: (() => void) | null;
  /** When non-null, popover renders the primary "Open <artifact>" button. */
  onOpenArtifact?: (() => void) | null;
  /** When non-null, popover renders a "Retry" button (only shown for failed). */
  onRetry?: (() => void) | null;
  /** Called when the user closes the popover via the close button. */
  onDismiss?: () => void;
  radius?: number;
}

const KIND_LABEL: Record<string, string> = {
  deck: 'Deck',
  memo: 'Memo',
  research: 'Research',
  comp_set: 'Comp set',
  synthesize: 'Synthesize',
  change_my_mind: 'Counter-case',
  staff_protocol: 'Staff protocol',
};

function summaryText(run: AgentRun): string | null {
  const r = run.result;
  if (!r || typeof r !== 'object') return null;
  const s = (r as Record<string, unknown>).summary;
  return typeof s === 'string' && s.trim().length > 0 ? s : null;
}

export function HeaderBarPuck({
  run, theme, expanded = false, onToggle,
  briefLabel = null, channelLabel = null, artifact = null,
  onJumpToBrief = null, onOpenArtifact = null, onRetry = null, onDismiss,
  radius = RADIUS.md,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const [pulsing, setPulsing] = useState(!!run.just_finished);

  useEffect(() => {
    if (!run.just_finished) {
      setPulsing(false);
      return;
    }
    setPulsing(true);
    const t = setTimeout(() => setPulsing(false), 650);
    return () => clearTimeout(t);
  }, [run.just_finished]);

  const isRunning = run.status === 'running' || run.status === 'queued';
  const isCompleted = run.status === 'completed';
  const needsInput = run.status === 'needs_input';
  const isFailed = run.status === 'failed';

  const dotColor =
    isFailed ? '#D14545'
    : isRunning ? '#3F6B4A'
    : needsInput ? '#D14545'
    : isCompleted ? '#3F6B4A'
    : F.fgFaint;
  const stateLabel =
    isFailed ? 'Failed'
    : run.status === 'running' ? 'Running'
    : isCompleted ? 'Done'
    : needsInput ? 'Needs input'
    : 'Queued';
  const stateColor =
    isFailed ? '#D14545'
    : isRunning ? '#3F6B4A'
    : needsInput ? '#8A5710'
    : F.fgMuted;

  // Hover-only previews collapse to a tight 220px chip; clicked/expanded
  // popovers grow to 280px so the action row breathes.
  const showCard = hovered || expanded;
  const interactive = expanded;

  const glyph = (
    <svg width="11" height="11" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
      {theme.shape === 'triangle' && <polygon points="12,5 21,20 3,20" fill={F.inkSoft} />}
      {theme.shape === 'square' && <rect x="4" y="5" width="16" height="15" rx="1.5" fill={F.inkSoft} />}
      {theme.shape === 'circle' && <circle cx="12" cy="12" r="9" fill={F.inkSoft} />}
    </svg>
  );

  const kindLabel = KIND_LABEL[run.kind] ?? run.kind;
  const summary = summaryText(run);
  const showOpen = isCompleted && !!onOpenArtifact && !!artifact;
  const showRetry = isFailed && !!onRetry;
  const showJump = !!onJumpToBrief && !!run.brief_id;

  // Disabled "Open" button when run is completed but the artifact row hasn't
  // synced yet; the Tray opportunistically loads on toggle.
  const openDisabled = isCompleted && !artifact;

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const btnPrimary: CSSProperties = {
    padding: `${SPACE.xs + 1}px ${SPACE.md}px`, height: 28,
    background: F.fenway, color: '#FFFFFF',
    border: `1px solid ${F.fenway}`, borderRadius: radius,
    fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 600,
    cursor: 'pointer', whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', gap: SPACE.xs,
  };
  const btnSecondary: CSSProperties = {
    padding: `${SPACE.xs + 1}px ${SPACE.md}px`, height: 28,
    background: F.surface, color: F.ink,
    border: `1px solid ${F.border}`, borderRadius: radius,
    fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 500,
    cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const btnDisabled: CSSProperties = {
    ...btnPrimary,
    background: F.cream100, color: F.fgMuted,
    border: `1px solid ${F.border}`,
    cursor: 'default',
  };

  return (
    <div style={{ position: 'relative' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <button
        onClick={onToggle}
        aria-label={`${run.title} — ${stateLabel}`}
        style={{
          width: 26, height: 26, borderRadius: radius,
          background: hovered ? F.cream100 : 'transparent',
          border: 'none', padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
          transition: 'background 120ms ease',
          animation: pulsing ? 'finish-pulse 600ms ease-out 1' : 'none',
        }}>
        {glyph}
        <span style={{
          position: 'absolute', top: 4, right: 4,
          width: needsInput ? 7 : 6, height: needsInput ? 7 : 6,
          borderRadius: 999,
          background: dotColor,
          border: `1.5px solid ${F.cream50}`,
          animation: isRunning || needsInput ? 'dot-pulse 1.6s ease-in-out infinite' : 'none',
        }} />
      </button>

      {showCard && (
        <div
          onClick={stop}
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: -4,
            background: F.surface,
            border: `1px solid ${F.borderStrong}`,
            borderRadius: radius,
            padding: interactive ? `${SPACE.md - 2}px ${SPACE.md}px ${SPACE.md}px` : `${SPACE.xs + 2}px ${SPACE.sm + 2}px`,
            width: interactive ? 300 : 220,
            boxShadow: F.shadowPop,
            display: 'flex', flexDirection: 'column', gap: interactive ? SPACE.sm : SPACE.xs - 1,
            pointerEvents: interactive ? 'auto' : 'none',
            zIndex: 20,
          }}>
          {/* Header row: state pill + kind + brief context (if available) + close */}
          <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.xs + 2 }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999, background: dotColor,
              flexShrink: 0,
              animation: isRunning ? 'dot-pulse 1.6s ease-in-out infinite' : 'none',
            }} />
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 600,
              color: stateColor, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
            }}>{kindLabel} · {stateLabel}</span>
            {isRunning && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
                fontVariantNumeric: 'tabular-nums', marginLeft: 'auto',
              }}>{run.progress}%</span>
            )}
            {interactive && !isRunning && (
              <button
                onClick={(e) => { stop(e); onDismiss?.(); }}
                aria-label="Close"
                title="Close"
                style={{
                  marginLeft: 'auto', width: 20, height: 20,
                  background: 'transparent', border: 'none', borderRadius: RADIUS.sm,
                  color: F.fgMuted, cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = F.cream100; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                  <path d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            )}
          </div>

          {/* Title */}
          <div style={{
            fontFamily: 'var(--font-sans)', fontSize: TYPE.body.md, color: F.ink, fontWeight: 500,
            lineHeight: 1.3,
          }}>{run.title}</div>

          {/* Brief / channel context — only when expanded */}
          {interactive && (briefLabel || channelLabel) && (
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
              letterSpacing: TRACKING.caps,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {channelLabel ? <>from <span style={{ color: F.fenway, fontWeight: 600 }}>#{channelLabel}</span></> : null}
              {channelLabel && briefLabel ? ' · ' : ''}
              {briefLabel ? <span style={{ color: F.ink }}>{truncate(briefLabel, 38)}</span> : null}
            </div>
          )}

          {/* Body — status-specific */}
          {interactive && isRunning && (
            <ProgressBar pct={run.progress} />
          )}
          {interactive && isCompleted && summary && (
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.inkSoft,
              lineHeight: 1.45,
              display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>{summary}</div>
          )}
          {interactive && isFailed && run.error && (
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: '#D14545',
              lineHeight: 1.45,
              background: '#FBEFEF', border: `1px solid #F4D6D6`,
              borderRadius: RADIUS.sm, padding: `${SPACE.xs}px ${SPACE.sm}px`,
            }}>{run.error}</div>
          )}
          {/* Sub copy — visible in compact + expanded states when no body content stole the slot */}
          {!interactive && run.sub && (
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.fgMuted,
              lineHeight: 1.4,
            }}>{run.sub}</div>
          )}
          {interactive && !isFailed && !isCompleted && run.sub && (
            <div style={{
              fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.fgMuted,
              lineHeight: 1.4,
            }}>{run.sub}</div>
          )}

          {/* Action row — only in expanded state */}
          {interactive && (showOpen || showRetry || showJump || openDisabled) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: SPACE.sm,
              marginTop: SPACE.xs, flexWrap: 'wrap',
            }}>
              {showOpen && artifact && (
                <button onClick={(e) => { stop(e); onOpenArtifact!(); }} style={btnPrimary}>
                  Open {artifactLabel(artifact)}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                </button>
              )}
              {openDisabled && (
                <button disabled style={btnDisabled} title="Artifact still syncing — try again in a moment.">
                  Open · syncing…
                </button>
              )}
              {showRetry && (
                <button onClick={(e) => { stop(e); onRetry!(); }} style={btnPrimary}>
                  Retry
                </button>
              )}
              {showJump && (
                <button onClick={(e) => { stop(e); onJumpToBrief!(); }} style={btnSecondary}>
                  Jump to brief
                </button>
              )}
              {!showJump && run.brief_id === null && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgFaint,
                  letterSpacing: TRACKING.caps,
                }}>brief unavailable</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const safe = Math.max(0, Math.min(100, pct));
  return (
    <div style={{
      width: '100%', height: 4, borderRadius: 2,
      background: F.cream100, overflow: 'hidden',
    }}>
      <div style={{
        width: `${safe}%`, height: '100%',
        background: F.fenway,
        transition: 'width 240ms ease-out',
      }} />
    </div>
  );
}

function artifactLabel(a: Artifact): string {
  // Prefer a clean kind label over the raw filename when it's available; the
  // primary button stays short ("Open deck →") instead of leaking a UUID-y name.
  const kind = (a.kind ?? '').toLowerCase();
  if (kind === 'deck') return 'deck';
  if (kind === 'doc') return 'memo';
  if (kind === 'data') return 'data';
  return truncate(a.name, 24);
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
