import { factualBody } from '@shared/nflFacts';
import type { FactualAnswer } from '../nfl_facts/answer.js';
import { teamIdsFromQuestion } from '../nfl_transactions/question.js';
import { matchName, questionName, sourceRows, unavailable, type AvailabilityPlayer, type AvailabilitySnapshot, type NflExampleArgs, type NflExampleTrustedContext } from './evidence.js';

const share = (snaps: number, total: number) => `${(100 * snaps / total).toFixed(1)}%`;
const changes = (player: AvailabilityPlayer) => player.practice.slice(1).flatMap((entry, index) => entry.status !== player.practice[index].status ? [`${player.practice[index].date} ${player.practice[index].status} → ${entry.date} ${entry.status}`] : []);
const explicitAbsence = (question: string) => /\b(?:assume|assuming|suppose|what if|treat)\b[^.!?]{0,100}\b(?:unavailable|out|cannot play|can't play|absent)\b/i.test(question);

function reportClaim(player: AvailabilityPlayer) {
  const practice = player.practice.map(entry => `${entry.status} on ${entry.date}`).join(', ');
  const usage = player.offensive_snaps == null || player.offense_team_snaps == null
    ? player.gameday === 'Inactive' ? 'listed inactive on 2025-09-21' : 'offensive usage not captured for 2025-09-21'
    : `${player.offensive_snaps} of ${player.offense_team_snaps} offensive snaps (${share(player.offensive_snaps, player.offense_team_snaps)}) on 2025-09-21`;
  return `${player.name}: ${practice}; game designation ${player.game_status}; ${usage}.`;
}

function reviewItem(player: AvailabilityPlayer) {
  const labels = changes(player);
  const final = player.practice.at(-1)!;
  const recentDnp = labels.length > 0 && final.status === 'DNP';
  const persistentDnp = player.practice.every(entry => entry.status === 'DNP');
  const partial = player.offensive_snaps != null && player.offense_team_snaps != null && player.offensive_snaps < player.offense_team_snaps;
  const reason = recentDnp
    ? `Latest recorded label changed to DNP: ${labels.at(-1)}.`
    : labels.length ? `Reported labels changed: ${labels.join('; ')}.`
      : persistentDnp ? 'DNP on all three captured practice dates.'
        : player.gameday === 'Inactive' ? 'Official inactive designation in the captured game.'
          : partial ? `Observed ${player.offensive_snaps} of ${player.offense_team_snaps} offensive snaps in this one game; no earlier usage baseline is captured.`
            : player.offensive_snaps == null ? 'No offensive usage observation is captured; this is a data gap.'
              : 'No reported practice-label change; retain the dated report and game observation.';
  const question = recentDnp || labels.length || persistentDnp
    ? 'Check the next dated official report and ask the authorized staff what participation restrictions, if any, apply to the intended game.'
    : partial ? 'Check earlier game usage and the documented substitution plan before describing a workload trend.'
      : player.offensive_snaps == null ? 'Obtain the appropriate snap report; do not turn a missing offensive count into zero or a medical conclusion.'
        : 'Refresh the relevant report before relying on this player for a current staffing decision.';
  return { player: player.name, order: recentDnp ? 1 : labels.length ? 2 : persistentDnp ? 3 : player.gameday === 'Inactive' ? 4 : partial ? 5 : player.offensive_snaps == null ? 6 : 7, reason, next_question: question, recommendation_changes_if: 'A newer dated report, verified usage baseline or explicit staff workload instruction changes the evidence.', source_refs: [1, 2, 3] };
}

export function healthWorkflow(args: NflExampleArgs, data: AvailabilitySnapshot, trustedContext?: NflExampleTrustedContext): FactualAnswer {
  const explicitTeams = teamIdsFromQuestion(args.question);
  if ((args.teamId && args.teamId !== 'NYG') || explicitTeams.some(team => team !== 'NYG' && team !== 'KC')) return unavailable('The availability example contains the Giants official September 17–21, 2025 report only. No report for the requested team was captured.');
  if ((args.season != null && args.season !== 2025) || (args.weekStart != null && args.weekStart !== 3) || (args.weekEnd != null && args.weekEnd !== 3) || [...args.question.matchAll(/\b(20\d{2})\b/g)].some(match => match[1] !== '2025')) return unavailable('The availability example covers 2025 Week 3 only: September 17–21 practice/game status and September 21 observed usage.');
  if (args.availabilityView != null && !['timeline', 'review_priority', 'contingency'].includes(args.availabilityView)) return unavailable('Supported availability views are timeline, review_priority and contingency.');
  if (args.assumedUnavailable != null && typeof args.assumedUnavailable !== 'boolean') return unavailable('assumedUnavailable must be a boolean describing an explicit user scenario.');
  if (args.assumedUnavailablePlayer != null && typeof args.assumedUnavailablePlayer !== 'string') return unavailable('assumedUnavailablePlayer must name one captured player.');
  const literalAssumption = explicitAbsence(args.question);
  // Only the host can supply this separate context, from an accepted result. Tool input
  // cannot create previousQuery; the public schema and runtime reject unknown fields.
  const previousQuery = trustedContext?.previousQuery;
  const previousAssumption = previousQuery?.domain === 'availability' && previousQuery.teamId === 'NYG' && previousQuery.season === 2025 && typeof previousQuery.question === 'string' && previousQuery.assumedUnavailable === true && typeof previousQuery.assumedUnavailablePlayer === 'string'
    ? matchName(previousQuery.assumedUnavailablePlayer, data.players.map(player => player.name)) : undefined;
  if (args.assumedUnavailable === true && !literalAssumption && !previousAssumption) return unavailable('An absence scenario needs an explicit user assumption or the same validated assumption from trusted conversation history. The historical report does not establish that the player is unavailable.');
  const questionSubject = questionName(args.question, data.players.map(player => player.name));
  const assumptionClause = args.question.match(/\b(?:assume|assuming|suppose|what if|treat)\b[^.!?]{0,100}\b(?:unavailable|out|cannot play|can't play|absent)\b/i)?.[0];
  const assumptionSubject = assumptionClause ? questionName(assumptionClause, data.players.map(player => player.name)) : undefined;
  const inheritedAssumption = !literalAssumption && !!previousAssumption && args.assumedUnavailable !== false;
  if (inheritedAssumption && args.assumedUnavailablePlayer != null && matchName(args.assumedUnavailablePlayer, data.players.map(player => player.name)) !== previousAssumption) return unavailable('A different absence subject requires a new explicit user assumption. Trusted history authorizes only the previously validated player.');
  const scenario = (literalAssumption || inheritedAssumption) && args.assumedUnavailable !== false;
  const scenarioRequest = inheritedAssumption ? previousAssumption : args.assumedUnavailablePlayer ?? assumptionSubject ?? questionSubject ?? (args.playerName?.toLowerCase() !== 'all' ? args.playerName : undefined);
  const scenarioName = scenario && scenarioRequest ? matchName(scenarioRequest, data.players.map(player => player.name)) : undefined;
  if (scenario && !scenarioName) return unavailable('Name one captured player for the assumed absence scenario. No different player was substituted, and the report does not establish that every listed player is unavailable.');
  if (scenario && assumptionSubject && scenarioName !== assumptionSubject) return unavailable('The scenario player conflicts with the player named in the explicit user assumption. No different player was substituted.');
  // Report selection and absence subject are independent parts of a compound question.
  const broadReportScope = args.playerName?.toLowerCase() === 'all' || /\b(all|everyone|whom|who|which players|review priorities|investigation priorities|review first|investigate first)\b/i.test(args.question);
  const request = broadReportScope ? 'all' : args.playerName ?? questionSubject ?? (/\b(report|changes|flags|priorit)\b/i.test(args.question) ? 'all' : 'Andrew Thomas');
  const name = request.toLowerCase() === 'all' ? undefined : matchName(request, data.players.map(player => player.name));
  if (request.toLowerCase() !== 'all' && !name) return unavailable(`No captured September 2025 injury-report row for ${request}. The tool will not substitute a different player.`, ['Absence from this captured report does not establish health, active status or future availability.']);
  const view = args.assumedUnavailable === false && args.availabilityView === 'contingency' ? 'timeline' : args.availabilityView ?? (scenario ? 'contingency' : /\b(prioriti[sz]e|review first|flags|changes)\b/i.test(args.question) ? 'review_priority' : 'timeline');
  if (view === 'contingency' && !scenario) return unavailable('The contingency view requires an explicit user assumption that a named player is unavailable.');
  const players = data.players.filter(player => !name || player.name === name);
  const scenarioPlayer = scenarioName ? data.players.find(player => player.name === scenarioName) : undefined;
  const evidencePlayers = scenarioPlayer && !players.includes(scenarioPlayer) ? [...players, scenarioPlayer] : players;
  const sources = sourceRows(data.sources, 'AVAILABILITY');
  const priority = players.map(reviewItem).sort((a, b) => a.order - b.order || a.player.localeCompare(b.player));
  const assertions = evidencePlayers.map(player => ({ id: `availability:${player.name}:2025-week-3`, entity: player.name, claim: reportClaim(player), effective_period: '2025-09-17 through 2025-09-21', practice: player.practice, game_status: player.game_status, offensive_snaps: player.offensive_snaps, offense_team_snaps: player.offense_team_snaps, source_refs: [1, 2, 3] }));
  const counterfacts = evidencePlayers.flatMap(player => [
    ...(player.practice.some(entry => entry.status !== 'FP') ? [{ entity: player.name, rejected_claim: 'Full participation all week', reason: `The actual practice sequence is ${player.practice.map(entry => entry.status).join(' / ')}.`, source_refs: [1] }] : []),
    { entity: player.name, rejected_claim: 'Snap share declined sharply or workload is trending down', reason: 'Only one game usage observation is captured. Earlier game usage and a comparable denominator are missing; no snap trend can be calculated.', source_refs: [3] },
    { entity: player.name, rejected_claim: 'Current medical status, severity, return date or playing probability', reason: 'Historical public participation labels and one game observation do not establish any of these findings.', source_refs: [1, 2, 3] },
    { entity: player.name, rejected_claim: 'Practice labels, designation and partial game usage are a mismatch or contradiction', reason: 'Practice participation, game designation and game usage are different compatible observations. An expected-workload baseline or documented restriction would be needed to identify a discrepancy.', source_refs: [1, 2, 3] },
  ]);
  const followupActions = [
    { label: 'Review all dated participation changes', tool: 'get_nfl_example_evidence', args: { domain: 'availability', question: 'Show all Giants practice-label changes and review priorities in the September 2025 report.', season: 2025, teamId: 'NYG', playerName: 'all', availabilityView: 'review_priority' } },
    { label: `Investigate ${scenarioName ?? name ?? priority[0].player}'s timeline`, tool: 'get_nfl_example_evidence', args: { domain: 'availability', question: `Show ${scenarioName ?? name ?? priority[0].player}'s September 2025 report timeline and explain which observation would change the review.`, season: 2025, teamId: 'NYG', playerName: scenarioName ?? name ?? priority[0].player, availabilityView: 'timeline' } },
    { label: `Assume ${scenarioName ?? name ?? 'Andrew Thomas'} is unavailable`, tool: 'get_nfl_example_evidence', args: { domain: 'availability', question: `Assume ${scenarioName ?? name ?? 'Andrew Thomas'} is unavailable and show the staffing contingency questions.`, season: 2025, teamId: 'NYG', playerName: scenarioName ?? name ?? 'Andrew Thomas', assumedUnavailable: true, assumedUnavailablePlayer: scenarioName ?? name ?? 'Andrew Thomas', availabilityView: 'contingency' } },
  ];
  sources[0].data!.numeric_provenance = evidencePlayers.map(player => ({ player: player.name, locator: `NEW YORK GIANTS table / ${player.name}`, practice: player.practice, game_status: player.game_status, reported_injury: player.reported_injury }));
  sources[0].data!.factual_assertions = assertions;
  sources[0].data!.counterfacts = counterfacts;
  sources[0].data!.followup_actions = followupActions;
  sources[0].data!.workflow = { kind: scenario ? 'user_assumed_absence' : 'historical_report_investigation', view, report_selection: { playerName: name ?? 'all', players: players.map(player => player.name) }, review_priority: priority, ordering_basis: 'Recorded label changes, missing context and observed workload determine investigation order; this is not a medical risk ranking.', user_assumption: scenario ? { player: scenarioName, unavailable: true, origin: inheritedAssumption ? 'trusted_previous_query' : 'current_user_question', current_user_question: args.question, ...(inheritedAssumption ? { previous_query_question: previousQuery!.question } : { exact_user_question: args.question }), status: 'hypothetical; not an official finding' } : null, missing_evidence: ['Current official report', 'Authorized staff workload instructions', 'Earlier comparable usage baseline', 'Verified current roster assignments and acquisition feasibility'] };
  sources[1].data!.gameday_provenance = evidencePlayers.filter(player => player.gameday === 'Inactive' || player.name === 'Andrew Thomas').map(player => ({ player: player.name, observation: player.gameday === 'Inactive' ? 'Official inactive list' : 'Explicitly reported active' }));
  sources[2].data!.numeric_provenance = evidencePlayers.filter(player => player.gameday === 'Observed offensive participation').map(player => ({ player: player.name, offensive_snaps: player.offensive_snaps, offense_team_snaps: player.offense_team_snaps, reported_percent: player.reported_offensive_snap_percent, locator: `Giants.com Week 3 snap counts / ${player.name}` }));
  const selectedThomas = name === 'Andrew Thomas' || scenarioName === 'Andrew Thomas';
  const contingencyRows = [
    ['Internal coverage', `Which verified current roster player is assigned to cover ${scenarioName ?? 'the selected role'}, and at what workload?`, 'Current roster, position assignments and authorized staff instructions', 'A confirmed internal assignment and workload makes an internal plan reviewable.'],
    ['Protection / usage plan', 'Which protection responsibilities and practice repetitions change under this assumption?', 'Coach-defined responsibilities and current practice plan', 'A different workload or assignment changes the practice and protection questions.'],
    ['External option', 'If internal coverage is insufficient, which available candidate and transaction can actually be considered?', 'Current availability, acquisition terms, roster/cap constraints and decision authority', 'A verified feasible candidate allows a separate roster/contract scenario; no replacement is inferred here.'],
  ];
  return { body: factualBody({
    example_query: { domain: 'availability', question: args.question, season: 2025, teamId: 'NYG', playerName: name ?? 'all', assumedUnavailable: scenario, ...(scenarioName ? { assumedUnavailablePlayer: scenarioName } : {}), availabilityView: view },
    answer: `Historical September 2025 availability investigation. ${name ? reportClaim(players[0]) : `${players.length} Giants report rows are shown. Investigation starts with ${priority.slice(0, 2).map(item => `${item.player}: ${item.reason}`).join(' ')}`}${scenario ? `${inheritedAssumption ? ` User scenario retained from the previous query: ${scenarioName} is assumed unavailable.` : ` User scenario: assume ${scenarioName} is unavailable.`} The next decision is to verify internal coverage, define changed responsibilities, then test an external option only if needed.` : ' Use the dated observations to decide which missing report or workload context to check next.'}`,
    key_findings: [
      ...evidencePlayers.filter(player => player.name === name || player.name === scenarioName).map(player => ({ label: `${player.name} · dated observations`, body: reportClaim(player), source_refs: [1, 2, 3] })),
      { label: 'Practice participation changes', body: players.flatMap(player => changes(player).map(change => `${player.name}: ${change}`)).join('; ') || `${name ?? 'Selected players'}: no change among the three reported practice participation labels.`, source_refs: [1] },
      { label: 'Review priority', body: `${priority[0].player}: ${priority[0].reason} ${priority[0].next_question} This orders investigation; it is not a medical risk ranking.`, source_refs: priority[0].source_refs },
      { label: 'No snap-trend baseline', body: 'The saved usage covers September 21 only. A low snap share in this game cannot establish a sharp decline or a trend without earlier comparable game usage.', source_refs: [3] },
    ],
    tables: [
      { title: 'Historical Sept 17–21, 2025 · Giants practice and observed game participation', columns: ['Player', 'Reported injury', 'Sept 17', 'Sept 18', 'Sept 19', 'Game designation', 'Observed Sept 21', 'Offensive snaps', 'Offensive snap share', 'Change flag'], rows: players.map(player => [player.name, player.reported_injury, ...player.practice.map(entry => entry.status), player.game_status, player.gameday, player.offensive_snaps, player.offense_team_snaps == null ? player.gameday === 'Inactive' ? 'Inactive' : 'Not captured' : share(player.offensive_snaps!, player.offense_team_snaps), changes(player).join('; ') || 'No practice-label change']), source_refs: [1, 2, 3] },
      ...(selectedThomas ? [{ title: 'Historical Sept 21, 2025 · observed tackle usage', columns: ['Player', 'Offensive snaps', 'Team offensive snaps', 'Share'], rows: data.observed_offensive_usage.map(player => [player.name, player.snaps, player.team_snaps, share(player.snaps, player.team_snaps)]), source_refs: [3] }] : []),
      { title: 'Historical 2025 report · investigation queue', columns: ['Player', 'Reason to review', 'Next evidence question', 'What changes the review'], rows: priority.map(item => [item.player, item.reason, item.next_question, item.recommendation_changes_if]), source_refs: [1, 2, 3] },
      ...(scenario ? [{ title: `User-assumed absence · ${scenarioName} · separate from the 2025 report`, columns: ['Decision', 'Staffing / options question', 'Required evidence', 'What changes the recommendation'], rows: contingencyRows, source_refs: [] }] : []),
    ],
    calculations: players.filter(player => player.offensive_snaps != null && player.offense_team_snaps != null).map(player => ({ label: `${player.name}: September 21 offensive snap share`, formula: `${player.offensive_snaps} / ${player.offense_team_snaps} × 100`, value: share(player.offensive_snaps!, player.offense_team_snaps!), source_refs: [3] })),
    caveats: [`Captured ${data.captured_at.slice(0, 10)}; report effective September 17–21, 2025. This is not the current injury report.`, 'DNP = did not participate; LP = limited participation; FP = full participation. A missing game designation does not establish unrestricted workload.', 'Change flags compare reported labels only. They do not infer severity, injury risk, recovery, a return date or probability of playing.', 'Missing observed usage remains unknown. Inactive players have zero offensive snaps based on the official inactive list; defensive snap counts are not captured here.', 'nflverse documentation says its injury source stopped after 2024; this example uses dated official Giants reports rather than assuming a live injury feed.', ...(selectedThomas ? [data.role_observation, 'The September 2025 Thomas/Mbow observation is historical. It does not verify a current replacement assignment.'] : []), ...(scenario ? ['The unavailability assumption is supplied by the user. The contingency table is a decision workflow, not a claim that a named replacement is available or qualified.'] : [])],
    followups: followupActions.map(action => action.args.question),
  }), sources };
}
