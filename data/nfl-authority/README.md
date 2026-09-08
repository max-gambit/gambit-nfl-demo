# NFL authority snapshot

The canonical portable artifacts are `authority.json.gz` and `manifest.json`. They capture source passages, not model-written rule summaries. The runtime validates the gzip hash and every passage's source URL, league, domain and PDF page before serving evidence.

Sources were read from the official NFLPA executed March 15, 2020 CBA, the PDF linked by the official 2026 playing-rulebook page, the official NFL important-dates calendar, and the Guaranteed Money section of NFL Football Operations' contract-language explainer. Each source carries its URL, SHA256, capture timestamp and edition boundary; each passage carries exact text, article/section location, printed page and PDF viewer page where applicable. Calendar records carry their actual date and year. The explainer is labeled separately from executed agreement text.

This is broad, bounded text retrieval. It indexes CBA Articles 1–68 and extractable appendices, all 19 playing-rule chapters, and the dated calendar entries present at capture. Article 69 (printed page 333 / PDF page 350) is scanned and is an explicit text-extraction gap. Illustrations, rotated exhibit text, signature images and table layout are not comprehensively captured. `unindexed_pdf_pages` records pages that yielded no substantive text. The source PDF controls those gaps. The text search has topic/alias hints and BM25 ranking over passage bodies; it is not a comprehensive legal interpreter or semantic model.

The executed CBA is not a consolidated current personnel manual. Its original practice-squad limits differ from the current calendar; that conflict is surfaced. Current eligibility/elevation policies, later amendments, side letters and private player contracts require separate verification. The 2026 playing-rule edition cannot establish the 2025 rule. The rolling calendar captured here starts in July 2026 and ends in May 2027; missing deadlines are unsupported, not borrowed from another year. No live roster, cap ledger, waiver order, player guarantee or current tender amount is inferred.

Rebuild with Python 3 and `pypdf`:

```sh
python3 scripts/build-nfl-authority.py
```

The downloader checks the two reviewed PDF identities/page counts, resolves the rulebook PDF from the official landing page, and refuses changed calendar/guarantee extraction shapes. Raw downloads stay under ignored `.cache/`; no accounts or secrets are needed. To repeat a build from exactly the saved bytes, pass `--offline --captured-at <original-source-capture-time>`. An offline rebuild must retain the prior capture timestamp. Review source changes and refresh tests before replacing a deployed snapshot.

Runtime entry points are exported from `server/src/nfl_authority/index.ts`:

```ts
await searchNflAuthority({ question, domain: 'cba', limit: 5 }); // FactualAnswer
await searchNflAuthorityPassages({ question }); // ranked bound passages / unsupported
await getNflAuthorityCoverage();
```

The returned answer, table and source data are deterministic. A caller may synthesize prose from that evidence, preserving conditions, uncertainty and source references. Source `data.excerpt` is the exact passage used in the evidence table; `data.source_locator`, `pdf_page`, `printed_page`, `source_url`, `source_sha256`, `captured_at` and `authority_boundary` retain its provenance. No model call or network request occurs while searching.

For eight reviewed rehearsal families, `body.key_findings` begins with a `Rule summary` finding. `buildReviewedNflAuthoritySummaries(result)` produces those findings only when the retrieved matches contain every required source ID, locator, edition/year and controlling clause. Missing support suppresses the summary. The underlying passage findings, tables and sources remain intact. These short code-authored findings let the caller preserve verified dates and counts in its answer without accepting model-generated numerical claims.

Validation: `cd server && node --import tsx --test tests/nfl_rules/test_nfl_authority*.test.ts`, plus `npm run typecheck`. Cases exercise source identity/binding, guarantees, bonus proration, June 1 release versus trade, practice squads, waivers, fifth-year draft-class boundaries, RFA tenders, 2026 onside kicks, catches, overtime, body-only spike retrieval, calendar-year isolation and unsupported topics. Summary tests also remove required evidence and substitute incorrect sources, dates and clauses to verify that prose fails closed.
