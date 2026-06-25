export const NBA_TEAM_IDS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
] as const;

export type NbaTeamId = typeof NBA_TEAM_IDS[number];

export const TEAM_ID_SET = new Set<string>(NBA_TEAM_IDS);

export const TEAM_ALIASES: Record<string, NbaTeamId> = {
  ATL: 'ATL',
  HAWKS: 'ATL',
  ATLANTA: 'ATL',
  'ATLANTA HAWKS': 'ATL',
  BOS: 'BOS',
  CELTICS: 'BOS',
  BOSTON: 'BOS',
  'BOSTON CELTICS': 'BOS',
  BKN: 'BKN',
  BRK: 'BKN',
  NETS: 'BKN',
  BROOKLYN: 'BKN',
  'BROOKLYN NETS': 'BKN',
  CHA: 'CHA',
  CHO: 'CHA',
  HORNETS: 'CHA',
  CHARLOTTE: 'CHA',
  'CHARLOTTE HORNETS': 'CHA',
  CHI: 'CHI',
  BULLS: 'CHI',
  CHICAGO: 'CHI',
  'CHICAGO BULLS': 'CHI',
  CLE: 'CLE',
  CAVALIERS: 'CLE',
  CAVS: 'CLE',
  CLEVELAND: 'CLE',
  'CLEVELAND CAVALIERS': 'CLE',
  DAL: 'DAL',
  MAVERICKS: 'DAL',
  MAVS: 'DAL',
  DALLAS: 'DAL',
  'DALLAS MAVERICKS': 'DAL',
  DEN: 'DEN',
  NUGGETS: 'DEN',
  DENVER: 'DEN',
  'DENVER NUGGETS': 'DEN',
  DET: 'DET',
  PISTONS: 'DET',
  DETROIT: 'DET',
  'DETROIT PISTONS': 'DET',
  GSW: 'GSW',
  WARRIORS: 'GSW',
  'GOLDEN STATE': 'GSW',
  'GOLDEN STATE WARRIORS': 'GSW',
  HOU: 'HOU',
  ROCKETS: 'HOU',
  HOUSTON: 'HOU',
  'HOUSTON ROCKETS': 'HOU',
  IND: 'IND',
  PACERS: 'IND',
  INDIANA: 'IND',
  'INDIANA PACERS': 'IND',
  LAC: 'LAC',
  CLIPPERS: 'LAC',
  'LA CLIPPERS': 'LAC',
  'LOS ANGELES CLIPPERS': 'LAC',
  LAL: 'LAL',
  LAKERS: 'LAL',
  'LOS ANGELES LAKERS': 'LAL',
  MEM: 'MEM',
  GRZ: 'MEM',
  GRIZZLIES: 'MEM',
  MEMPHIS: 'MEM',
  'MEMPHIS GRIZZLIES': 'MEM',
  MIA: 'MIA',
  HEAT: 'MIA',
  MIAMI: 'MIA',
  'MIAMI HEAT': 'MIA',
  MIL: 'MIL',
  BUCKS: 'MIL',
  MILWAUKEE: 'MIL',
  'MILWAUKEE BUCKS': 'MIL',
  MIN: 'MIN',
  TIMBERWOLVES: 'MIN',
  WOLVES: 'MIN',
  MINNESOTA: 'MIN',
  'MINNESOTA TIMBERWOLVES': 'MIN',
  NOP: 'NOP',
  PELICANS: 'NOP',
  'NEW ORLEANS': 'NOP',
  'NEW ORLEANS PELICANS': 'NOP',
  NYK: 'NYK',
  KNICKS: 'NYK',
  'NEW YORK': 'NYK',
  'NEW YORK KNICKS': 'NYK',
  OKC: 'OKC',
  THUNDER: 'OKC',
  OKLAHOMA: 'OKC',
  'OKLAHOMA CITY': 'OKC',
  'OKLAHOMA CITY THUNDER': 'OKC',
  ORL: 'ORL',
  MAGIC: 'ORL',
  ORLANDO: 'ORL',
  'ORLANDO MAGIC': 'ORL',
  PHI: 'PHI',
  SIXERS: 'PHI',
  '76ERS': 'PHI',
  PHILADELPHIA: 'PHI',
  'PHILADELPHIA 76ERS': 'PHI',
  PHX: 'PHX',
  SUNS: 'PHX',
  PHOENIX: 'PHX',
  'PHOENIX SUNS': 'PHX',
  POR: 'POR',
  BLAZERS: 'POR',
  PORTLAND: 'POR',
  'PORTLAND TRAIL BLAZERS': 'POR',
  SAC: 'SAC',
  KINGS: 'SAC',
  SACRAMENTO: 'SAC',
  'SACRAMENTO KINGS': 'SAC',
  SAS: 'SAS',
  SAN: 'SAS',
  SPURS: 'SAS',
  'SAN ANTONIO': 'SAS',
  'SAN ANTONIO SPURS': 'SAS',
  TOR: 'TOR',
  RAPTORS: 'TOR',
  TORONTO: 'TOR',
  'TORONTO RAPTORS': 'TOR',
  UTA: 'UTA',
  UTAH: 'UTA',
  JAZZ: 'UTA',
  'UTAH JAZZ': 'UTA',
  WAS: 'WAS',
  WSH: 'WAS',
  WIZARDS: 'WAS',
  WASHINGTON: 'WAS',
  'WASHINGTON WIZARDS': 'WAS',
};

