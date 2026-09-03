# Giants demo QA harness

This harness validates the New York Giants public-demo workflow with deterministic Playwright and API checks. It does not require Anthropic or any other model provider.

## Modes

- `npm run qa:canonical` runs two consecutive live-demo rehearsals at 1440×900 and 1280×720, plus the 1024×768 responsive check.
- `npm run qa:adversarial` probes impossible targets, invalid inputs, protection rules, arithmetic, citation abstention, blocked preflight, private-input refusal, and active-output contamination.
- `npm --prefix qa-harness run typecheck` checks the harness itself.

The app and Hono server must already be running on localhost. The accepted local run also supplies the current local Supabase URL and service-role key so the harness can remove only rows explicitly marked `workspace_key=nyg-demo` and `seed_key=qa:*`. It never resets legacy rows or user-created NYG workspaces.

Each run writes `report.json`, `report.md`, and bounded screenshots under `qa-harness/runs/<timestamp>-<mode>/`. A run exits non-zero on any finding.
