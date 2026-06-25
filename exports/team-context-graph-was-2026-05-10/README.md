# Gambit Team Context Graph Export

Team: Washington Wizards (WAS)
Generated: 2026-05-10T17:05:47.298Z

This bundle contains the Washington Wizards effective team context graph as used by the app, including the local onboarding/preferences override layer. The base source graph is tracked YAML/derived JSON; the onboarding edits are in gitignored local override files and are included here so the export reflects the current local product state.

## Key Files

- `was-effective-context.json`: stable app read contract for the Wizards, including source graph, effective preferences, override diff, validation, roster summary, and relationship summary.
- `was-war-room.json`: War Room read model for the Wizards, including counterparty radar, relationship-map nodes/edges, tensions, scenario lenses, and demo prompts.
- `all-team-preferences.json`: compact preferences/settings view for all 30 teams.
- `team-memory.was.json`: prototype private team-memory profile for the Wizards, currently null if no reviewed profile has been saved.
- `team-preferences.local.json`: raw local preference/onboarding override file.
- `team-memory.local.json`: raw local team-memory file.
- `raw-was.yaml`: source Wizards graph record.
- `derived-teams.json` and `derived-edges.json`: generated full-graph artifacts.
- `validation_report.md`: validation snapshot from the current build.

## Validation

Validation status: PASS (0 errors, 0 warnings).

Privacy note: this export includes prototype-local onboarding/preferences context. Review before sending outside Gambit.
