# gambit-nfl-demo

`gambit-nfl-demo` is an internal NFL demo fork of Gambit's front-office operating-system prototype. The visible profile and Intel preference surfaces default to the New York Giants / `NYG`, while the app preserves the existing three-panel shell and adds reviewed static NFL roster, cap, rules, and Intel data for demo use.

The app is intentionally product-shaped rather than demo-slide-shaped: the first screen remains the usable three-panel workspace, with supporting Dashboard, Database, and Settings surfaces. Settings is available for profile/preferences even when first-run onboarding is skipped.

## What It Includes

- **Three-panel workspace**: channel-style decision briefs, follow-up chat, right-panel brief threads, source cards, artifacts, and compare flows.
- **AI brief generation**: Anthropic-backed recommendation briefs, follow-up chat, agent outputs, context-graph tool use, and NFL data-analyst mode. Live generated flows require `ANTHROPIC_API_KEY`.
- **Legacy NBA data layer**: seeded roster, cap-sheet, and player-stat snapshots remain available through `/nba/*` server routes for compatibility tests.
- **NFL data layer**: reviewed static NFL.com roster rows, public cap rows, roster-derived metric placeholders, Supabase `nfl_*` snapshot tables/views, and `/nfl/*` server routes.
- **NFL Intel slice**: NFL context-graph source files, generated relationship artifacts, validation/reporting tools, Settings overrides, and AI lookup adapters.
- **Intel onboarding**: optional team-context capture that stores user-provided priorities, working style, and trust boundaries as local Intel overrides. The first-run gate is disabled by default in this fork.
- **Settings profile/preferences**: profile and source-connection surfaces tuned for the NFL internal demo.
- **QA harness**: optional Playwright + Claude exploratory QA that walks canonical flows and writes a findings report.

## Tech Stack

- React 18, TypeScript, Vite
- Zustand state stores
- Hono server on Node
- Supabase local database and storage
- Anthropic SDK for chat, briefs, agents, and QA harness flows
- Git-tracked NFL/NBA demo data and Intel artifacts

## Repository Layout

```text
.
  src/                         React app
    fenway/                    Core Analyze shell and brief UI
    onboarding/                Optional Intel onboarding flow
    war-room/                  Legacy team-specific executive demo surface
    database/                  Legacy NBA roster/cap/stat database UI
    settings/                  Intel settings UI
    api/                       Browser API clients
    store/                     Zustand slices
  server/
    src/routes/                Hono route modules
    src/claude/                Anthropic prompts, tools, and adapters
    src/context_graph/         Intel parser, validator, routes, AI adapter helpers
    src/nba_*                  Legacy NBA roster/cap/stat seed and route helpers
    tests/                     Node test suites
  shared/                      Shared TypeScript contracts
  data/
    nfl-context-graph/         NFL team YAML sources, derived graph JSON, validation report
    nba-context-graph/         Legacy NBA team YAML sources and derived artifacts
    nfl-demo/                  Reviewed NFL roster/cap/player-metric snapshot
    nba-rosters/               Reviewed roster seed snapshot
    nba-cap-sheets/            Reviewed cap-sheet seed snapshot
    nba-player-stats/          Reviewed player-stat seed snapshot
  supabase/                    Local database config and migrations
  qa-harness/                  Optional exploratory QA runner
  exports/                     Dated handoff/export bundles
```

## Prerequisites

- Node.js 20 or newer
- npm
- Supabase CLI
- An Anthropic API key for generated briefs, chat, agents, and QA

## Install

```sh
npm install
npm --prefix server install
```

The QA harness has its own optional dependencies:

```sh
npm --prefix qa-harness install
npm --prefix qa-harness exec playwright install chromium
```

## Environment

Create `server/.env` from the example:

```sh
cp server/.env.example server/.env
```

Then set:

```text
ANTHROPIC_API_KEY=...
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=...
PORT=8787
```

Create a root `.env.local` for the Vite client:

```text
VITE_SERVER_URL=http://localhost:8787
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<local anon key from `supabase status`>
```

Optional Intel onboarding flags:

```text
VITE_ONBOARDING_TEAM_ID=NYG
VITE_DISABLE_ONBOARDING_GATE=true
VITE_FORCE_ANALYZE_START=true
```

