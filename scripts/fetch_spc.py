#!/usr/bin/env python3
"""
Fetch the latest US packaging EPR dataset from the Sustainable Packaging
Coalition / GreenBlue policy database and write three JSON files consumed by
the static site:

    data/policies.json   - All policies with full provision-level fields
    data/aggregates.json - Pre-computed counts for the home page and filters
    data/fields.json     - Category and option titles (display metadata)

Run from the repo root:
    python scripts/fetch_spc.py

No auth required. SPC's site is a Next.js static export; this script reaches
its server-side-generated JSON endpoints, which return the same data the
official UI consumes.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"

SPC_HOST = "https://epr.sustainablepackaging.org"
INDEX_URL = f"{SPC_HOST}/policies"
USER_AGENT = "us-epr-policy-tracker/1.0 (https://github.com/rbndchsn/US_EPR_Database2026)"


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def discover_build_id():
    """Parse the Next.js build id from the public /policies page.

    Vercel rotates this on each deploy, so we read it dynamically rather than
    pin a stale value.
    """
    html = http_get(INDEX_URL)
    match = re.search(r'"buildId":"([^"]+)"', html)
    if not match:
        match = re.search(r'/_next/static/([^/]+)/_buildManifest\.js', html)
    if not match:
        raise RuntimeError("Could not discover SPC Next.js buildId from /policies HTML")
    return match.group(1)


def fetch_index(build_id):
    """The index endpoint returns the 100 bills SPC's homepage shows.

    These records carry summary metadata only (no provision text), so we use
    them to enumerate bill IDs and then hit per-bill endpoints in parallel.
    """
    url = f"{SPC_HOST}/_next/data/{build_id}/en-US/policies.json"
    return json.loads(http_get(url))


def fetch_policy(build_id, version):
    """Per-bill endpoint returns the full record including all provision fields."""
    url = f"{SPC_HOST}/_next/data/{build_id}/en-US/policies/{urllib.parse.quote(version)}.json"
    try:
        data = json.loads(http_get(url))
        return data.get("pageProps", {}).get("initPolicy")
    except Exception as e:
        print(f"  warning: could not fetch {version}: {e}", file=sys.stderr)
        return None


def fetch_all_policies(build_id, summaries):
    """Fetch each bill's full record in parallel.  ~100 requests."""
    versions = [s["version"] for s in summaries if s.get("version")]
    full_policies = {}

    def worker(v):
        return v, fetch_policy(build_id, v)

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        for version, policy in ex.map(worker, versions):
            if policy is not None:
                full_policies[version] = policy

    # Merge: prefer the per-bill record (richer); fall back to summary
    summary_by_version = {s.get("version"): s for s in summaries if s.get("version")}
    merged = []
    for v in versions:
        merged.append(full_policies.get(v) or summary_by_version[v])
    return merged


# Status normalisation. SPC encodes statuses as "1:Passed", "2:Amended",
# "3:Introduced", "4:Failed". We strip the numeric prefix.
def normalise_status(raw):
    if not raw:
        return "Unknown"
    if ":" in raw:
        return raw.split(":", 1)[1]
    return raw


