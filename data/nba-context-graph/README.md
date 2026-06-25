# Gambit NBA Context Graph Relationship Layer

This directory contains the NBA context graph source files and derived relationship artifacts.

The relationship layer parses one YAML file per NBA team, validates each file against the prompt schema, extracts cross-team/player relationship edges, and writes small JSON artifacts for downstream use. It also provides a Settings override layer, a compact Claude lookup tool for AI prompts, and persisted trust metadata showing when the graph was used. It does not provide RAG over narrative fields, scraping/maintenance automation, graph DB queries, or claim-level citation UX.

## Layout

```text
data/nba-context-graph/
  teams/       # 30 production team YAML files; only standard team-code filenames are loaded
  derived/     # generated JSON artifacts and validation_report.md
  overrides/   # local runtime preference overrides (example tracked, *.local.json ignored)
```

Implementation lives in `server/src/context_graph/`.

## Commands

From the repo root:

```sh
npm --prefix server run context-graph:audit
npm --prefix server run context-graph:repair:safe -- --dry-run
npm --prefix server run context-graph:repair:safe
npm --prefix server run context-graph:repair:source-backed -- --dry-run
npm --prefix server run context-graph:repair:source-backed
npm --prefix server run context-graph:validate
npm --prefix server run context-graph:build
npm --prefix server run context-graph:report
npm --prefix server test
```

`context-graph:build` reads `data/nba-context-graph/teams`, writes `data/nba-context-graph/derived/teams.json`, `edges.json`, and `validation_report.md`, and exits nonzero when validation fails. It still writes artifacts so reviewers can inspect the exact failure snapshot.

`context-graph:audit` is read-only and buckets validation findings by class, team, and field/value. It also reports nonblocking relationship-completeness findings for one-way trades, rivalries, and personnel links.

`context-graph:repair:safe` applies only mechanical source cleanup: YAML scalar quoting, team alias normalization, URL/unknown source field shape, date/year/array shape fixes, and the reviewed safe vocabulary replacements in `server/src/context_graph/cleanup_policy.ts`.

`context-graph:repair:source-backed` uses the reviewed local NBA roster and cap-sheet snapshots to reconcile payroll estimates, duplicate roster ownership, pending free agents, option-pending contract fields, movement signal gaps, conditional pick destinations, reciprocal unconditional picks, and structured recent-trade counterparties. It is deterministic and should be idempotent after cleanup.

## Storage Choice

Derived artifacts are JSON files. This repo has a Supabase/Postgres app database, but no existing local SQLite/DuckDB pattern for small derived datasets. The graph is small enough to load directly, JSON is diffable in git, and the access/query layer is explicitly deferred.

## Derived Artifacts

- `teams.json`: parsed team records, preserving source values.
- `edges.json`: typed edge groups:
  - `pickOwnership`
  - `tradePartners`
  - `rivalries`
  - `personnelConnections`
  - `playerTeams`
  - `pendingFreeAgents`
  - `historicalPursuits`
- `validation_report.md`: per-file schema errors, cross-team consistency errors, cross-team warnings, and pass/fail summary.

## Settings Overrides And AI Context

The app Settings surface reads from `GET /context-graph/preferences` and writes curated per-team preference edits through:

```text
PATCH /context-graph/preferences/:teamId
POST  /context-graph/preferences/:teamId/reset
```

Runtime edits are stored as a JSON override layer at `data/nba-context-graph/overrides/team-preferences.local.json` by default. That file is gitignored so source YAML and derived artifacts remain stable. Use `CONTEXT_GRAPH_TEAM_PREFERENCES_OVERRIDES=/path/to/file.json` to point the server at a different override file.

The server exports `getEffectiveTeamContext(teamId)` from `server/src/context_graph/preferences.ts`. This is the stable read contract: source graph data, effective preferences after overrides, validation status, freshness metadata, roster summary, and relationship summary.

AI surfaces use `server/src/claude/context_graph.ts` as a compact adapter over that contract:

- `buildContextGraphSystemBlock()` gives Claude a 30-team index and usage rules.
- `lookup_context_graph_teams` returns compact effective context for requested team ids.
- Initial briefs, follow-up chat, and agent outputs can use the lookup tool before making claims about team posture, preferences, trade DNA, culture, priorities, relationships, or Settings-editable context.

Tool output intentionally stays compact and does not expose raw `source_team` payloads. Validation failures and freshness metadata are preserved as caveats for the model.

## Wizards War Room Demo

The app also includes a Wizards-focused demo surface backed by a generic read model:

```text
GET /context-graph/war-room/:teamId
```

The route returns the subject team's effective context, deterministic counterparty radar, relationship-map nodes and edges, roster pressure, strategic tensions, scenario lenses, metadata, and demo prompts. It uses the same derived JSON artifacts plus Settings overrides. It does not add persistence, migrations, graph DB queries, vector search, or data-refresh behavior.

## Context Graph Trust Trail

AI context graph lookups also produce a persisted trust trail:

- Generated briefs append server-created `CONTEXT_GRAPH` rows to `brief_sources`.
- Chat replies persist lookup traces in `chat_turns.tool_calls`.
- The app renders those traces as context graph source chips, left-rail source cards, and compact trust strips under assistant chat replies.

Each trace records team ids, names, validation status and counts, source freshness, override state, and lookup errors. This is informational only; it does not add graph citation UX, chat-side editing, RAG, or new database tables.

## Schema Reference

The canonical schema/vocabulary source for this implementation is `server/src/context_graph/schema.ts`.

Validation follows context graph schema v2.2.2. The schema explicitly supports repeatable source semantics such as `below_first_apron`, `option_pending`, `unavailable`, unknown/uncertain trajectory, unknown signal strength, nullable/unknown contract duration, conditional pick destinations, and structured trade counterparties.

Obvious typos and synonyms still belong in safe repair mappings. Ambiguous relationship completeness belongs in `context-graph:audit`, not blocking validation, unless a row explicitly marks `requires_reciprocal: true`.

## Known Limitations

- Audit-only relationship findings may remain even when validation passes; they are source-completeness review items rather than blocking source errors.
- No query/access layer is included.
- No RAG/vector indexing is included.
- No claim-level graph citation/source-attribution UI is included beyond the informational source chips and chat trust strip.
- No graph editing from generated brief/chat trust chips is included.
- No scraping or data refresh pipeline is included.

## Open Questions For Ido

- Should future source authoring require structured trade counterparties up front rather than relying on repair?
- Should audit-only relationship completeness be surfaced in Settings/War Room as an editorial backlog?
- Should JSON remain the handoff substrate for the access layer, or should these artifacts later hydrate Postgres tables?
- Should the AI lookup tool eventually support query-style filters, or remain team-id only?
- What citation policy should govern context graph facts in chat and decision briefs?
