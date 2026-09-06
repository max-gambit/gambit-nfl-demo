import type {
  NflSellerMoveScenarioState,
  NflTransactionMarketResolvedQuery,
} from '@shared/types';
import { isNflTransactionMarketQuestion, isNflTransactionMarketRefinement } from './question.js';
import { parseNflSellerMoveTurn } from './seller_move_conversation.js';
import { classifyNflCurrentQuestion, type NflCurrentQuestionKind } from '../nfl_current/analysis.js';

export type NflAnalysisTurnIntent =
  | { kind: 'rules' }
  | { kind: 'seller_move' }
  | { kind: 'seller_modifier_without_context' }
  | { kind: 'current_team'; question_kind: NflCurrentQuestionKind }
  | { kind: 'transaction_market'; inherited_query: NflTransactionMarketResolvedQuery | null }
  | { kind: 'general' };

export interface NflAnalysisTurnContext {
  market_query: NflTransactionMarketResolvedQuery | null;
  seller_scenario: NflSellerMoveScenarioState | null;
}

/**
 * Server-owned routing for a new Analysis turn. Prior channel state is a
 * bounded input to classification; its mere existence never selects a route.
 */
export function classifyNflAnalysisTurn(
  question: string,
  context: NflAnalysisTurnContext,
): NflAnalysisTurnIntent {
  const value = question.trim();
  const currentQuestion = classifyNflCurrentQuestion(value);
  // Market filters such as "what about EDGE instead" must not be consumed
  // as a replacement player in an older seller scenario.
  if (!currentQuestion && context.market_query && isNflTransactionMarketRefinement(value)) {
    return { kind: 'transaction_market', inherited_query: context.market_query };
  }
  // Explicit requested calculations win over a rule word that may merely
  // qualify the scenario (for example, a trade "after June 1").
  if (parseNflSellerMoveTurn(value, context.seller_scenario)) {
    return { kind: 'seller_move' };
  }
  if (!context.seller_scenario && isSellerMoveModifier(value)) {
    return { kind: 'seller_modifier_without_context' };
  }

  if (currentQuestion) return { kind: 'current_team', question_kind: currentQuestion };

  if (context.market_query && isNflTransactionMarketFollowup(value)) {
    return { kind: 'transaction_market', inherited_query: context.market_query };
  }
  if (isNflTransactionMarketQuestion(value)) {
    return { kind: 'transaction_market', inherited_query: null };
  }
  if (isNflRulesQuestion(value)) return { kind: 'rules' };
  return { kind: 'general' };
}

export function isNflRulesQuestion(question: string): boolean {
  const value = question.trim();
  if (!value) return false;
  const directRuleLanguage = /\b(?:cba|collective bargaining|league rule|nfl rule|rules? for|rules? on|allowed under|permitted under)\b/i.test(value);
  const governedMechanic = /\b(?:post[- ]?june\s*1|waivers?|practice squad|reserve\/pup|pup list|non-football injury|nfi list|franchise tag|transition tag|rookie (?:deal|contract)|fifth[- ]year option|compensatory picks?|comp picks?|contract extensions?)\b/i.test(value);
  const asksForExplanation = /\b(?:what|how|when|explain|walk me through|does|do|can|could)\b/i.test(value);
  return directRuleLanguage || (governedMechanic && asksForExplanation);
}

export function isNflTransactionMarketFollowup(question: string): boolean {
  const value = question.trim();
  if (!value) return false;
  if (/^show me (?:the )?trades? behind (?:that|this|the (?:proposal|return))[?.!]*$/i.test(value)) return false;
  if (isNflTransactionMarketRefinement(value)) return true;
  if (/^what changed (?:before|after)\s+20\d{2}[?.!]*$/i.test(value)) return true;
  if (/^(?:which|what) recent transactions? (?:most )?(?:influenced|drove|changed) (?:that|this|the) (?:conclusion|result|analysis)[?.!]*$/i.test(value)) return true;
  if (/^(?:show|give) (?:me )?(?:the )?(?:supporting )?(?:transactions?|comparables?)[?.!]*$/i.test(value)) return true;
  return false;
}

export function isSellerMoveModifier(question: string): boolean {
  const value = question.trim();
  return /^make it (?:a |an |the )?(?:first|second|third|fourth|fifth|sixth|seventh|[1-7](?:st|nd|rd|th))\b/i.test(value)
    || /^use\s+20\d{2}\b/i.test(value)
    || /^what about\s+.+?\s+instead\??$/i.test(value)
    || /^show me (?:the )?trades? behind (?:that|this|the (?:proposal|return))[?.!]*$/i.test(value);
}
