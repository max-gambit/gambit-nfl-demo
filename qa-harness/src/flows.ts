export type QaMode = 'canonical' | 'adversarial';

export const CANONICAL_FLOW_NAMES = [
  'Presenter cold start',
  'Data-health preflight',
  'Hero branch comparison',
  'Changing target relief',
  'Protecting a position group',
  'Evidence and rule drilldown',
  'What changes the call',
  'Workspace handoff and client draft',
  'Roster and cap supporting view',
  'Offline follow-up',
  'Private-data refusal',
  'Reload and presentation reset',
  'Responsive layout',
  'Zero active NBA terminology',
] as const;

export const ADVERSARIAL_FLOW_NAMES = [
  'Impossible relief target',
  'Invalid dollar input',
  'Protected-group invariant',
  'Branch arithmetic reconciliation',
  'Unsupported rule abstention',
  'Stale or fallback blocking state',
  'Private-input refusal',
  'Active-output contamination scan',
] as const;