export const VOCAB = {
  conference: ['Eastern', 'Western'],
  division: ['Atlantic', 'Central', 'Southeast', 'Northwest', 'Pacific', 'Southwest'],
  marketTier: ['tier_1', 'tier_2', 'tier_3'],
  confidence: ['high', 'medium', 'low'],
  ownerType: ['individual', 'group', 'corporate'],
  postureTimeframe: ['contend_now', 'contend_soon', 'retool', 'rebuild', 'tank', 'purgatory'],
  capCurrentStatus: ['below_cap', 'below_apron', 'below_first_apron', 'above_first_apron', 'between_aprons', 'second_apron'],
  hardCapped: ['yes', 'no', 'unknown'],
  spendingPosture: ['aggressive_spender', 'moderate', 'conservative', 'unknown'],
  physicalPosition: ['lead_guard', 'combo_guard', 'wing', 'forward', 'big', 'unknown'],
  offensiveRole: [
    'primary_initiator', 'secondary_creator', 'tertiary_scorer', 'connector',
    'finisher', 'spacer', 'post_hub', 'screen_setter', 'iso_creator',
    'rim_protector', 'point_of_attack', 'unknown',
  ],
  defensiveRole: ['point_of_attack', 'wing_stopper', 'switchable', 'rim_protector', 'helper', 'liability', 'unknown'],
  shootingProfile: ['elite', 'good', 'functional', 'non_shooter', 'unknown'],
  specialTraits: [
    'elite_passer', 'elite_rebounder', 'iso_creator', 'pnr_maestro',
    'offensive_rebound_specialist', 'transition_threat', 'foul_drawer',
    'elite_athlete', 'vet_leadership', 'injury_prone', 'playoff_riser',
    'playoff_shrinker', 'switchable', 'elite_shooter', 'rim_protector',
    'young_core_centerpiece', 'defensive_versatility', 'declining_peak',
    'generational_talent', 'defensive_anchor', 'unknown',
  ],
  playerTier: ['superstar', 'star', 'starter', 'rotation', 'fringe', 'two_way'],
  trajectory: ['ascending', 'peak', 'declining_peak', 'declining', 'flat', 'unknown', 'uncertain'],
  contractType: ['standard', 'two_way', 'ten_day', 'exhibit_10', 'g_league_affiliate'],
  availabilityStatus: [
    'healthy', 'injured_short_term', 'injured_long_term', 'season_ending',
    'injured_season_ending', 'retirement_consideration', 'unknown',
  ],
  noTradeClause: ['full', 'partial', 'none', 'unknown'],
  birdRights: ['full', 'early', 'non', 'restricted', 'unknown'],
  movementStatus: ['untouchable', 'unlikely', 'available', 'shopped', 'actively_traded', 'unavailable'],
  signalStrength: [
    'confirmed_shopped', 'widely_reported', 'single_source_reported',
    'inferred_from_actions', 'rumor_only', 'denied_publicly', 'unknown',
  ],
  untouchableReason: [
    'franchise_brand_equity', 'ownership_relationship', 'generational_talent',
    'homegrown_loyalty', 'full_no_trade_clause', 'recent_extension_poison_pill',
    'trade_kicker_prohibitive', 'fan_economics', 'locker_room_anchor',
    'young_core_centerpiece', 'coach_relationship', 'deferred_compensation',
    'media_market_value', 'recently_acquired',
  ],
  availableReason: [
    'contract_expiring', 'positional_redundancy', 'locker_room_friction',
    'declining_role', 'cap_relief_target', 'player_unhappy',
    'coach_player_conflict', 'rebuild_pivot', 'extension_decline',
    'behind_younger_player', 'injury_recovery_uncertain', 'tax_apron_pressure',
    'expiring_contract_value', 'failed_fit',
  ],
  movementReason: [
    'franchise_brand_equity', 'ownership_relationship', 'generational_talent',
    'homegrown_loyalty', 'full_no_trade_clause', 'recent_extension_poison_pill',
    'trade_kicker_prohibitive', 'fan_economics', 'locker_room_anchor',
    'young_core_centerpiece', 'coach_relationship', 'deferred_compensation',
    'media_market_value', 'recently_acquired', 'contract_expiring',
    'positional_redundancy', 'locker_room_friction', 'declining_role',
    'cap_relief_target', 'player_unhappy', 'coach_player_conflict',
    'rebuild_pivot', 'extension_decline', 'behind_younger_player',
    'injury_recovery_uncertain', 'tax_apron_pressure',
    'tax_apron_constraints', 'expiring_contract_value', 'failed_fit',
    'aging_core', 'young_core_developing', 'recent_acquisition_poison_pill',
    'age', 'draft_pick_equity', 'vet_leadership', 'positional_fit',
    'ascending_trajectory', 'playoff_riser', 'positional_scarcity',
    'contract_leverage', 'age_decline_risk', 'complementary_role',
    'free_agency_incoming', 'low_salary_moveable', 'backup_center_role',
    'veteran_minimum_role', 'draft_pick_development', 'development_contract',
    'age_profile', 'age_decline', 'restricted_via_qualifying_offer',
    'positional_need', 'trade_deadline_consolidation', 'injury_prone',
    'backup_role', 'age_and_durability', 'connector', 'extension_recent',
    'restricted_free_agent_after_season', 'age_decline_expected',
    'primary_initiator_scarcity',
  ],
  postureConstraintReason: [
    'aging_core', 'young_core_developing', 'max_contract_lockup',
    'ownership_directive', 'coach_mandate', 'recent_playoff_success',
    'multi_year_lottery', 'new_front_office', 'tax_apron_constraints',
    'hard_cap_acceptance', 'coaching_decision_pending', 'market_pressure',
    'media_deal_inflection', 'arena_inflection', 'tanking_for_pick',
    'ownership_transition', 'second_apron_hard_cap',
    'second_apron_constraints', 'injury_recovery_uncertain',
  ],
  stability: ['high', 'medium', 'low'],
  playerFriendly: ['yes', 'mixed', 'no'],
  analyticsOrientation: ['heavy', 'balanced', 'traditional', 'unknown'],
  riskTolerance: ['aggressive', 'moderate', 'conservative'],
  notableTraits: [
    'family_culture', 'developmental_org', 'veteran_friendly', 'chaotic',
    'process_driven', 'star_chasing', 'homegrown_priority', 'coach_carousel',
    'media_market_pressure', 'popovich_tree', 'budenholzer_tree', 'nurse_tree',
    'mazzulla_tree', 'kerr_tree',
    'thibodeau_tree', 'dantoni_tree', 'new_front_office',
    'young_core_developing', 'coach_relationship', 'arena_inflection',
    'tanking_for_pick', 'defensive_identity', 'coaching_decision_pending',
  ],
  rivalryType: [
    'competitive_recent', 'competitive_historical', 'geographic',
    'personnel_grudge', 'playoff_rematch', 'media_manufactured',
    'incident_based', 'recent_competitive',
  ],
  contractLeverage: ['high', 'medium', 'low', 'none', 'unknown'],
  homegrown: ['yes', 'no', 'unknown'],
  freeAgentType: ['UFA', 'RFA', 'restricted_via_qualifying_offer'],
  expectedMarket: ['retain', 'walk', 'uncertain', 're_sign_likely', 'bidding_war', 'let_walk'],
  targetOutcome: ['acquired', 'declined', 'not_acquired', 'pursued_no_deal', 'redirected', 'actively_traded', 'traded', 'let_walk'],
  priorityType: ['extension', 'free_agency', 'trade', 'coaching_decision', 'draft', 'structural', 'roster'],
  priorityTimeline: ['next_30_days', 'this_offseason', 'by_trade_deadline', 'this_season', 'next_season'],
} as const;

