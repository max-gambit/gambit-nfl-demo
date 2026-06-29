# NBA Trade Eval Corpus V0

This directory is the file-backed source of truth for the first Gambit NBA trade eval corpus.

## Files

- `scenarios.v0.json` - 50 deterministic Warriors-centered trade scenarios generated from the public/demo NBA cap-sheet seed.
- `prompts.v0.json` - four prompts per scenario: legality, diagnosis, repair, and Warriors decision support.
- `labels.v0.json` - initial oracle-label records. Non-source-needed cases start as `manual_pending` until RealGM or human evidence is imported.
- `realgm-labeling-queue.v0.json` - safe small-batch queue for manual or Codex computer-use RealGM checks.

## Regenerate

From the repo root:

```sh
npm --prefix server run build:trade-eval-corpus
```

The generator reads `data/nba-cap-sheets/2026-05-03.public-sources.json` and writes stable JSON with a fixed `generated_at` timestamp. It does not call RealGM, Supabase, or any external service.

If `labels.v0.json` already contains imported RealGM or human labels, the build script preserves those records over the generated heuristic baseline only when the label's `scenario_signature` still matches the regenerated scenario.

## Score Answers

Create an answers file as either an array or an object with an `answers` array:

```json
{
  "answers": [
    {
      "prompt_id": "trade_eval_v0_001_clean-mil_legality",
      "answer": "..."
    }
  ]
}
```

Then run:

```sh
npm --prefix server run score:trade-eval-corpus -- --answers=/path/to/answers.json
```

The scorer writes `report.latest.json` and `report.latest.md` under `data/evals/nba-trade-corpus/reports/` by default. Reports group results by rule family and failure mode.

## RealGM Labeling Policy

RealGM Trade Checker is an external oracle candidate, not the system of record.

- Label at most 5 scenarios per batch.
- Wait at least 2 seconds between interactions.
- Stop immediately on CAPTCHA, Cloudflare challenge, account wall, or terms uncertainty.
- Do not bypass site protections.
- Save screenshot and page-text evidence before changing `label_confidence` to `realgm`.
- Leave ambiguous cases as `manual_pending`.

## RealGM Pilot Results

The first approved five-case pilot was checked on 2026-06-29. It produced three still-current RealGM labels and two stale construction blockers caused by a currently trade-restricted player in the clean-control generator. After regenerating those two clean-control cases, the approved two-case relabel pass checked them again on 2026-06-29.

- `trade_eval_v0_001_clean-mil`: RealGM legal, saved trade `#8919986`.
- `trade_eval_v0_002_clean-okc`: RealGM legal, saved trade `#8920000`; previous Al Horford evidence archived under `evidence/realgm/archive/horford-restriction/`.
- `trade_eval_v0_003_clean-cha`: RealGM legal, saved trade `#8919989`.
- `trade_eval_v0_004_clean-por`: RealGM legal, saved trade `#8920001`; previous Al Horford evidence archived under `evidence/realgm/archive/horford-restriction/`.
- `trade_eval_v0_005_clean-sas`: RealGM legal, saved trade `#8919991`.

## Evaluation Intent

The corpus tests more than valid/invalid trade answers. A good Gambit answer should:

- identify legality correctly when the fixture has enough public salary evidence;
- name the controlling CBA/cap constraint;
- propose a concrete repair when a construction fails;
- ask for missing salary, trade-exception, or team-by-team validation evidence when needed;
- answer as a Warriors front-office workflow tool, not as generic NBA commentary.

## V0 Boundaries

- No database migrations.
- No direct writes to Project scenario tables.
- No live browser automation in the generator.
- No Warriors-private or customer-derived scenarios.
- Heuristic labels are not final gold until RealGM or human-review evidence is imported.