The onboarding gate is disabled by default. Set `VITE_DISABLE_ONBOARDING_GATE=false` only when you explicitly want to exercise the first-run onboarding flow.

## Run Locally

Start Supabase:

```sh
npm run db:start
```

Apply migrations and seed baseline data:

```sh
npm run db:reset
```

Start the full app stack:

```sh
npm run dev
```

Default local URLs:

- Client: `http://localhost:5173`
- Server: `http://localhost:8787`
- Health check: `http://localhost:8787/health`

The dev command runs Vite and the Hono server together. If another process already owns `5173`, Vite may choose the next available port; update `CLIENT_ORIGIN` for the server if you run the client on a custom port outside the configured localhost origins.

## Useful Commands

```sh
npm run dev                  # Client + server
npm run dev:client           # Vite only
npm run dev:server           # Hono server only
npm run build                # TypeScript project build + Vite production build
npm run typecheck            # Client/shared TypeScript check
npm --prefix server test     # Server data/context-graph/NBA tests
npm --prefix server run typecheck
npm --prefix server run build:nfl-data
npm --prefix server run seed:nfl-data
npm run db:status
npm run db:reset
npm run db:seed
npm run qa                   # Optional exploratory QA harness
```

## Intel Workflow

The NFL Intel source lives under `data/nfl-context-graph/teams`, with one YAML file per NFL team. Derived artifacts live under `data/nfl-context-graph/derived`.

Common commands:

```sh
npm --prefix server run context-graph:validate
npm --prefix server run context-graph:build
npm --prefix server run context-graph:report
npm --prefix server run context-graph:audit
npm --prefix server run context-graph:repair:safe -- --dry-run
npm --prefix server run context-graph:repair:source-backed -- --dry-run
```

Runtime preference and onboarding edits are stored in gitignored local override files under the context-graph overrides directory. The tracked YAML and derived JSON remain the reviewable source layer.

See the context-graph README in the relevant data directory for the deeper schema, validation, repair, and AI-tooling contract.

## Key Server Routes

```text
GET    /health
POST   /briefs
POST   /chat
GET    /monitors
GET    /nba/rosters/current
GET    /nba/cap-sheets/current
GET    /nba/player-stats/current
GET    /nfl/rosters/current
GET    /nfl/cap-sheets/current
GET    /nfl/cap-sheets/current/:teamId
GET    /nfl/player-stats/current
GET    /nfl/player-stats/current/:teamId
GET    /nfl/rules
GET    /context-graph/preferences
PATCH  /context-graph/preferences/:teamId
GET    /context-graph/onboarding/:teamId
PATCH  /context-graph/onboarding/:teamId
POST   /context-graph/onboarding/:teamId/complete
GET    /context-graph/war-room/:teamId
```

The exact request and response contracts are defined in `shared/types.ts`.

## Testing And Verification

Use this minimum check before pushing product or data-layer changes:

```sh
npm --prefix server test
npm run build
```

For Intel data work, also run:

```sh
npm --prefix server run context-graph:validate
npm --prefix server run context-graph:build
```

For NFL roster/cap data work, rebuild and validate the reviewed static snapshot:

```sh
npm --prefix server run build:nfl-data
npm --prefix server test -- --test-name-pattern NFL
```

The QA harness is exploratory rather than pass/fail regression testing. It requires the app and Supabase to already be running:

```sh
npm run qa
```

Reports are written under `qa-harness/runs/<timestamp>/`.

## Data And Privacy Notes

- Local `.env`, `.env.local`, and `data/nba-context-graph/overrides/*.local.json` files are gitignored.
- Do not commit real API keys, private connector tokens, raw transcripts, private emails, or production credentials.
- Intel onboarding, when explicitly enabled, stores concise team-provided context, not raw conversations.
- Export bundles under `exports/` may include local onboarding/preferences context. Review them before sending outside Gambit.

## Current Demo Defaults

- The default Intel/profile team is `NYG`.
- The header/profile surface is tuned for the New York Giants internal demo thread.
- First-run onboarding is skipped by default. To force Analyze on startup, run the client with:

```sh
VITE_ONBOARDING_TEAM_ID=NYG VITE_FORCE_ANALYZE_START=true npm run dev
```

## Project Status

This is an active internal prototype. Treat the app as the source of product behavior, the tracked data files as reviewable source artifacts, and generated local overrides/exports as operational handoff material that should be reviewed before reuse.
