/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  readonly VITE_ONBOARDING_TEAM_ID?: string;
  readonly VITE_DISABLE_ONBOARDING_GATE?: string;
  readonly VITE_FORCE_ANALYZE_START?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
