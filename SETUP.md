# Gambit UI Remix — Setup

## Prereqs
- Node 20+
- Docker Desktop (running) — for the local Supabase stack
- An Anthropic API key

## One-time setup

```bash
# 1. Install deps in both workspaces.
npm install
npm --prefix server install

# 2. Bootstrap env files. The local Supabase keys are already filled in
#    (they're deterministic dev defaults). Only ANTHROPIC_API_KEY needs you.
cp .env.local.example .env.local
cp server/.env.example server/.env

# 3. Edit server/.env and replace ANTHROPIC_API_KEY=sk-ant-... with your real key.

# 4. Boot the local Supabase stack (Postgres + Realtime + Storage + Studio).
#    First run pulls Docker images (~1 min). Subsequent runs are <10s.
npm run db:start

# 5. Migrations in supabase/migrations/ apply automatically on `db:start`.
#    Seed initial data (4 sessions, 3 briefs, options/sources/CBA for brief-1).
npm run db:seed
```

That's it. Studio (DB browser) is at http://127.0.0.1:54323.

## Dev loop

Two foreground processes — run each in its own terminal:

```bash
# Vite client at http://localhost:5173
npm run dev

# Hono server at http://localhost:8787
npm run server
```

Sanity check: `curl localhost:8787/health` should return `{"ok":true,"anthropic":true,"supabase":true}`.

The Supabase stack runs in Docker — leave it up across dev sessions, or `npm run db:stop` when done.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (client) |
| `npm run server` | Hono with `tsx watch` (auto-restart) |
| `npm run build` | Production client bundle |
| `npm run typecheck` | `tsc --noEmit` on the client |
| `npm run db:start` | Boot local Supabase (Docker) |
| `npm run db:stop` | Stop local Supabase |
| `npm run db:status` | Show URLs + keys for the running stack |
| `npm run db:reset` | Drop + recreate the local DB, re-apply migrations |
| `npm run db:seed` | (Re-)seed the data |
| `npm run db:diff` | Diff your local DB vs migrations (capture ad-hoc edits) |

## Schema changes

```bash
# Make changes in Studio (http://127.0.0.1:54323) or via psql.
# Then capture them as a new migration:
npx supabase db diff -f some_change_name

# That writes supabase/migrations/<timestamp>_some_change_name.sql.
# Apply on next `db:reset` or `db:start`.
```

## Project layout

```
.
├── src/                  Vite/React client
│   ├── api/              Typed wrappers for Hono + Supabase
│   ├── store/            Zustand slices (sessions, briefs, tray, ui)
│   ├── ds/, fenway/, briefs/, agents/   UI components
│   ├── theme/, lib/      Palette, event bus
│   └── data/mocks.ts     Seed source for the store (Phase 0; shrinks in Phase 1+)
├── server/               Hono + Anthropic + Supabase backend
│   └── src/
│       ├── routes/       /chat /agent /briefs /monitors
│       ├── claude/       SDK client, prompts, tools, agent handlers (Phase 1+)
│       └── db/           Supabase service-role client + seed.ts
├── supabase/             Local Supabase stack
│   ├── config.toml       Stack config (auto-generated)
│   └── migrations/       Versioned schema (apply via `db:start` or `db:reset`)
└── shared/types.ts       DB row + tool I/O contracts shared by both sides
```

## Going to a real Supabase project (later)

When you're ready to deploy:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # ship migrations to the remote project
```

Then swap the env URLs/keys in `.env.local` and `server/.env` to the cloud project's values (from supabase.com → Settings → API).
