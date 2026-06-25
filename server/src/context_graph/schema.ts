export const NBA_TEAM_IDS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN',
  'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA',
  'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB',
  'TEN', 'WAS',
] as const;

export type NbaTeamId = typeof NBA_TEAM_IDS[number];

export const TEAM_ID_SET = new Set<string>(NBA_TEAM_IDS);

export const TEAM_ALIASES: Record<string, NbaTeamId> = {
  ARI: 'ARI', CARDINALS: 'ARI', ARIZONA: 'ARI', 'ARIZONA CARDINALS': 'ARI',
  ATL: 'ATL', FALCONS: 'ATL', ATLANTA: 'ATL', 'ATLANTA FALCONS': 'ATL',
  BAL: 'BAL', RAVENS: 'BAL', BALTIMORE: 'BAL', 'BALTIMORE RAVENS': 'BAL',
  BUF: 'BUF', BILLS: 'BUF', BUFFALO: 'BUF', 'BUFFALO BILLS': 'BUF',
  CAR: 'CAR', PANTHERS: 'CAR', CAROLINA: 'CAR', 'CAROLINA PANTHERS': 'CAR',
  CHI: 'CHI', BEARS: 'CHI', CHICAGO: 'CHI', 'CHICAGO BEARS': 'CHI',
  CIN: 'CIN', BENGALS: 'CIN', CINCINNATI: 'CIN', 'CINCINNATI BENGALS': 'CIN',
  CLE: 'CLE', BROWNS: 'CLE', CLEVELAND: 'CLE', 'CLEVELAND BROWNS': 'CLE',
  DAL: 'DAL', COWBOYS: 'DAL', DALLAS: 'DAL', 'DALLAS COWBOYS': 'DAL',
  DEN: 'DEN', BRONCOS: 'DEN', DENVER: 'DEN', 'DENVER BRONCOS': 'DEN',
  DET: 'DET', LIONS: 'DET', DETROIT: 'DET', 'DETROIT LIONS': 'DET',
  GB: 'GB', GNB: 'GB', PACKERS: 'GB', 'GREEN BAY': 'GB', 'GREEN BAY PACKERS': 'GB',
  HOU: 'HOU', TEXANS: 'HOU', HOUSTON: 'HOU', 'HOUSTON TEXANS': 'HOU',
  IND: 'IND', COLTS: 'IND', INDIANAPOLIS: 'IND', 'INDIANAPOLIS COLTS': 'IND',
  JAX: 'JAX', JAC: 'JAX', JAGUARS: 'JAX', JACKSONVILLE: 'JAX', 'JACKSONVILLE JAGUARS': 'JAX',
  KC: 'KC', KAN: 'KC', CHIEFS: 'KC', 'KANSAS CITY': 'KC', 'KANSAS CITY CHIEFS': 'KC',
  LAC: 'LAC', CHARGERS: 'LAC', 'LOS ANGELES CHARGERS': 'LAC', 'LA CHARGERS': 'LAC',
  LAR: 'LAR', RAMS: 'LAR', 'LOS ANGELES RAMS': 'LAR', 'LA RAMS': 'LAR',
  LV: 'LV', LVR: 'LV', RAIDERS: 'LV', 'LAS VEGAS': 'LV', 'LAS VEGAS RAIDERS': 'LV',
  MIA: 'MIA', DOLPHINS: 'MIA', MIAMI: 'MIA', 'MIAMI DOLPHINS': 'MIA',
  MIN: 'MIN', VIKINGS: 'MIN', MINNESOTA: 'MIN', 'MINNESOTA VIKINGS': 'MIN',
  NE: 'NE', NWE: 'NE', PATRIOTS: 'NE', 'NEW ENGLAND': 'NE', 'NEW ENGLAND PATRIOTS': 'NE',
  NO: 'NO', NOR: 'NO', SAINTS: 'NO', 'NEW ORLEANS': 'NO', 'NEW ORLEANS SAINTS': 'NO',
  NYG: 'NYG', GIANTS: 'NYG', 'NEW YORK GIANTS': 'NYG',
  NYJ: 'NYJ', JETS: 'NYJ', 'NEW YORK JETS': 'NYJ',
  PHI: 'PHI', EAGLES: 'PHI', PHILADELPHIA: 'PHI', 'PHILADELPHIA EAGLES': 'PHI',
  PIT: 'PIT', STEELERS: 'PIT', PITTSBURGH: 'PIT', 'PITTSBURGH STEELERS': 'PIT',
  SEA: 'SEA', SEAHAWKS: 'SEA', SEATTLE: 'SEA', 'SEATTLE SEAHAWKS': 'SEA',
  SF: 'SF', SFO: 'SF', '49ERS': 'SF', NINERS: 'SF', 'SAN FRANCISCO': 'SF', 'SAN FRANCISCO 49ERS': 'SF',
  TB: 'TB', TAM: 'TB', BUCCANEERS: 'TB', BUCS: 'TB', TAMPA: 'TB', 'TAMPA BAY': 'TB', 'TAMPA BAY BUCCANEERS': 'TB',
  TEN: 'TEN', TITANS: 'TEN', TENNESSEE: 'TEN', 'TENNESSEE TITANS': 'TEN',
  WAS: 'WAS', WSH: 'WAS', COMMANDERS: 'WAS', WASHINGTON: 'WAS', 'WASHINGTON COMMANDERS': 'WAS',
};

