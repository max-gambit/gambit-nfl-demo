#!/usr/bin/env python3
"""Download primary NFL sources and build a page-bound passage index (pypdf required).

No accounts, credentials, database, embeddings, or model calls. Run from any cwd.
Raw downloads stay in the ignored .cache directory; the portable gzip index and
manifest are the reviewable outputs. Rebuilds retain the exact source bytes' hashes.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import re
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from html import unescape
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "nfl-authority"
CBA_URL = "https://nflpaweb.blob.core.windows.net/website/PDFs/CBA/March-15-2020-NFL-NFLPA-Collective-Bargaining-Agreement-Final-Executed-Copy.pdf"
RULES_URL = "https://operations.nfl.com/rules-officiating/2026-nfl-rulebook"
CALENDAR_URL = "https://operations.nfl.com/calendar-events/nfl-important-dates"
CONTRACT_GUIDE_URL = "https://operations.nfl.com/calendar-events/nfl-free-agency/contract-language"


class HtmlRecords(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self.rows: list[list[str]] = []
        self.row: list[str] | None = None
        self.cell: list[str] | None = None
        self.link: tuple[str, list[str]] | None = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a":
            self.link = (attrs.get("href", ""), [])
        if tag == "tr":
            self.row = []
        if tag in ("td", "th") and self.row is not None:
            self.cell = []
        if tag in ("br", "p", "div") and self.cell is not None:
            self.cell.append("\n")

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)
        if self.link is not None:
            self.link[1].append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self.link is not None:
            self.links.append((self.link[0], " ".join(self.link[1])))
            self.link = None
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(clean(" ".join(self.cell)))
            self.cell = None
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def clean(text):
    # pypdf soft hyphens and line-wrap word breaks are not source wording.
    text = text.replace("\x02", "").replace("\u00ad", "")
    text = re.sub(r"(?<=[a-z])-\s*\n\s*(?=[a-z])", "", text)
    return re.sub(r"\s+", " ", text).strip()


def fetch(url, key, offline):
    path = OUT / ".cache" / key
    if not offline:
        request = urllib.request.Request(url, headers={"User-Agent": "Gambit-NFL-public-authority-index/1.0"})
        with urllib.request.urlopen(request, timeout=60) as response:
            if response.status != 200:
                raise ValueError(f"Unexpected HTTP status for {url}: {response.status}")
            data = response.read(30 * 1024 * 1024 + 1)
            if len(data) > 30 * 1024 * 1024:
                raise ValueError(f"Source exceeds capture limit: {url}")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return path.read_bytes()


def source(source_id, domain, title, url, data, captured_at, **kwargs):
    return {"id": source_id, "league": "NFL", "domain": domain, "title": title, "url": url,
            "captured_at": captured_at, "sha256": hashlib.sha256(data).hexdigest(), **kwargs}


def page_chunks(text, max_chars=2100, overlap=350):
    """Sentence-aware overlapping windows; never manufacture a missing sentence end."""
    start = 0
    while start < len(text):
        end = min(len(text), start + max_chars)
        if end < len(text):
            breaks = [m.end() for m in re.finditer(r"[.;:]\s+", text[start + 900:end])]
            if breaks:
                end = start + 900 + breaks[-1]
            else:
                end = text.rfind(" ", start + 900, end)
        yield start, end, text[start:end].strip()
        if end == len(text):
            return
        # Overlap preserves immediate qualifying language without hiding truncation.
        start = text.find(" ", max(start + 1, end - overlap)) + 1


def pdf_passages(src, data):
    reader = PdfReader(io.BytesIO(data))
    src["pdf_page_count"] = len(reader.pages)
    if src["domain"] == "cba":
        if len(reader.pages) != 456 or "COLLECTIVE" not in clean(reader.pages[0].extract_text() or "").upper():
            raise ValueError("Executed CBA identity/page-count check failed; review the source before rebuilding")
        first_body, last_body = 17, 456
    else:
        if len(reader.pages) != 91 or "2026" not in (reader.pages[0].extract_text() or ""):
            raise ValueError("2026 playing rulebook identity/page-count check failed; review the source before rebuilding")
        first_body, last_body = 8, 77  # Rules 1–19, before penalty summaries/signals/index.
    article, section, appendix, rule_article = "", "", "", ""
    passages = []
    for page_num in range(first_body, last_body + 1):
        raw = reader.pages[page_num - 1].extract_text(extraction_mode="layout") or ""
        # Numbering is explicit in the two reviewed editions. The PDF URL always uses viewer pages.
        printed_page = "xvi" if src["domain"] == "cba" and page_num == 17 else str(page_num - (17 if src["domain"] == "cba" else 7))
        lines = raw.splitlines()
        segment_lines: list[str] = []
        segments = []

        def flush():
            nonlocal segment_lines
            value = clean("\n".join(segment_lines))
            if value:
                segments.append((article, section, appendix, rule_article, value))
            segment_lines = []

        for line in lines:
            value = line.strip()
            if re.fullmatch(r"(?:[ivxlcdm]+|[—–-]?\d+[—–-]?|Rule \d+)", value):
                continue
            art = re.match(r"^ARTICLE\s+(\d+[A-Z]?)\b", value) if src["domain"] == "cba" else re.match(r"^RULE\s+(\d+)\s+(.+)", value)
            app = re.match(r"^APPENDIX\s+([A-Z]{1,2}(?:-[A-Z0-9]+)?)\b(.*)", value) if src["domain"] == "cba" else None
            sec = re.match(r"^Section\s+(\d+)\.\s+([^:]+):?", value) if src["domain"] == "cba" else re.match(r"^SECTION\s+(\d+)\s+(.+)", value)
            sub = re.match(r"^ARTICLE\s+(\d+)\.", value) if src["domain"] == "playing_rules" else None
            if art:
                flush()
                article = f"{'Article' if src['domain'] == 'cba' else 'Rule'} {art[1]}"
                section, appendix, rule_article = "", "", ""
            elif app:
                flush()
                appendix = f"Appendix {app[1]}"
                article, section, rule_article = "", "", ""
            elif sec:
                flush()
                section = f"Section {sec[1]}"
                rule_article = ""
            elif sub:
                flush()
                rule_article = f"Article {sub[1]}"
            segment_lines.append(line)
        flush()
        for seg_index, (art, sec, app, sub, text) in enumerate(segments):
            location = ", ".join(x for x in [app or art, sec, sub] if x)
            if not location:
                location = "Preamble" if src["domain"] == "cba" else "Playing rules"
            for chunk_index, (start, end, chunk) in enumerate(page_chunks(text)):
                passages.append({
                    "id": f"{src['id']}:p{page_num}:s{seg_index}:c{chunk_index}",
                    "source_id": src["id"], "domain": src["domain"],
                    "title": f"{location}, printed p. {printed_page}",
                    "locator": location, "pdf_page": page_num, "printed_page": str(printed_page),
                    "url": f"{src['url']}#page={page_num}", "text": chunk,
                    "section_excerpt_start": start, "section_excerpt_end": end,
                    "continues_before": start > 0 or seg_index == 0,
                    "continues_after": end < len(text) or seg_index == len(segments) - 1,
                    "season_year": 2026 if src["domain"] == "playing_rules" else None,
                })
    indexed_pages = {p["pdf_page"] for p in passages}
    src["unindexed_pdf_pages"] = [n for n in range(first_body, last_body + 1) if n not in indexed_pages]
    return passages


def calendar_passages(src, data):
    parser = HtmlRecords()
    parser.feed(data.decode("utf-8"))
    year = None
    passages = []
    for row in parser.rows:
        if len(row) == 1 and re.fullmatch(r"20\d\d", row[0]):
            year = int(row[0])
        elif len(row) == 2 and year and row[0] and row[1]:
            if row[0].lower() == "date":
                continue
            passages.append({
                "id": f"{src['id']}:{year}:{len(passages) + 1}", "source_id": src["id"],
                "domain": "league_dates", "title": f"{row[0]}, {year}",
                "locator": f"Calendar entry: {row[0]}, {year}; all times Eastern",
                "pdf_page": None, "printed_page": None, "url": src["url"],
                "text": row[1], "season_year": year, "date_label": row[0],
                "continues_before": False, "continues_after": False,
            })
    if len(passages) < 15 or not any("All trading ends" in p["text"] for p in passages):
        raise ValueError("Calendar parser did not recover the expected dated entries; no index published")
    return passages


def guarantees_passage(src, data):
    html = data.decode("utf-8")
    match = re.search(r"<h3\b[^>]*>\s*(?:<em>)?GUARANTEED MONEY(?:</em>)?\s*</h3>(.*?)<h3\b", html, re.I | re.S)
    if not match:
        raise ValueError("Official guide's guaranteed-money heading changed; review before indexing")
    text = clean(unescape(re.sub(r"<[^>]+>", " ", match[1])))
    if "skill, cap and/or injury" not in text:
        raise ValueError("Official guarantee definitions were not recovered")
    return [{"id": f"{src['id']}:guaranteed-money", "source_id": src["id"], "domain": "cba",
             "title": "Guaranteed money: skill, cap and injury protections", "locator": "Contract language > Guaranteed money",
             "pdf_page": None, "printed_page": None, "url": src["url"], "text": text,
             "season_year": None, "continues_before": False, "continues_after": False}]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Use previously captured raw bytes")
    parser.add_argument("--captured-at", help="ISO UTC capture time; required with --offline")
    args = parser.parse_args()
    if args.offline and not args.captured_at:
        parser.error("--offline requires the original --captured-at (do not manufacture a fresh capture)")
    captured_at = args.captured_at or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    cba = fetch(CBA_URL, "executed-cba-2020.pdf", args.offline)
    rules_html = fetch(RULES_URL, "rulebook-2026.html", args.offline)
    parsed = HtmlRecords()
    parsed.feed(rules_html.decode("utf-8"))
    links = [url for url, title in parsed.links if url.endswith(".pdf") and "2026" in title]
    if len(set(links)) != 1 or not links[0].startswith("https://static.www.nfl.com/"):
        raise ValueError("Expected one official 2026 rulebook PDF link; review changed landing page")
    rules_pdf_url = links[0]
    rules_pdf = fetch(rules_pdf_url, "rulebook-2026.pdf", args.offline)
    calendar = fetch(CALENDAR_URL, "league-dates.html", args.offline)
    guide = fetch(CONTRACT_GUIDE_URL, "contract-language.html", args.offline)
    sources = [
        source("nfl-cba-2020-executed", "cba", "2020 NFL–NFLPA Collective Bargaining Agreement (executed March 15, 2020)", CBA_URL, cba, captured_at,
               document_date="2020-03-15", edition_year=2020, effective_years=[2020, 2030],
               authority_boundary="Executed 2020 agreement, including its dated and conditional provisions. Later amendments, side letters, current league personnel policies, and individual contracts are not comprehensively captured. The agreement's Final League Year is distinct from the final year of a player's contract."),
        source("nfl-playing-rules-2026", "playing_rules", "2026 Official Playing Rules of the National Football League", rules_pdf_url, rules_pdf, captured_at,
               landing_url=RULES_URL, landing_sha256=hashlib.sha256(rules_html).hexdigest(), document_date=None, edition_year=2026, effective_years=[2026, 2026],
               authority_boundary="2026 playing rules only, Rules 1–19. Not personnel or salary-cap authority. Later amendments and official case interpretations require separate verification."),
        source("nfl-league-dates-2026-2027", "league_dates", "NFL Football Operations important dates (2026–2027 captured calendar)", CALENDAR_URL, calendar, captured_at,
               document_date=None, edition_year=2026, effective_years=[2026, 2027],
               authority_boundary="Only the dated entries present in this captured rolling calendar. All times Eastern; all dates are subject to change. Missing prior or future deadlines are not inferred."),
        source("nfl-contract-guarantees-guide", "cba", "NFL Football Operations contract language: Guaranteed money", CONTRACT_GUIDE_URL, guide, captured_at,
               document_date=None, edition_year=None, effective_years=[2020, 2030],
               authority_boundary="Official league explanatory guide, limited to its Guaranteed Money section. This is not executed CBA text or an individual contract; guarantee triggers, offsets, vesting and voiding depend on applicable terms."),
    ]
    passages = pdf_passages(sources[0], cba) + pdf_passages(sources[1], rules_pdf) + calendar_passages(sources[2], calendar) + guarantees_passage(sources[3], guide)
    index = {"schema": "nfl_authority.v1", "league": "NFL", "captured_at": captured_at,
             "coverage": "Page-bound text retrieval, not comprehensive or automatically consolidated current NFL authority.",
             "sources": sources, "passages": passages}
    encoded = json.dumps(index, ensure_ascii=False, separators=(",", ":")).encode()
    OUT.mkdir(parents=True, exist_ok=True)
    compressed = gzip.compress(encoded, mtime=0)
    (OUT / "authority.json.gz").write_bytes(compressed)
    manifest = {k: v for k, v in index.items() if k != "passages"}
    manifest.update({"index_file": "authority.json.gz", "index_sha256": hashlib.sha256(compressed).hexdigest(),
                     "passage_count": len(passages), "passages_by_domain": {d: sum(p["domain"] == d for p in passages) for d in ["cba", "playing_rules", "league_dates"]}})
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"ok": True, "captured_at": captured_at, "passages": len(passages), "by_domain": manifest["passages_by_domain"], "index_bytes": len(compressed)}))


if __name__ == "__main__":
    main()
