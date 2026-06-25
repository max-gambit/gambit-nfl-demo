# Gambit NBA Context Graph Validation Report

## Summary

- Status: PASS
- Total errors: 0
- Total warnings: 0
- Per-file schema errors: 0
- Cross-team consistency errors: 0
- Cross-team consistency warnings: 0

## Per-File Schema Errors

- No per-file schema errors.

## Cross-Team Consistency Errors

- No cross-team consistency errors.

## Cross-Team Consistency Warnings

- No cross-team consistency warnings.

## Notes

- Validation enforces context graph schema v2.2.2; repeatable source semantics are represented explicitly.
- Underscore-prefixed source files and non-standard team filenames are ignored by the loader.
- Relationship completeness checks for trades, rivalries, and personnel reverse links live in context-graph:audit unless a row explicitly requires reciprocity.
