export type QaMode = 'canonical' | 'adversarial';

export const CANONICAL_FLOW_NAMES = [
  'Live seller-move flow at meeting viewport',
  'Live seller-move flow at narrow viewport',
] as const;

export const ADVERSARIAL_FLOW_NAMES = [
  'Fresh market result is required',
  'Invalid proposed pick is rejected',
  'Retired cap room is unreachable',
] as const;
