import type { ProjectStepId } from '@shared/types';

export const NYG_DEMO_WORKSPACE_KEY = 'nyg-demo' as const;
export const NYG_HERO_SEED_KEY = 'nyg-cap-roster-2026' as const;
export const NYG_HERO_SESSION_ID = '72000000-0000-4000-8000-000000000001';
export const NYG_HERO_PROJECT_ID = '73000000-0000-4000-8000-000000000001';
export const RETIRED_NYG_ANALYSIS_FIXTURE_SEED_KEY = 'nyg-transaction-market-presenter' as const;
export const RETIRED_NYG_ANALYSIS_FIXTURE_SESSION_ID = '76000000-0000-4000-8000-000000000001';

export const NYG_STAGE_LABELS: Record<ProjectStepId, string> = {
  research: 'Question',
  validate: 'Evidence',
  feedback: 'Scenarios',
  gm: 'Decision',
  proposal: 'Action Plan',
};

export const NYG_HERO_PROJECT = {
  id: NYG_HERO_PROJECT_ID,
  title: '2026 cap flexibility without structural damage',
  question: 'Which verified path creates at least $15 million in 2026 relief while protecting quarterback and foundational depth?',
  objective: 'Choose the smallest source-backed transaction set that clears the relief target, with exact dead money, depth effects, rule authority, and named confirmation work.',
  workflow_type: 'decision',
  subject_team_id: 'NYG',
  counterparty_team_id: null,
  inbound_player_id: null,
  trigger_summary: 'Recompute after any signing, release, extension, contract-ledger refresh, or change to a protected player or position group.',
  counterparty_context: {
    cap_room: 'Public-data model; exact club planning room remains team-only and unconnected.',
    aims: 'Create verified room while protecting the football plan.',
    pressure: 'Meeting demonstration using public sources only.',
    job_security: '',
    known_targets: '',
    signals: 'Roster and cap snapshot refreshed within the 48-hour meeting-readiness gate.',
  },
  active_step: 'feedback',
  status: 'active',
  package_status: 'ready',
  source_brief_id: null,
} as const;

export const NYG_STAGE_NOTES: Array<{ id: string; step: ProjectStepId; body: string; ai_draft: string }> = [
  { id: '74000000-0000-4000-8000-000000000001', step: 'research', body: 'Set a $15 million 2026 relief target. Protect quarterback by default. Do not treat private club planning assumptions as public facts.', ai_draft: '' },
  { id: '74000000-0000-4000-8000-000000000002', step: 'validate', body: 'Attach the current Giants roster, contract ledger, deterministic arithmetic checks, and exact CBA transaction locators. Source-needed rows remain directional.', ai_draft: '' },
  { id: '74000000-0000-4000-8000-000000000003', step: 'feedback', body: 'Compare hold, preserve-depth, balanced, and maximum-relief branches. Football review is required for any medium- or high-impact move.', ai_draft: '' },
  { id: '74000000-0000-4000-8000-000000000004', step: 'gm', body: 'Select only after cap administration confirms the exact rows and football operations confirms the replacement plan.', ai_draft: '' },
  { id: '74000000-0000-4000-8000-000000000005', step: 'proposal', body: 'Assign owners for contract confirmation, depth review, medical context, transaction timing, and re-model triggers.', ai_draft: '' },
];

export const NYG_TASKS: Array<{ id: string; step: ProjectStepId; label: string; required: boolean; sort_order: number; completed: boolean }> = [
  { id: '75000000-0000-4000-8000-000000000001', step: 'research', label: 'Confirm the relief target and protected position groups.', required: true, sort_order: 0, completed: true },
  { id: '75000000-0000-4000-8000-000000000002', step: 'validate', label: 'Reconcile every displayed dollar to a captured or defensibly derived contract row.', required: true, sort_order: 0, completed: true },
  { id: '75000000-0000-4000-8000-000000000003', step: 'validate', label: 'Open each transaction rule at its exact official locator.', required: true, sort_order: 1, completed: true },
  { id: '75000000-0000-4000-8000-000000000004', step: 'feedback', label: 'Review medium- and high-impact depth effects with football operations.', required: true, sort_order: 0, completed: false },
  { id: '75000000-0000-4000-8000-000000000005', step: 'gm', label: 'Choose the smallest supported branch that clears the target.', required: true, sort_order: 0, completed: false },
  { id: '75000000-0000-4000-8000-000000000006', step: 'proposal', label: 'Assign transaction, replacement, and re-model owners.', required: true, sort_order: 0, completed: false },
];

export function assertNygSeedOwnership(): void {
  const ids = [
    NYG_HERO_SESSION_ID,
    NYG_HERO_PROJECT_ID,
    ...NYG_STAGE_NOTES.map((item) => item.id),
    ...NYG_TASKS.map((item) => item.id),
  ];
  if (new Set(ids).size !== ids.length) throw new Error('NYG demo seed identifiers must be unique');
  if (!NYG_HERO_SEED_KEY || NYG_HERO_PROJECT.subject_team_id !== 'NYG') throw new Error('NYG demo seed ownership is invalid');
  if (NYG_STAGE_NOTES.length !== 5 || new Set(NYG_STAGE_NOTES.map((item) => item.step)).size !== 5) {
    throw new Error('NYG demo seed must cover all five workspace stages exactly once');
  }
}
