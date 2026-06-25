import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { Brief, ContextGraphOnboardingViewModel, ContextGraphWarRoomResponse, Session } from '@shared/types';
import { createBrief } from '../api/briefs';
import { getContextGraphWarRoom } from '../api/contextGraph';
import { createSession } from '../api/sessions';
import { useBriefs, useSessions, useToasts, useUi } from '../store';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import {
  CONTEXT_GRAPH_ONBOARDING_TEAM_ID,
  contextGraphOnboardingLaunchBriefKey,
  contextGraphOnboardingLaunchDismissedKey,
  contextGraphOnboardingLaunchSessionKey,
} from './config';

export const WIZARDS_ONBOARDING_LAUNCH_BRIEF_KEY = contextGraphOnboardingLaunchBriefKey();
export const WIZARDS_ONBOARDING_LAUNCH_SESSION_KEY = contextGraphOnboardingLaunchSessionKey();
export const WIZARDS_ONBOARDING_LAUNCH_DISMISSED_KEY = contextGraphOnboardingLaunchDismissedKey();

interface PostOnboardingLaunchProps {
  onboarding: ContextGraphOnboardingViewModel;
  onDone: () => void;
}

interface PromptCard {
  title: string;
  body: string;
  prompt: string;
}

export function PostOnboardingLaunch({ onboarding, onDone }: PostOnboardingLaunchProps) {
  const [launchBriefId, setLaunchBriefId] = useState<string | null>(() => window.localStorage.getItem(WIZARDS_ONBOARDING_LAUNCH_BRIEF_KEY));
  const [launchSessionId, setLaunchSessionId] = useState<string | null>(() => window.localStorage.getItem(WIZARDS_ONBOARDING_LAUNCH_SESSION_KEY));
  const [warRoom, setWarRoom] = useState<ContextGraphWarRoomResponse | null>(null);
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>(() => launchBriefId ? 'ready' : 'starting');
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const { insertSession, setActiveSession } = useSessions();
  const { insertBrief, setActiveBrief } = useBriefs();
  const { setActiveNav, setExpandedBrief, setRightPanelMode, setRightPanelOpen } = useUi();
  const { pushToast } = useToasts();
  const teamName = onboarding.team_name;
  const principal = principalForTeam(onboarding.team_id, teamName);

  useEffect(() => {
    getContextGraphWarRoom(onboarding.team_id || CONTEXT_GRAPH_ONBOARDING_TEAM_ID)
      .then(setWarRoom)
      .catch(() => setWarRoom(null));
  }, [onboarding.team_id]);

  useEffect(() => {
    if (startedRef.current || launchBriefId) return;
    startedRef.current = true;
    void startBoardBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchBriefId]);

  const promptCards = useMemo(() => buildPromptCards(onboarding, warRoom, principal), [onboarding, principal, warRoom]);
  const topPriority = firstRankedPriority(onboarding);

  const focusBrief = (briefId: string, nav: 'analyze' | 'war_room') => {
    if (launchSessionId) setActiveSession(launchSessionId);
    setActiveBrief(briefId);
    setExpandedBrief(briefId);
    setRightPanelMode('thread');
    setRightPanelOpen(true);
    setActiveNav(nav);
    window.localStorage.setItem(WIZARDS_ONBOARDING_LAUNCH_DISMISSED_KEY, 'true');
    onDone();
  };

  const openWarRoom = () => {
    window.localStorage.setItem(WIZARDS_ONBOARDING_LAUNCH_DISMISSED_KEY, 'true');
    setActiveNav('war_room');
    onDone();
  };

  async function ensureLaunchSession(): Promise<string> {
    if (launchSessionId) return launchSessionId;
    const session = await createSession(`${teamName} Onboarding Board Brief`);
    rememberSession(session);
    return session.id;
  }

  function rememberSession(session: Session): void {
    insertSession(session);
    setActiveSession(session.id);
    setLaunchSessionId(session.id);
    window.localStorage.setItem(WIZARDS_ONBOARDING_LAUNCH_SESSION_KEY, session.id);
  }

  function rememberBrief(brief: Brief): void {
    insertBrief(brief);
    setActiveBrief(brief.id);
    setExpandedBrief(brief.id);
    setRightPanelMode('thread');
    setRightPanelOpen(true);
  }

  async function createBriefInLaunchSession(prompt: string): Promise<Brief> {
    const sessionId = await ensureLaunchSession();
    try {
      return await createBrief({ session_id: sessionId, question: prompt, mode: 'brief' });
    } catch (err) {
      if (!launchSessionId) throw err;
      const replacement = await createSession(`${teamName} Onboarding Board Brief`);
      rememberSession(replacement);
      return createBrief({ session_id: replacement.id, question: prompt, mode: 'brief' });
    }
  }

  async function startBoardBrief(): Promise<void> {
    setStatus('starting');
    setError(null);
    try {
      const brief = await createBriefInLaunchSession(buildBoardBriefPrompt(onboarding, principal));
      rememberBrief(brief);
      setLaunchBriefId(brief.id);
      window.localStorage.setItem(WIZARDS_ONBOARDING_LAUNCH_BRIEF_KEY, brief.id);
      setStatus('ready');
      pushToast({
        tone: 'success',
        message: 'Board brief started',
        detail: `The first onboarding-aware ${teamName} brief is generating.`,
      });
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not start the board brief.');
    }
  }

  async function startFollowup(card: PromptCard): Promise<void> {
    setStatus('starting');
    setError(null);
    try {
      const brief = await createBriefInLaunchSession(card.prompt);
      rememberBrief(brief);
      window.localStorage.setItem(WIZARDS_ONBOARDING_LAUNCH_DISMISSED_KEY, 'true');
      setActiveNav('analyze');
      onDone();
    } catch (err) {
      setStatus(launchBriefId ? 'ready' : 'error');
      setError(err instanceof Error ? err.message : 'Could not start that follow-up brief.');
    }
  }

  return (
    <div style={shellStyle}>
      <main style={cardStyle}>
        <div style={eyebrowStyle}>{teamName} onboarding</div>
        <h1 style={titleStyle}>Intel is live</h1>
        <p style={ledeStyle}>
          Gambit has enough {teamName}-specific context to produce the first board brief. The brief is starting automatically; the prompts below are ready for the next move.
        </p>

        <section style={statusCardStyle(status)}>
          <div>
            <div style={statusLabelStyle}>{status === 'ready' ? 'Brief queued' : status === 'error' ? 'Needs attention' : 'Generating'}</div>
            <h2 style={statusTitleStyle}>
              {status === 'ready' ? `Your first ${teamName} board brief is ready to open` : `Generating your first ${teamName} board brief`}
            </h2>
            <p style={statusBodyStyle}>
              Recommended posture, top decisions, first calls, caveats, and source separation from onboarding context.
            </p>
            {error && <p style={errorStyle}>{error}</p>}
          </div>
          <div style={actionsStyle}>
            <button
              type="button"
              disabled={!launchBriefId}
              onClick={() => launchBriefId && focusBrief(launchBriefId, 'analyze')}
              style={primaryButtonStyle(Boolean(launchBriefId))}
            >
              Open board brief
            </button>
            {status === 'error' && (
              <button type="button" onClick={() => void startBoardBrief()} style={secondaryButtonStyle}>Retry</button>
            )}
            <button type="button" onClick={openWarRoom} style={secondaryButtonStyle}>Go to War Room</button>
          </div>
        </section>

        <section style={summaryGridStyle}>
          <SummaryCard label="Role" value={labelFromId(onboarding.profile.identity.role) || 'Not set'} detail={labelFromId(onboarding.profile.identity.decision_authority)} />
          <SummaryCard
            label="Team snapshot"
            value={labelFromId(onboarding.profile.team_snapshot.lifecycle) || 'Not set'}
            detail={[
              onboarding.profile.team_snapshot.secondary_lifecycles.map(labelFromId).join(' + '),
              onboarding.profile.team_snapshot.cornerstones.join(', ') || 'No cornerstones',
            ].filter(Boolean).join(' · ')}
          />
          <SummaryCard label="Top priority" value={topPriority?.label ?? 'Not ranked'} detail={topPriority?.detail ?? 'Prompt menu remains available.'} />
          <SummaryCard label="Cap context" value={onboarding.inferred_cap_context.current_status_label || 'Unknown'} detail={formatMoney(onboarding.inferred_cap_context.current_payroll_estimate)} />
        </section>

        <section style={promptSectionStyle}>
          <div>
            <div style={eyebrowStyle}>Next prompts</div>
            <h2 style={sectionTitleStyle}>Steer the next answer</h2>
          </div>
          <div style={promptGridStyle}>
            {promptCards.map((card) => (
              <button key={card.title} type="button" onClick={() => void startFollowup(card)} style={promptCardStyle}>
                <span style={promptTitleStyle}>{card.title}</span>
                <span style={promptBodyStyle}>{card.body}</span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article style={summaryCardStyle}>
      <div style={summaryLabelStyle}>{label}</div>
      <h3 style={summaryValueStyle}>{value}</h3>
      <p style={summaryDetailStyle}>{detail || 'No detail captured.'}</p>
    </article>
  );
}

function buildBoardBriefPrompt(onboarding: ContextGraphOnboardingViewModel, principal: string): string {
  const profile = onboarding.profile;
  const teamName = onboarding.team_name;
  const priorities = profile.strategic_priorities.ranked_priorities
    .map((id) => onboarding.generated_priority_options.find((option) => option.id === id)?.label ?? id)
    .join('; ');
  const secondaryLifecycle = profile.team_snapshot.secondary_lifecycles.map(labelFromId).join(' + ') || 'none captured';
  return [
    `Build a ${teamName} board brief for ${principal} using the completed Intel onboarding profile, current public roster/cap/stat data, and the ${teamName} Intel layer.`,
    `Captured role: ${labelFromId(profile.identity.role)}; authority: ${labelFromId(profile.identity.decision_authority)}.`,
    `Captured team context: primary lifecycle ${labelFromId(profile.team_snapshot.lifecycle)}; secondary lifecycle tags ${secondaryLifecycle}; cornerstones ${profile.team_snapshot.cornerstones.join(', ') || 'not specified'}; inferred cap context ${onboarding.inferred_cap_context.current_status_label || 'unknown'}.`,
    `Captured trust boundaries: off-limits people ${profile.data_trust.off_limits_people || 'none specified'}; off-limits topics ${profile.data_trust.off_limits_topics || 'none specified'}.`,
    `Captured 90-day decision: ${profile.strategic_priorities.ninety_day_decision || 'not specified'}. Ranked priorities: ${priorities || 'not ranked'}.`,
    'Return the recommended posture, top decisions, first calls/counterparties, caveats, and what would change the answer.',
    'Explicitly label onboarding context separately from public roster/cap/stat/Intel evidence, and do not treat onboarding preferences as public fact.',
  ].join('\n');
}

function principalForTeam(teamId: string, teamName: string): string {
  if (teamId === 'GSW') return 'Mike Dunleavy Jr.';
  if (teamId === 'WAS') return 'Michael Winger';
  return `${teamName} front office`;
}

function buildPromptCards(
  onboarding: ContextGraphOnboardingViewModel,
  warRoom: ContextGraphWarRoomResponse | null,
  principal: string,
): PromptCard[] {
  const priority = firstRankedPriority(onboarding);
  const counterpartyPrompt = warRoom?.demo_prompts.find((prompt) => prompt.title.toLowerCase().includes('counterparty'));
  const changedPrompt = warRoom?.demo_prompts.find((prompt) => prompt.title.toLowerCase().includes('override'));
  const teamName = onboarding.team_name;

  return [
    {
      title: 'Pressure-test the top priority',
      body: priority ? `What would make "${priority.label}" wrong?` : 'Stress-test the captured priority vector.',
      prompt: priority
        ? `Using the ${teamName} onboarding profile and current evidence, pressure-test this top priority: ${priority.label}. What would make it wrong, what evidence should ${principal} monitor, and what is the clean alternative?`
        : `Using the ${teamName} onboarding profile and current evidence, pressure-test the captured priority vector. What would make it wrong, what evidence should ${principal} monitor, and what is the clean alternative?`,
    },
    {
      title: 'Build the first-call sheet',
      body: 'Turn the posture into specific counterparty conversations.',
      prompt: counterpartyPrompt?.prompt
        ?? `Using the ${teamName} Intel onboarding profile and relationship map, build the first-call sheet for this week. Identify the first three counterparties, the question for each call, and the evidence behind the order.`,
    },
    {
      title: 'Show what onboarding changed',
      body: 'Separate user-provided context from public evidence.',
      prompt: changedPrompt?.prompt
        ?? `Use the ${teamName} Intel. Show exactly what changed because of onboarding context, what stayed grounded in public roster/cap/stat evidence, and what caveats should be shown to ${principal}.`,
    },
  ];
}

function firstRankedPriority(onboarding: ContextGraphOnboardingViewModel) {
  const firstId = onboarding.profile.strategic_priorities.ranked_priorities[0];
  return onboarding.generated_priority_options.find((option) => option.id === firstId) ?? null;
}

function labelFromId(id: string): string {
  const labels: Record<string, string> = {
    president: 'President of Basketball Ops',
    gm: 'GM',
    assistant_gm: 'Assistant GM',
    player_personnel: 'VP / Director of Player Personnel',
    capologist: 'Capologist / Salary Cap Analyst',
    analytics: 'Director of Analytics',
    strategy: 'Director of Strategy',
    pro_scouting: 'Pro Scouting',
    amateur_scouting: 'Amateur Scouting',
    coaching_staff: 'Coaching staff',
    owner_governor: 'Owner / Governor',
    sign_off: 'Sign off',
    heavily_influence: 'Heavily influence',
    provide_input: 'Provide input / inform',
    aware: 'Just need to be aware',
    title_contender: 'Title contender',
    playoff_hopeful: 'Playoff hopeful',
    retooling: 'Re-tooling',
    rebuilding: 'Rebuilding',
    tanking: 'Tanking / asset accumulation',
    complicated: "It's complicated",
  };
  if (labels[id]) return labels[id];
  return id.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()).trim();
}

function formatMoney(value: number | null): string {
  if (!value) return 'Payroll unavailable';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: F.paper,
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  padding: SPACE['2xl'],
};

const cardStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.lg,
  background: 'rgba(255,255,255,0.86)',
  boxShadow: F.shadow,
  padding: SPACE['2xl'],
  display: 'grid',
  gap: SPACE.xl,
};

const eyebrowStyle: React.CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 800,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 38,
  fontWeight: 500,
  lineHeight: 1.08,
};

