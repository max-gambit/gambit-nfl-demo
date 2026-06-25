# Gambit NBA Context Graph Relationship Layer

## What Changed

- Added a TypeScript relationship-layer module under `server/src/context_graph`.
- Added strict YAML parsing and schema validation with file/line-aware validation messages.
- Added pure edge extractors for pick ownership, trade partners, rivalries, personnel connections, player-team roster membership, pending free agents, and historical pursuits.
- Added cross-team consistency validation for reciprocal picks, rivalries, recent trades, player uniqueness, pending FA roster membership, one-way personnel links, and untouchable duplicate-roster contradictions.
- Added JSON storage for derived graph artifacts plus a Markdown validation report.
- Added CLI scripts:
  - `npm --prefix server run context-graph:validate`
  - `npm --prefix server run context-graph:build`
  - `npm --prefix server run context-graph:report`
- Added fixture tests using Node's built-in test runner through `tsx`.
- Copied the 30 production team YAMLs into `data/nba-context-graph/teams`.
- Committed a generated validation snapshot in `data/nba-context-graph/derived/validation_report.md`.
- Added a Settings surface for curated per-team context graph preferences.
- Added `/context-graph/preferences` server routes for list, patch, and reset.
- Added a gitignored JSON override layer for runtime edits, with a tracked example file.
- Added `getEffectiveTeamContext(teamId)` as the AI-ready read contract.
- Added a Claude context graph adapter with a compact 30-team index and `lookup_context_graph_teams` tool over effective team context.
- Wired context graph lookup into initial brief generation, follow-up chat streaming, and agent outputs.
- Removed the hardcoded Warriors/mock cap snapshot from the AI prompt context.
- Added a persisted context-graph trust trail for AI outputs:
  - Generated briefs append `CONTEXT_GRAPH` source rows for teams looked up by Claude.
  - Chat assistant turns persist context graph lookup traces in `chat_turns.tool_calls`.
  - Brief source chips, left-rail source cards, and assistant chat replies expose team ids, validation state, freshness metadata, override state, and lookup errors.
- Added a Wizards War Room demo surface:
  - New top-level War Room nav tab with Wizards-branded workspace badge.
  - Generic `GET /context-graph/war-room/:teamId` read model over effective context, derived edges, and overrides.
  - Deterministic counterparty radar, relationship mini-map, roster pressure board, strategic tension board, scenario lenses, Settings handoff, one-click demo brief prompts, and AI lookup activity drawer.

## What Is Deferred

- Query API/access layer beyond the team-id lookup tool.
- RAG or vector indexing over narrative fields.
- Scraping, maintenance, or refresh pipelines.
- Postgres/Supabase hydration.
- Source citation UX beyond the informational context-graph trust trail.
- Formal prompt-quality evals.
- Data refresh/scraping for the Wizards demo pack.

## Storage Substrate Rationale

JSON was chosen for derived artifacts. Evidence from this repo points to a TypeScript app with Supabase/Postgres for app state, but no SQLite or DuckDB pattern for small derived data. The relationship graph is small, JSON is easy to diff and review, and the access layer has not been designed yet. This avoids locking in a database shape prematurely.

## Clarifying Questions Asked Max

1. Should this be TypeScript or Python given the repo shape?
   - Answer: TypeScript is fine; Python is not required if it does not make sense.

2. Should validation enforce the prompt schema exactly, or adapt to observed v2.2.1 drift?
   - Recommendation accepted: enforce the documented prompt schema and report drift as validation errors.

3. Should underscore-prefixed files from the generation run be included?
   - Recommendation accepted: ignore underscore-prefixed files and load only standard NBA team-code YAML filenames.

4. Should data live at `data/nba-context-graph/teams` and derived artifacts at `data/nba-context-graph/derived`?
   - Recommendation accepted as part of "execute all recommendations."

5. Should JSON be the derived storage substrate?
   - Recommendation accepted as part of "execute all recommendations."

6. Should context graph externalization live in a Settings surface, the Database tab, or a real route?
   - Recommendation accepted: add a Settings surface in the existing Fenway shell and wire the avatar Settings item to it.

7. What should users edit in v1?
   - Recommendation accepted: curated per-team preferences only, not the full raw YAML-derived object.

8. How should runtime edits persist?
   - Recommendation accepted: JSON overrides layered over the derived graph.

9. Should AI chat/brief integration happen in this PR?
   - Recommendation accepted: separate direct AI integration, but include the effective-context read contract now.

10. How should context graph data wire into app AI?
    - Answer: use a lookup-tool model, make all 30 teams available through a compact index, and wire briefs, chat, and agents in the first AI pass.

11. How should context graph usage be surfaced to users?
    - Answer: make usage visible in Brief and Chat, persist the trust trail, use existing `brief_sources` and `chat_turns.tool_calls`, and keep the UI informational only.

12. How should the Michael Winger demo use the context graph?
    - Answer: create a Wizards War Room command center with live 2026 Wizards graph truth, counterparty radar, relationship map, one-click brief prompts, Settings overrides, and visible AI lookup activity.

## Schema Drift Found

The production validation report currently fails by design because strict validation surfaces source/schema drift. Examples:

- `below_first_apron` appears in production files but is not in the prompt enum.
- `recent_playoff_rematch` appears where the prompt expects `playoff_rematch`.
- `actively_traded` appears as a known-target outcome, but the prompt outcome enum does not include it.
- Some fields use team names or aliases where standard NBA team ids are required.
- Some posture or cultural vocab values appear in movement-reason or trait fields.

See `data/nba-context-graph/derived/validation_report.md` for the full snapshot.

## Open Questions For Ido

- Should the prompt schema stay canonical, or should these v2.2.1 drift values be promoted into a v2.2.2 schema?
- Should pick ownership records include structured original-team fields on `draft_picks_owned`?
- Should recent trades include structured counterparties and trade ids for deterministic reciprocal checks?
- Should JSON stay as the access-layer input, or should a later pass hydrate Supabase/Postgres?
- Where should the graph loader sit relative to the future AI reasoning layer?
- Should the AI context graph lookup remain team-id only, or grow query/filter affordances once prompt evals exist?
- How should context graph facts be cited in generated briefs and chat responses?
- What token-budget, fallback, and eval policy should govern context graph facts in longer multi-team prompts?
- Should `CONTEXT_GRAPH` source rows eventually link directly into the Settings editor for reviewed edits, or remain read-only trust artifacts?

## Verification

- `npm --prefix server run typecheck`
- `npm --prefix server test`
- `npm run typecheck`
- `npm run build`
- `npm --prefix server run context-graph:build`

The production build writes artifacts and exits nonzero while validation errors remain. Current snapshot: 30 teams, 705 errors, 50 warnings.
