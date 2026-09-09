# Bounded historical NFL examples

These public-source captures support chat evidence tools. They are not a current scouting board, injury feed or game-plan database. The AI in the parent chat owns interpretation and follow-ups; `server/src/nfl_examples/evidence.ts` supplies facts, attributed public assessments, selected play rows and deterministic arithmetic.

| Domain | Saved scope | Follow-up changes |
| --- | --- | --- |
| College | Tyler Warren and Colston Loveland, historical **2025 draft class**, official **2024 college** receiving totals and roster measurements | Receiving, movement blocking/short-yardage, production, or one captured player |
| Availability | **13 Giants rows**, official practices Sept 17–19, 2025, game status Sept 21, observed offensive snaps from the Sept 21 Chiefs game | All changes, individual captured players, an explicitly user-assumed absence |
| Coaching | **2025 REG Weeks 1–3**, NYG/KC/DAL offenses; **765 captured rows**, **572 qualifying plays**, seven distinct games/nine team-games | Team pair, week subset, third down, red zone, their intersection |

Captured sources retain their URL, effective period, capture timestamp, source-byte SHA-256 and source locators. Every response attaches source references and numerical provenance. The local data is intentionally bounded: unsupported players, teams, seasons or weeks should be passed to the tool unchanged so it can report the gap.

College measurements use the same basis: official 2024 university roster listings. Warren is listed at 78 inches/261 pounds and Loveland 77 inches/245 pounds. These are not combine measurements. Receiving rates use 16 and 10 actual games respectively; they do not adjust for team opportunity or competition. Lance Zierlein's public NFL.com assessments are attributed to him and sourced through their dated, official Saints.com reproduction (April 22, 2025), with the original profile URLs retained. Direct NFL.com profile HTML exposed only headings during this capture. Strengths and limitations remain paired; no prospect grades or probability model were created.

Availability captures changes in labels, not changes in medical risk. Missing offensive usage remains null; zero is used only where the official inactive list confirms no game participation. Andrew Thomas's 28/66 offensive snaps and Marcus Mbow's 38/66 are historical observations. The saved source notes that Mbow replaced Thomas in that game; it does not establish current assignments. A hypothetical absence cannot overwrite those observations. nflverse's own availability documentation says its injury source stopped after the 2024 season, so no live feed is presumed.

Coaching arithmetic excludes non-run/pass rows, kneels, spikes, aborted plays and deleted plays. Sacks and scrambles stay in the sample. Dropbacks use `qb_dropback=1`; third downs use `down=3` and `third_down_converted`; red zone means a play starts 1–20 yards from the opposing goal line. Counts are plays, not red-zone possessions. Excluding penalty/no-play rows can make totals differ from official gamebook totals. The sample does not control for opponent quality, personnel or game state. No routes, coverage, pressure, formations or personnel are inferred. nflverse says current participation is released after the postseason.

Independent capture checks: NYG 188 plays / 128 dropbacks / 1,018 yards / 11 of 40 third downs converted; KC 179 / 126 / 950 / 17 of 40; DAL 205 / 139 / 1,183 / 16 of 36. Red-zone play counts: NYG 34, KC 23, DAL 30.

The coaching workflow supports outcome, distance, field-zone, play-type and exact game/play-ID filters. Converted/failed splits and matched down/distance/field-zone cells remain descriptive. `coaching-play-details.json` adds the original descriptions for all 765 captured rows, verified against the same source hash; refresh it with `python3 server/src/nfl_examples/capture_play_details.py`. Exact-ID follow-ups use the offense recorded on the play, rather than treating an opponent abbreviation inside the ID as a requested offense. Suggested follow-ups are limited to executable sample and play-review actions. Coverage, pressure and assignments still require external film or charting.

Availability prioritization orders operational review questions from observed report changes and participation. It is not medical severity or injury probability. The report scope and a named hypothetical absence are separate: a whole-report queue can coexist with an Andrew Thomas contingency, and an inherited timeline keeps that accepted assumption. There is no prior-game workload baseline from which to infer a snap decline.

Refresh only these artifacts with `python3 scripts/capture-nfl-examples.py` from the repo. The script downloads public sources, validates reviewed fact anchors, and fails on drift before replacing the JSON files. Source availability or shape changes require review. Broad roster/cap refresh is separate and was not run.

Validation: from `server`, run `node --import tsx --test tests/nfl_data/test_nfl_examples.test.ts` and `npm run typecheck`. Tests cover source arithmetic, named scope changes, missing-vs-zero usage, dated hypothetical separation, and refusal to substitute unavailable scope.
