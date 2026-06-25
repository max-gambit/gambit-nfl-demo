# Gambit QA harness

Claude operates the Gambit prototype as a real user, walks the canonical flows, and produces a categorised findings report.

This is exploratory QA, not regression testing. The deliverable is **insight** — bugs, UX issues, and product gaps a domain user (an NBA front office staffer) would surface — not pass/fail.

## How it works

1. Wipes the local Supabase user-scoped tables so the run always starts cold.
2. Launches a real Chromium browser at 1280×800 via Playwright.
3. Streams against `claude-opus-4-7` with the `computer_use` beta tool. The tool spec is the canonical Anthropic one — we just back it with Playwright instead of xvfb+xdotool. Claude sees screenshots and emits clicks / keypresses.
4. Walks the [17 canonical flows](./src/flows.ts) end-to-end, time-boxing each.
5. At the end, Claude emits a fenced JSON block of findings; the harness parses it and renders a markdown report under `runs/<timestamp>/`.

## Pre-requisites

- The app must already be running locally: `npm run dev` from the repo root (vite + Hono server + monitor scheduler).
- Local Supabase must be up: `npm run db:start` (or it's already running).
- `server/.env` must have `ANTHROPIC_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. The harness loads it directly.

## Install

From this directory:

```sh
npm install
npx playwright install chromium
```

## Run

From the repo root:

```sh
npm run qa
```

Or from this directory:

```sh
npm start
```

The first run will pop a Chromium window and you'll watch Claude operate it live. Set `QA_HEADLESS=1` to run without a visible browser:

```sh
QA_HEADLESS=1 npm run qa
```

## Output

Each run produces a fresh directory:

```
qa-harness/runs/2026-04-28T13-22-04-123Z/
├── report.md              ← the human-readable findings report
├── transcript.json        ← full conversation, for debugging the harness or persona
└── screenshots/
    ├── 000.png
    ├── 001.png
    └── …
```

The report has three sections: **Summary** (counts by category × severity), **Flow coverage** (which flows ran, completed, blocked), and **Findings** (one section per finding, sorted BLOCKER → LOW, with the screenshot inlined).

## Iterating

The two highest-leverage files are:

- **`src/persona.ts`** — the system prompt. If findings feel hallucinated, off-topic, or low quality, tune the persona's "Things to ignore" list and the methodology section first.
- **`src/flows.ts`** — the user message. If a flow gets skipped, blocked, or misinterpreted, sharpen the success criterion or break it into smaller steps.

The Playwright wrapper (`src/computer.ts`) and the report renderer (`src/report.ts`) are stable infrastructure — change them when you're adding capability, not chasing finding quality.

## Cost & runtime envelope

- ~30–45 minutes wall clock for a comprehensive walk
- ~$8–20 in API spend (function of how chatty Claude is between actions)
- Iteration cap: 300 turns
- Wall-clock cap: 45 minutes
- Both caps are guardrails — a healthy run wraps at ~150–200 turns.

## Out of scope (for now)

- Adversarial probing — easy to add as a second run mode (just a new `flows-adversarial.ts`).
- CI integration — this is a manual exploratory tool.
- Cross-run diffing — possible by parsing report.md across runs.
- Real Anthropic computer-use Docker reference — Playwright is the right substrate for a web-only target. Revisit if we ever need to test desktop apps or file-system flows.
