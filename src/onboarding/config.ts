export const CONTEXT_GRAPH_ONBOARDING_TEAM_ID = (import.meta.env.VITE_ONBOARDING_TEAM_ID || 'GSW')
  .trim()
  .toUpperCase();
export const CONTEXT_GRAPH_ONBOARDING_DISABLED = import.meta.env.VITE_DISABLE_ONBOARDING_GATE === 'true';
export const CONTEXT_GRAPH_FORCE_ANALYZE_START = import.meta.env.VITE_FORCE_ANALYZE_START === 'true';

export function contextGraphOnboardingLocalKey(teamId = CONTEXT_GRAPH_ONBOARDING_TEAM_ID): string {
  return `gambit:onboarding:${teamId}:completed`;
}

export function contextGraphOnboardingLaunchBriefKey(teamId = CONTEXT_GRAPH_ONBOARDING_TEAM_ID): string {
  return `gambit:onboarding:${teamId}:launchBriefId`;
}

export function contextGraphOnboardingLaunchSessionKey(teamId = CONTEXT_GRAPH_ONBOARDING_TEAM_ID): string {
  return `gambit:onboarding:${teamId}:launchSessionId`;
}

export function contextGraphOnboardingLaunchDismissedKey(teamId = CONTEXT_GRAPH_ONBOARDING_TEAM_ID): string {
  return `gambit:onboarding:${teamId}:launchDismissed`;
}
