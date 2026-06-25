import { useMemo, useState } from 'react';
import type React from 'react';
import type {
  ContextGraphConfidence,
  ContextGraphWarRoomResponse,
  TeamMemoryCard,
  TeamMemoryGeneratedOption,
  TeamMemoryInterviewSelection,
  TeamMemoryInterviewStage,
  TeamMemoryProfile,
} from '@shared/types';
import {
  deleteTeamMemory,
  generateTeamMemoryOptions,
  intakeTeamMemory,
  updateTeamMemory,
} from '../api/contextGraph';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

interface TeamMemoryOnboardingProps {
  teamId: string;
  teamName: string;
  warRoom: ContextGraphWarRoomResponse;
  profile: TeamMemoryProfile | null;
  onProfileSaved: (profile: TeamMemoryProfile | null) => void;
  onRunMemoryBrief: () => void;
  startingBrief: boolean;
}

interface StageConfig {
  id: TeamMemoryInterviewStage;
  label: string;
  prompt: string;
}

interface RoleLens {
  id: string;
  label: string;
  detail: string;
}

interface FocusCandidate {
  id: string;
  selection: TeamMemoryInterviewSelection;
  score: number;
  headline: string;
  rationale: string;
  whyAsking: string;
  prompt: AnalystPrompt;
  suggestedTraits: string[];
  sourceLabel: string;
}

interface AnalystPrompt {
  heading: string;
  basis: string[];
  ask: string;
}

const STAGES: StageConfig[] = [
  { id: 'player', label: 'Player', prompt: 'Hidden value' },
  { id: 'pairing', label: 'Pairing', prompt: 'Fit context' },
  { id: 'decision', label: 'Decision', prompt: 'Live call' },
  { id: 'room_belief', label: 'Room belief', prompt: 'Gut read' },
];

const FALLBACK_TRAITS = [
  'coach trust',
  'health uncertainty',
  'role fit',
  'leadership',
  'model disagreement',
  'locker room gravity',
  'development context',
  'market value gap',
  'decision urgency',
];

const ROLE_LENSES: RoleLens[] = [
  { id: 'president', label: 'President', detail: 'accountable roster posture' },
  { id: 'gm', label: 'GM', detail: 'transaction and roster mechanics' },
  { id: 'coach', label: 'Coach', detail: 'rotation, fit, and trust' },
  { id: 'analytics', label: 'Strategy', detail: 'tests, proxies, and caveats' },
];

