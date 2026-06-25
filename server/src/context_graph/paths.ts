import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(moduleDir, '../../..');
export const DEFAULT_CONTEXT_GRAPH_DIR = path.join(REPO_ROOT, 'data', 'nba-context-graph');
export const DEFAULT_TEAMS_DIR = path.join(DEFAULT_CONTEXT_GRAPH_DIR, 'teams');
export const DEFAULT_DERIVED_DIR = path.join(DEFAULT_CONTEXT_GRAPH_DIR, 'derived');
export const DEFAULT_OVERRIDES_DIR = path.join(DEFAULT_CONTEXT_GRAPH_DIR, 'overrides');
export const DEFAULT_TEAM_PREFERENCES_OVERRIDES_FILE = path.join(DEFAULT_OVERRIDES_DIR, 'team-preferences.local.json');
export const DEFAULT_TEAM_MEMORY_FILE = path.join(DEFAULT_OVERRIDES_DIR, 'team-memory.local.json');
