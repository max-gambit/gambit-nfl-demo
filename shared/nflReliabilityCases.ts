export interface NflReliabilityConversationCase {
  id: string;
  prior_question: string;
  prior_answer: string;
  question: string;
  expected: 'inherit_current_nfl' | 'fresh_scope';
}

export interface NflReliabilityIntentCase {
  id: string;
  question: string;
  expected: 'transaction_market' | 'rules' | 'seller_move';
}

const CURRENT_NFL_ROOTS = [
  {
    id: 'nabers-knee',
    question: "If we're concerned about Malik Nabers' knee in Week 1, what are realistic trade targets for us?",
    answer: 'For a Giants receiver contingency, start with Tre Tucker, Marvin Mims Jr., and Andrei Iosivas while treating availability as unconfirmed.',
  },
  {
    id: 'receiver-depth',
    question: 'Which receivers should the Giants call about if the current depth chart loses a starter?',
    answer: 'The Giants should separate short-term receiver rentals from multi-year acquisitions and confirm each seller before pricing a move.',
  },
  {
    id: 'edge-depth',
    question: 'If the Giants lose an EDGE starter, which trade targets fit the current roster and cap?',
    answer: 'The Giants should compare EDGE targets by role, contract fit, seller depth loss, and acquisition cost.',
  },
  {
    id: 'interior-line',
    question: 'Which interior offensive linemen should the Giants target in a trade?',
    answer: 'The Giants should keep guards and centers separate from defensive linemen and treat public line-quality evidence cautiously.',
  },
  {
    id: 'corner-depth',
    question: 'What are realistic Giants trade options if cornerback depth becomes a problem?',
    answer: 'The Giants should rank corner options by playable role, contract fit, seller motivation, and pick cost.',
  },
  {
    id: 'tight-end',
    question: 'Who could the Giants acquire if they need another receiving tight end?',
    answer: 'The Giants should distinguish a short rental from a player who changes the multi-year tight-end plan.',
  },
  {
    id: 'safety',
    question: 'Which safeties are plausible trade targets for the Giants this season?',
    answer: 'The Giants should validate role fit, availability, contract cost, and the seller case before advancing a safety target.',
  },
  {
    id: 'running-back',
    question: 'If the Giants need a veteran running back, which trade paths are realistic?',
    answer: 'The Giants should keep the pick ceiling low and compare veteran backs against internal replacement options.',
  },
] as const;

const CURRENT_NFL_FOLLOWUPS = [
  { id: 'those-first', question: 'Which of those targets should we call first?' },
  { id: 'rank-them', question: 'Rank them by acquisition cost and likely role.' },
  { id: 'season-threatening', question: 'What changes if it is season-threatening?' },
  { id: 'rentals', question: 'Keep this to rentals. Who moves to the top?' },
  { id: 'cap-fit', question: 'Which option fits our cap best?' },
  { id: 'day-three', question: 'Could we use only a Day 3 pick for those names?' },
  { id: 'internal', question: 'What about internal replacement options instead?' },
  { id: 'cap-risk', question: 'How does that change our cap risk?' },
  { id: 'multi-year', question: 'Give me the multi-year version of this plan.' },
  { id: 'he-six-weeks', question: 'If he misses six weeks, who moves up?' },
  { id: 'standing-pat', question: 'Compare these options against standing pat.' },
  { id: 'downside', question: 'What is the downside of that approach?' },
] as const;

const FRESH_SCOPE_QUESTIONS = [
  { id: 'bengals-guards', question: 'Which guards should the Bengals target in a trade?' },
  { id: 'cowboys-edge', question: 'Which EDGE players should the Cowboys call about?' },
  { id: 'eagles-corner', question: 'What cornerbacks should Philadelphia target instead?' },
  { id: 'ravens-receiver', question: 'Which receiver options fit Baltimore and its cap?' },
  { id: 'bills-safety', question: 'What about those safety needs for the Bills?' },
  { id: 'chiefs-tackle', question: 'Which offensive tackles should Kansas City pursue?' },
  { id: 'ownership-summary', question: 'Summarize the decision for ownership.' },
  { id: 'meeting-agenda', question: 'Draft a five-item agenda for the staff meeting.' },
  { id: 'scouting-template', question: 'Write a blank scouting memo template.' },
  { id: 'unrelated-budget', question: 'What should a normal travel budget include?' },
] as const;