# Convert a camelCase or run-on key (allPackagingTypes,
# householdresidential, governmentInstitutionalOrAcademic) into a Title-Cased
# label suitable for display.  Hardcoded overrides cover keys that don't follow
# camelCase cleanly.
KEY_OVERRIDES = {
    "allPackagingTypes": "All Packaging Types",
    "paperProducts": "Paper Products",
    "exclusions": "Exclusions",
    "householdresidential": "Household / Residential",
    "governmentInstitutionalOrAcademic": "Government, Institutional, or Academic",
    "businessOrCommercial": "Business or Commercial",
    "publicSpaces": "Public Spaces",
    "brands": "Brands",
    "licensees": "Licensees",
    "importersdistributors": "Importers / Distributors",
    "smallBusinesses": "Small Businesses",
    "governments": "Governments",
    "charities": "Charities",
    "retailers": "Retailers",
    "collectiveProducerResponsibility": "Collective Producer Responsibility",
    "individualProducerResponsibilityOption": "Individual Producer Responsibility Option",
    "nonprofitRequirement": "Nonprofit Requirement",
    "rateTargets": "Rate Targets",
    "targetsSetInLegislation": "Targets Set in Legislation",
    "financialAndPartialOperational": "Financial and Partial Operational",
    "financialOnly": "Financial Only",
    "fullOperational": "Full Operational",
    "operationalCosts": "Operational Costs",
    "educationAndOutreach": "Education and Outreach",
    "administration": "Administration",
    "marketDevelopment": "Market Development",
    "infrastructureImprovements": "Infrastructure Improvements",
    "fixedRate": "Fixed Rate",
    "productRelated": "Product-Related",
    "modulated": "Modulated",
    "lifeCycleEmissions": "Life Cycle Emissions",
    "recycledContent": "Recycled Content",
    "reuse": "Reuse",
    "design": "Design",
    "recyclability": "Recyclability",
    "convenienceStandards": "Convenience Standards",
    "maximizesUseOfExistingInfrastructure": "Maximizes Use of Existing Infrastructure",
    "deadlineToRegister": "Deadline to Register",
    "deadlineToSubmitPlan": "Deadline to Submit Plan",
    "dateOfImplementation": "Date of Implementation",
    "planReviewAndApproval": "Plan Review and Approval",
    "enforcementAndMonitoring": "Enforcement and Monitoring",
    "fundAllocation": "Fund Allocation",
    "reportingRequirements": "Reporting Requirements",
    "penalties": "Penalties",
    "endOfLifeInstructions": "End-of-Life Instructions",
    "litterPreventionCampaigns": "Litter Prevention Campaigns",
    "programAwareness": "Program Awareness",
    "soleResponsibilityOfPro": "Sole Responsibility of PRO",
    "communityOutreach": "Community Outreach",
    "productLabeling": "Product Labeling",
    "requiredConsultationDuringPlanDevelopment": "Required Consultation During Plan Development",
    "stakeholderAdvisoryCommittee": "Stakeholder Advisory Committee",
    "definesRecyclable": 'Defines "Recyclable"',
    "definesRecycling": 'Defines "Recycling"',
    "definesReusable": 'Defines "Reusable"',
    "definesCompostable": 'Defines "Compostable"',
    "excludesAdvancedRecycling": "Excludes Advanced Recycling",
    "antitrustProtections": "Antitrust Protections",
    "specifiesHowRatesAreMeasured": "Specifies How Rates Are Measured",
    "noPointOfSaleFees": "No Point-of-Sale Fees",
    "needsAssessment": "Needs Assessment",
    "advertiserOption": "Advertiser Option",
    "statewideList": "Statewide List",
    "toxicSubstances": "Toxic Substances",
    "labelingProvisions": "Labeling Provisions",
}


def humanise_key(key):
    if key in KEY_OVERRIDES:
        return KEY_OVERRIDES[key]
    spaced = re.sub(r"(?<!^)(?=[A-Z])", " ", key)
    spaced = spaced.replace("_", " ")
    parts = []
    for word in spaced.split():
        if word.lower() in {"of", "and", "or", "the", "a", "an", "for", "to", "in", "on"}:
            parts.append(word.lower())
        else:
            parts.append(word.capitalize())
    if parts:
        parts[0] = parts[0].capitalize()
    return " ".join(parts)


# Whitelist of provision category keys we render, in the order they should
# appear on the bill detail page. Matches SPC's appSettings.fields order with
# minor adjustments for narrative flow.
CATEGORY_ORDER = [
    "coveredProducts",
    "coveredEntities",
    "producerDefinition",
    "producerExclusions",
    "producerResponsibilityOrganization",
    "structuretype",
    "costCoverage",
    "feeStructure",
    "ecoModulation",
    "targets",
    "infrastructure",
    "additionalPolicyLevers",
    "timelines",
    "governmentRole",
    "enforcement",
    "socialConsiderations",
    "educationAndOutreach",
    "stakeholderInvolvement",
    "recyclablerecyclingDefinition",
    "other",
]

# Top-level metadata fields on every policy that we don't render as provisions
META_KEYS = {
    "fullTitle", "locationPrimary", "location", "date", "year", "allYears",
    "type", "version", "currentVersion", "allVersions", "status",
    "timelineStatus", "passedWithoutEprLanguage", "link", "summary",
    "displayStatus",
}


def build_categories_metadata(app_settings_fields, sample_policies):
    """Combine SPC's category titles with the sub-field keys actually used."""
    titles_by_key = {f["field"]: f.get("title", f["field"]) for f in app_settings_fields}

    seen_subfields = defaultdict(dict)  # cat_key -> {sub_key: True}
    for p in sample_policies:
        for cat_key in CATEGORY_ORDER:
            cat_value = p.get(cat_key)
            if isinstance(cat_value, dict):
                for sub_key in cat_value:
                    seen_subfields[cat_key][sub_key] = True

    categories = []
    for cat_key in CATEGORY_ORDER:
        sub_keys = list(seen_subfields.get(cat_key, {}).keys())
        categories.append({
            "key": cat_key,
            "title": titles_by_key.get(cat_key, humanise_key(cat_key)),
            "options": [
                {"key": sub_key, "title": humanise_key(sub_key)}
                for sub_key in sub_keys
            ],
        })
    return categories


