#!/usr/bin/env python3
"""Build the normalized CBA corpus JSON from the official NBA-NBPA PDF.

The repo stores the normalized JSON used by the app seed. It intentionally does
not store the PDF. Run with a Python environment that has `pypdf` installed:

  python3 tools/build_cba_corpus.py --pdf /tmp/2023-nba-cba.pdf --out data/cba/2023-nba-nbpa-cba.json
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

try:
    from pypdf import PdfReader
except ImportError as exc:  # pragma: no cover - exercised by users' local envs.
    raise SystemExit("pypdf is required: python3 -m pip install pypdf") from exc


SOURCE_URL = (
    "https://imgix.cosmicjs.com/25da5eb0-15eb-11ee-b5b3-fbd321202bdf-"
    "Final-2023-NBA-Collective-Bargaining-Agreement-6-28-23.pdf"
)

ARTICLE_RE = re.compile(r"^ARTICLE\s+([IVXLCDM]+)\b(?:\s+(.*))?$")
SECTION_RE = re.compile(r"^Section\s+([0-9]+[A-Za-z]?)\.\s*(.*)$")
HEADER_RE = re.compile(r"^(?:\d+\s+)?Article\s+[IVXLCDM]+(?:\s+\d+)?$")
EXHIBIT_RE = re.compile(r"^EXHIBIT\s+([A-Z](?:-[0-9]+)?)\b(?:\s+(.*))?$")


@dataclass
class SectionDraft:
    id: str
    label: str
    article: str
    section: str | None
    section_number: str | None
    page_start: int
    page_end: int
    sort_key: int
    aliases: list[str] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)
    page_lines: list[tuple[int, str]] = field(default_factory=list)

    def append(self, line: str, page_number: int) -> None:
        effective_page_number = page_number if page_number >= self.page_end else self.page_end
        if line:
            self.lines.append(line)
            self.page_lines.append((effective_page_number, line))
        self.page_end = effective_page_number

    def to_json(self) -> dict:
        body = normalize_ws(" ".join(self.lines))
        return {
            "id": self.id,
            "document_id": "2023-nba-nbpa-cba",
            "label": self.label,
            "body": body,
            "article": self.article,
            "section": self.section,
            "section_number": self.section_number,
            "page_start": self.page_start,
            "page_end": self.page_end,
            "sort_key": self.sort_key,
            "aliases": sorted(set(self.aliases + inferred_aliases(self.label, body))),
            "source_url": SOURCE_URL,
            "chunks": chunk_body_from_pages(self.id, self.page_lines, self.page_start, self.page_end),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", required=True, help="Path to the official NBA-NBPA CBA PDF")
    parser.add_argument("--out", required=True, help="Output JSON path")
    args = parser.parse_args()

    corpus = build_corpus(Path(args.pdf))
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(corpus, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} ({len(corpus['sections'])} sections)")


def build_corpus(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    sections: list[SectionDraft] = []
    current: SectionDraft | None = None
    current_article = ""
    current_article_title = ""
    pending_article_lines: list[str] = []
    sort_key = 0

    def finish_current() -> None:
        nonlocal current
        if current and normalize_ws(" ".join(current.lines)):
            sections.append(current)
        current = None

    def start_article_section(page_number: int) -> None:
        nonlocal current, sort_key
        if current or not current_article:
            return
        sort_key += 1
        label = current_article
        if current_article_title:
            label = f"{label} - {current_article_title.title()}"
        current = SectionDraft(
            id=normalize_id(current_article),
            label=label,
            article=current_article,
            section=current_article_title.title() if current_article_title else None,
            section_number=None,
            page_start=page_number,
            page_end=page_number,
            sort_key=sort_key,
        )
        for line in pending_article_lines:
            current.append(line, page_number)
        pending_article_lines.clear()

    # Skip roman-numeral table-of-contents pages. The first body page is PDF
    # page 25, printed CBA page 1.
    for physical_index, page in enumerate(reader.pages, start=1):
        if physical_index < 25:
            continue
        page_text = page.extract_text() or ""
        lines = clean_lines(page_text)
        page_number = printed_page_number(lines, physical_index)

        i = 0
        while i < len(lines):
            line = lines[i]
            article_match = ARTICLE_RE.match(line)
            exhibit_match = EXHIBIT_RE.match(line)
            section_match = SECTION_RE.match(line)

            if article_match:
                finish_current()
                current_article = f"Article {article_match.group(1)}"
                title_parts: list[str] = []
                if article_match.group(2):
                    title_parts.append(article_match.group(2))
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    if SECTION_RE.match(nxt) or ARTICLE_RE.match(nxt) or EXHIBIT_RE.match(nxt):
                        break
                    if looks_like_heading(nxt):
                        title_parts.append(nxt)
                        j += 1
                        continue
                    break
                current_article_title = normalize_ws(" ".join(title_parts))
                pending_article_lines = [line, current_article_title] if current_article_title else [line]
                i = j
                continue

            if exhibit_match:
                finish_current()
                current_article = f"Exhibit {exhibit_match.group(1)}"
                current_article_title = normalize_ws(exhibit_match.group(2) or "")
                pending_article_lines = [line]
                start_article_section(page_number)
                i += 1
                continue

            if section_match and current_article:
                title = normalize_ws(section_match.group(2))
                if not title:
                    if current is None and current_article:
                        start_article_section(page_number)
                    if current is not None:
                        current.append(line, page_number)
                    i += 1
                    continue
                finish_current()
                sort_key += 1
                section_number = section_match.group(1)
                label = f"{current_article} §{section_number}"
                if title:
                    label = f"{label} - {title.rstrip('.')}"
                current = SectionDraft(
                    id=normalize_id(f"{current_article} §{section_number}"),
                    label=label,
                    article=current_article,
                    section=title.rstrip(".") if title else None,
                    section_number=section_number,
                    page_start=page_number,
                    page_end=page_number,
                    sort_key=sort_key,
                )
                for pending in pending_article_lines:
                    current.append(pending, page_number)
                pending_article_lines.clear()
                current.append(line, page_number)
                i += 1
                continue

            if current is None and current_article:
                start_article_section(page_number)
            if current is not None:
                current.append(line, page_number)
            i += 1

    finish_current()
    json_sections = [section.to_json() for section in sections]
    return {
        "document": {
            "id": "2023-nba-nbpa-cba",
            "title": "2023 NBA-NBPA Collective Bargaining Agreement",
            "source_url": SOURCE_URL,
            "effective_date": "2023-07-01",
            "season_label": "2023 CBA",
            "page_count": len(reader.pages),
        },
        "sections": json_sections,
    }


def clean_lines(text: str) -> list[str]:
    out: list[str] = []
    for raw in text.splitlines():
        line = normalize_ws(raw)
        if not line:
            continue
        if "Table of Contents" in line:
            continue
        if HEADER_RE.match(line):
            continue
        out.append(line)
    return out


def printed_page_number(lines: list[str], physical_index: int) -> int:
    for line in lines[:4]:
        match = re.search(r"\b(\d{1,3})$", line)
        if match:
            return int(match.group(1))
        match = re.match(r"^(\d{1,3})\s+Article\b", line)
        if match:
            return int(match.group(1))
    return max(1, physical_index - 24)


def looks_like_heading(line: str) -> bool:
    letters = re.sub(r"[^A-Za-z]", "", line)
    if len(letters) < 3:
        return False
    return letters.upper() == letters and len(line) <= 90


def normalize_id(value: str) -> str:
    return normalize_ws(value).replace("Section ", "§")


def normalize_ws(value: str) -> str:
    value = re.sub(r"([A-Za-z])\s*-\s*([A-Za-z])", r"\1-\2", value)
    value = re.sub(r"\bT raded\b", "Traded", value)
    value = re.sub(r"\bS heet\b", "Sheet", value)
    value = re.sub(r"\bA gent\b", "Agent", value)
    return re.sub(r"\s+", " ", value).strip()


def inferred_aliases(label: str, body: str) -> list[str]:
    label_text = label.lower()
    early_body = body[:2500].lower()
    normalized = f"{label_text} {early_body}"
    aliases: list[str] = []

    if "mid-level salary exception" in normalized or "mid-level exception" in normalized:
        aliases.extend(["mle", "mid-level exception", "non-taxpayer mle", "taxpayer mle"])
    if "second apron level" in normalized or "second apron" in label_text:
        aliases.extend(["second apron", "apron restrictions"])
    if "first apron level" in normalized or "first apron" in label_text:
        aliases.extend(["first apron", "apron levels"])
    if (
        "bird rights" in normalized
        or "bird exception" in normalized
        or "veteran free agent exception" in normalized
    ):
        aliases.extend(["bird rights", "veteran free agent exception"])
    if "qualifying offer" in normalized or "restricted free agency" in label_text:
        aliases.extend(["qualifying offer", "restricted free agency"])
    if "trade" in label_text or "traded player exception" in label_text:
        aliases.extend(["trade rules", "traded player exception", "aggregation"])
    if "two-way" in label_text:
        aliases.extend(["two-way contract", "two-way player"])
    return aliases


def chunk_body_from_pages(
    article_id: str,
    page_lines: list[tuple[int, str]],
    page_start: int,
    page_end: int,
) -> list[dict]:
    page_words: list[tuple[str, int]] = []
    for page_number, line in page_lines:
        for word in normalize_ws(line).split():
            page_words.append((word, page_number))

    if not page_words:
        return [{
            "id": f"{article_id}::chunk-1",
            "article_id": article_id,
            "chunk_index": 1,
            "body": "",
            "page_start": page_start,
            "page_end": page_end,
        }]
    chunks: list[dict] = []
    max_words = 190
    stride = 155
    for start in range(0, len(page_words), stride):
        chunk_words = page_words[start:start + max_words]
        if not chunk_words:
            break
        pages = [page_number for _, page_number in chunk_words]
        chunks.append({
            "id": f"{article_id}::chunk-{len(chunks) + 1}",
            "article_id": article_id,
            "chunk_index": len(chunks) + 1,
            "body": " ".join(word for word, _ in chunk_words),
            "page_start": min(pages),
            "page_end": max(pages),
        })
        if start + max_words >= len(page_words):
            break
    return chunks


if __name__ == "__main__":
    main()
