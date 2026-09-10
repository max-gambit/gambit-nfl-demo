# Giants demo QA harness

This harness validates the New York Giants public-demo workflow. Its deterministic modes do not require a model provider; the explicitly selected live and analyst-quality modes use the configured providers.

## Modes

- `npm run qa:canonical` runs two consecutive live-demo rehearsals at 1440×900 and 1280×720, plus the 1024×768 responsive check.
- `npm run qa:adversarial` probes impossible targets, invalid inputs, protection rules, arithmetic, citation abstention, blocked preflight, private-input refusal, and active-output contamination.
- `npm run qa:reliability:nfl` runs 194 zero-cost routing, scope-inheritance, deadline, and intent cases. It never calls a model.
- `npm run qa:reliability:nfl:live` adds two isolated live scenarios with exactly three calls to the server's configured production answer model, verifies both rendered results in a browser, and requests one batched semantic judgment from `gpt-5.6-terra`.
- `npm --prefix qa-harness run typecheck` checks the harness itself.

The app and Hono server must already be running on localhost. The accepted local run also supplies the current local Supabase URL and service-role key so the harness can remove only rows explicitly marked `workspace_key=nyg-demo` and `seed_key=qa:*`. It never resets legacy rows or user-created NYG workspaces.

Canonical and adversarial runs write `report.json`, `report.md`, and bounded screenshots under `qa-harness/runs/<timestamp>-<mode>/`. The reliability gate writes a privacy-bounded `report.json` in the same ignored runs directory. A run exits non-zero on any finding.

## NFL answer reliability cost and data contract

The default gate is deterministic and free. The live gate is always explicit, never random, and hard-capped at two scenarios, three production-answer prompts, one Terra request, and 600 Terra output tokens. Terra receives only each completed answer plus a compact server-generated fact sheet; the request uses `store: false`. The saved QA report contains case IDs, assertions, timings, source categories, verdict classes, and token usage, but not the questions or answer text.

If `OPENAI_API_KEY` is absent, the live report records `skipped_no_openai_key`; it does not claim that Terra passed. Set `NFL_RELIABILITY_REQUIRE_JUDGE=1` to make that skip or an inconclusive verdict fail a required demo/release run. Set `NFL_RELIABILITY_REQUIRE_LIVE=1` to prevent a deterministic-only invocation where live coverage is mandatory.

Every live scenario uses a unique `workspace_key=nyg-demo` session whose `seed_key` begins `qa:answer-reliability:`. Cleanup deletes only those exact seed keys and reads them back to verify zero remaining rows.


## Analyst restoration comparison

`quality:nfl` runs the approved analyst restoration evaluation against checked-in public evidence and a clearly labelled saved-contract illustration. It does not create, regenerate or delete presenter conversations. Configure `OPENAI_API_KEY` in the candidate's ignored `server/.env.local`; the retained legacy pipeline reads Anthropic configuration from `server/.env`. Do not put credentials into evaluation artifacts.

The candidate analyst and semantic reviewer request `gpt-6-astra`, `reasoning.effort: max`, and `service_tier: fast`. The API exposes `max` as its highest reasoning setting; Codex's Ultra label is not sent to the API. The adapter preserves encrypted reasoning and all response items across tool rounds with `store: false`; saved briefs and traces contain model/tier/usage metadata without those opaque items. Actual returned service tier is recorded because Fast requests may be served at Standard speed. There is no automatic provider fallback. See the official [Astra settings](https://developers.openai.com/api/docs/models/gpt-6-astra), [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode) and [reasoning continuity](https://developers.openai.com/api/docs/guides/reasoning).

Run these commands from `qa-harness`, using a new output directory for each runtime change:

```bash
npm run quality:nfl -- --phase freeze --out test-results/analyst-restoration/my-comparison
npm run quality:nfl -- --phase writing --out test-results/analyst-restoration/my-comparison
npm run quality:nfl -- --phase e2e --out test-results/analyst-restoration/my-comparison
npm run quality:nfl -- --phase judge --out test-results/analyst-restoration/my-comparison
npm run quality:nfl -- --phase report --out test-results/analyst-restoration/my-comparison
```

Output paths are relative to the repository root. Freeze captures twelve first-turn evidence bundles, copies the public records and records file hashes, runtime hashes, model/effort, the exact question bank and the illustrative saved terms. Subsequent phases reject runtime or evidence drift. Existing records are retained, including errors and incomplete answers.

Writing runs four prompt contracts—original `32722f3`, September 8 `7c740fc`, accepted integration `e16ec81`, and the restoration—against identical checked evidence and the same Astra/max/Fast settings, with two trials for each of twelve questions (96 answers). These are historical-prompt replays with only the output format adapted, not reproductions of the historical applications. The accepted integration pipeline includes the common literal-input and contract-engine repairs present in this branch; its writing, investigation, grounding and semantic-review modules remain frozen. End-to-end model settings differ intentionally: the baseline keeps Claude/low while the candidate uses Max's requested Astra configuration. The prior complete Claude/low comparison remains the fixed-model baseline.

End-to-end runs the integration and candidate tool pipelines on four three-turn sequences with two trials each (48 turns), retaining structured scenario state across turns. Both receive a five-minute total allowance. Candidate review receives up to two minutes within that allowance; the candidate reserves time to finish after roughly half the budget. The first Astra probes took 133 and 142 seconds without repairs, so this leaves room for a targeted repair and second review. Max clarified during implementation that quality is the primary release concern and latency is a meeting tradeoff, so elapsed times remain visible without applying the earlier 30/60-second release thresholds. Provider concurrency is capped at two within each phase; run phases sequentially.

Judging presents answers in a reproducibly randomized order and evaluates grounding, relevance, depth, alternatives, uncertainty, decision usefulness and follow-ups separately from the existing reliability judge. It requires one result for every answer and unordered pair. With an OpenAI credential it uses the configured Terra judge; otherwise it uses a separate blinded call to the configured answer model. The report identifies the actual judge model and the same-family limitation. Direct review must check critical claims against the captured evidence and retain disagreements; an automated score alone does not clear acceptance.

A complete release report requires all 96 writing answers, 48 end-to-end turns, 48 valid judgments, at least 70% preference against current (ties half), 4/5 relevance/depth/decision usefulness, writing quality at least matching the stronger historical contract, at least 90% completion/useful missing input, no material factual errors, and a passed direct claim review. Record that review in `direct-claim-review.json` alongside the run with `passed`, reviewed case IDs, source-backed findings and retained judge disagreements. Run `report` again after recording it. Browser persistence/export verification and normal server/build checks remain separate requirements.

The local candidate uses `NYG_ANALYST_PIPELINE=candidate` (also the new branch default); `NYG_ANALYST_PIPELINE=legacy` selects the preserved integration writing pipeline for recovery. Existing saved answers are read in their original representation.