export const VOCAB = {
  conference: ['AFC', 'NFC'],
  division: ['AFC East', 'AFC North', 'AFC South', 'AFC West', 'NFC East', 'NFC North', 'NFC South', 'NFC West'],
  marketTier: ['tier_1', 'tier_2', 'tier_3'],
  confidence: ['high', 'medium', 'low'],
  ownerType: ['individual', 'group', 'corporate'],
  postureTimeframe: ['contend_now', 'contend_soon', 'retool', 'rebuild', 'tank', 'purgatory'],
  capCurrentStatus: ['cap_room', 'near_cap', 'over_cap', 'restructure_needed', 'cash_constrained', 'unknown'],
  hardCapped: ['yes', 'no', 'unknown'],
  spendingPosture: ['aggressive_spender', 'moderate', 'conservative', 'unknown'],
  physicalPosition: ['quarterback', 'running_back', 'receiver', 'tight_end', 'offensive_line', 'defensive_line', 'edge', 'linebacker', 'cornerback', 'safety', 'specialist', 'unknown'],
  offensiveRole: [
    'franchise_quarterback', 'bridge_quarterback', 'early_down_runner', 'receiving_back',
    'primary_receiver', 'field_stretcher', 'slot_receiver', 'move_tight_end',
    'inline_blocker', 'blindside_protector', 'interior_anchor', 'depth_piece', 'unknown',
  ],
  defensiveRole: ['edge_rusher', 'interior_disruptor', 'off_ball_linebacker', 'slot_corner', 'outside_corner', 'single_high_safety', 'box_safety', 'run_defender', 'coverage_depth', 'not_applicable', 'unknown'],
  shootingProfile: ['not_applicable', 'elite', 'good', 'functional', 'unknown'],
  specialTraits: [
    'elite_arm', 'processing_speed', 'yards_after_catch', 'explosive_playmaker',
    'route_technician', 'pass_protection', 'run_blocking', 'positional_versatility',
    'pressure_generator', 'coverage_versatility', 'special_teams_value',
    'vet_leadership', 'injury_prone', 'playoff_riser', 'young_core_centerpiece',
    'defensive_anchor', 'unknown',
  ],
  playerTier: ['elite', 'core_starter', 'starter', 'rotation', 'depth', 'practice_squad'],
  trajectory: ['ascending', 'peak', 'declining_peak', 'declining', 'flat', 'unknown', 'uncertain'],
  contractType: ['standard', 'rookie', 'franchise_tag', 'transition_tag', 'practice_squad', 'reserve_future'],
  availabilityStatus: [
    'healthy', 'injured_short_term', 'injured_long_term', 'season_ending',
    'injured_season_ending', 'retirement_consideration', 'unknown',
  ],
  noTradeClause: ['full', 'partial', 'none', 'unknown'],
  birdRights: ['tag_eligible', 'option_eligible', 'extension_eligible', 'not_applicable', 'unknown'],
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
    'positional_need',
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
  freeAgentType: ['UFA', 'RFA', 'ERFA', 'tag_candidate', 'option_pending'],
  expectedMarket: ['retain', 'walk', 'uncertain', 're_sign_likely', 'bidding_war', 'let_walk'],
  targetOutcome: ['acquired', 'declined', 'not_acquired', 'pursued_no_deal', 'redirected', 'actively_traded', 'traded', 'let_walk'],
  priorityType: ['extension', 'free_agency', 'trade', 'coaching_decision', 'draft', 'structural', 'roster', 'scheme', 'cap_management'],
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
  round: 1 | 2 | 3 | 4 | 5 | 6 | 7;
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