const INTENT_CASES: readonly NflReliabilityIntentCase[] = [
  { id: 'market-ten-years', question: 'Which position markets have grown or shrunk over the last 10 years?', expected: 'transaction_market' },
  { id: 'market-edge-since-2018', question: 'Among trades since 2018, how has the EDGE market changed?', expected: 'transaction_market' },
  { id: 'market-before-after', question: 'Compare safety trade activity before and after 2020.', expected: 'transaction_market' },
  { id: 'market-compensation', question: 'Which positions most often returned Day 1 or Day 2 compensation?', expected: 'transaction_market' },
  { id: 'market-contracts', question: 'How has the veteran receiver contract market changed recently?', expected: 'transaction_market' },
  { id: 'market-comparables', question: 'Show historical EDGE trade comparables since 2019.', expected: 'transaction_market' },
  { id: 'market-mobility', question: 'Has cornerback mobility grown over the last five completed seasons?', expected: 'transaction_market' },
  { id: 'market-leaguewide', question: 'Across the NFL, compare recent running-back and safety transactions.', expected: 'transaction_market' },
  { id: 'rules-post-june', question: 'How does the post-June 1 trade rule work?', expected: 'rules' },
  { id: 'rules-waivers', question: 'What are the NFL rules for waivers?', expected: 'rules' },
  { id: 'rules-practice-squad', question: 'Explain the practice squad elevation rules.', expected: 'rules' },
  { id: 'rules-franchise-tag', question: 'When can a team use the franchise tag?', expected: 'rules' },
  { id: 'rules-fifth-year', question: 'How does a fifth-year option work?', expected: 'rules' },
  { id: 'rules-extension', question: 'What rules govern rookie contract extensions?', expected: 'rules' },
  { id: 'seller-burns-second', question: 'What if we moved Brian Burns for a 2027 second?', expected: 'seller_move' },
  { id: 'seller-burns-first', question: 'Would moving Brian Burns for a 2027 first be above the historical range?', expected: 'seller_move' },
  { id: 'seller-kayvon-third', question: 'Model moving Kayvon Thibodeaux for a 2028 third-round pick.', expected: 'seller_move' },
  { id: 'seller-lawrence-second', question: 'What if the Giants traded Dexter Lawrence for a 2027 second?', expected: 'seller_move' },
] as const;

export function buildNflReliabilityConversationCases(): NflReliabilityConversationCase[] {
  const continuations = CURRENT_NFL_ROOTS.flatMap((root) => CURRENT_NFL_FOLLOWUPS.map((followup) => ({
    id: `followup:${root.id}:${followup.id}`,
    prior_question: root.question,
    prior_answer: root.answer,
    question: followup.question,
    expected: 'inherit_current_nfl' as const,
  })));
  const freshScopes = CURRENT_NFL_ROOTS.flatMap((root) => FRESH_SCOPE_QUESTIONS.map((fresh) => ({
    id: `fresh:${root.id}:${fresh.id}`,
    prior_question: root.question,
    prior_answer: root.answer,
    question: fresh.question,
    expected: 'fresh_scope' as const,
  })));
  return [...continuations, ...freshScopes];
}

export function buildNflReliabilityIntentCases(): NflReliabilityIntentCase[] {
  return [...INTENT_CASES];
}

export const NFL_RELIABILITY_LIVE_SCENARIOS = [
  {
    id: 'current-followup-scope',
    turns: [
      {
        id: 'nabers-initial',
        question: CURRENT_NFL_ROOTS[0].question,
        expectation: 'current_nfl' as const,
      },
      {
        id: 'nabers-followup',
        question: 'Is the Nabers concern a multi-week absence or season-threatening? That changes rental vs. multi-year target logic.',
        expectation: 'current_nfl_followup' as const,
      },
    ],
  },
  {
    id: 'seller-interpretation-grounding',
    turns: [
      {
        id: 'burns-2027-second',
        question: 'Since 2018, how has the EDGE trade market changed, and if we traded Brian Burns for a 2027 second-round pick, would that be above or below the historical range?',
        expectation: 'seller_move' as const,
      },
    ],
  },
] as const;

export const NFL_RELIABILITY_DETERMINISTIC_CASE_COUNT =
  CURRENT_NFL_ROOTS.length * (CURRENT_NFL_FOLLOWUPS.length + FRESH_SCOPE_QUESTIONS.length)
  + INTENT_CASES.length;
