# Giants analyst restoration: comparison record

## September 9: acquisition cost versus additional cap room

Max found “minimum funding needed is $0” misleading and asked to avoid more meta language. The answer now names the incoming cap charge and cash payment in its opening, then says whether a salary conversion is needed. Saved strategy answers gain this clarification from their own executed acquisition record without changing stored prose, terms or figures. It distinguishes the incoming player cost from the net cap effect of a funding move, and does not repeat an opening that already explains both costs.

The existing chart includes cash alongside cap, leads with paid acquisition alternatives, and uses “Acquire · use existing cap room” / “Do not acquire · no added cost.” No additional explanation panel was added. [Fresh verified Meyers answer](http://localhost:5175/?conversation=1503e1c4-8a78-4e58-9fdb-2711752655d4): 31.6 seconds at Astra/High/Fast, complete with existing validation. It states the illustrative $3m cap/$4m cash cost for 2026 and retains $5.5m cap/$4.5m cash for 2027. Its numerical decision cells exactly match the earlier result; the screenshot's original saved body is unchanged in the database. Browser inspection and reload passed for the fresh answer, and the earlier saved answer displays the clarification. All displayed source references resolve. Forty focused tests, server typecheck and build passed. Local evidence: `test-results/analyst-restoration/acquisition-clarity-verification.json` and `acquisition-clarity-fresh.json`.

## September 9: High reasoning latency test

Max reported the multi-minute wait and selected “Keep Astra, test High reasoning for faster answers.” The candidate now uses **Astra / High / Fast** for generation and semantic review. Only the reasoning setting changed; prompts, tools, source checks, calculation checks, repair handling and charts are unchanged. Historical max-reasoning metadata remains readable.

[Open the verified two-turn High conversation](http://localhost:5175/?conversation=6770c2da-82bd-42e7-8f0a-b432e1a11b5b).

| Prompt | Prior max run | High replay | Reduction |
|---|---:|---:|---:|
| Nabers unavailable; outside receivers versus our roster | 187.413 s | 56.618 s | 69.8% |
| Saved Meyers terms; $5m budget, $1m reserve, protect Burns/Thomas | 120.678 s | 36.524 s | 69.7% |

Both completed with grounded validation and no answer-repair pass. The receiver replay encountered an unavailable Nacua deep-dossier lookup, recovered, and kept that contract gap explicit. Every displayed paragraph/table source reference resolves. The cap decision table is exactly equal to the prior max-run table, with the budget, reserve and protections preserved. Direct review retained the conditional receiver investigation, internal alternatives, unknown availability/prices, sourced contract distinctions, and separation of cap and cash. The receiver answer is 363 words versus 326 in the latest max baseline; lower effort does not itself ensure shorter prose.

Browser verification covered submitting both prompts, rendered receiver/cap charts and persisted conversation reload. Nineteen focused protocol and semantic-grounding tests, server typecheck and production build passed. Detailed local evidence is retained in `test-results/analyst-restoration/high-reasoning-verification.json`, `speed-baseline-max.json`, `speed-high-readback.json` and the per-brief source files. The measurements are one live replay of each prompt, with different generated tool paths and answers, not a controlled average or proof of unchanged general quality. The earlier broad comparative acceptance work remains unfinished.

The [current OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-without-stored-responses) confirms encrypted reasoning is returned automatically with `store:false`; the initial suspected missing `include` flag was ruled out. No transport/state change was made. Streaming has not been implemented.

## Initial restoration and acceptance scope

The implementation is available to try at [the shorter visual answer](http://localhost:5175/?conversation=14ec3596-07f5-4edf-8366-64d2147d91c4). It restores sourced quantitative explanations, expands candidate selection beyond a fixed shortlist, preserves saved contracts and scenario state, and repairs unsupported claims without deleting whole sentences. The initial Astra/browser implementation was `fe3c5e1`; subsequent visual refinements are on `codex/giants-analyst-restoration-20260909`.

The restoration is not yet promoted over the presentation build. The complete earlier fixed-setting comparison showed a substantial writing improvement, but incomplete live answers and unsupported recommendation premises failed acceptance. Those failures were retained and corrected; the replacement Astra comparison remains unfinished. Max asked to wrap up after the implementation and main browser workflow were verified, so the remaining 96-answer writing and 48-turn end-to-end repeat is not being started at this handoff.

## September 9: shorter answers and visual comparisons

After Max approved the improved answer quality, he requested slightly less prose and more graphics. The writer now targets 60–140 words for simple questions and 200–350 for substantial comparisons, preserving the recommendation, decisive tradeoff, alternatives and material conditions. A chart appears after the opening paragraph when selected evidence supports one. The complete figures remain expandable, and the source button opens the original evidence drawer.

Available visuals include player production/workload bars with a metric selector; cap/cash comparisons across alternatives or years; dated practice-participation grids; and converted/failed play comparisons. They read the selected tool tables directly. Missing values stay unknown, year and guarantee fields are not treated as performance metrics, signed financial values retain their basis, and unsupported tables remain tables. Existing saved answers gain these visuals without changing their persisted prose or figures.

The same receiver question produced **269 words versus the earlier 358** in one live replay (24.9% shorter), at Astra/max/Fast in 213.6 seconds. This is one observed comparison, not a measured average. The saved brief `82ab913c-d40d-41ac-b124-c800437a9bf6` was read back as complete, and its chart and exact 269-word answer survived save/reload. Browser checks also covered changing starts to snaps, opening chart sources, expanding the full table and the saved three-alternative cap view. Practice/coaching and a 390px layout were visually checked using the captured acceptance tables. Fourteen focused tests, the server typecheck and application build passed. These presentation checks do not complete the comparative acceptance work below.

Local evidence: `test-results/analyst-restoration/visual-answer-readback.json`; the captured chart preview is `visual-review.html` in that directory. The updated runtime uses the existing candidate ports 8792/5175.

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
