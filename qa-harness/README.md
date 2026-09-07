# Giants demo QA harness

This harness validates the New York Giants public-demo workflow with deterministic Playwright and API checks. It does not require Anthropic or any other model provider.

## Modes

- `npm run qa:canonical` runs two consecutive live-demo rehearsals at 1440×900 and 1280×720, plus the 1024×768 responsive check.
- `npm run qa:adversarial` probes impossible targets, invalid inputs, protection rules, arithmetic, citation abstention, blocked preflight, private-input refusal, and active-output contamination.
- `npm run qa:reliability:nfl` runs 194 zero-cost routing, scope-inheritance, deadline, and intent cases. It never calls a model.
- `npm run qa:reliability:nfl:live` adds two isolated live scenarios with exactly three calls to the server's configured production answer model, verifies both rendered results in a browser, and requests one batched semantic judgment from `gpt-5.6-terra`.
- `npm --prefix qa-harness run typecheck` checks the harness itself.

The app and Hono server must already be running on localhost. The accepted local run also supplies the current local Supabase URL and service-role key so the harness can remove only rows explicitly marked `workspace_key=nyg-demo` and `seed_key=qa:*`. It never resets legacy rows or user-created NYG workspaces.

Canonical and adversarial runs write `report.json`, `report.md`, and bounded screenshots under `qa-harness/runs/<timestamp>-<mode>/`. The reliability gate writes a privacy-bounded `report.json` in the same ignored runs directory. A run exits non-zero on any finding.

## NFL answer reliability cost and data contract

The default gate is deterministic and free. The live gate is always explicit, never random, and hard-capped at two scenarios, three production-answer prompts, one Terra request, and 600 Terra output tokens. Terra receives only each completed answer plus a compact server-generated fact sheet; the request uses `store: false`. The saved QA report contains case IDs, assertions, timings, source categories, verdict classes, and token usage, but not the questions or answer text.

If `OPENAI_API_KEY` is absent, the live report records `skipped_no_openai_key`; it does not claim that Terra passed. Set `NFL_RELIABILITY_REQUIRE_JUDGE=1` to make that skip or an inconclusive verdict fail a required demo/release run. Set `NFL_RELIABILITY_REQUIRE_LIVE=1` to prevent a deterministic-only invocation where live coverage is mandatory.

Every live scenario uses a unique `workspace_key=nyg-demo` session whose `seed_key` begins `qa:answer-reliability:`. Cleanup deletes only those exact seed keys and reads them back to verify zero remaining rows.
