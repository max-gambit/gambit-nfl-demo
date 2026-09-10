import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nflCommunicationIssues } from '../../src/nfl_conversation/communication.js';

test('contract and funding QA catches software commentary across players and scenarios', () => {
  for (const answer of [
    'The calculator’s conservative annual-floor check is not transaction-date clearance.',
    'The model preserves annual cash, not necessarily payment timing.',
    'Public cap captures disagree and cannot certify the available budget.',
    'The saved illustration establishes neither availability nor price.',
    'The proposed Smith conversion remains conditional financing, not verified executable room.',
  ]) assert.ok(nflCommunicationIssues('What must we verify before converting salary?', answer).length, answer);
});

test('QA keeps direct checks, hypothetical terms and meaningful financial distinctions', () => {
  const answer = 'Confirm enough unpaid salary remains after the applicable minimum for his credited seasons. Check conversion rights, consent, payment dates and guarantee terms. Under these terms, annual cash is unchanged and $1 million moves from 2026 to 2027 cap. Confirm the current cap ledger and retain the reserve. Price and availability remain unknown.';
  assert.deepEqual(nflCommunicationIssues('What must we verify?', answer), []);
  assert.deepEqual(nflCommunicationIssues('What changes at a lower budget?', 'The acquisition costs $3 million of cap and $4 million of cash under your hypothetical terms. Another $1 million of cap room is needed to preserve the reserve.'), []);
});

test('scouting conclusions retain attribution, model projections and real unknowns', () => {
  assert.deepEqual(nflCommunicationIssues('Who gets the first look?', 'Start with Slayton for the practice review. His 2025 receiving yards lead this group; verify route assignments and workload capacity. The supplied scouting model projects a larger role, with its grade attributed to the scouting staff.'), []);
  assert.ok(nflCommunicationIssues('Who should we investigate?', 'His public dossier already reports the contract term. The model supports a shortlist, not an acquisition decision.').length);
});

test('explicit methodology and source questions may discuss the calculator and evidence', () => {
  const answer = 'The calculator’s conservative annual-floor check is not transaction-date clearance.';
  assert.deepEqual(nflCommunicationIssues('How does the calculator work?', answer), []);
  assert.deepEqual(nflCommunicationIssues('Explain the model assumptions.', answer), []);
  assert.deepEqual(nflCommunicationIssues('What data sources are you using?', 'Public cap captures disagree and cannot certify the available budget.'), []);
});
