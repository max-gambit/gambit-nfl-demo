import 'dotenv/config';
import type {
  NbaCapSheetPlayerRow,
  ProjectArtifactType,
  ProjectCounterpartyContext,
  ProjectPackageSection,
  ProjectPackageSourceRef,
  ProjectPackageStatus,
  ProjectSalarySourceStatus,
  ProjectScenarioAssetType,
  ProjectScenarioPlayerDirection,
  ProjectScenarioValidationKind,
  ProjectScenarioValidationStatus,
  ProjectStatus,
  ProjectStepId,
  ProjectTaskSource,
  ProjectTradeScenarioStatus,
  ProjectWorkflowType,
} from '@shared/types';
import { loadNbaCapSheetSeed, type NbaCapSheetSeed } from '../nba_cap_sheets/seed.js';
import { db } from './client.js';

// Demo seed - opt-in reset for the local Projects experience.
//
// This clears existing projects and replaces them with three inbound-trade
// scenario-library examples. It intentionally keeps briefs/sessions blank
// except for cleaning up the older hard-coded demo rows from the prototype era.

export const DEMO_PROJECT_IDS = [
  '90000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000002',
  '90000000-0000-0000-0000-000000000003',
] as const;

const LEGACY_DEMO_SESSION_IDS = [
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444',
];

const LEGACY_DEMO_BRIEF_IDS = [
  'b0000001-0000-0000-0000-000000000001',
  'b0000002-0000-0000-0000-000000000002',
  'b0000003-0000-0000-0000-000000000003',
];

const PROJECT_STEPS: ProjectStepId[] = ['research', 'validate', 'feedback', 'gm', 'proposal'];

const STEP_NOTES: Record<ProjectStepId, string> = {
  research: 'Capture the inbound call, counterparty posture, named Warriors player, and the first scenario shells worth cross-checking.',
  validate: 'Separate app advisory checks from Trade Builder and internal cap-sheet validation. Track source gaps before presenting a path as real.',
  feedback: 'Pull scouting, analytics, coaching, and cap/legal reactions into the scenario comparison instead of treating one model read as decisive.',
  gm: 'Prepare a concise phone sheet: best concepts, objections, walk-away line, and the specific counter Golden State should test.',
  proposal: 'Export the scenario library as a source-backed recommendation package with validation status, risks, and next steps.',
};

const TASK_TEMPLATES: Array<{
  step: ProjectStepId;
  label: string;
  required: boolean;
  sort_order: number;
  source: ProjectTaskSource;
}> = [
  { step: 'research', label: 'Capture trigger summary, counterparty context, and named Warriors player.', required: true, sort_order: 0, source: 'system' },
  { step: 'research', label: 'Name at least two scenario shells, including one no-deal or archive path.', required: true, sort_order: 1, source: 'system' },
  { step: 'validate', label: 'Run app advisory checks and identify salary/source gaps.', required: true, sort_order: 0, source: 'system' },
  { step: 'validate', label: 'Record Trade Builder and internal cap-sheet verdicts separately.', required: true, sort_order: 1, source: 'system' },
  { step: 'feedback', label: 'Capture scouting/analytics/cap feedback that would change the ranking.', required: true, sort_order: 0, source: 'system' },
  { step: 'gm', label: 'Narrow to GM-ready phone framing, counter range, and walk-away line.', required: true, sort_order: 0, source: 'system' },
  { step: 'proposal', label: 'Generate the Markdown scenario-library report.', required: true, sort_order: 0, source: 'system' },
];

interface DemoProjectSeed {
  id: string;
  title: string;
  question: string;
  objective: string;
  workflow_type: ProjectWorkflowType;
  subject_team_id: string;
  counterparty_team_id: string;
  inbound_player: { team_id: string; name: string };
  trigger_summary: string;
  counterparty_context: ProjectCounterpartyContext;
  active_step: ProjectStepId;
  status: ProjectStatus;
  package_status: ProjectPackageStatus;
  scenarios: DemoScenarioSeed[];
  package?: {
    id: string;
    status: Exclude<ProjectPackageStatus, 'not_started'>;
    markdown: string;
    sections: ProjectPackageSection[];
    source_refs: ProjectPackageSourceRef[];
  };
}

interface DemoScenarioSeed {
  id: string;
  title: string;
  summary: string;
  status: ProjectTradeScenarioStatus;
  rank: number;
  participating_teams: string[];
  notes: string;
  basketball_fit: string;
  risks: string;
  phone_framing: string;
  walk_away: string;
  counter_range: string;
  validation_summary: string;
  players: DemoScenarioPlayerSeed[];
  assets?: DemoScenarioAssetSeed[];
  validations: DemoScenarioValidationSeed[];
  artifacts?: DemoArtifactSeed[];
}

interface DemoScenarioPlayerSeed {
  id: string;
  team_id: string;
  name: string;
  direction: ProjectScenarioPlayerDirection;
  manual_salary_amount?: number | null;
  salary_source_status?: ProjectSalarySourceStatus;
  manual_override?: boolean;
}

interface DemoScenarioAssetSeed {
  id: string;
  asset_type: ProjectScenarioAssetType;
  label: string;
  direction: ProjectScenarioPlayerDirection;
  team_id: string | null;
  amount?: number | null;
  notes: string;
}

interface DemoScenarioValidationSeed {
  id: string;
  kind: ProjectScenarioValidationKind;
  status: ProjectScenarioValidationStatus;
  summary: string;
  details?: Record<string, unknown>;
  source_refs?: ProjectPackageSourceRef[];
  validated: boolean;
}

interface DemoArtifactSeed {
  id: string;
  artifact_type: ProjectArtifactType;
  title: string;
  url: string | null;
  notes: string;
  metadata?: Record<string, unknown>;
}

