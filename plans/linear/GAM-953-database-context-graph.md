# GAM-953 Move Context Graph Into Database

## Summary

- Move the NBA context graph editor out of the account Settings route and into the Database view.
- Make `Context graph` the first Database sub-tab for every selected team.
- Keep existing context graph save, reset, revert, validation, and override behavior.
- Hide or disable the old avatar Settings entry so users cannot reopen the misplaced surface.

## Key Changes

- Add a Database sub-tab order of `Context graph`, `Cap sheet`, `Advanced stats`, `Official roster`.
- Refactor the context graph settings component so it can render embedded for a controlled `teamId` without its own team rail.
- Reset the Database sub-tab to `Context graph` whenever `databaseTeamId` changes.
- Route War Room `Edit assumptions` to Database with GSW selected.
- Remove stale top-level Settings navigation/store plumbing and bump persisted UI state migration.

## Interfaces And Data

- No backend API, schema, migration, or context graph data changes.
- Frontend-only type changes:
  - `NavTab` removes `settings`.
  - Database view state adds local `context`.
  - The embedded context graph editor accepts a controlled `teamId`.

## Test Plan

- Run `npm run typecheck`.
- Run `npm run build`.
- Start `npm run dev` and verify:
  - Header `Database` opens with `Context graph` selected first.
  - Selecting another team in the Database left rail switches the main tab back to `Context graph`.
  - `Cap sheet`, `Advanced stats`, and `Official roster` still render and preserve row selection behavior.
  - War Room `Edit assumptions` lands on Database with GSW selected and `Context graph` active.
  - Avatar Settings is hidden or disabled and no longer opens the old context graph surface.

## Assumptions

- "First open tab for each team" means Database resets to `Context graph` whenever the selected team changes.
- The old Settings route is not needed for real account settings yet.
