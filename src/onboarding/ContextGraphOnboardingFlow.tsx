import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import type {
  ContextGraphOnboardingProfile,
  ContextGraphOnboardingSectionId,
  ContextGraphOnboardingStakeholder,
  ContextGraphOnboardingViewModel,
  PatchContextGraphOnboardingRequest,
} from '@shared/types';
import {
  completeContextGraphOnboarding,
  getContextGraphOnboarding,
  patchContextGraphOnboarding,
} from '../api/contextGraph';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { CONTEXT_GRAPH_ONBOARDING_TEAM_ID, contextGraphOnboardingLocalKey } from './config';

export const WIZARDS_ONBOARDING_LOCAL_KEY = contextGraphOnboardingLocalKey();
const SECTION_ORDER: ContextGraphOnboardingSectionId[] = [
  'identity_role',
  'team_snapshot',
  'strategic_priorities',
  'working_style',
  'stakeholders_rituals',
  'data_trust',
];

const ROLE_OPTIONS = [
  ['president', 'President of Basketball Ops'],
  ['gm', 'GM'],
  ['assistant_gm', 'Assistant GM'],
  ['player_personnel', 'VP / Director of Player Personnel'],
  ['capologist', 'Capologist / Salary Cap Analyst'],
  ['analytics', 'Director of Analytics'],
  ['strategy', 'Director of Strategy'],
  ['pro_scouting', 'Pro Scouting'],
  ['amateur_scouting', 'Amateur Scouting'],
  ['coaching_staff', 'Coaching staff'],
  ['owner_governor', 'Owner / Governor'],
  ['other', 'Other'],
];
const YEARS_OPTIONS = [
  ['lt_1', '< 1'],
  ['1_3', '1-3'],
  ['3_7', '3-7'],
  ['7_plus', '7+'],
];
const AUTHORITY_OPTIONS = [
  ['sign_off', 'Sign off'],
  ['heavily_influence', 'Heavily influence'],
  ['provide_input', 'Provide input / inform'],
  ['aware', 'Just need to be aware'],
];
const LIFECYCLE_OPTIONS = [
  ['title_contender', 'Title contender'],
  ['playoff_hopeful', 'Playoff hopeful'],
  ['retooling', 'Re-tooling'],
  ['rebuilding', 'Rebuilding'],
  ['tanking_asset_accumulation', 'Tanking / asset accumulation'],
  ['complicated', "It's complicated"],
];
const CORNERSTONE_SUGGESTIONS_BY_TEAM: Record<string, string[]> = {
  ATL: ['Dyson Daniels', 'Jalen Johnson', 'Zaccharie Risacher', 'Onyeka Okongwu', 'Kristaps Porzingis', 'Asa Newell'],
  CHA: ['LaMelo Ball', 'Brandon Miller', 'Kon Knueppel', 'Tidjane Salaun', 'Liam McNeeley', 'Coby White'],
  GSW: ['Stephen Curry', 'Jimmy Butler', 'Draymond Green', 'Brandin Podziemski', 'Jonathan Kuminga', 'Moses Moody'],
  WAS: ['Alex Sarr', 'Bilal Coulibaly', 'Bub Carrington', 'Kyshawn George', 'Anthony Davis', 'Trae Young'],
};
const SCENARIO_OPTIONS = [
  ['star_extension_supermax', 'Star extension or supermax decision'],
  ['rookie_scale_extension', 'Rookie-scale extension'],
  ['restricted_fa', 'Restricted FA negotiation'],
  ['apron_management', 'Tax / apron management'],
  ['trade_deadline_planning', 'Trade deadline planning'],
  ['draft_prep_board', 'Draft prep and board construction'],
  ['coaching_staff_change', 'Coaching or staff change'],
  ['front_office_continuity', 'Front office continuity'],
  ['roster_depth_chart', 'Roster construction / depth chart'],
  ['long_term_cap_planning', 'Long-term cap planning'],
  ['none', 'None of these right now'],
];
const DEADLINE_OPTIONS = [
  ['lt_4_weeks', '< 4 weeks'],
  ['4_12_weeks', '4-12 weeks'],
  ['12_plus_weeks', '12+ weeks'],
  ['offseason', "It's offseason"],
];
const DECISION_TYPE_OPTIONS = [
  ['roster_depth_chart', 'Roster / depth-chart construction'],
  ['contract_cap', 'Contract structure & cap mechanics'],
  ['trade_evaluation', 'Trade evaluation'],
  ['fa_targets', 'FA target prioritization'],
  ['draft_board', 'Draft prep and board construction'],
  ['coaching_staff', 'Coaching / staff'],
  ['long_term_planning', 'Long-term planning'],
  ['game_day_matchup', 'Game-day or matchup prep'],
  ['player_development', 'Player development pathing'],
];
const RECOMMENDATION_OPTIONS = [
  ['three_options_tradeoffs', 'Show me 3 options with tradeoffs'],
  ['single_best_answer', 'Give me a single best answer with reasoning'],
  ['data_only', "Just give me the data, I'll decide"],
  ['adaptive', 'Adaptive, depends on the question'],
];
const CLAIM_OPTIONS = [
  ['source_citation', 'Source / citation'],
  ['confidence_level', 'Confidence level'],
  ['reasoning_chain', 'Reasoning chain'],
  ['counter_evidence', 'Counter-evidence'],
  ['all_of_the_above', 'All of the above'],
];
const RISK_OPTIONS = [
  ['conservative', 'Conservative'],
  ['balanced', 'Balanced'],
  ['aggressive', 'Aggressive'],
  ['situational', 'Situational'],
];
const CADENCE_OPTIONS = [
  ['daily_morning', 'Daily morning briefing'],
  ['mid_day', 'Mid-day update'],
  ['on_demand', "On-demand only — don't push"],
  ['crisis_mode', 'Crisis mode'],
];
const TIME_OPTIONS = [
  ['6_am', '6 AM'],
  ['7_am', '7 AM'],
  ['8_am', '8 AM'],
  ['9_am', '9 AM'],
  ['10_am', '10 AM'],
  ['custom', 'Custom'],
];
const CHANNEL_OPTIONS = [
  ['email', 'Email'],
  ['text_imessage', 'Text / iMessage'],
  ['web_app', 'Web app'],
  ['mobile_ipad', 'Mobile / iPad'],
  ['coda', 'Coda'],
  ['slack', 'Slack'],
];
const TRUST_BOUNDARY_OPTIONS = [
  ['former_roster_returns', 'Former roster returns need explicit approval'],
  ['worn_out_welcome', 'Do not suggest worn-out-welcome players'],
  ['stale_public_context', 'Flag stale public context before recommending'],
  ['owner_budget_assumptions', 'Do not assume owner budget without evidence'],
  ['private_medical_unknowns', 'Flag missing medical / workload data'],
];
const INTEGRATION_OPTIONS = [
  ['email', 'Email'],
  ['text_imessage', 'Text / iMessage'],
  ['web_app', 'Web app'],
  ['mobile_ipad', 'Mobile / iPad'],
  ['coda', 'Coda'],
  ['slack', 'Slack'],
  ['calendar', 'Calendar'],
  ['drive', 'Drive'],
  ['box', 'Box'],
  ['notion', 'Notion'],
  ['linear', 'Linear'],
];
const RITUAL_OPTIONS = [
  ['weekly_basketball_ops', 'Weekly basketball ops meeting'],
  ['daily_standup', 'Daily standup'],
  ['pre_deadline_war_room', 'Pre-deadline war room'],
  ['draft_war_room', 'Draft war room'],
  ['free_agency_planning', 'Free agency planning session'],
  ['owner_governor_check_in', 'Owner / governor check-in'],
  ['game_day_prep', 'Game-day prep meeting'],
];
const FIRE_DRILL_OPTIONS = [
  ['weekly', 'Weekly'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
  ['rare', 'Rare'],
];
const DATA_SOURCE_OPTIONS = [
  ['realgm', 'RealGM'],
  ['spotrac', 'Spotrac'],
  ['synergy', 'Synergy'],
  ['second_spectrum', 'Second Spectrum'],
  ['pcms', 'PCMS'],
  ['zelus', 'Zelus Analytics'],
  ['teamworks', 'Teamworks'],
  ['avm', 'AVM Systems'],
  ['internal_scouting_db', 'Internal scouting database'],
  ['internal_sql', 'Internal SQL warehouse'],
  ['sheets', 'Excel / Google Sheets'],
  ['generic_llms', 'ChatGPT / generic LLMs'],
];
export function ContextGraphOnboardingFlow({ onComplete }: { onComplete: (view: ContextGraphOnboardingViewModel) => void }) {
  const [view, setView] = useState<ContextGraphOnboardingViewModel | null>(null);
  const [activeSection, setActiveSection] = useState<ContextGraphOnboardingSectionId>('identity_role');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queuedPatch = useRef<PatchContextGraphOnboardingRequest['profile'] | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getContextGraphOnboarding(CONTEXT_GRAPH_ONBOARDING_TEAM_ID)
      .then((next) => {
        if (cancelled) return;
        setView(next);
        setActiveSection(next.next_section ?? 'identity_role');
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const profile = view?.profile;
  const sectionIndex = SECTION_ORDER.indexOf(activeSection);
  const activeStatus = view?.sections.find((section) => section.id === activeSection) ?? null;
  const completion = view ? view.sections.filter((section) => section.complete).length / view.sections.length : 0;
  const compactLayout = useIsCompactLayout();

  const flushQueuedPatch = async () => {
    if (!queuedPatch.current) return;
    const patch = queuedPatch.current;
    queuedPatch.current = null;
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    await savePatch(patch);
  };

  const optimisticPatch = (patch: PatchContextGraphOnboardingRequest['profile']) => {
    setView((current) => current ? ({
      ...current,
      profile: deepMerge(current.profile, patch) as ContextGraphOnboardingProfile,
    }) : current);
  };

  const savePatch = async (patch: PatchContextGraphOnboardingRequest['profile']) => {
    setSaving(true);
    setError(null);
    try {
      const next = await patchContextGraphOnboarding(CONTEXT_GRAPH_ONBOARDING_TEAM_ID, patch);
      setView(next);
      setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save onboarding.');
    } finally {
      setSaving(false);
    }
  };

  const saveNow = (patch: PatchContextGraphOnboardingRequest['profile']) => {
    optimisticPatch(patch);
    void savePatch(patch);
  };

  const saveDebounced = (patch: PatchContextGraphOnboardingRequest['profile']) => {
    optimisticPatch(patch);
    queuedPatch.current = deepMerge(queuedPatch.current ?? {}, patch) as PatchContextGraphOnboardingRequest['profile'];
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void flushQueuedPatch();
    }, 500);
  };

  const goNext = async () => {
    await flushQueuedPatch();
    if (!view) return;
    if (activeSection === 'working_style') {
      await commitWorkingStyleDefaults();
    }
    const next = SECTION_ORDER[Math.min(sectionIndex + 1, SECTION_ORDER.length - 1)];
    setActiveSection(next);
  };

  const goBack = async () => {
    await flushQueuedPatch();
    const previous = SECTION_ORDER[Math.max(sectionIndex - 1, 0)];
    setActiveSection(previous);
  };

  const skipOptional = async () => {
    if (!profile || (activeSection !== 'stakeholders_rituals' && activeSection !== 'data_trust')) return;
    const skipped = uniqueStrings<ContextGraphOnboardingSectionId>([...profile.skipped_sections, activeSection]);
    const patch: PatchContextGraphOnboardingRequest['profile'] = activeSection === 'stakeholders_rituals'
      ? { skipped_sections: skipped, stakeholders_rituals: { skipped: true } }
      : { skipped_sections: skipped, data_trust: { skipped: true } };
    await savePatch(patch);
    if (activeSection === 'data_trust') await finish();
    else setActiveSection('data_trust');
  };

  const commitWorkingStyleDefaults = async () => {
    if (!view || !profile) return;
    const patch: PatchContextGraphOnboardingRequest['profile'] = { working_style: {} };
    if (!profile.working_style.recommendation_style) patch.working_style!.recommendation_style = view.defaults.recommendation_style;
    if (profile.working_style.claim_requirements.length === 0) patch.working_style!.claim_requirements = view.defaults.claim_requirements;
    if (Object.keys(patch.working_style ?? {}).length > 0) await savePatch(patch);
  };

  const finish = async () => {
    await flushQueuedPatch();
    await commitWorkingStyleDefaults();
    setSaving(true);
    setError(null);
    try {
      const next = await completeContextGraphOnboarding(CONTEXT_GRAPH_ONBOARDING_TEAM_ID);
      setView(next);
      window.localStorage.setItem(contextGraphOnboardingLocalKey(next.team_id), 'true');
      onComplete(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Required onboarding sections are incomplete.');
    } finally {
      setSaving(false);
    }
  };

  const finishAfterRequired = async () => {
    if (!profile) return;
    await savePatch({
      skipped_sections: uniqueStrings<ContextGraphOnboardingSectionId>([...profile.skipped_sections, 'stakeholders_rituals', 'data_trust']),
      stakeholders_rituals: { skipped: true },
      data_trust: { skipped: true },
    });
    await finish();
  };

  if (loading || !profile || !view) {
    return <div style={shellStyle}><div style={centerStyle}>{error ?? 'Loading onboarding...'}</div></div>;
  }

  return (
    <div style={shellStyle}>
      <div style={compactLayout ? compactPageStyle : pageStyle}>
        <aside style={compactLayout ? compactProgressRailStyle : progressRailStyle}>
          <div style={brandLockupStyle}>
            <img src="/assets/gambit-mark.svg" alt="" style={brandMarkStyle} />
            <div>
              <div style={brandStyle}>Gambit</div>
              <div style={brandSubStyle}>Intel</div>
            </div>
          </div>
          <div style={progressTrackStyle}><div style={{ ...progressFillStyle, width: `${Math.round(completion * 100)}%` }} /></div>
          <div style={progressMetaStyle}>{Math.round(completion * 100)}% complete</div>
          <nav style={sectionNavStyle}>
            {view.sections.map((section, index) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                style={sectionNavButtonStyle(section.id === activeSection, section.complete)}
              >
                <span>{index + 1}. {section.label}</span>
                <span>{section.complete ? 'Done' : section.required ? 'Required' : 'Optional'}</span>
              </button>
            ))}
          </nav>
          <div style={saveStateStyle}>{saving ? 'Saving...' : savedAt ? `Saved ${savedAt}` : 'Auto-save enabled'}</div>
        </aside>

        <main style={compactLayout ? compactCardStyle : cardStyle}>
          <header style={heroStyle}>
            <div style={eyebrowStyle}>{view.team_name} onboarding</div>
            <h1 style={titleStyle}>Set Up Gambit’s First Team-Aware Read</h1>
            <p style={ledeStyle}>Answer in clicks where possible. Gambit writes the result directly into the {view.team_name} Intel layer.</p>
          </header>

          {error && <div style={errorStyle}>{error}</div>}

          {activeSection === 'identity_role' && (
            <IdentitySection profile={profile} onSave={saveNow} onText={saveDebounced} />
          )}
          {activeSection === 'team_snapshot' && (
            <TeamSnapshotSection view={view} onSave={saveNow} onText={saveDebounced} />
          )}
          {activeSection === 'strategic_priorities' && (
            <StrategicPrioritiesSection view={view} onSave={saveNow} onText={saveDebounced} />
          )}
          {activeSection === 'working_style' && (
            <WorkingStyleSection view={view} onSave={saveNow} onText={saveDebounced} />
          )}
          {activeSection === 'stakeholders_rituals' && (
            <StakeholdersSection profile={profile} onSave={saveNow} onText={saveDebounced} />
          )}
          {activeSection === 'data_trust' && (
            <DataTrustSection profile={profile} onSave={saveNow} onText={saveDebounced} />
          )}

          <footer style={footerStyle}>
            <button type="button" onClick={goBack} disabled={sectionIndex === 0} style={secondaryButtonStyle(sectionIndex > 0)}>Back</button>
            <div style={missingStyle}>
              {activeStatus?.missing.length ? `Missing: ${activeStatus.missing.join(', ')}` : 'Section ready'}
            </div>
            {activeSection === 'working_style' && (
              <button type="button" onClick={finishAfterRequired} disabled={saving} style={secondaryButtonStyle(true)}>
                Skip optional and finish
              </button>
            )}
            {(activeSection === 'stakeholders_rituals' || activeSection === 'data_trust') && (
              <button type="button" onClick={skipOptional} disabled={saving} style={secondaryButtonStyle(true)}>
                Skip section
              </button>
            )}
            {activeSection === 'data_trust' ? (
              <button type="button" onClick={finish} disabled={saving} style={primaryButtonStyle}>Enter Gambit</button>
            ) : (
              <button type="button" onClick={goNext} disabled={saving} style={primaryButtonStyle}>Continue</button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}

function IdentitySection({
  profile,
  onSave,
  onText,
}: {
  profile: ContextGraphOnboardingProfile;
  onSave: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
  onText: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
}) {
  return (
    <Section title="Identity & role" note="This sets Gambit's default altitude: recommendation, analysis, or briefing.">
      <Question title="What's your team?">
        <input value={profile.team_name} disabled style={inputStyle} />
      </Question>
      <Question title="What's your role?">
        <SinglePills options={ROLE_OPTIONS} value={profile.identity.role} onChange={(role) => onSave({ identity: { role } })} />
        {profile.identity.role === 'other' && (
          <input
            value={profile.identity.role_other}
            onChange={(event) => onText({ identity: { role_other: event.target.value } })}
            placeholder="Other role..."
            style={inputStyle}
          />
        )}
      </Question>
      <Question title="Years in this role?">
        <SinglePills options={YEARS_OPTIONS} value={profile.identity.years_in_role} onChange={(years_in_role) => onSave({ identity: { years_in_role } })} />
      </Question>
      <Question title="On the decisions you handle, you usually:">
        <SinglePills options={AUTHORITY_OPTIONS} value={profile.identity.decision_authority} onChange={(decision_authority) => onSave({ identity: { decision_authority } })} />
      </Question>
    </Section>
  );
}

function TeamSnapshotSection({
  view,
  onSave,
  onText,
}: {
  view: ContextGraphOnboardingViewModel;
  onSave: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
  onText: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
}) {
  const profile = view.profile;
  const cornerstoneSuggestions = CORNERSTONE_SUGGESTIONS_BY_TEAM[view.team_id]
    ?? view.profile.team_snapshot.cornerstones
    ?? [];
  return (
    <Section title="Team snapshot" note="This is the highest-leverage context for the first Gambit response.">
      <Question title="Where is your team in its competitive lifecycle?">
        <SinglePills
          options={LIFECYCLE_OPTIONS}
          value={profile.team_snapshot.lifecycle}
          onChange={(lifecycle) => onSave({
            team_snapshot: {
              lifecycle,
              secondary_lifecycles: profile.team_snapshot.secondary_lifecycles.filter((item) => item !== lifecycle),
            },
          })}
        />
      </Question>
      <Question title="Any secondary posture tags?">
        <MultiPills
          options={LIFECYCLE_OPTIONS.filter(([id]) => id !== profile.team_snapshot.lifecycle)}
          values={profile.team_snapshot.secondary_lifecycles}
          max={3}
          onChange={(secondary_lifecycles) => onSave({ team_snapshot: { secondary_lifecycles } })}
        />
      </Question>
      <InferredCapContextCard view={view} />
      <Question title="Who are the 1-3 players you're building around?">
        <MultiPills
          options={cornerstoneSuggestions.map((name) => [name, name])}
          values={profile.team_snapshot.cornerstones}
          max={3}
          onChange={(cornerstones) => onSave({ team_snapshot: { cornerstones } })}
        />
        <AddOther
          label="Add player..."
          onAdd={(player) => onSave({ team_snapshot: { cornerstones: uniqueStrings([...profile.team_snapshot.cornerstones, player]).slice(0, 3) } })}
        />
      </Question>
      <Question title="Which of these are you actively navigating?">
        <MultiPills
          options={SCENARIO_OPTIONS}
          values={profile.team_snapshot.active_scenarios}
          onChange={(active_scenarios) => onSave({ team_snapshot: { active_scenarios: normalizeNone(active_scenarios) } })}
        />
        <AddOther
          label="Other scenario..."
          onAdd={(scenario) => onSave({ team_snapshot: { other_scenarios: uniqueStrings([...profile.team_snapshot.other_scenarios, scenario]) } })}
        />
      </Question>
      {profile.team_snapshot.active_scenarios.includes('star_extension_supermax') && (
        <Question title="Which player(s) are involved in the star extension or supermax decision?">
          <input
            value={profile.team_snapshot.star_extension_players}
            onChange={(event) => onText({ team_snapshot: { star_extension_players: event.target.value } })}
            style={inputStyle}
            placeholder="Player names..."
          />
        </Question>
      )}
      {profile.team_snapshot.active_scenarios.includes('rookie_scale_extension') && (
        <Question title="Which player(s) are rookie-scale extension eligible?">
          <input
            value={profile.team_snapshot.rookie_scale_extension_players}
            onChange={(event) => onText({ team_snapshot: { rookie_scale_extension_players: event.target.value } })}
            style={inputStyle}
            placeholder="Player names..."
          />
        </Question>
      )}
      {profile.team_snapshot.active_scenarios.includes('trade_deadline_planning') && (
        <Question title="How many weeks out from your next deadline?">
          <SinglePills options={DEADLINE_OPTIONS} value={profile.team_snapshot.trade_deadline_window} onChange={(trade_deadline_window) => onSave({ team_snapshot: { trade_deadline_window } })} />
        </Question>
      )}
    </Section>
  );
}

function InferredCapContextCard({ view }: { view: ContextGraphOnboardingViewModel }) {
  const cap = view.inferred_cap_context;
  const status = cap.current_status_label || 'not available';
  const payroll = cap.current_payroll_estimate ? formatMoney(cap.current_payroll_estimate) : 'payroll unavailable';
  const window = cap.flexibility_windows[0];
  return (
    <div style={inferredContextStyle}>
      <div>
        <div style={inferredLabelStyle}>Inferred from Intel</div>
        <h3 style={inferredTitleStyle}>Cap context: {status}</h3>
      </div>
      <p style={inferredBodyStyle}>
        Gambit already has {view.team_name} at {status} with {payroll}
        {cap.hard_capped ? ` and hard-capped: ${cap.hard_capped}` : ''}.
      </p>
      {window && (
        <p style={inferredBodyStyle}>
          {window.season}: {window.projected_status}
        </p>
      )}
      <p style={inferredMetaStyle}>
        This is not a user question. It comes from `cap_situation` in the existing Intel layer and is used to shape generated priorities.
      </p>
    </div>
  );
}

function StrategicPrioritiesSection({
  view,
  onSave,
  onText,
}: {
  view: ContextGraphOnboardingViewModel;
  onSave: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
  onText: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
}) {
  const profile = view.profile;
  return (
    <Section title="Strategic priorities" note="Ranked priorities become the weighted vector Gambit uses in the first day.">
      <Question title="What's the most important decision facing you in the next 90 days?">
        <textarea
          value={profile.strategic_priorities.ninety_day_decision}
          onChange={(event) => onText({ strategic_priorities: { ninety_day_decision: event.target.value } })}
          placeholder="1-2 sentences..."
          style={textAreaStyle}
        />
      </Question>
      <Question title="Top priorities for this season window">
        <div style={rankGridStyle}>
          {view.generated_priority_options.map((option) => {
            const rank = profile.strategic_priorities.ranked_priorities.indexOf(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  const current = profile.strategic_priorities.ranked_priorities.filter((id) => id !== option.id);
                  const ranked_priorities = rank >= 0 ? current : [...current, option.id].slice(0, 3);
                  onSave({ strategic_priorities: { ranked_priorities } });
                }}
                style={rankButtonStyle(rank >= 0)}
              >
                <span style={rankBadgeStyle(rank >= 0)}>{rank >= 0 ? rank + 1 : '+'}</span>
                <span style={rankTitleStyle}>{option.label}</span>
                <span style={rankDetailStyle}>{option.detail}</span>
              </button>
            );
          })}
        </div>
      </Question>
      <Question title="What kinds of decisions do you make most often?">
        <MultiPills options={DECISION_TYPE_OPTIONS} values={profile.strategic_priorities.decision_types} onChange={(decision_types) => onSave({ strategic_priorities: { decision_types } })} />
        <AddOther
          label="Other decision..."
          onAdd={(item) => onSave({ strategic_priorities: { other_decision_types: uniqueStrings([...profile.strategic_priorities.other_decision_types, item]) } })}
        />
      </Question>
      <Question title="Optional: a real decision from the last 12 months Gambit could have helped with">
        <textarea
          value={profile.strategic_priorities.recent_decision_help}
          onChange={(event) => onText({ strategic_priorities: { recent_decision_help: event.target.value } })}
          placeholder="Decision and how Gambit could have helped..."
          style={textAreaStyle}
        />
      </Question>
    </Section>
  );
}

function WorkingStyleSection({
  view,
  onSave,
  onText,
}: {
  view: ContextGraphOnboardingViewModel;
  onSave: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
  onText: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
}) {
  const profile = view.profile;
  const recommendationStyle = profile.working_style.recommendation_style || view.defaults.recommendation_style;
  const claimRequirements = profile.working_style.claim_requirements.length ? profile.working_style.claim_requirements : view.defaults.claim_requirements;
  return (
    <Section title="Working style" note="These defaults are preselected from your role and authority, but they are not committed until you continue.">
      <Question title="When Gambit gives you a recommendation, you want it to:">
        <SinglePills options={RECOMMENDATION_OPTIONS} value={recommendationStyle} onChange={(recommendation_style) => onSave({ working_style: { recommendation_style } })} />
      </Question>
      <Question title="Every claim Gambit makes should include:">
        <MultiPills options={CLAIM_OPTIONS} values={claimRequirements} onChange={(claim_requirements) => onSave({ working_style: { claim_requirements: normalizeAllOfAbove(claim_requirements) } })} />
        <AddOther label="Other evidence requirement..." onAdd={(item) => onSave({ working_style: { claim_requirements: uniqueStrings([...claimRequirements, item]) } })} />
      </Question>
      <Question title="Risk posture on calls">
        <SinglePills options={RISK_OPTIONS} value={profile.working_style.risk_posture} onChange={(risk_posture) => onSave({ working_style: { risk_posture } })} />
      </Question>
      <Question title="Cadence">
        <SinglePills options={CADENCE_OPTIONS} value={profile.working_style.cadence} onChange={(cadence) => onSave({ working_style: { cadence } })} />
      </Question>
      {(profile.working_style.cadence === 'daily_morning' || profile.working_style.cadence === 'mid_day') && (
        <Question title="What time?">
          <SinglePills options={TIME_OPTIONS} value={profile.working_style.briefing_time} onChange={(briefing_time) => onSave({ working_style: { briefing_time } })} />
          <input
            value={profile.working_style.briefing_timezone}
            onChange={(event) => onText({ working_style: { briefing_timezone: event.target.value } })}
            placeholder="Timezone, e.g. ET"
            style={inputStyle}
          />
        </Question>
      )}
      <Question title="What channels?">
        <MultiPills options={CHANNEL_OPTIONS} values={profile.working_style.channels} onChange={(channels) => onSave({ working_style: { channels } })} />
        <AddOther label="Other channel..." onAdd={(item) => onSave({ working_style: { other_channels: uniqueStrings([...profile.working_style.other_channels, item]) } })} />
      </Question>
      {profile.working_style.channels.includes('slack') && (
        <Question title="Slack workspace + primary channel">
          <div style={twoColStyle}>
            <input value={profile.working_style.slack_workspace} onChange={(event) => onText({ working_style: { slack_workspace: event.target.value } })} placeholder="Workspace" style={inputStyle} />
            <input value={profile.working_style.slack_channel} onChange={(event) => onText({ working_style: { slack_channel: event.target.value } })} placeholder="#channel" style={inputStyle} />
          </div>
        </Question>
      )}
    </Section>
  );
}

function StakeholdersSection({
  profile,
  onSave,
  onText,
}: {
  profile: ContextGraphOnboardingProfile;
  onSave: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
  onText: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
}) {
  const people = profile.stakeholders_rituals.people;
  const authorityOptions = [['self', 'Self'], ['outside_org_owner', 'Outside org / owner level'], ...people.map((person) => [person.name, person.name])];
  const updatePerson = (index: number, patch: Partial<ContextGraphOnboardingStakeholder>) => {
    const next = people.map((person, personIndex) => (personIndex === index ? { ...person, ...patch } : person));
    onSave({ stakeholders_rituals: { skipped: false, people: next } });
  };
  return (
    <Section title="Stakeholders & rituals" note="Optional, but useful when Gambit needs to reference who should be in the room.">
      <Question title="Who else in your organization should Gambit know about?">
        <div style={stakeholderListStyle}>
          {people.map((person, index) => (
            <div key={person.id} style={stakeholderRowStyle}>
              <input value={person.name} onChange={(event) => updatePerson(index, { name: event.target.value })} placeholder="Name" style={inputStyle} />
              <select value={person.role} onChange={(event) => updatePerson(index, { role: event.target.value })} style={selectStyle}>
                <option value="">Role</option>
                {ROLE_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <input value={person.decision_areas.join(', ')} onChange={(event) => updatePerson(index, { decision_areas: splitList(event.target.value) })} placeholder="cap, scouting, coaching" style={inputStyle} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onSave({ stakeholders_rituals: { skipped: false, people: [...people, { id: `stakeholder-${Date.now()}`, name: '', role: '', decision_areas: [] }].slice(0, 10) } })}
          style={ghostButtonStyle}
        >
          Add stakeholder
        </button>
      </Question>
      <Question title="Who has final authority on:">
        <div style={twoColStyle}>
          <LabeledSelect label="Cap / contracts" value={profile.stakeholders_rituals.authority.cap_contracts} options={authorityOptions} onChange={(cap_contracts) => onSave({ stakeholders_rituals: { authority: { cap_contracts } } })} />
          <LabeledSelect label="Basketball ops" value={profile.stakeholders_rituals.authority.basketball_ops} options={authorityOptions} onChange={(basketball_ops) => onSave({ stakeholders_rituals: { authority: { basketball_ops } } })} />
          <LabeledSelect label="Draft" value={profile.stakeholders_rituals.authority.draft} options={authorityOptions} onChange={(draft) => onSave({ stakeholders_rituals: { authority: { draft } } })} />
          <LabeledSelect label="Coaching / staff" value={profile.stakeholders_rituals.authority.coaching_staff} options={authorityOptions} onChange={(coaching_staff) => onSave({ stakeholders_rituals: { authority: { coaching_staff } } })} />
        </div>
      </Question>
      <Question title="Recurring decision rituals you run">
        <MultiPills options={RITUAL_OPTIONS} values={profile.stakeholders_rituals.rituals} onChange={(rituals) => onSave({ stakeholders_rituals: { skipped: false, rituals } })} />
        <AddOther label="Other ritual..." onAdd={(item) => onSave({ stakeholders_rituals: { other_rituals: uniqueStrings([...profile.stakeholders_rituals.other_rituals, item]) } })} />
      </Question>
      <Question title='How often do "fire drill" decisions hit?'>
        <SinglePills options={FIRE_DRILL_OPTIONS} value={profile.stakeholders_rituals.fire_drill_frequency} onChange={(fire_drill_frequency) => onSave({ stakeholders_rituals: { skipped: false, fire_drill_frequency } })} />
      </Question>
    </Section>
  );
}

function DataTrustSection({
  profile,
  onSave,
  onText,
}: {
  profile: ContextGraphOnboardingProfile;
  onSave: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
  onText: (patch: PatchContextGraphOnboardingRequest['profile']) => void;
}) {
  return (
    <Section title="Data & trust posture" note="Optional, but this makes the trust boundary visible before Gambit answers.">
      <div style={trustPanelStyle}>
        <div style={trustTitleStyle}>What Gambit does and does not do with your data</div>
        <div>Stores structured Intel preferences, not raw transcripts.</div>
        <div>Uses your context to personalize recommendations, not to overwrite current roster/cap/stat evidence.</div>
        <div>Keeps trust boundaries visible in future connected workflows.</div>
        <button type="button" onClick={() => onSave({ data_trust: { trust_panel_acknowledged: true } })} style={miniButtonStyle(profile.data_trust.trust_panel_acknowledged)}>
          {profile.data_trust.trust_panel_acknowledged ? 'Acknowledged' : 'Acknowledge'}
        </button>
      </div>
      <Question title="Data sources you currently use">
        <MultiPills options={DATA_SOURCE_OPTIONS} values={profile.data_trust.sources} onChange={(sources) => onSave({ data_trust: { skipped: false, sources } })} />
        <AddOther label="Other source..." onAdd={(item) => onSave({ data_trust: { other_sources: uniqueStrings([...profile.data_trust.other_sources, item]) } })} />
      </Question>
      <Question title="Off-limits suggestions or trust tripwires">
        <MultiPills options={TRUST_BOUNDARY_OPTIONS} values={profile.data_trust.off_limits} onChange={(off_limits) => onSave({ data_trust: { skipped: false, off_limits } })} />
        <div style={twoColStyle}>
          <input
            value={profile.data_trust.off_limits_people}
            onChange={(event) => onText({ data_trust: { skipped: false, off_limits_people: event.target.value } })}
            placeholder="People or former players, e.g. Kyle Kuzma, Jordan Poole"
            style={inputStyle}
          />
          <input
            value={profile.data_trust.off_limits_topics}
            onChange={(event) => onText({ data_trust: { skipped: false, off_limits_topics: event.target.value } })}
            placeholder="Topics or assumptions Gambit should avoid"
            style={inputStyle}
          />
        </div>
      </Question>
      <Question title="What tools should Gambit integrate with first?">
        <MultiPills options={INTEGRATION_OPTIONS} values={profile.data_trust.integrations} onChange={(integrations) => onSave({ data_trust: { skipped: false, integrations } })} />
        <AddOther label="Other integration..." onAdd={(item) => onSave({ data_trust: { other_integrations: uniqueStrings([...profile.data_trust.other_integrations, item]) } })} />
      </Question>
    </Section>
  );
}

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section style={sectionStyle}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      <p style={sectionNoteStyle}>{note}</p>
      {children}
    </section>
  );
}

function Question({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={questionStyle}>
      <h3 style={questionTitleStyle}>{title}</h3>
      {children}
    </div>
  );
}

function SinglePills({ options, value, onChange }: { options: string[][]; value: string; onChange: (value: string) => void }) {
  return (
    <div style={pillRowStyle}>
      {options.map(([id, label]) => (
        <button key={id} type="button" onClick={() => onChange(id)} style={pillStyle(value === id)}>{label}</button>
      ))}
    </div>
  );
}

function MultiPills({
  options,
  values,
  max,
  onChange,
}: {
  options: string[][];
  values: string[];
  max?: number;
  onChange: (values: string[]) => void;
}) {
  return (
    <div style={pillRowStyle}>
      {options.map(([id, label]) => {
        const selected = values.includes(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              const next = selected ? values.filter((item) => item !== id) : uniqueStrings([...values, id]);
              onChange(max ? next.slice(0, max) : next);
            }}
            style={pillStyle(selected)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function AddOther({ label, onAdd }: { label: string; onAdd: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={otherButtonStyle}>Other...</button>;
  return (
    <div style={addOtherStyle}>
      <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={label} style={inputStyle} />
      <button
        type="button"
        onClick={() => {
          if (value.trim()) onAdd(value.trim());
          setValue('');
          setOpen(false);
        }}
        style={ghostButtonStyle}
      >
        Add
      </button>
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[][];
  onChange: (value: string) => void;
}) {
  return (
    <label style={labelStyle}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
        <option value="">Select...</option>
        {options.map(([id, optionLabel]) => <option key={id} value={id}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) return patch;
  if (!isRecord(base) || !isRecord(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = deepMerge(merged[key], value);
  }
  return merged;
}

function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function uniqueStrings<T extends string>(items: T[]): T[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))] as T[];
}

function normalizeNone(values: string[]): string[] {
  return values.includes('none') ? ['none'] : values.filter((value) => value !== 'none');
}

function normalizeAllOfAbove(values: string[]): string[] {
  return values.includes('all_of_the_above') ? ['all_of_the_above'] : values;
}

function useIsCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' ? window.matchMedia('(max-width: 980px)').matches : false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia('(max-width: 980px)');
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const BRAND = {
  bgApp: 'linear-gradient(180deg, #F5ECD8 0%, #FAF8F0 42%, #EFE7D2 100%)',
  glassSurface: 'rgba(255,255,255,0.78)',
  glassBorder: 'rgba(221,223,227,0.92)',
  glassShadow: '0 12px 34px rgba(60,40,10,0.08), 0 1px 2px rgba(60,40,10,0.04)',
  cream50: '#FBF4E6',
  ink900: '#161820',
  seasoned: '#B08040',
} as const;

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: BRAND.bgApp,
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  padding: SPACE['2xl'],
};

const pageStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '280px minmax(0, 1fr)',
  gap: SPACE['2xl'],
  maxWidth: 1180,
  margin: '0 auto',
};

const compactPageStyle: React.CSSProperties = {
  ...pageStyle,
  gridTemplateColumns: '1fr',
  gap: SPACE.lg,
};

const progressRailStyle: React.CSSProperties = {
  position: 'sticky',
  top: SPACE['2xl'],
  alignSelf: 'start',
  border: `1px solid ${BRAND.glassBorder}`,
  borderRadius: RADIUS.md,
  background: BRAND.glassSurface,
  boxShadow: BRAND.glassShadow,
  backdropFilter: 'blur(18px)',
  padding: SPACE.lg,
  display: 'grid',
  gap: SPACE.md,
};

const compactProgressRailStyle: React.CSSProperties = {
  ...progressRailStyle,
  position: 'relative',
  top: 0,
};

const brandLockupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.sm,
};

const brandMarkStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: 'block',
};

const brandStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: TYPE.display.sm,
  fontWeight: 700,
  letterSpacing: TRACKING.body,
  lineHeight: 1,
  textTransform: 'uppercase',
};

const brandSubStyle: React.CSSProperties = {
  marginTop: 2,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 700,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const progressTrackStyle: React.CSSProperties = {
  height: 6,
  borderRadius: RADIUS.pill,
  background: BRAND.cream50,
  overflow: 'hidden',
};

const progressFillStyle: React.CSSProperties = {
  height: '100%',
  borderRadius: RADIUS.pill,
  background: F.fenway,
  transition: 'width 180ms ease',
};

const progressMetaStyle: React.CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 600,
};

const sectionNavStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.xs,
};

function sectionNavButtonStyle(active: boolean, complete: boolean): React.CSSProperties {
  return {
    border: `1px solid ${active ? F.fenway : complete ? F.fenwaySoft : F.border}`,
    borderRadius: RADIUS.md,
    background: active ? F.fenwaySoft : 'rgba(255,255,255,0.64)',
    color: F.ink,
    cursor: 'pointer',
    padding: SPACE.sm,
    display: 'grid',
    gap: 2,
    textAlign: 'left',
    fontFamily: 'var(--font-sans)',
    fontSize: TYPE.body.sm,
    fontWeight: active ? 700 : 500,
    boxShadow: active ? F.shadowSoft : 'none',
  };
}

const saveStateStyle: React.CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  paddingTop: SPACE.md,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
};

const cardStyle: React.CSSProperties = {
  border: `1px solid ${BRAND.glassBorder}`,
  borderRadius: RADIUS.md,
  background: BRAND.glassSurface,
  boxShadow: BRAND.glassShadow,
  backdropFilter: 'blur(18px)',
  padding: SPACE['3xl'],
  minHeight: 'calc(100vh - 64px)',
};

const compactCardStyle: React.CSSProperties = {
  ...cardStyle,
  padding: SPACE.xl,
  minHeight: 'auto',
};

const centerStyle: React.CSSProperties = {
  minHeight: '80vh',
  display: 'grid',
  placeItems: 'center',
  color: F.fgMuted,
};

const heroStyle: React.CSSProperties = {
  borderBottom: `1px solid ${F.border}`,
  marginBottom: SPACE['2xl'],
  paddingBottom: SPACE.xl,
  maxWidth: 760,
};

const eyebrowStyle: React.CSSProperties = {
  color: BRAND.seasoned,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 800,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const titleStyle: React.CSSProperties = {
  margin: `${SPACE.sm}px 0 ${SPACE.sm}px`,
  color: BRAND.ink900,
  fontFamily: 'var(--font-display)',
  fontSize: 30,
  fontWeight: 600,
  lineHeight: 1.15,
  letterSpacing: TRACKING.body,
};

const ledeStyle: React.CSSProperties = {
  margin: `0 0 ${SPACE['2xl']}px`,
  color: F.inkSoft,
  fontSize: TYPE.body.md,
  lineHeight: 1.5,
};

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.lg,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: TYPE.display.md,
  fontWeight: 600,
  color: F.ink,
  letterSpacing: TRACKING.body,
};

const sectionNoteStyle: React.CSSProperties = {
  margin: 0,
  color: F.fgMuted,
  fontSize: TYPE.body.sm,
  lineHeight: 1.5,
};

const questionStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.sm,
  maxWidth: 900,
};

const questionTitleStyle: React.CSSProperties = {
  margin: 0,
  color: F.ink,
  fontSize: TYPE.body.md,
  fontWeight: 800,
};

const inferredContextStyle: React.CSSProperties = {
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.md,
  background: 'rgba(242,238,224,0.72)',
  padding: SPACE.lg,
  display: 'grid',
  gap: SPACE.xs,
  maxWidth: 900,
};

const inferredLabelStyle: React.CSSProperties = {
  color: BRAND.seasoned,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 800,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const inferredTitleStyle: React.CSSProperties = {
  margin: `${SPACE.xs}px 0 0`,
  color: F.ink,
  fontFamily: 'var(--font-display)',
  fontSize: TYPE.body.md,
  fontWeight: 600,
};

const inferredBodyStyle: React.CSSProperties = {
  margin: 0,
  color: F.inkSoft,
  fontSize: TYPE.body.sm,
  lineHeight: 1.5,
};

const inferredMetaStyle: React.CSSProperties = {
  margin: 0,
  color: F.fgMuted,
  fontSize: TYPE.meta.sm,
  lineHeight: 1.45,
};

const pillRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: SPACE.sm,
};

function pillStyle(selected: boolean): React.CSSProperties {
  return {
    border: `1px solid ${selected ? F.fenway : F.borderStrong}`,
    borderRadius: RADIUS.pill,
    background: selected ? F.fenway : 'rgba(255,255,255,0.78)',
    color: selected ? F.surface : F.ink,
    boxShadow: F.shadowSoft,
    cursor: 'pointer',
    padding: `${SPACE.sm}px ${SPACE.lg}px`,
    fontFamily: 'var(--font-sans)',
    fontSize: TYPE.body.sm,
    fontWeight: 750,
  };
}

const otherButtonStyle: React.CSSProperties = {
  ...pillStyle(false),
  width: 'fit-content',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.pill,
  background: 'rgba(255,255,255,0.82)',
  color: F.ink,
  padding: `${SPACE.sm}px ${SPACE.lg}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  outlineColor: F.fenway,
};

const textAreaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: 108,
  borderRadius: RADIUS.md,
  resize: 'vertical',
  lineHeight: 1.5,
};

const addOtherStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, max-content))',
  gap: SPACE.sm,
  alignItems: 'center',
};

const ghostButtonStyle: React.CSSProperties = {
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.pill,
  background: F.surface,
  color: F.ink,
  cursor: 'pointer',
  padding: `${SPACE.sm}px ${SPACE.lg}px`,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 800,
  width: 'fit-content',
};

const rankGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.sm,
};

function rankButtonStyle(selected: boolean): React.CSSProperties {
  return {
    border: `1px solid ${selected ? F.fenway : F.border}`,
    borderRadius: RADIUS.md,
    background: selected ? F.fenwaySoft : 'rgba(255,255,255,0.78)',
    boxShadow: F.shadowSoft,
    cursor: 'pointer',
    display: 'grid',
    gridTemplateColumns: '36px minmax(0, 1fr)',
    gap: SPACE.sm,
    padding: SPACE.md,
    textAlign: 'left',
  };
}

function rankBadgeStyle(selected: boolean): React.CSSProperties {
  return {
    border: `1px solid ${selected ? F.fenway : F.borderStrong}`,
    borderRadius: RADIUS.pill,
    color: selected ? F.fenway : F.fgMuted,
    background: F.surface,
    width: 28,
    height: 28,
    display: 'grid',
    placeItems: 'center',
    fontFamily: 'var(--font-mono)',
    fontSize: TYPE.meta.sm,
    fontWeight: 900,
  };
}

const rankTitleStyle: React.CSSProperties = {
  color: F.ink,
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  fontSize: TYPE.body.sm,
  letterSpacing: TRACKING.body,
};

const rankDetailStyle: React.CSSProperties = {
  gridColumn: '2',
  color: F.fg,
  fontSize: TYPE.meta.sm,
  lineHeight: 1.45,
};

const twoColStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: SPACE.sm,
};

const stakeholderListStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.sm,
};

const stakeholderRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: SPACE.sm,
};

const labelStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.xs,
  color: F.fgMuted,
  fontSize: TYPE.meta.sm,
  fontWeight: 800,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  borderRadius: RADIUS.md,
};

const trustPanelStyle: React.CSSProperties = {
  border: `1px solid ${F.fenway}`,
  borderRadius: RADIUS.md,
  background: 'rgba(232,241,236,0.84)',
  display: 'grid',
  gap: SPACE.xs,
  padding: SPACE.lg,
  color: F.ink,
  fontSize: TYPE.body.sm,
  lineHeight: 1.45,
  maxWidth: 860,
};

const trustTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 600,
  marginBottom: SPACE.xs,
};

function miniButtonStyle(selected: boolean): React.CSSProperties {
  return {
    ...ghostButtonStyle,
    marginTop: SPACE.xs,
    background: selected ? F.surface : F.fenwaySoft,
    borderColor: F.fenway,
  };
}

const footerStyle: React.CSSProperties = {
  borderTop: `1px solid ${F.border}`,
  marginTop: SPACE['2xl'],
  paddingTop: SPACE.lg,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: SPACE.sm,
  flexWrap: 'wrap',
};

const missingStyle: React.CSSProperties = {
  marginRight: 'auto',
  color: F.fgMuted,
  fontSize: TYPE.meta.sm,
};

function secondaryButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    ...ghostButtonStyle,
    opacity: enabled ? 1 : 0.45,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}

const primaryButtonStyle: React.CSSProperties = {
  ...ghostButtonStyle,
  borderColor: F.fenway,
  background: F.fenway,
  color: F.surface,
};

const errorStyle: React.CSSProperties = {
  border: `1px solid ${F.red}`,
  borderRadius: RADIUS.md,
  background: F.redSoft,
  color: F.red,
  padding: SPACE.md,
  marginBottom: SPACE.lg,
  fontSize: TYPE.body.sm,
};
