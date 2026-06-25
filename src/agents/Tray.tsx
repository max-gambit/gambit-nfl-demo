import { useCallback, useEffect, useRef, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { HeaderBarPuck, themeForRun } from './HeaderBarPuck';
import { useBriefs, useSessions, useToasts, useTray, useUi } from '../store';
import { getArtifactUrl, runAgent } from '../api/agent';
import type { AgentRun, Artifact } from '@shared/types';

interface TrayProps {
  placement?: 'header-between';
}

const FINISH_AUTO_EXPAND_MS = 3000;

/**
 * Phase 11 — Tray now owns the per-puck action wiring (jump-to-brief, open
 * artifact, retry) and auto-expands the popover for ~3s when a run finishes
 * so the user notices completion. The puck itself stays purely presentational.
 */
export function Tray({ placement = 'header-between' }: TrayProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { trayItems } = useTray();
  const { briefs, artifactsByBrief, loadArtifacts, setActiveBrief } = useBriefs();
  const { sessions } = useSessions();
  const {
    setExpandedBrief, setRightPanelMode, setRightPanelOpen, setActiveNav,
  } = useUi();
  const { pushToast } = useToasts();

  // Track which run-ids we've already auto-expanded for so a Realtime UPDATE
  // that re-fires `just_finished=true` doesn't keep yanking focus.
  const seenFinishedRef = useRef<Set<string>>(new Set());
  const autoExpandTimerRef = useRef<number | null>(null);

  // Auto-expand the popover when a run flips to just_finished. Skip if the
  // user already has another puck expanded — don't yank focus.
  useEffect(() => {
    const justFinished = trayItems.find((r) => r.just_finished && !seenFinishedRef.current.has(r.id));
    if (!justFinished) return;
    seenFinishedRef.current.add(justFinished.id);

    setExpandedId((cur) => (cur && cur !== justFinished.id ? cur : justFinished.id));

    if (autoExpandTimerRef.current) window.clearTimeout(autoExpandTimerRef.current);
    autoExpandTimerRef.current = window.setTimeout(() => {
      setExpandedId((cur) => (cur === justFinished.id ? null : cur));
      autoExpandTimerRef.current = null;
    }, FINISH_AUTO_EXPAND_MS);
  }, [trayItems]);

  useEffect(() => () => {
    if (autoExpandTimerRef.current) window.clearTimeout(autoExpandTimerRef.current);
  }, []);

  const jumpToBrief = useCallback((run: AgentRun) => {
    if (!run.brief_id) return;
    setActiveBrief(run.brief_id);
    setExpandedBrief(run.brief_id);
    setRightPanelMode('thread');
    setRightPanelOpen(true);
    setActiveNav('analyze');
    setExpandedId(null);
  }, [setActiveBrief, setExpandedBrief, setRightPanelMode, setRightPanelOpen, setActiveNav]);

  const openArtifact = useCallback(async (artifactId: string) => {
    try {
      const { url } = await getArtifactUrl(artifactId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t open artifact',
        detail: err instanceof Error ? err.message : 'Server unreachable.',
      });
    }
  }, [pushToast]);

  const retry = useCallback(async (run: AgentRun) => {
    if (!run.brief_id) return;
    try {
      await runAgent({ brief_id: run.brief_id, kind: run.kind, config: run.config });
      pushToast({
        tone: 'info',
        message: 'Retrying agent',
        detail: 'Watch the puck — it pulses when finished.',
      });
      setExpandedId(null);
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t retry agent',
        detail: err instanceof Error ? err.message : 'Server unreachable.',
      });
    }
  }, [pushToast]);

  if (placement !== 'header-between') return null;
  if (trayItems.length === 0) return null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'row', gap: 2,
      alignItems: 'center',
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 600,
        color: F.fgFaint, letterSpacing: TRACKING.micro, textTransform: 'uppercase',
        marginRight: SPACE.sm,
      }}>Agents</span>
      {trayItems.map((run) => {
        const brief = run.brief_id ? briefs.find((b) => b.id === run.brief_id) ?? null : null;
        const session = brief?.session_id ? sessions.find((s) => s.id === brief.session_id) ?? null : null;
        const briefArtifacts: Artifact[] = run.brief_id ? (artifactsByBrief[run.brief_id] ?? []) : [];
        const artifact = briefArtifacts.find((a) => a.agent_run_id === run.id) ?? null;
        // If the run is completed but we don't yet have artifacts cached for
        // this brief, opportunistically load them so the popover unlocks
        // "Open" without the user having to navigate first.
        const shouldHydrate = run.status === 'completed' && run.brief_id && briefArtifacts.length === 0;
        const onOpenPopover = () => {
          if (shouldHydrate) void loadArtifacts(run.brief_id!);
        };
        return (
          <HeaderBarPuck
            key={run.id}
            run={run}
            theme={themeForRun(run)}
            expanded={expandedId === run.id}
            onToggle={() => {
              onOpenPopover();
              setExpandedId((cur) => (cur === run.id ? null : run.id));
            }}
            briefLabel={brief ? (brief.thesis ?? brief.question) : null}
            channelLabel={session?.label ?? null}
            artifact={artifact}
            onJumpToBrief={brief ? () => jumpToBrief(run) : null}
            onOpenArtifact={artifact ? () => void openArtifact(artifact.id) : null}
            onRetry={run.brief_id ? () => void retry(run) : null}
            onDismiss={() => setExpandedId(null)}
            radius={RADIUS.md}
          />
        );
      })}
    </div>
  );
}
