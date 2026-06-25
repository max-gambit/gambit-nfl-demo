import { useMemo, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

type FeedUrgency = 'high' | 'medium' | 'low';
type FeedMode = 'external' | 'internal';
type InternalFeedSourceType = 'game-analytics' | 'performance' | 'player-development' | 'scouting' | 'gm-intel' | 'cap-ops';
type InternalFeedSensitivity = 'internal' | 'restricted' | 'high';

export interface DashboardFeedAnalysisRequest {
  title: string;
  prompt: string;
  sessionLabel: string;
}

export interface CapStrategyFeedItem {
  id: string;
  headline: string;
  sourceLabel: string;
  sourceUrl: string | null;
  publishedAt: string;
  urgency: FeedUrgency;
  tags: string[];
  teams: string[];
  summary: string;
  gswAngle: string;
  analysisPrompt: string;
}

interface InternalFeedItem {
  id: string;
  headline: string;
  sourceType: InternalFeedSourceType;
  sourceLabel: string;
  sourceOwner: string;
  publishedAt: string;
  urgency: FeedUrgency;
  sensitivity: InternalFeedSensitivity;
  players: string[];
  teams: string[];
  tags: string[];
  summary: string;
  warriorsDecision: string;
  recommendedAction: string;
  analysisPrompt: string;
}

interface DashboardViewProps {
  onJumpToBrief: (id: string) => void;
  onAnalyzeFeedItem: (request: DashboardFeedAnalysisRequest) => Promise<void> | void;
}

const EXTERNAL_SESSION_LABEL = 'Feed';
const INTERNAL_SESSION_LABEL = 'Internal Feed';

const TOPIC_FILTERS = [
  {
    id: 'All',
    label: 'All',
    description: 'Every non-Warriors deadline deal in the feed.',
  },
  {
    id: 'GSW assets',
    label: 'GSW assets',
    description: 'Deals that touch Warriors-linked picks or asset-map questions.',
  },
  {
    id: 'Pacific rivals',
    label: 'Pacific rivals',
    description: 'Lakers and Clippers deadline moves Golden State has to model against.',
  },
  {
    id: 'Big pricing',
    label: 'Big pricing',
    description: 'Center and frontcourt deals that price the big-man market.',
  },
  {
    id: 'Guard pricing',
    label: 'Guard pricing',
    description: 'Creator, shooter, and guard-depth deals that set perimeter prices.',
  },
  {
    id: 'Tax/2nds',
    label: 'Tax/2nds',
    description: 'Second-round-pick and salary-cleanup moves around the deadline.',
  },
] as const;

const INTERNAL_FILTERS = [
  {
    id: 'All',
    label: 'All',
    description: 'Every internal basketball-ops update in the feed.',
  },
  {
    id: 'Needs action',
    label: 'Needs action',
    description: 'Items that ask the front office or staff to decide, confirm, or follow up.',
  },
  {
    id: 'Availability',
    label: 'Availability',
    description: 'Performance, load, recovery, and rotation-readiness updates.',
  },
  {
    id: 'Roster decision',
    label: 'Roster decision',
    description: 'Updates that change roster, rotation, contract, or cap choices.',
  },
  {
    id: 'Player dev',
    label: 'Player dev',
    description: 'Development staff notes on role readiness and skill progression.',
  },
  {
    id: 'Scouting',
    label: 'Scouting',
    description: 'Opponent, pro personnel, and target scouting updates.',
  },
  {
    id: 'Market intel',
    label: 'Market intel',
    description: 'Agent, GM, and price-discovery notes from the front-office call sheet.',
  },
] as const;

const KEY_CAP_DATES = [
  {
    date: 'June 29',
    label: 'Options + QOs',
    detail: 'Player/team/ETO decisions and qualifying offers for restricted free agents are due.',
  },
  {
    date: 'June 30',
    label: 'League-year close',
    detail: 'Last day of 2025-26; veteran-extension deadline; outside free-agent talks open at 5 PM CT.',
  },
  {
    date: 'July 1',
    label: 'New cap year',
    detail: 'Moratorium begins; RFAs can sign offer sheets; minimum, two-way, rookie-scale, and second-round exception signings open.',
  },
  {
    date: 'July 6',
    label: 'Deals become official',
    detail: 'Moratorium ends at 11:01 AM CT; signings, extensions, and trades can be completed.',
  },
  {
    date: 'July 13',
    label: 'QO withdrawal date',
    detail: 'Last day teams can unilaterally withdraw qualifying offers.',
  },
  {
    date: 'July 31',
    label: 'Second-round cap count',
    detail: 'Players signed with the second-round pick exception begin counting against team cap.',
  },
  {
    date: 'August 29',
    label: 'Stretch deadline',
    detail: 'Last day to waive players and apply the stretch provision to 2026-27 salary.',
  },
] as const;

const CAP_STRATEGY_FEED: CapStrategyFeedItem[] = [
  {
    id: 'wizards-acquire-anthony-davis',
    headline: 'Wizards acquire Anthony Davis in three-team trade',
    sourceLabel: 'Wizards PR',
    sourceUrl: 'https://www.nba.com/wizards/news/wizards-acquire-10-time-all-star-anthony-davis',
    publishedAt: '2026-02-05T12:20:00-05:00',
    urgency: 'high',
    tags: ['GSW assets', 'Big pricing'],
    teams: ['WAS', 'DAL', 'CHA'],
    summary: 'Washington received Anthony Davis, Jaden Hardy, D\'Angelo Russell, and Dante Exum. Dallas received Khris Middleton, AJ Johnson, Tyus Jones, Marvin Bagley III, a 2026 first, a 2030 first via Golden State, and three future seconds.',
    gswAngle: 'The Golden State-linked 2030 first in the Dallas return makes this a direct pick-map item for Warriors asset planning.',
    analysisPrompt: 'Analyze the Anthony Davis three-team deadline trade with emphasis on the 2030 first-round pick via Golden State in Dallas\' return. Explain what this implies for Golden State\'s future pick map, asset liquidity, star-salary trade comps, and apron-aware roster planning.',
  },
  {
    id: 'pacers-trade-for-zubac',
    headline: 'Pacers acquire Ivica Zubac and Kobe Brown from Clippers',
    sourceLabel: 'Clippers PR',
    sourceUrl: 'https://www.nba.com/clippers/news/clippers-acquire-mathurin-jackson-and-two-first-round-picks-from-indiana',
    publishedAt: '2026-02-05T12:30:00-05:00',
    urgency: 'high',
    tags: ['Pacific rivals', 'Big pricing'],
    teams: ['IND', 'LAC'],
    summary: 'Indiana received Zubac and Kobe Brown. The Clippers received Bennedict Mathurin, Isaiah Jackson, two first-round picks, and a second-round pick.',
    gswAngle: 'This is the closest deadline comp for valuing a productive center against first-round capital and young-player control.',
    analysisPrompt: 'Analyze the Pacers-Clippers Ivica Zubac deadline trade as a center-market comp for Golden State. Compare Zubac\'s price to the Warriors\' Porzingis acquisition, explain the first-round pick cost, and identify what it says about frontcourt scarcity at the deadline.',
  },
  {
    id: 'cavaliers-acquire-harden',
    headline: 'Cavaliers acquire James Harden from Clippers',
    sourceLabel: 'Cavaliers PR',
    sourceUrl: 'https://www.nba.com/cavaliers/news/releases-james-harden-260204',
    publishedAt: '2026-02-04T18:00:00-05:00',
    urgency: 'high',
    tags: ['Pacific rivals', 'Guard pricing'],
    teams: ['CLE', 'LAC'],
    summary: 'Cleveland received Harden. The Clippers received Darius Garland and a future second-round pick.',
    gswAngle: 'This gives Golden State a star-guard salary-swap comp for older-creator money versus younger guard control.',
    analysisPrompt: 'Analyze the Cavaliers acquiring James Harden from the Clippers for Darius Garland and a future second-round pick. Frame it as a Warriors cap-strategy comp for aging-star salary, guard creation, apron pressure, and the cost of swapping present creation for future control.',
  },
  {
    id: 'celtics-acquire-vucevic',
    headline: 'Celtics acquire Nikola Vucevic from Bulls',
    sourceLabel: 'Celtics PR',
    sourceUrl: 'https://www.nba.com/celtics/news/press-release-20260205-celtics-acquire-nikola-vucevic',
    publishedAt: '2026-02-05T12:40:00-05:00',
    urgency: 'medium',
    tags: ['Big pricing'],
    teams: ['BOS', 'CHI'],
    summary: 'Boston received Vucevic and a 2027 second-round pick. Chicago received Anfernee Simons and a 2026 second-round pick.',
    gswAngle: 'Another contender added a veteran center at the deadline, giving Golden State a cleaner read on frontcourt acquisition alternatives.',
    analysisPrompt: 'Analyze Boston acquiring Nikola Vucevic from Chicago as a Warriors-relevant deadline comp. Compare Vucevic to Porzingis as a veteran-center path, including salary, spacing, defense, pick cost, and playoff roster construction.',
  },
  {
    id: 'timberwolves-acquire-dosunmu',
    headline: 'Timberwolves acquire Ayo Dosunmu and Julian Phillips from Bulls',
    sourceLabel: 'Timberwolves PR',
    sourceUrl: 'https://www.nba.com/timberwolves/news/minnesota-timberwolves-acquireguardayo-dosunmuandforward-julian-phillipsfromchicago-bulls',
    publishedAt: '2026-02-05T12:50:00-05:00',
    urgency: 'medium',
    tags: ['GSW assets', 'Guard pricing', 'Tax/2nds'],
    teams: ['MIN', 'CHI'],
    summary: 'Minnesota received Dosunmu and Phillips. Chicago received Rob Dillingham, Leonard Miller, and four second-round picks, including Golden State-linked seconds.',
    gswAngle: 'The Golden State-linked seconds in Chicago\'s return make this useful for valuing the Warriors\' second-round pick routing and guard-depth market.',
    analysisPrompt: 'Analyze the Timberwolves acquiring Ayo Dosunmu and Julian Phillips from the Bulls with Golden State-linked second-round picks in the return. Explain the guard-depth market, second-round pick valuation, and how Warriors-linked picks affect Golden State\'s asset map.',
  },
  {
    id: 'jazz-acquire-jaren-jackson-jr',
    headline: 'Jazz acquire Jaren Jackson Jr. from Grizzlies',
    sourceLabel: 'Jazz PR',
    sourceUrl: 'https://www.nba.com/jazz/news/utah-jazz-acquire-former-nba-defensive-player-of-the-year-and-two-time-nba-all-star-jaren-jackson-jr',
    publishedAt: '2026-02-03T17:00:00-05:00',
    urgency: 'medium',
    tags: ['Big pricing'],
    teams: ['UTA', 'MEM'],
    summary: 'Utah received Jaren Jackson Jr., Jock Landale, John Konchar, and Vince Williams Jr. Memphis received Walter Clayton Jr., Kyle Anderson, Taylor Hendricks, Georges Niang, and three future first-round picks.',
    gswAngle: 'The three-first price is the deadline ceiling case for a premium defensive big in the West.',
    analysisPrompt: 'Analyze the Jazz acquiring Jaren Jackson Jr. from Memphis as a Warriors-relevant deadline comp. Focus on the three-first pick price, defensive-big scarcity, Western Conference implications, and how it frames Golden State\'s Porzingis move.',
  },
  {
    id: 'lakers-acquire-kennard',
    headline: 'Lakers acquire Luke Kennard from Hawks',
    sourceLabel: 'NBA.com Trade Tracker',
    sourceUrl: 'https://www.nba.com/news/2025-26-nba-trade-tracker',
    publishedAt: '2026-02-05T13:10:00-05:00',
    urgency: 'medium',
    tags: ['Pacific rivals', 'Guard pricing', 'Tax/2nds'],
    teams: ['LAL', 'ATL'],
    summary: 'Los Angeles received Kennard. Atlanta received Gabe Vincent and a 2032 second-round pick.',
    gswAngle: 'A Pacific rival bought shooting with a veteran guard salary and one second, giving Golden State a clean movement-shooter price point.',
    analysisPrompt: 'Analyze the Lakers acquiring Luke Kennard from Atlanta for Gabe Vincent and a 2032 second-round pick as a Warriors-relevant deadline comp. Focus on shooter pricing, rival roster construction, second-round pick value, and how Golden State should value similar specialist guards.',
  },
  {
    id: 'nets-acquire-hunter-tyson',
    headline: 'Nets acquire Hunter Tyson and 2032 second-round pick from Nuggets',
    sourceLabel: 'NBA.com Trade Tracker',
    sourceUrl: 'https://www.nba.com/news/2025-26-nba-trade-tracker',
    publishedAt: '2026-02-05T13:20:00-05:00',
    urgency: 'low',
    tags: ['Tax/2nds'],
    teams: ['BKN', 'DEN'],
    summary: 'Brooklyn received Tyson and a 2032 second-round pick. Denver received a 2026 second-round pick.',
    gswAngle: 'This is the type of small salary-and-pick cleanup move Golden State should track around tax, roster-slot, and second-round pick liquidity.',
    analysisPrompt: 'Analyze the Nets acquiring Hunter Tyson and a 2032 second-round pick from Denver as a Warriors-relevant tax and roster-slot move. Explain the likely cap motivation, second-round pick tradeoff, and how Golden State should evaluate similar cleanup opportunities.',
  },
];

const INTERNAL_FEED: InternalFeedItem[] = [
  {
    id: 'postgame-lineup-shot-quality',
    headline: 'Postgame model flags Curry-Podziemski-Porzingis fourth-quarter lineup',
    sourceType: 'game-analytics',
    sourceLabel: 'Postgame advanced stats',
    sourceOwner: 'Basketball analytics',
    publishedAt: '2026-06-12T09:40:00-07:00',
    urgency: 'high',
    sensitivity: 'internal',
    players: ['Stephen Curry', 'Brandin Podziemski', 'Kristaps Porzingis'],
    teams: ['GSW'],
    tags: ['Needs action', 'Roster decision'],
    summary: 'The latest postgame cut has the Curry-Podziemski-Porzingis group at +18.6 net in 21 fourth-quarter minutes, with shot quality rising most when the weak-side slot is cleared early.',
    warriorsDecision: 'Staff needs a playoff-rotation read on whether this group is a closing option or a matchup-only package.',
    recommendedAction: 'Build a five-lineup compare brief with opponent coverages, rebounding exposure, and late-clock creation load.',
    analysisPrompt: 'Create an internal Warriors analysis brief from the postgame advanced-stats note: the Curry-Podziemski-Porzingis fourth-quarter lineup posted +18.6 net in 21 minutes with improved shot quality when the weak-side slot cleared early. Evaluate whether this should become a closing option or matchup package. Include lineup comps, opponent coverage stress, rebounding risk, late-clock creation load, and the next coaching questions.',
  },
  {
    id: 'performance-second-night-review',
    headline: 'Performance team requests second-night minutes review for Green and Porzingis',
    sourceType: 'performance',
    sourceLabel: 'Performance load report',
    sourceOwner: 'Performance staff',
    publishedAt: '2026-06-12T08:55:00-07:00',
    urgency: 'high',
    sensitivity: 'restricted',
    players: ['Draymond Green', 'Kristaps Porzingis'],
    teams: ['GSW'],
    tags: ['Needs action', 'Availability', 'Roster decision'],
    summary: 'Travel load and recovery markers triggered a staff review for the next back-to-back. The note does not change availability status.',
    warriorsDecision: 'Rotation planning needs a minutes band before the staff sets the frontcourt backup plan.',
    recommendedAction: 'Create a rotation-stress brief with minute caps, center coverage alternatives, and tax-roster contingency impacts.',
    analysisPrompt: 'Create an internal Warriors analysis brief from the performance note: travel load and recovery markers triggered a second-night minutes review for Draymond Green and Kristaps Porzingis, with no availability-status change yet. Evaluate rotation stress, likely minutes bands, backup frontcourt plans, center coverage alternatives, and roster/cap contingency implications if one veteran is limited.',
  },
  {
    id: 'moody-player-dev-corner-relocation',
    headline: 'Player development logs Moody corner-relocation progress after practice block',
    sourceType: 'player-development',
    sourceLabel: 'Player development note',
    sourceOwner: 'Player development',
    publishedAt: '2026-06-11T17:25:00-07:00',
    urgency: 'medium',
    sensitivity: 'internal',
    players: ['Moses Moody'],
    teams: ['GSW'],
    tags: ['Player dev', 'Roster decision'],
    summary: 'The development staff logged cleaner weak-side relocation timing and faster catch-to-shoot decisions across the last two practice blocks.',
    warriorsDecision: 'The staff can test whether Moody absorbs more second-unit spacing minutes without changing the main ballhandler rotation.',
    recommendedAction: 'Run a role-readiness brief comparing Moody lineups to current bench-wing combinations.',
    analysisPrompt: 'Create an internal Warriors analysis brief from the player-development note: Moses Moody showed cleaner weak-side corner relocation timing and faster catch-to-shoot decisions across the last two practice blocks. Evaluate whether he should absorb more second-unit spacing minutes. Compare lineup fit, defensive tradeoffs, shot profile, and which rotation minutes should be tested first.',
  },
  {
    id: 'santos-defensive-trial',
    headline: 'Santa Cruz staff clears Santos for weak-side four defensive trial',
    sourceType: 'player-development',
    sourceLabel: 'G League assignment report',
    sourceOwner: 'Santa Cruz staff',
    publishedAt: '2026-06-11T14:10:00-07:00',
    urgency: 'low',
    sensitivity: 'internal',
    players: ['Gui Santos'],
    teams: ['GSW', 'Santa Cruz'],
    tags: ['Player dev', 'Scouting'],
    summary: 'The assignment report credits Santos with improved low-man timing, better nail positioning, and fewer off-ball screen disconnects.',
    warriorsDecision: 'This gives pro personnel a live test case for whether the back-end roster needs another defensive wing.',
    recommendedAction: 'Create a development-to-roster brief on Santos versus available minimum wing options.',
    analysisPrompt: 'Create an internal Warriors analysis brief from the Santa Cruz player-development report: Gui Santos was cleared for a weak-side four defensive trial after improved low-man timing, nail positioning, and fewer off-ball screen disconnects. Compare his internal roster value to minimum-salary defensive wing options, including development upside, playoff readiness, and cap flexibility.',
  },
  {
    id: 'west-scout-clippers-small-ball',
    headline: 'West scout updates Clippers small-ball center coverage notes',
    sourceType: 'scouting',
    sourceLabel: 'Pro scouting note',
    sourceOwner: 'West pro scout',
    publishedAt: '2026-06-11T11:35:00-07:00',
    urgency: 'medium',
    sensitivity: 'internal',
    players: ['Ivica Zubac', 'Kobe Brown'],
    teams: ['LAC'],
    tags: ['Scouting', 'Roster decision'],
    summary: 'The scout packet says the Clippers are using more switch-heavy small-ball coverages when Zubac sits, with Brown taking short-roll reads against second units.',
    warriorsDecision: 'Golden State needs to decide whether to attack the matchup with size, shooting, or Curry screening actions.',
    recommendedAction: 'Generate an opponent-coverage brief with lineup counters and personnel stress points.',
    analysisPrompt: 'Create an internal Warriors scouting brief from the West pro scout note: the Clippers are leaning into switch-heavy small-ball coverages when Ivica Zubac sits, with Kobe Brown handling short-roll reads against second units. Recommend Warriors lineup counters, offensive actions, personnel stress points, and what roster construction lessons carry into offseason planning.',
  },
  {
    id: 'agent-wing-price-check',
    headline: 'Agent call updates summer price range for defensive wing target',
    sourceType: 'gm-intel',
    sourceLabel: 'Agent call note',
    sourceOwner: 'Front office',
    publishedAt: '2026-06-11T10:20:00-07:00',
    urgency: 'high',
    sensitivity: 'high',
    players: ['Undisclosed wing target'],
    teams: ['GSW'],
    tags: ['Needs action', 'Market intel', 'Roster decision'],
    summary: 'The agent-side read moved the likely asking range from minimum-plus-opportunity to part of the taxpayer mid-level exception.',
    warriorsDecision: 'Cap planning needs a go/no-go on preserving exception room versus holding flexibility for the trade market.',
    recommendedAction: 'Create a price-sensitivity brief with exception usage, fallback targets, and hard-stop thresholds.',
    analysisPrompt: 'Create an internal Warriors market-intel brief from the agent call note: a defensive wing target is now expected to cost part of the taxpayer mid-level exception instead of minimum-plus-opportunity. Evaluate exception preservation, fallback targets, hard-stop price thresholds, trade-market alternatives, and how this affects apron planning.',
  },
  {
    id: 'gm-call-backup-guard-market',
    headline: 'GM call adds second-year guard to possible trade-discussion pool',
    sourceType: 'gm-intel',
    sourceLabel: 'GM call note',
    sourceOwner: 'General manager',
    publishedAt: '2026-06-10T18:45:00-07:00',
    urgency: 'medium',
    sensitivity: 'restricted',
    players: ['Undisclosed second-year guard'],
    teams: ['GSW', 'East team'],
    tags: ['Market intel', 'Scouting'],
    summary: 'A peer team indicated it may listen on a second-year guard if it can turn the slot into a larger frontcourt upgrade.',
    warriorsDecision: 'The scouting and cap groups need a quick read on whether the player belongs on the July trade-call board.',
    recommendedAction: 'Run a player-fit brief that combines scouting grades, rookie-scale control, and outgoing-salary paths.',
    analysisPrompt: 'Create an internal Warriors market and scouting brief from the GM call note: an Eastern Conference team may listen on a second-year guard if it can convert the slot into frontcourt help. Evaluate whether Golden State should place the player on the July trade-call board. Include scouting fit, rookie-scale control, outgoing salary paths, and offer discipline.',
  },
  {
    id: 'cap-sheet-july-six-window',
    headline: 'Cap sheet flags July 6 aggregation window around partial guarantee',
    sourceType: 'cap-ops',
    sourceLabel: 'Internal cap sheet',
    sourceOwner: 'Cap strategy',
    publishedAt: '2026-06-10T15:15:00-07:00',
    urgency: 'high',
    sensitivity: 'internal',
    players: ['Partial-guarantee slot'],
    teams: ['GSW'],
    tags: ['Needs action', 'Roster decision', 'Market intel'],
    summary: 'The latest cap sheet marks a narrow post-moratorium window where one partial-guarantee decision changes outgoing salary matching and tax exposure.',
    warriorsDecision: 'The front office needs to sequence waiver, signing, and trade calls before July 6 transactions become official.',
    recommendedAction: 'Create a calendarized cap-ops brief with decision deadlines, matching math, and downside cases.',
    analysisPrompt: 'Create an internal Warriors cap-ops brief from the cap sheet note: a July 6 post-moratorium aggregation window around a partial-guarantee slot changes outgoing salary matching and tax exposure. Sequence waiver, signing, and trade-call decisions; identify deadlines, matching math, apron/tax downside cases, and recommended staff owners.',
  },
  {
    id: 'shooting-specialist-scout-priority',
    headline: 'Scouting cross-check moves movement shooter into priority watch tier',
    sourceType: 'scouting',
    sourceLabel: 'Pro personnel cross-check',
    sourceOwner: 'Pro personnel',
    publishedAt: '2026-06-10T12:05:00-07:00',
    urgency: 'medium',
    sensitivity: 'internal',
    players: ['Undisclosed movement shooter'],
    teams: ['GSW', 'West team'],
    tags: ['Scouting', 'Market intel'],
    summary: 'The cross-check upgraded the shooter after tracking off-screen gravity, relocation volume, and acceptable defensive survival in playoff-style matchups.',
    warriorsDecision: 'Golden State needs to decide if this is a specialist worth an early call or only a fallback after bigger wing targets settle.',
    recommendedAction: 'Create a specialist-value brief against Luke Kennard-style deadline pricing and internal bench alternatives.',
    analysisPrompt: 'Create an internal Warriors scouting and market brief from the pro personnel cross-check: an undisclosed movement shooter moved into the priority watch tier after stronger off-screen gravity, relocation volume, and acceptable defensive survival in playoff-style matchups. Compare the target to Luke Kennard-style pricing, internal bench alternatives, and early-call versus fallback strategy.',
  },
];

function formatFeedDate(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

function formatFeedTimestamp(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function urgencyStyle(urgency: FeedUrgency): { color: string; background: string; label: string } {
  if (urgency === 'high') return { color: F.red, background: F.redSoft, label: 'High' };
  if (urgency === 'medium') return { color: F.amber, background: F.amberSoft, label: 'Medium' };
  return { color: F.fgMuted, background: F.cream100, label: 'Low' };
}

type TopicFilterId = (typeof TOPIC_FILTERS)[number]['id'];
type InternalFilterId = (typeof INTERNAL_FILTERS)[number]['id'];

function itemMatchesFilter(item: CapStrategyFeedItem, filter: TopicFilterId): boolean {
  return filter === 'All' || item.tags.includes(filter);
}

function internalItemMatchesFilter(item: InternalFeedItem, filter: InternalFilterId): boolean {
  return filter === 'All' || item.tags.includes(filter);
}

export function DashboardView({ onAnalyzeFeedItem }: DashboardViewProps) {
  const [activeFeed, setActiveFeed] = useState<FeedMode>('external');
  const [selectedTopic, setSelectedTopic] = useState<TopicFilterId>('All');
  const [selectedInternalTopic, setSelectedInternalTopic] = useState<InternalFilterId>('All');
  const [analyzingItemKey, setAnalyzingItemKey] = useState<string | null>(null);

  const filteredExternalItems = useMemo(
    () => CAP_STRATEGY_FEED.filter((item) => itemMatchesFilter(item, selectedTopic)),
    [selectedTopic],
  );

  const filteredInternalItems = useMemo(
    () => INTERNAL_FEED.filter((item) => internalItemMatchesFilter(item, selectedInternalTopic)),
    [selectedInternalTopic],
  );

  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const topic of TOPIC_FILTERS) {
      counts.set(topic.id, topic.id === 'All'
        ? CAP_STRATEGY_FEED.length
        : CAP_STRATEGY_FEED.filter((item) => item.tags.includes(topic.id)).length);
    }
    return counts;
  }, []);

  const internalTopicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const topic of INTERNAL_FILTERS) {
      counts.set(topic.id, topic.id === 'All'
        ? INTERNAL_FEED.length
        : INTERNAL_FEED.filter((item) => item.tags.includes(topic.id)).length);
    }
    return counts;
  }, []);

  const onAnalyze = async (request: DashboardFeedAnalysisRequest, itemKey: string) => {
    if (analyzingItemKey) return;
    setAnalyzingItemKey(itemKey);
    try {
      await onAnalyzeFeedItem(request);
    } finally {
      setAnalyzingItemKey(null);
    }
  };

  const analyzeExternalItem = (item: CapStrategyFeedItem) => void onAnalyze({
    title: item.headline,
    prompt: item.analysisPrompt,
    sessionLabel: EXTERNAL_SESSION_LABEL,
  }, `external:${item.id}`);

  const analyzeInternalItem = (item: InternalFeedItem) => void onAnalyze({
    title: item.headline,
    prompt: item.analysisPrompt,
    sessionLabel: INTERNAL_SESSION_LABEL,
  }, `internal:${item.id}`);

  const activeItemCount = activeFeed === 'external' ? filteredExternalItems.length : filteredInternalItems.length;

  return (
    <div className="gd-scroll" style={{ flex: 1, overflowY: 'auto', background: F.paper }}>
      <div className="dashboard-feed-shell" style={{
        maxWidth: 1180,
        margin: '0 auto',
        padding: `${SPACE['3xl']}px ${SPACE['2xl']}px ${SPACE['4xl'] * 2}px`,
      }}>
        <header className="dashboard-feed-header" style={{
          display: 'flex',
          gap: SPACE.xl,
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: SPACE.xl,
        }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: TYPE.display.lg,
              fontWeight: 600,
              color: F.ink,
              letterSpacing: TRACKING.tight,
            }}>
              Feed
            </h1>
          </div>
          <div className="dashboard-feed-tabs" style={{
            display: 'flex',
            alignItems: 'center',
            gap: SPACE.xs,
            padding: 0,
            borderBottom: `1px solid ${F.border}`,
            flexShrink: 0,
          }}>
            {([
              { id: 'external' as const, label: 'External', count: CAP_STRATEGY_FEED.length },
              { id: 'internal' as const, label: 'Internal', count: INTERNAL_FEED.length },
            ]).map((feed) => {
              const active = activeFeed === feed.id;
              return (
                <button
                  key={feed.id}
                  onClick={() => setActiveFeed(feed.id)}
                  style={{
                    height: 30,
                    minWidth: 92,
                    padding: `0 ${SPACE.sm}px`,
                    border: 'none',
                    borderBottom: `2px solid ${active ? F.fenway : 'transparent'}`,
                    background: 'transparent',
                    color: active ? F.fenway : F.fg,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: SPACE.sm,
                    fontFamily: 'var(--font-sans)',
                    fontSize: TYPE.body.sm,
                    fontWeight: active ? 700 : 600,
                  }}
                >
                  <span>{feed.label}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: TYPE.meta.sm,
                    color: active ? F.fenway : F.fgMuted,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {feed.count}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <div className="dashboard-feed-filters" style={{
          display: 'flex',
          gap: SPACE.lg,
          overflowX: 'auto',
          paddingBottom: SPACE.xs,
          marginBottom: SPACE.xl,
        }}>
          {activeFeed === 'external'
            ? TOPIC_FILTERS.map((topic) => {
              const active = topic.id === selectedTopic;
              return (
                <button
                  key={topic.id}
                  onClick={() => setSelectedTopic(topic.id)}
                  title={topic.description}
                  style={{
                    height: 28,
                    padding: 0,
                    flexShrink: 0,
                    border: 'none',
                    borderBottom: `2px solid ${active ? F.fenway : 'transparent'}`,
                    borderRadius: 0,
                    background: 'transparent',
                    color: active ? F.fenway : F.fg,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: SPACE.sm,
                    fontFamily: 'var(--font-sans)',
                    fontSize: TYPE.body.sm,
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  <span>{topic.label}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: TYPE.meta.sm,
                    color: active ? F.fenway : F.fgMuted,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {topicCounts.get(topic.id) ?? 0}
                  </span>
                </button>
              );
            })
            : INTERNAL_FILTERS.map((topic) => {
              const active = topic.id === selectedInternalTopic;
              return (
                <button
                  key={topic.id}
                  onClick={() => setSelectedInternalTopic(topic.id)}
                  title={topic.description}
                  style={{
                    height: 28,
                    padding: 0,
                    flexShrink: 0,
                    border: 'none',
                    borderBottom: `2px solid ${active ? F.fenway : 'transparent'}`,
                    borderRadius: 0,
                    background: 'transparent',
                    color: active ? F.fenway : F.fg,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: SPACE.sm,
                    fontFamily: 'var(--font-sans)',
                    fontSize: TYPE.body.sm,
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  <span>{topic.label}</span>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: TYPE.meta.sm,
                    color: active ? F.fenway : F.fgMuted,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {internalTopicCounts.get(topic.id) ?? 0}
                  </span>
                </button>
              );
            })}
        </div>

        <div className={activeFeed === 'external' ? 'dashboard-feed-grid' : 'dashboard-feed-grid dashboard-feed-grid--single'}>
          <section style={{ minWidth: 0 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: SPACE.md,
              marginBottom: SPACE.md,
              paddingBottom: SPACE.sm,
              borderBottom: `1px solid ${F.border}`,
            }}>
              <div style={{
                fontFamily: 'var(--font-sans)',
                fontSize: TYPE.body.sm,
                fontWeight: 600,
                color: F.ink,
              }}>
                {activeFeed === 'external' ? 'External updates' : 'Internal updates'}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: TYPE.meta.md,
                color: F.fgMuted,
                letterSpacing: TRACKING.caps,
                textTransform: 'uppercase',
              }}>
                {activeItemCount} items
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {activeFeed === 'external'
                ? filteredExternalItems.map((item) => {
                  const itemKey = `external:${item.id}`;
                  return (
                    <ExternalFeedItemCard
                      key={item.id}
                      item={item}
                      analyzing={analyzingItemKey === itemKey}
                      disabled={analyzingItemKey !== null && analyzingItemKey !== itemKey}
                      onAnalyze={() => analyzeExternalItem(item)}
                    />
                  );
                })
                : filteredInternalItems.map((item) => {
                  const itemKey = `internal:${item.id}`;
                  return (
                    <InternalFeedItemCard
                      key={item.id}
                      item={item}
                      analyzing={analyzingItemKey === itemKey}
                      disabled={analyzingItemKey !== null && analyzingItemKey !== itemKey}
                      onAnalyze={() => analyzeInternalItem(item)}
                    />
                  );
                })}
            </div>
          </section>

          {activeFeed === 'external' && (
            <aside className="dashboard-feed-rail" style={{ minWidth: 0 }}>
              <KeyDatesRail />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function ExternalFeedItemCard({
  item,
  analyzing,
  disabled,
  onAnalyze,
}: {
  item: CapStrategyFeedItem;
  analyzing: boolean;
  disabled: boolean;
  onAnalyze: () => void;
}) {
  const urgency = urgencyStyle(item.urgency);

  return (
    <article className="dashboard-feed-item" style={{
      background: F.surface,
      borderBottom: `1px solid ${F.border}`,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: SPACE.sm,
        flexWrap: 'wrap',
        marginBottom: SPACE.xs,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.sm,
          fontWeight: 700,
          color: urgency.color,
          letterSpacing: TRACKING.micro,
          textTransform: 'uppercase',
        }}>
          {urgency.label}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.sm,
          color: F.fgMuted,
        }}>
          {item.sourceLabel} · {formatFeedDate(new Date(item.publishedAt))}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.sm,
          color: F.fgFaint,
          letterSpacing: TRACKING.caps,
        }}>
          {item.teams.join(' / ')}
        </span>
      </div>

      <h2 style={{
        margin: 0,
        fontFamily: 'var(--font-display)',
        fontSize: TYPE.display.md,
        lineHeight: 1.3,
        color: F.ink,
        fontWeight: 600,
        letterSpacing: TRACKING.tight,
      }}>
        {item.headline}
      </h2>

      <p style={{
        margin: `${SPACE.sm}px 0 0`,
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.md,
        color: F.inkSoft,
        lineHeight: 1.55,
      }}>
        {item.summary}
      </p>

      <p style={{
        marginTop: SPACE.md,
        marginBottom: 0,
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        color: F.ink,
        lineHeight: 1.5,
      }}>
        <strong>GSW angle:</strong> {item.gswAngle}
      </p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: SPACE.md }}>
        <div className="dashboard-feed-actions">
          <button
            onClick={onAnalyze}
            disabled={disabled || analyzing}
            title="Create an Analyze brief from this signal"
            style={{
              height: 30,
              padding: `0 ${SPACE.md}px`,
              border: 'none',
              borderRadius: RADIUS.md,
              background: disabled || analyzing ? F.cream100 : F.fenway,
              color: disabled || analyzing ? F.fgMuted : F.surface,
              cursor: disabled || analyzing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: SPACE.xs + 2,
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
              fontWeight: 600,
            }}
          >
            {analyzing ? 'Creating...' : 'Analyze'}
            {!analyzing && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

function InternalFeedItemCard({
  item,
  analyzing,
  disabled,
  onAnalyze,
}: {
  item: InternalFeedItem;
  analyzing: boolean;
  disabled: boolean;
  onAnalyze: () => void;
}) {
  const urgency = urgencyStyle(item.urgency);
  const sensitivityLabel = item.sensitivity === 'high'
    ? 'High sensitivity'
    : item.sensitivity === 'restricted'
      ? 'Restricted'
      : 'Internal';

  return (
    <article className="dashboard-feed-item" style={{
      background: F.surface,
      borderBottom: `1px solid ${F.border}`,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: SPACE.sm,
        flexWrap: 'wrap',
        marginBottom: SPACE.xs,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.sm,
          fontWeight: 700,
          color: urgency.color,
          letterSpacing: TRACKING.micro,
          textTransform: 'uppercase',
        }}>
          {urgency.label}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.sm,
          color: F.fgMuted,
        }}>
          {sensitivityLabel} · {item.sourceLabel} · {item.sourceOwner} · {formatFeedTimestamp(new Date(item.publishedAt))}
        </span>
      </div>

      <h2 style={{
        margin: 0,
        fontFamily: 'var(--font-display)',
        fontSize: TYPE.display.md,
        lineHeight: 1.3,
        color: F.ink,
        fontWeight: 600,
        letterSpacing: TRACKING.tight,
      }}>
        {item.headline}
      </h2>

      <p style={{
        margin: `${SPACE.sm}px 0 0`,
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.md,
        color: F.inkSoft,
        lineHeight: 1.55,
      }}>
        {item.summary}
      </p>

      <div style={{
        marginTop: SPACE.sm,
        fontFamily: 'var(--font-mono)',
        fontSize: TYPE.meta.sm,
        color: F.fgMuted,
        letterSpacing: TRACKING.body,
      }}>
        {item.teams.join(' / ')} · {item.players.join(' / ')}
      </div>

      <p style={{
        marginTop: SPACE.md,
        marginBottom: 0,
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        color: F.ink,
        lineHeight: 1.5,
      }}>
        <strong>Decision:</strong> {item.warriorsDecision}
      </p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: SPACE.md }}>
        <div className="dashboard-feed-actions">
          <button
            onClick={onAnalyze}
            disabled={disabled || analyzing}
            title="Create an Analyze brief from this internal update"
            style={{
              height: 30,
              padding: `0 ${SPACE.md}px`,
              border: 'none',
              borderRadius: RADIUS.md,
              background: disabled || analyzing ? F.cream100 : F.fenway,
              color: disabled || analyzing ? F.fgMuted : F.surface,
              cursor: disabled || analyzing ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: SPACE.xs + 2,
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
              fontWeight: 600,
            }}
          >
            {analyzing ? 'Creating...' : 'Analyze'}
            {!analyzing && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14" />
                <path d="m13 6 6 6-6 6" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

function KeyDatesRail() {
  return (
    <div style={{
      position: 'sticky',
      top: SPACE.xl,
    }}>
      <div style={{
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.sm,
        fontWeight: 700,
        color: F.ink,
        marginBottom: SPACE.sm,
      }}>
        Key dates
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.sm }}>
        {KEY_CAP_DATES.map((date) => (
          <div key={date.date} style={{
            paddingBottom: SPACE.sm,
            borderBottom: date === KEY_CAP_DATES[KEY_CAP_DATES.length - 1] ? 'none' : `1px solid ${F.border}`,
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: TYPE.meta.xs,
              color: F.fgMuted,
              fontWeight: 700,
              letterSpacing: TRACKING.micro,
              textTransform: 'uppercase',
            }}>
              {date.date}
            </div>
            <div style={{
              marginTop: 2,
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
              color: F.ink,
              fontWeight: 700,
              lineHeight: 1.25,
            }}>
              {date.label}
            </div>
            <div style={{
              marginTop: 3,
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
              color: F.fgMuted,
              lineHeight: 1.35,
            }}>
              {date.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