def build_aggregates(policies, categories):
    status_counts = Counter()
    state_counts = Counter()
    state_status_counts = defaultdict(Counter)
    year_counts = Counter()
    type_counts = Counter()

    for p in policies:
        status = normalise_status(p.get("status"))
        state = p.get("locationPrimary") or "Unknown"
        year = p.get("year")
        ptype = p.get("type") or "Unknown"

        status_counts[status] += 1
        state_counts[state] += 1
        state_status_counts[state][status] += 1
        type_counts[ptype] += 1
        if year is not None:
            year_counts[str(year)] += 1

    state_breakdown = []
    for state in sorted(state_counts, key=lambda s: (-state_counts[s], s)):
        bd = state_status_counts[state]
        state_breakdown.append({
            "state": state,
            "total": state_counts[state],
            "passed": bd.get("Passed", 0),
            "amended": bd.get("Amended", 0),
            "introduced": bd.get("Introduced", 0),
            "failed": bd.get("Failed", 0),
            "in_progress": bd.get("In Progress", 0),
            "unknown": bd.get("Unknown", 0),
        })

    elements = []
    for cat in categories:
        for opt in cat["options"]:
            count = sum(
                1 for p in policies
                if isinstance(p.get(cat["key"]), dict) and p[cat["key"]].get(opt["key"])
            )
            elements.append({
                "category": cat["title"],
                "option": opt["title"],
                "bill_count": count,
            })

    return {
        "total_count": len(policies),
        "status_counts": dict(status_counts),
        "state_counts": dict(state_counts),
        "state_breakdown": state_breakdown,
        "year_counts": dict(year_counts),
        "type_counts": dict(type_counts),
        "elements": elements,
    }


def normalise_policy(policy):
    """Lightly clean the raw SPC policy record before serialising.

    - Strip numeric prefix from status
    - Drop empty string sub-fields so the frontend can use truthiness
    """
    out = dict(policy)
    out["status"] = normalise_status(out.get("status"))
    for cat_key in CATEGORY_ORDER:
        v = out.get(cat_key)
        if isinstance(v, dict):
            cleaned = {k: (s.strip() if isinstance(s, str) else s) for k, s in v.items() if s}
            cleaned = {k: s for k, s in cleaned.items() if s}
            if cleaned:
                out[cat_key] = cleaned
            else:
                out.pop(cat_key, None)
    return out


def main():
    DATA_DIR.mkdir(exist_ok=True)
    print("Discovering SPC build id...")
    build_id = discover_build_id()
    print(f"  build id: {build_id}")

    print("Fetching policy index...")
    index_payload = fetch_index(build_id)
    summaries = index_payload["pageProps"]["initAllPolicies"]
    app_settings_fields = index_payload["pageProps"]["initAppSettings"]["fields"]
    print(f"  index has {len(summaries)} policies")

    print("Fetching per-bill detail (parallel)...")
    raw_policies = fetch_all_policies(build_id, summaries)
    print(f"  fetched {len(raw_policies)} full policy records")

    # Sort newest first so the home "recent" view doesn't need to re-sort
    def policy_sort_key(p):
        return p.get("date") or "0000-00-00"
    raw_policies.sort(key=policy_sort_key, reverse=True)

    policies = [normalise_policy(p) for p in raw_policies]

    categories = build_categories_metadata(app_settings_fields, policies)
    aggregates = build_aggregates(policies, categories)

    metadata = {
        "source": "Sustainable Packaging Coalition / GreenBlue EPR Policy Database",
        "source_url": "https://epr.sustainablepackaging.org/policies",
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "build_id": build_id,
    }

    policies_path = DATA_DIR / "policies.json"
    aggregates_path = DATA_DIR / "aggregates.json"
    fields_path = DATA_DIR / "fields.json"

    with open(policies_path, "w", encoding="utf-8") as f:
        json.dump({"metadata": metadata, "policies": policies}, f, separators=(",", ":"), ensure_ascii=False)
    with open(aggregates_path, "w", encoding="utf-8") as f:
        json.dump({"metadata": metadata, **aggregates}, f, separators=(",", ":"), ensure_ascii=False)
    with open(fields_path, "w", encoding="utf-8") as f:
        json.dump({"metadata": metadata, "categories": categories}, f, indent=2, ensure_ascii=False)

    print(f"Wrote {policies_path} ({os.path.getsize(policies_path):,} bytes, {len(policies)} policies)")
    print(f"Wrote {aggregates_path} ({os.path.getsize(aggregates_path):,} bytes)")
    print(f"Wrote {fields_path} ({os.path.getsize(fields_path):,} bytes)")


if __name__ == "__main__":
    main()