export interface ValidationMessage {
  severity: 'error' | 'warning';
  file: string;
  path: string;
  message: string;
  line?: number;
}

export interface TeamDocument {
  filePath: string;
  fileName: string;
  teamId: string;
  data: Record<string, unknown>;
  lineForPath(path: string): number | undefined;
  parseErrors: ValidationMessage[];
}

export interface PickOwnershipEdge {
  type: 'pick_ownership';
  owning_team: string;
  owed_team: string;
  year: number;
  round: 1 | 2;
  protections: string;
  condition: string | null;
  conditional: boolean;
  source_path: string;
}

export interface TradePartnerEdge {
  type: 'trade_partner';
  team_a: string;
  team_b: string;
  trade_count_recent: number;
  last_trade_date: string | null;
  source_paths: string[];
}

export interface RivalryEdge {
  type: 'rivalry';
  team_a: string;
  team_b: string;
  rivalry_type: string;
  basis: string;
  requires_reciprocal: boolean;
  source_path: string;
}

export interface PersonnelConnectionEdge {
  type: 'personnel_connection';
  team_with_entry: string;
  person_name: string;
  connected_team: string;
  connection_type: string;
  source_path: string;
}

export interface PlayerTeamEdge {
  type: 'player_team';
  player_id: string;
  team_id: string;
  contract_type: string;
  tier: string;
  years_remaining: number | string | null;
  source_path: string;
}