const ledeStyle: React.CSSProperties = {
  margin: 0,
  maxWidth: 760,
  color: F.inkSoft,
  fontSize: TYPE.body.md,
  lineHeight: 1.5,
};

function statusCardStyle(status: 'starting' | 'ready' | 'error'): React.CSSProperties {
  return {
    border: `1px solid ${status === 'error' ? F.red : status === 'ready' ? F.fenway : F.borderStrong}`,
    borderRadius: RADIUS.md,
    background: status === 'ready' ? F.fenwaySoft : F.surface,
    padding: SPACE.lg,
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: SPACE.lg,
    alignItems: 'center',
  };
}

const statusLabelStyle: React.CSSProperties = {
  ...eyebrowStyle,
  marginBottom: SPACE.xs,
};

const statusTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: TYPE.display.sm,
  fontWeight: 850,
};

const statusBodyStyle: React.CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  color: F.fg,
  fontSize: TYPE.body.sm,
  lineHeight: 1.45,
};

const errorStyle: React.CSSProperties = {
  margin: `${SPACE.sm}px 0 0`,
  color: F.red,
  fontSize: TYPE.body.sm,
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: SPACE.sm,
};

function primaryButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    border: `1px solid ${enabled ? F.fenway : F.border}`,
    borderRadius: RADIUS.pill,
    background: enabled ? F.fenway : F.cream50,
    color: enabled ? F.surface : F.fgMuted,
    cursor: enabled ? 'pointer' : 'not-allowed',
    padding: `${SPACE.sm}px ${SPACE.lg}px`,
    fontWeight: 850,
    fontFamily: 'var(--font-sans)',
  };
}

