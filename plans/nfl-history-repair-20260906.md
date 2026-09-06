# Historical NFL trade repair — September 6, 2026

Historical refinements now retain the executed position, transaction, team, and analysis scope. The saved result exposes every matching player event and every recorded asset on both sides of each linked trade. Optional prose no longer keeps a usable calculation in a generating state.

## Reproduction and result

The worktree originally pointed at `87261d3`, before the historical feature existed. The isolated repair branch starts at the exact rehearsal revision, `b719e04135126fc34f5d9f0916feb3dea3c3008c`.

At that revision, asking “How has the trade market for edge rushers changed from 2016 to 2025?” calculated 72 matching events, but saved only 12 comparables. “Only include trades from 2020 through 2025.” was classified as a general request and saved as a failed generic brief without the historical artifact in the disconnected-provider rehearsal. The original long provider timeout was not reproduced against a live provider.

The repaired browser conversation produced:

| Step | Verified result |
| --- | --- |
| Initial question | EDGE, trades, 2016–2025; 72 player events across 70 distinct trades |
| Date refinement | EDGE and trades preserved; 2020–2025; 41 events across 41 distinct trades |
| Browse | All four pages reachable, including the final five events; search scans the entire cohort and package assets |
| Inspect Brian Burns | All five recorded assets, including both fifth-round swap legs; direction, pick season/round/number, recorded conditions, source date, and record identity visible |
| Reload and reopen | Same saved refined body, scope, 41 events, and 50 sources |
| Regenerate | Re-executes saved filters and retains the 41-event cohort and 50 sources |
| Preservation | Separate synthetic control row hash unchanged before and after the complete flow |

“Complete” means all matching records in the reviewed snapshot. It does not establish complete NFL history or fill missing conditional terms. Older artifacts without the full cohort are explicitly labeled sampled-only.

## Implementation and checks

- Bounded filter grammar and latest-topic context prevent accidental inheritance from other channels or earlier unrelated topics.
- Ready calculations persist independently of optional prose. Prose gets one grounding-repair attempt and a 30-second deadline with cancellation and revision checks. Polling completes the UI update even without realtime delivery.
- Full packages join by source trade identity and retain opposing assets without netting. Every cohort event gets a source card. Model messages retain the bounded comparison sample instead of the full audit payload.
- Regeneration claims the saved revision before replacing sources or acquiring generation ownership. Independent review found a concurrent-retry cancellation race; the final patch fixes it and adds two regressions.

Validation: server typecheck passed; all **409 tests passed**, with zero failures or skips; frontend production build passed. Browser layout and the interactions above were inspected on the disposable local app. Tests cover valid, repaired, rejected, empty, truncated, hung, cancelled, stale, and deleted-result prose cases.

The browser provider was deliberately disconnected. This verifies that calculations remain usable when prose fails; it does not validate live model-generated football prose. Database child-row replacement is still non-atomic if the database itself fails midway through regeneration.

## Orchestration observation

Installed `codex-orchestrate` run `nfl-history-repair-20260906` completed: two isolated workers, one root integration checkpoint, and terminal verification. Source snapshots omitted unrelated private data and credentials. Existing model settings were preserved. Root reviewed and imported both patches, then owned integration, verification, and Git actions.

- Start: 14:18:50 UTC. Final interaction and test verification: 14:52:02 UTC, **33 minutes 13 seconds** elapsed.
- Evidence worker: 15 minutes. Follow-up worker: 16 minutes 4 seconds, running concurrently.
- Both workers passed on attempt one; no worker safety violations; no user intervention required.
- One orchestration input correction added the required verification command. Four local setup corrections addressed disposable-runtime compatibility. One test-fixture type correction and the independent review finding required root changes.
- Worker receipts do not expose token usage. Account-wide weekly usage moved from 2% to 6% during the observation, with unchanged credit balance; concurrent account activity prevents attributing that change to this task.

Workers lacked installed dependencies, so their terminal checks were limited to patch validation. Root performed the dependency-backed checks and browser acceptance. The run demonstrates useful parallel ownership for separable tasks, but does not prove a speed or cost improvement over a single-agent run. Keep orchestration optional for work with clear independent boundaries and budget root integration and validation explicitly.

The local preview uses port 5186, the task API uses 8796, and the disposable database stack uses 55440–55442. Existing databases and demo records were not modified. No production deployment, PR, merge, protected push, Buzz change, private-account integration, or model-setting change was performed.