export interface PendingFreeAgentEdge {
  type: 'pending_free_agent';
  player_id: string;
  team_id: string;
  free_agent_type: string;
  expected_market: string;
  source_path: string;
}

export interface HistoricalPursuitEdge {
  type: 'historical_pursuit';
  pursuer_team: string;
  target_name: string;
  year: number | string;
  outcome: string;
  source_path: string;
}

export interface EdgeGraph {
  pickOwnership: PickOwnershipEdge[];
  tradePartners: TradePartnerEdge[];
  rivalries: RivalryEdge[];
  personnelConnections: PersonnelConnectionEdge[];
  playerTeams: PlayerTeamEdge[];
  pendingFreeAgents: PendingFreeAgentEdge[];
  historicalPursuits: HistoricalPursuitEdge[];
}

export interface ValidationReport {
  schemaErrors: ValidationMessage[];
  crossTeamErrors: ValidationMessage[];
  crossTeamWarnings: ValidationMessage[];
  totalErrors: number;
  totalWarnings: number;
  passed: boolean;
}

export function isNbaTeamId(value: unknown): value is NbaTeamId {
  return typeof value === 'string' && TEAM_ID_SET.has(value);
}

export function normalizeTeamAlias(value: unknown): NbaTeamId | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ').toUpperCase();
  if (clean in TEAM_ALIASES) return TEAM_ALIASES[clean];
  return null;
}
