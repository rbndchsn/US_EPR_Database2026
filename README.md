# US EPR Policy Tracker

A static web tool that presents United States packaging Extended Producer Responsibility (EPR) bills and laws in a browsable, filterable interface. Sourced from the Sustainable Packaging Coalition / GreenBlue EPR Policy Database.

Live data: 100 bills across 20 states, refreshed February 2026.

Repository: https://github.com/rbndchsn/US_EPR_Database2026
Live site (after first deploy): https://rbndchsn.github.io/US_EPR_Database2026/

## What it does

- Home page with summary tiles and pie charts (status, state distribution)
- Browse view with filters (status, state, year, free-text search)
- Detail page per bill, with all 17 EPR policy elements presented as collapsible sections
- Compliance Snapshot block on each bill detail page that surfaces registration, plan submission, and implementation deadlines
- Aggregated Deadlines view across all passed and amended laws
- About page that explains EPR and the elements tracked

## Repository layout

```
us-epr-policy-tool/
├── index.html                # Single-page app shell + templates
├── assets/
│   ├── css/styles.css        # All styling
│   └── js/app.js             # Routing, filtering, charts
├── data/
│   ├── bills.json            # Generated; full bill detail
│   └── aggregates.json       # Generated; pre-computed counts
├── scripts/
│   └── xlsx_to_json.py       # Excel to JSON conversion
├── source/
│   └── APEX_EPR_USPolicyDatabase_v1.xlsx
├── .github/workflows/
│   └── deploy.yml            # CI: regenerate JSON, deploy to Pages
├── .nojekyll                 # Disable Jekyll on GitHub Pages
└── README.md
```

## Run locally

The site is static. Any local web server works.

```bash
# regenerate data files (after updating the source workbook)
python3 -m pip install openpyxl
python3 scripts/xlsx_to_json.py

# serve
python3 -m http.server 8080
# then open http://localhost:8080
```

Open `index.html` directly with `file://` will fail because the app fetches JSON; you must serve over HTTP.

## Deploy to GitHub Pages

The repository is at https://github.com/rbndchsn/US_EPR_Database2026.

**First-time setup:**

1. From this folder, run:

   ```bash
   git init -b main
   git add .
   git commit -m "Initial release: US EPR Policy Tracker"
   git remote add origin https://github.com/rbndchsn/US_EPR_Database2026.git
   git push -u origin main
   ```

2. In the repo on GitHub: **Settings > Pages > Source**: select **GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) runs automatically on every push to `main`. It regenerates `data/bills.json` and `data/aggregates.json` from the Excel file, then publishes the site.
4. After the first successful workflow run, the site will be live at https://rbndchsn.github.io/US_EPR_Database2026/.

**Subsequent updates** (data refresh or code changes):

```bash
git add .
git commit -m "Refresh data" # or whatever describes the change
git push
```

To use a custom subdomain, add a `CNAME` file containing the subdomain (e.g. `epr.example.com`) at the repo root and configure the DNS CNAME record at your registrar.

## Updating the data

The Sustainable Packaging Coalition periodically updates their EPR Policy Database at https://epr.sustainablepackaging.org/policies. To refresh:

1. Re-download the SPC data into the same Excel format used here.
2. Replace `source/APEX_EPR_USPolicyDatabase_v1.xlsx`.
3. Update the `last_updated` field at the top of `scripts/xlsx_to_json.py` (in the `METADATA` dict) and the matching string in `index.html` and `assets/js/app.js` if needed.
4. Commit and push. The workflow rebuilds and redeploys automatically.

## Data attribution

Source: Sustainable Packaging Coalition / GreenBlue EPR Policy Database, https://epr.sustainablepackaging.org/policies. Last refresh: February 2026. The tracker presents the source data in an alternative interface; consult the SPC database for authoritative content and any post-February updates.

## Disclaimer

This is a reference tool. The information presented is summarised from third-party tracking and is not legal advice. For binding regulatory analysis consult counsel.

## Maintainer

Apex Companies Product Sustainability practice.
