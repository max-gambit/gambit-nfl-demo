# Giants analyst restoration: comparison record

The implementation is available to try at [the verified Astra conversation](http://localhost:5175/?conversation=8e6a899f-5e72-4a50-bdee-1107a9bae08e). It restores sourced quantitative explanations, expands candidate selection beyond a fixed shortlist, preserves saved contracts and scenario state, and repairs unsupported claims without deleting whole sentences. The current code is `fe3c5e1` on `codex/giants-analyst-restoration-20260909`.

The restoration is not yet promoted over the presentation build. The complete earlier fixed-setting comparison showed a substantial writing improvement, but incomplete live answers and unsupported recommendation premises failed acceptance. Those failures were retained and corrected; the replacement Astra comparison remains unfinished. Max asked to wrap up after the implementation and main browser workflow were verified, so the remaining 96-answer writing and 48-turn end-to-end repeat is not being started at this handoff.

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

Max clarified that GPT-6 Astra / Ultra / Fast applies to the Giants demo analyst. The candidate now requests `gpt-6-astra`, `max` reasoning (the API's highest supported level), and Fast mode for generation and semantic review. The legacy baseline remains Claude/low. The replacement comparison uses Astra/max/Fast for all four controlled writing variants and records actual serving model/tier. It remains pending acceptance.

## Verification and evidence limits

- The full server suite passes **863 tests with zero failures**, including the Astra adapter's six protocol checks; server/QA typechecks and the application build pass. Two initial live Astra/max/Fast probes completed without repair: outside-shortlist receiver diligence and saved minimum funding. Actual model and Fast tier were confirmed from returned API metadata. First-turn replacement captures and their direct claim checks are retained under `acceptance-astra-v1`; they do not establish a completed comparative acceptance sample.
- The browser workflow passed at [conversation `8e6a899f`](http://localhost:5175/?conversation=8e6a899f-5e72-4a50-bdee-1107a9bae08e): a fresh sourced receiver answer, source drawer inspection, save, reload, an off-script switch to the Giants' own interior line, and continuation. Database readback confirmed that the original saved body remained unchanged and the new objective cleared the acquisition filters and assumed Nabers absence. Receiver brief `cb21fb4f-a447-4f47-b563-74d4fcaf6167` and interior-line brief `cc6603ac-2766-40c1-9b86-90bb1616442e` identify the verified records.
- Browser **Copy Markdown** export preserved the complete saved answers and source links for both briefs. Native file downloads are canceled by this in-app browser, so a normal file download is not claimed as verified. The identical application formatter produced the local receiver export, and its 88,183 UTF-8 bytes matched the browser's announced download size. See `astra-browser/browser-verification.json`, `export-verification.json` and `Giants-brief-cb21fb4f.md`.
- The first Astra browser answer exhausted its five-minute allowance after the reviewer incorrectly treated an explicit caution about unknown contract liability as an affirmative claim. Clause-local negation checks and regressions corrected that false positive. The incomplete result remains in `astra-browser/initial-incomplete.json`; the fresh successful replay does not erase it or establish an overall reliability rate.
- The single advisory code-review helper run failed structured-output validation because it rejected the reviewer's absolute file path. It produced no usable clean-review result and has not been retried.
- The initial comparison had no OpenAI judge credential and used separate blinded Claude calls with randomized labels. Same-family bias is possible; direct source review found material issues that review missed. OpenAI is now configured for the requested candidate and the replacement Terra judgments.
- Max superseded the initial 30/60-second latency gates, prioritizing useful complete answers. The first Astra probes completed in 133 and 142 seconds without repairs. The replacement allowance is five minutes, with up to two minutes for review inside that total, preserving time for a repair. Timings remain reported.

## Reproduce and inspect

See [the QA command sequence](README.md#analyst-restoration-comparison). Raw request/response, evidence and verdict records are retained locally under `test-results/analyst-restoration/acceptance-v4/` and `acceptance-v5/`; these ignored artifacts contain public demo data and clearly labelled illustrations. The commands recreate them without modifying presenter conversations.

The remaining acceptance work is the complete replacement comparison and its final direct claim adjudication. Promotion and meeting-day source refresh remain separate. No PR, merge, deployment or source refresh was performed.

## Open or restart the implementation

Use `/Users/maxweiss/.codex/worktrees/giants-analyst-20260909` and run `NYG_DEMO_SERVER_PORT=8792 NYG_DEMO_CLIENT_PORT=5175 npm run present:thursday`. The API uses a five-minute answer allowance. This startup does not watch server source changes; restart it after server edits. The requested credential is stored only in the ignored, owner-only `server/.env.local`. The prior presentation app remains at port 5174.
