# Gambit NFL Context Graph

This directory is the NFL Intel source layer for the internal Gambit NFL demo.
It mirrors the NBA context graph workflow: one YAML source file per team,
derived graph JSON, validation report, local Settings overrides, and compact AI
lookup output.

The current milestone is graph-first. The source files use team-level public
source links and operator-level static synthesis. Row-level contract/cap/rules
fixtures land in the later NFL data and Rules milestone.
