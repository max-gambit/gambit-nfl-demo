# GAM-1365 RealGM-Labeled Trade Eval Corpus For Gambit

## Objective

Create a 50-case, file-backed NBA trade eval corpus with schemas, generator, prompt materializer, safe RealGM labeling queue/import path, scorer skeleton, tests, and documentation, without scaled external automation or database migration.

Formal Codex session goal:

> Create a 50-case, file-backed NBA trade eval corpus with schemas, generator, prompt materializer, safe RealGM labeling queue/import path, scorer skeleton, tests, and documentation, without scaled external automation or database migration.

## Success Criteria

- 50 pilot trade scenarios cover salary matching, second apron, hard cap/sign-and-trade, trade exception, multi-team, clean control, and source-needed cases.
- Each scenario has stable JSON fields: id, snapshot date, teams, player/assets, salary totals, rule tags, intended edge, source data version, label status, and evidence paths.
- Each scenario expands into legality, diagnosis, repair, and Warriors decision-support prompts.
- RealGM remains a small-batch oracle path: rate-limited, cached, no CAPTCHA/Cloudflare bypassing, no scaled scraping.
- The corpus can be tested and scored without live RealGM access.

## Scope

Implement a V0 file corpus in `data/evals/nba-trade-corpus/` and server-side eval tooling. Do not add Supabase migrations, write into Project scenario tables, run live browser labeling, or use Warriors-private/customer-derived scenarios.

## Implementation Steps

1. Add shared/server-side eval types and parsers for scenarios, prompts, labels, queue items, and score reports.
2. Add a deterministic builder that reads the existing public NBA cap-sheet seed and writes:
   - `scenarios.v0.json`
   - `prompts.v0.json`
   - `labels.v0.json`
   - `realgm-labeling-queue.v0.json`
3. Generate 50 Warriors-centered scenarios across the required rule families while excluding missing salary data except explicit source-needed cases.
4. Materialize four prompt types per scenario: legality, diagnosis, repair, and decision support.
5. Add a label merge path for future RealGM evidence and keep initial labels `manual_pending` or `source_needed`.
6. Add a scorer skeleton that grades legality, rule diagnosis, repair quality, source behavior, operator usefulness, and uncertainty discipline.
7. Add tests for schema parsing, deterministic coverage, prompt expansion, label merge, and scoring behavior.
8. Document safe RealGM labeling workflow and stop conditions in the corpus README.

## Verification

- `npm --prefix server test`
- `npm --prefix server run typecheck`
- `npm run typecheck`
- `npm run build` if shared/frontend types are touched

## Stop Conditions

- Stop before live browser labeling if RealGM blocks access, presents CAPTCHA/Cloudflare challenge, terms review is unresolved, or more than 50 cases are requested.
- Stop before any database migration or Project table import; V0 remains file-backed.
- Stop if generator cannot produce required coverage from public/demo cap-sheet data.

## Memory And Closeout

Capture the final accepted corpus design and paths to `ai-memory` only after implementation decisions are stable. Close through verification-closeout and run Autoreview once if warranted by the reviewable repo diff.