export function TeamMemoryOnboarding({
  teamId,
  teamName,
  warRoom,
  profile,
  onProfileSaved,
  onRunMemoryBrief,
  startingBrief,
}: TeamMemoryOnboardingProps) {
  const focusCandidates = useMemo(() => buildFocusCandidates(warRoom, profile), [warRoom, profile]);
  const initialFocus = focusCandidates[0] ?? null;
  const [selectedFocusId, setSelectedFocusId] = useState(() => initialFocus?.id ?? '');
  const [stage, setStage] = useState<TeamMemoryInterviewStage>(() => initialFocus?.selection.stage ?? 'room_belief');
  const [roleLens, setRoleLens] = useState('president');
  const [roleOther, setRoleOther] = useState('');
  const [showMoreReferences, setShowMoreReferences] = useState(false);
  const [fullAssessmentOpen, setFullAssessmentOpen] = useState(false);
  const [selections, setSelections] = useState<TeamMemoryInterviewSelection[]>(() => (
    initialFocus ? [initialFocus.selection] : []
  ));
  const [traits, setTraits] = useState<string[]>(() => initialFocus?.suggestedTraits.slice(0, 1) ?? ['coach trust']);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [generated, setGenerated] = useState<TeamMemoryGeneratedOption[]>([]);
  const [accepted, setAccepted] = useState<TeamMemoryGeneratedOption[]>([]);
  const [draft, setDraft] = useState<TeamMemoryProfile | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seeds = useMemo(() => buildSeedSelections(warRoom, profile), [warRoom, profile]);
  const selectedFocus = focusCandidates.find((candidate) => candidate.id === selectedFocusId) ?? focusCandidates[0] ?? null;
  const activeStage = selectedFocus?.selection.stage ?? stage;
  const effectiveSelections = useMemo(() => {
    if (!selectedFocus) return selections;
    return [
      selectedFocus.selection,
      ...selections.filter((selection) => selection.id !== selectedFocus.selection.id),
    ];
  }, [selectedFocus, selections]);
  const smartTraitOptions = useMemo(() => buildSmartTraitOptions(selectedFocus), [selectedFocus]);
  const priorityCandidateIds = new Set(focusCandidates.slice(0, 5).map((candidate) => candidate.selection.id));
  const selectedIds = new Set(effectiveSelections.map((selection) => selection.id));
  const lowPriorityReferences = seeds
    .filter((selection) => !priorityCandidateIds.has(selection.id) && selection.id !== selectedFocus?.selection.id)
    .slice(0, 12);
  const activeProfile = draft ?? profile;
  const savedCardCount = profile?.cards.filter((card) => card.kind !== 'full_assessment_placeholder').length ?? 0;
  const acceptedIds = new Set(accepted.map((option) => option.id));
  const generatedOpen = generated.filter((option) => !acceptedIds.has(option.id));
  const canGenerate = effectiveSelections.length > 0 || traits.length > 0 || note.trim().length > 0;
  const canDraft = accepted.length > 0 || effectiveSelections.length > 0;
  const selectedRole = roleLens === 'other'
    ? { id: 'other', label: roleOther.trim() || 'Other', detail: 'custom operating lens' }
    : ROLE_LENSES.find((role) => role.id === roleLens) ?? ROLE_LENSES[0];
  const systemSources = buildSystemSources(warRoom, profile, effectiveSelections, accepted.length);

  const chooseFocusCandidate = (candidate: FocusCandidate) => {
    setSelectedFocusId(candidate.id);
    setStage(candidate.selection.stage);
    setSelections([candidate.selection]);
    setTraits(candidate.suggestedTraits.slice(0, 2));
    setGenerated([]);
    setAccepted([]);
    setDraft(null);
    setError(null);
  };

  const toggleSelection = (selection: TeamMemoryInterviewSelection) => {
    setSelections((current) => (
      current.some((item) => item.id === selection.id)
        ? current.filter((item) => item.id !== selection.id)
        : [...current, selection]
    ));
    setDraft(null);
  };

  const toggleTrait = (trait: string) => {
    setTraits((current) => (
      current.includes(trait)
        ? current.filter((item) => item !== trait)
        : [...current, trait]
    ));
    setDraft(null);
  };

  const runOptionGeneration = async () => {
    if (!canGenerate) {
      setError('Select a context card or trait first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await generateTeamMemoryOptions(teamId, {
        stage: activeStage,
        selections: effectiveSelections,
        traits,
        accepted_options: accepted,
        note: buildSystemAwareNote(selectedRole, note),
      });
      setGenerated((current) => mergeOptions(current.filter((option) => option.stage !== activeStage), response.options));
      setWarnings(response.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate team-memory options.');
    } finally {
      setBusy(false);
    }
  };

  const acceptOption = (option: TeamMemoryGeneratedOption) => {
    setAccepted((current) => mergeOptions(current, [option]));
    setDraft(null);
  };

  const dismissOption = (optionId: string) => {
    setGenerated((current) => current.filter((option) => option.id !== optionId));
    setAccepted((current) => current.filter((option) => option.id !== optionId));
    setDraft(null);
  };

  const updateAcceptedOption = (optionId: string, patch: Partial<TeamMemoryGeneratedOption>) => {
    setAccepted((current) => current.map((option) => (
      option.id === optionId ? { ...option, ...patch } : option
    )));
    setDraft(null);
  };

  const generateDraft = async () => {
    const intakeText = buildStructuredIntake(teamName, selectedRole, effectiveSelections, traits, accepted, note);
    if (intakeText.length < 40) {
      setError('Select at least one context card before drafting memory.');
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const response = await intakeTeamMemory(teamId, intakeText);
      setDraft(response.profile);
      setWarnings(response.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate memory draft.');
    } finally {
      setDrafting(false);
    }
  };

  const save = async () => {
    if (!activeProfile) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateTeamMemory(teamId, activeProfile);
      setDraft(null);
      setAccepted([]);
      setGenerated([]);
      onProfileSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save team memory.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await deleteTeamMemory(teamId);
      setDraft(null);
      setAccepted([]);
      setGenerated([]);
      onProfileSaved(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not clear team memory.');
    } finally {
      setSaving(false);
    }
  };

  const updateCard = (cardId: string, patch: Partial<TeamMemoryCard>) => {
    const base = draft ?? profile;
    if (!base) return;
    setDraft({
      ...base,
      status: 'draft',
      cards: base.cards.map((card) => (
        card.id === cardId
          ? { ...card, ...patch, source_type: card.source_type === 'system_placeholder' ? card.source_type : 'edited_by_user' }
          : card
      )),
    });
  };

  return (
    <div style={questionnaireCanvasStyle}>
      <div style={questionnaireInnerStyle}>
        <h1 style={questionnaireTitleStyle}>Tell Gambit About Your Team</h1>
        <div style={questionnaireSubtitleStyle}>
          Gambit read {systemSources.filter((source) => source.active).map((source) => source.label).join(' · ')}. Answer in a few clicks; text is optional.
        </div>

        <section style={analystReadStyle}>
          <div style={phaseLabelStyle}>Phase 1 · Gambit's read</div>
          <h2 style={analystHeadlineStyle}>
            Gambit read the War Room. The highest-leverage private memory is probably{' '}
            {selectedFocus?.headline ?? 'a room belief public data cannot explain'}.
          </h2>
          <div style={analystRationaleStyle}>
            {selectedFocus?.rationale ?? 'The app has enough public context to make a plausible recommendation; private context should target what could actually change the call.'}
          </div>
          <div style={whyAskingStyle}>
            Why I'm asking: {selectedFocus?.whyAsking ?? 'This is where Michael can teach Gambit something Intel cannot infer from public evidence.'}
          </div>
        </section>

        <QuestionSection
          title="Confirm the focus"
          subtitle="Start with the recommended signal, or redirect Gambit before it generates anything."
        >
          <div style={miniPromptStyle}>Optimize the interview for</div>
          <div style={pillRowStyle}>
            {ROLE_LENSES.map((role) => (
              <button
                key={role.id}
                type="button"
                onClick={() => {
                  setRoleLens(role.id);
                  setDraft(null);
                }}
                style={choicePillStyle(roleLens === role.id)}
              >
                {role.label}
              </button>
            ))}
            <input
              value={roleOther}
              onChange={(event) => {
                setRoleLens('other');
                setRoleOther(event.target.value);
                setDraft(null);
              }}
              onFocus={() => setRoleLens('other')}
              placeholder="Other..."
              style={otherInputStyle(roleLens === 'other')}
            />
          </div>

          <div style={miniPromptStyle}>Prioritized War Room signals</div>
          <div style={focusGridStyle}>
            {focusCandidates.slice(0, 5).map((candidate, index) => (
              <FocusChoicePill
                key={candidate.id}
                candidate={candidate}
                selected={candidate.id === selectedFocus?.id}
                recommended={index === 0}
                onSelect={() => chooseFocusCandidate(candidate)}
              />
            ))}
          </div>

          {lowPriorityReferences.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowMoreReferences((open) => !open)}
                style={referenceRevealStyle(showMoreReferences)}
              >
                {showMoreReferences ? 'Hide lower-priority @ references' : 'Show more @ references'}
              </button>
              {showMoreReferences && (
                <div style={pillRowStyle}>
                  {lowPriorityReferences.map((selection) => (
                    <ReferenceChoicePill
                      key={selection.id}
                      selection={selection}
                      selected={selectedIds.has(selection.id)}
                      onToggle={() => {
                        const candidate = focusCandidates.find((item) => item.selection.id === selection.id);
                        if (candidate) {
                          chooseFocusCandidate(candidate);
                          return;
                        }
                        toggleSelection(selection);
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </QuestionSection>

        <QuestionSection title="Teach Gambit what public data misses">
          <AnalystPromptBlock
            prompt={selectedFocus?.prompt ?? fallbackAnalystPrompt()}
            whyAsking={selectedFocus?.whyAsking ?? 'The useful memory is the caveat Michael would want attached before acting on the public model.'}
          />
          <div style={pillRowStyle}>
            {smartTraitOptions.map((trait) => (
              <button
                key={trait}
                type="button"
                onClick={() => toggleTrait(trait)}
                style={choicePillStyle(traits.includes(trait))}
              >
                {trait}
              </button>
            ))}
            <button type="button" onClick={() => setNoteOpen((open) => !open)} style={choicePillStyle(noteOpen)}>
              Other...
            </button>
          </div>
          {noteOpen && (
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add one sentence of nuance..."
              style={noteStyle}
            />
          )}
        </QuestionSection>

        <QuestionSection
          title="Keep or reject memory"
          subtitle="Generate hypotheses from this focus, keep only the ones Michael would stand behind, then save the reviewed memory."
        >
          <div style={pillRowStyle}>
            <button type="button" onClick={runOptionGeneration} disabled={busy || !canGenerate} style={actionPillStyle(!busy && canGenerate)}>
              {busy ? 'Generating options...' : 'Generate decision-changing options'}
            </button>
            <button type="button" onClick={generateDraft} disabled={drafting || !canDraft} style={actionPillStyle(!drafting && canDraft)}>
              {drafting ? 'Drafting memory...' : draft ? 'Refresh memory draft' : 'Generate memory draft'}
            </button>
            <button type="button" onClick={() => setFullAssessmentOpen((open) => !open)} style={choicePillStyle(fullAssessmentOpen)}>
              Continue full team assessment
            </button>
          </div>
          {fullAssessmentOpen && (
            <div style={assessmentTextStyle}>
              Org decision context, owner risk posture, staff workflows, WNBA/shared-org needs, and security boundaries.
            </div>
          )}
        </QuestionSection>

        {error && <div style={errorStyle}>{error}</div>}
        {warnings.length > 0 && (
          <div style={warningStyle}>
            {warnings.slice(0, 3).map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        )}

        {(generatedOpen.length > 0 || accepted.length > 0) && (
          <QuestionSection
            title="Which memories should Gambit keep?"
            subtitle={`${accepted.length} accepted hypotheses`}
          >
            <div style={generatedChoiceGridStyle}>
              {generatedOpen.map((option) => (
                <GeneratedOptionCard
                  key={option.id}
                  option={option}
                  onAccept={() => acceptOption(option)}
                  onDismiss={() => dismissOption(option.id)}
                />
              ))}
              {accepted.map((option) => (
                <AcceptedOptionCard
                  key={option.id}
                  option={option}
                  onChange={(patch) => updateAcceptedOption(option.id, patch)}
                  onDismiss={() => dismissOption(option.id)}
                />
              ))}
            </div>
          </QuestionSection>
        )}

        {activeProfile && (
          <section style={artifactReviewStyle}>
            <div style={artifactReviewHeaderStyle}>
              <div>
                <h2 style={reviewTitleStyle}>Review private team memory</h2>
                <div style={subtleStyle}>
                  {teamName} · {savedCardCount > 0 ? `Active · ${savedCardCount} cards` : draft ? 'Draft ready' : `${accepted.length} accepted hypotheses`}
                </div>
              </div>
              <div style={artifactActionsStyle}>
                <button type="button" onClick={generateDraft} disabled={drafting || !canDraft} style={actionPillStyle(!drafting && canDraft)}>
                  {drafting ? 'Drafting...' : draft ? 'Refresh draft' : 'Generate memory draft'}
                </button>
                <button type="button" onClick={save} disabled={saving} style={actionPillStyle(!saving)}>
                  {saving ? 'Saving...' : draft ? 'Save reviewed memory' : 'Save'}
                </button>
                <button type="button" onClick={onRunMemoryBrief} disabled={savedCardCount === 0 || startingBrief} style={choicePillStyle(false)}>
                  {startingBrief ? 'Starting...' : 'Run brief'}
                </button>
                <button type="button" onClick={remove} disabled={!profile || saving} style={dangerPillStyle}>Clear</button>
              </div>
            </div>
            <div style={cardsStyle}>
              <div style={summaryStyle}>{activeProfile.summary}</div>
              {activeProfile.cards.map((card) => (
                <MemoryCardEditor key={card.id} card={card} onChange={(patch) => updateCard(card.id, patch)} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function QuestionSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={questionSectionStyle}>
      <h2 style={questionTitleStyle}>{title}</h2>
      {subtitle && <div style={questionSubtitleStyle}>{subtitle}</div>}
      {children}
    </section>
  );
}

function ReferenceChoicePill({
  selection,
  selected,
  onToggle,
}: {
  selection: TeamMemoryInterviewSelection;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} title={selection.detail} style={choicePillStyle(selected)}>
      @{selection.label}
    </button>
  );
}

function AnalystPromptBlock({
  prompt,
  whyAsking,
}: {
  prompt: AnalystPrompt;
  whyAsking: string;
}) {
  return (
    <div style={analystPromptStyle}>
      <div style={promptEyebrowStyle}>Analyst prompt</div>
      <h3 style={promptHeadingStyle}>{prompt.heading}</h3>
      <div style={promptBasisStyle}>
        <div style={promptLabelStyle}>Intel basis</div>
        <ul style={promptListStyle}>
          {prompt.basis.slice(0, 6).map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      <div style={promptAskStyle}>
        <span style={promptLabelStyle}>What Gambit needs from Michael</span>
        <span>{prompt.ask}</span>
      </div>
      <div style={promptWhyStyle}>Why I'm asking: {whyAsking}</div>
    </div>
  );
}

function FocusChoicePill({
  candidate,
  selected,
  recommended,
  onSelect,
}: {
  candidate: FocusCandidate;
  selected: boolean;
  recommended: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} title={candidate.rationale} style={focusPillStyle(selected)}>
      <span style={focusPillTopStyle}>
        <span style={kindBadgeStyle(candidate.selection.stage)}>{stageLabel(candidate.selection.stage)}</span>
        {recommended && <span style={focusBadgeStyle}>Recommended</span>}
      </span>
      <span style={focusTitleStyle}>{candidate.selection.label}</span>
      <span style={focusMetaStyle}>{candidate.sourceLabel} · {stagePrompt(candidate.selection.stage)}</span>
      <span style={focusRationaleStyle}>{candidate.whyAsking}</span>
    </button>
  );
}

function GeneratedOptionCard({
  option,
  onAccept,
  onDismiss,
}: {
  option: TeamMemoryGeneratedOption;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <article style={generatedCardStyle}>
      <div style={cardTopStyle}>
        <span style={kindBadgeStyle(option.stage)}>{stageLabel(option.stage)}</span>
        <span style={confidenceStyle}>{option.confidence}</span>
      </div>
      <div style={generatedTitleStyle}>{option.title}</div>
      <div style={bodyStyle}>{option.body}</div>
      {option.measurable_proxies.length > 0 && (
        <div style={proxyRowStyle}>
          {option.measurable_proxies.slice(0, 4).map((proxy) => <span key={proxy} style={proxyChipStyle}>{proxy}</span>)}
        </div>
      )}
      <div style={smallCaveatStyle}>{option.caveat}</div>
      <div style={buttonRowStyle}>
        <button type="button" onClick={onDismiss} style={secondaryButtonStyle}>Dismiss</button>
        <button type="button" onClick={onAccept} style={primaryButtonStyle}>Accept</button>
      </div>
    </article>
  );
}

function AcceptedOptionCard({
  option,
  onChange,
  onDismiss,
}: {
  option: TeamMemoryGeneratedOption;
  onChange: (patch: Partial<TeamMemoryGeneratedOption>) => void;
  onDismiss: () => void;
}) {
  return (
    <article style={cardStyle}>
      <div style={cardTopStyle}>
        <span style={kindBadgeStyle(option.stage)}>{stageLabel(option.stage)}</span>
        <select
          value={option.confidence}
          onChange={(event) => onChange({ confidence: event.target.value as ContextGraphConfidence })}
          style={selectStyle}
        >
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      </div>
      <input
        value={option.title}
        onChange={(event) => onChange({ title: event.target.value })}
        style={cardTitleInputStyle}
      />
      <textarea
        value={option.body}
        onChange={(event) => onChange({ body: event.target.value })}
        style={cardBodyInputStyle}
      />
      <textarea
        value={option.caveat}
        onChange={(event) => onChange({ caveat: event.target.value })}
        style={evidenceInputStyle}
      />
      <div style={buttonRowStyle}>
        <button type="button" onClick={onDismiss} style={dangerButtonStyle}>Dismiss</button>
      </div>
    </article>
  );
}

function MemoryCardEditor({
  card,
  onChange,
}: {
  card: TeamMemoryCard;
  onChange: (patch: Partial<TeamMemoryCard>) => void;
}) {
  const readOnly = card.kind === 'full_assessment_placeholder';
  return (
    <article style={readOnly ? placeholderCardStyle : cardStyle}>
      <div style={cardTopStyle}>
        <span style={memoryKindBadgeStyle(card.kind)}>{labelForKind(card.kind)}</span>
        <select
          value={card.confidence}
          disabled={readOnly}
          onChange={(event) => onChange({ confidence: event.target.value })}
          style={selectStyle}
        >
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      </div>
      <input
        value={card.title}
        disabled={readOnly}
        onChange={(event) => onChange({ title: event.target.value })}
        style={cardTitleInputStyle}
      />
      <textarea
        value={card.body}
        disabled={readOnly}
        onChange={(event) => onChange({ body: event.target.value })}
        style={cardBodyInputStyle}
      />
      {card.evidence_snippet && (
        <textarea
          value={card.evidence_snippet}
          disabled={readOnly}
          onChange={(event) => onChange({ evidence_snippet: event.target.value })}
          style={evidenceInputStyle}
        />
      )}
      {card.measurable_proxies.length > 0 && (
        <div style={proxyRowStyle}>
          {card.measurable_proxies.slice(0, 4).map((proxy) => <span key={proxy} style={proxyChipStyle}>{proxy}</span>)}
        </div>
      )}
    </article>
  );
}

function buildFocusCandidates(
  warRoom: ContextGraphWarRoomResponse,
  profile: TeamMemoryProfile | null,
): FocusCandidate[] {
  const candidates: FocusCandidate[] = [];
  const context = buildInterviewContext(warRoom);

  warRoom.strategic_tensions.forEach((tension, index) => {
    const detail = compactText([tension.signal, tension.why_it_matters]);
    const selection: TeamMemoryInterviewSelection = {
      id: `belief-${index}`,
      stage: 'room_belief',
      label: tension.title,
      detail,
      source: 'war_room',
      player_names: [],
      tags: [tension.severity, 'room belief'],
    };
    candidates.push({
      id: `focus-belief-${index}`,
      selection,
      score: severityScore(tension.severity) + 36 - index * 2,
      headline: tension.title,
      rationale: detail,
      whyAsking: compactText([
        `The War Room has ${context.posturePhrase}, ${context.riskPhrase} risk, and ${context.topCallsPhrase}.`,
        tension.winger_question || 'Name the private trigger before the public model over-commits.',
      ]),
      prompt: buildTensionPrompt(tension, context),
      suggestedTraits: uniqueStrings([
        ...traitsForText(detail),
        ...tensionTraits(tension, context),
      ]),
      sourceLabel: `Strategic tension · ${tension.severity} severity`,
    });
  });

  warRoom.roster_pressure.forEach((player, index) => {
    const detail = compactText([
      ...player.rationale,
      `${player.action} · ${player.movement_status}`,
      player.availability_status,
      player.contract_leverage,
    ]);
    const actionBoost = player.action === 'decision' ? 24 : player.action === 'market' ? 18 : player.action === 'protect' ? 12 : 5;
    const healthBoost = /injur|uncertain|question|long/i.test(player.availability_status) ? 18 : 0;
    const selection: TeamMemoryInterviewSelection = {
      id: `player-${player.player_id}`,
      stage: 'player',
      label: player.name,
      detail,
      source: 'war_room',
      player_names: [player.name],
      tags: [player.tier, player.action, player.trajectory].filter(Boolean),
    };
    candidates.push({
      id: `focus-player-${player.player_id}`,
      selection,
      score: player.pressure_score + actionBoost + healthBoost - index,
      headline: `${player.name}'s hidden context`,
      rationale: detail,
      whyAsking: compactText([
        `${player.name} is a ${player.tier} row with pressure ${player.pressure_score}, action "${player.action}", availability "${player.availability_status}", and leverage "${player.contract_leverage}".`,
        'Gambit needs the one private variable that would move this from public pressure to an executive call.',
      ]),
      prompt: buildPlayerPrompt(player, context),
      suggestedTraits: uniqueStrings([
        ...traitsForText(detail),
        ...playerTraits(player),
      ]),
      sourceLabel: `Roster pressure · ${player.action}`,
    });
  });

  warRoom.executive_summary.decision_cards.forEach((card, index) => {
    const detail = compactText([card.signal, card.recommendation, card.action]);
    const selection: TeamMemoryInterviewSelection = {
      id: `decision-${index}`,
      stage: 'decision',
      label: card.title,
      detail,
      source: 'war_room',
      player_names: [],
      tags: [card.severity, 'decision'],
    };
    candidates.push({
      id: `focus-decision-${index}`,
      selection,
      score: severityScore(card.severity) + 22 - index,
      headline: card.title,
      rationale: detail,
      whyAsking: compactText([
        `This card is using signal "${card.signal}" and recommendation "${card.recommendation}".`,
        card.action || 'Gambit needs the private exception before it treats the card as settled.',
      ]),
      prompt: buildDecisionPrompt(card, context),
      suggestedTraits: uniqueStrings([
        ...traitsForText(detail),
        ...decisionTraits(card, context),
      ]),
      sourceLabel: `Board brief · ${card.severity} severity`,
    });
  });

  buildPairSeeds(warRoom).forEach((selection, index) => {
    candidates.push({
      id: `focus-${selection.id}`,
      selection,
      score: 62 - index * 2,
      headline: `${selection.label} fit context`,
      rationale: selection.detail,
      whyAsking: `${selection.label} came from paired roster-pressure rows. The public graph can see contract and action pressure; it cannot see who actually unlocks whom on the floor.`,
      prompt: buildPairingPrompt(selection, warRoom),
      suggestedTraits: uniqueStrings([
        ...traitsForText(selection.detail),
        'spacing fit',
        'screening angle',
        'defensive talk',
        'entry-pass trust',
        'development priority',
        'coach preference',
      ]),
      sourceLabel: 'Pairing seed',
    });
  });

  (profile?.cards ?? [])
    .filter((card) => card.kind !== 'full_assessment_placeholder')
    .forEach((card, index) => {
      const selection: TeamMemoryInterviewSelection = {
        id: `memory-${card.id}`,
        stage: stageForMemoryCard(card),
        label: card.title,
        detail: card.body,
        source: 'saved_memory',
        player_names: card.player_names,
        tags: card.tags,
      };
      candidates.push({
        id: `focus-memory-${card.id}`,
        selection,
        score: 72 - index,
        headline: `${card.title} refresh`,
        rationale: card.body,
        whyAsking: 'Saved private memory should stay active only if it still changes a live recommendation or caveat.',
        prompt: buildSavedMemoryPrompt(card),
        suggestedTraits: uniqueStrings([...card.tags, ...traitsForText(card.body), 'still decision-changing', 'confidence changed', 'now stale']),
        sourceLabel: 'Saved private memory',
      });
    });

  if (candidates.length === 0) {
    const label = warRoom.executive_summary.headline || `${warRoom.subject.name} roster belief`;
    const detail = warRoom.executive_summary.recommended_posture || 'Use private context to identify the caveat that would change the board brief.';
    candidates.push({
      id: 'focus-fallback-room-belief',
      selection: {
        id: 'fallback-room-belief',
        stage: 'room_belief',
        label,
        detail,
        source: 'war_room',
        player_names: [],
        tags: ['room belief'],
      },
      score: 1,
      headline: label,
      rationale: detail,
      whyAsking: `The first memory should attach the strongest private caveat to ${context.posturePhrase}.`,
      prompt: {
        heading: `What caveat would change the next ${warRoom.subject.name} brief?`,
        basis: [
          `Headline: ${label}`,
          `Recommended posture: ${detail}`,
          `War Room posture: ${context.posturePhrase}; ${context.riskPhrase}; ${context.spendPhrase}`,
          `Call lane: ${context.topCallsPhrase}`,
        ],
        ask: 'Pick the private caveat that would most change the board brief: owner pressure, health risk, staff disagreement, protected-asset line, or market reality.',
      },
      suggestedTraits: ['owner pressure', 'health risk', 'staff disagreement', 'protected asset line', 'market reality'],
      sourceLabel: 'War Room summary',
    });
  }

  return dedupeFocusCandidates(candidates)
    .sort((left, right) => right.score - left.score)
    .slice(0, 14);
}

function buildInterviewContext(warRoom: ContextGraphWarRoomResponse) {
  const posture = readableValue(warRoom.subject.preferences.strategic_posture.timeframe);
  const risk = readableValue(warRoom.subject.preferences.cultural_signals.risk_tolerance.value);
  const spend = readableValue(warRoom.subject.preferences.ownership.spending_posture);
  const topCalls = warRoom.executive_summary.top_calls.slice(0, 3);
  const triggerEvents = warRoom.subject.preferences.strategic_posture.trigger_events.slice(0, 3);
  const protectedCore = warRoom.roster_pressure
    .filter((player) => player.action === 'protect')
    .slice(0, 4)
    .map((player) => player.name);
  return {
    posturePhrase: `${posture || 'unsettled'} posture`,
    riskPhrase: `${risk || 'unknown'} risk tolerance`,
    spendPhrase: `${spend || 'unknown'} spending posture`,
    topCallsPhrase: topCalls.length > 0
      ? `first-wave calls to ${topCalls.map((call) => `${call.team_id} (${call.tier})`).join(', ')}`
      : 'no high-confidence first-wave call lane',
    topCallDetails: topCalls.map((call) => `${call.team_id}: ${call.opening_question}`),
    triggerEventsPhrase: triggerEvents.length > 0 ? triggerEvents.join('; ') : 'no explicit trigger events encoded',
    protectedCorePhrase: protectedCore.length > 0
      ? `protected-core line around ${protectedCore.join(', ')}`
      : 'no explicit protected-core line',
  };
}

function buildTensionPrompt(
  tension: ContextGraphWarRoomResponse['strategic_tensions'][number],
  context: ReturnType<typeof buildInterviewContext>,
): AnalystPrompt {
  return {
    heading: `What private trigger changes "${tension.title}"?`,
    basis: [
      `Exact tension signal: ${tension.signal}`,
      `Why it matters in the graph: ${tension.why_it_matters}`,
      `War Room posture: ${context.posturePhrase}; ${context.riskPhrase}; ${context.spendPhrase}`,
      `Encoded trigger events: ${context.triggerEventsPhrase}`,
      `Call-sheet lane: ${context.topCallsPhrase}`,
      `Current front-office question: ${tension.winger_question}`,
    ],
    ask: 'Tell Gambit which room-only threshold is real before this becomes a recommendation: health clearance, owner appetite, staff conviction, market price, or the protected-core timeline.',
  };
}

function buildPlayerPrompt(
  player: ContextGraphWarRoomResponse['roster_pressure'][number],
  context: ReturnType<typeof buildInterviewContext>,
): AnalystPrompt {
  return {
    heading: `What would move ${player.name} from "${player.action}" to a different call?`,
    basis: [
      `Pressure row: score ${player.pressure_score}, tier ${player.tier}, trajectory ${player.trajectory}`,
      `Public action: ${player.action}; movement status: ${player.movement_status}`,
      `Availability: ${player.availability_status}; years remaining: ${player.years_remaining ?? 'unknown'}`,
      `Contract leverage: ${player.contract_leverage}`,
      `Current rationale: ${player.rationale.join(' ')}`,
      `Team context: ${context.protectedCorePhrase}; ${context.triggerEventsPhrase}`,
    ],
    ask: `Give Gambit the private read on ${player.name} that public data will not catch: internal medical confidence, coach trust in the role, fit with the protected young core, locker-room value, or the real trade price.`,
  };
}

function buildDecisionPrompt(
  card: ContextGraphWarRoomResponse['executive_summary']['decision_cards'][number],
  context: ReturnType<typeof buildInterviewContext>,
): AnalystPrompt {
  return {
    heading: `What would make "${card.title}" wrong or incomplete?`,
    basis: [
      `Decision-card severity: ${card.severity}`,
      `Signal used by the board brief: ${card.signal}`,
      `Current recommendation: ${card.recommendation}`,
      `Action Gambit would otherwise take: ${card.action}`,
      `Call-sheet context: ${context.topCallsPhrase}`,
      `First call questions: ${context.topCallDetails.join(' / ') || 'none encoded'}`,
    ],
    ask: 'Name the private exception before Gambit treats this card as settled: price threshold, health trigger, owner-risk constraint, protected-asset line, or whether counterparties are actually serious.',
  };
}

function buildPairingPrompt(
  selection: TeamMemoryInterviewSelection,
  warRoom: ContextGraphWarRoomResponse,
): AnalystPrompt {
  const pressureRows = selection.player_names
    .map((name) => warRoom.roster_pressure.find((player) => player.name === name))
    .filter((player): player is ContextGraphWarRoomResponse['roster_pressure'][number] => Boolean(player));
  return {
    heading: `What does the room know about ${selection.label} that the graph cannot see?`,
    basis: [
      `Pairing seed: ${selection.detail}`,
      ...pressureRows.map((player) => `${player.name}: ${player.action}, pressure ${player.pressure_score}, ${player.availability_status}, ${player.contract_leverage}`),
      `Current tags: ${selection.tags.join(', ') || 'none'}`,
    ],
    ask: 'Teach Gambit the film-room or practice-room mechanism: spacing, screening angle, defensive talk, entry-pass trust, role conflict, developmental priority, or a coach preference that numbers will lag.',
  };
}

function buildSavedMemoryPrompt(card: TeamMemoryCard): AnalystPrompt {
  return {
    heading: `Should Gambit keep "${card.title}" active?`,
    basis: [
      `Saved memory kind: ${labelForKind(card.kind)}`,
      `Saved body: ${card.body}`,
      `Confidence: ${card.confidence}`,
      `Players: ${card.player_names.join(', ') || 'none'}`,
      `Tags: ${card.tags.join(', ') || 'none'}`,
      `Measurable proxies: ${card.measurable_proxies.join('; ') || 'none'}`,
    ],
    ask: 'Decide whether this memory still changes a recommendation: keep it, narrow it to a player or decision, lower confidence, or retire it as stale.',
  };
}

function fallbackAnalystPrompt(): AnalystPrompt {
  return {
    heading: 'What private context would change this recommendation?',
    basis: ['No selected focus is active yet.'],
    ask: 'Pick a War Room signal first, then teach Gambit the private caveat public evidence cannot see.',
  };
}

function tensionTraits(
  tension: ContextGraphWarRoomResponse['strategic_tensions'][number],
  context: ReturnType<typeof buildInterviewContext>,
): string[] {
  const lower = `${tension.title} ${tension.signal} ${tension.why_it_matters}`.toLowerCase();
  const traits = [
    'private trigger already set',
    'staff split on trigger',
    'owner appetite changes threshold',
    context.protectedCorePhrase,
  ];
  if (/health|injur|option/.test(lower)) {
    traits.unshift('medical threshold is earlier than public');
    traits.push('recovery confidence is overstated');
  }
  if (/market|call|counterpart/.test(lower)) {
    traits.unshift('counterparty price is real');
    traits.push('market interest is performative');
  }
  if (/rebuild|accelerat|posture|timeline/.test(lower)) {
    traits.unshift('timeline patience is non-negotiable');
    traits.push('acceleration trigger is owner-driven');
  }
  return traits;
}

function playerTraits(player: ContextGraphWarRoomResponse['roster_pressure'][number]): string[] {
  const lower = compactText([player.availability_status, player.contract_leverage, player.movement_status, player.trajectory, ...player.rationale]).toLowerCase();
  const traits = [
    'coach trust exceeds model',
    'role fit with young core',
    'market would pay more',
    'market would pay less',
    'locker-room value changes price',
  ];
  if (/injur|health|long|question/.test(lower)) traits.unshift('internal medical confidence');
  if (/contract|salary|years|leverage|option/.test(lower)) traits.push('contract leverage is misunderstood');
  if (/protect|untouchable|core/.test(lower)) traits.push('protected asset line');
  if (/declin|age|veteran/.test(lower)) traits.push('decline risk is sharper internally');
  return traits;
}

function decisionTraits(
  card: ContextGraphWarRoomResponse['executive_summary']['decision_cards'][number],
  context: ReturnType<typeof buildInterviewContext>,
): string[] {
  const lower = `${card.title} ${card.signal} ${card.recommendation} ${card.action}`.toLowerCase();
  const traits = [
    'price threshold',
    'protected asset line',
    'counterparty seriousness',
    context.spendPhrase,
    context.riskPhrase,
  ];
  if (/health|injur|recover/.test(lower)) traits.unshift('health trigger');
  if (/posture|rebuild|accelerat|patient/.test(lower)) traits.unshift('posture trigger');
  if (/call|team|market|counterparty/.test(lower)) traits.unshift('market signal quality');
  return traits;
}

function buildSeedSelections(
  warRoom: ContextGraphWarRoomResponse,
  profile: TeamMemoryProfile | null,
): TeamMemoryInterviewSelection[] {
  const playerSeeds = warRoom.roster_pressure.slice(0, 8).map((player) => ({
    id: `player-${player.player_id}`,
    stage: 'player' as const,
    label: player.name,
    detail: [...player.rationale, `${player.action} · ${player.movement_status}`].filter(Boolean).join(' '),
    source: 'war_room' as const,
    player_names: [player.name],
    tags: [player.tier, player.action, player.trajectory].filter(Boolean),
  }));
  const decisionSeeds = warRoom.executive_summary.decision_cards.map((card, index) => ({
    id: `decision-${index}`,
    stage: 'decision' as const,
    label: card.title,
    detail: `${card.signal} ${card.recommendation} ${card.action}`,
    source: 'war_room' as const,
    player_names: [],
    tags: [card.severity, 'decision'],
  }));
  const beliefSeeds = warRoom.strategic_tensions.map((tension, index) => ({
    id: `belief-${index}`,
    stage: 'room_belief' as const,
    label: tension.title,
    detail: `${tension.signal} ${tension.why_it_matters}`,
    source: 'war_room' as const,
    player_names: [],
    tags: [tension.severity, 'room belief'],
  }));
  const pairSeeds = buildPairSeeds(warRoom);
  const memorySeeds = (profile?.cards ?? [])
    .filter((card) => card.kind !== 'full_assessment_placeholder')
    .map((card) => ({
      id: `memory-${card.id}`,
      stage: stageForMemoryCard(card),
      label: card.title,
      detail: card.body,
      source: 'saved_memory' as const,
      player_names: card.player_names,
      tags: card.tags,
    }));
  return [...memorySeeds, ...playerSeeds, ...pairSeeds, ...decisionSeeds, ...beliefSeeds];
}

function buildPairSeeds(warRoom: ContextGraphWarRoomResponse): TeamMemoryInterviewSelection[] {
  const pressure = warRoom.roster_pressure.slice(0, 4);
  const pairs: TeamMemoryInterviewSelection[] = [];
  for (let index = 0; index < pressure.length - 1; index += 2) {
    const first = pressure[index];
    const second = pressure[index + 1];
    pairs.push({
      id: `pair-${first.player_id}-${second.player_id}`,
      stage: 'pairing',
      label: `${first.name} + ${second.name}`,
      detail: `Test whether ${first.action}/${second.action} pressure creates a lineup or role-fit question public data does not fully explain.`,
      source: 'war_room',
      player_names: [first.name, second.name],
      tags: ['pairing', first.action, second.action],
    });
  }
  return pairs;
}

function buildStructuredIntake(
  teamName: string,
  roleLens: RoleLens,
  selections: TeamMemoryInterviewSelection[],
  traits: string[],
  accepted: TeamMemoryGeneratedOption[],
  note: string,
): string {
  const lines = [
    `Selection-first private team-memory review for ${teamName}.`,
    `Role lens: ${roleLens.label} (${roleLens.detail}).`,
    traits.length > 0 ? `Selected traits: ${traits.join(', ')}.` : '',
    selections.length > 0
      ? `Selected context:\n${selections.map((selection) => `- ${stageLabel(selection.stage)}: ${selection.label}. ${selection.detail}`).join('\n')}`
      : '',
    accepted.length > 0
      ? `Accepted private hypotheses:\n${accepted.map((option) => [
        `- ${stageLabel(option.stage)}: ${option.title}`,
        `  Memory: ${option.body}`,
        `  Confidence: ${option.confidence}`,
        option.player_names.length ? `  Players: ${option.player_names.join(', ')}` : '',
        option.tags.length ? `  Tags: ${option.tags.join(', ')}` : '',
        option.measurable_proxies.length ? `  Measurable proxies: ${option.measurable_proxies.join('; ')}` : '',
        option.caveat ? `  Caveat: ${option.caveat}` : '',
      ].filter(Boolean).join('\n')).join('\n')}`
      : '',
    note.trim() ? `Optional user note: ${note.trim()}` : '',
  ].filter(Boolean);
  return lines.join('\n\n');
}

function buildSystemAwareNote(roleLens: RoleLens, note: string): string {
  return [
    `Role lens: ${roleLens.label} (${roleLens.detail}).`,
    note.trim() ? `Optional note: ${note.trim()}` : '',
  ].filter(Boolean).join('\n');
}

function buildSystemSources(
  warRoom: ContextGraphWarRoomResponse,
  profile: TeamMemoryProfile | null,
  selections: TeamMemoryInterviewSelection[],
  acceptedCount: number,
): Array<{ label: string; meta: string; active: boolean }> {
  return [
    {
      label: 'Intel',
      meta: `${warRoom.graph.nodes.length} teams`,
      active: true,
    },
    {
      label: 'Roster pressure',
      meta: `${warRoom.roster_pressure.length} players`,
      active: warRoom.roster_pressure.length > 0,
    },
    {
      label: 'Board brief',
      meta: `${warRoom.executive_summary.decision_cards.length} calls`,
      active: warRoom.executive_summary.decision_cards.length > 0,
    },
    {
      label: 'Private memory',
      meta: profile ? `${profile.cards.filter((card) => card.kind !== 'full_assessment_placeholder').length} saved` : `${acceptedCount} draft`,
      active: Boolean(profile) || acceptedCount > 0,
    },
    {
      label: '@ references',
      meta: `${selections.length} selected`,
      active: selections.length > 0,
    },
  ];
}

function buildSmartTraitOptions(candidate: FocusCandidate | null): string[] {
  return uniqueStrings([
    ...(candidate?.suggestedTraits ?? []),
    ...FALLBACK_TRAITS,
  ]).slice(0, 10);
}

function dedupeFocusCandidates(candidates: FocusCandidate[]): FocusCandidate[] {
  const bySelection = new Map<string, FocusCandidate>();
  for (const candidate of candidates) {
    const existing = bySelection.get(candidate.selection.id);
    if (!existing || candidate.score > existing.score) {
      bySelection.set(candidate.selection.id, candidate);
    }
  }
  return [...bySelection.values()];
}

function traitsForText(text: string): string[] {
  const lower = text.toLowerCase();
  const traits: string[] = [];
  if (/injur|health|available|return|durab|recover|missed/.test(lower)) traits.push('health uncertainty');
  if (/coach|rotation|lineup|role|starter|bench|minutes|fit/.test(lower)) traits.push('role fit', 'coach trust');
  if (/leader|veteran|locker|glue|culture|talk|tough/.test(lower)) traits.push('leadership', 'locker room gravity');
  if (/screen|seal|entry|handler|pair|two-man|combination/.test(lower)) traits.push('screening', 'entry-pass trust');
  if (/defen|switch|rim|protect|talk/.test(lower)) traits.push('defensive talk');
  if (/model|metric|data|public|stat|valuation/.test(lower)) traits.push('model disagreement');
  if (/market|trade|contract|cap|salary|buyer|seller|free agent|extension/.test(lower)) traits.push('market value gap', 'decision urgency');
  if (/young|core|develop|upside|rookie|timeline/.test(lower)) traits.push('development context');
  return uniqueStrings(traits);
}

function uniqueStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    values.push(trimmed);
  }
  return values;
}

function compactText(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' ');
}

function readableValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/_/g, ' ');
}

function severityScore(severity: 'high' | 'medium' | 'low'): number {
  if (severity === 'high') return 100;
  if (severity === 'medium') return 72;
  return 46;
}

function mergeOptions(current: TeamMemoryGeneratedOption[], incoming: TeamMemoryGeneratedOption[]): TeamMemoryGeneratedOption[] {
  const map = new Map(current.map((option) => [option.id, option]));
  for (const option of incoming) map.set(option.id, option);
  return [...map.values()];
}

function stageForMemoryCard(card: TeamMemoryCard): TeamMemoryInterviewStage {
  if (card.kind === 'pairing_context') return 'pairing';
  if (card.kind === 'roster_decision_context') return 'decision';
  if (card.kind === 'coach_gut_hypothesis') return 'room_belief';
  return 'player';
}

function stageLabel(stage: TeamMemoryInterviewStage): string {
  if (stage === 'room_belief') return 'Room belief';
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function stagePrompt(stage: TeamMemoryInterviewStage): string {
  return STAGES.find((item) => item.id === stage)?.prompt ?? stageLabel(stage);
}

function labelForKind(kind: TeamMemoryCard['kind']): string {
  if (kind === 'pairing_context') return 'Pairing';
  if (kind === 'coach_gut_hypothesis') return 'Coach gut';
  if (kind === 'roster_decision_context') return 'Roster';
  if (kind === 'full_assessment_placeholder') return 'Next';
  return 'Player';
}

function kindBadgeStyle(stage: TeamMemoryInterviewStage): React.CSSProperties {
  const color = stage === 'room_belief'
    ? F.amber
    : stage === 'pairing'
      ? F.positive
      : stage === 'decision'
        ? F.amber
        : F.fenway;
  const background = stage === 'room_belief'
    ? F.amberSoft
    : stage === 'pairing'
      ? F.positiveSoft
      : stage === 'decision'
        ? F.amberSoft
        : F.fenwaySoft;
  return badgeBaseStyle(color, background);
}

function memoryKindBadgeStyle(kind: TeamMemoryCard['kind']): React.CSSProperties {
  if (kind === 'full_assessment_placeholder') return badgeBaseStyle(F.fgMuted, F.cream50);
  if (kind === 'pairing_context') return badgeBaseStyle(F.positive, F.positiveSoft);
  if (kind === 'coach_gut_hypothesis') return badgeBaseStyle(F.amber, F.amberSoft);
  if (kind === 'roster_decision_context') return badgeBaseStyle(F.amber, F.amberSoft);
  return badgeBaseStyle(F.fenway, F.fenwaySoft);
}

function badgeBaseStyle(color: string, background: string): React.CSSProperties {
  return {
    border: `1px solid ${color}`,
    background,
    color,
    borderRadius: RADIUS.pill,
    padding: `2px ${SPACE.sm}px`,
    fontFamily: 'var(--font-mono)',
    fontSize: TYPE.meta.xs,
    textTransform: 'uppercase',
    letterSpacing: TRACKING.micro,
    fontWeight: 800,
  };
}

const analystReadStyle: React.CSSProperties = {
  borderBottom: `1px solid ${F.borderStrong}`,
  paddingBottom: SPACE.xl,
  marginBottom: SPACE['2xl'],
  maxWidth: 960,
};

const phaseLabelStyle: React.CSSProperties = {
  marginBottom: SPACE.sm,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 800,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const analystHeadlineStyle: React.CSSProperties = {
  margin: 0,
  color: F.ink,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 22,
  fontWeight: 500,
  lineHeight: 1.24,
  letterSpacing: TRACKING.body,
  maxWidth: 820,
};

const analystRationaleStyle: React.CSSProperties = {
  marginTop: SPACE.md,
  color: F.inkSoft,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.48,
  maxWidth: 820,
};

const whyAskingStyle: React.CSSProperties = {
  marginTop: SPACE.md,
  borderLeft: `3px solid ${F.fenway}`,
  paddingLeft: SPACE.sm,
  color: F.fg,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.meta.sm,
  fontWeight: 700,
  lineHeight: 1.45,
  maxWidth: 800,
};

const questionnaireCanvasStyle: React.CSSProperties = {
  background: F.paper,
  minHeight: '100%',
  padding: `${SPACE['2xl']}px ${SPACE['2xl']}px ${SPACE['3xl']}px`,
};

const questionnaireInnerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 1040,
  margin: '0 auto',
};

const questionnaireTitleStyle: React.CSSProperties = {
  margin: `0 0 ${SPACE.xl}px`,
  color: F.ink,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 28,
  fontWeight: 500,
  lineHeight: 1.14,
  letterSpacing: TRACKING.body,
};

const questionnaireSubtitleStyle: React.CSSProperties = {
  margin: `-${SPACE.md}px 0 ${SPACE['2xl']}px`,
  color: F.fgMuted,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.meta.sm,
  lineHeight: 1.5,
};

const questionSectionStyle: React.CSSProperties = {
  marginBottom: SPACE['2xl'],
};

const questionTitleStyle: React.CSSProperties = {
  margin: `0 0 ${SPACE.xs}px`,
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  fontSize: 16,
  fontWeight: 800,
  lineHeight: 1.3,
  letterSpacing: TRACKING.body,
  maxWidth: 920,
};

const questionSubtitleStyle: React.CSSProperties = {
  marginBottom: SPACE.md,
  color: F.fg,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.meta.sm,
  lineHeight: 1.45,
  maxWidth: 880,
};

const pillRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: `${SPACE.sm}px ${SPACE.xs}px`,
  maxWidth: 980,
};

const miniPromptStyle: React.CSSProperties = {
  margin: `${SPACE.md}px 0 ${SPACE.xs}px`,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 800,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const analystPromptStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  boxShadow: F.shadowSoft,
  display: 'grid',
  gap: SPACE.sm,
  fontFamily: 'var(--font-sans)',
  margin: `${SPACE.sm}px 0 ${SPACE.md}px`,
  maxWidth: 900,
  padding: SPACE.md,
};

const promptEyebrowStyle: React.CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 800,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const promptHeadingStyle: React.CSSProperties = {
  margin: 0,
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  fontWeight: 850,
  lineHeight: 1.28,
  maxWidth: 820,
};

const promptBasisStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.sm,
  background: F.cream50,
  display: 'grid',
  gap: SPACE.xs,
  padding: SPACE.sm,
};

const promptLabelStyle: React.CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 800,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const promptListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: SPACE.lg,
  color: F.inkSoft,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.meta.sm,
  lineHeight: 1.42,
  maxWidth: 820,
};

const promptAskStyle: React.CSSProperties = {
  borderLeft: `3px solid ${F.fenway}`,
  color: F.ink,
  display: 'grid',
  gap: 2,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 700,
  lineHeight: 1.42,
  maxWidth: 820,
  paddingLeft: SPACE.sm,
};

const promptWhyStyle: React.CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.meta.sm,
  lineHeight: 1.42,
  maxWidth: 820,
};

const focusGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: SPACE.sm,
  maxWidth: 1020,
};

function choicePillStyle(selected: boolean): React.CSSProperties {
  return {
    border: `1px solid ${selected ? F.fenway : F.borderStrong}`,
    background: selected ? F.fenwaySoft : F.surface,
    color: F.ink,
    borderRadius: RADIUS.pill,
    boxShadow: F.shadowSoft,
    padding: `6px ${SPACE.sm}px`,
    cursor: 'pointer',
    fontFamily: 'var(--font-sans)',
    fontSize: TYPE.meta.sm,
    fontWeight: 700,
    lineHeight: 1.2,
    minHeight: 32,
  };
}

function focusPillStyle(selected: boolean): React.CSSProperties {
  return {
    border: `1px solid ${selected ? F.fenway : F.borderStrong}`,
    background: selected ? F.fenwaySoft : F.surface,
    color: F.ink,
    borderRadius: RADIUS.md,
    boxShadow: selected ? F.shadow : F.shadowSoft,
    padding: SPACE.sm,
    cursor: 'pointer',
    display: 'grid',
    gap: SPACE.xs,
    minHeight: 116,
    textAlign: 'left',
    fontFamily: 'var(--font-sans)',
  };
}

const focusPillTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: SPACE.sm,
};

const focusBadgeStyle: React.CSSProperties = {
  border: `1px solid ${F.fenway}`,
  borderRadius: RADIUS.pill,
  background: F.surface,
  color: F.fenway,
  padding: `2px ${SPACE.sm}px`,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 800,
  letterSpacing: TRACKING.micro,
  textTransform: 'uppercase',
};

const focusTitleStyle: React.CSSProperties = {
  color: F.ink,
  fontSize: TYPE.body.sm,
  fontWeight: 800,
  lineHeight: 1.24,
};

const focusMetaStyle: React.CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.xs,
  fontWeight: 800,
};

const focusRationaleStyle: React.CSSProperties = {
  color: F.fg,
  fontSize: TYPE.meta.xs,
  lineHeight: 1.42,
};

function otherInputStyle(selected: boolean): React.CSSProperties {
  return {
    ...choicePillStyle(selected),
    color: selected ? F.ink : F.fgMuted,
    minWidth: 240,
    outlineColor: F.fenway,
  };
}

function referenceRevealStyle(selected: boolean): React.CSSProperties {
  return {
    ...choicePillStyle(selected),
    marginTop: SPACE.md,
    fontSize: TYPE.meta.sm,
    minHeight: 32,
  };
}

function actionPillStyle(enabled: boolean): React.CSSProperties {
  return {
    ...choicePillStyle(enabled),
    background: enabled ? F.surface : F.cream50,
    color: enabled ? F.ink : F.fgMuted,
    opacity: enabled ? 1 : 0.62,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}

const dangerPillStyle: React.CSSProperties = {
  ...choicePillStyle(false),
  color: F.red,
  borderColor: F.redSoft,
};

const assessmentTextStyle: React.CSSProperties = {
  marginTop: SPACE.md,
  color: F.fg,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.5,
  maxWidth: 720,
};

const generatedChoiceGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.md,
  maxWidth: 980,
};

const artifactReviewStyle: React.CSSProperties = {
  borderTop: `1px solid ${F.borderStrong}`,
  paddingTop: SPACE['2xl'],
  marginTop: SPACE['3xl'],
};

const artifactReviewHeaderStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: SPACE.lg,
  marginBottom: SPACE.lg,
};

const reviewTitleStyle: React.CSSProperties = {
  margin: 0,
  color: F.ink,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 21,
  fontWeight: 500,
  lineHeight: 1.12,
};

const noteStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 760,
  minHeight: 92,
  resize: 'vertical',
  boxSizing: 'border-box',
  border: `1px solid ${F.borderStrong}`,
  borderRadius: 24,
  background: F.surface,
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.5,
  padding: `${SPACE.md}px ${SPACE.lg}px`,
  marginTop: SPACE.md,
  outlineColor: F.fenway,
  boxShadow: F.shadowSoft,
};

