# NBA Context Graph Schema v2.2.2 Resolution Log

This file records the schema/source decisions made while driving the context graph validation snapshot to zero blocking findings.

## Resolved In Schema

- `cap_situation.current_status: below_first_apron` is a first-class CBA status.
- `known_target_history.outcome: actively_traded`, `traded`, and `let_walk` are allowed for live-market and final-disposition target history.
- `roster[].movement_constraints.status: unavailable` is allowed for roster rows that are present but not actionable.
- `roster[].trajectory: unknown`, `uncertain`, and `flat` are allowed distinct states.
- `roster[].archetype.*: unknown` is allowed when the reviewed source snapshot does not support a researched label.
- `roster[].contract.years_remaining: unknown` and unknown payroll estimates are explicit unknown states.
- `roster[].contract.player_option` / `team_option: option_pending` is allowed when an option exists but the exact year is not sourced.
- `roster[].movement_constraints.signal_strength: unknown` is allowed.
- `trade_dna.recent_significant_trades[].date` allows `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`.
- Repeated movement-reason, cultural-trait, target-outcome, role, special-trait, and leverage values observed across the reviewed files are part of the v2.2.2 vocabulary.

## Resolved By Source-Backed Repair

- Reviewed cap-sheet payroll estimates fill nonnumeric payroll fields where available.
- Reviewed roster data removes duplicate current-roster ownership rows.
- Pending free-agent rows absent from the current team roster snapshot are removed.
- Missing or null movement signal strength is normalized to explicit `unknown`.
- Missing movement reason weights are filled conservatively.
- Missing near-term priority types are inferred from the priority/detail text.
- Boolean option-presence values such as `yes` are normalized to `option_pending`.
- Traded contract-through annotations are normalized to `uncertain` after roster reconciliation.
- Conditional or unknown owed-pick destinations are moved to `to_team_options` plus `condition`.
- Unconditional owed picks get reciprocal `draft_picks_owned` entries.
- Recent significant trades now include structured `counterparties` when the summary identifies NBA teams.

## Audit-Only

- Missing reciprocal trade prose, one-way rivalry rows without `requires_reciprocal: true`, and one-way personnel links are nonblocking audit findings.
- Unconditional draft-pick reciprocity remains blocking validation.
