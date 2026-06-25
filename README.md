# Gambit UI Remix

Gambit UI Remix is the working product prototype for Gambit's NBA front-office operating system. It combines an AI decision-brief workspace, current NBA reference data, and source-backed Intel so basketball operators can ask roster, cap, trade, and team-strategy questions with visible evidence instead of generic chat output.

The app is intentionally product-shaped rather than demo-slide-shaped: the first screen is the usable Analyze workspace, with supporting Dashboard, War Room, Database, and Settings surfaces.

## What It Includes

- **Analyze workspace**: channel-style decision briefs, follow-up chat, right-panel brief threads, source cards, artifacts, and compare flows.
- **AI brief generation**: Anthropic-backed recommendation briefs, follow-up chat, agent outputs, context-graph tool use, and data-analyst mode.
- **NBA data layer**: seeded roster, cap-sheet, and player-stat snapshots exposed through the app database and `/nba/*` server routes.
- **NBA Intel**: one YAML source file per NBA team, generated relationship artifacts, validation/reporting tools, Settings overrides, and AI lookup adapters.
- **Intel onboarding**: first-run team-context capture that stores user-provided priorities, working style, and trust boundaries as local Intel overrides.
- **War Room**: a team-specific executive-demo surface built on the generic Intel read model.
- **QA harness**: optional Playwright + Claude exploratory QA that walks canonical flows and writes a findings report.

## Tech Stack

- React 18, TypeScript, Vite
- Zustand state stores
- Hono server on Node
- Supabase local database and storage
- Anthropic SDK for chat, briefs, agents, and QA harness flows
- Git-tracked NBA data and Intel artifacts

## Repository Layout

```text
.
  src/                         React app
    fenway/                    Core Analyze shell and brief UI
    onboarding/                Intel onboarding flow
    war-room/                  Team-specific executive demo surface
    database/                  NBA roster/cap/stat database UI
    settings/                  Intel settings UI
    api/                       Browser API clients
    store/                     Zustand slices
  server/
    src/routes/                Hono route modules
    src/claude/                Anthropic prompts, tools, and adapters
    src/context_graph/         Intel parser, validator, routes, AI adapter helpers
    src/nba_*                  NBA roster/cap/stat seed and route helpers
    tests/                     Node test suites
  shared/                      Shared TypeScript contracts
  data/
    nba-context-graph/         Team YAML sources, derived graph JSON, validation report
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
VITE_ONBOARDING_TEAM_ID=GSW
VITE_DISABLE_ONBOARDING_GATE=true
VITE_FORCE_ANALYZE_START=true
```

Use those flags when you want the prototype to skip first-run onboarding and open directly on Analyze.

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
npm run db:status
npm run db:reset
npm run db:seed
npm run qa                   # Optional exploratory QA harness
```

## Intel Workflow

The Intel source lives under `data/nba-context-graph/teams`, with one YAML file per NBA team. Derived artifacts live under `data/nba-context-graph/derived`.

Common commands:

```sh
npm --prefix server run context-graph:validate
npm --prefix server run context-graph:build
npm --prefix server run context-graph:report
npm --prefix server run context-graph:audit
npm --prefix server run context-graph:repair:safe -- --dry-run
npm --prefix server run context-graph:repair:source-backed -- --dry-run
```

Runtime preference and onboarding edits are stored in gitignored local override files under `data/nba-context-graph/overrides/*.local.json`. The tracked YAML and derived JSON remain the reviewable source layer.

See `data/nba-context-graph/README.md` for the deeper schema, validation, repair, and AI-tooling contract.

## Key Server Routes

```text
GET    /health
POST   /briefs
POST   /chat
GET    /monitors
GET    /nba/rosters/current
GET    /nba/cap-sheets/current
GET    /nba/player-stats/current
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

The QA harness is exploratory rather than pass/fail regression testing. It requires the app and Supabase to already be running:

```sh
npm run qa
```

Reports are written under `qa-harness/runs/<timestamp>/`.

## Data And Privacy Notes

- Local `.env`, `.env.local`, and `data/nba-context-graph/overrides/*.local.json` files are gitignored.
- Do not commit real API keys, private connector tokens, raw transcripts, private emails, or production credentials.
- Intel onboarding stores concise team-provided context, not raw conversations.
- Export bundles under `exports/` may include local onboarding/preferences context. Review them before sending outside Gambit.

## Current Demo Defaults

- The default Intel team is `GSW`.
- The War Room is tuned for the Golden State Warriors front-office demo thread.
- To skip onboarding and force Analyze on startup, run the client with:

```sh
VITE_ONBOARDING_TEAM_ID=GSW VITE_DISABLE_ONBOARDING_GATE=true VITE_FORCE_ANALYZE_START=true npm run dev
```

## Project Status

This is an active internal prototype. Treat the app as the source of product behavior, the tracked data files as reviewable source artifacts, and generated local overrides/exports as operational handoff material that should be reviewed before reuse.
