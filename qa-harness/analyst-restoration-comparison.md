# Giants analyst restoration: comparison record

The restoration is not yet promoted. The complete fixed-setting comparison showed a substantial writing improvement, but incomplete live answers and unsupported recommendation premises failed acceptance. The existing presentation build remains the accepted local demo.

## Complete fixed-setting comparison

- Candidate revision: `df02e78`; preserved integration writer/pipeline: `e16ec81` plus the explicitly shared literal-input fixes.
- Model: `claude-opus-4-8`, low effort for all four writing contracts and both tool pipelines.
- Evidence: 60 hashed public record files, twelve identical writing bundles, and an explicitly illustrative saved Meyers contract.
- Sample: 96 writing answers; 48 actual multi-turn answers; 48 blinded judgments. All errors and incomplete answers are retained.
- The original `32722f3` and September 8 `7c740fc` variants are historical-prompt replays, not reproductions of their applications.

| Writing contract | Relevance | Depth | Alternatives | Uncertainty | Decision usefulness | Follow-ups |
|---|---:|---:|---:|---:|---:|---:|
| Original research | 4.83 | 4.67 | 4.58 | 4.50 | 4.42 | 4.42 |
| September 8 correction | 5.00 | 4.12 | 3.71 | 4.46 | 4.29 | 4.04 |
| Current integration | 4.58 | 3.17 | 3.08 | 4.42 | 3.54 | 3.79 |
| Restoration | 4.96 | 4.46 | 3.92 | 4.79 | 4.50 | 4.21 |

The restoration won 23 of 24 writing comparisons against current (95.8%, no ties). Its depth score remained below the original research contract, so this does not establish that every historical strength was recovered.

The actual candidate pipeline completed only 9 of 24 turns (37.5%). Combined writing/end-to-end preference was 66.7%, below the 70% gate. Across those answers, relevance averaged 4.13, depth 3.67 and decision usefulness 3.65. The candidate was not accepted.

## Findings and subsequent corrections

- Compatible follow-ups sometimes submitted prior text without fresh source evidence. The candidate now withholds `finish_analysis` until current-turn evidence exists and explicitly requires fresh citations.
- The reviewer rejected complete seven-claim reports because of an overly narrow format check. Valid reports now retain all checks, including unsupported claims.
- Review timeouts prematurely ended otherwise useful funding answers. The reviewer now receives less duplicated evidence and more time within a bounded total allowance.
- Numeric matching confused ranges, hyphenated thresholds and nearby player names. Focused regressions cover these forms while preserving wrong-player, metric, period, sign and cap-basis rejection.
- A same-name roster join could enrich a receiver with another position's record. Receiver enrichment now joins player identity and team and verifies receiver scope.

At `5e82a3d`, a second diagnostic capture completed 12 of 12 first-turn answers. Direct inspection still found a snapshot-horizon-to-commitment inference and unsupported role/trend labels. That capture is diagnostic and is not a replacement accepted sample. The runtime was revised before its next phase, and the harness correctly stopped on the hash mismatch.

The next candidate reasoning/model configuration is pending Max's clarification of GPT-6 Astra / Ultra / Fast: the Codex task, the Giants analyst, or both. No model-provider migration has been made.

## Verification and evidence limits

- 856 server tests passed at `5e82a3d`; server and QA typechecks and the application build passed. Later uncommitted reasoning/prompt changes still require final verification.
- Browser readback confirmed that an older conversation and its original source drawer remain readable. A fresh accepted conversation, changed objective, save/reload/export and continuation remain required.
- The single advisory code-review helper run failed structured-output validation because it rejected the reviewer's absolute file path. It produced no usable clean-review result and has not been retried.
- No OpenAI judge credential was configured. Judgments used a separate blinded call to the configured Claude model, with randomized labels. Same-family bias is possible; direct source review found material issues the model review missed.
- Max superseded the initial 30/60-second latency gates, prioritizing useful complete answers. The later candidate allowance is three minutes, with up to 90 seconds for review inside that total. Timings remain reported.

## Reproduce and inspect

See [the QA command sequence](README.md#analyst-restoration-comparison). Raw request/response, evidence and verdict records are retained locally under `test-results/analyst-restoration/acceptance-v4/` and `acceptance-v5/`; these ignored artifacts contain public demo data and clearly labelled illustrations. The commands recreate them without modifying presenter conversations.

The final acceptance record must add the selected model/settings, the replacement comparison, direct claim adjudication, verified browser conversations and the promoted revision.
