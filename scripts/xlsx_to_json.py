#!/usr/bin/env python3
"""
Convert APEX_EPR_USPolicyDatabase_v1.xlsx into the JSON files consumed by the
static site (assets data/bills.json and data/aggregates.json).

Run from the repo root:
    python scripts/xlsx_to_json.py

Outputs:
    data/bills.json       Full bill records with parsed sub-provisions
    data/aggregates.json  Pre-computed counts for charts and filters
"""

from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("openpyxl is required: pip install openpyxl", file=sys.stderr)
    sys.exit(1)


REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_XLSX = REPO_ROOT / "source" / "APEX_EPR_USPolicyDatabase_v1.xlsx"
DATA_DIR = REPO_ROOT / "data"

METADATA = {
    "source": "Sustainable Packaging Coalition / GreenBlue EPR Policy Database",
    "source_url": "https://epr.sustainablepackaging.org/policies",
    "last_updated": "February 2026",
}


def parse_cell(value):
    """Split a narrative cell into a list of {heading, text} chunks.

    The source uses bold sub-headings glued to the next sentence, separated by
    blank lines from the prior paragraph (e.g. "...alcohol sales.\\n\\nFixed
    RateThere must be...").  This heuristic recovers them.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    parts = re.split(r"\n{2,}", text)
    chunks = []
    for part in parts:
        part = part.strip()
        if not part:
            continue
        match = re.match(
            r"^([A-Z][A-Za-z\-/&,\.\' ]{0,80}?)([A-Z][a-z][^A-Z]*.*)$",
            part,
            re.DOTALL,
        )
        if match:
            head = match.group(1).strip()
            body = match.group(2).strip()
            if (
                2 <= len(head) <= 80
                and head.count(" ") <= 6
                and "." not in head
                and not head.endswith(",")
            ):
                chunks.append({"heading": head, "text": body})
                continue
        chunks.append({"heading": None, "text": part})
    return chunks


def build_labels(row1, row2):
    """Forward-fill row 1 (categories) and pair with row 2 (sub-provision names)."""
    filled = []
    last = None
    for value in row1:
        if value:
            last = value
        filled.append(last)

    labels = []
    for cat, sub in zip(filled, row2):
        if sub:
            labels.append((cat, sub))
        elif cat:
            labels.append((cat, cat))
        else:
            labels.append((None, None))
    return labels


def load_bills(workbook):
    sheet = workbook["All Bills"]
    row1 = [c.value for c in sheet[1]]
    row2 = [c.value for c in sheet[2]]
    labels = build_labels(row1, row2)

    bills = []
    for r in range(3, sheet.max_row + 1):
        row = [sheet.cell(row=r, column=c).value for c in range(1, sheet.max_column + 1)]
        if not any(row):
            continue

        bill = {
            "id": row[0],
            "name": row[1],
            "state": row[2],
            "abbr": row[3],
            "year": row[4],
            "status": row[5],
            "source_label": row[6],
            "gov_url": row[7],
            "provisions": {},
        }

        for i in range(8, len(row)):
            cat, sub = labels[i]
            if not cat or row[i] is None:
                continue
            parsed = parse_cell(row[i])
            if not parsed:
                continue
            bill["provisions"].setdefault(cat, {})[sub] = parsed

        bills.append(bill)
    return bills, labels


def load_source_urls(workbook):
    """Extract real hyperlinks from the Source URL column where present."""
    sheet = workbook["All Bills"]
    urls = {}
    for r in range(3, sheet.max_row + 1):
        bill_id = sheet.cell(row=r, column=1).value
        cell = sheet.cell(row=r, column=7)
        if cell.hyperlink and bill_id:
            urls[bill_id] = cell.hyperlink.target
    return urls


def build_aggregates(bills, labels):
    status_counts = Counter()
    state_counts = Counter()
    state_status_counts = defaultdict(Counter)
    year_counts = Counter()
    provision_counts = Counter()

    for bill in bills:
        status = bill.get("status") or "Unknown"
        state = bill.get("state") or "Unknown"
        year = bill.get("year")

        status_counts[status] += 1
        state_counts[state] += 1
        state_status_counts[state][status] += 1
        if year is not None:
            year_counts[str(year)] += 1

        for cat, subs in bill["provisions"].items():
            for sub in subs:
                provision_counts[(cat, sub)] += 1

    state_breakdown = []
    for state, count in sorted(state_counts.items(), key=lambda x: (-x[1], x[0])):
        breakdown = state_status_counts[state]
        state_breakdown.append({
            "state": state,
            "total": count,
            "passed": breakdown.get("Passed", 0),
            "amended": breakdown.get("Amended", 0),
            "introduced": breakdown.get("Introduced", 0),
            "failed": breakdown.get("Failed", 0),
            "in_progress": breakdown.get("In Progress", 0),
            "unknown": breakdown.get("Unknown", 0) + breakdown.get(None, 0),
        })

    elements = []
    seen = set()
    for cat, sub in labels[8:]:
        if not cat:
            continue
        if (cat, sub) in seen:
            continue
        seen.add((cat, sub))
        elements.append({
            "category": cat,
            "option": sub,
            "bill_count": provision_counts.get((cat, sub), 0),
        })

    return {
        "status_counts": dict(status_counts),
        "state_counts": dict(state_counts),
        "state_breakdown": state_breakdown,
        "year_counts": dict(year_counts),
        "elements": elements,
    }


def main():
    if not SOURCE_XLSX.exists():
        print(f"Missing source workbook: {SOURCE_XLSX}", file=sys.stderr)
        sys.exit(1)

    DATA_DIR.mkdir(exist_ok=True)
    workbook = openpyxl.load_workbook(SOURCE_XLSX, data_only=True)
    bills, labels = load_bills(workbook)
    urls = load_source_urls(workbook)
    for bill in bills:
        url = urls.get(bill["id"])
        if url:
            bill["source_url"] = url

    aggregates = build_aggregates(bills, labels)
    aggregates["metadata"] = METADATA
    aggregates["total_bills"] = len(bills)

    bills_payload = {"metadata": METADATA, "bills": bills}

    bills_path = DATA_DIR / "bills.json"
    aggregates_path = DATA_DIR / "aggregates.json"

    with open(bills_path, "w", encoding="utf-8") as f:
        json.dump(bills_payload, f, separators=(",", ":"), ensure_ascii=False)
    with open(aggregates_path, "w", encoding="utf-8") as f:
        json.dump(aggregates, f, separators=(",", ":"), ensure_ascii=False)

    print(f"Wrote {bills_path} ({os.path.getsize(bills_path):,} bytes, {len(bills)} bills)")
    print(f"Wrote {aggregates_path} ({os.path.getsize(aggregates_path):,} bytes)")


if __name__ == "__main__":
    main()