export const DEMO_PROJECTS: DemoProjectSeed[] = [
  {
    id: DEMO_PROJECT_IDS[0],
    title: 'Inbound call smoke: Boston asks on Moody',
    question: 'What would Golden State need if Boston pushes on Moses Moody?',
    objective: 'Turn a soft inbound call into ranked, validation-ready deal concepts without overstating app legality.',
    workflow_type: 'inbound_trade',
    subject_team_id: 'GSW',
    counterparty_team_id: 'BOS',
    inbound_player: { team_id: 'GSW', name: 'Moses Moody' },
    trigger_summary: 'Boston likes Moses Moody and asks what Golden State would need back before the market hardens.',
    counterparty_context: {
      apron_level: 'Below first apron; tax sensitive.',
      cap_room: 'Needs clean money and salary discipline around second-apron planning.',
      aims: 'Contend now while preserving rotation optionality.',
      pressure: 'Owner/tax pressure; prefers a mechanically simple framework.',
      job_security: 'Stable front office, but win-now expectations are real.',
      known_targets: 'Moody, second-unit wings, draft sweeteners.',
      signals: 'Negative-salary language and repeated wing-depth interest.',
    },
    active_step: 'research',
    status: 'active',
    package_status: 'stale',
    scenarios: [
      {
        id: '91000000-0000-0000-0000-000000000001',
        title: 'Moody for Pritchard plus second-round value',
        summary: 'Soft framework around Moody for Payton Pritchard plus second-round value.',
        status: 'shortlisted',
        rank: 1,
        participating_teams: ['GSW', 'BOS'],
        notes: 'Seeded from inbound Boston call. Source gap: confirm Boston second-round inventory and whether Payton Pritchard is actually movable in this construction.',
        basketball_fit: 'Pritchard adds guard handling and shooting; Moody exit costs wing depth and size.',
        risks: 'Salary delta helps Boston more than Golden State unless draft value is real.',
        phone_framing: 'Would you consider something around Moody if Pritchard and second-round value are in the framework?',
        walk_away: 'No scenario without second-round value or another sweetener.',
        counter_range: 'Open at two seconds; settle at one second plus cash or rights.',
        validation_summary: 'Advisory check only; confirm in Trade Builder and internal cap sheet.',
        players: [
          { id: '92000000-0000-0000-0000-000000000001', team_id: 'GSW', name: 'Moses Moody', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000002', team_id: 'BOS', name: 'Payton Pritchard', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000001',
            asset_type: 'pick',
            label: 'Boston second-round value',
            direction: 'incoming',
            team_id: 'BOS',
            notes: 'Specific pick year and protections still source-needed.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000001',
            kind: 'app_advisory',
            status: 'pass',
            summary: 'Captured salary rows produce a clean app cross-check; this is not a legal trade verdict.',
            details: { boundary: 'advisory_only' },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000002',
            kind: 'trade_builder',
            status: 'warning',
            summary: 'Needs Trade Builder export before presenting; pick detail unresolved.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000003',
            kind: 'internal_cap_sheet',
            status: 'pass',
            summary: 'Internal sheet cross-check captured for smoke; confirm exact apron room before phone call.',
            validated: true,
          },
        ],
        artifacts: [
          {
            id: '96000000-0000-0000-0000-000000000001',
            artifact_type: 'scout_intel',
            title: 'Boston wing-depth call note',
            url: null,
            notes: 'Manual note: Boston interest framed as depth and cost control, not star consolidation.',
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000002',
        title: 'Moody for Hauser clean shooting swap',
        summary: 'Cleaner wing-shooting swap that lowers complexity but probably lacks enough upside.',
        status: 'archived',
        rank: 2,
        participating_teams: ['GSW', 'BOS'],
        notes: 'Archive path unless Boston adds a meaningful sweetener. Hauser solves shooting but not the ball-handling need.',
        basketball_fit: 'Hauser gives Golden State movement shooting; Moody is younger and more two-way flexible.',
        risks: 'Golden State may be selling youth and defensive versatility for a narrower skill package.',
        phone_framing: 'Hauser alone probably is not enough. What else would Boston attach?',
        walk_away: 'Archive if Boston treats Hauser as the whole return.',
        counter_range: 'Hauser plus second-round value, or pivot back to Pritchard framework.',
        validation_summary: 'Archived no-deal path; advisory checks are secondary unless Boston revives with assets.',
        players: [
          { id: '92000000-0000-0000-0000-000000000003', team_id: 'GSW', name: 'Moses Moody', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000004', team_id: 'BOS', name: 'Sam Hauser', direction: 'incoming' },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000004',
            kind: 'app_advisory',
            status: 'warning',
            summary: 'Salary rows are captured, but basketball return is the blocker.',
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000005',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Not run because the concept is archived unless sweetened.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000006',
            kind: 'internal_cap_sheet',
            status: 'manual_pending',
            summary: 'No internal sheet review needed until Boston improves the offer.',
            validated: false,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000007',
        title: 'Moody for Derrick White tax-relief overpay test',
        summary: 'A high-return ask that tests whether Boston would pay for tax relief and guard/wing optionality.',
        status: 'collapsed',
        rank: 3,
        participating_teams: ['GSW', 'BOS'],
        notes: 'Modeled because the call should include an intentionally ambitious anchor. Collapse unless Boston unexpectedly treats White as movable for tax/apron reasons.',
        basketball_fit: 'White is the cleanest basketball upgrade on the board; Moody alone is not enough value without a major Boston tax motive.',
        risks: 'Likely unrealistic and salary-heavy; could distort the live call if presented as anything other than an anchor.',
        phone_framing: 'If your tax goal is real, is there any White construction worth discussing, or should we keep the call in Pritchard/Hauser territory?',
        walk_away: 'Do not add premium draft value from Golden State just to reach White salary.',
        counter_range: 'Boston attaches White only if Golden State keeps the outgoing package light and Boston supplies the cap rationale.',
        validation_summary: 'Collapsed anchor; app salaries are captured, but external validation is not worth running unless Boston reopens it.',
        players: [
          { id: '92000000-0000-0000-0000-000000000013', team_id: 'GSW', name: 'Moses Moody', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000014', team_id: 'BOS', name: 'Derrick White', direction: 'incoming' },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000019',
            kind: 'app_advisory',
            status: 'warning',
            summary: 'Captured salaries show a large imbalance; this is a strategic anchor, not a validated construction.',
            details: { source_gaps: ['trade_builder_pdf', 'boston_tax_motive'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000020',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Not run while concept remains an anchor.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000021',
            kind: 'internal_cap_sheet',
            status: 'warning',
            summary: 'Internal sheet should only revisit if Boston volunteers salary pressure.',
            validated: true,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000008',
        title: 'Moody and Payton II for Pritchard plus Hauser',
        summary: 'Two-for-two rotation construction that turns the call into a guard/shooting depth exchange.',
        status: 'active',
        rank: 4,
        participating_teams: ['GSW', 'BOS'],
        notes: 'Useful middle band if Boston wants Moody but refuses draft value. Source gap: confirm Payton II is acceptable outgoing salary for Golden State.',
        basketball_fit: 'Pritchard adds handling, Hauser adds shooting, and Payton II exit reduces point-of-attack defense.',
        risks: 'Golden State may be solving guard/shooting while losing too much wing and defensive versatility.',
        phone_framing: 'If picks are off the table, can we solve this as Pritchard plus Hauser for Moody plus Payton?',
        walk_away: 'No two-for-two framework if Boston asks for an added Warriors second.',
        counter_range: 'Boston adds cash or minor second-round detail if Golden State includes Payton II.',
        validation_summary: 'Needs Trade Builder because two-player construction changes salary-matching mechanics.',
        players: [
          { id: '92000000-0000-0000-0000-000000000015', team_id: 'GSW', name: 'Moses Moody', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000016', team_id: 'GSW', name: 'Gary Payton II', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000017', team_id: 'BOS', name: 'Payton Pritchard', direction: 'incoming' },
          { id: '92000000-0000-0000-0000-000000000018', team_id: 'BOS', name: 'Sam Hauser', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000004',
            asset_type: 'cash',
            label: 'Cash or minor rights detail',
            direction: 'incoming',
            team_id: 'BOS',
            notes: 'Only relevant if Payton II is included.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000022',
            kind: 'app_advisory',
            status: 'warning',
            summary: 'App cross-check can total captured salaries, but two-for-two mechanics need external confirmation.',
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000023',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Trade Builder run pending if this becomes the no-pick counter.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000024',
            kind: 'internal_cap_sheet',
            status: 'manual_pending',
            summary: 'Internal sheet pending exact outgoing salary choice.',
            validated: false,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000009',
        title: 'Moody for Jordan Walsh and two seconds',
        summary: 'Prospect-and-picks fallback that preserves Boston rotation but asks for a real draft sweetener.',
        status: 'archived',
        rank: 5,
        participating_teams: ['GSW', 'BOS'],
        notes: 'Walsh salary is source-needed in the public sheet, so this is mostly a pick-value thought exercise. Archive unless Boston offers premium seconds.',
        basketball_fit: 'Walsh is a developmental wing; Golden State would be prioritizing draft optionality over immediate rotation help.',
        risks: 'Too little immediate utility for a team trying to contend now.',
        phone_framing: 'If Boston wants to keep Pritchard and Hauser, what is the best prospect-plus-picks version you would actually do?',
        walk_away: 'No Walsh-only framework without two meaningful seconds or a stronger rights asset.',
        counter_range: 'Two seconds plus Walsh; settle only if one second is unusually clean.',
        validation_summary: 'Source-needed salary row and low basketball fit keep this archived.',
        players: [
          { id: '92000000-0000-0000-0000-000000000019', team_id: 'GSW', name: 'Moses Moody', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000020', team_id: 'BOS', name: 'Jordan Walsh', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000005',
            asset_type: 'pick',
            label: 'Two Boston second-rounders',
            direction: 'incoming',
            team_id: 'BOS',
            notes: 'Specific years and protections not captured.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000025',
            kind: 'app_advisory',
            status: 'source_needed',
            summary: 'Incoming player salary and pick detail are source-needed.',
            details: { source_gaps: ['incoming_salary_amount', 'pick_years'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000026',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Not run while archived.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000027',
            kind: 'internal_cap_sheet',
            status: 'source_needed',
            summary: 'Needs salary and pick details before internal review.',
            validated: false,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000010',
        title: 'Moody plus Gui Santos for Pritchard and Queta',
        summary: 'Bench-balance version that explores whether Golden State can add guard handling and frontcourt depth.',
        status: 'active',
        rank: 6,
        participating_teams: ['GSW', 'BOS'],
        notes: 'Gui Santos and Neemias Queta salaries are source-needed in the public sheet. Keep as a source-gap model until external validation exists.',
        basketball_fit: 'Pritchard handles and Queta gives center depth; Golden State gives up Moody plus a developmental wing.',
        risks: 'Source gaps are material and Queta role value may not justify losing Moody.',
        phone_framing: 'Is there a broader bench-balancing version with Queta, or is Boston only calling on straight guard/wing value?',
        walk_away: 'No broader framework without Boston adding at least one clean second-round asset.',
        counter_range: 'Pritchard plus Queta plus second-round value for Moody plus Santos.',
        validation_summary: 'Operational source-gap scenario; do not call validated until Trade Builder and public salaries are captured.',
        players: [
          { id: '92000000-0000-0000-0000-000000000021', team_id: 'GSW', name: 'Moses Moody', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000022', team_id: 'GSW', name: 'Gui Santos', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000023', team_id: 'BOS', name: 'Payton Pritchard', direction: 'incoming' },
          { id: '92000000-0000-0000-0000-000000000024', team_id: 'BOS', name: 'Neemias Queta', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000006',
            asset_type: 'pick',
            label: 'Boston second-round sweetener',
            direction: 'incoming',
            team_id: 'BOS',
            notes: 'Required because Golden State is taking on source-gap bench complexity.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000028',
            kind: 'app_advisory',
            status: 'source_needed',
            summary: 'Multiple public salary rows are source-needed; app totals are incomplete.',
            details: { source_gaps: ['outgoing_salary_amount', 'incoming_salary_amount'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000029',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Trade Builder required before discussion beyond brainstorming.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000030',
            kind: 'internal_cap_sheet',
            status: 'source_needed',
            summary: 'Internal sheet pending source-gap salary capture.',
            validated: false,
          },
        ],
      },
    ],
  },
  {
    id: DEMO_PROJECT_IDS[1],
    title: 'Charlotte checks Podziemski price',
    question: 'How hard should Golden State push back if Charlotte asks on Brandin Podziemski?',
    objective: 'Compare youth-consolidation paths while keeping source-needed salaries and external validation explicit.',
    workflow_type: 'inbound_trade',
    subject_team_id: 'GSW',
    counterparty_team_id: 'CHA',
    inbound_player: { team_id: 'GSW', name: 'Brandin Podziemski' },
    trigger_summary: 'Charlotte floats interest in Podziemski as part of a broader guard/creator reshuffle.',
    counterparty_context: {
      apron_level: 'Below tax, but future salary discipline matters.',
      cap_room: 'Limited practical room once guard money and extension windows are modeled.',
      aims: 'Add a connective guard without giving up premium young core pieces.',
      pressure: 'Pressure to show progress around LaMelo while preserving flexibility.',
      job_security: 'Front office still has runway, but ownership wants cleaner direction.',
      known_targets: 'Podziemski, secondary creation, cost-controlled guards.',
      signals: 'Willing to discuss protected draft value if the return solves role clarity.',
    },
    active_step: 'validate',
    status: 'active',
    package_status: 'drafted',
    scenarios: [
      {
        id: '91000000-0000-0000-0000-000000000003',
        title: 'Podziemski for Tre Mann plus protected first framework',
        summary: 'Podziemski for Tre Mann with protected first-round value as the price of giving up the better connector.',
        status: 'shortlisted',
        rank: 1,
        participating_teams: ['GSW', 'CHA'],
        notes: 'Source gap: exact Charlotte pick protection and whether Mann salary timing creates apron friction. Do not present as validated until Trade Builder and internal sheet both pass.',
        basketball_fit: 'Mann adds shot creation; Podziemski is the better connective rebound/pass guard for the Warriors ecosystem.',
        risks: 'Protected pick may look better on paper than in practice if protections roll too heavily.',
        phone_framing: 'If Podziemski is the ask, the conversation starts with Mann and real protected first value.',
        walk_away: 'No deal if Charlotte caps the asset at seconds or pushes heavy protection.',
        counter_range: 'Top-12 protected first as opener; settle around top-18 protected first plus minor second/cash detail.',
        validation_summary: 'App warning until source-needed pick and external cap checks are resolved.',
        players: [
          { id: '92000000-0000-0000-0000-000000000005', team_id: 'GSW', name: 'Brandin Podziemski', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000006', team_id: 'CHA', name: 'Tre Mann', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000002',
            asset_type: 'pick',
            label: 'Top-18 protected Charlotte first',
            direction: 'incoming',
            team_id: 'CHA',
            notes: 'Protection ladder and conveyance years are not captured.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000007',
            kind: 'app_advisory',
            status: 'warning',
            summary: 'Captured salaries can be compared, but pick terms and external legality remain unresolved.',
            details: { source_gaps: ['pick_protection', 'trade_builder_pdf', 'internal_cap_sheet'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000008',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Trade Builder verdict pending.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000009',
            kind: 'internal_cap_sheet',
            status: 'source_needed',
            summary: 'Needs internal cap-sheet check before the scenario can be called validated.',
            validated: false,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000004',
        title: 'Podziemski for Coby White salary bridge',
        summary: 'Bigger guard-money path that may solve creation but likely creates too much salary and role noise.',
        status: 'collapsed',
        rank: 2,
        participating_teams: ['GSW', 'CHA'],
        notes: 'Collapsed unless Charlotte treats Coby White as a salary bridge and adds enough value to offset Warriors payroll and role concerns.',
        basketball_fit: 'White helps shot creation but compresses guard minutes and could reduce Warriors defensive optionality.',
        risks: 'Salary bridge creates downstream tax/apron exposure and may not fit the inbound-call motive.',
        phone_framing: 'Coby only becomes interesting if Charlotte pays for the salary and role risk.',
        walk_away: 'Walk away if Golden State is the team adding value.',
        counter_range: 'Ask for a first plus seconds; likely archive if Charlotte wants straight value parity.',
        validation_summary: 'Collapsed path; salary is visible, but external validation is intentionally not complete.',
        players: [
          { id: '92000000-0000-0000-0000-000000000007', team_id: 'GSW', name: 'Brandin Podziemski', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000008', team_id: 'CHA', name: 'Coby White', direction: 'incoming' },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000010',
            kind: 'app_advisory',
            status: 'warning',
            summary: 'Captured salary delta is large enough to require external verification before revival.',
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000011',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Not run after collapse decision.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000012',
            kind: 'internal_cap_sheet',
            status: 'warning',
            summary: 'Internal sheet likely unfavorable because of salary and role cascade.',
            validated: true,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000011',
        title: 'Podziemski and Payton II for Josh Green plus protected first',
        summary: 'Defense-and-connector exchange that asks Charlotte to pay a protected first for the cleaner Warriors players.',
        status: 'active',
        rank: 3,
        participating_teams: ['GSW', 'CHA'],
        notes: 'Useful if Charlotte values Podziemski but wants a lower-usage wing back in the deal. Payton II inclusion should be treated as a Warriors concession.',
        basketball_fit: 'Josh Green replaces some perimeter defense; Podziemski is the better long-term connector and rebounder.',
        risks: 'Golden State could be diluting the return unless the protected first is real and clean enough.',
        phone_framing: 'If Charlotte wants Podziemski and another defender, Josh Green has to come with real first-round value.',
        walk_away: 'No deal if the asset is seconds-only or if protection is too heavy.',
        counter_range: 'Top-14 protected first as opener; settle no lower than top-20 protection plus a minor second.',
        validation_summary: 'Captured salary rows support an app cross-check; external verdicts still pending.',
        players: [
          { id: '92000000-0000-0000-0000-000000000025', team_id: 'GSW', name: 'Brandin Podziemski', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000026', team_id: 'GSW', name: 'Gary Payton II', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000027', team_id: 'CHA', name: 'Josh Green', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000007',
            asset_type: 'pick',
            label: 'Protected Charlotte first',
            direction: 'incoming',
            team_id: 'CHA',
            notes: 'Protection ladder is the swing variable.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000031',
            kind: 'app_advisory',
            status: 'warning',
            summary: 'Captured salary rows are usable; pick terms and two-player mechanics need external confirmation.',
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000032',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Trade Builder verdict pending.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000033',
            kind: 'internal_cap_sheet',
            status: 'manual_pending',
            summary: 'Internal cap sheet pending exact pick protection and outgoing salary choice.',
            validated: false,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000012',
        title: 'Podziemski for Kon Knueppel youth swing',
        summary: 'One-young-player-for-another version that tests whether Charlotte would trade shooting upside for connector fit.',
        status: 'shortlisted',
        rank: 4,
        participating_teams: ['GSW', 'CHA'],
        notes: 'Knueppel salary is captured. This is the cleanest youth-for-youth comparison if Charlotte refuses premium picks.',
        basketball_fit: 'Knueppel gives size and shooting; Podziemski gives possession value, passing, and plug-in Warriors system knowledge.',
        risks: 'Golden State may prefer the known internal fit unless Knueppel scouting conviction is high.',
        phone_framing: 'If the first is too hard, would Charlotte discuss Knueppel as the centerpiece?',
        walk_away: 'No one-for-one without a scouting sign-off that Knueppel is a better Warriors fit.',
        counter_range: 'Knueppel plus minor second/cash detail if Charlotte will not attach a first.',
        validation_summary: 'Good comparison scenario; needs scouting feedback and external cap confirmation.',
        players: [
          { id: '92000000-0000-0000-0000-000000000028', team_id: 'GSW', name: 'Brandin Podziemski', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000029', team_id: 'CHA', name: 'Kon Knueppel', direction: 'incoming' },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000034',
            kind: 'app_advisory',
            status: 'pass',
            summary: 'Captured salary rows produce a clean advisory comparison; legality still external.',
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000035',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Trade Builder pending if shortlisted for GM call.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000036',
            kind: 'internal_cap_sheet',
            status: 'warning',
            summary: 'Internal check should include rookie-scale timing and downstream roster slot impact.',
            validated: true,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000013',
        title: 'Podziemski for Brandon Miller premium ask',
        summary: 'Premium ask that frames how far Golden State would stretch if Charlotte tries to pry away Podziemski.',
        status: 'collapsed',
        rank: 5,
        participating_teams: ['GSW', 'CHA'],
        notes: 'Deliberately aggressive anchor. Useful internally because it clarifies that Golden State views Podziemski as more than a throw-in.',
        basketball_fit: 'Miller is the upside wing prize; this probably exceeds what Charlotte would entertain.',
        risks: 'Unrealistic enough that it should stay internal unless Charlotte opens the door first.',
        phone_framing: 'We are not shopping Podziemski. If you are asking for him, the conversation has to start with a premium young wing.',
        walk_away: 'Do not spend time on Miller unless Charlotte explicitly invites a premium framework.',
        counter_range: 'Miller as centerpiece; otherwise drop back to Knueppel/Green/pick bands.',
        validation_summary: 'Collapsed premium anchor; no external validation needed yet.',
        players: [
          { id: '92000000-0000-0000-0000-000000000030', team_id: 'GSW', name: 'Brandin Podziemski', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000031', team_id: 'CHA', name: 'Brandon Miller', direction: 'incoming' },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000037',
            kind: 'app_advisory',
            status: 'warning',
            summary: 'Captured salary rows are available, but this is an anchor scenario rather than an actionable construction.',
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000038',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Not run while collapsed.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000039',
            kind: 'internal_cap_sheet',
            status: 'manual_pending',
            summary: 'No internal cap-sheet work until Charlotte makes Miller real.',
            validated: false,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000014',
        title: 'Podziemski for Liam McNeeley and two seconds',
        summary: 'Lower-cost rookie shooting path that keeps the call alive if Charlotte will not include a first.',
        status: 'archived',
        rank: 6,
        participating_teams: ['GSW', 'CHA'],
        notes: 'Archive unless scouting is higher on McNeeley than the current board. This is a good no-deal comparison row.',
        basketball_fit: 'McNeeley gives shooting size; Podziemski has broader possession and decision value.',
        risks: 'Return may be too speculative for a Warriors team trying to win now.',
        phone_framing: 'If Charlotte is not offering a first, would McNeeley plus two clean seconds be their best alternate?',
        walk_away: 'No deal with McNeeley unless both seconds are meaningful.',
        counter_range: 'McNeeley plus two seconds; archive if only one second is offered.',
        validation_summary: 'Captured salary rows exist, but basketball value is not strong enough without scouting upgrade.',
        players: [
          { id: '92000000-0000-0000-0000-000000000032', team_id: 'GSW', name: 'Brandin Podziemski', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000033', team_id: 'CHA', name: 'Liam McNeeley', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000008',
            asset_type: 'pick',
            label: 'Two Charlotte second-rounders',
            direction: 'incoming',
            team_id: 'CHA',
            notes: 'Specific years and protection quality not captured.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000040',
            kind: 'app_advisory',
            status: 'pass',
            summary: 'Captured salary rows support advisory comparison; pick quality remains manual.',
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000041',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Not run while archived.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000042',
            kind: 'internal_cap_sheet',
            status: 'warning',
            summary: 'Internal sheet should revisit only if scouting upgrades McNeeley.',
            validated: true,
          },
        ],
      },
    ],
  },
  {
    id: DEMO_PROJECT_IDS[2],
    title: 'Miami pressure-tests Melton defensive guard call',
    question: "Is there a GM-ready Miami structure if the call starts with De'Anthony Melton?",
    objective: 'Package the best Miami scenario with clear advisory boundaries, artifact status, and phone framing.',
    workflow_type: 'inbound_trade',
    subject_team_id: 'GSW',
    counterparty_team_id: 'MIA',
    inbound_player: { team_id: 'GSW', name: "De'Anthony Melton" },
    trigger_summary: 'Miami asks whether Melton or Payton II could be folded into a defensive-guard/depth exchange.',
    counterparty_context: {
      apron_level: 'Tax-sensitive; working around second-apron pressure points.',
      cap_room: 'No simple room path; needs salary matching and internal cap confirmation.',
      aims: 'Add point-of-attack defense while preserving playoff rotation size.',
      pressure: 'Heat want immediate competence without burning top assets.',
      job_security: 'Stable decision group, but roster pressure is visible.',
      known_targets: 'Melton, Payton II, defensive guards, low-mistake bench depth.',
      signals: 'Asked for validation artifacts early, which suggests they expect cap friction.',
    },
    active_step: 'gm',
    status: 'packaged',
    package_status: 'ready',
    scenarios: [
      {
        id: '91000000-0000-0000-0000-000000000005',
        title: 'Melton for Jaime Jaquez Jr. decision packet',
        summary: 'Aggressive ask that turns Melton interest into a real wing-upside decision point.',
        status: 'presented',
        rank: 1,
        participating_teams: ['GSW', 'MIA'],
        notes: 'Jaquez salary is source-needed in the public cap sheet, so this remains artifact-backed but not app-legality-backed. Trade Builder and internal sheet are the presentation sources.',
        basketball_fit: 'Jaquez adds wing strength, cutting, and postseason playable size; Melton exit costs guard defense and shooting optionality.',
        risks: 'Miami may view Jaquez as too high a price for a defensive-guard call; public salary row is source-needed.',
        phone_framing: 'If Miami wants a real defensive-guard answer, Golden State needs Jaquez-level upside back.',
        walk_away: 'Do not downgrade to salary filler without a premium young player or first-round-equivalent value.',
        counter_range: 'Jaquez straight framework as the ask; pivot to protected first plus Larsson only if Miami refuses.',
        validation_summary: 'GM-ready only because external artifacts exist; app advisory remains a cross-check because public salary is source-needed.',
        players: [
          { id: '92000000-0000-0000-0000-000000000009', team_id: 'GSW', name: "De'Anthony Melton", direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000010', team_id: 'MIA', name: 'Jaime Jaquez Jr.', direction: 'incoming' },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000013',
            kind: 'app_advisory',
            status: 'source_needed',
            summary: 'Public cap-sheet row for Jaquez is source-needed; app check cannot be treated as complete.',
            details: { source_gaps: ['incoming_salary_amount'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000014',
            kind: 'trade_builder',
            status: 'pass',
            summary: 'Manual Trade Builder report captured for GM packet.',
            source_refs: [{ label: 'Trade Builder report artifact' }],
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000015',
            kind: 'internal_cap_sheet',
            status: 'pass',
            summary: 'Internal cap sheet says framework is presentable, subject to final timing and guarantee checks.',
            source_refs: [{ label: 'Internal cap sheet artifact' }],
            validated: true,
          },
        ],
        artifacts: [
          {
            id: '96000000-0000-0000-0000-000000000002',
            artifact_type: 'trade_builder_report',
            title: 'Trade Builder export - Melton/Jaquez',
            url: 'gambit://artifacts/demo/melton-jaquez-trade-builder',
            notes: 'Demo metadata placeholder for linked external validation.',
          },
          {
            id: '96000000-0000-0000-0000-000000000003',
            artifact_type: 'internal_cap_sheet',
            title: 'Internal cap sheet cross-check - Miami guard call',
            url: 'gambit://artifacts/demo/miami-internal-cap-sheet',
            notes: 'Demo metadata placeholder for internal sheet confirmation.',
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000006',
        title: 'Payton II for Pelle Larsson plus second',
        summary: 'Lower-stakes defensive-depth swap that keeps Miami engaged if Jaquez is off the table.',
        status: 'active',
        rank: 2,
        participating_teams: ['GSW', 'MIA'],
        notes: 'Pelle Larsson public salary row is source-needed, so keep this as a fallback shell until the external validation artifacts are captured.',
        basketball_fit: 'Larsson is a younger depth bet; Payton II is the proven defensive specialist.',
        risks: 'May be too small a return unless the second-round detail is real and Larsson salary validates cleanly.',
        phone_framing: 'If Jaquez is a hard no, the fallback needs Larsson plus a second because Golden State is giving up the known defender.',
        walk_away: 'Archive if Miami wants Payton II for only salary filler.',
        counter_range: 'Larsson plus 2028 second; settle only with another clean minor asset.',
        validation_summary: 'Fallback path with source-needed salary and pending Trade Builder review.',
        players: [
          { id: '92000000-0000-0000-0000-000000000011', team_id: 'GSW', name: 'Gary Payton II', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000012', team_id: 'MIA', name: 'Pelle Larsson', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000003',
            asset_type: 'pick',
            label: '2028 Miami second-rounder',
            direction: 'incoming',
            team_id: 'MIA',
            notes: 'Exact year can move if Miami inventory requires it.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000016',
            kind: 'app_advisory',
            status: 'source_needed',
            summary: 'Incoming salary source needed; advisory check should stay open.',
            details: { source_gaps: ['incoming_salary_amount'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000017',
            kind: 'trade_builder',
            status: 'warning',
            summary: 'Trade Builder run needed if this becomes the fallback call path.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000018',
            kind: 'internal_cap_sheet',
            status: 'pass',
            summary: 'Internal sheet says fallback is directionally manageable subject to exact incoming salary.',
            validated: true,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000015',
        title: 'Melton and Payton II for Davion Mitchell plus second',
        summary: 'Defensive-guard exchange that tests whether Miami can send a younger guard and pick value back.',
        status: 'shortlisted',
        rank: 3,
        participating_teams: ['GSW', 'MIA'],
        notes: 'Miami public salary rows are source-needed, so this is a call-sheet scenario until Trade Builder and internal sheet fill the gaps.',
        basketball_fit: 'Mitchell keeps point-of-attack pressure while Golden State gets younger; losing both Melton and Payton II reduces known veteran defense.',
        risks: 'Incoming salary source gap and role redundancy could make this look cleaner than it is.',
        phone_framing: 'If Miami wants both defensive guards, Golden State needs Mitchell plus a clean second-rounder.',
        walk_away: 'No two-guard outgoing package without a real second or equivalent rights asset.',
        counter_range: 'Mitchell plus a clean second; settle only if Miami includes cash/rights that matter internally.',
        validation_summary: 'Shortlisted with source gaps; external artifacts are mandatory before GM packet.',
        players: [
          { id: '92000000-0000-0000-0000-000000000034', team_id: 'GSW', name: "De'Anthony Melton", direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000035', team_id: 'GSW', name: 'Gary Payton II', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000036', team_id: 'MIA', name: 'Davion Mitchell', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000009',
            asset_type: 'pick',
            label: 'Miami second-rounder',
            direction: 'incoming',
            team_id: 'MIA',
            notes: 'Exact year and protection still source-needed.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000043',
            kind: 'app_advisory',
            status: 'source_needed',
            summary: 'Incoming salary is source-needed; app advisory should stay open.',
            details: { source_gaps: ['incoming_salary_amount', 'pick_year'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000044',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Trade Builder needed for two-player outgoing structure.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000045',
            kind: 'internal_cap_sheet',
            status: 'source_needed',
            summary: 'Internal sheet pending Miami salary capture.',
            validated: false,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000016',
        title: 'Melton for Nikola Jovic upside probe',
        summary: 'Upside-forward probe that asks whether Miami will turn defensive-guard need into a young frontcourt return.',
        status: 'active',
        rank: 4,
        participating_teams: ['GSW', 'MIA'],
        notes: 'Jovic salary is source-needed in the public sheet. Keep this as an upside probe until external validation exists.',
        basketball_fit: 'Jovic adds frontcourt skill and size; Melton exit removes a cleaner defensive guard answer.',
        risks: 'Miami may view Jovic as too expensive for the starting ask; salary data is incomplete.',
        phone_framing: 'If Jaquez is too rich, is Jovic the young frontcourt version Miami would discuss?',
        walk_away: 'Do not settle for Jovic without either salary clarity or additional minor asset value.',
        counter_range: 'Jovic as centerpiece; add cash or a second if salary/source gaps create Warriors risk.',
        validation_summary: 'Active source-gap scenario; advisory only until salary and external verdicts are captured.',
        players: [
          { id: '92000000-0000-0000-0000-000000000037', team_id: 'GSW', name: "De'Anthony Melton", direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000038', team_id: 'MIA', name: 'Nikola Jović', direction: 'incoming' },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000046',
            kind: 'app_advisory',
            status: 'source_needed',
            summary: 'Incoming salary source is missing from the public sheet.',
            details: { source_gaps: ['incoming_salary_amount'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000047',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Trade Builder pending if Miami treats Jovic as live.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000048',
            kind: 'internal_cap_sheet',
            status: 'manual_pending',
            summary: 'Internal review pending role and salary confirmation.',
            validated: false,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000017',
        title: 'Melton plus Moody for Andrew Wiggins reunion no-deal test',
        summary: 'Large-name reunion path kept as a no-deal comparison because the salary/source burden is too heavy.',
        status: 'archived',
        rank: 5,
        participating_teams: ['GSW', 'MIA'],
        notes: 'Wiggins salary is source-needed in the public sheet and the basketball/cap fit is likely poor. Kept to make the no-deal reasoning explicit.',
        basketball_fit: 'Wiggins is familiar wing size, but Golden State would be sending two cleaner smaller pieces and likely reintroducing salary complexity.',
        risks: 'False-confidence risk is high because the public incoming salary is source-needed.',
        phone_framing: 'Wiggins is probably not the lane unless Miami is attaching value and proving the cap mechanics externally.',
        walk_away: 'Archive unless Miami attaches a meaningful first-round-equivalent asset.',
        counter_range: 'Wiggins plus premium asset only; otherwise no-deal.',
        validation_summary: 'Archived no-deal row with major source gaps.',
        players: [
          { id: '92000000-0000-0000-0000-000000000039', team_id: 'GSW', name: "De'Anthony Melton", direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000040', team_id: 'GSW', name: 'Moses Moody', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000041', team_id: 'MIA', name: 'Andrew Wiggins', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000010',
            asset_type: 'pick',
            label: 'First-round-equivalent asset',
            direction: 'incoming',
            team_id: 'MIA',
            notes: 'Required to even discuss the reunion concept.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000049',
            kind: 'app_advisory',
            status: 'source_needed',
            summary: 'Incoming salary is source-needed and likely too large for advisory confidence.',
            details: { source_gaps: ['incoming_salary_amount', 'trade_builder_pdf'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000050',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Not run while archived.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000051',
            kind: 'internal_cap_sheet',
            status: 'source_needed',
            summary: 'Internal sheet should not spend cycles until Miami attaches real value.',
            validated: false,
          },
        ],
      },
      {
        id: '91000000-0000-0000-0000-000000000018',
        title: 'Payton II for Dru Smith and cash',
        summary: 'Low-end fallback that tests whether Miami has a small guard-and-cash path worth keeping alive.',
        status: 'collapsed',
        rank: 6,
        participating_teams: ['GSW', 'MIA'],
        notes: 'Dru Smith salary is source-needed. This is probably not enough basketball value unless cash or rights meaningfully help the Warriors ledger.',
        basketball_fit: 'Smith is a lower-cost guard body; Payton II is the more proven defensive specialist.',
        risks: 'Too small a return and too many source gaps for a serious GM path.',
        phone_framing: 'If Miami wants only a small fallback, it has to come with cash or a rights detail that matters.',
        walk_away: 'Collapse without cash/rights and external salary confirmation.',
        counter_range: 'Smith plus cash/rights; otherwise archive.',
        validation_summary: 'Collapsed fallback with source-needed salary.',
        players: [
          { id: '92000000-0000-0000-0000-000000000042', team_id: 'GSW', name: 'Gary Payton II', direction: 'outgoing' },
          { id: '92000000-0000-0000-0000-000000000043', team_id: 'MIA', name: 'Dru Smith', direction: 'incoming' },
        ],
        assets: [
          {
            id: '94000000-0000-0000-0000-000000000011',
            asset_type: 'cash',
            label: 'Cash or rights detail',
            direction: 'incoming',
            team_id: 'MIA',
            notes: 'Must be meaningful enough to justify moving Payton II.',
          },
        ],
        validations: [
          {
            id: '95000000-0000-0000-0000-000000000052',
            kind: 'app_advisory',
            status: 'source_needed',
            summary: 'Incoming salary source is missing.',
            details: { source_gaps: ['incoming_salary_amount'] },
            validated: true,
          },
          {
            id: '95000000-0000-0000-0000-000000000053',
            kind: 'trade_builder',
            status: 'manual_pending',
            summary: 'Not run while collapsed.',
            validated: false,
          },
          {
            id: '95000000-0000-0000-0000-000000000054',
            kind: 'internal_cap_sheet',
            status: 'source_needed',
            summary: 'Needs salary and cash/rights detail before review.',
            validated: false,
          },
        ],
      },
    ],
    package: {
      id: '97000000-0000-0000-0000-000000000001',
      status: 'ready',
      markdown: [
        '# Miami pressure-tests Melton defensive guard call',
        '',
        '## Recommendation',
        'Keep the Jaquez framework as the GM-ready ask. Treat Payton II for Larsson plus a second as the fallback shell only after public salary gaps and Trade Builder output are refreshed.',
        '',
        '## Scenario Library',
        '1. Melton for Jaime Jaquez Jr. decision packet - presented; external Trade Builder and internal cap-sheet artifacts captured; app salary row remains source-needed.',
        '2. Payton II for Pelle Larsson plus second - active fallback; source-needed salary remains unresolved.',
        '3. Melton and Payton II for Davion Mitchell plus second - shortlisted; two-player outgoing path needs Trade Builder.',
        '4. Melton for Nikola Jovic upside probe - active; source-needed salary keeps this advisory.',
        '5. Melton plus Moody for Andrew Wiggins reunion no-deal test - archived comparison row.',
        '6. Payton II for Dru Smith and cash - collapsed small fallback.',
      ].join('\n'),
      sections: [
        {
          title: 'Recommendation',
          body: 'Keep the Jaquez framework as the GM-ready ask. Treat Davion Mitchell and Jovic as live fallback bands, while Larsson, Wiggins, and Smith paths clarify where Golden State should walk away.',
        },
        {
          title: 'Validation posture',
          body: 'Trade Builder and internal cap-sheet artifacts are captured for the lead scenario; every fallback keeps advisory/source-needed boundaries visible until Miami salary data is refreshed.',
        },
      ],
      source_refs: [{ label: 'Demo Trade Builder artifact' }, { label: 'Demo internal cap sheet artifact' }],
    },
  },
];

async function main() {
  const now = new Date().toISOString();
  const capSheetSeed = await loadNbaCapSheetSeed();

  console.log('> resetting local demo project data...');
  await clearProjects();
  await clearLegacyDemoBriefsAndSessions();

  console.log('> seeding inbound-trade project library...');
  await insertProjects(capSheetSeed, now);

  console.log(`seeded ${DEMO_PROJECTS.length} projects and ${DEMO_PROJECTS.reduce((sum, project) => sum + project.scenarios.length, 0)} named scenarios.`);
}

async function clearProjects() {
  const res = await db.from('projects').delete({ count: 'exact' }).not('id', 'is', null);
  if (res.error) throw new Error(`delete projects failed: ${res.error.message}`);
  console.log(`  - cleared ${res.count ?? 0} existing projects`);
}

async function clearLegacyDemoBriefsAndSessions() {
  for (const id of LEGACY_DEMO_BRIEF_IDS) {
    await throwIfError(db.from('brief_options').delete().eq('brief_id', id), `delete brief_options for ${id}`);
    await throwIfError(db.from('brief_sources').delete().eq('brief_id', id), `delete brief_sources for ${id}`);
    await throwIfError(db.from('chat_turns').delete().eq('brief_id', id), `delete chat_turns for ${id}`);
    await throwIfError(db.from('artifacts').delete().eq('brief_id', id), `delete artifacts for ${id}`);
    await throwIfError(db.from('briefs').delete().eq('id', id), `delete brief ${id}`);
  }
  console.log(`  - cleared ${LEGACY_DEMO_BRIEF_IDS.length} legacy demo briefs`);

  for (const sid of LEGACY_DEMO_SESSION_IDS) {
    const childBriefs = await db.from('briefs').select('id').eq('session_id', sid);
    if (childBriefs.error) throw new Error(`lookup child briefs for ${sid} failed: ${childBriefs.error.message}`);
    for (const b of childBriefs.data ?? []) {
      const briefId = String(b.id);
      await throwIfError(db.from('brief_options').delete().eq('brief_id', briefId), `delete brief_options for ${briefId}`);
      await throwIfError(db.from('brief_sources').delete().eq('brief_id', briefId), `delete brief_sources for ${briefId}`);
      await throwIfError(db.from('chat_turns').delete().eq('brief_id', briefId), `delete chat_turns for ${briefId}`);
      await throwIfError(db.from('artifacts').delete().eq('brief_id', briefId), `delete artifacts for ${briefId}`);
      await throwIfError(db.from('briefs').delete().eq('id', briefId), `delete brief ${briefId}`);
    }
    await throwIfError(db.from('sessions').delete().eq('id', sid), `delete session ${sid}`);
  }
  console.log(`  - cleared ${LEGACY_DEMO_SESSION_IDS.length} legacy demo sessions`);
}

async function insertProjects(capSheetSeed: NbaCapSheetSeed, now: string) {
  const projects = DEMO_PROJECTS.map((project) => ({
    id: project.id,
    user_id: null,
    title: project.title,
    question: project.question,
    objective: project.objective,
    workflow_type: project.workflow_type,
    subject_team_id: project.subject_team_id,
    counterparty_team_id: project.counterparty_team_id,
    inbound_player_id: findPlayer(capSheetSeed, project.inbound_player.team_id, project.inbound_player.name)?.nba_player_id ?? null,
    trigger_summary: project.trigger_summary,
    counterparty_context: project.counterparty_context,
    active_step: project.active_step,
    status: project.status,
    package_status: project.package_status,
    source_brief_id: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
  }));
  await throwIfError(db.from('projects').insert(projects), 'insert projects');

  const stageNotes = DEMO_PROJECTS.flatMap((project) =>
    PROJECT_STEPS.map((step) => ({
      project_id: project.id,
      step,
      body: stageBodyFor(project, step),
      ai_draft: STEP_NOTES[step],
      citation_refs: [],
      created_at: now,
      updated_at: now,
    })),
  );
  await throwIfError(db.from('project_stage_notes').insert(stageNotes), 'insert project stage notes');

  const tasks = DEMO_PROJECTS.flatMap((project) =>
    TASK_TEMPLATES.map((task) => ({
      project_id: project.id,
      step: task.step,
      label: task.label,
      required: task.required,
      completed_at: taskCompletedAt(project.active_step, task.step, now),
      sort_order: task.sort_order,
      source: task.source,
      created_at: now,
      updated_at: now,
    })),
  );
  await throwIfError(db.from('project_tasks').insert(tasks), 'insert project tasks');

  const scenarios = DEMO_PROJECTS.flatMap((project) =>
    project.scenarios.map((scenario) => ({
      id: scenario.id,
      project_id: project.id,
      title: scenario.title,
      summary: scenario.summary,
      status: scenario.status,
      rank: scenario.rank,
      participating_teams: scenario.participating_teams,
      notes: scenario.notes,
      basketball_fit: scenario.basketball_fit,
      risks: scenario.risks,
      phone_framing: scenario.phone_framing,
      walk_away: scenario.walk_away,
      counter_range: scenario.counter_range,
      validation_summary: scenario.validation_summary,
      created_at: now,
      updated_at: now,
    })),
  );
  await throwIfError(db.from('project_trade_scenarios').insert(scenarios), 'insert project scenarios');

  const players = DEMO_PROJECTS.flatMap((project) =>
    project.scenarios.flatMap((scenario) =>
      scenario.players.map((player) => scenarioPlayerRow(capSheetSeed, scenario.id, player, now)),
    ),
  );
  await throwIfError(db.from('project_scenario_players').insert(players), 'insert scenario players');

  const assets = DEMO_PROJECTS.flatMap((project) =>
    project.scenarios.flatMap((scenario) =>
      (scenario.assets ?? []).map((asset) => ({
        id: asset.id,
        scenario_id: scenario.id,
        asset_type: asset.asset_type,
        label: asset.label,
        direction: asset.direction,
        team_id: asset.team_id,
        amount: asset.amount ?? null,
        notes: asset.notes,
        created_at: now,
        updated_at: now,
      })),
    ),
  );
  if (assets.length > 0) {
    await throwIfError(db.from('project_scenario_assets').insert(assets), 'insert scenario assets');
  }

  const validations = DEMO_PROJECTS.flatMap((project) =>
    project.scenarios.flatMap((scenario) =>
      scenario.validations.map((validation) => ({
        id: validation.id,
        scenario_id: scenario.id,
        kind: validation.kind,
        status: validation.status,
        summary: validation.summary,
        details: validation.details ?? {},
        source_refs: validation.source_refs ?? [],
        validated_at: validation.validated ? now : null,
        created_at: now,
        updated_at: now,
      })),
    ),
  );
  await throwIfError(db.from('project_scenario_validations').insert(validations), 'insert scenario validations');

  const artifacts = DEMO_PROJECTS.flatMap((project) =>
    project.scenarios.flatMap((scenario) =>
      (scenario.artifacts ?? []).map((artifact) => ({
        id: artifact.id,
        project_id: project.id,
        scenario_id: scenario.id,
        artifact_type: artifact.artifact_type,
        title: artifact.title,
        url: artifact.url,
        notes: artifact.notes,
        metadata: artifact.metadata ?? { seed: 'projects-demo' },
        created_at: now,
        updated_at: now,
      })),
    ),
  );
  if (artifacts.length > 0) {
    await throwIfError(db.from('project_artifacts').insert(artifacts), 'insert project artifacts');
  }

  const packages = DEMO_PROJECTS.flatMap((project) => project.package
    ? [{
        id: project.package.id,
        project_id: project.id,
        status: project.package.status,
        markdown: project.package.markdown,
        sections: project.package.sections,
        source_refs: project.package.source_refs,
        generated_at: now,
        created_at: now,
        updated_at: now,
      }]
    : []);
  if (packages.length > 0) {
    await throwIfError(db.from('project_packages').insert(packages), 'insert project packages');
  }
}

function scenarioPlayerRow(
  capSheetSeed: NbaCapSheetSeed,
  scenarioId: string,
  player: DemoScenarioPlayerSeed,
  now: string,
) {
  const row = findPlayer(capSheetSeed, player.team_id, player.name);
  const salary = salaryFor(row, player);
  return {
    id: player.id,
    scenario_id: scenarioId,
    team_id: player.team_id,
    nba_player_id: row?.nba_player_id ?? null,
    player_name: row?.player_name ?? player.name,
    direction: player.direction,
    salary_amount: salary.amount,
    salary_source_status: salary.status,
    manual_override: player.manual_override ?? false,
    stats_snapshot: row?.stats ?? null,
    created_at: now,
    updated_at: now,
  };
}

function findPlayer(seed: NbaCapSheetSeed, teamId: string, name: string): NbaCapSheetPlayerRow | null {
  const normalizedName = normalizeName(name);
  const sheet = seed.cap_sheets.find((candidate) => candidate.team_id === teamId);
  return sheet?.player_rows.find((row) => normalizeName(row.player_name) === normalizedName) ?? null;
}

function salaryFor(
  row: NbaCapSheetPlayerRow | null,
  player: DemoScenarioPlayerSeed,
): { amount: number | null; status: ProjectSalarySourceStatus } {
  if (player.manual_salary_amount !== undefined || player.salary_source_status) {
    return {
      amount: player.manual_salary_amount ?? null,
      status: player.salary_source_status ?? 'manual',
    };
  }

  const cell = row?.salary_cells.find((candidate) => candidate.season === '2025-26')
    ?? row?.salary_cells.find((candidate) => candidate.amount !== null)
    ?? row?.salary_cells[0]
    ?? null;
  return {
    amount: cell?.amount ?? row?.total_amount ?? null,
    status: cell?.source_status ?? row?.source_status ?? 'source-needed',
  };
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2019]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stageBodyFor(project: DemoProjectSeed, step: ProjectStepId): string {
  if (step === project.active_step) {
    return `${STEP_NOTES[step]} Current focus: ${project.objective}`;
  }
  return STEP_NOTES[step];
}

function taskCompletedAt(activeStep: ProjectStepId, taskStep: ProjectStepId, now: string): string | null {
  return PROJECT_STEPS.indexOf(taskStep) < PROJECT_STEPS.indexOf(activeStep) ? now : null;
}

async function throwIfError<T extends { error: { message: string } | null }>(promise: PromiseLike<T>, label: string) {
  const result = await promise;
  if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
  return result;
}

main().catch((err) => {
  console.error('demo seed failed:', err);
  process.exit(1);
});
