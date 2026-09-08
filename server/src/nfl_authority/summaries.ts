import type { DataAnalysisFinding } from '@shared/types';
import type { NflAuthorityMatch, NflAuthoritySearchResult } from './types.js';

type EvidenceRequirement = {
  sourceId: string;
  locator: string;
  clauses: readonly string[];
  editionYear?: number;
  seasonYear?: number;
};

interface ReviewedSummary {
  topic: string;
  requirements: readonly EvidenceRequirement[];
  body: string;
}

const cba = (locator: string, ...clauses: string[]): EvidenceRequirement => ({ sourceId: 'nfl-cba-2020-executed', locator, clauses, editionYear: 2020 });
const playing = (locator: string, ...clauses: string[]): EvidenceRequirement => ({ sourceId: 'nfl-playing-rules-2026', locator, clauses, editionYear: 2026, seasonYear: 2026 });
const calendar = (locator: string, ...clauses: string[]): EvidenceRequirement => ({ sourceId: 'nfl-league-dates-2026-2027', locator, clauses, seasonYear: 2026 });

/**
 * Reviewed prose is deliberately separate from passage search. Every number,
 * date and material condition requires retrieved, bound supporting clauses.
 * A topic chooses relevance only; it can never satisfy an evidence requirement.
 */
const REVIEWED_SUMMARIES: readonly ReviewedSummary[] = [
  {
    topic: 'bonus_proration',
    requirements: [
      cba('Article 13, Section 6', 'when such payments are actually made', 'purposes of the Salary Cap'),
      cba('Article 13, Section 6', 'maximum proration of five years', 'subject to acceleration or some other treatment'),
    ],
    body: 'Signing-bonus proration allocates a cap charge; it does not itself reduce the cash owed to the player. The CBA generally spreads the bonus over the contract term, up to five years, subject to acceleration and other exceptions. A salary conversion’s actual cash amount, payment timing and permission depend on the agreed contract terms.',
  },
  {
    topic: 'june_1',
    requirements: [
      cba('Article 13, Section 6', 'designate up to two Player Contracts', 'if terminated', 'not renegotiated after the last regular season game', 'remain in the Club’s Team Salary until June 2'),
      cba('Article 13, Section 6', 'assigned via waivers or trade after June 1', 'except in the Final League Year', 'future years will be included fully in Team Salary at the start of the next League Year'),
    ],
    body: 'A trade cannot use an advance post-June 1 designation. That designation permits up to two qualifying terminations from the start of the league year through June 1, if the contract was not renegotiated after the prior season’s last regular-season game; its existing cap charge stays until June 2. A trade agreed earlier follows post-June 1 accounting only if actually assigned after June 1: unamortized signing-bonus charges for future years move into the next league year, while the current-year allocation remains. The agreement’s Final League Year has a separate acceleration rule.',
  },
  {
    topic: 'practice_squad',
    requirements: [
      calendar('Calendar entry: August 31, 2026; all times Eastern', 'Practice Squad of 17 players', 'as long as one player qualifies and is designated as an International Player'),
      cba('Article 33, Section 1', 'In the 2020 and 2021 League Years', 'twelve (12)', 'Beginning with the 2022 League Year', 'fourteen (14)'),
    ],
    body: 'The captured 2026 league calendar permits a 17-player practice squad when one player qualifies and is designated as an International Player. The executed 2020 CBA originally specified 12 players in 2020–2021 and 14 from 2022, with a separate international-player provision. Those original counts should not be treated as current practice-squad policy; current eligibility and elevation limits still require the applicable later rules.',
  },
  {
    topic: 'waivers',
    requirements: [
      cba('Article 29, Section 1', 'fourth year of credited service', 'Bert Bell/Pete Rozelle Plan', 'between the Monday following the Super Bowl and the trading deadline', 'If the waivers occur after that time', 'less than the season in which his fourth year'),
      calendar('Calendar entry: November 11, 2026; all times Eastern', 'at least four previous pension-credited seasons', 'waiver system for the remainder of the regular season and postseason'),
    ],
    body: 'For waiver treatment, the CBA uses credited service under the Bert Bell/Pete Rozelle Plan. A player who has completed the fourth credited-service season is ordinarily free to sign elsewhere when released between the Monday after the Super Bowl and the trade deadline; afterward the contract is subject to claims. Players below that service threshold are subject to waivers. The captured 2026 calendar starts the post-deadline veteran-waiver period on November 11. The player’s actual credited service and transaction timing still need confirmation.',
  },
  {
    topic: 'fifth_year_option',
    requirements: [
      cba('Article 7, Section 7', 'first round of the 2018 or any subsequent Draft', 'entire Paragraph 5 Salary for the Fifth-Year Option shall become guaranteed', 'effective upon the Club’s exercise of the Option', 'fourth year of the player’s Rookie Contract'),
      cba('Article 7, Section 7', 'guarantee', 'void', 'terms and conditions'),
    ],
    body: 'For first-round picks from the 2018 draft onward, exercising the fifth-year option guarantees the option-year base salary for skill, injury and cap-related termination. Any previously unguaranteed fourth-year base salary receives those protections too. Applicable CBA-permitted guarantee-voiding terms still matter. This is the draft-class rule; it does not establish whether a particular player’s option was exercised.',
  },
  {
    topic: 'league_deadlines',
    requirements: [calendar('Calendar entry: November 10, 2026; all times Eastern', 'All trading ends for 2026 at 4:00 p.m., New York time.')],
    body: 'The captured NFL calendar sets the 2026 trade deadline at 4:00 p.m. Eastern on November 10, 2026. The league states that calendar dates are subject to change.',
  },
  {
    topic: 'onside_kick',
    requirements: [playing('Rule 6, Section 1, Article 6', 'At any time during the game', 'declare an onside kick by notifying the Referee prior to the start of the play clock', 'notify the receiving team before starting the play clock')],
    body: 'Under the 2026 rulebook, a team may declare an onside kick at any time in the game, including while ahead in the first quarter. It must notify the referee before the play clock starts, and the referee then notifies the receiving team. The formation, touching, recovery and penalty rules still apply.',
  },
  {
    topic: 'overtime',
    requirements: [playing('Rule 16, Section 1, Article 3', 'Both teams must have the opportunity to possess the ball once', 'scores a safety on the receiving team’s initial possession', 'maximum of one 10-minute period', 'even if the second team has not had an opportunity', 'game shall result in a tie')],
    body: 'In 2026 regular-season overtime, an opening-possession touchdown does not automatically end the game: both teams ordinarily get an opportunity to possess the ball. A safety by the team kicking off on the opening possession ends it immediately. There is only one 10-minute overtime period, even if the second team has not possessed the ball or finished its possession; a tied score when time expires remains a tie.',
  },
] as const;

function supports(match: NflAuthorityMatch, requirement: EvidenceRequirement): boolean {
  const { passage, source } = match;
  return source.league === 'NFL'
    && source.id === requirement.sourceId && passage.source_id === source.id
    && passage.domain === source.domain && passage.url.split('#')[0] === source.url
    && passage.locator === requirement.locator
    && (requirement.editionYear === undefined || source.edition_year === requirement.editionYear)
    && (requirement.seasonYear === undefined || passage.season_year === requirement.seasonYear)
    && requirement.clauses.every(clause => passage.text.includes(clause));
}

export function buildReviewedNflAuthoritySummaries(result: NflAuthoritySearchResult): DataAnalysisFinding[] {
  if (result.status !== 'supported') return [];
  return REVIEWED_SUMMARIES.flatMap(summary => {
    if (!result.topic_ids.includes(summary.topic)) return [];
    const refs = summary.requirements.map(requirement => result.matches.findIndex(match => supports(match, requirement)) + 1);
    if (refs.some(ref => ref === 0)) return [];
    return [{ label: 'Rule summary', body: summary.body, source_refs: [...new Set(refs)].sort((a, b) => a - b) }];
  });
}
