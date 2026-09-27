# Fincart Renewal Tracker

A Flask + PostgreSQL workspace for insurance renewals. Import the monthly insurance export, filter the renewal queue, manage client follow-ups, and download matching policies as Excel.

## Run locally

```bash
pip install -r requirements.txt
cp .env.example .env
# Set DATABASE_URL and SECRET_KEY in .env.
python app.py
```

Open http://127.0.0.1:5003. Existing Render configuration works without a framework migration or additional production dependencies. See [DEPLOY.md](DEPLOY.md).

## Renewal workspace

- Light interface with visible summary counts, labelled filters and a compact policy table.
- Select a client or row arrow to view all stored client/policy details and edit status, phone, notes or the renewal date. Changes save together; failed saves leave the form open.
- Search by client name, email, phone or policy number; combine with team, relationship manager, policy type and follow-up status.
- Tables show 25, 50 or 100 rows per page. Excel downloads include **all matching rows**, regardless of the displayed page.
- Draft email and WhatsApp actions open a prepared message for the operator to review and send.

### Timelines

Date calculations use **Asia/Kolkata**, rather than the server's timezone.

| Timeline | Included |
| --- | --- |
| Overdue | Dates before today |
| Due today | Today only |
| Today & tomorrow | Today through tomorrow |
| Next 2 / 7 / 14 / 30 / 60 / 90 days | Today through N days ahead, inclusive |
| Custom date range | Selected start and end dates, both inclusive |
| All upcoming | Today and all future dates |
| All policies | Every matching policy, including overdue and undated records |
| Missing renewal date | Records with no renewal date |

Quick-card counts follow the search, team, manager, policy-type and status filters. They describe overlapping windows, so they should not be added together. `all` was previously labelled “All upcoming” despite including overdue records; it is now correctly labelled “All policies”, and `upcoming` is a separate filter.

### Excel download

`GET /api/renewals/export` uses the same filter parameters and query builder as `GET /api/renewals`:

`bucket`, `q`, `type`, `team`, `rm`, `status`, `start`, `end`.

The workbook has:

1. **Policies:** client name, email, phone, manager, team, policy number, plan, insurer, policy type, sum insured, premium, renewal date, days to renewal, follow-up status, remarks and reschedule flag.
2. **Applied filters:** timeline, date range, every other applied filter, business date, matching count and premium total.

Numbers and dates use native Excel types. Phone and policy numbers remain text, retaining leading zeros. Imported text cannot become an Excel formula. The download contains all client information currently stored by the application; it does not invent fields absent from the source schema.

## Import behaviour

`ingest.py` keeps `recordStatus = Confirmed` rows and upserts by `PolicyNo`. Repeat uploads update policies without duplication. Renewal dates come from `NextPremimum_Date`. Employee reference uploads resolve manager/team mappings. Existing database schema and import rules are retained.

## Validation

```bash
python -m unittest discover -s tests -v
node --check static/dashboard.js
```

Tests cover timeline boundaries, custom ranges, combined filters, search, missing dates, Excel field types and literal text, JSON/export parity across multiple pages, atomic edits and slash-containing policy numbers. Database calls are isolated with test doubles; these tests do not require or change production data.

## Files

| File | Purpose |
| --- | --- |
| `app.py` | Flask pages, import handling, API and export routes |
| `queries.py` | Shared filtering, timeline rules and atomic edits |
| `exports.py` | Formatted Excel generation |
| `db.py` | PostgreSQL schema and connection |
| `ingest.py` | Excel import and upsert |
| `static/` and `templates/` | Responsive interface |
| `review/` | Standalone visual preview using fictional data |

For the optional DOM interaction checks, install `jsdom` as local test tooling (`npm install --no-save jsdom`), run `python tests/serve_fixture.py` in one terminal, then `node tests/test_dashboard.cjs` in another. The fixture uses fictional policies and does not connect to PostgreSQL. Native dialog rendering and mobile layout still need visual review in a browser.
