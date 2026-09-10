/** Shared writing contract for all football answers, including follow-ups. */
export const NFL_COMMUNICATION_RULES = `Write directly to an experienced front-office colleague about the player, contract or decision. Keep the software and research process out of the answer unless the user asks about them.
- State the fact or action itself: "Annual cash is unchanged; confirm the payment dates." Avoid "The model preserves annual cash, not necessarily payment timing."
- State a material condition once, where it affects the decision. "Confirm enough unpaid salary remains after the applicable minimum" is useful. Commentary about a calculator's conservative check or lack of transaction clearance is not an additional action.
- Keep the hypothetical basis, source dates, attribution and genuine unknowns when they change the meaning. Express them briefly: "Under these terms", "Price and availability are unknown", or "Confirm the current cap ledger". Do not append a second explanation about what an illustration, public dossier or snapshot cannot certify.
- Answer the new question in a follow-up. Reuse the established scenario; do not recap acquisition costs, reserves, protections and all previous qualifications unless they change or are needed to answer that question. A narrow verification question normally needs 100–180 words with concrete checks, not a fresh full transaction memo.
- Retain specific contract rights, consent, unpaid salary, credited-season salary minima, payment timing and guarantee conditions when relevant. Remove generic approval language, repeated sign-off warnings, and advice to consult departments unless an actual missing decision or document makes that action useful.
- Put source mechanics and routine methodology in supporting details or source references. Do not turn concise, appropriately qualified football conclusions into a tour of the evidence system.`;

/** QA regression signals, not a production rejection or a prose-deletion filter. */
export function nflCommunicationIssues(question: string, answer: string): string[] {
  if (/\b(?:how|what|explain|describe|inspect|show)\b.{0,60}\b(?:calculator|model(?:ing|ling)? (?:methods?|assumptions?|limitations?)|data (?:sources?|coverage)|methodology|tools?|system|app)\b/i.test(question)) return [];
  const patterns = [
    /\b(?:the|this|our) (?:calculator|model|tool|system|app)(?:['’]s)? (?:conservative |annual-floor )?(?:check|preserves?|calculates?|supports?|does not|doesn't|cannot|can only|only)\b/i,
    /\b(?:public (?:cap )?(?:captures|snapshots)|(?:the |a |saved )*illustration)\b[^.!?]{0,95}\b(?:cannot certify|does not (?:establish|certify)|establishes neither|not (?:proof|evidence))\b/i,
    /\b(?:public dossier|evidence pack|tool output)\b[^.!?]{0,40}\b(?:already reports|establishes|supports|does not)\b/i,
    /\b(?:conditional financing|transaction-date clearance|verified executable room)\b/i,
  ];
  return answer.split(/(?<=[.!?])\s+/).filter(sentence => patterns.some(pattern => pattern.test(sentence)));
}
