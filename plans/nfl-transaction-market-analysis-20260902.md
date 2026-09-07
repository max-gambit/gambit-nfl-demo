# NFL Transaction Market Analysis — GoalSpec

## Objective

Make Gambit Analysis capable of answering novel NFL historical transaction-market questions from governed local data, with deterministic calculations, traceable comparables, explicit methodology, and no unsupported market claims.

## Product contract

- Analysis remains the primary demo surface; transaction-market work is a tool inside the existing Question workspace.
- Runtime answers query the current local database snapshot. Seeds contain source data and metadata, never conclusions.
- The deterministic engine owns periods, cohorts, position taxonomy, calculations, comparables, and citations. The model explains those validated results but cannot repair or replace them.
- Default trend window is the ten completed league years 2016–2025; 2026 appears only as labeled year-to-date context.
- Default material moves include trades and supported veteran contract events. Administrative reserve and practice-squad churn is excluded unless explicitly requested.
- Public-release data is a demo prototype with visible attribution and coverage/licensing caveats, not a claim of production data rights.

## Source contract

- nflverse trades: exact trade dates, parties, player assets, pick assets, and conditionality; upstream attribution to Lee Sharpe / Pro Football Reference.
- nflverse players and historical rosters: stable player IDs, position normalization, and position-year denominators.
- nflverse historical contracts: OverTheCap-derived contract type, signing year, value, APY, guarantees, and APY as a share of the league cap where available.
- NFL.com may be used only for manual spot checks and outbound source links. No systematic NFL.com retrieval.
- Every accepted snapshot records release URLs, retrieval and source timestamps, SHA-256 checksums, row counts, coverage ranges, identity-match rates, term coverage, transformation version, and upstream caveats.

## Acceptance contract

- `POST /nfl/transaction-market/analyze` returns `nfl_transaction_market.v1` for trend, period comparison, comparables, and recent-influence requests.
- Mobility is calculated as events per 100 roster player-seasons plus share of league material moves.
- Trade price uses transparent pick bands; multi-player deals are not assigned fabricated per-player prices.
- Contract price uses median APY/cap basis points and guaranteed share with integer-dollar inputs.
- Position direction is firm only with the required identity coverage, sample sizes, and agreement between at least two supported signals; otherwise the result is directional, mixed, flat, or insufficient.
- Ty's market-growth question and all four follow-ups execute fresh tool calls and expose filters, method, series, comparables, sources, and caveats.
- Two unrelated prompts pass without production fixtures, and an isolated inserted transaction changes the computed result.
- The existing evidence rail opens the exact source snapshot and transaction details used by each material claim.
- Root/server typechecks, build, full tests, transaction suites, `demo:verify:nfl`, canonical/adversarial QA, browser QA at 1440x900, 1280x720, and 1024x768, two clean rehearsals, Autoreview, and fresh-eyes review pass.

## Loop contract

- **role policy:** root owns shared contracts, integration, browser verification, Git, and final judgment; detached workers own only exact disjoint reservations.
- **durable state:** this GoalSpec, immutable normalized snapshot plus manifest, database migration, deterministic fixtures, authenticated worker receipts, and Git checkpoints.
- **restart policy:** retain passed workers, retry only failed nodes, and move repeated same-scope failures local after two attempts.
- **quality rubric:** arithmetic determinism, position-identity confidence, source traceability, coverage honesty, follow-up fidelity, football-operations usefulness, and responsive in-person presentation.
- **trace policy:** every displayed number resolves to the deterministic artifact; every comparable resolves to normalized source rows; every model source reference resolves to a returned tool citation.
- **harness pruning:** reuse Hono, Supabase, React, the existing Analysis composer, evidence rail, and critic; add no parallel scripted demo surface.
- **bottleneck watch:** public-source licensing boundaries, stale contract releases, ambiguous EDGE mappings, sparse compensation, incomplete transaction classes, and model prose that outruns the evidence.

## Stop conditions

- All acceptance gates pass.
- A required public release cannot be safely retrieved, parsed, attributed, or reconciled.
- The same blocker repeats without new evidence.
- The next step requires private Giants data, production writes, deployment, PR creation, merge, release, destructive cleanup, or an unapproved paid data provider.