const secondaryButtonStyle: React.CSSProperties = {
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.pill,
  background: F.surface,
  color: F.ink,
  cursor: 'pointer',
  padding: `${SPACE.sm}px ${SPACE.lg}px`,
  fontWeight: 800,
  fontFamily: 'var(--font-sans)',
};

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: SPACE.md,
};

const summaryCardStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  padding: SPACE.md,
};

const summaryLabelStyle: React.CSSProperties = {
  ...eyebrowStyle,
  fontSize: TYPE.meta.xs,
};

const summaryValueStyle: React.CSSProperties = {
  margin: `${SPACE.xs}px 0`,
  color: F.ink,
  fontSize: TYPE.body.md,
  fontWeight: 850,
};

const summaryDetailStyle: React.CSSProperties = {
  margin: 0,
  color: F.fgMuted,
  fontSize: TYPE.body.sm,
  lineHeight: 1.4,
};

const promptSectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.md,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  fontSize: TYPE.display.sm,
  fontWeight: 850,
};

const promptGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: SPACE.md,
};

const promptCardStyle: React.CSSProperties = {
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  boxShadow: F.shadowSoft,
  color: F.ink,
  cursor: 'pointer',
  display: 'grid',
  gap: SPACE.sm,
  padding: SPACE.lg,
  textAlign: 'left',
  fontFamily: 'var(--font-sans)',
};

const promptTitleStyle: React.CSSProperties = {
  fontSize: TYPE.body.md,
  fontWeight: 850,
};

const promptBodyStyle: React.CSSProperties = {
  color: F.fgMuted,
  fontSize: TYPE.body.sm,
  lineHeight: 1.45,
};
