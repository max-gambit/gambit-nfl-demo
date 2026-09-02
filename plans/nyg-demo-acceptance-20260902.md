# New York Giants demo acceptance — 2026-09-02

## Outcome

The localhost product is a Giants-first football-operations decision system. Its hero cap-and-roster workflow is deterministic, DB-backed, available without an LLM provider, and blocked whenever the presenter preflight fails.

## Runtime contract

- Presenter: `http://localhost:5173/?present=nyg-cap-roster`
- API: `http://localhost:8790`
- Workspace: `nyg-demo`
- Hero seed: `nyg-cap-roster-2026`
- Public-data as of: 2026-09-02
- Critical source mode at acceptance: `supabase_current_views`
- Overall data state: `degraded` because some historical performance rows lack a public sample
- Hero meeting state: `meeting_ready=true`; roster, cap, arithmetic, seed ownership, rule authority, and presenter-fixture gates pass

## Source and evidence boundary

- Roster: NFL.com public team roster pages.
- Contract mechanics: OverTheCap public contract ledger, with exact rows admitted only when term, guarantee, cut, trade, and post-June fields are present and arithmetic reconciles.
- Historical role context: nflverse 2025 public feeds. Only captured snap-share samples can grade depth effect; source-needed samples stay `unknown` and cannot enter the preserve-depth branch.
- Rules: official NFL/NFLPA sources with exact locators. Executed-CBA rows carry the verified SHA-256 for the downloaded executed PDF: `sha256:3bc66c14952ac1af0ff491731e6ab8c21dd2b284b650b1f2a97d943a3850ebee`.
- Private Giants inputs are not connected. Temporary presenter assumptions are labeled `user_entered` and are not persisted.

## Acceptance evidence

- Root TypeScript typecheck: PASS
- Server TypeScript typecheck: PASS
- QA harness TypeScript typecheck: PASS
- Production build: PASS
- Full server suite: PASS, 257/257 tests
- `demo:verify:nfl`: PASS, 13/13 checks
- Canonical presenter QA: PASS, 30/30 checks across two consecutive rehearsals
- Adversarial QA: PASS, 10/10 checks
- `git diff --check`: PASS
- Canonical report: `qa-harness/runs/2026-09-02T19-04-08-713Z-canonical/report.md`
- Adversarial report: `qa-harness/runs/2026-09-02T19-04-39-313Z-adversarial/report.md`

## Independent review disposition

Run `nyg-demo-level-up-20260902-run6-red-team` is closed. All three reviewer outputs were settled as integrated after root verification.

- Football-operations review: fixed stale visible branches, request races, branch/evidence mismatch, responsive evidence focus, reset state, blocked briefing claims, roster-status semantics, exact dollar display, protection controls, workspace stages, and follow-up evidence rendering.
- Data-integrity review: replaced malformed CBA hashes, blocked recommendation/action leakage, arithmetic-invalid exact-row admission, overlapping coverage counts, and numeric/player/citation critic gaps. Independent hero recomputation and protection checks already passed.
- NBA-bleed review: removed the active `/nba` server mount, NBA-only seed field, and exported/served legacy team assets. User-authored workspace text remains uncensored by design; active product copy, seed schema, routes, imports, exports, and presenter DOM are the contamination boundary.

Autoreview ran once against `origin/main`, as required. Its four material findings were handled without rerunning the reviewer: position aliases now normalize comprehensively; the normal seed is NFL-only, non-destructive, and includes the presenter fixture; unsourced metrics cannot drive depth recommendations; and numeric guardrails reject dollar, bare-number, magnitude, and spelled-out money claims that are absent from the deterministic payload.

## Final judgment

No known BLOCKER or HIGH finding remains. No known MEDIUM finding remains in the hero workflow. Live model prose is optional and can only explain a validated branch; two rejected drafts fall back to the deterministic summary. No production write, deployment, pull request, merge, or destructive cleanup was performed.
