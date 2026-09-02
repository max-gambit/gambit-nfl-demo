# New York Giants NFL Demo — GoalSpec

## Objective

Transform `gambit-nfl-demo` into a trustworthy, football-operations-first New York Giants decision operating system on localhost, centered on a deterministic cap-and-roster workflow, current source-backed data, explicit evidence/governance, NFL-native supporting surfaces, and a repeatable presenter mode with zero visible NBA contamination.

## Product contract

- Primary audience: New York Giants football operations.
- Hero workflow: deterministic cap-and-roster decision modeling.
- Active navigation: Briefing, Decision Room, Workspaces, Roster & Cap, Rulebook, Settings.
- Public demo data only; private team inputs remain explicitly unconnected.
- The hero remains useful without Anthropic. Model output may explain validated payloads but never creates or repairs financial math.
- Active UI, seeds, presenter fixtures, and exports contain no NBA-facing language or fields.

## Acceptance contract

- Every browser-reachable product surface is NFL-native and coherent.
- The cap-and-roster endpoint returns four reconciling deterministic branches and enforces protection, source-quality, and infeasible-target rules.
- Roster and cap readiness is DB-backed, no older than 48 hours, and honestly labeled; stale or fallback critical data blocks meeting readiness.
- Every material recommendation is traceable to player rows and exact rule locators.
- `?present=nyg-cap-roster` passes two consecutive clean rehearsals at the specified desktop and narrow viewports.
- Root/server typechecks, build, full server tests, focused NFL tests, canonical QA, adversarial QA, `demo:verify:nfl`, `git diff --check`, Autoreview, and fresh-eyes review complete.
- No BLOCKER/HIGH QA finding remains, and no MEDIUM finding remains in the hero workflow.

## Execution graph

1. Independent read-only scouts: football-operations surface, data/rules integrity, state/QA safety.
2. Independent foundations: data truth, rules authority, NFL QA harness.
3. Independent decision intelligence: deterministic engine and answer guardrails.
4. Independent product shell: NFL shell, Decision Room, evidence experience.
5. Independent supporting surfaces: Workspaces, safe seed/migration, Rulebook.
6. Independent read-only red team: football-ops usability, data integrity, NBA reachability.

Every durable run contains dependency-free nodes with exact reservations. At most three workers run concurrently and at most two write workers run concurrently. Workers operate only in detached clones and return `codex_task_worker_result.v1`; the root imports authenticated patches serially and owns all integration and Git actions.

## Root-owned interfaces

- `shared/types.ts`
- `src/App.tsx`
- session/UI state and tenant configuration
- API and route wiring
- presenter-mode routing and reset
- workspace filtering and draft-session persistence
- package scripts and final browser verification

## Loop contract

- **contract checklist:** preserve integer dollars; never label negative economics as relief; one transaction action per player per branch; branch totals equal action components; protected players/groups cannot be cut or traded; source-needed rows cannot drive exact recommendations; missing authoritative rule locators block rule-backed claims; impossible targets return the maximum supported relief with `insufficient_evidence`; manual assumptions are temporary and labeled.
- **role policy:** root is orchestrator/integrator/verifier; detached agents are bounded scouts, executors, or reviewers only.
- **durable state:** this GoalSpec, Git branch checkpoints, authenticated orchestrator receipts, deterministic fixtures, and meeting snapshot provenance.
- **restart policy:** recover the active orchestrator run, retain passed nodes, and retry only failed nodes. Maximum two attempts per worker; repeated same-scope failure moves local or becomes a blocker.
- **quality rubric:** mathematical correctness, source authority/freshness, football-operations actionability, honest uncertainty, active-path NFL language, responsive presenter reliability.
- **trace policy:** material values resolve to a player/contract row and source; material rules resolve to an authoritative URL and locator; deterministic payload remains the audit record beneath prose.
- **harness pruning policy:** no new framework unless it directly enforces an acceptance gate; reuse current Hono, React, Zustand, Supabase, and QA patterns.
- **bottleneck watch:** stale public data, missing contract mechanics, rule-locator gaps, unsafe seed/reset behavior, and shared-contract churn.

## Baseline — 2026-09-02

- Git start point: `origin/main` at `87261d3`.
- Upstream drift: the current main commit titled `Add NFL context composer critic` also contains an inherited RealGM/NBA corpus. This task will not rewrite history; inherited NBA implementation must remain dormant and unreachable from the NYG active path.
- Browser at 1440×900: New York Giants header, but active navigation is `League / Analyze / Projects / Database / NFL Rules`; the channel rail exposes Philadelphia/76ers prompts and an empty Untitled channel.
- Client title: `Gambit · Analyze` at `http://localhost:5173/`.
- Server baseline: neither `http://localhost:8787/health` nor `http://localhost:8788/health` was reachable. The client was rendering from an already-running Vite process without a live Hono API.
- Existing checked-in NFL/rule metadata is dated 2026-06-25, so it is not meeting-ready under the 48-hour critical-data policy.

## Stop conditions

- All acceptance gates pass.
- A required authoritative public source cannot be safely retrieved or reconciled.
- The same blocker repeats without new evidence.
- The next step would require private Giants data, production/deployment authority, destructive cleanup, PR creation, merge, release, or a scope change.