const composerStyle: React.CSSProperties = {
  border: `1px solid ${F.borderStrong}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  padding: SPACE.sm,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: SPACE.sm,
  alignItems: 'center',
};

const composerTextStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.sm,
  background: F.cream50,
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  display: 'grid',
  gap: 2,
  minWidth: 0,
};

const composerCommandStyle: React.CSSProperties = {
  color: F.ink,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  fontWeight: 800,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const composerMetaStyle: React.CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
};

const generatedCardStyle: React.CSSProperties = {
  border: `1px solid ${F.borderStrong}`,
  borderRadius: 28,
  background: F.surface,
  boxShadow: F.shadow,
  padding: SPACE.lg,
  display: 'grid',
  gap: SPACE.sm,
};

const generatedTitleStyle: React.CSSProperties = {
  color: F.ink,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  fontWeight: 800,
  lineHeight: 1.22,
};

const primaryButtonStyle: React.CSSProperties = {
  border: `1px solid ${F.fenway}`,
  background: F.fenwaySoft,
  color: F.ink,
  borderRadius: RADIUS.pill,
  boxShadow: F.shadowSoft,
  padding: `${SPACE.sm}px ${SPACE.lg}px`,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 800,
};

const secondaryButtonStyle: React.CSSProperties = {
  border: `1px solid ${F.borderStrong}`,
  background: F.surface,
  color: F.ink,
  borderRadius: RADIUS.pill,
  boxShadow: F.shadowSoft,
  padding: `${SPACE.sm}px ${SPACE.lg}px`,
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  fontWeight: 800,
};

const dangerButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  color: F.red,
  borderColor: F.redSoft,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: SPACE.sm,
};

const artifactActionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-start',
  gap: SPACE.sm,
};

const subtleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
};

const errorStyle: React.CSSProperties = {
  border: `1px solid ${F.red}`,
  background: F.redSoft,
  color: F.red,
  borderRadius: RADIUS.md,
  padding: SPACE.md,
  marginTop: SPACE.md,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
};

const warningStyle: React.CSSProperties = {
  border: `1px solid ${F.amber}`,
  background: F.amberSoft,
  color: F.ink,
  borderRadius: RADIUS.md,
  padding: SPACE.md,
  marginTop: SPACE.md,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  display: 'grid',
  gap: SPACE.xs,
};

const cardsStyle: React.CSSProperties = {
  display: 'grid',
  gap: SPACE.md,
};

const summaryStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.cream50,
  padding: SPACE.md,
  color: F.inkSoft,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  lineHeight: 1.55,
};

const cardStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.md,
  background: F.surface,
  padding: SPACE.md,
  display: 'grid',
  gap: SPACE.sm,
};

const placeholderCardStyle: React.CSSProperties = {
  ...cardStyle,
  background: F.cream50,
};

const cardTopStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: SPACE.md,
};

const confidenceStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  color: F.fgMuted,
};

const selectStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.sm,
  background: F.surface,
  color: F.fg,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  padding: `${SPACE.xs}px ${SPACE.sm}px`,
};

const cardTitleInputStyle: React.CSSProperties = {
  border: 'none',
  borderBottom: `1px solid ${F.border}`,
  color: F.ink,
  background: 'transparent',
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.md,
  fontWeight: 800,
  padding: `${SPACE.xs}px 0`,
  outlineColor: F.fenway,
};

const cardBodyInputStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  borderRadius: RADIUS.sm,
  minHeight: 84,
  resize: 'vertical',
  color: F.inkSoft,
  background: F.cream50,
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  lineHeight: 1.5,
  padding: SPACE.sm,
  outlineColor: F.fenway,
};

const evidenceInputStyle: React.CSSProperties = {
  ...cardBodyInputStyle,
  minHeight: 48,
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
};

const proxyRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: SPACE.xs,
};

const proxyChipStyle: React.CSSProperties = {
  border: `1px solid ${F.border}`,
  background: F.cream50,
  color: F.fg,
  borderRadius: RADIUS.pill,
  padding: `2px ${SPACE.sm}px`,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
};

const smallCaveatStyle: React.CSSProperties = {
  color: F.fgMuted,
  fontFamily: 'var(--font-mono)',
  fontSize: TYPE.meta.sm,
  lineHeight: 1.45,
};

const bodyStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: TYPE.body.sm,
  color: F.fg,
  lineHeight: 1.5,
};
